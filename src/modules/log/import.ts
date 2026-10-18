/**
 * Импорт журнала (Р-10): Excel владельца через ИИ → записи `Entry` одной
 * машины.
 *
 * Разделы файла `avto-import` — виды записей: `fuel`, `wash`, `repair`,
 * `fine`, `other`. Листы Excel и их столбцы ложатся на поля по таблице
 * 02-Архитектуры, «Импорт Excel»; описания разделов для промпта собираются
 * здесь же, из тех же списков, по которым идёт проверка, — разойтись они
 * не могут. Машины в формате нет: все записи файла идут к машине, выбранной
 * при загрузке.
 *
 * Правила — те же, что у формы: у заправки два числа из трёх, третье
 * считается и хранится (Р-06); три несходящихся — как есть, с заметкой;
 * топлива нет — топливо машины. «Уже есть» — живая запись той же машины
 * с тем же видом, датой и суммой, в базе или раньше в том же файле.
 *
 * Разбор файла и промпт — ядра (`createImporting`); здесь только свои
 * разделы. Чистые функции, без React и без базы.
 */

import type { Entry, EntryKind, StoreRecord } from '../../app/model.ts'
import { formatDate } from '../../shared/core/dates.ts'
import type { StoreData } from '../../shared/core/db.ts'
import {
  absent,
  dayOf,
  mergeResults,
  numberOf,
  recordsOf,
  shown,
  textOf,
  type Count,
  type ImportContext,
  type ImportPlan,
  type ImportSpec,
  type Issue,
  type Note,
} from '../../shared/core/importing.ts'
import { readCurrency } from '../prefs/prefs.ts'
import { KIND_FIELDS, KIND_LABELS, KINDS, type KindField } from './entries.ts'
import { FUEL_FIELD_NAMES, FUEL_FIELDS, FUEL_HINTS, MISMATCH, solveFuel, type FuelField } from './fuel.ts'
import { formatMoney, formatNumber, round2 } from './numbers.ts'

type Plan = ImportPlan<StoreRecord>

/** Листы Excel владельца по видам. У «прочего» листа нет: такие данные бывают не из Excel. */
export const SHEETS: Record<EntryKind, string | null> = {
  fuel: 'Заправки',
  wash: 'Автомойка',
  repair: 'Ремонт',
  fine: 'Штрафы',
  other: null,
}

/** Столбцы Excel, которые идут в примечание. */
export const NOTE_COLUMNS: readonly string[] = ['Примечание', 'Коммент', 'Комментарий', 'Субъективная причина']

/** Столбцы Excel, которые не переносятся: приложение считает их само (Р-09). */
export const SKIPPED_COLUMNS: readonly string[] = ['Разница в цене', 'Разница пробегов']

/**
 * Доля бака больше 1 и не больше `TANK_PERCENT_MAX` — процент: делится на 100.
 * Больше — ни доля, ни процент: поле отбрасывается с заметкой.
 */
export const TANK_PERCENT_MAX = 100

type TankField = 'tankBefore' | 'tankAfter'

/** Поля раздела импорта: имена — как у `Entry`. */
type ImportField = 'date' | KindField | 'note'

/** Поля бака по виду — у заправки; в форме они тоже есть (`KIND_FIELDS`). */
const TANK_FIELDS: Record<EntryKind, readonly TankField[]> = {
  fuel: ['tankBefore', 'tankAfter'],
  wash: [],
  repair: [],
  fine: [],
  other: [],
}

/** Поля раздела — те же, что у вида в форме, плюс дата и примечание. */
export function sectionFields(kind: EntryKind): ImportField[] {
  return ['date', ...KIND_FIELDS[kind], 'note']
}

/** Сколько чего добавится — склонением для сводки. */
const ADDED_FORMS: Record<EntryKind, [string, string, string]> = {
  fuel: ['заправка', 'заправки', 'заправок'],
  wash: ['мойка', 'мойки', 'моек'],
  repair: ['ремонт', 'ремонта', 'ремонтов'],
  fine: ['штраф', 'штрафа', 'штрафов'],
  other: ['запись «прочее»', 'записи «прочее»', 'записей «прочее»'],
}

