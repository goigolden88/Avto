import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { db } from '../app/core.ts'
import type { Car, Route, Trip } from '../app/model.ts'
import { activeCars, defaultCarId, MISSING_CAR } from '../modules/log/cars.ts'
import {
  basisText,
  hourText,
  manualText,
  rankRoutes,
  tripsCount,
  type RouteStats,
} from '../modules/routes/compare.ts'
import { buildPoint, newPointDraft, pointDeleteBlock, pointDraftOf, sortPoints, type PointDraft } from '../modules/routes/points.ts'
import {
  buildRoute,
  newRouteDraft,
  pairsOf,
  pointNames,
  routeAlive,
  routeDeletion,
  routeDraftOf,
  routeTitle,
  tripsOf,
  type Pair,
  type RouteDraft,
} from '../modules/routes/routes.ts'
import {
  TIMER_LIMIT_TEXT,
  timerMinutes,
  timerOverdue,
  timerStart,
  tripFromTimer,
  type Timer,
} from '../modules/routes/timer.ts'
import {
  buildTrip,
  MINUTES_ERROR,
  newTripDraft,
  parseMinutes,
  SOURCE_LABELS,
  sortTrips,
  tripDraftOf,
  type TripDraft,
} from '../modules/routes/trips.ts'
import { formatDateLoose, nowIso, plural, today } from '../shared/core/dates.ts'
import { ulid } from '../shared/core/id.ts'
import { Fold } from '../shared/ui/Fold.tsx'
import { useLog, useMainCar, type LogData } from './useLog.ts'
import { useNow, useRoutes, useTimer, type RoutesData } from './useRoutes.ts'

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'Неизвестная ошибка'
}

/** Что открыто вместо вкладки: форма точки, маршрута или поездки. `id` / `base` нет — новая. */
type Mode =
  | { kind: 'point'; id: string | null; draft: PointDraft }
  | { kind: 'route'; id: string | null; draft: RouteDraft }
  | { kind: 'trip'; draft: TripDraft; base?: Trip }
  | null

/**
 * Вкладка «Маршруты» (Р-12…Р-14): точки, маршруты между ними, поездки,
 * замер и сравнение маршрутов одной пары.
 *
 * Сверху — карточка идущего замера. Дальше — маршруты по парам точек с
 * «Поехал» у каждого; тап по паре открывает сравнение (`?from=…&to=…`):
 * маршруты по возрастанию медианы, у каждого — разбивка по часу выезда,
 * будни и выходные, его поездки. Точки — своим блоком ниже.
 *
 * Машина поездки — главная этого устройства, иначе последняя (Р-21), как
 * в журнале; машин нет — поездка без машины.
 */
export function RoutesTab() {
  const { data, error } = useRoutes()
  const log = useLog()
  const main = useMainCar()
  const timer = useTimer()
  const [params, setParams] = useSearchParams()
  const [mode, setMode] = useState<Mode>(null)

  function open(next: Mode) {
    setMode(next)
    window.scrollTo(0, 0)
  }

  const ready = data !== null && log.data !== null && main.known && timer.known
  const failed = error || log.error

  let body = null
  if (ready && data && log.data) {
    const carId = defaultCarId(log.data.cars, log.data.entries, main.mainId)
    const from = params.get('from')
    const to = params.get('to')
    const ctx: Context = {
      data,
      log: log.data,
      names: pointNames(data.points),
      running: timer.timer !== null,
      start: (routeId) => {
        timer.start(routeId)
        window.scrollTo(0, 0)
      },
      open,
      newTrip: (routeId) => open({ kind: 'trip', draft: newTripDraft(routeId, today(), carId) }),
    }

    if (mode?.kind === 'point') {
      body = <PointForm mode={mode} data={data} onChange={setMode} onDone={() => setMode(null)} />
    } else if (mode?.kind === 'route') {
      body = <RouteForm mode={mode} data={data} onChange={setMode} onDone={() => setMode(null)} />
    } else if (mode?.kind === 'trip') {
      body = (
        <TripForm initial={mode.draft} base={mode.base} data={data} cars={log.data.cars} onDone={() => setMode(null)} />
      )
    } else if (from && to) {
      body = <PairView ctx={ctx} fromId={from} toId={to} onBack={() => setParams({})} />
    } else {
      body = <Overview ctx={ctx} onPair={(pair) => setParams({ from: pair.fromId, to: pair.toId })} />
    }
  }

  return (
    <>
      <header className="screen-head">
        <h1>Маршруты</h1>
      </header>

      {ready && data && log.data && timer.timer && (
        <TimerCard
          key={timer.timer.startedAt}
          timer={timer.timer}
          data={data}
          log={log.data}
          mainId={main.mainId}
          onDone={timer.stop}
        />
      )}

      {failed && <p className="error block">База не открылась: {failed}</p>}

      <div className="routes">{body}</div>
    </>
  )
}

