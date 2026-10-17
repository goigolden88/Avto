import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { db } from '../app/core.ts'
import type { Parking, ParkingVisit } from '../app/model.ts'
import {
  buildParking,
  defaultParkingId,
  newParkingDraft,
  parkingDeletion,
  parkingDraftOf,
  parkingsByCity,
  sortParkings,
  visitsOf,
  type ParkingDraft,
} from '../modules/parking/parkings.ts'
import {
  NO_VISITS,
  parkingStats,
  percent,
  searchText,
  sharesText,
  visitsCount,
  WEEKDAY_LABELS,
  withoutText,
  type ParkingStats,
  type Shares,
} from '../modules/parking/stats.ts'
import {
  buildVisit,
  MISSING_PARKING,
  newVisitDraft,
  RESULT_LABELS,
  RESULTS,
  searchLabel,
  sortVisits,
  timeOf,
  visitDraftOf,
  type VisitDraft,
} from '../modules/parking/visits.ts'
import { hourText } from '../modules/routes/compare.ts'
import { MISSING_POINT, sortPoints } from '../modules/routes/points.ts'
import { pointNames } from '../modules/routes/routes.ts'
import { formatDateLoose, nowIso, plural, today } from '../shared/core/dates.ts'
import { ulid } from '../shared/core/id.ts'
import { Fold } from '../shared/ui/Fold.tsx'
import { useParkings, type ParkingsData } from './useParkings.ts'

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'Неизвестная ошибка'
}

/** Что открыто вместо экрана: форма места или отметки. `id` / `base` нет — новая. */
type Mode =
  | { kind: 'parking'; id: string | null; draft: ParkingDraft }
  | { kind: 'visit'; draft: VisitDraft; base?: ParkingVisit }
  | null

/**
 * Экран парковок (Р-16, Р-24): ссылкой с «Маршрутов», не вкладкой. Места —
 * по городу, у каждого «Отметить»; тап по месту открывает его (`?place=…`):
 * доли «сразу / с трудом / мест нет» с числом отметок, по часу и по дню
 * недели, медиана минут поиска и список отметок.
 *
 * Цена места — строкой справочно: деньгами не считается и в «Итоги» журнала
 * не идёт.
 */
export function Parkings() {
  const { data, error } = useParkings()
  const [params, setParams] = useSearchParams()
  const [mode, setMode] = useState<Mode>(null)

  function open(next: Mode) {
    setMode(next)
    window.scrollTo(0, 0)
  }

  const newVisit = (parkingId: string) => open({ kind: 'visit', draft: newVisitDraft(parkingId, today(), timeOf(new Date())) })
  const placeId = params.get('place')

  let body = null
  if (data) {
    const ctx: Context = { data, names: pointNames(data.points), open, newVisit }
    if (mode?.kind === 'parking') {
      body = (
        <ParkingForm
          mode={mode}
          data={data}
          onChange={setMode}
          onDone={() => setMode(null)}
          onDeleted={() => {
            setMode(null)
            setParams({})
          }}
        />
      )
    } else if (mode?.kind === 'visit') {
      body = <VisitForm initial={mode.draft} base={mode.base} data={data} onDone={() => setMode(null)} />
    } else if (placeId) {
      body = <PlaceView ctx={ctx} parkingId={placeId} onBack={() => setParams({})} />
    } else {
      body = <Overview ctx={ctx} onPlace={(id) => setParams({ place: id })} />
    }
  }

  return (
    <>
      <header className="screen-head">
        <h1>Парковки</h1>
      </header>

      {error && <p className="error block">База не открылась: {error}</p>}

      <div className="parkings">{body}</div>
    </>
  )
}

/** Общее для обзора и места: данные, имена точек и что открыть. */
type Context = {
  data: ParkingsData
  names: ReadonlyMap<string, string>
  open: (mode: Mode) => void
  newVisit: (parkingId: string) => void
}

/** «у точки «Дом»», точки нет — «точка не найдена»; место без точки — пусто. */
function pointText(parking: Parking, names: ReadonlyMap<string, string>): string {
  if (!parking.pointId) return ''
  const name = names.get(parking.pointId)
  return name === undefined ? MISSING_POINT : `у точки «${name}»`
}

// ─── Обзор ─────────────────────────────────────────────────────────────────

