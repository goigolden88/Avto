import { describe, expect, it } from 'vitest'
import type { Parking, ParkingVisit, Point } from '../../app/model.ts'
import {
  buildParking,
  defaultParkingId,
  newParkingDraft,
  parkingDeletion,
  parkingDraftOf,
  parkingsByCity,
  sortParkings,
  visitsOf,
} from './parkings.ts'

const at = '2026-10-17T10:00:00.000Z'

function parking(id: string, fields: Partial<Parking> = {}): Parking {
  return { id, updatedAt: at, city: 'Москва', where: `Место ${id}`, ...fields }
}

function point(id: string, city: string): Point {
  return { id, updatedAt: at, name: `Точка ${id}`, city }
}

function visit(id: string, parkingId: string, fields: Partial<ParkingVisit> = {}): ParkingVisit {
  return { id, updatedAt: at, parkingId, date: '2026-10-14', time: '08:10', result: 'easy', ...fields }
}

describe('место из формы', () => {
  const empty = { kind: 'parking' as const, where: '', city: '', pointId: '', price: '', link: '', note: '' }

  it('«где» и город обязательны', () => {
    expect(buildParking({ ...empty, where: ' ' }, undefined, 'K1', at)).toEqual({
      ok: false,
      errors: ['Впишите, где место', 'Впишите город'],
    })
  })

  it('необязательное пустое — не пишется; пробелы по краям срезаются', () => {
    expect(buildParking({ ...empty, where: ' двор за домом ', city: ' Москва ' }, undefined, 'K1', at)).toEqual({
      ok: true,
      parking: { id: 'K1', updatedAt: at, city: 'Москва', where: 'двор за домом' },
    })
  })

  it('точка, цена строкой, ссылка и заметка — как вписаны', () => {
    const draft = { ...empty, where: 'ТЦ', city: 'Москва', pointId: 'P1', price: '150 ₽/час', link: 'https://example.org', note: 'вход с торца' }
    expect(buildParking(draft, undefined, 'K1', at)).toEqual({
      ok: true,
      parking: { id: 'K1', updatedAt: at, city: 'Москва', where: 'ТЦ', pointId: 'P1', price: '150 ₽/час', link: 'https://example.org', note: 'вход с торца' },
    })
  })

  it('правка сохраняет id, стёртое поле уходит', () => {
    const base = parking('K1', { pointId: 'P1', price: 'бесплатно', note: 'н' })
    const result = buildParking({ ...parkingDraftOf(base), pointId: '', price: '', where: 'двор' }, base, 'другой', at)
    expect(result).toEqual({ ok: true, parking: { id: 'K1', updatedAt: at, city: 'Москва', where: 'двор', note: 'н' } })
  })

  it('вид: парковка не пишется, участок и прочее — пишутся', () => {
    expect(buildParking({ ...empty, where: 'двор', city: 'Москва' }, undefined, 'K1', at)).toEqual({
      ok: true,
      parking: { id: 'K1', updatedAt: at, city: 'Москва', where: 'двор' },
    })
    expect(buildParking({ ...empty, kind: 'road', where: 'съезд', city: 'Москва' }, undefined, 'K1', at)).toEqual({
      ok: true,
      parking: { id: 'K1', updatedAt: at, city: 'Москва', where: 'съезд', kind: 'road' },
    })
  })

  it('смена вида при правке: новый пишется, парковка — поле уходит', () => {
    const road = parking('K1', { kind: 'road' })
    expect(parkingDraftOf(road).kind).toBe('road')
    const other = buildParking({ ...parkingDraftOf(road), kind: 'other' }, road, 'другой', at)
    expect(other).toEqual({ ok: true, parking: { ...road, kind: 'other' } })
    const back = buildParking({ ...parkingDraftOf(road), kind: 'parking' }, road, 'другой', at)
    expect(back).toEqual({ ok: true, parking: { id: 'K1', updatedAt: at, city: 'Москва', where: 'Место K1' } })
  })

  it('место без вида — парковка, правка поля не добавляет', () => {
    const old = parking('K1')
    expect(parkingDraftOf(old).kind).toBe('parking')
    expect(buildParking(parkingDraftOf(old), old, 'другой', at)).toEqual({ ok: true, parking: old })
  })

  it('незнакомый вид из более новой версии — парковка на экране, правка его не стирает', () => {
    const future = { ...parking('K1'), kind: 'ferry' } as unknown as Parking
    expect(parkingDraftOf(future).kind).toBe('parking')
    expect(buildParking(parkingDraftOf(future), future, 'другой', at)).toEqual({ ok: true, parking: future })
    const road = buildParking({ ...parkingDraftOf(future), kind: 'road' }, future, 'другой', at)
    expect(road).toEqual({ ok: true, parking: { ...future, kind: 'road' } })
  })
})

describe('новое место', () => {
  it('город — из последнего заведённого места, удалённое не в счёт', () => {
    const parkings = [parking('K2', { city: 'Тверь' }), parking('K1'), parking('K3', { city: 'Сочи', deleted: true })]
    expect(newParkingDraft(parkings, [point('P1', 'Казань')]).city).toBe('Тверь')
  })

  it('мест нет — город из последней точки; нет и точек — пусто', () => {
    expect(newParkingDraft([], [point('P2', 'Казань'), point('P1', 'Москва')]).city).toBe('Казань')
    expect(newParkingDraft([], [])).toEqual({ kind: 'parking', where: '', city: '', pointId: '', price: '', link: '', note: '' })
  })
})

describe('места по городу', () => {
  it('города по алфавиту, внутри — в порядке заведения, без удалённых', () => {
    const groups = parkingsByCity([
      parking('K3', { city: 'Тверь' }),
      parking('K2'),
      parking('K1'),
      parking('K4', { city: 'Казань', deleted: true }),
    ])
    expect(groups.map((group) => [group.city, group.parkings.map((each) => each.id)])).toEqual([
      ['Москва', ['K1', 'K2']],
      ['Тверь', ['K3']],
    ])
    expect(sortParkings([parking('K2'), parking('K1', { deleted: true })]).map((each) => each.id)).toEqual(['K2'])
  })
})

describe('место отметки по умолчанию', () => {
  const parkings = [parking('K1'), parking('K2'), parking('K3', { deleted: true })]

  it('место последней внесённой отметки', () => {
    expect(defaultParkingId(parkings, [visit('V2', 'K2', { date: '2026-01-01' }), visit('V1', 'K1')])).toBe('K2')
  })

  it('место удалено или отметок нет — первое заведённое; мест нет — пусто', () => {
    expect(defaultParkingId(parkings, [visit('V9', 'K3'), visit('V8', 'K2', { deleted: true })])).toBe('K1')
    expect(defaultParkingId([], [])).toBe('')
  })
})

describe('удаление места', () => {
  it('метки на месте и его живых отметках; чужие и удалённые не трогаются', () => {
    const base = parking('K1')
    const visits = [visit('V1', 'K1'), visit('V2', 'K2'), visit('V3', 'K1', { deleted: true })]
    expect(visitsOf('K1', visits).map((each) => each.id)).toEqual(['V1'])
    const marked = parkingDeletion(base, visits)
    expect(marked.parking).toEqual({ ...base, deleted: true })
    expect(marked.visits).toEqual([{ ...visits[0], deleted: true }])
  })
})