const quoted = (names: readonly string[]) => names.map((name) => `«${name}»`).join(', ')

// ─── Промпт ────────────────────────────────────────────────────────────────

const ABOUT: Record<EntryKind, string> = {
  fuel: 'заправки',
  wash: 'мойки',
  repair: 'ремонты и обслуживание',
  fine: 'штрафы',
  other: 'прочие траты на машину: страховка, налог, парковка',
}

function sectionAbout(kind: EntryKind): string {
  const sheet = SHEETS[kind]
  return sheet
    ? `${ABOUT[kind]} — лист «${sheet}». Одна строка листа — одна запись`
    : `${ABOUT[kind]}. Листа в таблице нет — только если такие траты есть в других моих данных`
}

/** Описание поля для промпта: имя в JSON, откуда берётся, обязательно ли. */
function fieldAbout(field: ImportField, kind: EntryKind): string {
  const fuelTrio = FUEL_FIELDS.map((each) => FUEL_FIELD_NAMES[each]).join(', ')
  switch (field) {
    case 'date':
      return 'date — дата, ГГГГ-ММ-ДД. Обязательно'
    case 'amount':
      return kind === 'fuel'
        ? `amount — «Уплачено», сколько заплатил. Из трёх чисел (${fuelTrio}) нужны любые два — третье приложение посчитает`
        : 'amount — «Уплачено», сколько заплатил, числом. Обязательно'
    case 'liters':
      return 'liters — «Объём», литры'
    case 'price':
      return 'price — «Цена», цена литра'
    case 'station':
      return 'station — «Компания», АЗС: «Лукойл», «Газпром»'
    case 'fuel':
      return `fuel — «Тип топлива» как в данных: ${FUEL_HINTS.join(', ')}. Нет — опусти: подставится топливо машины`
    case 'odometer':
      return 'odometer — «Пробег», показания одометра, км, числом'
    case 'consumption':
      return 'consumption — «Расход…», л/100 км с бортового компьютера'
    case 'tankBefore':
      return 'tankBefore — «Заполняемость полоски бака до»: доля бака от 0 до 1, как в данных (0.25 — четверть)'
    case 'tankAfter':
      return 'tankAfter — «Заполняемость полоски бака после»: доля бака от 0 до 1'
    case 'what':
      return kind === 'repair' ? 'what — «Предмет ремонта», что делали' : 'what — что это: «ОСАГО», «транспортный налог»'
    case 'service':
      return 'service — «Компания» на листе «Ремонт»: где делали'
    case 'violation':
      return 'violation — «Тип нарушения»'
    case 'paid':
      return (
        'paid — оплачен ли, true или false. Сумма в «Уплачено» — значит оплачен; ' +
        'неоплаченный штраф — false. Не знаешь — опусти: штраф считается оплаченным'
      )
    case 'paidDate':
      return 'paidDate — дата оплаты, ГГГГ-ММ-ДД. Только если она есть в данных'
    case 'note':
      return `note — ${quoted(NOTE_COLUMNS)}: одной строкой, несколько — через «; »`
  }
}

/** Примеры записей — выдуманные. */
const EXAMPLES: Record<EntryKind, readonly unknown[]> = {
  fuel: [
    {
      date: '2026-03-02',
      amount: 2583.49,
      liters: 45.5,
      price: 56.78,
      station: 'Лукойл',
      fuel: '95',
      odometer: 48210,
      consumption: 7.4,
      tankBefore: 0.25,
      tankAfter: 1,
    },
    { date: '2026-03-16', amount: 2000, price: 57.1, odometer: 48790, note: 'по акции' },
  ],
  wash: [{ date: '2026-03-05', amount: 700 }],
  repair: [{ date: '2026-04-11', amount: 6400, what: 'замена колодок', service: 'Шиномонтаж на Лесной', odometer: 49120 }],
  fine: [{ date: '2026-02-20', amount: 500, violation: 'превышение скорости', paid: true, paidDate: '2026-02-24' }],
  other: [{ date: '2026-01-15', amount: 9800, what: 'ОСАГО' }],
}

