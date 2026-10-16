/**
 * Числа журнала: ввод с запятой и вывод по-русски.
 *
 * Человек пишет «45,5» — так дробь пишут по-русски, и так её выдаёт
 * клавиатура телефона. Точка принимается тоже: «45.5» — то же число.
 * Пробелы между разрядами («2 583,49») отбрасываются.
 *
 * Чистые функции, без React и без базы.
 */

/** Цифры, одна дробная часть; знака нет — в журнале нет отрицательных чисел. */
const NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)$/

/**
 * Число из поля ввода. Пустое — `undefined`: поле не заполнено, это не
 * ошибка. Не число — `NaN`: об этом надо сказать, а не молча выбросить.
 */
export function parseNumber(input: string): number | undefined {
  const value = input.replace(/[\s  ]/g, '').replace(',', '.')
  if (value === '') return undefined
  return NUMBER.test(value) ? Number(value) : Number.NaN
}

/** Число обратно в поле ввода — с запятой, как его вводят. */
export function numberInput(value: number | undefined): string {
  return value === undefined ? '' : String(value).replace('.', ',')
}

/**
 * Округление до сотых: копейки суммы и цены, сотые литра. Сдвиг на
 * `EPSILON` — чтобы 1,005 округлялось вверх, как на бумаге.
 */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** `2583.5` → `2 583,5`: разряды и запятая по-русски, не больше `digits` знаков после запятой. */
export function formatNumber(value: number, digits = 2): string {
  return value.toLocaleString('ru-RU', { maximumFractionDigits: digits })
}

/**
 * Сумма с валютой из настройки (Р-17): `2 583,49 ₽`, `800 ₽`. Копейки —
 * двумя знаками или никак: «2 583,5 ₽» на чеке не пишут.
 */
export function formatMoney(value: number, currency: string): string {
  const rounded = round2(value)
  const digits = Number.isInteger(rounded) ? 0 : 2
  const number = rounded.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  return `${number} ${currency}`
}
