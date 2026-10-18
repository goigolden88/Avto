/**
 * Демо-данные (Я-44, Я-45 «FamilyCore»): две машины, год журнала и два
 * месяца поездок и парковок до дня входа в демо. Даты отсчитываются от этого дня —
 * демо всегда свежее.
 *
 * Машины — каждодневная с бортовым компьютером (у её заправок введён
 * расход, у части — бак до и после) и редкая без него. В журнале —
 * заправки на трёх АЗС с разными ценами, мойки, два ремонта, два штрафа
 * (оплачен и нет) и одна мойка без пробега: она выпадает из основания цены
 * километра — «по N записям из M».
 *
 * Всё задано днями до входа (`ago`), а не датами: от дня зависит только
 * календарь, а пробег, цены и порядок записей одинаковы в любой день. Цена
 * литра растёт ступенькой раз в `PRICE_EVERY` дней — от заправки к заправке
 * она в основном растёт, а две заправки на одной АЗС внутри ступеньки — «без
 * изменений». Пробег растёт с датой у каждой машины своим темпом.
 *
 * Маршруты (задача 6 Авто-3, #20): три точки, четыре маршрута и поездки за
 * `TRIP_DAYS` дней. На паре «Дом → Работа» два маршрута: «по МКАД» ровный,
 * «через центр» в 7 часов быстрее, а в 8 и 9 — заметно дольше; медианы
 * расходятся. Поездки — замером и вручную, в будни и в выходные, несколько —
 * с заметкой и выбросом минут.
 *
 * Парковки (задача 6 Авто-3, #21): три места у точек в Москве и одно без
 * точки в Твери, отметки за те же `TRIP_DAYS` дней. У работы утром встать
 * сразу, вечером мест почти нет; дома днём легко, вечером — с трудом или
 * никак; в ТЦ в субботу хуже, чем в воскресенье. Часть отметок — без минут
 * поиска, несколько — с заметкой.
 *
 * Чистая функция, без React и без базы: засевает ядро при создании базы
 * `avto-demo`. Данные выдуманные — репозиторий публичный.
 */

import type { Car, Entry, EntryKind, Parking, ParkingVisit, Point, Route, StoreRecord, SyncedStore, Trip } from '../app/model.ts'
import { round2 } from '../modules/log/numbers.ts'
import { weekdayOf } from '../modules/parking/stats.ts'
import { isWeekend } from '../modules/routes/compare.ts'
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

/**
 * Доля бака каждодневной до и после — по кругу; `null` — не отметил, в
 * строке журнала про бак ничего. После всегда не меньше, чем до (Р-25).
 */
const DAILY_TANK: readonly ({ before: number; after: number } | null)[] = [
  { before: 0.2, after: 1 },
  null,
  { before: 0.15, after: 0.95 },
  { before: 0.25, after: 1 },
  null,
]

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

// ─── Маршруты ──────────────────────────────────────────────────────────────

/** Сколько дней поездок до дня входа: первая — не раньше. */
export const TRIP_DAYS = 60

const CITY = 'Москва'

type PointKey = 'home' | 'work' | 'mall'

const POINTS: Record<PointKey, string> = { home: 'Дом', work: 'Работа', mall: 'ТЦ Мега' }

type RouteKey = 'ring' | 'center' | 'back' | 'shop'

const ROUTES: Record<RouteKey, { from: PointKey; to: PointKey; name: string; link?: string; note?: string }> = {
  ring: { from: 'home', to: 'work', name: 'по МКАД', link: 'https://yandex.ru/maps/' },
  center: { from: 'home', to: 'work', name: 'через центр', note: 'в час пик стоит Садовое' },
  back: { from: 'work', to: 'home', name: 'по МКАД' },
  shop: { from: 'home', to: 'mall', name: 'по Ленинскому' },
}

/** Часы утреннего выезда в будни — по кругу, у каждого маршрута все три. */
const MORNING_HOURS = [7, 8, 9] as const

/** Минуты в пути «Дом → Работа» по часу выезда: центр быстрее рано, дольше в час пик. */
const MORNING: Record<'ring' | 'center', Record<(typeof MORNING_HOURS)[number], number>> = {
  ring: { 7: 36, 8: 40, 9: 38 },
  center: { 7: 29, 8: 58, 9: 50 },
}

/** В выходные утром «Дом → Работа» пусто, а в ТЦ — как обычно. */
const WEEKEND_MINUTES: Record<RouteKey, number> = { ring: 31, center: 24, back: 0, shop: 26 }

/** Вечером «Работа → Дом». */
const EVENING_MINUTES = 41

