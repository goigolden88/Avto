import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Entry } from '../app/model.ts'
import { activeCars, defaultCarId, MISSING_CAR, sortCars } from '../modules/log/cars.ts'
import {
  draftOf,
  entryDetails,
  KIND_LABELS,
  KINDS,
  newDraft,
  sortEntries,
  tankGauge,
  type EntryDraft,
} from '../modules/log/entries.ts'
import {
  ALL,
  currentPeriod,
  entriesCount,
  filterEntries,
  PERIOD_KINDS,
  PERIOD_LABELS,
  periodTitle,
  shiftPeriod,
  shownText,
  type LogFilter,
} from '../modules/log/filter.ts'
import { formatMoney } from '../modules/log/numbers.ts'
import {
  basisText,
  CHEAP_SPAN,
  cheapStations,
  consumptionText,
  fillsCount,
  fuelNotes,
  fuelNoteText,
  perKm,
  perKmText,
  periodStats,
} from '../modules/log/stats.ts'
import { formatDateLoose, today } from '../shared/core/dates.ts'
import { Fold } from '../shared/ui/Fold.tsx'
import { EntryForm } from './EntryForm.tsx'
import type { LogData } from './useLog.ts'

/** Что открыто: журнал или форма — новой записи (`base` нет) или правки. */
type Editing = { draft: EntryDraft; base?: Entry } | null

/**
 * Журнал на «Главной» (Р-03): заправки, мойки, ремонты, штрафы и прочее
 * одним списком, свежие сверху. Отбор — по машине, виду и периоду; рядом
 * с ним — сколько записей показано. Под отбором — «Итоги» (Р-23), у
 * заправки в строке — км с прошлой, рост цены и полоска бака (Р-25).
 *
 * Без активной машины записи не завести — сначала машина, кнопкой в
 * «Настройки». Запись, чья машина ещё не приехала синхронизацией, в журнале
 * есть, с «машина не найдена» вместо названия.
 */
