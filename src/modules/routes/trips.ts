/**
 * Поездки (Р-13): замером — «Поехал» / «Приехал» — или вручную: когда
 * выехал и сколько минут ехал. `source` помечает, откуда запись; в сравнении
 * участвуют обе.
 *
 * Чистые функции, без React и без базы. Машина по умолчанию (Р-21) приходит
 * аргументом: её выбирает `defaultCarId` журнала.
 */

import type { Trip } from '../../app/model.ts'
import { isDateStr } from '../../shared/core/dates.ts'

/** Как поездка показана в списке: откуда минуты. */
export const SOURCE_LABELS: Record<Trip['source'], string> = {
  timer: 'замер',
  manual: 'вручную',
}

/** Поля формы поездки — строками. Машина пустая — без машины. */
export type TripDraft = {
  routeId: string
  date: string
  start: string
  minutes: string
  carId: string
  note: string
}

export function tripDraftOf(trip: Trip): TripDraft {
  return {
    routeId: trip.routeId,
    date: trip.date,
    start: trip.start,
    minutes: String(trip.minutes),
    carId: trip.carId ?? '',
    note: trip.note ?? '',
  }
}

/** Новая поездка вручную: дата — сегодня, машина — по умолчанию (или без неё). */
export function newTripDraft(routeId: string, day: string, carId: string | null): TripDraft {
  return { routeId, date: day, start: '', minutes: '', carId: carId ?? '', note: '' }
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

/** Время ЧЧ:ММ: «7:05» дополняется нулём, «25:00» — не время. */
export function parseTime(input: string): string | null {
  const value = input.trim()
  const padded = /^\d:\d\d$/.test(value) ? `0${value}` : value
  return TIME.test(padded) ? padded : null
}

export const MINUTES_ERROR = 'Минуты — целое число больше нуля'

/** Минуты в пути: целое число больше нуля. Иначе — null. */
export function parseMinutes(input: string): number | null {
  const value = input.trim()
  if (!/^\d+$/.test(value)) return null
  const minutes = Number(value)
  return minutes > 0 ? minutes : null
}

export type TripResult = { ok: true; trip: Trip } | { ok: false; errors: string[] }

/**
 * Поездка из формы. Маршрут, дата, время выезда и минуты обязательны;
 * машина и заметка — по желанию. Новая — «вручную», у правки отметка
 * остаётся прежней: замер, поправленный руками, всё равно начат замером.
 */
export function buildTrip(draft: TripDraft, base: Trip | undefined, id: string, at: string): TripResult {
  const errors: string[] = []
  if (!draft.routeId) errors.push('Выберите маршрут')
  if (!isDateStr(draft.date)) errors.push('Укажите дату')
  const start = parseTime(draft.start)
  if (start === null) errors.push('Укажите время выезда — ЧЧ:ММ')
  const minutes = parseMinutes(draft.minutes)
  if (minutes === null) errors.push(MINUTES_ERROR)
  if (errors.length > 0 || start === null || minutes === null) return { ok: false, errors }

  const { carId: _carId, note: _note, ...rest } = base ?? { id, updatedAt: at }
  const trip: Trip = {
    ...rest,
    id: base?.id ?? id,
    updatedAt: at,
    routeId: draft.routeId,
    date: draft.date,
    start,
    minutes,
    source: base?.source ?? 'manual',
  }
  const note = draft.note.trim()
  if (draft.carId) trip.carId = draft.carId
  if (note) trip.note = note
  return { ok: true, trip }
}

/** Свежие сверху: по дате, затем по времени выезда, затем по внесению. */
export function sortTrips(trips: readonly Trip[]): Trip[] {
  return trips
    .filter((trip) => !trip.deleted)
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1
      if (a.start !== b.start) return a.start < b.start ? 1 : -1
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
    })
}