/** Места по городу, у каждого — «Отметить». */
function Overview({ ctx, onPlace }: { ctx: Context; onPlace: (id: string) => void }) {
  const { data, names, open } = ctx
  const groups = parkingsByCity(data.parkings)
  const addPlace = () => open({ kind: 'parking', id: null, draft: newParkingDraft(data.parkings, data.points) })

  return (
    <>
      <div className="row">
        <Link className="link-btn" to="/routes">
          ‹ Маршруты
        </Link>
      </div>

      {groups.length === 0 ? (
        <section className="block home-empty">
          <p>Мест пока нет.</p>
          <p className="muted">
            Сначала заведите место — «двор за домом», «ТЦ Мега, минус первый», — потом ставьте отметки: встали сразу, с
            трудом или мест не было. По отметкам станет видно, в какое время и в какие дни там проще встать.
          </p>
          <div className="row">
            <button type="button" className="btn btn--primary" onClick={addPlace}>
              Добавить место
            </button>
          </div>
        </section>
      ) : (
        <div className="row row--wrap routes__add">
          <button type="button" className="btn btn--primary" onClick={() => ctx.newVisit(defaultParkingId(data.parkings, data.visits))}>
            Отметить
          </button>
          <button type="button" className="btn" onClick={addPlace}>
            Добавить место
          </button>
        </div>
      )}

      {groups.map((group) => (
        <Fold key={group.city} id={`parkings:city:${group.city}`} title={group.city} summary={String(group.parkings.length)}>
          <ul className="plain">
            {group.parkings.map((parking) => {
              const stats = parkingStats(visitsOf(parking.id, data.visits))
              const details = [pointText(parking, names), parking.price ?? ''].filter(Boolean)
              return (
                <li key={parking.id} className="parking">
                  <button type="button" className="car parking__open" onClick={() => onPlace(parking.id)}>
                    <span className="car__name">{parking.where}</span>
                    {details.length > 0 && <span className="muted">{details.join(' · ')}</span>}
                    <span className="muted">{sharesText(stats)}</span>
                  </button>
                  <button type="button" className="btn" onClick={() => ctx.newVisit(parking.id)}>
                    Отметить
                  </button>
                </li>
              )
            })}
          </ul>
        </Fold>
      ))}
    </>
  )
}

// ─── Место ─────────────────────────────────────────────────────────────────

