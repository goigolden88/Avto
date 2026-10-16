import { useCallback, useEffect, useState } from 'react'
import { config } from '../app/config.ts'
import { db } from '../app/core.ts'
import { RECORD_STORES, SCHEMA_VERSION, SYNCED_STORES, type Prefs, type SyncedStore } from '../app/model.ts'
import { CHANGES } from '../changes.ts'
import { CURRENCY_HINTS, CURRENCY_MAX, DEFAULT_CURRENCY, readCurrency, withCurrency } from '../modules/prefs/prefs.ts'
import { formatDate, nowIso } from '../shared/core/dates.ts'
import { Fold } from '../shared/ui/Fold.tsx'
import { InstallNote } from '../shared/ui/Install.tsx'
import { ReportBug } from '../shared/ui/Report.tsx'
import { SyncSettings } from '../shared/ui/SyncSettings.tsx'
import { isEmptyBase } from '../shared/screens/firstRun.ts'
import { ChangeList } from '../shared/screens/WhatsNew.tsx'

const LABELS: Record<SyncedStore, string> = {
  cars: 'Машины',
  entries: 'Записи журнала',
  points: 'Точки маршрутов',
  routes: 'Маршруты',
  trips: 'Поездки',
  parkings: 'Места парковки',
  parkingVisits: 'Наблюдения парковок',
  prefs: 'Общие настройки',
}

type Row = { store: SyncedStore; live: number; total: number }

type State = { status: 'loading' } | { status: 'ready'; rows: Row[] } | { status: 'failed'; message: string }

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'Неизвестная ошибка'
}

/**
 * Настройки разделами, свёрнутыми: в них заходят за чем-то одним, и экран
 * читается как оглавление. Устройство — «Трапезы» и «Злотых».
 *
 * Разделов три: «Синхронизация» — первой, «Валюта» (Р-17) и «О приложении».
 * Копия файлом, импорт, демо придут своими задачами Авто-3.
 */
export function Settings() {
  const [state, setState] = useState<State>({ status: 'loading' })

  const load = useCallback(async () => {
    try {
      await db.ready()
      const rows: Row[] = []
      for (const store of SYNCED_STORES) {
        rows.push({ store, live: await db.count(store), total: await db.count(store, { includeDeleted: true }) })
      }
      setState({ status: 'ready', rows })
    } catch (error) {
      setState({ status: 'failed', message: describe(error) })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <>
      <header className="screen-head">
        <h1>Настройки</h1>
      </header>

      <SyncSettings onChanged={load} />

      <CurrencySettings />

      <About state={state} />
    </>
  )
}

// ─── Валюта (Р-17) ─────────────────────────────────────────────────────────

/**
 * Валюта — свободная строка с подсказками. Не настройка устройства, а
 * синхронизируемая запись `prefs:main`: её видит второе устройство.
 * Сохраняется кнопкой подсказки сразу, а набранная руками — по «Сохранить»
 * или уходу из поля.
 */
function CurrencySettings() {
  // null — запись ещё читается: поле не мигает умолчанием.
  const [records, setRecords] = useState<Prefs[] | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    const load = () =>
      void db
        .getAll('prefs')
        .then((list) => {
          if (!alive) return
          setRecords(list)
          setDraft(readCurrency(list))
        })
        .catch((failure) => alive && setError(describe(failure)))
    load()
    // Правка с другого устройства приходит синхронизацией — поле за ней.
    const off = db.onChange((event) => {
      if (event.store === 'prefs') load()
    })
    return () => {
      alive = false
      off()
    }
  }, [])

  const currency = records === null ? null : readCurrency(records)

  async function save(input: string) {
    if (records === null) return
    const next = withCurrency(records, input, nowIso())
    if (next === null) {
      // Пустое или слишком длинное — вернуть то, что стоит.
      if (currency !== null) setDraft(currency)
      return
    }
    setError('')
    try {
      await db.put('prefs', next)
    } catch (failure) {
      setError(describe(failure))
    }
  }

  return (
    <Fold id="settings:currency" title="Валюта" summary={currency ?? undefined} folded>
      {currency !== null && (
        <>
          <p className="muted">
            В ней пишутся суммы журнала и цена километра. Общая для всех устройств; по умолчанию —{' '}
            {DEFAULT_CURRENCY}. Суммы при смене не пересчитываются — меняется только подпись.
          </p>
          <div className="row row--wrap" role="group" aria-label="Подсказки валюты">
            {CURRENCY_HINTS.map((hint) => (
              <button
                key={hint}
                type="button"
                className={hint === currency ? 'btn btn--primary' : 'btn'}
                aria-pressed={hint === currency}
                onClick={() => {
                  setDraft(hint)
                  void save(hint)
                }}
              >
                {hint}
              </button>
            ))}
          </div>
          <div className="row">
            <label className="field">
              <span>Своя</span>
              <input
                name="currency"
                value={draft}
                maxLength={CURRENCY_MAX}
                autoComplete="off"
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => void save(draft)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void save(draft)
                }}
              />
            </label>
            <button type="button" className="btn" disabled={draft.trim() === currency} onClick={() => void save(draft)}>
              Сохранить
            </button>
          </div>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </Fold>
  )
}

// ─── О приложении ──────────────────────────────────────────────────────────

/**
 * Версия, сборка и что лежит в базе. Сюда смотрят, когда что-то не так,
 * и когда проверяют, доехало ли обновление.
 */
function About({ state }: { state: State }) {
  const last = CHANGES.at(-1)

  // Дата сборки — в итоге у заголовка: по ней проверяют, доехало ли
  // обновление, и разворачивать ради этого раздел незачем.
  const built = new Date(__BUILD_TIME__)
  const short = built.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

  return (
    <Fold id="settings:about" title="О приложении" summary={`сборка ${short}`} folded>
      <p className="muted">
        {config.name}: {config.about.data}. Всё хранится на этом устройстве и работает без сети.
      </p>

      <Fold id="settings:about:stores" title="Что где лежит" summary={`схема ${SCHEMA_VERSION}`} sub folded>
        {state.status === 'loading' && <p className="muted">Открываю базу…</p>}
        {state.status === 'failed' && <p className="error">База не открылась: {state.message}</p>}
        {state.status === 'ready' && (
          <table className="stats">
            <tbody>
              {state.rows.map((row) => (
                <tr key={row.store}>
                  <td>{LABELS[row.store]}</td>
                  <td className="num">{row.live}</td>
                  <td className="num muted">{row.total > row.live ? `+${row.total - row.live} удал.` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted">
          Версия схемы данных: {SCHEMA_VERSION}. Сборка: {built.toLocaleString('ru-RU')}.
        </p>
      </Fold>

      <Fold id="settings:about:install" title="Установка" sub folded>
        <InstallNote
          empty={
            state.status !== 'ready' ||
            isEmptyBase(Object.fromEntries(state.rows.map((row) => [row.store, row.live])), RECORD_STORES)
          }
        />
      </Fold>

      {/* Весь список изменений: блок на главном экране закрыли, а спросить
          «что тогда поменялось» можно и потом. */}
      <Fold id="settings:about:changes" title="Что нового" summary={last && formatDate(last.date)} sub folded>
        <ChangeList changes={CHANGES} />
      </Fold>

      <Fold id="settings:about:report" title="Сообщить об ошибке" sub folded>
        <ReportBug />
      </Fold>
    </Fold>
  )
}
