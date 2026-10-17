/**
 * Места парковки (Р-16): «двор за домом», «ТЦ Мега, минус первый» — город,
 * у какой точки (по желанию), цена строкой справочно, ссылка и заметка.
 *
 * Цена — строка: деньгами не считается и в «Итоги» журнала не идёт.
 * Оплата парковки, если её хочется считать, — запись «Прочее» в журнале.
 *
 * Чистые функции, без React и без базы.
 */

import type { Parking, ParkingVisit, Point } from '../../app/model.ts'
import { sortPoints } from '../routes/points.ts'

/** Поля формы места — строками, как в полях ввода. Точка пустая — без точки. */
export type ParkingDraft = { where: string; city: string; pointId: string; price: string; link: string; note: string }

export function parkingDraftOf(parking: Parking): ParkingDraft {
  return {
    where: parking.where,
    city: parking.city,
    pointId: parking.pointId ?? '',
    price: parking.price ?? '',
    link: parking.link ?? '',
    note: parking.note ?? '',
  }
}

/** Места в порядке заведения, без удалённых: id — ULID, его порядок — время. */
export function sortParkings(parkings: readonly Parking[]): Parking[] {
  return parkings.filter((parking) => !parking.deleted).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** Город нового места — из последнего заведённого места, иначе из последней точки. */
export function newParkingDraft(parkings: readonly Parking[], points: readonly Point[]): ParkingDraft {
  const city = sortParkings(parkings).at(-1)?.city ?? sortPoints(points).at(-1)?.city ?? ''
  return { where: '', city, pointId: '', price: '', link: '', note: '' }
}

export type ParkingResult = { ok: true; parking: Parking } | { ok: false; errors: string[] }

/**
 * Место из формы. «Где» и город обязательны; точка, цена, ссылка и заметка —
 * по желанию: пустое поле в запись не пишется, прежнее значение стирается.
 * Адрес ссылки не проверяется — что вписано, то и откроется.
 */
export function buildParking(draft: ParkingDraft, base: Parking | undefined, id: string, at: string): ParkingResult {
  const errors: string[] = []
  const where = draft.where.trim()
  const city = draft.city.trim()
  if (!where) errors.push('Впишите, где место')
  if (!city) errors.push('Впишите город')
  if (errors.length > 0) return { ok: false, errors }

  const { pointId: _pointId, price: _price, link: _link, note: _note, ...rest } = base ?? { id, updatedAt: at }
  const parking: Parking = { ...rest, id: base?.id ?? id, updatedAt: at, city, where }
  const price = draft.price.trim()
  const link = draft.link.trim()
  const note = draft.note.trim()
  if (draft.pointId) parking.pointId = draft.pointId
  if (price) parking.price = price
  if (link) parking.link = link
  if (note) parking.note = note
  return { ok: true, parking }
}

export type CityGroup = { city: string; parkings: Parking[] }

/** Живые места по городу: города — по алфавиту, места внутри — в порядке заведения. */
export function parkingsByCity(parkings: readonly Parking[]): CityGroup[] {
  const groups = new Map<string, Parking[]>()
  for (const parking of sortParkings(parkings)) groups.set(parking.city, [...(groups.get(parking.city) ?? []), parking])
  return [...groups.entries()]
    .map(([city, list]) => ({ city, parkings: list }))
    .sort((a, b) => a.city.localeCompare(b.city, 'ru'))
}

/** Живые отметки места. */
export function visitsOf(parkingId: string, visits: readonly ParkingVisit[]): ParkingVisit[] {
  return visits.filter((visit) => visit.parkingId === parkingId && !visit.deleted)
}

/**
 * Какое место подставить в отметку с общей кнопки: место последней внесённой
 * отметки (по id — по времени внесения), если оно живо; иначе первое
 * заведённое. Мест нет — пусто.
 */
export function defaultParkingId(parkings: readonly Parking[], visits: readonly ParkingVisit[]): string {
  const live = sortParkings(parkings)
  const ids = new Set(live.map((parking) => parking.id))
  let latest: ParkingVisit | undefined
  for (const visit of visits) {
    if (visit.deleted || !ids.has(visit.parkingId)) continue
    if (!latest || visit.id > latest.id) latest = visit
  }
  return latest?.parkingId ?? live[0]?.id ?? ''
}

/**
 * Удаление места вместе с отметками: метка `deleted` на месте и на каждой
 * его живой отметке. Метки, а не стирание, — так удаление доезжает до других
 * устройств синхронизацией.
 */
export function parkingDeletion(parking: Parking, visits: readonly ParkingVisit[]): { parking: Parking; visits: ParkingVisit[] } {
  return {
    parking: { ...parking, deleted: true },
    visits: visitsOf(parking.id, visits).map((visit) => ({ ...visit, deleted: true })),
  }
}
