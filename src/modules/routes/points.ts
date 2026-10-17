/**
 * Точки маршрутов (Р-12): «Дом», «Работа», «ТЦ Мега», у каждой — город.
 *
 * Чистые функции, без React и без базы. Хранилище — `points`, не `places`:
 * то имя у ядра — раскладка файлов (Р-12).
 */

import type { Parking, Point, Route } from '../../app/model.ts'

/** Вместо имени, когда маршрут есть, а его точки нет: удалена или ещё не приехала. */
export const MISSING_POINT = 'точка не найдена'

/** Поля формы точки — строками, как в полях ввода. */
export type PointDraft = { name: string; city: string }

export function pointDraftOf(point: Point): PointDraft {
  return { name: point.name, city: point.city }
}

/** Точки в порядке заведения, без удалённых: id — ULID, его порядок — время. */
export function sortPoints(points: readonly Point[]): Point[] {
  return points.filter((point) => !point.deleted).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** Город новой точки — из последней заведённой. Точек нет — пусто. */
export function newPointDraft(points: readonly Point[]): PointDraft {
  return { name: '', city: sortPoints(points).at(-1)?.city ?? '' }
}

export type PointResult = { ok: true; point: Point } | { ok: false; errors: string[] }

/** Точка из формы. Имя и город обязательны. Прочие поля прежней записи остаются. */
export function buildPoint(draft: PointDraft, base: Point | undefined, id: string, at: string): PointResult {
  const errors: string[] = []
  const name = draft.name.trim()
  const city = draft.city.trim()
  if (!name) errors.push('Впишите имя точки')
  if (!city) errors.push('Впишите город')
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, point: { ...base, id: base?.id ?? id, updatedAt: at, name, city } }
}

/** Живые маршруты, в которых стоит точка, — откуда или куда. */
export function routesOfPoint(pointId: string, routes: readonly Route[]): Route[] {
  return routes.filter((route) => !route.deleted && (route.fromId === pointId || route.toId === pointId))
}

/** Живые места парковки у точки. */
export function parkingsOfPoint(pointId: string, parkings: readonly Parking[]): Parking[] {
  return parkings.filter((parking) => !parking.deleted && parking.pointId === pointId)
}

/**
 * Почему точку не удалить: она в маршрутах или у мест парковки —
 * «Сначала удалите маршруты: 2 и уберите точку у мест: 1». Null — удалить можно.
 */
export function pointDeleteBlock(pointId: string, routes: readonly Route[], parkings: readonly Parking[]): string | null {
  const steps: string[] = []
  const inRoutes = routesOfPoint(pointId, routes).length
  const atParkings = parkingsOfPoint(pointId, parkings).length
  if (inRoutes > 0) steps.push(`удалите маршруты: ${inRoutes}`)
  if (atParkings > 0) steps.push(`уберите точку у мест: ${atParkings}`)
  return steps.length === 0 ? null : `Сначала ${steps.join(' и ')}`
}
