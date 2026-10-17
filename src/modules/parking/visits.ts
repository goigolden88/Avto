/**
 * Отметки парковки (Р-16): встал или нет — сразу, с трудом, мест нет — и
 * сколько минут искал. Дата — сегодня, время — сейчас, место — из своих.
 *
 * Чистые функции, без React и без базы.
 */

import type { ParkingVisit } from '../../app/model.ts'
import { isDateStr } from '../../shared/core/dates.ts'
import { parseTime } from '../routes/trips.ts'

export type VisitResult = ParkingVisit['result']

/** Порядок кнопок в форме и долей в расчётах. */
export const RESULTS: readonly VisitResult[] = ['easy', 'hard', 'none']

/** Как результат назван человеку. */
export const RESULT_LABELS: Record<VisitResult, string> = {
  easy: 'сразу',
  hard: 'с трудом',
  none: 'мест нет',
}

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

export const SEARCH_MINUTES_ERROR = 'Минуты поиска — целое число от 0'

/**
 * Минуты поиска: пусто — не указаны (undefined), целое от 0 — число;
 * 0 — «встал без поиска». Минус, дробь, текст — null: ошибка.
 */
export function parseSearchMinutes(input: string): number | undefined | null {
  const value = input.trim()
  if (value === '') return undefined
  return /^\d+$/.test(value) ? Number(value) : null
}

export type VisitBuild = { ok: true; visit: ParkingVisit } | { ok: false; errors: string[] }

/**
 * Отметка из формы. Место, дата, время и результат обязательны; минуты
 * и заметка — по желанию: пустое поле в запись не пишется, прежнее стирается.
 */
export function buildVisit(draft: VisitDraft, base: ParkingVisit | undefined, id: string, at: string): VisitBuild {
  const errors: string[] = []
  if (!draft.parkingId) errors.push('Выберите место')
  if (!isDateStr(draft.date)) errors.push('Укажите дату')
  const time = parseTime(draft.time)
  if (time === null) errors.push('Укажите время — ЧЧ:ММ')
  const result = draft.result
  if (result === '') errors.push('Отметьте, как встали: сразу, с трудом или мест нет')
  const minutes = parseSearchMinutes(draft.searchMinutes)
  if (minutes === null) errors.push(SEARCH_MINUTES_ERROR)
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

/** Минуты в строке отметки: «12 мин поиска», 0 — «встал без поиска», нет — пусто. */
export function searchLabel(visit: ParkingVisit): string {
  if (visit.searchMinutes === undefined) return ''
  return visit.searchMinutes === 0 ? 'встал без поиска' : `${visit.searchMinutes} мин поиска`
}