/** Разделы формата `avto-import` — для промпта ядра (`buildPrompt`). */
export const IMPORT_SPECS: readonly ImportSpec[] = KINDS.map((kind) => ({
  section: kind,
  about: sectionAbout(kind),
  fields: sectionFields(kind).map((field) => fieldAbout(field, kind)),
  example: EXAMPLES[kind],
}))

// ─── Разбор ────────────────────────────────────────────────────────────────

/** Как называется поле в отчёте. */
const FIELD_NAMES: Record<'odometer' | 'consumption' | 'paidDate' | TankField, string> = {
  odometer: 'пробег',
  consumption: 'расход',
  paidDate: 'дата оплаты',
  tankBefore: 'доля бака до',
  tankAfter: 'доля бака после',
}

/** Строка — или число, записанное ИИ без кавычек: топливо «95». */
function stringOf(value: unknown): string | null {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : textOf(value)
}

/** Число больше нуля; не написано — undefined; не то — null. */
function positiveOf(value: unknown): number | undefined | null {
  if (absent(value)) return undefined
  const number = numberOf(value)
  return number !== null && number > 0 ? number : null
}

/**
 * Доля бака: 0…1 — как есть, больше 1 и до `TANK_PERCENT_MAX` — процент,
 * «25 %» — тоже процент. Не написано — undefined; не доля и не процент — null.
 */
export function tankShare(value: unknown): number | undefined | null {
  if (absent(value)) return undefined
  const percent = typeof value === 'string' && value.includes('%')
  const number = numberOf(typeof value === 'string' ? value.replace('%', '') : value)
  if (number === null || number < 0 || number > TANK_PERCENT_MAX) return null
  return percent || number > 1 ? round2(number / 100) : number
}

/** Ключ «уже есть»: машина, вид, дата и сумма до копейки. */
function sameKey(carId: string, kind: EntryKind, date: string, amount: number): string {
  return `${carId}|${kind}|${date}|${round2(amount)}`
}

type Read = { entry: Entry; notes: Note[] } | { issue: Issue }

/**
 * Одна запись раздела. Без даты, без суммы (у заправки — без двух чисел
 * из трёх) или с испорченным обязательным числом — отказ. Испорченное
 * необязательное поле отбрасывается с заметкой, запись идёт.
 */
