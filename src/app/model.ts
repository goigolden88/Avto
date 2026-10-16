/**
 * Модель данных «Авто» — дословно из `docs/02-Архитектура.md`, «Модель данных».
 *
 * `Base`, `Migration` и раскладка — договор семьи из ядра, здесь не
 * переопределяются. Типы журнала, маршрутов и парковок заведены сразу,
 * хотя экраны у них появятся позже: хранилища под них — в схеме версии 1
 * (Р-20), и форма записей известна заранее.
 *
 * Имена полей меняются только вместе с Архитектурой: она источник истины,
 * а не этот файл.
 */

import type { Base, Migration } from '../shared/core/model.ts'

// ─── Машины ────────────────────────────────────────────────────────────────

export type Car = Base & {
  /** «Солярис», «Мамина» */
  name: string
  /** госномер */
  plate?: string
  /** топливо по умолчанию: «95», «92», «ДТ», «газ» */
  fuel?: string
  /** объём бака, л — для доли бака в заправке */
  tank?: number
  /** продана — из выбора уходит, история остаётся */
  archived?: boolean
}

// ─── Журнал (Р-03) ─────────────────────────────────────────────────────────

export type EntryKind = 'fuel' | 'wash' | 'repair' | 'fine' | 'other'

/**
 * Запись журнала — одна из пяти видов вместо четырёх листов Excel (Р-03).
 * У заправки из `liters`, `price`, `amount` вводятся любые два, третье
 * считается при сохранении и хранится (Р-06).
 */
export type Entry = Base & {
  carId: string
  kind: EntryKind
  /** ГГГГ-ММ-ДД */
  date: string
  /** сколько заплатил; у заправки — одно из трёх чисел (Р-06) */
  amount: number
  /** пробег по одометру, км */
  odometer?: number
  /** «Примечание», «Коммент», «Субъективная причина» Excel */
  note?: string

  // fuel
  /** АЗС: «Лукойл», «Газпром» */
  station?: string
  /** по умолчанию — машины */
  fuel?: string
  liters?: number
  /** цена литра */
  price?: number
  /** л/100 км с бортового компьютера, как показал при заправке (Р-05) */
  consumption?: number
  /** доля бака до и после, 0…1 */
  tankBefore?: number
  tankAfter?: number

  // repair, other
  /** «замена колодок», «ОСАГО» */
  what?: string
  /** где делал (repair) */
  service?: string

  // fine
  violation?: string
  paid?: boolean
  paidDate?: string
}

// ─── Маршруты (Р-12…Р-15) ──────────────────────────────────────────────────

/** Точка маршрута. Хранилище — `points`, не `places`: то имя у ядра (Р-12). */
export type Point = Base & {
  /** «Дом», «Работа», «ТЦ Мега» */
  name: string
  city: string
}

/** Маршрут пары точек. Направление важно: «Дом → Работа» и обратно — разные пары. */
export type Route = Base & {
  /** Point */
  fromId: string
  /** Point */
  toId: string
  /** «по МКАД», «через центр» */
  name: string
  /** маршрут в Яндекс Картах */
  link?: string
  note?: string
}

/** Поездка — замером или вручную (Р-13). Незаконченный замер в базу не пишется. */
export type Trip = Base & {
  routeId: string
  carId?: string
  /** ГГГГ-ММ-ДД */
  date: string
  /** время выезда, ЧЧ:ММ */
  start: string
  /** в пути */
  minutes: number
  source: 'timer' | 'manual'
  /** «мероприятие», «ливень», «авария на въезде» */
  note?: string
}

// ─── Парковки (Р-16) ───────────────────────────────────────────────────────

export type Parking = Base & {
  /** у какой точки */
  pointId?: string
  city: string
  /** «двор за домом», «ТЦ, минус первый» */
  where: string
  /** «бесплатно», «150 ₽/час» — справочно, не деньги журнала */
  price?: string
  link?: string
  note?: string
}

export type ParkingVisit = Base & {
  parkingId: string
  /** ГГГГ-ММ-ДД */
  date: string
  /** ЧЧ:ММ */
  time: string
  /** сразу / с трудом / мест нет */
  result: 'easy' | 'hard' | 'none'
  searchMinutes?: number
  note?: string
}

// ─── Общие настройки (Р-17) ────────────────────────────────────────────────

/**
 * Настройки, общие для всех устройств: одна запись `prefs:main`.
 * Не `settings` ядра: там токен и состояние устройства, и они не
 * синхронизируются никогда.
 */
export type Prefs = Base & {
  /** по умолчанию «₽» */
  currency: string
}

// ─── Хранилища ─────────────────────────────────────────────────────────────

/**
 * Таблица приложения для ядра: имя синхронизируемого хранилища → тип записи.
 * Она и есть `R` для `AppConfig<R>`.
 */
export type StoreRecord = {
  cars: Car
  entries: Entry
  points: Point
  routes: Route
  trips: Trip
  parkings: Parking
  parkingVisits: ParkingVisit
  prefs: Prefs
}

export type SyncedStore = keyof StoreRecord

/**
 * Раскладка версии 1 — заморожена после первого релиза (Р-20). Все восемь
 * хранилищ в ней с первого дня: модель известна заранее, и маршрутам
 * с парковками не нужна будет первая миграция (02-Архитектура, «Хранилища»).
 * Новое хранилище сюда не дописывается — только шагом миграции.
 */
export const V1_STORES = [
  'cars',
  'entries',
  'points',
  'routes',
  'trips',
  'parkings',
  'parkingVisits',
  'prefs',
] as const satisfies readonly SyncedStore[]

/** Порядок, в котором хранилища пишут импорт и слепок: справочники раньше записей. */
export const SYNCED_STORES = [...V1_STORES] as const satisfies readonly SyncedStore[]

/**
 * Хранилища с записями человека — все, кроме общих настроек. По ним главный
 * экран решает, что «записей пока нет»: выбранная валюта записью не считается.
 */
export const RECORD_STORES: readonly SyncedStore[] = SYNCED_STORES.filter((store) => store !== 'prefs')

export const SCHEMA_VERSION = 1

/** Шагов нет: это первая схема (Р-20). Реестр заведён пустым с первого дня. */
export const MIGRATIONS: readonly Migration[] = []
