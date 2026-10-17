/**
 * Демо-данные (Я-44, Я-45 «FamilyCore»): две машины и год журнала до дня
 * входа в демо. Даты отсчитываются от этого дня — демо всегда свежее.
 *
 * Машины — каждодневная с бортовым компьютером (у её заправок введён
 * расход) и редкая без него. В журнале — заправки на трёх АЗС с разными
 * ценами, мойки, два ремонта, два штрафа (оплачен и нет) и одна мойка без
 * пробега: она выпадает из основания цены километра — «по N записям из M».
 *
 * Всё задано днями до входа (`ago`), а не датами: от дня зависит только
 * календарь, а пробег, цены и порядок записей одинаковы в любой день. Цена
 * литра растёт ступенькой раз в `PRICE_EVERY` дней — от заправки к заправке
 * она в основном растёт, а две заправки на одной АЗС внутри ступеньки — «без
 * изменений». Пробег растёт с датой у каждой машины своим темпом.
 *
 * Маршрутов, поездок и парковок в демо пока нет — их экраны придут задачей 6
 * Авто-3. Пять хранилищ пусты, и тест демо ждёт от `checkDemo` ровно эти пять
 * замечаний.
 *
 * Чистая функция, без React и без базы: засевает ядро при создании базы
 * `avto-demo`. Данные выдуманные — репозиторий публичный.
 */

import type { Car, Entry, EntryKind, StoreRecord, SyncedStore } from '../app/model.ts'
import { round2 } from '../modules/log/numbers.ts'
import { DEFAULT_CURRENCY, PREFS_ID } from '../modules/prefs/prefs.ts'
import { addDays, type DateStr } from '../shared/core/dates.ts'
import { ulid } from '../shared/core/id.ts'

export type DemoData = { [S in SyncedStore]: StoreRecord[S][] }

/** Сколько дней журнала до дня входа: первая запись — не раньше. */
export const DEMO_DAYS = 365

/** Топливо обеих машин: одна цена литра на двоих, как у настоящих заправок. */
const FUEL = '95'

// ─── Цена литра ────────────────────────────────────────────────────────────

/** Цена литра в начале года демо, ₽, и шаг её роста. */
const PRICE_START = 54.2
const PRICE_STEP = 0.25

/** Раз во сколько дней цена поднимается на шаг. */
const PRICE_EVERY = 15

type StationKey = 'main' | 'dear' | 'cheap'

/** АЗС демо и их наценка к общей цене литра. */
const STATIONS: Record<StationKey, { name: string; extra: number }> = {
  main: { name: 'Лукойл', extra: 0 },
  dear: { name: 'Газпром', extra: 0.9 },
  cheap: { name: 'Татнефть', extra: -0.7 },
}

/** Цена литра на АЗС за `ago` дней до входа. */
function priceAt(ago: number, station: StationKey): number {
  const steps = Math.floor((DEMO_DAYS - ago) / PRICE_EVERY)
  return round2(PRICE_START + PRICE_STEP * steps + STATIONS[station].extra)
}

// ─── Машины ────────────────────────────────────────────────────────────────

type CarKey = 'daily' | 'rare'

type CarPlan = {
  name: string
  tank: number
  /** Пробег в начале года демо, км. */
  start: number
  /** Сколько км в день в среднем. */
  perDay: number
}

const CARS: Record<CarKey, CarPlan> = {
  daily: { name: 'Солярис', tank: 50, start: 48_210, perDay: 41.3 },
  rare: { name: 'Нива', tank: 42, start: 96_540, perDay: 8 },
}

function odometerAt(car: CarKey, ago: number): number {
  const plan = CARS[car]
  return Math.round(plan.start + plan.perDay * (DEMO_DAYS - ago))
}

// ─── Журнал ────────────────────────────────────────────────────────────────

/** Каждодневная заправляется раз в столько дней — последний раз в день входа. */
const DAILY_EVERY = 13

/** По кругу: АЗС, литры и расход бортового компьютера каждодневной. */
const DAILY_STATIONS: readonly StationKey[] = ['main', 'main', 'dear', 'main', 'cheap', 'main', 'main']
const DAILY_LITERS: readonly number[] = [41.2, 43.5, 39.8, 44.1, 40.6, 42.3, 38.9]
const DAILY_CONSUMPTION: readonly number[] = [7.8, 8.1, 7.5, 8.4, 7.6, 7.9, 8.6, 7.3]

/** Редкая: когда заправлялась, где и сколько. Расхода нет — компьютера нет. */
const RARE_FILLS: readonly { ago: number; station: StationKey; liters: number }[] = [
  { ago: 335, station: 'main', liters: 36.4 },
  { ago: 288, station: 'cheap', liters: 39.1 },
  { ago: 241, station: 'main', liters: 34.8 },
  { ago: 194, station: 'dear', liters: 37.5 },
  { ago: 147, station: 'main', liters: 36.4 },
  { ago: 100, station: 'cheap', liters: 39.1 },
  { ago: 53, station: 'main', liters: 34.8 },
  { ago: 6, station: 'cheap', liters: 37.5 },
]

/** Всё, кроме заправок. `odometer: false` — пробег не записан. */
type OtherPlan = {
  car: CarKey
  ago: number
  kind: Exclude<EntryKind, 'fuel'>
  amount: number
  odometer: boolean
  fields?: Partial<Entry>
}