/** Разброс минут по кругу: одинаковых поездок не бывает. */
const JITTER: readonly number[] = [0, 2, -1, 3, -2, 1, 0, -3]

/** Минуты выезда по кругу. */
const PAST_HOUR: readonly string[] = ['05', '20', '35', '50']

/** Выбросы с заметкой: номер утренней поездки в будни → почему дольше. */
const NOTED: ReadonlyMap<number, { note: string; extra: number }> = new Map([
  [4, { note: 'ливень', extra: 18 }],
  [11, { note: 'авария на въезде', extra: 25 }],
  [23, { note: 'мероприятие в центре', extra: 20 }],
])

/** Каждая такая поездка вписана вручную — забыли включить замер. */
const MANUAL_EVERY = 5

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

// ─── Парковки ──────────────────────────────────────────────────────────────

type ParkingKey = 'home' | 'work' | 'mall' | 'station'

const PARKINGS: Record<ParkingKey, { point?: PointKey; city: string; where: string; price?: string; link?: string; note?: string }> = {
  home: { point: 'home', city: CITY, where: 'двор за домом', price: 'бесплатно' },
  work: { point: 'work', city: CITY, where: 'вдоль забора у работы', price: 'бесплатно', note: 'к вечеру занимает соседний офис' },
  mall: { point: 'mall', city: CITY, where: 'ТЦ Мега, минус первый', price: 'первые три часа бесплатно', link: 'https://yandex.ru/maps/' },
  // Без точки и в другом городе: места на экране собраны по городу.
  station: { city: 'Тверь', where: 'у вокзала', price: 'платно, по часам' },
}

/** Минуты поиска по результату — по кругу. */
const SEARCH: Record<ParkingVisit['result'], readonly number[]> = { easy: [0, 1, 0, 2], hard: [7, 10, 6, 12], none: [15, 20, 18] }

/** Каждая такая отметка — без минут: искал, но не засёк. В медиану она не входит. */
const NO_MINUTES_EVERY = 4

/** За сколько дней до входа — поездка в Тверь. */
const STATION_AGO = 33

// ─── Сборка ────────────────────────────────────────────────────────────────

/** Полночь дня по местному времени, мс: от неё — время внесения записи. */
function midnight(day: DateStr): number {
  return new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))).getTime()
}

