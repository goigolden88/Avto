/**
 * Отметки места (Р-16, Р-31): как вышло — у парковки «сразу, с трудом, мест
 * нет», у участка дороги «свободно, плотно, стоим» — и сколько минут ушло.
 * Дата — сегодня, время — сейчас, место — из своих. Подписи — по виду места
 * (`kinds.ts`), значения в базе у всех видов одни.
 *
 * Чистые функции, без React и без базы.
 */

import type { Parking, ParkingVisit } from '../../app/model.ts'
import { isDateStr } from '../../shared/core/dates.ts'
import { parseTime } from '../routes/trips.ts'
import { KIND_TEXTS, kindOf, type PlaceKind, type VisitResult } from './kinds.ts'

export type { VisitResult }

/** Порядок кнопок в форме и долей в расчётах. */
export const RESULTS: readonly VisitResult[] = ['easy', 'hard', 'none']

/** Вместо места, когда отметка есть, а места нет: удалено или ещё не приехало. */
export const MISSING_PARKING = 'место не найдено'

/** Поля формы отметки — строками. Результат пустой — ещё не выбран. */
export type VisitDraft = {
  parkingId: string
  date: string
  time: string
  result: VisitResult | ''
  searchMinutes: string
  note: string
}

export function visitDraftOf(visit: ParkingVisit): VisitDraft {
  return {
    parkingId: visit.parkingId,
    date: visit.date,
    time: visit.time,
    result: visit.result,
    searchMinutes: visit.searchMinutes === undefined ? '' : String(visit.searchMinutes),
    note: visit.note ?? '',
  }
}

/** Время ЧЧ:ММ по часам устройства — «сейчас» новой отметки. */
export function timeOf(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** Новая отметка: дата — сегодня, время — сейчас, результат не выбран. */
export function newVisitDraft(parkingId: string, day: string, time: string): VisitDraft {
  return { parkingId, date: day, time, result: '', searchMinutes: '', note: '' }
}

/**
 * Место отметки сменили в форме. Вид другой — выбранный результат
 * сбрасывается: те же кнопки значат уже другое («сразу» — не «свободно»).
 * Место не найдено — оно парковка.
 */
export function withPlace(draft: VisitDraft, parkingId: string, parkings: readonly Parking[]): VisitDraft {
  const kind = (id: string) => kindOf(parkings.find((parking) => parking.id === id))
  const result = kind(draft.parkingId) === kind(parkingId) ? draft.result : ''
  return { ...draft, parkingId, result }
}

/**
 * Минуты: пусто — не указаны (undefined), целое от 0 — число; 0 — «встал
 * без поиска», «меньше минуты». Минус, дробь, текст — null: ошибка.
 */
export function parseSearchMinutes(input: string): number | undefined | null {
  const value = input.trim()
  if (value === '') return undefined
  return /^\d+$/.test(value) ? Number(value) : null
}

export type VisitBuild = { ok: true; visit: ParkingVisit } | { ok: false; errors: string[] }

/** «Отметьте, как встали: сразу, с трудом или мест нет» — по виду места. */
export function resultError(kind: PlaceKind): string {
  const { ask, results } = KIND_TEXTS[kind]
  return `Отметьте, ${ask.toLowerCase()}: ${results.easy}, ${results.hard} или ${results.none}`
}

/**
 * Отметка из формы. Место, дата, время и результат обязательны; минуты
 * и заметка — по желанию: пустое поле в запись не пишется, прежнее стирается.
 * Вид места — только для текста ошибок.
 */
export function buildVisit(draft: VisitDraft, base: ParkingVisit | undefined, id: string, at: string, kind: PlaceKind): VisitBuild {
  const errors: string[] = []
  if (!draft.parkingId) errors.push('Выберите место')
  if (!isDateStr(draft.date)) errors.push('Укажите дату')
  const time = parseTime(draft.time)
  if (time === null) errors.push('Укажите время — ЧЧ:ММ')
  const result = draft.result
  if (result === '') errors.push(resultError(kind))
  const minutes = parseSearchMinutes(draft.searchMinutes)
  if (minutes === null) errors.push(KIND_TEXTS[kind].minutesError)
  if (errors.length > 0 || time === null || result === '' || minutes === null) return { ok: false, errors }

  const { searchMinutes: _minutes, note: _note, ...rest } = base ?? { id, updatedAt: at }
  const visit: ParkingVisit = { ...rest, id: base?.id ?? id, updatedAt: at, parkingId: draft.parkingId, date: draft.date, time, result }
  const note = draft.note.trim()
  if (minutes !== undefined) visit.searchMinutes = minutes
  if (note) visit.note = note
  return { ok: true, visit }
}

/** Свежие сверху: по дате, затем по времени, затем по внесению. */
export function sortVisits(visits: readonly ParkingVisit[]): ParkingVisit[] {
  return visits
    .filter((visit) => !visit.deleted)
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1
      if (a.time !== b.time) return a.time < b.time ? 1 : -1
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
    })
}

/**
 * Минуты в строке отметки по виду места: «12 мин поиска», 0 — «встал без
 * поиска»; у участка — «12 мин проезда», 0 — «меньше минуты». Нет — пусто.
 */
export function searchLabel(visit: ParkingVisit, kind: PlaceKind): string {
  if (visit.searchMinutes === undefined) return ''
  const texts = KIND_TEXTS[kind]
  return visit.searchMinutes === 0 ? texts.zero : texts.minutes(visit.searchMinutes)
}
