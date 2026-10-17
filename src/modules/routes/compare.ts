/**
 * Сравнение маршрутов одной пары точек (Р-14): медиана минут по маршруту,
 * по часу выезда и будни / выходные; рядом — число поездок и сколько из них
 * вписано вручную. Поездки с заметкой не выкидываются: медиана устойчива к
 * одной пробке, а заметка объясняет выброс.
 *
 * Чистые функции, без React и без базы. Ничего из этого не хранится (Р-09).
 */

import type { Route, Trip } from '../../app/model.ts'
import { daysBetween, isDateStr, plural, weekStart } from '../../shared/core/dates.ts'

/**
 * Медиана, округлённая до минуты; при чётном числе — среднее двух средних.
 * Пусто — null: «поездок нет», а не «0 мин».
 */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const value = sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
  return Math.round(value)
}

/** Час выезда: 7:00–7:59 — 7. Испорченное время — null. */
export function hourOf(start: string): number | null {
  const match = /^(\d{1,2}):\d{2}$/.exec(start.trim())
  if (!match) return null
  const hour = Number(match[1])
  return hour >= 0 && hour <= 23 ? hour : null
}

/** Суббота и воскресенье; праздники не учитываются. Испорченная дата — null. */
export function isWeekend(date: string): boolean | null {
  if (!isDateStr(date)) return null
  // Неделя — с понедельника: суббота — пятый день от него, воскресенье — шестой.
  return daysBetween(weekStart(date), date) >= 5
}

/** Медиана и на скольких поездках она посчитана. */
export type Basis = { median: number | null; count: number }

export type RouteStats = Basis & {
  /** Вписаны вручную. */
  manual: number
  /** Только часы, в которые были поездки, по порядку. */
  byHour: (Basis & { hour: number })[]
  weekdays: Basis
  weekend: Basis
}

function basis(trips: readonly Trip[]): Basis {
  return { median: median(trips.map((trip) => trip.minutes)), count: trips.length }
}

/** Расчёт по живым поездкам одного маршрута. */
export function routeStats(trips: readonly Trip[]): RouteStats {
  const live = trips.filter((trip) => !trip.deleted)
  const hours = new Map<number, Trip[]>()
  for (const trip of live) {
    const hour = hourOf(trip.start)
    if (hour === null) continue
    hours.set(hour, [...(hours.get(hour) ?? []), trip])
  }
  return {
    ...basis(live),
    manual: live.filter((trip) => trip.source === 'manual').length,
    byHour: [...hours.entries()].sort(([a], [b]) => a - b).map(([hour, list]) => ({ hour, ...basis(list) })),
    weekdays: basis(live.filter((trip) => isWeekend(trip.date) === false)),
    weekend: basis(live.filter((trip) => isWeekend(trip.date) === true)),
  }
}

/**
 * Маршруты пары по возрастанию медианы — быстрый сверху; без поездок — в
 * конце, в порядке заведения.
 */
export function rankRoutes(routes: readonly Route[], trips: readonly Trip[]): { route: Route; stats: RouteStats }[] {
  const byRoute = new Map<string, Trip[]>()
  for (const trip of trips) {
    if (trip.deleted) continue
    byRoute.set(trip.routeId, [...(byRoute.get(trip.routeId) ?? []), trip])
  }
  return routes
    .map((route) => ({ route, stats: routeStats(byRoute.get(route.id) ?? []) }))
    .sort((a, b) => {
      const x = a.stats.median
      const y = b.stats.median
      if (x !== y) return x === null ? 1 : y === null ? -1 : x - y
      return a.route.id < b.route.id ? -1 : a.route.id > b.route.id ? 1 : 0
    })
}

// ─── Тексты ────────────────────────────────────────────────────────────────

/** `1 поездка`, `2 поездки`, `5 поездок`. */
export function tripsCount(n: number): string {
  return `${n} ${plural(n, ['поездка', 'поездки', 'поездок'])}`
}

export const NO_TRIPS = 'поездок нет'

/** «38 мин — медиана 6 поездок»; пусто — «поездок нет». */
export function basisText(each: Basis): string {
  if (each.median === null) return NO_TRIPS
  return `${each.median} мин — медиана ${each.count} ${plural(each.count, ['поездки', 'поездок', 'поездок'])}`
}

/** «вручную — 2 из 6»; ручных нет — «все замером». */
export function manualText(stats: RouteStats): string {
  return stats.manual === 0 ? 'все замером' : `вручную — ${stats.manual} из ${stats.count}`
}

/** «7 ч». */
export function hourText(hour: number): string {
  return `${hour} ч`
}