/**
 * Демо на день входа `day`: машины, год журнала, маршруты с поездками,
 * парковки с отметками и валюта. Записи «внесены»
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

  const fill = (
    car: CarKey,
    ago: number,
    station: StationKey,
    liters: number,
    consumption?: number,
    tank?: { before: number; after: number } | null,
  ) => {
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
        ...(tank ? { tankBefore: tank.before, tankAfter: tank.after } : {}),
      }),
    })
  }

  for (let ago = Math.floor(DEMO_DAYS / DAILY_EVERY) * DAILY_EVERY, k = 0; ago >= 0; ago -= DAILY_EVERY, k++) {
    const at = (list: readonly number[]) => list[k % list.length] ?? 0
    const tank = DAILY_TANK[k % DAILY_TANK.length] ?? null
    fill('daily', ago, DAILY_STATIONS[k % DAILY_STATIONS.length] ?? 'main', at(DAILY_LITERS), at(DAILY_CONSUMPTION), tank)
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

  // Маршруты: справочники заведены в начале года демо, поездки — в свой день.
  const pointOf = (key: PointKey): Point => ({ ...stamp(first), name: POINTS[key], city: CITY })
  const points: Record<PointKey, Point> = { home: pointOf('home'), work: pointOf('work'), mall: pointOf('mall') }
  const routeOf = (key: RouteKey): Route => {
    const plan = ROUTES[key]
    const route: Route = { ...stamp(first), fromId: points[plan.from].id, toId: points[plan.to].id, name: plan.name }
    if (plan.link) route.link = plan.link
    if (plan.note) route.note = plan.note
    return route
  }
  const routes: Record<RouteKey, Route> = {
    ring: routeOf('ring'),
    center: routeOf('center'),
    back: routeOf('back'),
    shop: routeOf('shop'),
  }

  const trips: Trip[] = []
  let weekday = 0
  let weekend = 0
  for (let ago = TRIP_DAYS; ago >= 1; ago--) {
    const date = addDays(day, -ago)
    const trip = (key: RouteKey, hour: number, past: number, minutes: number, fields: Partial<Trip> = {}) => {
      trips.push({
        ...stamp(date),
        routeId: routes[key].id,
        carId: carIds.daily,
        date,
        start: `${pad2(hour)}:${PAST_HOUR[past % PAST_HOUR.length] ?? '00'}`,
        minutes,
        source: 'timer',
        ...fields,
      })
    }

    if (isWeekend(date)) {
      // Через раз — в ТЦ на редкой машине, иначе на работу: то по МКАД, то через центр.
      const key: RouteKey = weekend % 2 === 0 ? 'shop' : weekend % 4 === 1 ? 'ring' : 'center'
      const jitter = JITTER[weekend % JITTER.length] ?? 0
      trip(key, key === 'shop' ? 12 : 10, weekend, WEEKEND_MINUTES[key] + jitter, key === 'shop' ? { carId: carIds.rare } : {})
      weekend++
      continue
    }

    // Будни: утром на работу — маршруты через раз, у каждого все часы выезда по кругу.
    const key = weekday % 2 === 0 ? 'ring' : 'center'
    const hour = MORNING_HOURS[Math.floor(weekday / 2) % MORNING_HOURS.length] ?? 8
    const jitter = JITTER[weekday % JITTER.length] ?? 0
    const noted = NOTED.get(weekday)
    trip(key, hour, weekday, MORNING[key][hour] + jitter + (noted?.extra ?? 0), {
      ...(weekday % MANUAL_EVERY === MANUAL_EVERY - 2 ? { source: 'manual' } : {}),
      ...(noted ? { note: noted.note } : {}),
    })
    // Вечером домой — через день.
    if (weekday % 2 === 1) trip('back', 18, weekday + 1, EVENING_MINUTES + jitter)
    weekday++
  }

  // Парковки: места заведены в начале года демо, отметки — в свой день.
  const parkingOf = (key: ParkingKey): Parking => {
    const { point, ...fields } = PARKINGS[key]
    return { ...stamp(first), ...fields, ...(point ? { pointId: points[point].id } : {}) }
  }
  const parkings: Record<ParkingKey, Parking> = {
    home: parkingOf('home'),
    work: parkingOf('work'),
    mall: parkingOf('mall'),
    station: parkingOf('station'),
  }

  const visits: ParkingVisit[] = []
  const visit = (key: ParkingKey, date: DateStr, hour: number, result: ParkingVisit['result'], note?: string) => {
    const n = visits.length
    const record: ParkingVisit = {
      ...stamp(date),
      parkingId: parkings[key].id,
      date,
      time: `${pad2(hour)}:${PAST_HOUR[n % PAST_HOUR.length] ?? '00'}`,
      result,
    }
    if (n % NO_MINUTES_EVERY !== NO_MINUTES_EVERY - 1) record.searchMinutes = SEARCH[result][n % SEARCH[result].length] ?? 0
    if (note) record.note = note
    visits.push(record)
  }

  let workday = 0
  let restday = 0
  let saturdays = 0
  for (let ago = TRIP_DAYS; ago >= 1; ago--) {
    const date = addDays(day, -ago)
    if (ago === STATION_AGO) {
      visit('station', date, 11, 'easy')
      visit('station', date, 16, 'hard')
    }

    if (isWeekend(date)) {
      // Выходные: дома днём встать легко; в ТЦ в субботу — с трудом, в воскресенье — сразу.
      visit('home', date, 13, 'easy', restday === 3 ? 'ярмарка во дворе, но место нашлось' : undefined)
      if (weekdayOf(date) !== 5) visit('mall', date, 12, 'easy')
      else if (saturdays++ === 2) visit('mall', date, 12, 'none', 'распродажа, минус первый занят')
      else visit('mall', date, 12, 'hard')
      restday++
      continue
    }

    // Будни: у работы утром сразу, к девяти — когда как; вечером мест почти нет.
    const late = workday % 3 === 2
    visit('work', date, late ? 9 : 8, late && workday % 2 === 0 ? 'hard' : 'easy', workday === 10 ? 'ремонт дороги у ворот' : undefined)
    if (workday % 3 === 0) visit('work', date, 18, workday % 9 === 3 ? 'hard' : 'none')
    // Дома вечером: в семь — с трудом, ближе к ночи — мест нет.
    if (workday % 2 === 1) visit('home', date, workday % 4 === 1 ? 19 : 21, workday % 4 === 1 ? 'hard' : 'none')
    workday++
  }

  return {
    cars: [daily, rare],
    entries,
    points: Object.values(points),
    routes: Object.values(routes),
    trips,
    parkings: Object.values(parkings),
    parkingVisits: visits,
    prefs: [{ ...stamp(first), id: PREFS_ID, currency: DEFAULT_CURRENCY }],
  }
}
