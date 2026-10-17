/**
 * Расчёты журнала (Р-07, Р-08, Р-23): км с прошлой заправки и рост цены —
 * для строки заправки; цена километра, траты по видам, средний расход и
 * АЗС подешевле — для блока «Итоги» над журналом.
 *
 * Ничего из этого не хранится (Р-09): всё считается при показе из живых
 * записей, и правка или удаление старой записи сразу меняет числа после
 * неё. Каждое число отдаётся вместе с основанием — по скольким записям
 * оно посчитано.
 *
 * Чистые функции, без React и без базы.
 */

import type { Entry, EntryKind } from '../../app/model.ts'
import {
  addMonths,
  inPeriod,
  isDateStr,
  lastDayOf,
  monthOf,
  plural,
  type DateStr,
  type Period,
} from '../../shared/core/dates.ts'
import { KINDS } from './entries.ts'
import { filterEntries, rangeOf, type LogFilter } from './filter.ts'
import { formatMoney, formatNumber, round2 } from './numbers.ts'

/**
 * Название топлива или АЗС для сравнения: без пробелов по краям и без
 * регистра — «аи-95 » и «АИ-95» одно топливо, а «95» и «АИ-95» — разные.
 */
export function nameKey(name: string | undefined): string {
  return (name ?? '').trim().toLowerCase()
}

/** По времени: по дате, в один день — по внесению (id — ULID). Обратно `sortEntries`. */
function byTime(a: Entry, b: Entry): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function isNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

// ─── Строка заправки ───────────────────────────────────────────────────────

export type FuelNote = {
  /**
   * Км с прошлой заправки этой машины, у которой есть одометр. Меньше нуля —
   * одометр меньше прошлого (опечатка). Null — у этой заправки одометра нет
   * или прошлой с одометром нет.
   */
  km: number | null
  /**
   * Рост цены литра к прошлой заправке того же топлива любой машины, %
   * (Р-07). Ноль — цены равны. Null — нет цены, нет топлива или не с чем
   * сравнить.
   */
  priceChange: number | null
}

/** Км с прошлой и рост цены для каждой живой заправки — по её id. */
export function fuelNotes(entries: readonly Entry[]): Map<string, FuelNote> {
  const notes = new Map<string, FuelNote>()
  const lastOdometer = new Map<string, number>()
  const lastPrice = new Map<string, number>()
  const fuels = entries.filter((entry) => !entry.deleted && entry.kind === 'fuel').sort(byTime)

  for (const entry of fuels) {
    const before = lastOdometer.get(entry.carId)
    const km = isNumber(entry.odometer) && before !== undefined ? entry.odometer - before : null

    const fuel = nameKey(entry.fuel)
    const previous = fuel ? lastPrice.get(fuel) : undefined
    let priceChange: number | null = null
    if (isNumber(entry.price) && previous !== undefined && previous > 0) {
      // Цены — в копейках: равные до копейки — «без изменений», а не «+0 %».
      priceChange = round2(entry.price) === round2(previous) ? 0 : ((entry.price - previous) / previous) * 100
    }

    notes.set(entry.id, { km, priceChange })
    if (isNumber(entry.odometer)) lastOdometer.set(entry.carId, entry.odometer)
    if (fuel && isNumber(entry.price)) lastPrice.set(fuel, entry.price)
  }
  return notes
}

/** `цена +2,1 %`, `цена −0,5 %`, `цена без изменений`. Меньше десятой — сотыми, чтобы не вышло «+0 %». */
export function priceChangeText(change: number): string {
  if (change === 0) return 'цена без изменений'
  const digits = Math.abs(change) < 0.1 ? 2 : 1
  return `цена ${change > 0 ? '+' : '−'}${formatNumber(Math.abs(change), digits)} %`
}

/** Строка под заправкой: `+600 км с прошлой · цена +2,1 %`. Нечего сказать — пусто. */
export function fuelNoteText(note: FuelNote | undefined): string {
  if (!note) return ''
  const parts: string[] = []
  if (note.km !== null) {
    parts.push(note.km < 0 ? 'одометр меньше прошлого' : `+${formatNumber(note.km, 0)} км с прошлой`)
  }
  if (note.priceChange !== null) parts.push(priceChangeText(note.priceChange))
  return parts.join(' · ')
}

