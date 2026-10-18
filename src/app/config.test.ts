import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDb } from '../shared/core/db.ts'
import { createLayout } from '../shared/core/layout.ts'
import { checkConfig, LOCAL_STORES } from '../shared/core/model.ts'
import { config } from './config.ts'
import {
  MIGRATIONS,
  RECORD_STORES,
  SCHEMA_VERSION,
  SYNCED_STORES,
  V1_STORES,
  type Entry,
  type StoreRecord,
} from './model.ts'

/**
 * Сторож конфига «Авто» (Р-20, Р-28).
 *
 * Механику ядра проверяют его тесты в его CI. Здесь — своё: то, что после
 * первого релиза лежит на устройствах и в `AvtoData` и не меняется никогда, —
 * имя базы, состав `v1Stores`, индексы и раскладка. Ожидаемое переписано
 * из таблицы `docs/02-Архитектура.md`, «Хранилища»: тест падает, если конфиг
 * с ней разошёлся.
 */

type Row = { store: keyof StoreRecord; indexes: string[]; file: string }

/** Таблица «Хранилища» из 02-Архитектуры, версия 1: хранилище, индексы сверх `updatedAt`, раскладка. */
const TABLE: Row[] = [
  { store: 'cars', indexes: [], file: 'cars.json' },
  { store: 'entries', indexes: ['date', 'carId'], file: 'entries/<год>.json' },
  { store: 'points', indexes: [], file: 'points.json' },
  { store: 'routes', indexes: [], file: 'routes.json' },
  { store: 'trips', indexes: ['date', 'routeId'], file: 'trips/<год>.json' },
  { store: 'parkings', indexes: [], file: 'parkings.json' },
  { store: 'parkingVisits', indexes: ['date', 'parkingId'], file: 'parking-visits/<год>.json' },
  { store: 'prefs', indexes: [], file: 'prefs.json' },
]

/** Строки той же таблицы с пометкой «версия 2, миграция» (Р-28). */
const V2_TABLE: Row[] = [{ store: 'plans', indexes: [], file: 'plans.json' }]

const ALL_ROWS = [...TABLE, ...V2_TABLE]

const db = createDb(config)
const layout = createLayout(config)

/** Пустой слепок всех хранилищ: раскладке нужны все ключи разом. */
function empty(): { [S in keyof StoreRecord]: StoreRecord[S][] } {
  return {
    cars: [],
    entries: [],
    points: [],
    routes: [],
    trips: [],
    parkings: [],
    parkingVisits: [],
    prefs: [],
    plans: [],
  }
}

const at = '2026-10-16T10:00:00.000Z'

function entry(id: string, date: string): Entry {
  return { id, updatedAt: at, carId: 'car-1', kind: 'wash', date, amount: 500 }
}

beforeEach(async () => {
  await db.close().catch(() => {})
  globalThis.indexedDB = new IDBFactory()
})

afterEach(async () => {
  await db.close().catch(() => {})
})

describe('то, что не меняется после первого релиза', () => {
  it('база называется avto — на общем origin только имя разводит приложения семьи (Р-01)', () => {
    expect(config.dbName).toBe('avto')
    expect(config.name).toBe('Авто')
  })

  it('раскладка версии 1 — те же восемь хранилищ таблицы 02, в её порядке', () => {
    expect([...V1_STORES]).toEqual(TABLE.map((row) => row.store))
    expect([...config.v1Stores]).toEqual(TABLE.map((row) => row.store))
  })

  it('хранилищ девять: восемь версии 1 и следом планы версии 2 (Р-28)', () => {
    expect([...config.stores]).toEqual(ALL_ROWS.map((row) => row.store))
    expect([...SYNCED_STORES]).toHaveLength(9)
  })

  it('записи человека — все хранилища, кроме общих настроек: валюта записью не считается', () => {
    expect([...RECORD_STORES]).toEqual(ALL_ROWS.map((row) => row.store).filter((store) => store !== 'prefs'))
  })

  it('хранилище точек — points, а не places: places у ядра — раскладка файлов (Р-12)', () => {
    expect(config.stores).toContain('points')
    expect(config.stores as readonly string[]).not.toContain('places')
  })

  it('формат импорта — avto-import', () => {
    expect(config.importFormat).toBe('avto-import')
  })

  it('конфиг сходится по проверке ядра', () => {
    expect(() => checkConfig(config)).not.toThrow()
  })

  it('имена хранилищ не сталкиваются с локальными хранилищами ядра', () => {
    for (const store of config.stores) {
      expect(LOCAL_STORES as readonly string[]).not.toContain(store)
    }
  })

  it('демо есть (задача 4 Авто-3), срез итогов — тоже (задача 7, Р-27)', () => {
    expect(typeof config.demo).toBe('function')
    expect(typeof config.summary).toBe('function')
  })
})

