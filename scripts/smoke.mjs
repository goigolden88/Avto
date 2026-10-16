/**
 * Прогон собранного приложения в настоящем браузере.
 *
 * Зачем он есть. Тестов React-экранов в проекте нет и не будет: их проверяет
 * прогон. Он не проверяет вёрстку и не заменяет тесты расчёта, он отвечает
 * на один вопрос — открывается ли приложение и не падает ли оно на обычном
 * пути.
 *
 * Почему не Playwright. Ради одного сценария он тянет свой Chromium
 * и сотню мегабайт в devDependencies. Здесь — уже установленный браузер
 * и протокол отладки поверх WebSocket, встроенного в Node 22+.
 * Ни одной зависимости.
 *
 * Данные не трогает: браузер запускается с пустым временным профилем,
 * и IndexedDB у него свой. Запросы к GitHub перехватываются и обслуживаются
 * подставным репозиторием в памяти — настоящий `AvtoData` не трогается.
 *
 * Запуск: `npm run smoke`. Собирает сам, поэтому проверяет ровно тот код,
 * который лежит в `src/` сейчас. Падает с ненулевым кодом, если браузер
 * сообщил об ошибке или проверка не сошлась.
 *
 * Обвязка — из прогона «Трапезы», у них — из «Делу Время»; сценарий — свой,
 * скелета Авто-3: главный экран, «Настройки», валюта, синхронизация, работа
 * без сети. Проверки прибавляются вместе с экранами.
 */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { build, preview } from 'vite'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Адрес собранного приложения. Заполняется, когда поднимется сервер. */
let APP = ''

/** Свой порт отладки, чтобы не столкнуться с открытым браузером. */
const DEBUG_PORT = 9333

/**
 * Где искать браузер. Годится любой на Chromium: Chrome, Edge, Chromium.
 * Свой путь задаётся переменной CHROME_PATH.
 */
const BROWSERS = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/** Отладочный вывод: `SMOKE_DEBUG=1 npm run smoke`. Без переменной молчит. */
const debug = (text) => {
  if (process.env.SMOKE_DEBUG) console.log(`[debug] ${text}`)
}

// ─── Запуск ────────────────────────────────────────────────────────────────

function findBrowser() {
  const found = BROWSERS.find((path) => path && existsSync(path))
  if (!found) throw new Error('Браузер на Chromium не найден. Укажите путь в переменной CHROME_PATH.')
  return found
}

/**
 * Поднимает просмотр собранного приложения.
 *
 * Через API Vite, а не отдельным процессом `npm run preview`: на Windows
 * Node не запускает `.cmd` без оболочки. Заодно адрес берётся у самого
 * сервера — вместе с `base` из vite.config.ts.
 */
async function startServer() {
  // Собираем сами, а не полагаемся на dist от прошлого раза: прогон, который
  // молча проверяет вчерашнюю сборку, показывает зелёное на сломанном коде.
  await build({ root: ROOT, logLevel: 'warn' })

  const server = await preview({ root: ROOT })
  const url = server.resolvedUrls?.local?.[0]
  if (!url) {
    await server.close()
    throw new Error('Сервер просмотра не назвал адрес')
  }

  APP = url
  return server
}

