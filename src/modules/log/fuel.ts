/**
 * Заправка: два числа из трёх (Р-06).
 *
 * Из литров, цены литра и суммы человек вводит любые два, третье
 * считается при сохранении и хранится — итог потом не зависит от
 * округления на лету (02-Архитектура, «Журнал»). Введены все три и не
 * сходятся больше чем на `MISMATCH` — предупредить и сохранить как ввёл:
 * на чеке бывает скидка, и правда — у человека, а не у умножения.
 *
 * Чистые функции, без React и без базы.
 */

import { round2 } from './numbers.ts'

export type FuelField = 'liters' | 'price' | 'amount'

export const FUEL_FIELDS: readonly FuelField[] = ['liters', 'price', 'amount']

/** Как поле называется в форме и в подсказке «нужны два из трёх». */
export const FUEL_FIELD_NAMES: Record<FuelField, string> = {
  liters: 'литры',
  price: 'цена литра',
  amount: 'сумма',
}

/** Как поле называется в подсказке «введите ещё …». */
export const FUEL_FIELD_ACCUSATIVE: Record<FuelField, string> = {
  liters: 'литры',
  price: 'цену литра',
  amount: 'сумму',
}

/** Доля, на которую сумма может разойтись с «литры × цена» без предупреждения. */
export const MISMATCH = 0.01

/** Та же доля в процентах — для предупреждения в форме и для справки. */
export const MISMATCH_PERCENT = MISMATCH * 100

/** Подсказки топлива — у машины и у заправки; топливо — свободная строка. */
export const FUEL_HINTS: readonly string[] = ['95', '92', 'ДТ', 'газ']

/** Введённые числа: только положительные, пустое — `undefined`. */
export type FuelInput = { liters?: number | undefined; price?: number | undefined; amount?: number | undefined }

export type FuelSolution =
  | {
      ok: false
      /** Каких полей нет — для подсказки «введите ещё …». */
      missing: FuelField[]
    }
  | {
      ok: true
      liters: number
      price: number
      amount: number
      /** Какое число посчитано, а не введено. Null — введены все три. */
      computed: FuelField | null
      /**
       * Введены все три и сумма расходится с «литры × цена» больше чем на
       * `MISMATCH` — какой была бы сумма. Иначе null.
       */
      expectedAmount: number | null
    }

/** Третье число из двух. Меньше двух — какие поля не заполнены. */
export function solveFuel(input: FuelInput): FuelSolution {
  const { liters, price, amount } = input
  const missing = FUEL_FIELDS.filter((field) => input[field] === undefined)

  if (liters !== undefined && price !== undefined && amount !== undefined) {
    const expected = round2(liters * price)
    const off = expected > 0 && Math.abs(amount - expected) / expected > MISMATCH
    return { ok: true, liters, price, amount, computed: null, expectedAmount: off ? expected : null }
  }
  if (liters !== undefined && price !== undefined) {
    return { ok: true, liters, price, amount: round2(liters * price), computed: 'amount', expectedAmount: null }
  }
  if (amount !== undefined && liters !== undefined) {
    return { ok: true, liters, price: round2(amount / liters), amount, computed: 'price', expectedAmount: null }
  }
  if (amount !== undefined && price !== undefined) {
    return { ok: true, liters: round2(amount / price), price, amount, computed: 'liters', expectedAmount: null }
  }
  return { ok: false, missing }
}

/** Чего не хватает заправке — словами, для строки под формой. */
export function fuelMissingText(missing: readonly FuelField[]): string {
  if (missing.length >= FUEL_FIELDS.length) {
    return `Нужны два числа из трёх — ${FUEL_FIELDS.map((field) => FUEL_FIELD_NAMES[field]).join(', ')}; третье посчитается само`
  }
  return `Введите ещё ${missing.map((field) => FUEL_FIELD_ACCUSATIVE[field]).join(' или ')} — третье посчитается само`
}
