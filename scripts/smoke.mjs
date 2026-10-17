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
 * Обвязка — из прогона «Трапезы», у них — из «Делу Время»; сценарий — свой:
 * скелет Авто-3 (главный экран, «Настройки», валюта, синхронизация, работа
 * без сети), задача 2 — машины и журнал, свои адреса установки (Р-22),
 * задача 4 — демо, задача 5 — импорт, задача 6 — маршруты. Проверки
 * прибавляются вместе с экранами.
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
  const choose = (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
    setter.call(el, value)
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const field = (name) => document.querySelector('[name="' + name + '"]')
  const optionByText = (name, label) =>
    [...field(name).options].find((option) => option.textContent.trim() === label)?.value
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

/** Главный экран дочитал базу: журнал выводится только после чтения машин и записей. */
const HOME_READY = `document.querySelector('.journal') !== null`

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
 * Свои адреса установки (Р-22): первая установка на Android застряла,
 * новый адрес манифеста — новая установка. Больше не меняются.
 */
const MANIFEST = 'avto.webmanifest'
const INSTALL_ID = `${BASE}avto`
const START_URL = `${BASE}?app=avto`

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

  const manifest = await fetch(new URL(MANIFEST, APP)).then((r) => r.json())
  const paths = [manifest.id, manifest.start_url, manifest.scope, ...manifest.icons.map((icon) => icon.src)]
  const outside = paths.filter((path) => typeof path !== 'string' || !path.startsWith(BASE))
  check(`в манифесте id, start_url, scope и иконки — под ${BASE}`, outside.length === 0, outside.join(', '))
  check(
    `свои адреса установки — id ${INSTALL_ID}, start_url ${START_URL}, scope ${BASE} (Р-22)`,
    manifest.id === INSTALL_ID && manifest.start_url === START_URL && manifest.scope === BASE,
    `${manifest.id}, ${manifest.start_url}, ${manifest.scope}`,
  )
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

  // ─ Первый запуск: шапка «Авто», машины нет — сначала завести.
  await open(APP)
  const start = await screen()
  check(
    'главный экран: шапка «Авто», «Сначала заведите машину» и кнопка',
    has(start, 'Авто') && has(start, 'Сначала заведите машину') && has(start, 'Завести машину'),
    start.replace(/\s+/g, ' ').slice(0, 160),
  )
  const link = await run(`document.querySelector('link[rel="manifest"]')?.getAttribute('href') ?? 'нет'`)
  check(`страница ссылается на ${BASE}${MANIFEST}`, link === `${BASE}${MANIFEST}`, link)
  const tabs = await run(`[...document.querySelectorAll('.tab')].map((el) => el.textContent.trim()).join(', ')`)
  check('внизу две вкладки — «Главная» и «Маршруты» (Р-24)', tabs === 'Главная, Маршруты', tabs)
  check('свежей установке «Что нового» не показано', !has(start, 'Что нового'))
  const database = await run(`indexedDB.databases().then((list) => list.map((each) => each.name).sort().join(', '))`)
  check(
    'база данных называется avto, рядом — общая база семьи family (Р-01, Я-35 «FamilyCore»)',
    database === 'avto, family',
    `базы: ${database}`,
  )

  // ─ Предложение демо: пустая база, токена нет — один раз (Я-45 «FamilyCore»).
  await waitFor(`document.querySelector('.demo-offer') !== null`, 'предложение демо на первом запуске')
  const offer = await screen()
  check(
    'на первом запуске — «Посмотреть на демо-данных?» с «Открыть демо» и «Нет, начну своё»',
    has(offer, 'Посмотреть на демо-данных?') && has(offer, 'Открыть демо') && has(offer, 'Нет, начну своё'),
    line(offer, 'демо'),
  )
  await act(`byText('button', 'Нет, начну своё')?.click()`)
  await sleep(500)
  check('после «Нет, начну своё» предложения нет', !has(await screen(), 'Посмотреть на демо-данных?'))
  await reload()
  await sleep(1000)
  check('после перезагрузки предложение больше не показывается', !has(await screen(), 'Посмотреть на демо-данных?'))

  // ─ Незнакомый адрес — на главный.
  await go('/nowhere')
  check('незнакомый адрес открывает главный, а не пустоту', (await run('location.hash')) === '#/', await run('location.hash'))

  // ─ Настройки: шестерёнкой, разделы свёрнуты.
  await act(`document.querySelector('[aria-label="Настройки"]')?.click()`)
  await sleep(700)
  const settings = await screen()
  check(
    'настройки открываются шестерёнкой: синхронизация, машины, валюта, демо-данные, о приложении — свёрнуты',
    has(settings, 'Синхронизация') &&
      has(settings, 'Машины') &&
      has(settings, 'Валюта') &&
      has(settings, 'Демо-данные') &&
      !has(settings, 'Открыть демо') &&
      has(settings, 'О приложении') &&
      !has(settings, 'Версия схемы') &&
      !has(settings, 'Добавить машину'),
    settings.replace(/\s+/g, ' ').slice(0, 160),
  )
  check(
    'синхронизация — первым разделом',
    settings.indexOf('СИНХРОНИЗАЦИЯ') !== -1 && settings.indexOf('СИНХРОНИЗАЦИЯ') < settings.indexOf('ВАЛЮТА'),
    settings.replace(/\s+/g, ' ').slice(0, 120),
  )
  check(
    '«Импорт записей» — свёрнутым разделом между валютой и демо',
    settings.indexOf('ИМПОРТ ЗАПИСЕЙ') > settings.indexOf('ВАЛЮТА') &&
      settings.indexOf('ИМПОРТ ЗАПИСЕЙ') < settings.indexOf('ДЕМО-ДАННЫЕ') &&
      !has(settings, 'Как подготовить файл'),
    settings.replace(/\s+/g, ' ').slice(0, 200),
  )
  await unfold('Импорт записей')
  const noCars = await screen()
  check(
    'импорт без машин: «Сначала заведите машину», поля для ответа нет',
    has(noCars, 'Сначала заведите машину') && (await run(`document.querySelector('.import__text') === null`)) === true,
    line(noCars, 'Сначала'),
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
  const news = await screen()
  check('«Что нового» — первая строка о рождении приложения', has(news, 'Первая сборка «Авто»'))
  check(
    '«Что нового» — строка о машинах и журнале',
    has(news, '«Настройки» → «Машины»') && has(news, 'Журнал на главном экране'),
    line(news, 'Журнал'),
  )
  check('«Что нового» — строка об установке на Android', has(news, 'Установка на Android'), line(news, 'Android'))
  check('«Что нового» — строка о расчётах и «Итогах»', has(news, 'Блок «Итоги» над журналом'), line(news, 'Итоги'))
  check('«Что нового» — строка о демо', has(news, 'Демо: «Авто» можно посмотреть'), line(news, 'Демо:'))
  check('«Что нового» — строка об импорте', has(news, 'Импорт из Excel — «Настройки» → «Импорт записей»'), line(news, 'Импорт'))
  check('«Что нового» — строка о маршрутах', has(news, 'Маршруты — новая вкладка внизу'), line(news, 'Маршруты —'))

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
  await journalScenario()
  await routesScenario()

  // ─ Адрес запуска установленного приложения — та же «Главная»: ?app=avto
  // ничего не переключает (Р-22).
  await open(new URL(START_URL, APP).href)
  const launched = await screen()
  check(
    `по ${START_URL} — «Главная» с журналом`,
    has(launched, 'Лукойл') && has(launched, '1 запись'),
    line(launched, 'Лукойл'),
  )

  await demoScenario()

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
  check('без сети журнал на месте: заправка Лукойл', has(cached, 'Лукойл') && has(cached, '1 запись'), line(cached, 'Лукойл'))
  await open(new URL(START_URL, APP).href)
  check(
    `без сети открывается и по ${START_URL}`,
    has(await screen(), 'Лукойл') && (await run('navigator.serviceWorker.controller !== null')) === true,
    line(await screen(), 'Лукойл'),
  )
  await go('/settings')
  const offlineCurrency = await foldSummary('Валюта')
  check('без сети данные на месте: валюта та, что пришла синхронизацией', offlineCurrency === '· $', offlineCurrency)
  await offline(false)

  await importScenario()
}

/**
 * Маршруты (Авто-3, задача 6; Р-12…Р-14, Р-24): вкладка, подсказка на
 * пустой, точки с подставленным городом, маршруты с запретом одной точки,
 * пары, замер через перезагрузку и строку на «Главной», поездка вручную
 * с проверкой минут, сравнение пары, правка и удаление поездки, точки и
 * маршрута, замер дольше 12 часов и замер удалённого маршрута. Машина к
 * этому моменту одна — «Солярис 2».
 */
async function routesScenario() {
  const tap = async (label, wait = 500) => {
    await act(`byText('button', ${JSON.stringify(label)})?.click()`)
    await sleep(wait)
  }
  const value = (name) => run(`document.querySelector('[name="${name}"]')?.value ?? null`)
  const selected = (name) =>
    run(`document.querySelector('[name="${name}"]')?.selectedOptions[0]?.textContent.trim() ?? null`)
  const flat = (text) => (text ?? '').replace(/\s+/g, ' ').slice(0, 200)
  const READY = `document.querySelector('.routes .fold__btn') !== null`
  /** Заголовки пар в обзоре — через « | ». */
  const pairs = () => run(`[...document.querySelectorAll('.pair__head .car__name')].map((el) => el.textContent.trim()).join(' | ')`)
  /** Маршруты в сравнении пары — по порядку, через « | ». */
  const ranked = () =>
    run(`[...document.querySelectorAll('.routes > section.block > .fold__head .fold__btn')].map((el) => el.textContent.trim()).join(' | ')`)
  /** Блок маршрута в сравнении пары — выражение на странице. */
  const block = (name) =>
    `[...document.querySelectorAll('.routes > section.block')].find((el) => el.querySelector('.fold__btn')?.textContent.trim() === ${JSON.stringify(name)})`
  const blockText = (name) => run(`${block(name)}?.innerText ?? ''`)
  const tapIn = async (name, label, wait = 500) => {
    await act(`[...(${block(name)}?.querySelectorAll('button') ?? [])].find((el) => el.textContent.trim() === ${JSON.stringify(label)})?.click()`)
    await sleep(wait)
  }
  const openPair = async (title) => {
    await act(`[...document.querySelectorAll('.pair__head')].find((el) => el.querySelector('.car__name')?.textContent.trim() === ${JSON.stringify(title)})?.click()`)
    await sleep(600)
  }
  const openPoint = async (name) => {
    await act(`[...document.querySelectorAll('.routes .car')].find((el) => el.querySelector('.car__name')?.textContent.trim() === ${JSON.stringify(name)})?.click()`)
    await sleep(400)
  }
  const card = () => run(`document.querySelector('.timer')?.innerText ?? ''`)
  const cardButtons = () => run(`[...document.querySelectorAll('.timer button')].map((el) => el.textContent.trim()).join(', ')`)
  /** Сдвигает «Поехал» идущего замера в прошлое — мимо экрана, прямо в настройках устройства. */
  const startedAgo = (ms) =>
    run(`new Promise((done, fail) => {
      const open = indexedDB.open('avto')
      open.onsuccess = () => {
        const base = open.result
        const tx = base.transaction('settings', 'readwrite')
        const store = tx.objectStore('settings')
        const get = store.get('tripTimer')
        get.onsuccess = () => store.put({ key: 'tripTimer', value: { ...get.result.value, startedAt: Date.now() - ${ms} } })
        tx.oncomplete = () => { base.close(); done(true) }
        tx.onerror = () => fail(tx.error)
      }
    })`)
  /** Живых поездок в базе — мимо экрана. */
  const liveTrips = () =>
    run(`new Promise((done) => {
      const open = indexedDB.open('avto')
      open.onsuccess = () => {
        const all = open.result.transaction('trips').objectStore('trips').getAll()
        all.onsuccess = () => { open.result.close(); done(all.result.filter((trip) => !trip.deleted).length) }
      }
    })`)
  const MINUTE = 60_000

  // ─ Вкладка: пусто — подсказка про две точки и маршрут.
  await go('/')
  await act(`[...document.querySelectorAll('.tab')].find((el) => el.textContent.trim() === 'Маршруты')?.click()`)
  await waitFor(READY, 'вкладка «Маршруты»')
  const empty = await screen()
  check(
    'вкладка «Маршруты»: пусто — «сначала две точки, потом маршрут»',
    (await run('location.hash')) === '#/routes' && has(empty, 'Маршрутов пока нет') && has(empty, 'Сначала заведите две точки'),
    flat(empty),
  )

  // ─ Точки: имя и город обязательны; город второй — из первой.
  await tap('Добавить точку')
  await tap('Сохранить', 300)
  check('точку без имени и города не сохранить', has(await screen(), 'Впишите имя точки') && has(await screen(), 'Впишите город'))
  await act(`set(field('point-name'), 'Дом'); set(field('point-city'), 'Москва')`)
  await sleep(200)
  await tap('Сохранить', 800)
  await tap('Добавить точку')
  check('город новой точки — из последней заведённой', (await value('point-city')) === 'Москва', await value('point-city'))
  await act(`set(field('point-name'), 'Работа')`)
  await sleep(200)
  await tap('Сохранить', 800)
  check('с двумя точками подсказка зовёт завести маршрут', has(await screen(), 'Точки есть — теперь заведите маршрут'), flat(line(await screen(), 'Точки есть')))

  // ─ Маршрут: откуда и куда — из своих точек; одна точка — нельзя.
  await tap('Добавить маршрут')
  check(
    'в новом маршруте подставлены первые две точки',
    (await selected('route-from')) === 'Дом' && (await selected('route-to')) === 'Работа',
    `${await selected('route-from')} → ${await selected('route-to')}`,
  )
  await act(`choose(field('route-to'), optionByText('route-to', 'Дом')); set(field('route-name'), 'по кругу')`)
  await sleep(200)
  await tap('Сохранить', 400)
  check('«откуда» и «куда» — одна точка: понятная фраза, не сохранено', has(await screen(), '«Откуда» и «куда» — одна точка') && has(await screen(), 'Новый маршрут'))
  await act(`choose(field('route-to'), optionByText('route-to', 'Работа')); set(field('route-name'), 'по МКАД'); set(field('route-link'), 'https://yandex.ru/maps/')`)
  await sleep(200)
  await tap('Сохранить', 800)
  await tap('Добавить маршрут')
  await act(`set(field('route-name'), 'через центр')`)
  await sleep(200)
  await tap('Сохранить', 800)
  await tap('Добавить маршрут')
  await act(`choose(field('route-from'), optionByText('route-from', 'Работа')); choose(field('route-to'), optionByText('route-to', 'Дом')); set(field('route-name'), 'по МКАД')`)
  await sleep(200)
  await tap('Сохранить', 800)
  check('маршруты собраны по парам: «Дом → Работа» и «Работа → Дом» — разные', (await pairs()) === 'Дом → Работа | Работа → Дом', await pairs())
  check('у маршрута без поездок — «поездок нет», а не «0 мин»', has(await screen(), 'поездок нет') && !has(await screen(), '0 мин'), flat(line(await screen(), 'поездок')))

  // ─ Замер: «Поехал» — карточка сверху, второго «Поехал» нет.
  await act(`
    const pair = [...document.querySelectorAll('.pair')].find((el) => el.querySelector('.car__name')?.textContent.trim() === 'Дом → Работа')
    ;[...pair.querySelectorAll('.pair__route')].find((el) => el.textContent.includes('по МКАД'))?.querySelector('button')?.click()
  `)
  await sleep(600)
  check('«Поехал» — карточка замера: маршрут и минуты', has(await card(), 'Замер · Дом → Работа · по МКАД') && has(await card(), '1 мин'), flat(await card()))
  check('пока идёт замер, второго «Поехал» нет', (await act(`return byText('button', 'Поехал') === undefined`)) === true)
  check('в карточке — «Приехал», «Вписать минуты», «Выбросить»', (await cardButtons()) === 'Приехал, Вписать минуты, Выбросить', await cardButtons())

  // Перезагрузка: карточка на месте, минуты — от «Поехал».
  await startedAgo(37 * MINUTE)
  await reload(`document.querySelector('.timer') !== null`, 'карточка замера после перезагрузки')
  check('после перезагрузки карточка на месте, минуты — от «Поехал»', /3[78] мин/.test(await card()), flat(await card()))

  // На «Главной» — строка о замере со ссылкой на «Маршруты».
  await go('/')
  await waitFor(`document.querySelector('.timer-line') !== null`, 'строка о замере на «Главной»')
  const homeLine = await run(`document.querySelector('.timer-line')?.innerText ?? ''`)
  check(
    'на «Главной» — строка о замере со ссылкой',
    /Идёт замер: Дом → Работа · по МКАД, 3[78] мин в пути/.test(homeLine) && has(homeLine, 'На «Маршруты»'),
    flat(homeLine),
  )
  await act(`byText('a', 'На «Маршруты»')?.click()`)
  await waitFor(READY, 'вкладка «Маршруты» по ссылке')
  await tap('Приехал', 800)
  check('«Приехал» — карточки нет, поездка в базе', (await run(`document.querySelector('.timer') === null`)) === true && (await liveTrips()) === 1, `поездок ${await liveTrips()}`)

  // ─ Пара: поездка замером, вписанная вручную — с проверкой минут.
  await openPair('Дом → Работа')
  check('тап по паре — сравнение пары', (await run('location.hash')).startsWith('#/routes?from='), await run('location.hash'))
  check('замер: медиана с основанием, «все замером»', /3[78] мин — медиана 1 поездки/.test(await blockText('по МКАД')) && has(await blockText('по МКАД'), 'все замером'), flat(await blockText('по МКАД')))

  await tap('Вписать поездку')
  const todayInPage = await run(`(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') })()`)
  check(
    'поездка вручную: сегодня, машина — последней записи',
    (await value('trip-date')) === todayInPage && (await selected('trip-car')) === 'Солярис 2' && has(await screen(), 'Поездка вручную'),
    `${await value('trip-date')}, ${await selected('trip-car')}`,
  )
  await act(`choose(field('trip-route'), optionByText('trip-route', 'Дом → Работа · через центр')); set(field('trip-start'), '07:20'); set(field('trip-minutes'), '0')`)
  await sleep(200)
  await tap('Сохранить', 400)
  check('ноль минут — понятная фраза, поездка не сохранена', has(await screen(), 'Минуты — целое число больше нуля') && has(await screen(), 'Поездка вручную'))
  await act(`set(field('trip-minutes'), '29'); set(field('trip-note'), 'ливень')`)
  await sleep(200)
  await tap('Сохранить', 800)
  check('маршруты пары — по возрастанию медианы: «через центр» сверху', (await ranked()) === 'через центр | по МКАД', await ranked())
  const center = await blockText('через центр')
  check(
    'медиана с основанием, ручные, по часу, будни и выходные',
    has(center, '29 мин — медиана 1 поездки') &&
      has(center, 'вручную — 1 из 1') &&
      has(center, '7 ч\t29 мин\t1 поездка') &&
      has(center, 'Будни\t') &&
      has(center, 'Выходные\t') &&
      has(center, 'поездок нет'),
    flat(center),
  )

  // ─ Поездки маршрута: заметка выделена; тап — правка и удаление.
  await unfold('Поездки')
  const noted = await run(`document.querySelector('.trip--noted')?.innerText ?? ''`)
  check('поездка с заметкой выделена: дата, 07:20, 29 мин, «вручную», «ливень»', ['07:20', '29 мин', 'вручную', 'ливень'].every((part) => has(noted, part)), flat(noted))
  await act(`document.querySelector('.trip')?.click()`)
  await sleep(500)
  check('тап по поездке — форма с её минутами', (await value('trip-minutes')) === '29' && has(await screen(), 'Поездка · вручную'), await value('trip-minutes'))
  await act(`set(field('trip-minutes'), '31')`)
  await sleep(200)
  await tap('Сохранить', 800)
  check('правка поездки видна в медиане', has(await blockText('через центр'), '31 мин — медиана 1 поездки'), flat(await blockText('через центр')))
  await act(`document.querySelector('.trip')?.click()`)
  await sleep(500)
  await tap('Удалить', 300)
  check('удаление поездки спрашивает подтверждение', has(await screen(), 'Удалить поездку? Это не отменить.'))
  await tap('Удалить', 800)
  check('поездка удалена — у маршрута «поездок нет»', has(await blockText('через центр'), 'поездок нет') && (await liveTrips()) === 1, flat(await blockText('через центр')))

  // ─ Точка: новое имя — везде; в маршрутах — не удаляется.
  await tap('‹ Все маршруты')
  await unfold('Точки')
  await openPoint('Дом')
  await act(`set(field('point-name'), 'Дом 2')`)
  await sleep(200)
  await tap('Сохранить', 800)
  check('новое имя точки — во всех парах', (await pairs()) === 'Дом 2 → Работа | Работа → Дом 2', await pairs())
  await openPoint('Дом 2')
  await tap('Удалить', 300)
  check('точка в маршрутах не удаляется: «сначала удалите маршруты: 3»', has(await screen(), 'Сначала удалите маршруты: 3'), flat(line(await screen(), 'маршруты:')))
  await tap('Понятно', 200)
  await tap('Отмена', 400)

  // ─ Маршрут: новое имя, поездки остаются; удаление — вопрос с числом поездок.
  await openPair('Дом 2 → Работа')
  await tapIn('по МКАД', 'Править')
  await act(`set(field('route-name'), 'по МКАД и Ленинскому')`)
  await sleep(200)
  await tap('Сохранить', 800)
  check('новое имя маршрута, поездка на месте', (await ranked()) === 'по МКАД и Ленинскому | через центр' && has(await blockText('по МКАД и Ленинскому'), 'медиана 1 поездки'), await ranked())
  await tapIn('по МКАД и Ленинскому', 'Править')
  await tap('Удалить', 300)
  const ask = await screen()
  check('удаление маршрута: сколько поездок уйдёт, «не отменить»', has(ask, 'удалится 1 поездка') && has(ask, 'Это не отменить'), flat(line(ask, 'удалится')))
  await tap('Удалить с поездками', 800)
  check('маршрут удалён вместе с поездками', (await ranked()) === 'через центр' && (await liveTrips()) === 0, `${await ranked()}; поездок ${await liveTrips()}`)

  // ─ Замер дольше 12 часов: «Приехал» нет — вписать минуты или выбросить.
  await tapIn('через центр', 'Поехал')
  await startedAgo(13 * 60 * MINUTE)
  await reload(`document.querySelector('.timer') !== null`, 'карточка долгого замера')
  check(
    'замер дольше 12 часов: сказано прямо, «Приехал» нет',
    has(await card(), 'Замер идёт больше 12 часов') && (await cardButtons()) === 'Вписать минуты, Выбросить',
    `${flat(await card())}; ${await cardButtons()}`,
  )
  await tap('Вписать минуты', 300)
  await act(`set(field('timer-minutes'), 'долго')`)
  await sleep(200)
  await tap('Сохранить', 400)
  check('вписанные минуты — текстом: понятная фраза, не сохранено', has(await card(), 'Минуты — целое число больше нуля') && (await liveTrips()) === 0, flat(await card()))
  await tap('Отмена', 300)
  await tap('Выбросить', 600)
  check('«Выбросить» — карточки нет, поездки нет', (await run(`document.querySelector('.timer') === null`)) === true && (await liveTrips()) === 0)

  // ─ Маршрут замера удалён — карточка говорит об этом, остаётся «Выбросить».
  await tapIn('через центр', 'Поехал')
  await tapIn('через центр', 'Править')
  await tap('Удалить', 300)
  await tap('Удалить', 800)
  check(
    'маршрут замера удалён: «Маршрут удалён», только «Выбросить»',
    has(await card(), 'Маршрут удалён') && (await cardButtons()) === 'Выбросить' && has(await screen(), 'У этой пары точек маршрутов нет'),
    `${flat(await card())}; ${await cardButtons()}`,
  )
  await tap('Выбросить', 600)
  await tap('‹ Все маршруты')
  check('замера нет, в обзоре осталась пара «Работа → Дом 2»', (await run(`document.querySelector('.timer') === null`)) === true && (await pairs()) === 'Работа → Дом 2', await pairs())
}

/**
 * Импорт Excel через ИИ (Авто-3, задача 5; Р-10): машина выбрана, не JSON —
 * отказ, ответ ИИ — сводка без записи в базу, «Загрузить» — записи в журнале
 * со строками заправок и «Итогами», тот же ответ ещё раз — всё пропущено.
 * Записи — прошлого года: тогда они раньше сегодняшней заправки сценария
 * в любой день года. Машина к этому моменту одна — «Солярис 2», валюта «$».
 */
async function importScenario() {
  const tap = async (label, wait = 500) => {
    await act(`byText('button', ${JSON.stringify(label)})?.click()`)
    await sleep(wait)
  }
  /** Экран с обычными пробелами: разряды чисел разделены неразрывными. */
  const plain = async () => (await screen()).replace(/[  ]/g, ' ')
  const flat = (text) => (text ?? '').replace(/\s+/g, ' ').slice(0, 200)
  const rows = () =>
    run(`[...document.querySelectorAll('.entry')].map((el) => el.innerText.replace(/\\s+/g, ' ').trim()).join(' | ')`)
  /** Сколько записей журнала в базе — мимо экрана. */
  const inBase = () =>
    run(`new Promise((done) => {
      const open = indexedDB.open('avto')
      open.onsuccess = () => {
        const count = open.result.transaction('entries').objectStore('entries').count()
        count.onsuccess = () => { open.result.close(); done(count.result) }
      }
    })`)
  const paste = async (text) => {
    await act(`set(document.querySelector('.import__text'), ${JSON.stringify(text)})`)
    await sleep(200)
    await tap('Разобрать', 1200)
  }

  const year = (await run('new Date().getFullYear()')) - 1
  const answer = [
    'Вот JSON:',
    '```json',
    JSON.stringify({
      format: 'avto-import',
      version: 1,
      fuel: [
        { date: `${year}-03-01`, amount: 2000, liters: 40, price: 50, station: 'Лукойл', odometer: 5000, tankBefore: 0.25, tankAfter: '100 %' },
        { date: `${year}-03-15`, amount: 2000, liters: 40, price: 52.5, station: 'Газпром', odometer: 5600 },
      ],
      wash: [{ date: `${year}-03-20`, amount: 500 }],
      repair: [{ date: `${year}-04-02`, amount: 7000, what: 'замена колодок', service: 'Сервис', odometer: 6100 }],
      fine: [{ date: `${year}-04-10`, amount: 500, violation: 'превышение' }, { amount: 800, violation: 'парковка' }],
    }),
    '```',
    'Не разобрал: штраф без даты.',
  ].join('\n')

  await go('/settings')
  await unfold('Импорт записей')
  const block = await screen()
  check(
    'импорт: машина выбрана — «Солярис 2», есть поле для ответа и промпт',
    (await run(`document.querySelector('[name="import-car"]')?.selectedOptions[0]?.textContent.trim() ?? ''`)) === 'Солярис 2' &&
      (await run(`document.querySelector('.import__text') !== null`)) === true &&
      has(block, 'Как подготовить файл') &&
      has(block, 'остальные получат записи синхронизацией'),
    flat(line(block, 'машине')),
  )
  await unfold('Как подготовить файл')
  await unfold('Показать промпт')
  const prompt = await run(`document.querySelector('.prompt')?.textContent ?? ''`)
  check(
    'промпт: формат avto-import, листы «Заправки» и «Штрафы», «Заполняемость полоски бака»',
    has(prompt, '"format": "avto-import"') && has(prompt, 'лист «Заправки»') && has(prompt, 'лист «Штрафы»') && has(prompt, 'Заполняемость полоски бака до'),
    flat(prompt),
  )

  const before = await inBase()
  await paste('это не json')
  check('не JSON — понятный отказ, база не тронута', has(await screen(), 'Это не JSON') && (await inBase()) === before, line(await screen(), 'JSON'))
  await tap('Закрыть', 300)

  await paste(answer)
  const summary = await plain()
  check(
    'сводка: 2 заправки, 1 мойка, 1 ремонт, 1 штраф',
    has(summary, 'Добавится: 2 заправки, 1 мойка, 1 ремонт, 1 штраф.'),
    flat(line(summary, 'Добавится')),
  )
  check(
    'сводка: штраф без даты — не разобран; три несходящихся числа — заметка',
    has(summary, 'Не разобрано — в базу не попадёт: 1') && has(summary, 'Штраф 2: нет даты') && has(summary, 'больше чем на 1 %'),
    flat(line(summary, 'разобрано')),
  )
  check('до кнопки база не тронута', (await inBase()) === before, `записей ${await inBase()} из ${before}`)

  await tap('Загрузить 5', 1500)
  check('«Загрузить» — 5 записей в базе', has(await screen(), 'Загружено записей: 5') && (await inBase()) === before + 5, `записей ${await inBase()}`)

  // Тот же ответ ещё раз — ничего не добавится.
  await paste(answer)
  const again = await plain()
  check(
    'тот же ответ ещё раз: «Добавлять нечего», пропущено 5',
    has(again, 'Добавлять нечего') && has(again, 'Уже есть — пропущено, не перезаписано: 5'),
    flat(line(again, 'пропущено')),
  )
  await tap('Отмена', 300)

  // ─ Журнал: прошлый год по всем машинам.
  await go('/')
  await waitFor(HOME_READY, 'журнал после импорта')
  await act(`choose(field('filter-car'), ''); choose(field('filter-kind'), '')`)
  await sleep(300)
  await tap('Год', 400)
  await act(`document.querySelector('[aria-label="Назад"]')?.click()`)
  await sleep(500)
  const journal = (await rows()).replace(/[  ]/g, ' ')
  check(
    'в журнале — импортированные записи: заправка Газпром с «+600 км с прошлой · цена +5 %»',
    has(journal, '+600 км с прошлой · цена +5 %') && has(journal, 'Газпром') && has(journal, 'замена колодок'),
    flat(journal),
  )
  check('штраф с «Уплачено» — без «не оплачен»', has(journal, 'превышение') && !has(journal, 'не оплачен'), flat(journal))
  const totals = await plain()
  check(
    '«Итоги» за год: цена километра и траты по всем четырём видам',
    /всё [\d ,]+ \$\/км/.test(totals) &&
      ['Заправка\t2 записи', 'Мойка\t1 запись', 'Ремонт\t1 запись', 'Штраф\t1 запись'].every((each) => has(totals, each)),
    flat(line(totals, '/км')),
  )
}

/**
 * Машины и журнал (Авто-3, задача 2): завести машину, заправка двумя числами
 * с третьим посчитанным, правка, удаление с подтверждением, отбор по виду и
 * периоду, главная машина, архив и удаление машины. Валюта к этому моменту —
 * «$», приехавшая синхронизацией.
 */
async function journalScenario() {
  const tap = async (label, wait = 500) => {
    await act(`byText('button', ${JSON.stringify(label)})?.click()`)
    await sleep(wait)
  }
  const value = (name) => run(`document.querySelector('[name="${name}"]')?.value ?? null`)
  const selected = (name) =>
    run(`document.querySelector('[name="${name}"]')?.selectedOptions[0]?.textContent.trim() ?? null`)
  const pressed = (group) =>
    run(`document.querySelector('[aria-label="${group}"] [aria-pressed="true"]')?.textContent.trim() ?? null`)
  const flat = (text) => (text ?? '').replace(/\s+/g, ' ').slice(0, 200)
  /** Итог у заголовка — с обычными пробелами вместо неразрывных между разрядами. */
  const summary = async (title) => (await foldSummary(title)).replace(/[  ]/g, ' ')
  /** Названия машин в «Итогах» — по строке на машину, через « | ». */
  const totalsCars = () =>
    run(`[...document.querySelectorAll('.totals__car .car__name')].map((el) => el.textContent.trim()).join(' | ')`)
  /** Записи журнала на экране — по строке на запись, через « | ». */
  const rows = () =>
    run(`[...document.querySelectorAll('.entry')].map((el) => el.innerText.replace(/\\s+/g, ' ').trim()).join(' | ')`)

  // ─ «Завести машину» ведёт в «Настройки», блок «Машины» раскрыт.
  await go('/')
  await act(`byText('a', 'Завести машину')?.click()`)
  await sleep(800)
  const hash = await run('location.hash')
  check('«Завести машину» ведёт в «Настройки» к «Машинам», блок раскрыт', hash === '#/settings?block=cars' && has(await screen(), 'Добавить машину'), hash)

  // ─ Машина: название и топливо подсказкой.
  await tap('Добавить машину')
  await act(`set(field('car-name'), 'Солярис')`)
  await sleep(100)
  const hints = await run(`[...document.querySelectorAll('[aria-label="Подсказки топлива машины"] button')].map((el) => el.textContent.trim()).join(' ')`)
  check('подсказки топлива машины — 95 92 ДТ газ', hints === '95 92 ДТ газ', hints)
  await tap('95', 200)
  await tap('Сохранить', 800)
  let cars = await screen()
  check('машина заведена и видна в списке с топливом', has(cars, 'Солярис') && has(cars, '95') && (await foldSummary('Машины')) === '· 1', flat(line(cars, 'Солярис')))
  check('при одной машине выбора главной нет', (await act(`return field('main-car') === null`)) === true)

  // Вторая — своё топливо строкой, а не подсказкой.
  await tap('Добавить машину')
  await act(`set(field('car-name'), 'Мамина'); set(field('car-fuel'), '98')`)
  await sleep(200)
  await tap('Сохранить', 800)
  cars = await screen()
  check('своё топливо «98» вписывается строкой', has(cars, 'Мамина') && has(cars, '98'), flat(line(cars, 'Мамина')))
  check('при двух машинах можно отметить главную', (await act(`return field('main-car') !== null`)) === true)
  await act(`choose(field('main-car'), optionByText('main-car', 'Мамина'))`)
  await sleep(500)

  // ─ «Главная»: машины есть, записей нет.
  await go('/')
  const empty = await screen()
  check('с машиной на главной «Записей пока нет» и «Добавить запись»', has(empty, 'Записей пока нет') && has(empty, 'Добавить запись'), flat(empty))

  // ─ Новая запись: главная машина, сегодня, заправка, топливо машины.
  await tap('Добавить запись')
  const todayInPage = await run(`(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') })()`)
  const form = { car: await selected('car'), date: await value('date'), kind: await pressed('Вид записи'), fuel: await value('fuel') }
  check(
    'в новой записи — главная машина, сегодня, заправка, топливо машины',
    form.car === 'Мамина' && form.date === todayInPage && form.kind === 'Заправка' && form.fuel === '98',
    JSON.stringify(form),
  )

  // Смена машины меняет подставленное топливо.
  await act(`choose(field('car'), optionByText('car', 'Солярис'))`)
  await sleep(300)
  check('смена машины подставляет её топливо', (await value('fuel')) === '95', await value('fuel'))

  // Сохранить без чисел нельзя — видно, чего не хватает.
  await tap('Сохранить')
  const short = await screen()
  check('заправку без чисел не сохранить: «два числа из трёх»', has(short, 'Нужны два числа из трёх') && has(short, 'Новая запись'), flat(line(short, 'два числа')))

  // Литры и цена с запятой — сумма считается.
  await act(`set(field('liters'), '40'); set(field('price'), '55,5'); set(field('station'), 'Лукойл')`)
  await sleep(300)
  check('видно, что сумма посчитается: 2 220 $', has(await screen(), 'Сумма посчитается: 2 220 $'), line(await screen(), 'посчита'))
  await tap('Сохранить', 800)
  let journal = await rows()
  const dateShown = todayInPage.split('-').reverse().join('.')
  check(
    'заправка в журнале: дата, машина, вид, сумма в валюте настроек, литры, цена и АЗС',
    has(journal, `${dateShown} · Заправка`) && has(journal, '2 220 $') && has(journal, 'Солярис · 40 л по 55,50 $/л · Лукойл'),
    journal,
  )
  check('первая заправка — ни км с прошлой, ни роста цены', !has(journal, 'с прошлой') && !has(journal, 'цена '), journal)

  // ─ «Итоги» (Р-23): развёрнуты, сумма у заголовка; пробега нет — «мало данных».
  let totals = await screen()
  check('«Итоги» над журналом, у заголовка — сумма за период', (await summary('Итоги')) === '· 2 220 $', await summary('Итоги'))
  check(
    'без одометра цена километра — «мало данных» с основанием «по 0 записям из 1»',
    has(totals, 'мало данных') && has(totals, 'по 0 записям из 1'),
    flat(line(totals, 'записям')),
  )
  check(
    'АЗС подешевле: за последние 6 месяцев, Лукойл 55,50 $/л — сравнить не с чем',
    has(totals, 'за последние 6 месяцев') && has(line(totals, 'Лукойл'), 'сравнить не с чем') && has(line(totals, 'Лукойл'), '55,50 $/л'),
    flat(line(totals, 'Лукойл')),
  )

  // ─ Правка: тап по записи — та же форма; три несходящихся числа — предупреждение.
  await act(`document.querySelector('.entry')?.click()`)
  await sleep(500)
  check('тап по записи открывает форму с её числами', (await value('amount')) === '2220' && (await value('price')) === '55,5', await value('amount'))
  await act(`set(field('amount'), '2000'); set(field('odometer'), '10000')`)
  await sleep(300)
  check('три числа не сходятся — предупреждение', has(await screen(), 'расходится больше чем на 1 %'), line(await screen(), 'расходится'))
  await tap('Сохранить', 800)
  journal = await rows()
  check('правка видна в журнале, сумма — как введена', has(journal, '2 000 $') && !has(journal, '2 220 $'), journal)

  // ─ Мойка: без суммы не сохранить; с суммой — в журнале.
  await tap('Добавить запись')
  check('новая запись — машина главная, а не последней записи', (await selected('car')) === 'Мамина', await selected('car'))
  await tap('Мойка', 300)
  const washForm = await screen()
  check(
    'у мойки поля — сумма и пробег, без литров',
    (await act(`return field('liters') === null && field('amount') !== null && field('odometer') !== null`)) === true,
    flat(washForm),
  )
  await tap('Сохранить')
  check('мойку без суммы не сохранить', has(await screen(), 'Укажите сумму'))
  await act(`set(field('amount'), '500')`)
  await sleep(200)
  await tap('Сохранить', 800)
  journal = await rows()
  check('мойка в журнале, всего две записи', has(journal, 'Мойка') && has(await screen(), '2 записи'), journal)

  // ─ Отбор по виду и по периоду.
  await act(`choose(field('filter-kind'), 'wash')`)
  await sleep(400)
  journal = await rows()
  check(
    'отбор по виду: только мойка, «показано 1 из 2»',
    has(await screen(), 'показано 1 из 2') && has(journal, 'Мойка') && !has(journal, 'Заправка'),
    journal,
  )
  totals = await screen()
  check(
    'вид на «Итоги» не действует: сказано в подписи, сумма — обе записи, траты по обоим видам',
    has(totals, 'отбор вида на итоги не действует') &&
      (await summary('Итоги')) === '· 2 500 $' &&
      has(totals, 'Заправка\t1 запись\t2 000 $') &&
      has(totals, 'Мойка\t1 запись\t500 $'),
    `${await summary('Итоги')}; ${flat(line(totals, 'Итого'))}`,
  )
  check(
    '«Все машины» — цена километра строкой на каждую машину с записями',
    (await totalsCars()) === 'Солярис | Мамина',
    await totalsCars(),
  )
  await act(`choose(field('filter-kind'), '')`)
  await tap('Месяц', 400)
  const monthTitle = await run(`document.querySelector('.period__title')?.textContent ?? ''`)
  check('месяц — сначала текущий', has(await screen(), '2 записи') && /\d{4}$/.test(monthTitle), monthTitle)
  await act(`document.querySelector('[aria-label="Назад"]')?.click()`)
  await sleep(400)
  journal = await screen()
  check(
    'прошлый месяц пуст: «За этот период записей нет» и сколько за всё время',
    has(journal, 'За этот период записей нет') && has(journal, 'За всё время — 2 записи'),
    flat(line(journal, 'период')),
  )
  check(
    '«Итоги» пустого месяца: «За период записей нет», у заголовка 0 $',
    has(journal, 'За период записей нет') && (await summary('Итоги')) === '· 0 $',
    `${await summary('Итоги')}; ${flat(line(journal, 'За период'))}`,
  )
  await tap('Всё', 400)

  // ─ Удаление записи — с подтверждением.
  await act(`[...document.querySelectorAll('.entry')].find((el) => el.textContent.includes('Мойка'))?.click()`)
  await sleep(500)
  await tap('Удалить', 300)
  check('удаление записи спрашивает подтверждение', has(await screen(), 'Удалить запись? Это не отменить.'))
  await tap('Удалить', 800)
  journal = await rows()
  check('запись удалена, осталась одна', has(await screen(), '1 запись') && !has(journal, 'Мойка'), journal)

  // ─ Машины: переименование, архив, удаление.
  await go('/settings')
  await unfold('Машины')
  await act(`[...document.querySelectorAll('.car')].find((el) => el.textContent.includes('Солярис'))?.click()`)
  await sleep(400)
  await act(`set(field('car-name'), 'Солярис 2')`)
  await sleep(200)
  await tap('Сохранить', 800)

  // Удаление машины с записью: подтверждение называет записи и предлагает архив.
  await act(`[...document.querySelectorAll('.car')].find((el) => el.textContent.includes('Солярис 2'))?.click()`)
  await sleep(400)
  await tap('Удалить', 400)
  const ask = await screen()
  check(
    'удаление машины с записями: сколько удалится, «не отменить», архив вместо',
    has(ask, 'удалится 1 запись журнала') && has(ask, 'Это не отменить') && has(ask, 'В архив') && has(ask, 'Удалить с записями'),
    flat(line(ask, 'удалит')),
  )
  await tap('В архив', 800)
  check('машина в архиве', has(await screen(), 'Солярис 2 · в архиве'), flat(line(await screen(), 'Солярис')))

  // Главная (Мамина) без записей — удаляется с простым подтверждением.
  await act(`[...document.querySelectorAll('.car')].find((el) => el.textContent.includes('Мамина'))?.click()`)
  await sleep(400)
  await tap('Удалить', 400)
  check('удаление машины без записей спрашивает подтверждение', has(await screen(), 'Удалить «Мамина»?'), flat(line(await screen(), 'Мамина')))
  await tap('Удалить', 800)
  check('машины без записей нет', !has(await screen(), 'Мамина'))

  // На главной: запись архивной машины на месте, с новым названием; машин для записи нет.
  await go('/')
  journal = await rows()
  check(
    'запись архивной машины в журнале, название — новое',
    has(journal, 'Солярис 2 · 40 л') && has(await screen(), 'Все машины в архиве'),
    journal,
  )

  // Вернуть из архива — машина снова в выборе новой записи.
  await go('/settings')
  await act(`[...document.querySelectorAll('.car')].find((el) => el.textContent.includes('Солярис 2'))?.click()`)
  await sleep(400)
  await tap('Вернуть из архива', 800)
  check('машина вернулась из архива', has(await screen(), 'Солярис 2') && !has(await screen(), 'в архиве'))
  await go('/')
  await tap('Добавить запись')
  check('главная удалена — подставлена машина последней записи', (await selected('car')) === 'Солярис 2', await selected('car'))

  // ─ Вторая заправка с одометром и ценой: в строке — км с прошлой и рост цены,
  // в «Итогах» — цена километра и АЗС по возрастанию цены (Р-23).
  await act(`set(field('liters'), '50'); set(field('price'), '56,61'); set(field('station'), 'Газпром'); set(field('odometer'), '10600')`)
  await sleep(300)
  await tap('Сохранить', 800)
  journal = await rows()
  check('в строке заправки: «+600 км с прошлой · цена +2 %»', has(journal, '+600 км с прошлой · цена +2 %'), journal)
  totals = await screen()
  check(
    'цена километра «топливо» и «всё» с основанием: 8,05 $/км, пробег 600 км по 2 записям из 2',
    has(totals, 'топливо 8,05 $/км · всё 8,05 $/км') && has(totals, 'пробег 600 км, по 2 записям из 2'),
    flat(line(totals, '/км')),
  )
  const stationsOrder = await run(
    `[...document.querySelectorAll('.stats tr')].map((el) => el.cells[0]?.textContent.trim()).filter((name) => name === 'Лукойл' || name === 'Газпром').join(' < ')`,
  )
  check('АЗС подешевле — по возрастанию средней цены: Лукойл 50 $/л дешевле Газпрома', stationsOrder === 'Лукойл < Газпром', stationsOrder)

  // Удаление пересчитывает сразу: строки и «Итоги» снова про одну заправку.
  await act(`[...document.querySelectorAll('.entry')].find((el) => el.textContent.includes('Газпром'))?.click()`)
  await sleep(500)
  await tap('Удалить', 300)
  await tap('Удалить', 800)
  totals = await screen()
  check(
    'после удаления — одна запись, «Итоги» снова «мало данных»',
    has(totals, '1 запись') && !has(totals, 'Газпром') && has(totals, 'мало данных'),
    flat(line(totals, 'записям')),
  )
}

/**
 * Демо (Авто-3, задача 4; Я-44, Я-45 «FamilyCore»): вход из «Настроек» —
 * полоса «Демо», две машины и год журнала, «Итоги» с основанием, строки
 * заправок, АЗС, штрафы; выход — свои записи на месте. Вход и выход
 * спрашивают окном браузера — прогон отвечает «да».
 */
async function demoScenario() {
  const tap = async (label, wait = 500) => {
    await act(`byText('button', ${JSON.stringify(label)})?.click()`)
    await sleep(wait)
  }
  /** Экран с обычными пробелами: разряды чисел разделены неразрывными. */
  const plain = async () => (await screen()).replace(/[  ]/g, ' ')
  const flat = (text) => (text ?? '').replace(/\s+/g, ' ').slice(0, 200)
  const rows = () =>
    run(`[...document.querySelectorAll('.entry')].map((el) => el.innerText.replace(/\\s+/g, ' ').trim()).join(' | ')`)
  const accept = () => run('window.confirm = () => true')
  const databases = () => run(`indexedDB.databases().then((list) => list.map((each) => each.name).sort().join(', '))`)

  // ─ Вход из «Настроек».
  await go('/settings')
  await unfold('Демо-данные')
  await accept()
  await markOld()
  await tap('Открыть демо', 0)
  await loaded(`document.querySelector('.demo-bar') !== null`, 'демо после входа')
  await go('/')
  await waitFor(HOME_READY, 'журнал демо')
  await sleep(500)

  const home = await plain()
  check('в демо сверху полоса «Демо»', has(home, 'Демо: данные выдуманные'), flat(home))
  check('демо — в своей базе avto-demo', (await databases()) === 'avto, avto-demo, family', await databases())
  const carNames = await act(`return [...field('filter-car').options].map((option) => option.textContent.trim()).join(', ')`)
  check('в журнале демо две машины', carNames === 'Все машины, Солярис, Нива', carNames)
  const todayShown = await run(
    `(() => { const d = new Date(); return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear() })()`,
  )
  const top = await run(`document.querySelector('.entry .entry__top span')?.textContent.trim() ?? ''`)
  check('последняя запись демо — сегодня', top.startsWith(todayShown), top)

  // ─ Каждодневная за текущий месяц: цена километра с основанием, расход, траты.
  await act(`choose(field('filter-car'), optionByText('filter-car', 'Солярис'))`)
  await sleep(300)
  await tap('Месяц', 400)
  let totals = await plain()
  check(
    'каждодневная, месяц: «топливо» и «всё» в ₽/км, «пробег … км, по N записям из M»',
    /топливо [\d ,]+ ₽\/км · всё [\d ,]+ ₽\/км/.test(totals) && /пробег [\d ]+ км, по \d+ запис\S* из \d+/.test(totals),
    flat(line(totals, '/км')),
  )
  check('каждодневная, месяц: средний расход по заправкам', /Средний расход [\d,]+ л\/100 км по \d+ заправк/.test(totals), flat(line(totals, 'расход')))
  check('каждодневная, месяц: траты по видам', has(totals, 'Траты по видам') && has(totals, 'Итого'), flat(line(totals, 'Итого')))

  // ─ Редкая за всё время: расхода нет, цена километра есть.
  await act(`choose(field('filter-car'), optionByText('filter-car', 'Нива'))`)
  await sleep(300)
  await tap('Всё', 400)
  totals = await plain()
  check(
    'редкая: средней строки расхода нет, цена километра считается',
    !has(totals, 'Средний расход') && /всё [\d ,]+ ₽\/км/.test(totals),
    flat(line(totals, '/км')),
  )

  // ─ Год по всем машинам: траты по всем видам, у кого-то запись без пробега.
  // В первые полтора месяца года демо почти всё в прошлом году — смотрим его.
  await act(`choose(field('filter-car'), '')`)
  await sleep(300)
  await tap('Год', 400)
  const early = await run(`(() => { const d = new Date(); return (d - new Date(d.getFullYear(), 0, 1)) / 86400000 < 45 })()`)
  if (early) await act(`document.querySelector('[aria-label="Назад"]')?.click()`)
  await sleep(400)
  totals = await plain()
  check(
    'год: в тратах заправки, мойки, ремонты и штрафы',
    ['Заправка\t', 'Мойка\t', 'Ремонт\t', 'Штраф\t'].every((kind) => has(totals, kind)),
    flat(line(totals, 'Итого')),
  )
  const bases = [...totals.matchAll(/по (\d+) запис\S* из (\d+)/g)].map((match) => [Number(match[1]), Number(match[2])])
  check('год: у машины основание «по N из M» с N меньше M', bases.some(([n, m]) => n < m), JSON.stringify(bases))

  // ─ Строки заправок и АЗС подешевле — за всё время.
  await tap('Всё', 400)
  const journal = (await rows()).replace(/[  ]/g, ' ')
  check(
    'в строках заправок — «+N км с прошлой», цена растёт, бывает без изменений',
    /\+[\d ]+ км с прошлой/.test(journal) && /цена \+[\d,]+ %/.test(journal) && has(journal, 'цена без изменений'),
    flat(journal),
  )
  const stations = await run(
    `[...document.querySelectorAll('.stats tr')].filter((row) => ['Лукойл', 'Газпром', 'Татнефть'].includes(row.cells[0]?.textContent.trim())).map((row) => row.cells[0].textContent.trim() + ' ' + row.cells[2]?.textContent.trim())`,
  )
  const prices = new Set((stations ?? []).map((each) => each.split(' ').slice(1).join(' ')))
  check('АЗС подешевле — три АЗС с разной средней ценой', stations?.length === 3 && prices.size === 3, (stations ?? []).join('; '))

  // ─ Штрафы: один не оплачен, у другого — дата оплаты.
  await act(`choose(field('filter-kind'), 'fine')`)
  await sleep(400)
  const fines = (await rows()).split(' | ')
  check(
    'штрафов два: один «не оплачен», другой — нет',
    fines.length === 2 && fines.filter((each) => has(each, 'не оплачен')).length === 1,
    fines.join(' | '),
  )
  await act(`[...document.querySelectorAll('.entry')].find((el) => !el.textContent.includes('не оплачен'))?.click()`)
  await sleep(500)
  const paid = await act(`return field('paid')?.checked === true && /^\\d{4}-\\d{2}-\\d{2}$/.test(field('paidDate')?.value ?? '')`)
  check('оплаченный штраф отмечен и с датой оплаты', paid === true, String(paid))
  await tap('Отмена', 400)

  // ─ Маршруты демо: пары, на «Дом → Работа» два маршрута с медианами и разбивками.
  await go('/routes')
  await waitFor(`document.querySelector('.routes .fold__btn') !== null`, 'маршруты демо')
  const demoPairs = await run(`[...document.querySelectorAll('.pair__head .car__name')].map((el) => el.textContent.trim()).join(' | ')`)
  check('в демо — три пары точек', demoPairs === 'Дом → Работа | Дом → ТЦ Мега | Работа → Дом', demoPairs)
  check('в демо у маршрутов — медиана с основанием', /\d+ мин — медиана \d+ поезд/.test(await screen()), flat(line(await screen(), 'медиана')))
  await act(`[...document.querySelectorAll('.pair__head')].find((el) => el.textContent.includes('Дом → Работа'))?.click()`)
  await sleep(600)
  const demoRanked = await run(
    `[...document.querySelectorAll('.routes > section.block > .fold__head .fold__btn')].map((el) => el.textContent.trim()).join(' | ')`,
  )
  const demoPair = await screen()
  check(
    'в демо «Дом → Работа»: два маршрута, по часу выезда, будни и выходные',
    demoRanked.split(' | ').length === 2 && has(demoPair, 'По часу выезда') && has(demoPair, 'Будни и выходные') && has(demoPair, 'вручную — '),
    demoRanked,
  )
  await unfold('Поездки')
  check('в демо поездки с заметкой выделены', (await run(`document.querySelectorAll('.trip--noted').length`)) > 0)

  // ─ Импорта в демо нет (Я-44 «FamilyCore»): ни поля, ни выбора машины.
  await go('/settings')
  await unfold('Импорт записей')
  check(
    'в демо импорта нет: «В демо импорта нет», поля для ответа нет',
    has(await screen(), 'В демо импорта нет') && (await run(`document.querySelector('.import__text') === null`)) === true,
    line(await screen(), 'импорт'),
  )

  // ─ Выход: свои записи на месте, полосы нет, демо-база стёрта.
  await unfold('Демо-данные')
  await accept()
  await markOld()
  await tap('Выйти из демо', 0)
  await loaded(`document.querySelector('.demo-bar') === null && document.querySelector('.fold__btn') !== null`, 'выход из демо')
  await go('/')
  await waitFor(HOME_READY, 'журнал после выхода из демо')
  await sleep(500)
  const back = await screen()
  check(
    'после выхода — свои данные: заправка Лукойл, одна запись, полосы «Демо» нет',
    has(back, 'Лукойл') && has(back, '1 запись') && !has(back, 'Демо: данные выдуманные'),
    flat(back),
  )
  check('после выхода демо-база стёрта', (await databases()) === 'avto, family', await databases())
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