const OTHERS: readonly OtherPlan[] = [
  { car: 'daily', ago: 300, kind: 'wash', amount: 800, odometer: true },
  { car: 'daily', ago: 230, kind: 'wash', amount: 650, odometer: true },
  { car: 'daily', ago: 176, kind: 'wash', amount: 700, odometer: true },
  { car: 'daily', ago: 120, kind: 'wash', amount: 900, odometer: true, fields: { note: 'с химчисткой салона' } },
  { car: 'daily', ago: 58, kind: 'wash', amount: 650, odometer: true },
  // Единственная запись без пробега: в «Итогах» — «по N записям из M».
  { car: 'daily', ago: 25, kind: 'wash', amount: 700, odometer: false, fields: { note: 'пробег не записал' } },
  { car: 'daily', ago: 3, kind: 'wash', amount: 700, odometer: true },
  { car: 'rare', ago: 210, kind: 'wash', amount: 600, odometer: true },
  { car: 'rare', ago: 9, kind: 'wash', amount: 600, odometer: true },
  {
    car: 'rare',
    ago: 160,
    kind: 'repair',
    amount: 4300,
    odometer: true,
    fields: { what: 'замена масла и фильтров', service: 'Гараж на Заводской' },
  },
  {
    car: 'daily',
    ago: 40,
    kind: 'repair',
    amount: 6400,
    odometer: true,
    fields: { what: 'замена передних колодок', service: 'СТО на Лесной' },
  },
  // У штрафа одометра нет вовсе (KIND_FIELDS).
  {
    car: 'daily',
    ago: 150,
    kind: 'fine',
    amount: 500,
    odometer: false,
    fields: { violation: 'превышение скорости на 20–40 км/ч', paid: true },
  },
  {
    car: 'daily',
    ago: 12,
    kind: 'fine',
    amount: 1500,
    odometer: false,
    fields: { violation: 'остановка под знаком «Остановка запрещена»', paid: false },
  },
]

/** Через сколько дней после штрафа он оплачен. */
const PAID_AFTER = 4

// ─── Сборка ────────────────────────────────────────────────────────────────

/** Полночь дня по местному времени, мс: от неё — время внесения записи. */
function midnight(day: DateStr): number {
  return new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))).getTime()
}

/**
 * Демо на день входа `day`: машины, год журнала и валюта. Записи «внесены»
 * в день своей даты — id и `updatedAt` по нему: порядок внесения (Р-21)
 * совпадает с датами, и последняя внесённая — заправка дня входа.
 */
export function demoData(day: DateStr): DemoData {
  let seq = 0
  /** id и время правки записи, внесённой в этот день. Номер — чтобы не совпасть. */
  const stamp = (date: DateStr) => {
    const ms = midnight(date) + seq++
    return { id: ulid(ms), updatedAt: new Date(ms).toISOString() }
  }

  const first = addDays(day, -DEMO_DAYS - 1)
  const carOf = (key: CarKey): Car => ({ ...stamp(first), name: CARS[key].name, fuel: FUEL, tank: CARS[key].tank })
  // Каждодневная заведена первой: в выборе машины она выше.
  const daily = carOf('daily')
  const rare = carOf('rare')
  const carIds: Record<CarKey, string> = { daily: daily.id, rare: rare.id }

  type Plan = { car: CarKey; ago: number; build: (base: Entry) => Entry }
  const plans: Plan[] = []

  const fill = (car: CarKey, ago: number, station: StationKey, liters: number, consumption?: number) => {
    const price = priceAt(ago, station)
    plans.push({
      car,
      ago,
      build: (base) => ({
        ...base,
        amount: round2(liters * price),
        odometer: odometerAt(car, ago),
        station: STATIONS[station].name,
        fuel: FUEL,
        liters,
        price,
        ...(consumption === undefined ? {} : { consumption }),
      }),
    })
  }

  for (let ago = Math.floor(DEMO_DAYS / DAILY_EVERY) * DAILY_EVERY, k = 0; ago >= 0; ago -= DAILY_EVERY, k++) {
    const at = (list: readonly number[]) => list[k % list.length] ?? 0
    fill('daily', ago, DAILY_STATIONS[k % DAILY_STATIONS.length] ?? 'main', at(DAILY_LITERS), at(DAILY_CONSUMPTION))
  }
  for (const each of RARE_FILLS) fill('rare', each.ago, each.station, each.liters)

  for (const other of OTHERS) {
    plans.push({
      car: other.car,
      ago: other.ago,
      build: (base) => {
        const entry: Entry = { ...base, kind: other.kind, amount: other.amount, ...other.fields }
        if (other.odometer) entry.odometer = odometerAt(other.car, other.ago)
        if (other.kind === 'fine' && other.fields?.paid) entry.paidDate = addDays(entry.date, PAID_AFTER)
        return entry
      },
    })
  }

  // Старые раньше: id растут вместе с датой, как у записей, внесённых в свой день.
  plans.sort((a, b) => b.ago - a.ago)
  const entries = plans.map((plan) => {
    const date = addDays(day, -plan.ago)
    return plan.build({ ...stamp(date), carId: carIds[plan.car], kind: 'fuel', date, amount: 0 })
  })

  return {
    cars: [daily, rare],
    entries,
    points: [],
    routes: [],
    trips: [],
    parkings: [],
    parkingVisits: [],
    prefs: [{ ...stamp(first), id: PREFS_ID, currency: DEFAULT_CURRENCY }],
  }
}
