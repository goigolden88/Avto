import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDb } from '../shared/core/db.ts'
import { createLayout } from '../shared/core/layout.ts'
import { checkConfig, LOCAL_STORES } from '../shared/core/model.ts'
import { config } from './config.ts'
import { RECORD_STORES, SCHEMA_VERSION, SYNCED_STORES, V1_STORES, type Entry, type StoreRecord } from './model.ts'

/**
 * Сторож конфига «Авто» (Р-20).
 *
 * Механику ядра проверяют его тесты в его CI. Здесь — своё: то, что после
 * первого релиза лежит на устройствах и в `AvtoData` и не меняется никогда, —
 * имя базы, состав `v1Stores`, индексы и раскладка. Ожидаемое переписано
 * из таблицы `docs/02-Архитектура.md`, «Хранилища»: тест падает, если конфиг
 * с ней разошёлся.
 */

/** Таблица «Хранилища» из 02-Архитектуры: хранилище, индексы сверх `updatedAt`, раскладка. */
const TABLE: { store: keyof StoreRecord; indexes: string[]; file: string }[] = [
  { store: 'cars', indexes: [], file: 'cars.json' },
  { store: 'entries', indexes: ['date', 'carId'], file: 'entries/<год>.json' },
  { store: 'points', indexes: [], file: 'points.json' },
  { store: 'routes', indexes: [], file: 'routes.json' },
  { store: 'trips', indexes: ['date', 'routeId'], file: 'trips/<год>.json' },
  { store: 'parkings', indexes: [], file: 'parkings.json' },
  { store: 'parkingVisits', indexes: ['date', 'parkingId'], file: 'parking-visits/<год>.json' },
  { store: 'prefs', indexes: [], file: 'prefs.json' },
]

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

  it('раскладка версии 1 — восемь хранилищ таблицы 02, в её порядке', () => {
    expect([...V1_STORES]).toEqual(TABLE.map((row) => row.store))
    expect([...config.v1Stores]).toEqual(TABLE.map((row) => row.store))
    expect([...config.stores]).toEqual([...config.v1Stores])
    expect([...SYNCED_STORES]).toHaveLength(8)
  })

  it('записи человека — все хранилища, кроме общих настроек: валюта записью не считается', () => {
    expect([...RECORD_STORES]).toEqual(TABLE.map((row) => row.store).filter((store) => store !== 'prefs'))
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

  it('демо и среза пока нет — задачи 4 и 7 Авто-3', () => {
    expect(config.demo).toBeUndefined()
    expect(config.summary).toBeUndefined()
  })
})

describe('схема версии 1 (Р-20)', () => {
  it('версия схемы 1, шагов миграции нет', () => {
    expect(config.schemaVersion).toBe(1)
    expect(SCHEMA_VERSION).toBe(1)
    expect(config.migrations).toEqual([])
  })

  it('свежая база открывается: все восемь хранилищ есть и пусты', async () => {
    for (const store of config.stores) {
      expect(await db.count(store)).toBe(0)
    }
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
  for (const row of TABLE) {
    it(`${row.store}: ${row.indexes.length > 0 ? row.indexes.join(', ') : 'только updatedAt'}`, () => {
      expect([...config.indexes[row.store]]).toEqual(row.indexes)
    })
  }
})

describe('раскладка по файлам — ровно по таблице 02 (Р-19)', () => {
  for (const row of TABLE) {
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
        'entries/2026.json',
        'entries/2025.json',
      ]),
    )
    expect(paths.some((path) => /^entries\/\d{4}-\d{2}\.json$/.test(path))).toBe(false)
  })

  it('meta.json называет приложение avto (Я-24 «FamilyCore»)', () => {
    const meta = layout.buildFiles(empty()).find((file) => file.path === 'meta.json')
    expect(JSON.parse(meta?.content ?? '{}')).toEqual({ app: 'avto', schemaVersion: 1 })
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