/** Место: что о нём известно, когда проще встать и его отметки. */
function PlaceView({ ctx, parkingId, onBack }: { ctx: Context; parkingId: string; onBack: () => void }) {
  const { data, names, open } = ctx
  const parking = sortParkings(data.parkings).find((each) => each.id === parkingId)
  const visits = sortVisits(visitsOf(parkingId, data.visits))
  const stats = parkingStats(visits)

  return (
    <>
      <div className="row">
        <button type="button" className="link-btn" onClick={onBack}>
          ‹ Все места
        </button>
      </div>

      {!parking ? (
        <section className="block home-empty">
          <p>Место не найдено — его удалили.</p>
        </section>
      ) : (
        <>
          <section className="block pair-view__head">
            <h2>{parking.where}</h2>
            <p className="muted">{[parking.city, pointText(parking, names), parking.price ?? ''].filter(Boolean).join(' · ')}</p>
            {parking.note && <p className="muted">{parking.note}</p>}
            <div className="row row--wrap">
              <button type="button" className="btn btn--primary" onClick={() => ctx.newVisit(parking.id)}>
                Отметить
              </button>
              {parking.link && (
                <a className="btn" href={parking.link} target="_blank" rel="noopener noreferrer">
                  Ссылка ↗
                </a>
              )}
              <button
                type="button"
                className="btn"
                onClick={() => open({ kind: 'parking', id: parking.id, draft: parkingDraftOf(parking) })}
              >
                Править
              </button>
            </div>
          </section>

          <Fold id="parkings:place:stats" title="Когда проще встать" summary={stats.count === 0 ? NO_VISITS : visitsCount(stats.count)}>
            <StatsBlock stats={stats} />
          </Fold>

          <Fold id="parkings:place:visits" title="Отметки" summary={String(visits.length)}>
            {visits.length === 0 && <p className="muted">{NO_VISITS}: «Отметить», когда встанете здесь.</p>}
            <ul className="plain entries">
              {visits.map((visit) => {
                const search = searchLabel(visit)
                return (
                  <li key={visit.id}>
                    <button
                      type="button"
                      className={visit.note ? 'entry visit visit--noted' : 'entry visit'}
                      onClick={() => open({ kind: 'visit', draft: visitDraftOf(visit), base: visit })}
                    >
                      <span className="entry__top">
                        <span>
                          {formatDateLoose(visit.date)} · {visit.time}
                        </span>
                        <span className="entry__amount">{RESULT_LABELS[visit.result] ?? visit.result}</span>
                      </span>
                      {search && <span className="muted">{search}</span>}
                      {visit.note && <span className="visit__note">{visit.note}</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          </Fold>
        </>
      )}
    </>
  )
}

/** Доли, минуты поиска, по часу и по дню недели. Отметок нет — «отметок нет», а не «0 %». */
function StatsBlock({ stats }: { stats: ParkingStats }) {
  const without = withoutText(stats.search)
  return (
    <>
      <p className="route__median">{sharesText(stats)}</p>
      {stats.count > 0 && (
        <>
          <p className="totals__note">Поиск: {searchText(stats.search)}</p>
          {without && <p className="muted totals__note">{without}</p>}

          <h3 className="totals__head">По часу</h3>
          <SharesTable rows={stats.byHour.map((each) => ({ key: each.hour, label: hourText(each.hour), shares: each }))} />

          <h3 className="totals__head">По дню недели</h3>
          <SharesTable
            rows={stats.byWeekday.map((each) => ({ key: each.day, label: WEEKDAY_LABELS[each.day] ?? '', shares: each }))}
          />
        </>
      )}
    </>
  )
}

/** Строка — час или день: доли трёх результатов и число отметок. */
function SharesTable({ rows }: { rows: { key: number; label: string; shares: Shares }[] }) {
  return (
    <table className="stats">
      <thead>
        <tr>
          <td />
          {RESULTS.map((result) => (
            <td key={result} className="num muted">
              {RESULT_LABELS[result]}
            </td>
          ))}
          <td />
        </tr>
      </thead>
      <tbody>
        {rows.map(({ key, label, shares }) => (
          <tr key={key}>
            <td>{label}</td>
            {RESULTS.map((result) => (
              <td key={result} className="num">
                {percent(shares[result], shares.count)} %
              </td>
            ))}
            <td className="num muted">{visitsCount(shares.count)}</td>
          </tr>
        ))}
      </tbody>
    </table>
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
 * Форма места: где и город обязательны; город нового — из последнего места,
 * иначе из последней точки. Точка — из своих, по желанию; удалённая на
 * другом устройстве остаётся в выборе как «точка не найдена»: иначе правка
 * молча убрала бы её. Правка отметки не трогает; удаление уносит их — после
 * вопроса с их числом.
 */
function ParkingForm({
  mode,
  data,
  onChange,
  onDone,
  onDeleted,
}: {
  mode: { kind: 'parking'; id: string | null; draft: ParkingDraft }
  data: ParkingsData
  onChange: (mode: Mode) => void
  onDone: () => void
  onDeleted: () => void
}) {
  const [tried, setTried] = useState(false)
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState('')
  const base = mode.id === null ? undefined : data.parkings.find((parking) => parking.id === mode.id)
  const result = buildParking(mode.draft, base, ulid(), nowIso())
  const count = base ? visitsOf(base.id, data.visits).length : 0

  const points = sortPoints(data.points).map((point) => ({ id: point.id, name: point.name }))
  if (mode.draft.pointId !== '' && !points.some((point) => point.id === mode.draft.pointId)) {
    points.push({ id: mode.draft.pointId, name: MISSING_POINT })
  }

  async function run(work: () => Promise<unknown>, after: () => void) {
    setError('')
    try {
      await work()
      after()
    } catch (failure) {
      setError(describe(failure))
    }
  }

  function remove(parking: Parking) {
    void run(async () => {
      // Отметки — из базы, а не с экрана: могли приехать синхронизацией только что.
      const marked = parkingDeletion(parking, await db.getByIndex('parkingVisits', 'parkingId', parking.id))
      await db.putMany('parkingVisits', marked.visits)
      await db.put('parkings', marked.parking)
    }, onDeleted)
  }

  const field = (key: keyof ParkingDraft) => (event: { target: { value: string } }) =>
    onChange({ ...mode, draft: { ...mode.draft, [key]: event.target.value } })

  return (
    <form
      className="form entry-form"
      onSubmit={(event) => {
        event.preventDefault()
        setTried(true)
        if (result.ok) void run(() => db.put('parkings', result.parking), onDone)
      }}
    >
      <h2 className="entry-form__title">{base ? 'Место' : 'Новое место'}</h2>
      <label className="field">
        <span>Где</span>
        <input
          name="parking-where"
          value={mode.draft.where}
          autoComplete="off"
          placeholder="двор за домом"
          onChange={field('where')}
        />
      </label>
      <label className="field">
        <span>Город</span>
        <input name="parking-city" value={mode.draft.city} autoComplete="off" placeholder="Москва" onChange={field('city')} />
      </label>
      <label className="field">
        <span>У какой точки — по желанию</span>
        <select name="parking-point" value={mode.draft.pointId} onChange={field('pointId')}>
          <option value="">без точки</option>
          {points.map((point) => (
            <option key={point.id} value={point.id}>
              {point.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Цена — по желанию, строкой, справочно</span>
        <input name="parking-price" value={mode.draft.price} autoComplete="off" placeholder="бесплатно" onChange={field('price')} />
      </label>
      <label className="field">
        <span>Ссылка — по желанию</span>
        <input name="parking-link" value={mode.draft.link} inputMode="url" autoComplete="off" onChange={field('link')} />
      </label>
      <label className="field">
        <span>Заметка — по желанию</span>
        <textarea name="parking-note" rows={2} value={mode.draft.note} onChange={field('note')} />
      </label>

      {tried && !result.ok && <Errors list={result.errors} />}
      {error && <p className="error">{error}</p>}

      {asking && base ? (
        <div className="panel confirm">
          {count === 0 ? (
            <p>Удалить место «{base.where}»?</p>
          ) : (
            <p>
              Вместе с местом «{base.where}» {plural(count, ['удалится', 'удалятся', 'удалятся'])} {visitsCount(count)} — и
              на других устройствах после синхронизации. Это не отменить.
            </p>
          )}
          <div className="row row--wrap">
            <button type="button" className="btn btn--danger" onClick={() => remove(base)}>
              {count === 0 ? 'Удалить' : 'Удалить с отметками'}
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
 * Форма отметки — новой и правки, одна и та же: место, дата (сегодня),
 * время (сейчас), результат одной кнопкой из трёх, минуты поиска и заметка
 * по желанию. Место отметки, удалённое на другом устройстве, остаётся в
 * выборе как «место не найдено».
 */
function VisitForm({ initial, base, data, onDone }: { initial: VisitDraft; base?: ParkingVisit; data: ParkingsData; onDone: () => void }) {
  const [draft, setDraft] = useState(initial)
  const [tried, setTried] = useState(false)
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState('')
  const result = buildVisit(draft, base, ulid(), nowIso())

  const places = parkingsByCity(data.parkings).flatMap((group) =>
    group.parkings.map((parking) => ({ id: parking.id, name: `${parking.where} · ${parking.city}` })),
  )
  if (draft.parkingId !== '' && !places.some((place) => place.id === draft.parkingId)) {
    places.push({ id: draft.parkingId, name: MISSING_PARKING })
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

  const text = (key: keyof VisitDraft) => (event: { target: { value: string } }) => setDraft({ ...draft, [key]: event.target.value })

  return (
    <form
      className="form entry-form"
      onSubmit={(event) => {
        event.preventDefault()
        setTried(true)
        if (result.ok) void run(() => db.put('parkingVisits', result.visit))
      }}
    >
      <h2 className="entry-form__title">{base ? 'Отметка' : 'Новая отметка'}</h2>
      <label className="field">
        <span>Место</span>
        <select name="visit-place" value={draft.parkingId} onChange={text('parkingId')}>
          {draft.parkingId === '' && <option value="">выберите место</option>}
          {places.map((place) => (
            <option key={place.id} value={place.id}>
              {place.name}
            </option>
          ))}
        </select>
      </label>

      <div className="row row--wrap kinds" role="group" aria-label="Как встали">
        {RESULTS.map((each) => (
          <button
            key={each}
            type="button"
            className={each === draft.result ? 'btn btn--primary' : 'btn'}
            aria-pressed={each === draft.result}
            onClick={() => setDraft({ ...draft, result: each })}
          >
            {RESULT_LABELS[each]}
          </button>
        ))}
      </div>

      <label className="field">
        <span>Дата</span>
        <input type="date" name="visit-date" value={draft.date} onChange={text('date')} />
      </label>
      <label className="field">
        <span>Время</span>
        <input type="time" name="visit-time" value={draft.time} onChange={text('time')} />
      </label>
      <label className="field">
        <span>Сколько минут искали — по желанию, 0 — встали без поиска</span>
        <input
          name="visit-minutes"
          value={draft.searchMinutes}
          inputMode="numeric"
          autoComplete="off"
          onChange={text('searchMinutes')}
        />
      </label>
      <label className="field">
        <span>Заметка — по желанию</span>
        <textarea name="visit-note" rows={2} value={draft.note} placeholder="ярмарка во дворе" onChange={text('note')} />
      </label>

      {tried && !result.ok && <Errors list={result.errors} />}
      {error && <p className="error">{error}</p>}

      {asking && base ? (
        <div className="panel confirm">
          <p>Удалить отметку? Это не отменить.</p>
          <div className="row">
            <button type="button" className="btn btn--danger" onClick={() => void run(() => db.remove('parkingVisits', base.id))}>
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