/** Общее для обзора и пары: данные, имена точек, идёт ли замер и что открыть. */
type Context = {
  data: RoutesData
  log: LogData
  names: ReadonlyMap<string, string>
  running: boolean
  start: (routeId: string) => void
  open: (mode: Mode) => void
  newTrip: (routeId: string) => void
}

// ─── Обзор ─────────────────────────────────────────────────────────────────

/** Маршруты по парам с «Поехал» у каждого, точки — блоком ниже. */
function Overview({ ctx, onPair }: { ctx: Context; onPair: (pair: Pair) => void }) {
  const { data, open } = ctx
  const pairs = pairsOf(data.routes, data.points)
  const points = sortPoints(data.points)
  const routes = pairs.flatMap((pair) => pair.routes)
  const addPoint = () => open({ kind: 'point', id: null, draft: newPointDraft(data.points) })
  const addRoute = () => {
    const [first, second] = points
    open({ kind: 'route', id: null, draft: newRouteDraft(first?.id, second?.id) })
  }

  return (
    <>
      {routes.length === 0 ? (
        <section className="block home-empty">
          <p>Маршрутов пока нет.</p>
          <p className="muted">
            {points.length < 2
              ? 'Сначала заведите две точки — например, «Дом» и «Работа», — потом маршрут между ними.'
              : 'Точки есть — теперь заведите маршрут между ними: «Дом → Работа по МКАД».'}
          </p>
          <div className="row">
            {points.length < 2 ? (
              <button type="button" className="btn btn--primary" onClick={addPoint}>
                Добавить точку
              </button>
            ) : (
              <button type="button" className="btn btn--primary" onClick={addRoute}>
                Добавить маршрут
              </button>
            )}
          </div>
        </section>
      ) : (
        <div className="row row--wrap routes__add">
          <button type="button" className="btn btn--primary" onClick={() => ctx.newTrip(routes[0]?.id ?? '')}>
            Вписать поездку
          </button>
          <button type="button" className="btn" onClick={addRoute}>
            Добавить маршрут
          </button>
        </div>
      )}

      {pairs.length > 0 && (
        <Fold id="routes:pairs" title="По парам точек" summary={String(pairs.length)}>
          <p className="muted totals__note">Быстрый маршрут сверху. Тап по паре — сравнение по часу и дням.</p>
          {pairs.map((pair) => (
            <div key={pair.key} className="pair">
              <button type="button" className="pair__head" onClick={() => onPair(pair)}>
                <span className="car__name">{pair.title}</span>
                <span className="muted">сравнить ›</span>
              </button>
              <ul className="plain pair__routes">
                {rankRoutes(pair.routes, data.trips).map(({ route, stats }) => (
                  <li key={route.id} className="pair__route">
                    <span className="pair__name">
                      <span>{route.name}</span>
                      <span className="muted">{basisText(stats)}</span>
                    </span>
                    {!ctx.running && (
                      <button type="button" className="btn" onClick={() => ctx.start(route.id)}>
                        Поехал
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Fold>
      )}

      {/* Точки заводят редко — блок свёрнут, пока его не открыли. */}
      <Fold id="routes:points" title="Точки" summary={String(points.length)} folded>
        {points.length === 0 && <p className="muted">Точек пока нет: «Дом», «Работа», «ТЦ Мега».</p>}
        <ul className="plain">
          {points.map((point) => (
            <li key={point.id}>
              <button
                type="button"
                className="car"
                onClick={() => open({ kind: 'point', id: point.id, draft: pointDraftOf(point) })}
              >
                <span className="car__name">{point.name}</span>
                <span className="muted">{point.city}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="row">
          <button type="button" className="btn" onClick={addPoint}>
            Добавить точку
          </button>
        </div>
      </Fold>
    </>
  )
}

// ─── Пара точек ────────────────────────────────────────────────────────────

/** Сравнение маршрутов пары (Р-14): по возрастанию медианы, быстрый сверху. */
function PairView({ ctx, fromId, toId, onBack }: { ctx: Context; fromId: string; toId: string; onBack: () => void }) {
  const { data, open } = ctx
  const pair = pairsOf(data.routes, data.points).find((each) => each.fromId === fromId && each.toId === toId)
  const ranked = pair ? rankRoutes(pair.routes, data.trips) : []

  return (
    <>
      <div className="row">
        <button type="button" className="link-btn" onClick={onBack}>
          ‹ Все маршруты
        </button>
      </div>

      {!pair ? (
        <section className="block home-empty">
          <p>У этой пары точек маршрутов нет.</p>
        </section>
      ) : (
        <>
          <section className="block pair-view__head">
            <h2>{pair.title}</h2>
            <p className="muted">
              {ranked.length} {plural(ranked.length, ['маршрут', 'маршрута', 'маршрутов'])} — быстрый сверху, по
              медиане минут.
            </p>
            <div className="row row--wrap">
              <button type="button" className="btn btn--primary" onClick={() => ctx.newTrip(ranked[0]?.route.id ?? '')}>
                Вписать поездку
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => open({ kind: 'route', id: null, draft: newRouteDraft(fromId, toId) })}
              >
                Добавить маршрут
              </button>
            </div>
          </section>

          {ranked.map(({ route, stats }) => (
            <RouteBlock key={route.id} ctx={ctx} route={route} stats={stats} />
          ))}
        </>
      )}
    </>
  )
}

/** Маршрут в сравнении: медиана с основанием, разбивки, кнопки и поездки. */
function RouteBlock({ ctx, route, stats }: { ctx: Context; route: Route; stats: RouteStats }) {
  const { data, log, open } = ctx
  const trips = sortTrips(tripsOf(route.id, data.trips))
  const cars = new Map(log.cars.map((car) => [car.id, car.name]))

  return (
    <Fold id={`routes:route:${route.id}`} title={route.name} summary={stats.median === null ? 'поездок нет' : `${stats.median} мин`}>
      <p className="route__median">{basisText(stats)}</p>
      {stats.count > 0 && <p className="muted totals__note">{manualText(stats)}</p>}
      {route.note && <p className="muted totals__note">{route.note}</p>}

      <div className="row row--wrap">
        {!ctx.running && (
          <button type="button" className="btn btn--primary" onClick={() => ctx.start(route.id)}>
            Поехал
          </button>
        )}
        {route.link && (
          <a className="btn" href={route.link} target="_blank" rel="noopener noreferrer">
            Карта ↗
          </a>
        )}
        <button type="button" className="btn" onClick={() => open({ kind: 'route', id: route.id, draft: routeDraftOf(route) })}>
          Править
        </button>
      </div>

      {stats.count > 0 && (
        <>
          <h3 className="totals__head">По часу выезда</h3>
          <table className="stats">
            <tbody>
              {stats.byHour.map((each) => (
                <tr key={each.hour}>
                  <td>{hourText(each.hour)}</td>
                  <td className="num">{each.median} мин</td>
                  <td className="num muted">{tripsCount(each.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 className="totals__head">Будни и выходные</h3>
          <table className="stats">
            <tbody>
              <tr>
                <td>Будни</td>
                <td className="num">{basisText(stats.weekdays)}</td>
              </tr>
              <tr>
                <td>Выходные</td>
                <td className="num">{basisText(stats.weekend)}</td>
              </tr>
            </tbody>
          </table>

          <Fold id={`routes:trips:${route.id}`} title="Поездки" summary={String(trips.length)} sub folded>
            <ul className="plain entries">
              {trips.map((trip) => {
                const parts = [SOURCE_LABELS[trip.source] ?? trip.source]
                if (trip.carId) parts.push(cars.get(trip.carId) ?? MISSING_CAR)
                return (
                  <li key={trip.id}>
                    <button
                      type="button"
                      className={trip.note ? 'entry trip trip--noted' : 'entry trip'}
                      onClick={() => open({ kind: 'trip', draft: tripDraftOf(trip), base: trip })}
                    >
                      <span className="entry__top">
                        <span>
                          {formatDateLoose(trip.date)} · {trip.start}
                        </span>
                        <span className="entry__amount">{trip.minutes} мин</span>
                      </span>
                      <span className="muted">{parts.join(' · ')}</span>
                      {trip.note && <span className="trip__note">{trip.note}</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          </Fold>
        </>
      )}
    </Fold>
  )
}

// ─── Замер ─────────────────────────────────────────────────────────────────

/**
 * Карточка идущего замера (Р-13): маршрут и минуты в пути, «Приехал»,
 * «Вписать минуты», «Выбросить». Дольше порога — «Приехал» нет: такие
 * минуты молча не сохраняются. Маршрут удалён на другом устройстве —
 * только «Выбросить».
 */
function TimerCard({
  timer,
  data,
  log,
  mainId,
  onDone,
}: {
  timer: Timer
  data: RoutesData
  log: LogData
  mainId: string | null
  onDone: () => void
}) {
  const now = useNow(true)
  const [typing, setTyping] = useState<string | null>(null)
  const [tried, setTried] = useState(false)
  const [carId, setCarId] = useState(() => defaultCarId(log.cars, log.entries, mainId) ?? '')
  const [error, setError] = useState('')

  const route = routeAlive(timer.routeId, data.routes, data.points)
  const minutes = timerMinutes(timer, now)
  const overdue = timerOverdue(timer, now)
  const active = activeCars(log.cars)

  async function save(value: number) {
    if (!route) return
    setError('')
    try {
      await db.put('trips', tripFromTimer(timer, value, carId || null, ulid(), nowIso()))
      onDone()
    } catch (failure) {
      setError(describe(failure))
    }
  }

  function saveTyped() {
    setTried(true)
    const value = parseMinutes(typing ?? '')
    if (value !== null) void save(value)
  }

  return (
    <section className="block panel timer">
      <p className="timer__title">Замер{route ? ` · ${routeTitle(route, pointNames(data.points))}` : ''}</p>
      {!route ? (
        <p className="warning">Маршрут удалён — поездку некуда сохранить.</p>
      ) : (
        <>
          <p>
            <span className="timer__minutes">{minutes} мин</span> в пути — выехали в {timerStart(timer).start}
            {timerStart(timer).date !== today() && `, ${formatDateLoose(timerStart(timer).date)}`}
          </p>
          {overdue && (
            <p className="warning">
              Замер идёт больше {TIMER_LIMIT_TEXT} — похоже, «Приехал» не нажали. Впишите минуты сами или выбросьте замер.
            </p>
          )}
          {active.length > 0 && (
            <label className="field">
              <span>Машина</span>
              <select name="timer-car" value={carId} onChange={(event) => setCarId(event.target.value)}>
                <option value="">без машины</option>
                {active.map((car) => (
                  <option key={car.id} value={car.id}>
                    {car.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      )}

      {route && typing !== null ? (
        <form
          className="form"
          onSubmit={(event) => {
            event.preventDefault()
            saveTyped()
          }}
        >
          <label className="field">
            <span>Минут в пути</span>
            <input
              name="timer-minutes"
              value={typing}
              inputMode="numeric"
              autoComplete="off"
              onChange={(event) => setTyping(event.target.value)}
            />
          </label>
          {tried && parseMinutes(typing) === null && <p className="error">{MINUTES_ERROR}</p>}
          <div className="form__actions row--wrap">
            <button type="button" className="btn" onClick={() => setTyping(null)}>
              Отмена
            </button>
            <button type="submit" className="btn btn--primary">
              Сохранить
            </button>
          </div>
        </form>
      ) : (
        <div className="row row--wrap">
          {route && !overdue && (
            <button type="button" className="btn btn--primary" onClick={() => void save(minutes)}>
              Приехал
            </button>
          )}
          {route && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setTried(false)
                setTyping(overdue ? '' : String(minutes))
              }}
            >
              Вписать минуты
            </button>
          )}
          <button type="button" className="btn btn--danger" onClick={onDone}>
            Выбросить
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  )
}

/** Строка о замере на «Главной»: идёт — со ссылкой на «Маршруты». */
export function TimerLine() {
  const { timer, known } = useTimer()
  const { data } = useRoutes()
  const now = useNow(timer !== null)
  if (!known || !timer || !data) return null
  const route = routeAlive(timer.routeId, data.routes, data.points)
  return (
    <section className="block panel timer-line">
      <span>
        {route
          ? `Идёт замер: ${routeTitle(route, pointNames(data.points))}, ${timerMinutes(timer, now)} мин в пути.`
          : 'Идёт замер, но маршрут удалён.'}
      </span>
      <Link className="link-btn" to="/routes">
        На «Маршруты»
      </Link>
    </section>
  )
}

// ─── Формы ─────────────────────────────────────────────────────────────────

/** Ошибки формы — после первого «Сохранить»: на пустой форме кричать незачем. */
function Errors({ list }: { list: readonly string[] }) {
  return list.map((each) => (
    <p key={each} className="error">
      {each}
    </p>
  ))
}

/**
 * Форма точки: имя и город; город новой — из последней заведённой. Точку
 * из маршрутов не удалить — сначала маршруты. Имя меняется везде: маршруты
 * ссылаются на точку по id.
 */
function PointForm({
  mode,
  data,
  onChange,
  onDone,
}: {
  mode: { kind: 'point'; id: string | null; draft: PointDraft }
  data: RoutesData
  onChange: (mode: Mode) => void
  onDone: () => void
}) {
  const [tried, setTried] = useState(false)
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState('')
  const base = mode.id === null ? undefined : data.points.find((point) => point.id === mode.id)
  const result = buildPoint(mode.draft, base, ulid(), nowIso())
  const block = base ? pointDeleteBlock(base.id, data.routes) : null

  async function run(work: () => Promise<unknown>) {
    setError('')
    try {
      await work()
      onDone()
    } catch (failure) {
      setError(describe(failure))
    }
  }

  const field = (key: keyof PointDraft) => (event: { target: { value: string } }) =>
    onChange({ ...mode, draft: { ...mode.draft, [key]: event.target.value } })

  return (
    <form
      className="form entry-form"
      onSubmit={(event) => {
        event.preventDefault()
        setTried(true)
        if (result.ok) void run(() => db.put('points', result.point))
      }}
    >
      <h2 className="entry-form__title">{base ? 'Точка' : 'Новая точка'}</h2>
      <label className="field">
        <span>Имя</span>
        <input name="point-name" value={mode.draft.name} autoComplete="off" placeholder="Дом" onChange={field('name')} />
      </label>
      <label className="field">
        <span>Город</span>
        <input name="point-city" value={mode.draft.city} autoComplete="off" placeholder="Москва" onChange={field('city')} />
      </label>

      {tried && !result.ok && <Errors list={result.errors} />}
      {error && <p className="error">{error}</p>}

      {asking && base ? (
        <div className="panel confirm">
          {block ? (
            <>
              <p>{block}</p>
              <p className="muted">Точка стоит в маршрутах «откуда» или «куда».</p>
              <div className="row">
                <button type="button" className="btn" onClick={() => setAsking(false)}>
                  Понятно
                </button>
              </div>
            </>
          ) : (
            <>
              <p>Удалить точку «{base.name}»?</p>
              <div className="row">
                <button type="button" className="btn btn--danger" onClick={() => void run(() => db.remove('points', base.id))}>
                  Удалить
                </button>
                <button type="button" className="btn" onClick={() => setAsking(false)}>
                  Отмена
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="form__actions row--wrap">
          {base && (
            <button type="button" className="btn btn--danger" onClick={() => setAsking(true)}>
              Удалить
            </button>
          )}
          <button type="button" className="btn" onClick={onDone}>
            Отмена
          </button>
          <button type="submit" className="btn btn--primary">
            Сохранить
          </button>
        </div>
      )}
    </form>
  )
}

/**
 * Форма маршрута: откуда и куда — из своих точек, имя; ссылка на Яндекс
 * Карты и заметка — по желанию. Удаление уносит и поездки маршрута — после
 * вопроса с их числом.
 */
function RouteForm({
  mode,
  data,
  onChange,
  onDone,
}: {
  mode: { kind: 'route'; id: string | null; draft: RouteDraft }
  data: RoutesData
  onChange: (mode: Mode) => void
  onDone: () => void
}) {
  const [tried, setTried] = useState(false)
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState('')
  const base = mode.id === null ? undefined : data.routes.find((route) => route.id === mode.id)
  const result = buildRoute(mode.draft, base, ulid(), nowIso())
  const points = sortPoints(data.points)
  const count = base ? tripsOf(base.id, data.trips).length : 0

  async function run(work: () => Promise<unknown>) {
    setError('')
    try {
      await work()
      onDone()
    } catch (failure) {
      setError(describe(failure))
    }
  }

  function remove(route: Route) {
    void run(async () => {
      // Поездки — из базы, а не с экрана: могли приехать синхронизацией только что.
      const marked = routeDeletion(route, await db.getByIndex('trips', 'routeId', route.id))
      await db.putMany('trips', marked.trips)
      await db.put('routes', marked.route)
    })
  }

  const field = (key: keyof RouteDraft) => (event: { target: { value: string } }) =>
    onChange({ ...mode, draft: { ...mode.draft, [key]: event.target.value } })

  const pointSelect = (key: 'fromId' | 'toId', label: string) => (
    <label className="field">
      <span>{label}</span>
      <select name={key === 'fromId' ? 'route-from' : 'route-to'} value={mode.draft[key]} onChange={field(key)}>
        <option value="">выберите точку</option>
        {points.map((point) => (
          <option key={point.id} value={point.id}>
            {point.name}
          </option>
        ))}
      </select>
    </label>
  )

  return (
    <form
      className="form entry-form"
      onSubmit={(event) => {
        event.preventDefault()
        setTried(true)
        if (result.ok) void run(() => db.put('routes', result.route))
      }}
    >
      <h2 className="entry-form__title">{base ? 'Маршрут' : 'Новый маршрут'}</h2>
      {points.length < 2 && <p className="warning">Для маршрута нужны две точки — сначала заведите их в «Точках».</p>}
      {pointSelect('fromId', 'Откуда')}
      {pointSelect('toId', 'Куда')}
      <label className="field">
        <span>Имя</span>
        <input name="route-name" value={mode.draft.name} autoComplete="off" placeholder="по МКАД" onChange={field('name')} />
      </label>
      <label className="field">
        <span>Ссылка на Яндекс Карты — по желанию</span>
        <input name="route-link" value={mode.draft.link} inputMode="url" autoComplete="off" onChange={field('link')} />
      </label>
      <label className="field">
        <span>Заметка — по желанию</span>
        <textarea name="route-note" rows={2} value={mode.draft.note} onChange={field('note')} />
      </label>

      {tried && !result.ok && <Errors list={result.errors} />}
      {error && <p className="error">{error}</p>}

      {asking && base ? (
        <div className="panel confirm">
          {count === 0 ? (
            <p>Удалить маршрут «{base.name}»?</p>
          ) : (
            <p>
              Вместе с маршрутом «{base.name}» {plural(count, ['удалится', 'удалятся', 'удалятся'])} {tripsCount(count)} — и
              на других устройствах после синхронизации. Это не отменить.
            </p>
          )}
          <div className="row row--wrap">
            <button type="button" className="btn btn--danger" onClick={() => remove(base)}>
              {count === 0 ? 'Удалить' : 'Удалить с поездками'}
            </button>
            <button type="button" className="btn" onClick={() => setAsking(false)}>
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <div className="form__actions row--wrap">
          {base && (
            <button type="button" className="btn btn--danger" onClick={() => setAsking(true)}>
              Удалить
            </button>
          )}
          <button type="button" className="btn" onClick={onDone}>
            Отмена
          </button>
          <button type="submit" className="btn btn--primary">
            Сохранить
          </button>
        </div>
      )}
    </form>
  )
}

/**
 * Форма поездки — новой вручную и правки, одна и та же: маршрут, дата
 * (сегодня), время выезда, минуты, машина, заметка. Машин нет — поля
 * машины нет. Машина поездки, ушедшая в архив или ещё не приехавшая,
 * остаётся в выборе: иначе правка молча убрала бы её.
 */
function TripForm({
  initial,
  base,
  data,
  cars,
  onDone,
}: {
  initial: TripDraft
  base?: Trip
  data: RoutesData
  cars: readonly Car[]
  onDone: () => void
}) {
  const [draft, setDraft] = useState(initial)
  const [tried, setTried] = useState(false)
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState('')
  const result = buildTrip(draft, base, ulid(), nowIso())
  const names = pointNames(data.points)

  const routes = pairsOf(data.routes, data.points)
    .flatMap((pair) => pair.routes)
    .map((route) => ({ id: route.id, name: routeTitle(route, names) }))
  if (draft.routeId !== '' && !routes.some((route) => route.id === draft.routeId)) {
    routes.push({ id: draft.routeId, name: 'маршрут не найден' })
  }

  const carOptions = activeCars(cars).map((car) => ({ id: car.id, name: car.name }))
  if (draft.carId !== '' && !carOptions.some((option) => option.id === draft.carId)) {
    const car = cars.find((each) => each.id === draft.carId && !each.deleted)
    carOptions.push({ id: draft.carId, name: car ? `${car.name} — в архиве` : MISSING_CAR })
  }

  async function run(work: () => Promise<unknown>) {
    setError('')
    try {
      await work()
      onDone()
    } catch (failure) {
      setError(describe(failure))
    }
  }

  const text = (key: keyof TripDraft) => (event: { target: { value: string } }) =>
    setDraft({ ...draft, [key]: event.target.value })

  return (
    <form
      className="form entry-form"
      onSubmit={(event) => {
        event.preventDefault()
        setTried(true)
        if (result.ok) void run(() => db.put('trips', result.trip))
      }}
    >
      <h2 className="entry-form__title">{base ? `Поездка · ${SOURCE_LABELS[base.source] ?? base.source}` : 'Поездка вручную'}</h2>
      <label className="field">
        <span>Маршрут</span>
        <select name="trip-route" value={draft.routeId} onChange={text('routeId')}>
          {draft.routeId === '' && <option value="">выберите маршрут</option>}
          {routes.map((route) => (
            <option key={route.id} value={route.id}>
              {route.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Дата</span>
        <input type="date" name="trip-date" value={draft.date} onChange={text('date')} />
      </label>
      <label className="field">
        <span>Время выезда</span>
        <input type="time" name="trip-start" value={draft.start} onChange={text('start')} />
      </label>
      <label className="field">
        <span>Минут в пути</span>
        <input name="trip-minutes" value={draft.minutes} inputMode="numeric" autoComplete="off" onChange={text('minutes')} />
      </label>
      {carOptions.length > 0 && (
        <label className="field">
          <span>Машина</span>
          <select name="trip-car" value={draft.carId} onChange={text('carId')}>
            <option value="">без машины</option>
            {carOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        <span>Заметка — почему дольше обычного</span>
        <textarea name="trip-note" rows={2} value={draft.note} placeholder="ливень, авария на въезде" onChange={text('note')} />
      </label>

      {tried && !result.ok && <Errors list={result.errors} />}
      {error && <p className="error">{error}</p>}

      {asking && base ? (
        <div className="panel confirm">
          <p>Удалить поездку? Это не отменить.</p>
          <div className="row">
            <button type="button" className="btn btn--danger" onClick={() => void run(() => db.remove('trips', base.id))}>
              Удалить
            </button>
            <button type="button" className="btn" onClick={() => setAsking(false)}>
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <div className="form__actions row--wrap">
          {base && (
            <button type="button" className="btn btn--danger" onClick={() => setAsking(true)}>
              Удалить
            </button>
          )}
          <button type="button" className="btn" onClick={onDone}>
            Отмена
          </button>
          <button type="submit" className="btn btn--primary">
            Сохранить
          </button>
        </div>
      )}
    </form>
  )
}
