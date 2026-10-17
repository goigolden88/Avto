/**
 * Конфиг «Авто» для ядра `FamilyCore` (Р-02).
 *
 * Всё, чем «Авто» отличается для ядра, — одним объектом. Значения —
 * из `docs/02-Архитектура.md`, «Хранилища», «Раскладка данных
 * в репозитории» и «Конфиг ядра»: имя базы, состав `v1Stores`, индексы
 * и раскладка лягут на устройства и в `AvtoData` с первым релизом и после
 * этого не меняются (Р-20). Сторож — `config.test.ts`.
 *
 * Демо-данные — `screens/demo.ts` (задача 4 Авто-3). `summary` не задан:
 * срез для «Тотального Учёта» — задача 7.
 */

import type { AppConfig } from '../shared/core/model.ts'
import { SKIPPED_COLUMNS } from '../modules/log/import.ts'
import { demoData } from '../screens/demo.ts'
import { MIGRATIONS, SCHEMA_VERSION, SYNCED_STORES, V1_STORES, type StoreRecord } from './model.ts'

export const config: AppConfig<StoreRecord> = {
  name: 'Авто',

  // Имя обязано отличаться от остальных приложений семьи: все живут на одном
  // origin, а IndexedDB различается только именем. Не меняется никогда (Р-01).
  dbName: 'avto',

  schemaVersion: SCHEMA_VERSION,
  migrations: MIGRATIONS,
  stores: SYNCED_STORES,

  // Раскладка версии 1 — все восемь хранилищ с первого дня (Р-20).
  v1Stores: V1_STORES,

  // Сверх `updatedAt`: журнал и наблюдения читаются по дате и по тому, к чему
  // относятся, — машине, маршруту, месту. Справочники читаются целиком.
  indexes: {
    cars: [],
    entries: ['date', 'carId'],
    points: [],
    routes: [],
    trips: ['date', 'routeId'],
    parkings: [],
    parkingVisits: ['date', 'parkingId'],
    prefs: [],
  },

  // Справочники и настройки — одним файлом, записи — по году своей даты
  // (Р-19). Испорченная дата уходит в `<папка>/undated.json`, а не теряется.
  places: {
    cars: { split: 'none', path: 'cars.json' },
    entries: { split: 'year', dir: 'entries', dateOf: (entry) => entry.date },
    points: { split: 'none', path: 'points.json' },
    routes: { split: 'none', path: 'routes.json' },
    trips: { split: 'year', dir: 'trips', dateOf: (trip) => trip.date },
    parkings: { split: 'none', path: 'parkings.json' },
    parkingVisits: { split: 'year', dir: 'parking-visits', dateOf: (visit) => visit.date },
    prefs: { split: 'none', path: 'prefs.json' },
  },

  storeNotes: {
    cars: 'машины',
    entries: 'журнал: заправки, мойки, ремонты, штрафы и прочее — по году даты записи',
    points: 'точки маршрутов',
    routes: 'маршруты между точками',
    trips: 'поездки по маршрутам — по году',
    parkings: 'места парковки',
    parkingVisits: 'наблюдения парковок — по году',
    prefs: 'общие настройки — одна запись',
  },

  importFormat: 'avto-import',

  // Свои правила промпта — первыми, общие ядро допишет следом. Описания
  // разделов — журнала, `IMPORT_SPECS` (`modules/log/import.ts`).
  promptRules: [
    'Записей не выдумывай: чего нет в моих данных — не пиши. Необязательное поле, которого нет ' +
      'в данных, опусти. Запись без обязательного поля не пиши вовсе, а назови в списке после JSON.',
    'Даты — ГГГГ-ММ-ДД, время — ЧЧ:ММ. Любой вид (24.01.26, 20-02-2026, «3 марта») приводи к нему.',
    'Числа — числами, с точкой: 2583.49, а не «2 583,49 ₽».',
    `Столбцы ${SKIPPED_COLUMNS.map((column) => `«${column}»`).join(' и ')}, итоги и суммы за месяц не переноси: ` +
      'приложение посчитает их само.',
    'Машину не пиши: все записи файла — одной машины, её выбирают при загрузке.',
  ],

  // Две машины, год журнала, два месяца поездок и парковок от дня входа
  // в демо (Я-44, Я-45 «FamilyCore»).
  // Ядро засевает ими базу `avto-demo`, синхронизации у неё нет.
  demo: demoData,

  about: {
    data: 'учёт машины: траты, пробег, маршруты и парковки',
    privacy: 'внутри то, что, где и когда вы заправляли и чинили, где ездили и парковались',
    sources: 'таблицы учёта машины, чеки и заметки',
  },
}