// ─── Итоги периода ─────────────────────────────────────────────────────────

/** Цена километра, расход и основание — у одной машины за период. */
export type CarStats = {
  carId: string
  /** Записей машины в периоде — всех видов. */
  records: number
  /** Из них с одометром. */
  withOdometer: number
  /**
   * Пробег за период: последнее показание в периоде минус последнее до
   * него, а без такого — первое в периоде. Null — показаний меньше двух.
   * Ноль и меньше — тоже «мало данных», но число остаётся для основания.
   */
  distance: number | null
  /** Деньги заправок за период. */
  fuelMoney: number
  /** Деньги всех записей за период, штрафы тоже. */
  allMoney: number
  /** Среднее введённого расхода, л/100 км (Р-05). Null — ни разу не введён. */
  consumption: { average: number; count: number } | null
}

export type KindTotal = { kind: EntryKind; amount: number; count: number }

export type PeriodStats = {
  /** Записей за период по отбору машины. */
  records: number
  total: number
  /** Только виды, у которых есть записи, — в порядке `KINDS`. */
  kinds: KindTotal[]
  /** По машине на строку: у которых есть записи в периоде, в порядке заведения. */
  cars: CarStats[]
}

type Reading = { date: DateStr; id: string; km: number }

/** Пробег машины за период по показаниям одометра записей любого вида. */
function distanceOf(carId: string, entries: readonly Entry[], range: Period | null): number | null {
  const readings: Reading[] = []
  // С кривой датой показание не встать ни до, ни после: в пробег не идёт.
  for (const entry of [...entries].sort(byTime)) {
    if (entry.deleted || entry.carId !== carId || !isNumber(entry.odometer) || !isDateStr(entry.date)) continue
    readings.push({ date: entry.date, id: entry.id, km: entry.odometer })
  }
  const inside = range === null ? readings : readings.filter((reading) => inPeriod(reading.date, range))
  const last = inside.at(-1)
  if (!last) return null
  const before = range === null ? undefined : readings.filter((reading) => reading.date < range.from).at(-1)
  const start = before ?? inside[0]
  if (!start || start === last) return null
  return last.km - start.km
}

/**
 * Итоги за период из отбора: машина и период, вид записи не действует —
 * итоги про машину и период (Р-23).
 */
export function periodStats(entries: readonly Entry[], filter: LogFilter): PeriodStats {
  const range = rangeOf(filter.period)
  const shown = filterEntries(entries, { ...filter, kind: null })

  const kinds: KindTotal[] = KINDS.map((kind) => {
    const own = shown.filter((entry) => entry.kind === kind)
    return { kind, amount: sum(own), count: own.length }
  }).filter((each) => each.count > 0)

  const carIds = [...new Set(shown.map((entry) => entry.carId))].sort()
  const cars = carIds.map((carId): CarStats => {
    const own = shown.filter((entry) => entry.carId === carId)
    const fuels = own.filter((entry) => entry.kind === 'fuel')
    const consumption = fuels.map((entry) => entry.consumption).filter(isNumber)
    return {
      carId,
      records: own.length,
      withOdometer: own.filter((entry) => isNumber(entry.odometer)).length,
      distance: distanceOf(carId, entries, range),
      fuelMoney: sum(fuels),
      allMoney: sum(own),
      consumption:
        consumption.length === 0
          ? null
          : { average: consumption.reduce((a, b) => a + b, 0) / consumption.length, count: consumption.length },
    }
  })

  return { records: shown.length, total: sum(shown), kinds, cars }
}

function sum(entries: readonly Entry[]): number {
  return round2(entries.reduce((total, entry) => total + (isNumber(entry.amount) ? entry.amount : 0), 0))
}

/** Цена километра. Null — «мало данных»: пробега нет, он нулевой или меньше. */
export function perKm(money: number, distance: number | null): number | null {
  return distance === null || distance <= 0 ? null : money / distance
}

/** `4,20 ₽/км` или `мало данных`. */
export function perKmText(money: number, distance: number | null, currency: string): string {
  const value = perKm(money, distance)
  return value === null ? 'мало данных' : `${formatMoney(value, currency)}/км`
}

