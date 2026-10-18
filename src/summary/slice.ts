/**
 * Срез итогов «Авто» для «Тотального Учёта» (Р-27; договор — Я-48 «FamilyCore»).
 *
 * Четыре отрезка ядра — прошлая и идущая неделя, прошлый и идущий месяц. В
 * отрезке — строки по каждой машине, итога по машинам нет: траты всего и по
 * видам, число штрафов и ремонтов, пробег и цена километра. Пробег — тем же
 * правилом, что «Итоги» (Р-23, `distanceOf`). «Требует внимания» — неоплаченные
 * штрафы по всем машинам одним пунктом.
 *
 * Читает только синхронизируемое: машины, журнал и общие настройки (валюта).
 * `settings` устройства — главная машина — сюда не попадает (Я-16 «FamilyCore»).
 * Госномера, нарушения, «что делали», сервиса, АЗС, заметок, расхода,
 * маршрутов и парковок в срезе нет никогда.
 *
 * Ключи и подписи — `docs/02-Архитектура.md`, «Срез итогов».
 *
 * Чистая функция, без React и без базы.
 */

import type { Car, Entry, EntryKind, StoreRecord } from '../app/model.ts'
import { KINDS, KIND_LABELS } from '../modules/log/entries.ts'
import { round2 } from '../modules/log/numbers.ts'
import { distanceOf, sum } from '../modules/log/stats.ts'
import { readCurrency } from '../modules/prefs/prefs.ts'
import { inPeriod, plural, type DateStr } from '../shared/core/dates.ts'
import {
  summaryPeriods,
  UNKNOWN,
  type Attention,
  type Metric,
  type PeriodSummary,
  type SummaryBody,
  type SummaryPeriod,
  type Value,
} from '../shared/core/summary.ts'

/** Что срез читает из данных: машины, журнал и общие настройки. */
export type SliceData = Pick<{ readonly [S in keyof StoreRecord]: readonly StoreRecord[S][] }, 'cars' | 'entries' | 'prefs'>

// ─── Валюта ────────────────────────────────────────────────────────────────

/**
 * Знак валюты из настроек → код ISO 4217 (Р-27). Валюта — свободная строка
 * (Р-17): новый знак — строка здесь, иначе денежные строки «не известно».
 */
export const CURRENCY_CODES: Readonly<Record<string, string>> = {
  '₽': 'RUB',
  руб: 'RUB',
  'руб.': 'RUB',
  'р.': 'RUB',
  RUB: 'RUB',
  $: 'USD',
  USD: 'USD',
  '€': 'EUR',
  EUR: 'EUR',
}

/** Код валюты по знаку — без пробелов по краям и регистра. Не узнан — null. */
export function currencyCode(sign: string): string | null {
  const wanted = sign.trim().toLowerCase()
  const found = Object.entries(CURRENCY_CODES).find(([each]) => each.toLowerCase() === wanted)
  return found ? found[1] : null
}

/** Свой код «не известно» «Авто»: знак валюты не переводится в код (Я-48 «FamilyCore»). */
export const NO_CURRENCY = 'no-currency'

type Money = { code: string | null; sign: string }

/** Деньги в минимальных единицах: копейки, округлённые до целого. */
function moneyValue(amount: number, money: Money): Value {
  if (money.code === null) {
    return { unknown: NO_CURRENCY, text: `валюта «${money.sign}» не переводится в код, сумма не отдаётся` }
  }
  return { money: Math.round(round2(amount) * 100), currency: money.code }
}

// ─── Основания ─────────────────────────────────────────────────────────────

/** `по 3 записям`, `записей нет`. */
export function recordsBasis(count: number): string {
  return count === 0 ? 'записей нет' : `по ${count} ${plural(count, ['записи', 'записям', 'записям'])}`
}

/** Основание счёта штрафов и ремонтов: `из 5 записей машины`. */
export function countBasis(records: number): string {
  return records === 0 ? 'записей машины нет' : `из ${records} ${plural(records, ['записи', 'записей', 'записей'])} машины`
}

/** Основание пробега и цены километра: `по 2 записям с пробегом из 4`. */
export function odometerBasis(withOdometer: number, records: number): string {
  return `по ${withOdometer} ${plural(withOdometer, ['записи', 'записям', 'записям'])} с пробегом из ${records}`
}

// ─── Отрезок ───────────────────────────────────────────────────────────────

/** Подпись машины без имени: имя обязательно, но испорченная запись бывает. */
const NO_NAME = 'Машина без имени'

function isNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Строки одной машины за отрезок. `own` — её записи в отрезке, `entries` — все живые для пробега. */
function carMetrics(car: Car, own: readonly Entry[], entries: readonly Entry[], period: SummaryPeriod, money: Money): Metric[] {
  const name = car.name.trim() || NO_NAME
  const label = (what: string) => `${name}: ${what}`
  const key = (suffix: string) => `car.${car.id}.${suffix}`
  const records = own.length
  const total = sum(own)
  const ofKind = (kind: EntryKind) => own.filter((entry) => entry.kind === kind)

  const metrics: Metric[] = [{ key: key('spend'), label: label('траты всего'), value: moneyValue(total, money), basis: recordsBasis(records) }]

  // Только виды с записями в отрезке, как в «Итогах» (Р-23).
  for (const kind of KINDS) {
    const list = ofKind(kind)
    if (list.length === 0) continue
    metrics.push({
      key: key(`spend.${kind}`),
      label: label(`траты: ${KIND_LABELS[kind].toLowerCase()}`),
      value: moneyValue(sum(list), money),
      basis: recordsBasis(list.length),
    })
  }

  // Ноль — тоже строка: «штрафов не было» — ответ.
  metrics.push(
    { key: key('fine.count'), label: label('число штрафов'), value: { n: ofKind('fine').length, unit: 'count' }, basis: countBasis(records) },
    { key: key('repair.count'), label: label('число ремонтов'), value: { n: ofKind('repair').length, unit: 'count' }, basis: countBasis(records) },
  )

  const distance = distanceOf(car.id, entries, period)
  const basis = odometerBasis(own.filter((entry) => isNumber(entry.odometer)).length, records)
  if (distance === null || distance <= 0) {
    const text = distance === null ? 'показаний пробега меньше двух' : 'пробег по одометру не больше нуля'
    const notEnough: Value = { unknown: UNKNOWN.notEnough, text }
    metrics.push(
      { key: key('km'), label: label('пробег'), value: notEnough, basis },
      { key: key('kmCost'), label: label('цена километра'), value: notEnough, basis },
    )
  } else {
    metrics.push(
      { key: key('km'), label: label('пробег'), value: { n: distance, unit: 'km' }, basis },
      { key: key('kmCost'), label: label('цена километра'), value: moneyValue(total / distance, money), basis },
    )
  }
  return metrics
}

function periodSummary(
  period: SummaryPeriod,
  cars: readonly Car[],
  entries: readonly Entry[],
  day: DateStr,
  money: Money,
): PeriodSummary {
  // Идущий отрезок верен по день расчёта; закончившийся — null (Я-21).
  const through = inPeriod(day, period) ? day : null
  const inside = entries.filter((entry) => inPeriod(entry.date, period))
  if (inside.length === 0) {
    return { ...period, through, metrics: { unknown: UNKNOWN.noData, text: 'записей журнала в отрезке нет' } }
  }
  const metrics = cars.flatMap((car) => {
    const own = inside.filter((entry) => entry.carId === car.id)
    // Машина в архиве без записей в отрезке — без строк.
    if (car.archived === true && own.length === 0) return []
    return carMetrics(car, own, entries, period, money)
  })
  return { ...period, through, metrics }
}

// ─── Срез ──────────────────────────────────────────────────────────────────

/** «Требует внимания»: неоплаченные штрафы по всем машинам. Нет таких — пункта нет. */
function attentionOf(entries: readonly Entry[], day: DateStr): Attention[] {
  const fines = entries.filter((entry) => entry.kind === 'fine')
  const unpaid = fines.filter((entry) => entry.paid === false).length
  if (unpaid === 0) return []
  return [
    {
      key: 'fines.unpaid',
      label: 'Штрафы не оплачены',
      count: unpaid,
      day,
      link: '/',
      basis: `не оплачено ${unpaid} из ${fines.length} ${plural(fines.length, ['штрафа', 'штрафов', 'штрафов'])} журнала, по всем машинам`,
    },
  ]
}

/**
 * Тело среза на день расчёта `day`. Машины — живые, в порядке заведения (id —
 * ULID); записи машины, которой нет, в срез не идут.
 */
export function summary(data: SliceData, day: DateStr): SummaryBody {
  const cars = data.cars.filter((car) => !car.deleted).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const carIds = new Set(cars.map((car) => car.id))
  const entries = data.entries.filter((entry) => !entry.deleted && carIds.has(entry.carId))
  const sign = readCurrency(data.prefs)
  const money: Money = { code: currencyCode(sign), sign }

  return {
    periods: summaryPeriods(day).map((period) => periodSummary(period, cars, entries, day, money)),
    attention: attentionOf(entries, day),
  }
}
