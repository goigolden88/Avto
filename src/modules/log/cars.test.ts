import { describe, expect, it } from 'vitest'
import type { Car, Entry } from '../../app/model.ts'
import {
  activeCars,
  buildCar,
  canChooseMain,
  carDraftOf,
  defaultCarId,
  deletionOf,
  EMPTY_CAR,
  entriesOf,
  sortCars,
} from './cars.ts'

const at = '2026-10-16T10:00:00.000Z'

function car(id: string, fields: Partial<Car> = {}): Car {
  return { id, updatedAt: at, name: `Машина ${id}`, ...fields }
}

function entry(id: string, carId: string, fields: Partial<Entry> = {}): Entry {
  return { id, updatedAt: at, carId, kind: 'wash', date: '2026-10-01', amount: 500, ...fields }
}

describe('машина из формы', () => {
  it('название обязательно', () => {
    expect(buildCar({ ...EMPTY_CAR, name: '  ' }, undefined, 'C1', at)).toEqual({
      ok: false,
      errors: ['Впишите название машины'],
    })
  })

  it('госномер, топливо и бак — по желанию; бак с запятой', () => {
    expect(buildCar({ name: ' Солярис ', plate: '', fuel: '', tank: '' }, undefined, 'C1', at)).toEqual({
      ok: true,
      car: { id: 'C1', updatedAt: at, name: 'Солярис' },
    })
    expect(buildCar({ name: 'Солярис', plate: 'А123ВС', fuel: '98', tank: '50,5' }, undefined, 'C1', at)).toEqual({
      ok: true,
      car: { id: 'C1', updatedAt: at, name: 'Солярис', plate: 'А123ВС', fuel: '98', tank: 50.5 },
    })
  })

  it('бак — число больше нуля', () => {
    expect(buildCar({ ...EMPTY_CAR, name: 'Солярис', tank: 'много' }, undefined, 'C1', at)).toMatchObject({ ok: false })
    expect(buildCar({ ...EMPTY_CAR, name: 'Солярис', tank: '0' }, undefined, 'C1', at)).toMatchObject({ ok: false })
  })

  it('правка: id и архив остаются, очищенное поле стирается', () => {
    const base = car('C1', { plate: 'А123ВС', fuel: '95', tank: 50, archived: true })
    const result = buildCar({ ...carDraftOf(base), name: 'Мамина', plate: '' }, base, 'другой', at)
    expect(result).toEqual({
      ok: true,
      car: { id: 'C1', updatedAt: at, name: 'Мамина', fuel: '95', tank: 50, archived: true },
    })
  })

  it('черновик машины — бак с запятой', () => {
    expect(carDraftOf(car('C1', { tank: 45.5 }))).toEqual({ name: 'Машина C1', plate: '', fuel: '', tank: '45,5' })
  })
})

describe('списки машин', () => {
  const cars = [car('C3'), car('C1', { archived: true }), car('C2'), car('C4', { deleted: true })]

  it('по порядку заведения, без удалённых', () => {
    expect(sortCars(cars).map((each) => each.id)).toEqual(['C1', 'C2', 'C3'])
  })

  it('активные — без архива', () => {
    expect(activeCars(cars).map((each) => each.id)).toEqual(['C2', 'C3'])
  })

  it('главную выбирают, только когда активных две и больше', () => {
    expect(canChooseMain(cars)).toBe(true)
    expect(canChooseMain([car('C1'), car('C2', { archived: true })])).toBe(false)
  })
})

describe('машина новой записи — Р-21', () => {
  const cars = [car('C1'), car('C2'), car('C3', { archived: true })]

  it('главная устройства — первой', () => {
    expect(defaultCarId(cars, [entry('E1', 'C1')], 'C2')).toBe('C2')
  })

  it('без главной — машина последней внесённой записи, не последней по дате', () => {
    const entries = [entry('E2', 'C2', { date: '2026-01-01' }), entry('E1', 'C1', { date: '2026-12-01' })]
    expect(defaultCarId(cars, entries, null)).toBe('C2')
  })

  it('главная в архиве или удалена — как без главной', () => {
    expect(defaultCarId(cars, [entry('E1', 'C1')], 'C3')).toBe('C1')
    expect(defaultCarId(cars, [entry('E1', 'C1')], 'нет такой')).toBe('C1')
  })

  it('архивная машина последней записи не подставляется', () => {
    expect(defaultCarId(cars, [entry('E1', 'C2'), entry('E2', 'C3')], null)).toBe('C2')
  })

  it('удалённая запись не считается', () => {
    expect(defaultCarId(cars, [entry('E1', 'C2'), entry('E2', 'C1', { deleted: true })], null)).toBe('C2')
  })

  it('записей нет — первая заведённая; машин нет — null', () => {
    expect(defaultCarId(cars, [], null)).toBe('C1')
    expect(defaultCarId([car('C1', { archived: true })], [], null)).toBeNull()
  })
})

describe('удаление машины с записями', () => {
  it('метка на машине и на каждой её живой записи', () => {
    const target = car('C1')
    const entries = [entry('E1', 'C1'), entry('E2', 'C2'), entry('E3', 'C1'), entry('E4', 'C1', { deleted: true })]
    expect(entriesOf('C1', entries).map((each) => each.id)).toEqual(['E1', 'E3'])
    const result = deletionOf(target, entries)
    expect(result.car).toEqual({ ...target, deleted: true })
    expect(result.entries.map((each) => [each.id, each.deleted])).toEqual([
      ['E1', true],
      ['E3', true],
    ])
  })
})