/** Имена хранилищ и их индексов в базе `avto` на устройстве — мимо `db`, напрямую. */
function storesOnDevice(): Promise<Record<string, string[]>> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('avto')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const names = [...database.objectStoreNames]
      const tx = database.transaction(names, 'readonly')
      const result = Object.fromEntries(names.map((name) => [name, [...tx.objectStore(name).indexNames].sort()]))
      database.close()
      resolve(result)
    }
  })
}

describe('схема версии 2 (Р-20, Р-28)', () => {
  it('версия схемы 2, шаг миграции один — на 2, только добавляет', () => {
    expect(config.schemaVersion).toBe(2)
    expect(SCHEMA_VERSION).toBe(2)
    expect(config.migrations).toBe(MIGRATIONS)
    expect(config.migrations).toHaveLength(1)
    expect(config.migrations[0]).toMatchObject({ to: 2, additive: true })
  })

  it('свежая база открывается: все девять хранилищ есть и пусты', async () => {
    for (const store of config.stores) {
      expect(await db.count(store)).toBe(0)
    }
  })

  it('у планов — только индекс updatedAt, его заводит шаг миграции', async () => {
    await db.count('plans')
    await db.close()
    expect((await storesOnDevice()).plans).toEqual(['updatedAt'])
  })

  it('база версии 1 с записями открывается на версии 2: всё на месте, планы есть и пусты', async () => {
    const car = { id: '01J000000000000000000010', updatedAt: at, name: 'Солярис' }
    const prefs = { id: 'prefs:main', updatedAt: at, currency: '€' }
    const old = entry('01J000000000000000000011', '2026-03-02')
    const trip = {
      id: '01J000000000000000000012',
      updatedAt: at,
      routeId: 'route-1',
      date: '2026-03-02',
      start: '08:10',
      minutes: 38,
      source: 'timer' as const,
    }
    // База, какой её оставило «Авто» версии 1, — путём ядра, как на устройстве.
    expect(await db.createLegacyBase(1, { cars: [car], entries: [old], trips: [trip], prefs: [prefs] })).toEqual([])
    expect(Object.keys(await storesOnDevice())).not.toContain('plans')

    expect(await db.getAll('cars')).toEqual([car])
    expect(await db.getAll('entries')).toEqual([old])
    expect(await db.getAll('trips')).toEqual([trip])
    expect(await db.get('prefs', 'prefs:main')).toEqual(prefs)
    expect(await db.count('plans')).toBe(0)
    // Индексы версии 1 на месте: журнал читается по дате, как раньше.
    expect(await db.getByIndex('entries', 'date', '2026-03-02')).toEqual([old])

    await db.put('plans', { id: '01J000000000000000000013', updatedAt: at, carId: car.id, what: 'заменить колодки' })
    expect(await db.getAll('plans')).toHaveLength(1)

    await db.close()
    const device = await storesOnDevice()
    expect(device.plans).toEqual(['updatedAt'])
    expect(device.entries).toEqual(['carId', 'date', 'updatedAt'])
  })

  it('по индексам таблицы читается: журнал — по дате и машине, поездки и наблюдения — по своим', async () => {
    await db.put('entries', entry('01J000000000000000000001', '2026-03-02'))
    await db.put('entries', { ...entry('01J000000000000000000002', '2025-12-30'), carId: 'car-2' })
    await db.put('trips', {
      id: '01J000000000000000000003',
      updatedAt: at,
      routeId: 'route-1',
      date: '2026-03-02',
      start: '08:10',
      minutes: 38,
      source: 'timer',
    })
    await db.put('parkingVisits', {
      id: '01J000000000000000000004',
      updatedAt: at,
      parkingId: 'parking-1',
      date: '2026-03-02',
      time: '19:00',
      result: 'hard',
    })

    const march = await db.getByIndex('entries', 'date', { from: '2026-03-01', to: '2026-03-31' })
    expect(march.map((each) => each.id)).toEqual(['01J000000000000000000001'])
    expect((await db.getByIndex('entries', 'carId', 'car-2')).map((each) => each.id)).toEqual(['01J000000000000000000002'])
    expect(await db.getByIndex('trips', 'routeId', 'route-1')).toHaveLength(1)
    expect(await db.getByIndex('trips', 'date', '2026-03-02')).toHaveLength(1)
    expect(await db.getByIndex('parkingVisits', 'parkingId', 'parking-1')).toHaveLength(1)
    expect(await db.getByIndex('parkingVisits', 'date', '2026-03-02')).toHaveLength(1)
  })

  it('общие настройки — запись prefs:main пишется и читается', async () => {
    await db.put('prefs', { id: 'prefs:main', updatedAt: at, currency: '€' })
    expect(await db.get('prefs', 'prefs:main')).toMatchObject({ currency: '€' })
  })
})

