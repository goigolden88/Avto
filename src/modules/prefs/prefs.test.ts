import { describe, expect, it } from 'vitest'
import type { Prefs } from '../../app/model.ts'
import { CURRENCY_HINTS, CURRENCY_MAX, DEFAULT_CURRENCY, PREFS_ID, readCurrency, withCurrency } from './prefs.ts'

const at = '2026-10-16T10:00:00.000Z'
const later = '2026-10-16T11:00:00.000Z'

function prefs(currency: unknown, fields: Partial<Prefs> = {}): Prefs[] {
  return [{ id: PREFS_ID, updatedAt: at, currency: currency as string, ...fields }]
}

describe('валюта — Р-17', () => {
  it('до первой правки — «₽», хотя записи prefs:main ещё нет', () => {
    expect(DEFAULT_CURRENCY).toBe('₽')
    expect(readCurrency([])).toBe('₽')
  })

  it('стоит то, что записано', () => {
    expect(readCurrency(prefs('€'))).toBe('€')
    expect(readCurrency(prefs(' zł '))).toBe('zł')
  })

  it('удалённая, чужая или испорченная запись — умолчание', () => {
    expect(readCurrency(prefs('€', { deleted: true }))).toBe('₽')
    expect(readCurrency(prefs('€', { id: 'prefs:other' }))).toBe('₽')
    expect(readCurrency(prefs(''))).toBe('₽')
    expect(readCurrency(prefs(42))).toBe('₽')
  })

  it('смена — одна запись с постоянным id и временем правки', () => {
    expect(withCurrency([], '€', later)).toEqual({ id: PREFS_ID, updatedAt: later, currency: '€' })
    expect(withCurrency(prefs('€'), ' $ ', later)).toEqual({ id: PREFS_ID, updatedAt: later, currency: '$' })
  })

  it('пустое, слишком длинное и то же самое не сохраняется', () => {
    expect(withCurrency([], '  ', later)).toBeNull()
    expect(withCurrency([], 'x'.repeat(CURRENCY_MAX + 1), later)).toBeNull()
    expect(withCurrency([], '₽', later)).toBeNull()
    expect(withCurrency(prefs('€'), '€', later)).toBeNull()
  })

  it('соседние поля записи правка валюты не стирает', () => {
    const record = { ...prefs('€')[0], extra: 1 } as Prefs
    expect(withCurrency([record], '$', later)).toMatchObject({ extra: 1, currency: '$', updatedAt: later })
  })

  it('подсказки — «₽», «€», «$», «zł», умолчание среди них', () => {
    expect(CURRENCY_HINTS).toEqual(['₽', '€', '$', 'zł'])
    expect(CURRENCY_HINTS).toContain(DEFAULT_CURRENCY)
  })
})
