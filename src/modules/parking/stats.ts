/**
 * Когда проще (Р-16, Р-31): по месту — доли трёх результатов всех отметок,
 * по часу и по дню недели; медиана минут. Рядом — всегда число отметок:
 * порога «мало отметок» нет, основание видно. Счёт от вида места не зависит,
 * подписи — по виду: «сразу / с трудом / мест нет» у парковки, «свободно /
 * плотно / стоим» у участка дороги.
 *
 * Медиана, час и его подпись — общие с маршрутами (`routes/compare.ts`).
 * Чистые функции, без React и без базы. Ничего из этого не хранится (Р-09).
 */

import type { ParkingVisit } from '../../app/model.ts'
import { daysBetween, isDateStr, plural, weekStart } from '../../shared/core/dates.ts'
import { hourOf, median } from '../routes/compare.ts'
import { KIND_TEXTS, type PlaceKind } from './kinds.ts'
import { RESULTS, type VisitResult } from './visits.ts'

/** Сколько отметок каждого результата и всего. */
export type Shares = Record<VisitResult, number> & { count: number }

/** Медиана минут (поиска, проезда), на скольких отметках с минутами и сколько без них. */
export type Search = { median: number | null; count: number; without: number }

export type ParkingStats = Shares & {
  search: Search
  /** Только часы, в которые были отметки, по порядку. */
  byHour: (Shares & { hour: number })[]
  /** Только дни с отметками, с понедельника: 0 — понедельник, 6 — воскресенье. */
  byWeekday: (Shares & { day: number })[]
}

function shares(visits: readonly ParkingVisit[]): Shares {
  const counts: Shares = { easy: 0, hard: 0, none: 0, count: visits.length }
  for (const visit of visits) counts[visit.result] += 1
  return counts
}

/** День недели с понедельника: 0 — понедельник, 6 — воскресенье. Испорченная дата — null. */
export function weekdayOf(date: string): number | null {
  return isDateStr(date) ? daysBetween(weekStart(date), date) : null
}

function grouped<K extends number>(visits: readonly ParkingVisit[], keyOf: (visit: ParkingVisit) => K | null): [K, Shares][] {
  const groups = new Map<K, ParkingVisit[]>()
  for (const visit of visits) {
    const key = keyOf(visit)
    if (key === null) continue
    groups.set(key, [...(groups.get(key) ?? []), visit])
  }
  return [...groups.entries()].sort(([a], [b]) => a - b).map(([key, list]) => [key, shares(list)])
}

/** Расчёт по живым отметкам одного места. */
export function parkingStats(visits: readonly ParkingVisit[]): ParkingStats {
  const live = visits.filter((visit) => !visit.deleted)
  const minutes = live.flatMap((visit) => (visit.searchMinutes === undefined ? [] : [visit.searchMinutes]))
  return {
    ...shares(live),
    search: { median: median(minutes), count: minutes.length, without: live.length - minutes.length },
    byHour: grouped(live, (visit) => hourOf(visit.time)).map(([hour, each]) => ({ hour, ...each })),
    byWeekday: grouped(live, (visit) => weekdayOf(visit.date)).map(([day, each]) => ({ day, ...each })),
  }
}

// ─── Тексты ────────────────────────────────────────────────────────────────

export const NO_VISITS = 'отметок нет'

/** Дни недели в таблице, с понедельника. */
export const WEEKDAY_LABELS: readonly string[] = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

/** `1 отметка`, `2 отметки`, `5 отметок`. */
export function visitsCount(n: number): string {
  return `${n} ${plural(n, ['отметка', 'отметки', 'отметок'])}`
}

/** Доля до целого процента. Сумма долей бывает 99 или 101 — так и показывается. */
export function percent(part: number, count: number): number {
  return count === 0 ? 0 : Math.round((part / count) * 100)
}

/** «сразу 60 %, с трудом 30 %, мест нет 10 %» — подписи по виду; отметок нет — «отметок нет». */
export function sharesLine(each: Shares, kind: PlaceKind): string {
  if (each.count === 0) return NO_VISITS
  const labels = KIND_TEXTS[kind].results
  return RESULTS.map((result) => `${labels[result]} ${percent(each[result], each.count)} %`).join(', ')
}

/** «сразу 60 %, с трудом 30 %, мест нет 10 % — по 10 отметкам»; пусто — «отметок нет». */
export function sharesText(each: Shares, kind: PlaceKind): string {
  if (each.count === 0) return NO_VISITS
  return `${sharesLine(each, kind)} — по ${each.count} ${plural(each.count, ['отметке', 'отметкам', 'отметкам'])}`
}

/** «7 мин — медиана 6 отметок»; минут нет ни у одной — «минут поиска нет», «минут проезда нет». */
export function searchText(search: Search, kind: PlaceKind): string {
  if (search.median === null) return KIND_TEXTS[kind].noMinutes
  return `${search.median} мин — медиана ${search.count} ${plural(search.count, ['отметки', 'отметок', 'отметок'])}`
}

/** Рядом с медианой — что в неё не вошло: «без минут — 4 из 10»; все с минутами — пусто. */
export function withoutText(search: Search): string {
  return search.without === 0 ? '' : `без минут — ${search.without} из ${search.count + search.without}, в медиану не входят`
}