export function Journal({ data, mainId }: { data: LogData; mainId: string | null }) {
  const [filter, setFilter] = useState<LogFilter>(ALL)
  const [editing, setEditing] = useState<Editing>(null)

  const { cars, entries, currency } = data
  const active = activeCars(cars)
  const names = new Map(cars.map((car) => [car.id, car.name]))

  function open(next: Editing) {
    setEditing(next)
    window.scrollTo(0, 0)
  }

  function add() {
    const carId = defaultCarId(cars, entries, mainId)
    if (carId === null) return
    open({ draft: newDraft(carId, cars.find((car) => car.id === carId)?.fuel, today()) })
  }

  if (editing) {
    return (
      <div className="journal">
        <EntryForm
          initial={editing.draft}
          base={editing.base}
          cars={cars}
          currency={currency}
          onDone={() => setEditing(null)}
        />
      </div>
    )
  }

  const shown = sortEntries(filterEntries(entries, filter))
  const total = entries.length
  // По всему журналу, а не по показанному: прошлая заправка могла остаться за отбором.
  const notes = fuelNotes(entries)

  return (
    <div className="journal">
      {active.length === 0 ? (
        <section className="block home-empty">
          <p>{cars.length === 0 ? 'Сначала заведите машину.' : 'Все машины в архиве — верните машину или заведите новую.'}</p>
          <p className="muted">С машиной появится журнал: заправки, мойки, ремонты, штрафы и прочее.</p>
          <div className="row">
            <Link className="btn btn--primary" to="/settings?block=cars">
              {cars.length === 0 ? 'Завести машину' : 'К машинам'}
            </Link>
          </div>
        </section>
      ) : total === 0 ? (
        <section className="block home-empty">
          <p>Записей пока нет.</p>
          <div className="row">
            <button type="button" className="btn btn--primary" onClick={add}>
              Добавить запись
            </button>
          </div>
        </section>
      ) : (
        <div className="row journal__add">
          <button type="button" className="btn btn--primary" onClick={add}>
            Добавить запись
          </button>
        </div>
      )}

      {total > 0 && (
        <>
          <section className="block">
            <Filters filter={filter} onChange={setFilter} cars={sortCars(cars)} />
            <p className="muted journal__count">{shownText(shown.length, total)}</p>
          </section>

          <Totals entries={entries} filter={filter} names={names} currency={currency} />

          <section className="block">
            {shown.length === 0 ? (
              <div className="home-empty">
                <p>{filter.period.kind === 'all' ? 'Подходящих записей нет.' : 'За этот период записей нет.'}</p>
                <p className="muted">За всё время — {entriesCount(total)}.</p>
              </div>
            ) : (
              <ul className="plain entries">
                {shown.map((entry) => {
                  const details = entryDetails(entry, currency)
                  const calc = fuelNoteText(notes.get(entry.id))
                  const tank = tankGauge(entry)
                  return (
                    <li key={entry.id}>
                      <button type="button" className="entry" onClick={() => open({ draft: draftOf(entry), base: entry })}>
                        <span className="entry__top">
                          <span>
                            {formatDateLoose(entry.date)} · {KIND_LABELS[entry.kind] ?? entry.kind}
                          </span>
                          <span className="entry__amount">{formatMoney(entry.amount, currency)}</span>
                        </span>
                        <span className="muted">
                          {names.get(entry.carId) ?? MISSING_CAR}
                          {details && ` · ${details}`}
                        </span>
                        {calc && <span className="muted">{calc}</span>}
                        {tank && (
                          <span className="tank">
                            <span className="tank__bar" aria-hidden="true">
                              <span className="tank__was" style={{ width: `${tank.was}%` }} />
                              <span className="tank__added" style={{ width: `${tank.added}%` }} />
                            </span>
                            <span className="muted">{tank.text}</span>
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}

/**
 * «Итоги» (Р-23): цена километра с основанием и средний расход — по машине
 * на строку, траты по видам — общие; всё по машине и периоду из отбора,
 * вид записи не действует. АЗС подешевле — за полгода по всем машинам.
 * Свёрнутый блок показывает у заголовка сумму за период.
 */
function Totals({
  entries,
  filter,
  names,
  currency,
}: {
  entries: readonly Entry[]
  filter: LogFilter
  names: ReadonlyMap<string, string>
  currency: string
}) {
  const stats = periodStats(entries, filter)
  const stations = cheapStations(entries, today())
  const car = filter.carId === null ? 'все машины' : (names.get(filter.carId) ?? MISSING_CAR)

  return (
    <Fold id="journal:totals" title="Итоги" summary={formatMoney(stats.total, currency)}>
      <p className="muted totals__note">
        {car}, {periodTitle(filter.period)}
        {filter.kind !== null && ' — по всем видам: отбор вида на итоги не действует'}
      </p>

      {stats.records === 0 ? (
        <p className="totals__note">За период записей нет.</p>
      ) : (
        <>
          <h3 className="totals__head">Цена километра</h3>
          <ul className="plain totals__cars">
            {stats.cars.map((each) => (
              <li key={each.carId} className="totals__car">
                {filter.carId === null && <span className="car__name">{names.get(each.carId) ?? MISSING_CAR}</span>}
                <span>
                  {perKm(each.allMoney, each.distance) === null
                    ? 'мало данных'
                    : `топливо ${perKmText(each.fuelMoney, each.distance, currency)} · всё ${perKmText(each.allMoney, each.distance, currency)}`}
                </span>
                <span className="muted">{basisText(each)}</span>
                {each.consumption && <span>Средний расход {consumptionText(each.consumption)}</span>}
              </li>
            ))}
          </ul>

          <h3 className="totals__head">Траты по видам</h3>
          <table className="stats">
            <tbody>
              {stats.kinds.map((each) => (
                <tr key={each.kind}>
                  <td>{KIND_LABELS[each.kind]}</td>
                  <td className="num muted">{entriesCount(each.count)}</td>
                  <td className="num">{formatMoney(each.amount, currency)}</td>
                </tr>
              ))}
              <tr className="totals__sum">
                <td>Итого</td>
                <td className="num muted">{entriesCount(stats.records)}</td>
                <td className="num">{formatMoney(stats.total, currency)}</td>
              </tr>
            </tbody>
          </table>
        </>
      )}

      <Fold id="journal:totals:stations" title="АЗС подешевле" sub>
        <p className="muted totals__note">
          Средняя цена литра {CHEAP_SPAN}, по всем машинам: отбор машины и периода на неё не действует.
        </p>
        {stations.length === 0 ? (
          <p className="totals__note">Заправок с АЗС, топливом и литрами {CHEAP_SPAN} нет.</p>
        ) : (
          stations.map((group) => (
            <div key={group.fuel}>
              <h3 className="totals__head">{group.fuel}</h3>
              <table className="stats">
                <tbody>
                  {group.stations.map((station) => (
                    <tr key={station.name}>
                      <td>
                        {station.name}
                        {group.stations.length === 1 && <span className="muted"> · сравнить не с чем</span>}
                      </td>
                      <td className="num muted">{fillsCount(station.count)}</td>
                      <td className="num">{formatMoney(station.price, currency)}/л</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))
        )}
      </Fold>
    </Fold>
  )
}

/** Отбор: машина и вид — выбором, период — кнопками и стрелками. */
function Filters({
  filter,
  onChange,
  cars,
}: {
  filter: LogFilter
  onChange: (filter: LogFilter) => void
  cars: readonly { id: string; name: string; archived?: boolean }[]
}) {
  const { period } = filter
  return (
    <div className="filters">
      <div className="row">
        <select
          name="filter-car"
          aria-label="Машина"
          value={filter.carId ?? ''}
          onChange={(event) => onChange({ ...filter, carId: event.target.value === '' ? null : event.target.value })}
        >
          <option value="">Все машины</option>
          {cars.map((car) => (
            <option key={car.id} value={car.id}>
              {car.archived ? `${car.name} — в архиве` : car.name}
            </option>
          ))}
        </select>
        <select
          name="filter-kind"
          aria-label="Вид"
          value={filter.kind ?? ''}
          onChange={(event) => {
            const kind = KINDS.find((each) => each === event.target.value) ?? null
            onChange({ ...filter, kind })
          }}
        >
          <option value="">Все виды</option>
          {KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {KIND_LABELS[kind]}
            </option>
          ))}
        </select>
      </div>

      <div className="row" role="group" aria-label="Период">
        {PERIOD_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            className={kind === period.kind ? 'btn btn--primary' : 'btn'}
            aria-pressed={kind === period.kind}
            onClick={() => kind !== period.kind && onChange({ ...filter, period: currentPeriod(kind, today()) })}
          >
            {PERIOD_LABELS[kind]}
          </button>
        ))}
      </div>

      {period.kind !== 'all' && (
        <div className="row period">
          <button
            type="button"
            className="btn"
            aria-label="Назад"
            onClick={() => onChange({ ...filter, period: shiftPeriod(period, -1) })}
          >
            ‹
          </button>
          <span className="period__title">{periodTitle(period)}</span>
          <button
            type="button"
            className="btn"
            aria-label="Вперёд"
            onClick={() => onChange({ ...filter, period: shiftPeriod(period, 1) })}
          >
            ›
          </button>
        </div>
      )}
    </div>
  )
}
