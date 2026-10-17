/**
 * Замер поездки (Р-13): «Поехал» — «Приехал». Незаконченный замер живёт
 * только на устройстве — в `settings` ядра, как главная машина (Р-21), —
 * и в базу записей не пишется и не синхронизируется: замер, начатый на
 * телефоне, на компьютере не виден.
 *
 * Чистые функции, без React и без базы: что хранить, сколько минут прошло,
 * не забыли ли нажать «Приехал», какая поездка выйдет.
 */

import type { Trip } from '../../app/model.ts'
import { plural, toDateStr } from '../../shared/core/dates.ts'

/** Идущий замер: какой маршрут и когда нажали «Поехал», мс. */
export type Timer = { routeId: string; startedAt: number }

/** Ключ замера в `settings` устройства. */
export const TIMER_KEY = 'tripTimer'

/** Дольше — «забыл нажать «Приехал»»: такие минуты молча не сохраняются. */
export const TIMER_LIMIT_HOURS = 12

const MINUTE = 60_000
const LIMIT_MS = TIMER_LIMIT_HOURS * 60 * MINUTE

/** `12 часов` — для фраз о пороге. */
export const TIMER_LIMIT_TEXT = `${TIMER_LIMIT_HOURS} ${plural(TIMER_LIMIT_HOURS, ['часа', 'часов', 'часов'])}`

/** Замер из настроек устройства. Не тот вид — как нет замера. */
export function readTimer(value: unknown): Timer | null {
  if (typeof value !== 'object' || value === null) return null
  const { routeId, startedAt } = value as Partial<Timer>
  if (typeof routeId !== 'string' || routeId === '') return null
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return null
  return { routeId, startedAt }
}

/** Минуты в пути: округлённые до целых, не меньше одной. */
export function timerMinutes(timer: Timer, now: number): number {
  return Math.max(1, Math.round((now - timer.startedAt) / MINUTE))
}

/** Замер идёт дольше порога — похоже, забыли нажать «Приехал». */
export function timerOverdue(timer: Timer, now: number): boolean {
  return now - timer.startedAt > LIMIT_MS
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Дата и время «Поехал» по местному времени. */
export function timerStart(timer: Timer): { date: string; start: string } {
  const at = new Date(timer.startedAt)
  return { date: toDateStr(at), start: `${pad2(at.getHours())}:${pad2(at.getMinutes())}` }
}

/**
 * Поездка из замера: дата и время выезда — с «Поехал», минуты — до «Приехал»
 * или вписанные руками, отметка «замер». Машина — по желанию.
 */
export function tripFromTimer(
  timer: Timer,
  minutes: number,
  carId: string | null,
  id: string,
  at: string,
): Trip {
  const trip: Trip = { id, updatedAt: at, routeId: timer.routeId, ...timerStart(timer), minutes, source: 'timer' }
  if (carId) trip.carId = carId
  return trip
}
