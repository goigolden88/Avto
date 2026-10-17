/**
 * Маршруты (Р-12, Р-14): варианты пути между двумя точками, собранные
 * по парам. Направление важно: «Дом → Работа» и «Работа → Дом» — разные пары.
 *
 * Чистые функции, без React и без базы.
 */

import type { Point, Route, Trip } from '../../app/model.ts'
import { MISSING_POINT } from './points.ts'

/** Поля формы маршрута — строками, как в полях ввода. Точки — id, пусто — не выбрана. */
export type RouteDraft = { fromId: string; toId: string; name: string; link: string; note: string }

export function routeDraftOf(route: Route): RouteDraft {
  return { fromId: route.fromId, toId: route.toId, name: route.name, link: route.link ?? '', note: route.note ?? '' }
}

/** Новый маршрут: пара подставлена, если известна, — например, из открытой пары. */
export function newRouteDraft(fromId = '', toId = ''): RouteDraft {
  return { fromId, toId, name: '', link: '', note: '' }
}

export const SAME_POINT = '«Откуда» и «куда» — одна точка: выберите разные'

export type RouteResult = { ok: true; route: Route } | { ok: false; errors: string[] }

/**
 * Маршрут из формы. Точки и имя обязательны, точки — разные; ссылка
 * и заметка — по желанию: пустое поле в запись не пишется, прежнее значение
 * стирается. Адрес ссылки не проверяется — что вписано, то и откроется.
 */
export function buildRoute(draft: RouteDraft, base: Route | undefined, id: string, at: string): RouteResult {
  const errors: string[] = []
  const name = draft.name.trim()
  if (!draft.fromId) errors.push('Выберите, откуда')
  if (!draft.toId) errors.push('Выберите, куда')
  if (draft.fromId && draft.fromId === draft.toId) errors.push(SAME_POINT)
  if (!name) errors.push('Впишите имя маршрута')
  if (errors.length > 0) return { ok: false, errors }

  const { link: _link, note: _note, ...rest } = base ?? { id, updatedAt: at }
  const route: Route = { ...rest, id: base?.id ?? id, updatedAt: at, fromId: draft.fromId, toId: draft.toId, name }
  const link = draft.link.trim()
  const note = draft.note.trim()
  if (link) route.link = link
  if (note) route.note = note
  return { ok: true, route }
}

/** Имена живых точек по id. */
export function pointNames(points: readonly Point[]): Map<string, string> {
  return new Map(points.filter((point) => !point.deleted).map((point) => [point.id, point.name]))
}

/** «Дом → Работа». Точки нет — «точка не найдена». */
export function pairTitle(fromId: string, toId: string, names: ReadonlyMap<string, string>): string {
  return `${names.get(fromId) ?? MISSING_POINT} → ${names.get(toId) ?? MISSING_POINT}`
}

/** «Дом → Работа · по МКАД» — маршрут целиком, для выбора и карточки замера. */
export function routeTitle(route: Route, names: ReadonlyMap<string, string>): string {
  return `${pairTitle(route.fromId, route.toId, names)} · ${route.name}`
}

/** Ключ пары: откуда и куда. ULID без дефиса — разделитель не путается. */
export function pairKey(fromId: string, toId: string): string {
  return `${fromId}-${toId}`
}

export type Pair = { key: string; fromId: string; toId: string; title: string; routes: Route[] }

/**
 * Живые маршруты по парам точек. Пары — по имени пары, маршруты внутри — по
 * порядку заведения; порядок по скорости наводит сравнение (`compare.ts`).
 */
export function pairsOf(routes: readonly Route[], points: readonly Point[]): Pair[] {
  const names = pointNames(points)
  const pairs = new Map<string, Pair>()
  const live = routes.filter((route) => !route.deleted).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  for (const route of live) {
    const key = pairKey(route.fromId, route.toId)
    let pair = pairs.get(key)
    if (!pair) {
      pair = { key, fromId: route.fromId, toId: route.toId, title: pairTitle(route.fromId, route.toId, names), routes: [] }
      pairs.set(key, pair)
    }
    pair.routes.push(route)
  }
  return [...pairs.values()].sort((a, b) => a.title.localeCompare(b.title, 'ru'))
}

/**
 * Жив ли маршрут для замера: сам не удалён и обе его точки на месте. Нет —
 * удалили на другом устройстве, и замер остаётся только выбросить.
 */
export function routeAlive(routeId: string, routes: readonly Route[], points: readonly Point[]): Route | null {
  const route = routes.find((each) => each.id === routeId && !each.deleted)
  if (!route) return null
  const names = pointNames(points)
  return names.has(route.fromId) && names.has(route.toId) ? route : null
}

/** Живые поездки маршрута. */
export function tripsOf(routeId: string, trips: readonly Trip[]): Trip[] {
  return trips.filter((trip) => trip.routeId === routeId && !trip.deleted)
}

/**
 * Удаление маршрута вместе с поездками: метка `deleted` на маршруте и на
 * каждой его живой поездке. Метки, а не стирание, — так удаление доезжает
 * до других устройств синхронизацией.
 */
export function routeDeletion(route: Route, trips: readonly Trip[]): { route: Route; trips: Trip[] } {
  return {
    route: { ...route, deleted: true },
    trips: tripsOf(route.id, trips).map((trip) => ({ ...trip, deleted: true })),
  }
}