/** Основание цены километра: `пробег 1 240 км, по 4 записям из 7`. */
export function basisText(stats: CarStats): string {
  const parts: string[] = []
  if (stats.distance !== null) parts.push(`пробег ${formatNumber(stats.distance, 0)} км`)
  const n = stats.withOdometer
  parts.push(`по ${n} ${plural(n, ['записи', 'записям', 'записям'])} из ${stats.records}`)
  return parts.join(', ')
}

/** `7,8 л/100 км по 3 заправкам`. */
export function consumptionText(consumption: { average: number; count: number }): string {
  const n = consumption.count
  return `${formatNumber(consumption.average, 1)} л/100 км по ${n} ${plural(n, ['заправке', 'заправкам', 'заправкам'])}`
}

// ─── АЗС подешевле ─────────────────────────────────────────────────────────

/** За сколько последних месяцев сравниваются АЗС (Р-23). */
export const CHEAP_MONTHS = 6

/** `за последние 6 месяцев` — из константы, а не цифрой в тексте. */
export const CHEAP_SPAN = `за последние ${CHEAP_MONTHS} ${plural(CHEAP_MONTHS, ['месяц', 'месяца', 'месяцев'])}`

/**
 * С какого дня считаются АЗС: тот же день `CHEAP_MONTHS` месяцев назад;
 * нет такого дня в месяце — последний день месяца.
 */
export function cheapSince(today: DateStr): DateStr {
  const month = addMonths(monthOf(today), -CHEAP_MONTHS)
  const day = Math.min(Number(today.slice(8, 10)), Number(lastDayOf(month).slice(8, 10)))
  return `${month}-${String(day).padStart(2, '0')}`
}

export type StationPrice = {
  /** Как написано в последней заправке на этой АЗС. */
  name: string
  /** Средняя цена литра: сумма ÷ литры. */
  price: number
  count: number
}

export type FuelStations = { fuel: string; count: number; stations: StationPrice[] }

/**
 * АЗС подешевле: за `CHEAP_MONTHS` месяцев до сегодня, по всем машинам —
 * отбору не следует (Р-23). Для каждого топлива АЗС от дешёвой к дорогой;
 * топливо, на котором заправлялись чаще, — выше. Заправки без АЗС, без
 * топлива или без литров не входят.
 */
export function cheapStations(entries: readonly Entry[], today: DateStr): FuelStations[] {
  const range: Period = { from: cheapSince(today), to: today }
  type Station = { name: string; amount: number; liters: number; count: number }
  const fuels = new Map<string, { fuel: string; count: number; stations: Map<string, Station> }>()

  // По времени: название АЗС и топлива берётся из последней заправки.
  for (const entry of [...entries].sort(byTime)) {
    if (entry.deleted || entry.kind !== 'fuel' || !inPeriod(entry.date, range)) continue
    const fuelKey = nameKey(entry.fuel)
    const stationKey = nameKey(entry.station)
    if (!fuelKey || !stationKey || !isNumber(entry.liters) || entry.liters <= 0 || !isNumber(entry.amount)) continue

    const group = fuels.get(fuelKey) ?? { fuel: '', count: 0, stations: new Map<string, Station>() }
    group.fuel = (entry.fuel ?? '').trim()
    group.count += 1
    const station = group.stations.get(stationKey) ?? { name: '', amount: 0, liters: 0, count: 0 }
    station.name = (entry.station ?? '').trim()
    station.amount += entry.amount
    station.liters += entry.liters
    station.count += 1
    group.stations.set(stationKey, station)
    fuels.set(fuelKey, group)
  }

  return [...fuels.values()]
    .map((group) => ({
      fuel: group.fuel,
      count: group.count,
      stations: [...group.stations.values()]
        .map((station) => ({ name: station.name, price: station.amount / station.liters, count: station.count }))
        .sort((a, b) => a.price - b.price || a.name.localeCompare(b.name, 'ru')),
    }))
    .sort((a, b) => b.count - a.count || a.fuel.localeCompare(b.fuel, 'ru'))
}

/** `3 заправки`. */
export function fillsCount(count: number): string {
  return `${count} ${plural(count, ['заправка', 'заправки', 'заправок'])}`
}
