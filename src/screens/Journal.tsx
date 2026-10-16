import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Entry } from '../app/model.ts'
import { activeCars, defaultCarId, MISSING_CAR, sortCars } from '../modules/log/cars.ts'
import { draftOf, entryDetails, KIND_LABELS, KINDS, newDraft, sortEntries, type EntryDraft } from '../modules/log/entries.ts'
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
import { formatDateLoose, today } from '../shared/core/dates.ts'
import { EntryForm } from './EntryForm.tsx'
import type { LogData } from './useLog.ts'

/** Что открыто: журнал или форма — новой записи (`base` нет) или правки. */
type Editing = { draft: EntryDraft; base?: Entry } | null

/**
 * Журнал на «Главной» (Р-03): заправки, мойки, ремонты, штрафы и прочее
 * одним списком, свежие сверху. Отбор — по машине, виду и периоду; рядом
 * с ним — сколько записей показано.
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
        <section className="block">
          <Filters filter={filter} onChange={setFilter} cars={sortCars(cars)} />
          <p className="muted journal__count">{shownText(shown.length, total)}</p>

          {shown.length === 0 ? (
            <div className="home-empty">
              <p>{filter.period.kind === 'all' ? 'Подходящих записей нет.' : 'За этот период записей нет.'}</p>
              <p className="muted">За всё время — {entriesCount(total)}.</p>
            </div>
          ) : (
            <ul className="plain entries">
              {shown.map((entry) => {
                const details = entryDetails(entry, currency)
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
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}
    </div>
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