describe('индексы — ровно по таблице 02', () => {
  for (const row of ALL_ROWS) {
    it(`${row.store}: ${row.indexes.length > 0 ? row.indexes.join(', ') : 'только updatedAt'}`, () => {
      expect([...config.indexes[row.store]]).toEqual(row.indexes)
    })
  }
})

describe('раскладка по файлам — ровно по таблице 02 (Р-19)', () => {
  for (const row of ALL_ROWS) {
    it(`${row.store} → ${row.file}`, () => {
      const place = config.places[row.store]
      const file = place.split === 'none' ? place.path : `${place.dir}/<год>.json`
      expect(file).toBe(row.file)
      if (place.split !== 'none') expect(place.split).toBe('year')
    })
  }

  it('запись журнала ложится в год своей даты, справочники — файлами даже пустыми', () => {
    const files = layout.buildFiles({
      ...empty(),
      entries: [entry('01J000000000000000000001', '2026-03-02'), entry('01J000000000000000000002', '2025-12-30')],
    })
    const paths = files.map((file) => file.path)
    expect(paths).toEqual(
      expect.arrayContaining([
        'meta.json',
        'cars.json',
        'points.json',
        'routes.json',
        'parkings.json',
        'prefs.json',
        'plans.json',
        'entries/2026.json',
        'entries/2025.json',
      ]),
    )
    expect(paths.some((path) => /^entries\/\d{4}-\d{2}\.json$/.test(path))).toBe(false)
  })

  it('meta.json называет приложение avto (Я-24 «FamilyCore»)', () => {
    const meta = layout.buildFiles(empty()).find((file) => file.path === 'meta.json')
    expect(JSON.parse(meta?.content ?? '{}')).toEqual({ app: 'avto', schemaVersion: 2 })
  })

  it('поездка и наблюдение парковки — тоже по году своей даты', () => {
    const files = layout.buildFiles({
      ...empty(),
      trips: [
        { id: '01J000000000000000000003', updatedAt: at, routeId: 'r', date: '2026-05-01', start: '08:00', minutes: 30, source: 'manual' },
      ],
      parkingVisits: [
        { id: '01J000000000000000000004', updatedAt: at, parkingId: 'p', date: '2027-01-02', time: '10:00', result: 'easy' },
      ],
    })
    const paths = files.map((file) => file.path)
    expect(paths).toContain('trips/2026.json')
    expect(paths).toContain('parking-visits/2027.json')
  })

  it('запись с испорченной датой не теряется — уходит в undated', () => {
    const files = layout.buildFiles({ ...empty(), entries: [entry('01J000000000000000000005', 'вчера')] })
    expect(files.map((file) => file.path)).toContain('entries/undated.json')
  })
})
