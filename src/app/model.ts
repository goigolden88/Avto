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

// ─── Планы (Р-28) ──────────────────────────────────────────────────────────

/**
 * План ремонта или ТО по машине: совет мастера, «сделать в ближайшее время».
 * Срок — дата (`date`), «с… по…» (`date` и `until`), регулярный (`date` и
 * `everyMonths`, Р-29) или без срока (`date` нет). Ориентир по пробегу —
 * справочный: ни на «пора», ни на «Главную» не влияет (Р-11). «Сделано»
 * превращает план в запись «Ремонт» журнала, у регулярного — и заводит
 * следующий план.
 */
export type Plan = Base & {
  carId: string
  /** что сделать: «заменить ремень ГРМ», «ТО-4» */
  what: string
  /** срок или начало «с… по…», ГГГГ-ММ-ДД. Нет — план без срока */
  date?: string
  /** конец «с… по…», только вместе с `date`, не раньше него */
  until?: string
  /** повтор регулярного плана, месяцев: целое от 1 до 120, только вместе с `date` и без `until` (Р-29) */
  everyMonths?: number
  /** ориентир по пробегу, км */
  odometer?: number
  note?: string
  /** когда сделано, ГГГГ-ММ-ДД */
  doneDate?: string
  /** запись «Ремонт», которой сделано */
  entryId?: string
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
  plans: Plan
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

/** Хранилища версии 2 — заводит шаг миграции `PLANS_STEP` (Р-28), а не `v1Stores`. */
export const PLAN_STORES = ['plans'] as const satisfies readonly SyncedStore[]

/** Порядок, в котором хранилища пишут импорт и слепок: справочники раньше записей. */
export const SYNCED_STORES = [...V1_STORES, ...PLAN_STORES] as const satisfies readonly SyncedStore[]

/**
 * Хранилища с записями человека — все, кроме общих настроек. По ним главный
 * экран решает, что «записей пока нет»: выбранная валюта записью не считается.
 */
export const RECORD_STORES: readonly SyncedStore[] = SYNCED_STORES.filter((store) => store !== 'prefs')

export const SCHEMA_VERSION = 2

/**
 * Первая миграция «Авто» (Р-28): хранилище планов. Только добавляет — записи
 * восьми хранилищ версии 1 шаг не трогает. Индекс один — `updatedAt`, нужен
 * слиянию: планов десятки, читаются целиком.
 */
const PLANS_STEP: Migration = {
  to: 2,
  note: 'Планы ремонта и ТО по машине — хранилище plans (Р-28). Записи других хранилищ не трогаются.',
  additive: true,
  run: (db) => {
    const store = db.createObjectStore('plans', { keyPath: 'id' })
    store.createIndex('updatedAt', 'updatedAt') // нужен слиянию
  },
}

/** Шаги по порядку версий. Реестр заведён пустым с первого дня (Р-20). */
export const MIGRATIONS: readonly Migration[] = [PLANS_STEP]