function readEntry(
  kind: EntryKind,
  raw: Record<string, unknown>,
  index: number,
  car: { id: string; fuel?: string | undefined },
  currency: string,
  context: ImportContext,
): Read {
  const date = dayOf(raw.date)
  const title = `${KIND_LABELS[kind]} ${index + 1}${date ? `, ${formatDate(date)}` : ''}`
  const refuse = (reason: string): Read => ({ issue: { section: kind, title, reason } })
  const notes: Note[] = []
  const note = (text: string) => notes.push({ section: kind, title, text })

  if (date === null) return refuse(absent(raw.date) ? 'нет даты' : `дата «${shown(raw.date)}» — не ГГГГ-ММ-ДД`)

  const entry: Entry = { id: context.newId(), updatedAt: context.now, carId: car.id, kind, date, amount: 0 }

  if (kind === 'fuel') {
    const numbers: Partial<Record<FuelField, number>> = {}
    for (const field of FUEL_FIELDS) {
      const value = positiveOf(raw[field])
      if (value === null) return refuse(`${FUEL_FIELD_NAMES[field]} «${shown(raw[field])}» — не число больше нуля`)
      if (value !== undefined) numbers[field] = value
    }
    const solution = solveFuel(numbers)
    if (!solution.ok) {
      return refuse(`нужны два числа из трёх — ${FUEL_FIELDS.map((field) => FUEL_FIELD_NAMES[field]).join(', ')}`)
    }
    entry.liters = solution.liters
    entry.price = solution.price
    entry.amount = solution.amount
    if (solution.expectedAmount !== null) {
      note(
        `сумма ${formatMoney(solution.amount, currency)} расходится с «литры × цена» = ` +
          `${formatMoney(solution.expectedAmount, currency)} больше чем на ${formatNumber(MISMATCH * 100)} % — ` +
          'загрузится как есть',
      )
    }
  } else {
    const amount = positiveOf(raw.amount)
    if (amount === undefined) return refuse('нет суммы')
    if (amount === null) return refuse(`сумма «${shown(raw.amount)}» — не число больше нуля`)
    entry.amount = amount
  }

  const fields = new Set<ImportField>(sectionFields(kind))

  for (const field of ['station', 'fuel', 'what', 'service', 'violation'] as const) {
    const value = fields.has(field) ? stringOf(raw[field]) : null
    if (value !== null) entry[field] = value
  }
  if (kind === 'fuel' && entry.fuel === undefined && car.fuel) entry.fuel = car.fuel

  const noteText = stringOf(raw.note)
  if (noteText !== null) entry.note = noteText

  if (fields.has('odometer') && !absent(raw.odometer)) {
    const value = numberOf(raw.odometer)
    // Пробег бывает нулевым у новой машины.
    if (value !== null && value >= 0) entry.odometer = value
    else note(`${FIELD_NAMES.odometer} «${shown(raw.odometer)}» — не число, поле не загружено`)
  }

  if (fields.has('consumption')) {
    const value = positiveOf(raw.consumption)
    if (value === null) note(`${FIELD_NAMES.consumption} «${shown(raw.consumption)}» — не число, поле не загружено`)
    else if (value !== undefined) entry.consumption = value
  }

  for (const field of TANK_FIELDS[kind]) {
    const value = tankShare(raw[field])
    if (value === null) {
      note(
        `${FIELD_NAMES[field]} «${shown(raw[field])}» — не доля 0…1 и не процент 0…${TANK_PERCENT_MAX}, поле не загружено`,
      )
    } else if (value !== undefined) entry[field] = value
  }

  if (kind === 'fine') {
    // «Уплачено» на листе «Штрафы» — оплачен; неоплаченный ИИ пишет `false`.
    entry.paid = raw.paid !== false
    if (entry.paid && !absent(raw.paidDate)) {
      const paidDate = dayOf(raw.paidDate)
      if (paidDate !== null) entry.paidDate = paidDate
      else note(`${FIELD_NAMES.paidDate} «${shown(raw.paidDate)}» — не ГГГГ-ММ-ДД, поле не загружено`)
    }
  }

  return { entry, notes }
}

/**
 * План импорта журнала: разделы файла (`readImportFile` ядра) → записи
 * машины `carId`. Кидает, если машины нет: её выбирают в блоке импорта,
 * и между выбором и разбором она могла уйти синхронизацией.
 */
export function planLogImport(
  sections: Record<string, unknown>,
  data: StoreData<StoreRecord>,
  context: ImportContext,
  carId: string,
): Plan {
  const car = data.cars.find((each) => each.id === carId && !each.deleted)
  if (!car) throw new Error('Машина для импорта не найдена — выберите её заново')
  const currency = readCurrency(data.prefs)

  const known = new Set(
    data.entries.filter((each) => !each.deleted).map((each) => sameKey(each.carId, each.kind, each.date, each.amount)),
  )

  const results: Plan[] = []
  const kinds: readonly string[] = KINDS
  for (const section of Object.keys(sections)) {
    if (!kinds.includes(section)) {
      results.push({
        writes: {},
        added: [],
        skipped: 0,
        issues: [{ section, title: `раздел «${section}»`, reason: 'такого раздела нет — пропущен' }],
      })
    }
  }

  for (const kind of KINDS) {
    if (!(kind in sections)) continue
    const { records, issues } = recordsOf(kind, sections[kind])
    const entries: Entry[] = []
    const notes: Note[] = []
    let skipped = 0

    for (const { raw, index } of records) {
      const read = readEntry(kind, raw, index, car, currency, context)
      if ('issue' in read) {
        issues.push(read.issue)
        continue
      }
      const key = sameKey(car.id, kind, read.entry.date, read.entry.amount)
      if (known.has(key)) {
        skipped += 1
        continue
      }
      known.add(key)
      entries.push(read.entry)
      notes.push(...read.notes)
    }

    const added: Count[] = entries.length > 0 ? [{ count: entries.length, forms: ADDED_FORMS[kind] }] : []
    results.push({ writes: entries.length > 0 ? { entries } : {}, added, skipped, issues, notes })
  }

  return mergeResults(results)
}