/** Адрес вкладки в протоколе отладки. */
async function pageSocket() {
  for (let i = 0; i < 40; i++) {
    try {
      const tabs = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`).then((r) => r.json())
      const page = tabs.find((tab) => tab.type === 'page')
      if (page) return page.webSocketDebuggerUrl
    } catch {
      // Браузер ещё не открыл порт.
    }
    await sleep(250)
  }
  throw new Error('Браузер не отдал порт отладки')
}

// ─── Разговор с браузером ──────────────────────────────────────────────────

/** Ошибки, о которых сообщил сам браузер. Любая из них валит прогон. */
const problems = []

/** Проверки сценария: что должно было оказаться на экране. */
const checks = []

function check(what, passed, seen = '') {
  checks.push({ what, passed, seen })
}

let socket
let seq = 0
const waiting = new Map()

function connect(url) {
  socket = new WebSocket(url)

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data)

    if (message.id !== undefined) {
      waiting.get(message.id)?.(message)
      waiting.delete(message.id)
      return
    }

    // Запрос страницы к GitHub — отвечает подставной репозиторий прогона.
    if (message.method === 'Fetch.requestPaused') {
      void onGitHub(message.params)
      return
    }

    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails
      problems.push(details.exception?.description ?? details.text)
    }

    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      problems.push(message.params.args.map((arg) => arg.value ?? arg.description).join(' '))
    }
  }

  return new Promise((done, fail) => {
    socket.onopen = done
    socket.onerror = fail
  })
}

function send(method, params = {}) {
  const id = ++seq
  return new Promise((done) => {
    waiting.set(id, (message) => done(message.result))
    socket.send(JSON.stringify({ id, method, params }))
  })
}

/**
 * Выполняет выражение на странице. Исключение здесь — тоже ошибка прогона:
 * если сценарий не нашёл кнопку, значит экран не тот, каким его считали.
 */
async function run(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) {
    problems.push(result.exceptionDetails.exception?.description ?? 'ошибка в сценарии')
    return null
  }
  return result.result.value
}

/**
 * Помощники, доступные внутри каждого шага сценария.
 *
 * `set` пишет в поле так, как это делает человек: React слушает не
 * присваивание `value`, а событие с нативного сеттера. `blur` через
 * focusout по той же причине — обычный blur не всплывает.
 */
const HELPERS = `
  const set = (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const blur = (el) => {
    el.blur()
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  }
  const byText = (tag, label) =>
    [...document.querySelectorAll(tag)].find((el) => el.textContent.trim() === label)
`

// Точка с запятой между помощниками и шагом: шаг, начатый с `[` или `(`,
// иначе склеился бы с последней строкой помощников в одно выражение.
const act = (body) => run(`(() => {${HELPERS};\n${body}\n})()`)

/** Текст всего экрана. По нему и делаются проверки. */
const screen = () => run('document.querySelector("#root")?.innerText ?? ""')

/**
 * Есть ли на экране такой текст — без учёта регистра и неразрывных
 * пробелов: заголовки блоков рисуются капителью средствами CSS, и
 * `innerText` отдаёт их прописными.
 */
function has(text, needle) {
  const flat = (value) => (value ?? '').replace(/\u00A0/g, ' ').toLowerCase()
  return flat(text).includes(flat(needle))
}

/** Строка экрана с образцом внутри. Для внятного отчёта о непрошедшем. */
function line(text, part) {
  const flat = (value) => (value ?? '').replace(/\u00A0/g, ' ')
  return (
    flat(text)
      .split('\n')
      .find((each) => each.toLowerCase().includes(part.toLowerCase())) ?? ''
  )
}

/** Переход по хеш-роутингу с ожиданием перерисовки. */
async function go(hash) {
  await run(`location.hash = ${JSON.stringify(hash)}`)
  await sleep(700)
}

/** Разворачивает блок по заголовку, если он свёрнут. */
async function unfold(title) {
  await act(`
    const button = [...document.querySelectorAll('.fold__btn')]
      .find((el) => el.textContent.trim() === ${JSON.stringify(title)})
    if (button?.getAttribute('aria-expanded') === 'false') button.click()
  `)
  await sleep(400)
}

/** Итог у заголовка блока: «· €» у «Валюты». */
const foldSummary = (title) =>
  run(`[...document.querySelectorAll('.fold__btn')]
    .find((el) => el.textContent.trim() === ${JSON.stringify(title)})
    ?.closest('.fold__head')?.querySelector('.fold__summary')?.textContent.trim() ?? ''`)

/** Сколько ждать появления проверяемого, мс. Дольше — это уже поломка, а не медленный сервер. */
const WAIT_MS = 20000

/**
 * Ждёт, пока выражение на странице не станет истинным, но не дольше `WAIT_MS`.
 * Ошибка выполнения посреди перезагрузки (контекст страницы ушёл) — не конец:
 * опрос продолжается. Истечение срока валит прогон отдельной ошибкой.
 */
async function waitFor(expression, what) {
  const until = Date.now() + WAIT_MS
  while (Date.now() < until) {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true })
    if (result?.result?.value === true) return true
    await sleep(100)
  }
  problems.push(`не дождался за ${WAIT_MS / 1000} с: ${what}`)
  return false
}

/** Главный экран дочитал базу: строка о записях выводится только после подсчёта. */
const HOME_READY = `document.querySelector('.home-empty') !== null`

/**
 * Ждёт, пока откроется новая страница: старая отдаёт метку `__smokeOld`,
 * у новой её нет. Затем — загрузка закончена, в корне есть текст и
 * выполняется `until`.
 */
async function loaded(until, what) {
  await waitFor(
    `!window.__smokeOld && document.readyState === 'complete' &&
      (document.querySelector('#root')?.innerText ?? '').trim() !== '' && (${until})`,
    what,
  )
}

/** Помечает текущую страницу, чтобы `loaded` отличил её от новой. */
const markOld = () => send('Runtime.evaluate', { expression: 'window.__smokeOld = true' })

/** Полная загрузка страницы по адресу. */
async function open(url, until = HOME_READY, what = 'главный экран') {
  await markOld()
  await send('Page.navigate', { url })
  await loaded(until, what)
}

/** Перезагрузка страницы с ожиданием того же, что у `open`. */
async function reload(until = HOME_READY, what = 'главный экран') {
  await markOld()
  await send('Page.reload')
  await loaded(until, what)
}

/** Сеть вкл/выкл — для проверки работы из кеша service worker. */
async function offline(on) {
  await send('Network.enable')
  await send('Network.emulateNetworkConditions', {
    offline: on,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  })
}

// ─── Подставной GitHub ─────────────────────────────────────────────────────

/**
 * Репозиторий данных в памяти прогона. Блок взят из прогона «Трапезы»;
 * своё — только имя репозитория. Запросы страницы к api.github.com
 * перехватываются протоколом отладки и обслуживаются здесь: сеть не нужна,
 * настоящий репозиторий не трогается.
 *
 * Отвечает теми кодами, что GitHub: 409 «Git Repository is empty» у пустого
 * репозитория, 422 на сдвиг ветки не с головы, 401 на чужой токен.
 * Отпечаток файла — настоящий git blob sha.
 */
const GOOD_TOKEN = 'github_pat_smoke'
const REPO = 'me/avto-data'
const TOKEN_EXPIRES = '2027-09-01 12:00:00 +0300'

const github = {
  /** Голова ветки main. Null — в репозитории ни одного коммита. */
  head: null,
  /** sha коммита → { tree, parent, message } */
  commits: new Map(),
  /** sha дерева → Map путь → sha файла */
  trees: new Map(),
  /** sha файла → содержимое */
  blobs: new Map(),
  /** Сколько запросов страницы перехвачено: без настроенной синхронизации — ни одного. */
  requests: 0,
  seq: 0,
}

function blobSha(content) {
  const body = Buffer.from(content, 'utf8')
  return createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${body.length}\0`), body])).digest('hex')
}

function nextSha(kind) {
  github.seq += 1
  return createHash('sha1').update(`${kind}:${github.seq}`).digest('hex')
}

function putBlob(content) {
  const sha = blobSha(content)
  github.blobs.set(sha, content)
  return sha
}

function putTree(files) {
  const sha = nextSha('tree')
  github.trees.set(sha, files)
  return sha
}

function putCommit(tree, parent, message) {
  const sha = nextSha('commit')
  github.commits.set(sha, { tree, parent, message })
  return sha
}

/** Файлы дерева — по sha дерева или коммита: GitHub принимает оба. */
function filesAt(sha) {
  return github.trees.get(sha) ?? github.trees.get(github.commits.get(sha)?.tree) ?? new Map()
}

/** Файлы на голове ветки: путь → содержимое. */
function repoFiles() {
  return Object.fromEntries([...filesAt(github.head)].map(([path, sha]) => [path, github.blobs.get(sha)]))
}

/** Разобранный JSON файла на голове ветки. Нет файла или не JSON — null. */
function repoJson(path) {
  try {
    const text = repoFiles()[path]
    return text === undefined ? null : JSON.parse(text)
  } catch {
    return null
  }
}

/** Коммит «с другого устройства» — прямо в ветку, мимо приложения. */
function commitFromOtherDevice(changes) {
  const files = new Map(filesAt(github.head))
  for (const [path, records] of Object.entries(changes)) {
    files.set(path, putBlob(`${JSON.stringify(records, null, 2)}\n`))
  }
  github.head = putCommit(putTree(files), github.head, 'Другое устройство')
}

/** Ответ на запрос приложения: { status, body }. */
function answer(request, text) {
  const auth = Object.entries(request.headers).find(([name]) => name.toLowerCase() === 'authorization')?.[1]
  if (auth !== `Bearer ${GOOD_TOKEN}`) return { status: 401, body: { message: 'Bad credentials' } }

  const method = request.method
  const path = new URL(request.url).pathname.replace(/^\/repos\/[^/]+\/[^/]+/, '')
  const data = text ? JSON.parse(text) : {}
  let match

  if (method === 'GET' && path === '') {
    return {
      status: 200,
      body: { full_name: REPO, private: true, default_branch: 'main', permissions: { push: true } },
    }
  }

  if (method === 'GET' && path === '/git/ref/heads/main') {
    return github.head
      ? { status: 200, body: { object: { sha: github.head } } }
      : { status: 409, body: { message: 'Git Repository is empty.' } }
  }

  if (method === 'PUT' && path.startsWith('/contents/')) {
    if (github.head) return { status: 422, body: { message: 'Invalid request. "sha" wasn\'t supplied.' } }
    const file = decodeURIComponent(path.slice('/contents/'.length))
    const content = Buffer.from(data.content, 'base64').toString('utf8')
    github.head = putCommit(putTree(new Map([[file, putBlob(content)]])), null, data.message)
    return { status: 201, body: { commit: { sha: github.head } } }
  }

  if (method === 'GET' && (match = /^\/git\/trees\/(\w+)$/.exec(path))) {
    const files = filesAt(match[1])
    // Как у GitHub: с recursive=1 в дереве и каталоги — приложение их отбрасывает.
    const dirs = [...new Set([...files.keys()].filter((each) => each.includes('/')).map((each) => each.split('/')[0]))]
    return {
      status: 200,
      body: {
        tree: [
          ...dirs.map((dir) => ({ path: dir, sha: nextSha('dir'), type: 'tree' })),
          ...[...files].map(([file, sha]) => ({ path: file, sha, type: 'blob' })),
        ],
        truncated: false,
      },
    }
  }

  if (method === 'GET' && (match = /^\/git\/blobs\/(\w+)$/.exec(path))) {
    const content = github.blobs.get(match[1])
    return content === undefined
      ? { status: 404, body: { message: 'Not Found' } }
      : { status: 200, body: { content: Buffer.from(content, 'utf8').toString('base64'), encoding: 'base64' } }
  }

  if (method === 'POST' && path === '/git/trees') {
    const files = new Map(filesAt(data.base_tree))
    for (const entry of data.tree) files.set(entry.path, putBlob(entry.content))
    return { status: 201, body: { sha: putTree(files) } }
  }

  if (method === 'POST' && path === '/git/commits') {
    return { status: 201, body: { sha: putCommit(data.tree, data.parents[0] ?? null, data.message) } }
  }

  if (method === 'PATCH' && path === '/git/refs/heads/main') {
    const commit = github.commits.get(data.sha)
    if (!commit || commit.parent !== github.head) {
      return { status: 422, body: { message: 'Update is not a fast forward' } }
    }
    github.head = data.sha
    return { status: 200, body: { object: { sha: data.sha } } }
  }

  return { status: 404, body: { message: `Подставной GitHub не знает ${method} ${path}` } }
}

const CORS = [
  { name: 'Access-Control-Allow-Origin', value: '*' },
  { name: 'Access-Control-Expose-Headers', value: 'github-authentication-token-expiration' },
]

/**
 * Перехваченный запрос. Отвечает всегда: запрос без ответа повис бы,
 * и прогон ждал бы его молча.
 */
async function onGitHub({ requestId, request }) {
  debug(`перехвачен ${request.method} ${request.url}`)
  github.requests += 1

  if (request.method === 'OPTIONS') {
    await send('Fetch.fulfillRequest', {
      requestId,
      responseCode: 204,
      responseHeaders: [
        ...CORS,
        { name: 'Access-Control-Allow-Methods', value: 'GET, POST, PATCH, PUT' },
        { name: 'Access-Control-Allow-Headers', value: 'Authorization, Content-Type, Accept, X-GitHub-Api-Version' },
      ],
    })
    return
  }

  let reply
  let text = ''
  try {
    text =
      request.postData ??
      (request.postDataEntries ?? []).map((entry) => Buffer.from(entry.bytes ?? '', 'base64').toString('utf8')).join('')
    reply = answer(request, text)
  } catch (failure) {
    reply = { status: 500, body: { message: `Подставной GitHub упал: ${failure}` } }
  }
  debug(`github ${request.method} ${request.url} → ${reply.status}`)

  await send('Fetch.fulfillRequest', {
    requestId,
    responseCode: reply.status,
    responseHeaders: [
      ...CORS,
      { name: 'Content-Type', value: 'application/json; charset=utf-8' },
      { name: 'github-authentication-token-expiration', value: TOKEN_EXPIRES },
    ],
    body: Buffer.from(JSON.stringify(reply.body), 'utf8').toString('base64'),
  })
}

// ─── Сценарий ──────────────────────────────────────────────────────────────

/** Базовый адрес сайта (Р-01). С ним согласованы манифест и работник. */
const BASE = '/Avto/'

/**
 * Скелет Авто-3: сайт по своему адресу, манифест и иконки, главный экран,
 * «Настройки», валюта через перезагрузку, синхронизация с подставным
 * репозиторием, работа без сети. Любая ошибка в консоли валит прогон.
 */
async function scenario() {
  await send('Runtime.enable')
  await send('Page.enable')
  // GitHub перехватывается с самого начала: так видно, что без настроенной
  // синхронизации приложение туда не ходит вовсе.
  await send('Fetch.enable', { patterns: [{ urlPattern: 'https://api.github.com/*' }] })

  // ─ Манифест и base. Главный тихий риск каркаса: сборка зелёная,
  // страница белая. Проверяется собранное, а не исходник.
  const base = new URL(APP).pathname
  check(`приложение отдаётся по ${BASE}`, base === BASE, APP)

  const manifest = await fetch(new URL('manifest.webmanifest', APP)).then((r) => r.json())
  const paths = [manifest.id, manifest.start_url, manifest.scope, ...manifest.icons.map((icon) => icon.src)]
  const outside = paths.filter((path) => typeof path !== 'string' || !path.startsWith(BASE))
  check(`в манифесте id, start_url, scope и иконки — под ${BASE}`, outside.length === 0, outside.join(', '))
  check('в манифесте имя «Авто»', manifest.name === 'Авто' && manifest.short_name === 'Авто', manifest.name)

  const served = await Promise.all(
    [...manifest.icons.map((icon) => icon.src), `${BASE}favicon.svg`, `${BASE}apple-touch-icon-180x180.png`].map((src) =>
      fetch(new URL(src, APP)).then((r) => `${src} ${r.status}`),
    ),
  )
  check('иконки отдаются', served.every((each) => each.endsWith(' 200')), served.join('; '))
  check(
    'есть иконка maskable — для круглой маски Android',
    manifest.icons.some((icon) => icon.purpose === 'maskable'),
    JSON.stringify(manifest.icons.map((icon) => icon.purpose ?? 'any')),
  )

  // ─ Первый запуск: шапка «Авто», записей нет.
  await open(APP)
  const start = await screen()
  check(
    'главный экран: шапка «Авто», записей пока нет, первые — с журналом',
    has(start, 'Авто') && has(start, 'Записей пока нет') && has(start, 'появятся с журналом'),
    start.replace(/\s+/g, ' ').slice(0, 160),
  )
  check('вкладка одна — «Главная»', (await run(`[...document.querySelectorAll('.tab')].map((el) => el.textContent.trim()).join(', ')`)) === 'Главная')
  check('свежей установке «Что нового» не показано', !has(start, 'Что нового'))
  const database = await run(`indexedDB.databases().then((list) => list.map((each) => each.name).sort().join(', '))`)
  check(
    'база данных называется avto, рядом — общая база семьи family (Р-01, Я-35 «FamilyCore»)',
    database === 'avto, family',
    `базы: ${database}`,
  )

  // ─ Незнакомый адрес — на главный.
  await go('/nowhere')
  check('незнакомый адрес открывает главный, а не пустоту', (await run('location.hash')) === '#/', await run('location.hash'))

  // ─ Настройки: шестерёнкой, разделы свёрнуты.
  await act(`document.querySelector('[aria-label="Настройки"]')?.click()`)
  await sleep(700)
  const settings = await screen()
  check(
    'настройки открываются шестерёнкой: синхронизация, валюта, о приложении — свёрнуты',
    has(settings, 'Синхронизация') && has(settings, 'Валюта') && has(settings, 'О приложении') && !has(settings, 'Версия схемы'),
    settings.replace(/\s+/g, ' ').slice(0, 160),
  )
  check(
    'синхронизация — первым разделом',
    settings.indexOf('СИНХРОНИЗАЦИЯ') !== -1 && settings.indexOf('СИНХРОНИЗАЦИЯ') < settings.indexOf('ВАЛЮТА'),
    settings.replace(/\s+/g, ' ').slice(0, 120),
  )
  const defaultCurrency = await foldSummary('Валюта')
  check('валюта до первой правки — «₽», записи prefs:main ещё нет — Р-17', defaultCurrency === '· ₽', defaultCurrency)

  await unfold('О приложении')
  await unfold('Что где лежит')
  const about = await screen()
  check(
    'в «О приложении» — схема 1 и восемь хранилищ, все пусты',
    has(about, 'Версия схемы данных: 1') &&
      ['Машины', 'Записи журнала', 'Точки маршрутов', 'Маршруты', 'Поездки', 'Места парковки', 'Наблюдения парковок', 'Общие настройки'].every(
        // \u042F\u0447\u0435\u0439\u043A\u0438 \u0442\u0430\u0431\u043B\u0438\u0446\u044B innerText \u0440\u0430\u0437\u0434\u0435\u043B\u044F\u0435\u0442 \u0442\u0430\u0431\u0443\u043B\u044F\u0446\u0438\u0435\u0439, \u043F\u0443\u0441\u0442\u0430\u044F \u0442\u0440\u0435\u0442\u044C\u044F \u2014 \u0442\u043E\u0436\u0435.
        (label) => new RegExp(`(?:^|\\n)${label}\\t0\\t*(?:\\n|$)`).test(about),
      ),
    line(about, 'Общие настройки'),
  )
  await unfold('Что нового')
  check('«Что нового» — первая строка о рождении приложения', has(await screen(), 'Первая сборка «Авто»'))

  // ─ Валюта: «€» кнопкой подсказки, переживает перезагрузку.
  await unfold('Валюта')
  const hints = await run(`[...document.querySelectorAll('[aria-label="Подсказки валюты"] button')].map((el) => el.textContent.trim()).join(' ')`)
  check('подсказки валюты — ₽ € $ zł', hints === '₽ € $ zł', hints)
  await act(`byText('button', '€')?.click()`)
  await sleep(700)
  check('валюта сменилась на «€»', (await foldSummary('Валюта')) === '· €', await foldSummary('Валюта'))
  await reload('document.querySelector(".fold__btn") !== null', 'настройки после перезагрузки')
  await sleep(500)
  const afterReload = await foldSummary('Валюта')
  check('после перезагрузки стоит «€»', afterReload === '· €', afterReload)

  // Своя валюта — свободной строкой, сохраняется по «Сохранить».
  await act(`set(document.querySelector('[name="currency"]'), 'Kč')`)
  await sleep(200)
  await act(`byText('button', 'Сохранить')?.click()`)
  await sleep(700)
  check('своя валюта сохраняется по «Сохранить»', (await foldSummary('Валюта')) === '· Kč', await foldSummary('Валюта'))
  await act(`byText('button', '€')?.click()`)
  await sleep(700)

  check(
    'без настроенной синхронизации приложение в GitHub не ходит',
    github.requests === 0,
    `запросов к GitHub: ${github.requests}`,
  )

  await syncScenario()

  // ─ Service worker: без него нет ни офлайна, ни автообновления.
  const worker = await run(`Promise.race([
    navigator.serviceWorker.ready.then((r) => r.active?.state ?? 'нет'),
    new Promise((done) => setTimeout(() => done('не дождался'), 5000)),
  ])`)
  check('service worker встал и активен', worker === 'activated', `состояние ${worker}`)

  // ─ Без сети. Проверяется и то, что страницу отдал работник: иначе при
  // непойманном офлайне проверка прошла бы на обычной загрузке из сети.
  await offline(true)
  await open(`${APP}?offline=1`)
  const cached = await screen()
  const controlled = await run('navigator.serviceWorker.controller !== null')
  check(
    'без сети приложение открывается из кеша',
    has(cached, 'Авто') && controlled === true,
    `работник ${controlled ? 'управляет' : 'не управляет'} страницей`,
  )
  await go('/settings')
  check('валюта записью не считается: на главном по-прежнему «записей пока нет»', has(cached, 'Записей пока нет'), line(cached, 'Запис'))
  const offlineCurrency = await foldSummary('Валюта')
  check('без сети данные на месте: валюта та, что пришла синхронизацией', offlineCurrency === '· $', offlineCurrency)
  await offline(false)
}

/** Синхронизация с подставным репозиторием: первый проход и правка «с другого устройства». */
async function syncScenario() {
  const syncNow = async (wait = 2500) => {
    await act(`byText('button', 'Синхронизировать')?.click()`)
    await sleep(wait)
    return screen()
  }

  // Проход идёт через пять секунд после последней записи: пусть прошлые
  // записи сценария отработают, пока синхронизация выключена.
  await sleep(6000)

  await go('/settings')
  await unfold('Синхронизация')
  const off = await screen()
  check(
    'синхронизация по умолчанию выключена — данные только в браузере',
    has(off, 'данные живут только в этом браузере'),
    line(off, 'выключен'),
  )

  await act(`document.querySelector('.check input')?.click()`)
  await sleep(500)
  await act(`
    set(document.querySelector('input[placeholder="владелец/репозиторий"]'), ${JSON.stringify(REPO)});
    const token = document.querySelector('input[type=password]');
    set(token, ${JSON.stringify(GOOD_TOKEN)});
    blur(token);
  `)
  await sleep(500)
  await act(`byText('button', 'Проверить доступ')?.click()`)
  await sleep(1500)
  const access = await screen()
  check('«Проверить доступ»: репозиторий найден, приватный', has(access, `Репозиторий ${REPO} найден, приватный.`), line(access, 'Репозиторий'))

  // ─ Первый проход: пустой репозиторий заводится сам, дальше — один коммит.
  const first = await syncNow(3000)
  debug(`экран после первого прохода:\n${first}`)
  const files = Object.keys(repoFiles()).sort()
  check('синхронизация прошла: всё отправлено', has(first, 'Всё отправлено'), line(first, 'отправлен'))
  check(
    'в репозитории meta.json с "app": "avto" и схемой 1 — Я-24 «FamilyCore»',
    repoJson('meta.json')?.app === 'avto' && repoJson('meta.json')?.schemaVersion === 1,
    JSON.stringify(repoJson('meta.json')),
  )
  check(
    'README «Авто» положен приложением, в нём раскладка по годам',
    (repoFiles()['README.md'] ?? '').startsWith('# Данные приложения «Авто»') &&
      (repoFiles()['README.md'] ?? '').includes('`entries/ГГГГ.json`'),
    (repoFiles()['README.md'] ?? 'README нет').slice(0, 60),
  )
  const expected = ['meta.json', 'README.md', 'cars.json', 'points.json', 'routes.json', 'parkings.json', 'prefs.json']
  check('справочники и настройки — файлами по 02-Архитектуре', expected.every((path) => files.includes(path)), files.join(', '))
  const pushed = repoJson('prefs.json')
  check(
    'валюта уехала в prefs.json одной записью prefs:main',
    Array.isArray(pushed) && pushed.length === 1 && pushed[0]?.id === 'prefs:main' && pushed[0]?.currency === '€',
    JSON.stringify(pushed),
  )

  // ─ Другое устройство сменило валюту на «$» — после синхронизации она здесь.
  const later = new Date(Date.now() + 60_000).toISOString()
  commitFromOtherDevice({ 'prefs.json': [{ id: 'prefs:main', updatedAt: later, currency: '$' }] })
  const pulled = await syncNow()
  await sleep(500)
  const synced = await foldSummary('Валюта')
  check('валюта с другого устройства доехала после синхронизации', synced === '· $', `${synced}; ${line(pulled, 'получено')}`)

  // Выключить: дальше прогон без сети, и проход не должен пытаться отправлять.
  await act(`document.querySelector('.check input')?.click()`)
  await sleep(500)
  await send('Fetch.disable')
}

// ─── Прогон ────────────────────────────────────────────────────────────────

let server
let browser
let profile

try {
  server = await startServer()
  profile = mkdtempSync(join(tmpdir(), 'avto-smoke-'))
  browser = spawn(
    findBrowser(),
    [
      '--headless=new',
      `--remote-debugging-port=${DEBUG_PORT}`,
      // Пустой временный профиль: своей базы у прогона нет и быть не должно.
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--disable-gpu',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  await connect(await pageSocket())
  await scenario()
} catch (failure) {
  problems.push(failure instanceof Error ? failure.message : String(failure))
} finally {
  socket?.close()
  browser?.kill()
  await server?.close()
}

// Браузер отпускает профиль не мгновенно, и на Windows удаление сразу
// после kill падает с EPERM. Не удалось — не беда: это папка во временных.
await sleep(500)
if (profile) {
  try {
    rmSync(profile, { recursive: true, force: true })
  } catch {
    // Останется до следующей уборки временных файлов.
  }
}

const failed = checks.filter((each) => !each.passed)

for (const each of checks) {
  console.log(`${each.passed ? '  ok' : 'НЕТ '} ${each.what}${each.seen ? ` — ${each.seen}` : ''}`)
}

if (problems.length > 0) {
  console.log('\nБраузер сообщил об ошибках:')
  for (const problem of problems) console.log(`  ${problem}`)
}

const bad = failed.length > 0 || problems.length > 0
console.log(
  bad
    ? `\nПрогон не прошёл: проверок ${checks.length}, не сошлось ${failed.length}, ошибок ${problems.length}`
    : `\nПрогон прошёл: ${checks.length} проверок, ошибок нет`,
)

process.exit(bad ? 1 : 0)
