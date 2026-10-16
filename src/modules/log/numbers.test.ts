import { describe, expect, it } from 'vitest'
import { formatMoney, formatNumber, numberInput, parseNumber, round2 } from './numbers.ts'

/** Неразрывные пробелы `toLocaleString` — обычными, чтобы ожидание читалось. */
const flat = (text: string) => text.replace(/[  ]/g, ' ')

describe('числа журнала', () => {
  it('дробь через запятую — то же, что через точку', () => {
    expect(parseNumber('45,5')).toBe(45.5)
    expect(parseNumber('45.5')).toBe(45.5)
    expect(parseNumber(' 2 583,49 ')).toBe(2583.49)
    expect(parseNumber('45,')).toBe(45)
    expect(parseNumber(',5')).toBe(0.5)
  })

  it('пустое — не заполнено, мусор — не число', () => {
    expect(parseNumber('')).toBeUndefined()
    expect(parseNumber('   ')).toBeUndefined()
    expect(parseNumber('абв')).toBeNaN()
    expect(parseNumber('1,2,3')).toBeNaN()
    expect(parseNumber('-5')).toBeNaN()
  })

  it('число обратно в поле — с запятой', () => {
    expect(numberInput(45.5)).toBe('45,5')
    expect(numberInput(undefined)).toBe('')
  })

  it('округление до сотых', () => {
    expect(round2(1.005)).toBe(1.01)
    expect(round2(45.5 * 56.78)).toBe(2583.49)
  })

  it('вывод по-русски, сумма — с копейками или без', () => {
    expect(flat(formatNumber(2583.5))).toBe('2 583,5')
    expect(flat(formatMoney(2583.5, '₽'))).toBe('2 583,50 ₽')
    expect(flat(formatMoney(800, '€'))).toBe('800 €')
  })
})
