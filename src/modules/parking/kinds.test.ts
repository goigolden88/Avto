import { describe, expect, it } from 'vitest'
import type { Parking } from '../../app/model.ts'
import { KIND_TEXTS, kindOf, PLACE_KIND_LABELS, PLACE_KINDS, textsOf } from './kinds.ts'

const at = '2026-10-21T10:00:00.000Z'

describe('вид места', () => {
  it('три вида: парковка, участок дороги, прочее', () => {
    expect(PLACE_KINDS.map((kind) => PLACE_KIND_LABELS[kind])).toEqual(['парковка', 'участок дороги', 'прочее'])
  })

  it('нет поля, места нет или вид незнаком — парковка', () => {
    expect(kindOf({})).toBe('parking')
    expect(kindOf(undefined)).toBe('parking')
    expect(kindOf({ kind: 'road' })).toBe('road')
    expect(kindOf({ kind: 'other' })).toBe('other')
    const future = { id: 'K1', updatedAt: at, city: 'Москва', where: 'паром', kind: 'ferry' } as unknown as Parking
    expect(kindOf(future)).toBe('parking')
    expect(textsOf(future)).toBe(KIND_TEXTS.parking)
  })

  it('подписи результата по виду', () => {
    expect(Object.values(KIND_TEXTS.parking.results)).toEqual(['сразу', 'с трудом', 'мест нет'])
    expect(Object.values(KIND_TEXTS.road.results)).toEqual(['свободно', 'плотно', 'стоим'])
    expect(Object.values(KIND_TEXTS.other.results)).toEqual(['легко', 'с трудом', 'никак'])
  })
})
