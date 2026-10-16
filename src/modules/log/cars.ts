/**
 * Машины (Р-04): ввод, архив, удаление с записями и какая машина
 * подставляется в новую запись.
 *
 * Чистые функции, без React и без базы. Главная машина устройства (Р-21)
 * приходит сюда аргументом: хранит её экран в настройках устройства, а не
 * в базе.
 */

import type { Car, Entry } from '../../app/model.ts'
import { numberInput, parseNumber } from './numbers.ts'

/** Вместо названия, когда записи есть, а её машины нет: приехала синхронизацией раньше. */
export const MISSING_CAR = 'машина не найдена'

/** Поля формы машины — строками, как в полях ввода. */
export type CarDraft = { name: string; plate: string; fuel: string; tank: string }

export const EMPTY_CAR: CarDraft = { name: '', plate: '', fuel: '', tank: '' }

export function carDraftOf(car: Car): CarDraft {
  return { name: car.name, plate: car.plate ?? '', fuel: car.fuel ?? '', tank: numberInput(car.tank) }
}

export type CarResult = { ok: true; car: Car } | { ok: false; errors: string[] }

/**
 * Машина из формы. Название обязательно, остальное — по желанию. Пустое
 * необязательное поле в запись не пишется, а прежнее значение стирается.
 * Прочие поля прежней записи (`archived`) остаются: форма их не показывает.
 */
export function buildCar(draft: CarDraft, base: Car | undefined, id: string, at: string): CarResult {
  const errors: string[] = []
  const name = draft.name.trim()
  if (!name) errors.push('Впишите название машины')
  const tank = parseNumber(draft.tank)
  if (tank !== undefined && !(tank > 0)) errors.push('Объём бака — число литров больше нуля')
  if (errors.length > 0) return { ok: false, errors }

  const { plate: _plate, fuel: _fuel, tank: _tank, ...rest } = base ?? { id, updatedAt: at, name }
  const car: Car = { ...rest, id: base?.id ?? id, updatedAt: at, name }
  const plate = draft.plate.trim()
  const fuel = draft.fuel.trim()
  if (plate) car.plate = plate
  if (fuel) car.fuel = fuel
  if (tank !== undefined) car.tank = tank
  return { ok: true, car }
}

/** Машины в порядке заведения: id — ULID, его порядок — время. */
export function sortCars(cars: readonly Car[]): Car[] {
  return cars.filter((car) => !car.deleted).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** Машины для выбора у новой записи: не удалённые и не в архиве. */
export function activeCars(cars: readonly Car[]): Car[] {
  return sortCars(cars).filter((car) => !car.archived)
}

/** Выбирать главную есть смысл, только когда активных машин две и больше. */
export function canChooseMain(cars: readonly Car[]): boolean {
  return activeCars(cars).length >= 2
}

/**
 * Какая машина подставляется в новую запись (Р-21): главная этого
 * устройства, если она есть среди активных; иначе машина последней
 * внесённой записи — по id, то есть по времени внесения, а не по дате
 * записи; архивная не подставляется. Записей нет — первая заведённая.
 * Активных машин нет — null.
 */
export function defaultCarId(cars: readonly Car[], entries: readonly Entry[], mainId: string | null): string | null {
  const active = activeCars(cars)
  if (mainId !== null && active.some((car) => car.id === mainId)) return mainId
  const ids = new Set(active.map((car) => car.id))
  let latest: Entry | undefined
  for (const entry of entries) {
    if (entry.deleted || !ids.has(entry.carId)) continue
    if (!latest || entry.id > latest.id) latest = entry
  }
  return latest?.carId ?? active[0]?.id ?? null
}

/** Сколько живых записей у машины — для подтверждения удаления. */
export function entriesOf(carId: string, entries: readonly Entry[]): Entry[] {
  return entries.filter((entry) => entry.carId === carId && !entry.deleted)
}

/**
 * Удаление машины вместе с записями: метка `deleted` на машине и на каждой
 * её живой записи. Метки, а не стирание, — так удаление доезжает до других
 * устройств синхронизацией.
 */
export function deletionOf(car: Car, entries: readonly Entry[]): { car: Car; entries: Entry[] } {
  return {
    car: { ...car, deleted: true },
    entries: entriesOf(car.id, entries).map((entry) => ({ ...entry, deleted: true })),
  }
}
