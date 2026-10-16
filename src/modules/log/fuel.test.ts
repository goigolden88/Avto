import { describe, expect, it } from 'vitest'
import { FUEL_HINTS, fuelMissingText, MISMATCH, solveFuel } from './fuel.ts'

describe('заправка: два числа из трёх — Р-06', () => {
  it('литры и цена — считается сумма', () => {
    expect(solveFuel({ liters: 45.5, price: 56.78 })).toEqual({
      ok: true,
      liters: 45.5,
      price: 56.78,
      amount: 2583.49,
      computed: 'amount',
      expectedAmount: null,
    })
  })

  it('сумма и литры — считается цена', () => {
    expect(solveFuel({ liters: 40, amount: 2200 })).toMatchObject({ ok: true, price: 55, computed: 'price' })
  })

  it('сумма и цена — считаются литры', () => {
    expect(solveFuel({ price: 55, amount: 2200 })).toMatchObject({ ok: true, liters: 40, computed: 'liters' })
  })

  it('все три сходятся в пределах 1 % — без предупреждения', () => {
    expect(MISMATCH).toBe(0.01)
    expect(solveFuel({ liters: 40, price: 55, amount: 2210 })).toMatchObject({
      ok: true,
      amount: 2210,
      computed: null,
      expectedAmount: null,
    })
  })

  it('все три расходятся больше чем на 1 % — предупреждение с посчитанной суммой, числа как введены', () => {
    expect(solveFuel({ liters: 40, price: 55, amount: 2000 })).toEqual({
      ok: true,
      liters: 40,
      price: 55,
      amount: 2000,
      computed: null,
      expectedAmount: 2200,
    })
  })

  it('меньше двух — каких не хватает', () => {
    expect(solveFuel({})).toEqual({ ok: false, missing: ['liters', 'price', 'amount'] })
    expect(solveFuel({ liters: 40 })).toEqual({ ok: false, missing: ['price', 'amount'] })
  })

  it('чего не хватает — словами', () => {
    expect(fuelMissingText(['liters', 'price', 'amount'])).toBe(
      'Нужны два числа из трёх — литры, цена литра, сумма; третье посчитается само',
    )
    expect(fuelMissingText(['price', 'amount'])).toBe('Введите ещё цену литра или сумму — третье посчитается само')
  })

  it('подсказки топлива — «95», «92», «ДТ», «газ»', () => {
    expect(FUEL_HINTS).toEqual(['95', '92', 'ДТ', 'газ'])
  })
})
