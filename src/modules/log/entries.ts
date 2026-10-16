/**
 * Журнал (Р-03): виды записей, форма записи и что из неё сохраняется.
 *
 * Форма держит черновик строками — как в полях ввода; в запись он
 * превращается только при сохранении, вместе с проверкой и правилом двух
 * чисел из трёх у заправки (Р-06). Правка идёт поверх прежней записи: поля,
 * которых в форме нет (`tankBefore`, `tankAfter` — полоска бака придёт
 * отдельной задачей), остаются как были.
 *
 * Чистые функции, без React и без базы.
 */

import type { Entry, EntryKind } from '../../app/model.ts'
import { isDateStr } from '../../shared/core/dates.ts'
import { fuelMissingText, solveFuel, type FuelField } from './fuel.ts'
import { formatMoney, formatNumber, numberInput, parseNumber } from './numbers.ts'

/** Порядок видов — в выборе вида и в отборе. */
export const KINDS: readonly EntryKind[] = ['fuel', 'wash', 'repair', 'fine', 'other']

export const KIND_LABELS: Record<EntryKind, string> = {
  fuel: 'Заправка',
  wash: 'Мойка',
  repair: 'Ремонт',
  fine: 'Штраф',
  other: 'Прочее',
}

/** Поля формы, которые зависят от вида. Дата, машина и примечание — у всех. */
export type KindField =
  | 'station'
  | 'fuel'
  | 'liters'
  | 'price'
  | 'amount'
  | 'odometer'
  | 'consumption'
  | 'what'
  | 'service'
  | 'violation'
  | 'paid'
  | 'paidDate'

/** Какие поля у какого вида — в этом порядке они стоят в форме. */
export const KIND_FIELDS: Record<EntryKind, readonly KindField[]> = {
  fuel: ['station', 'fuel', 'liters', 'price', 'amount', 'odometer', 'consumption'],
  wash: ['amount', 'odometer'],
  repair: ['what', 'service', 'amount', 'odometer'],
  fine: ['violation', 'amount', 'paid', 'paidDate'],
  other: ['what', 'amount', 'odometer'],
}

/**
 * Поля записи, которые есть только у части видов. При смене вида чужие
 * стираются: у мойки не остаётся АЗС от заправки, которой она была.
 * Доля бака — заправки, хотя в форме её нет.
 */
type KindOnly =
  | 'station'
  | 'fuel'
  | 'liters'
  | 'price'
  | 'odometer'
  | 'consumption'
  | 'tankBefore'
  | 'tankAfter'
  | 'what'
  | 'service'
  | 'violation'
  | 'paid'
  | 'paidDate'

const KIND_ONLY: readonly KindOnly[] = [
  'station',
  'fuel',
  'liters',
  'price',
  'odometer',
  'consumption',
  'tankBefore',
  'tankAfter',
  'what',
  'service',
  'violation',
  'paid',
  'paidDate',
]

/** Поля, которые форма не показывает, но которые принадлежат виду. */
const HIDDEN_FIELDS: Record<EntryKind, readonly KindOnly[]> = {
  fuel: ['tankBefore', 'tankAfter'],
  wash: [],
  repair: [],
  fine: [],
  other: [],
}

/** Подписи полей. «Что» у ремонта и у прочего звучит по-разному. */
export function fieldLabel(field: KindField, kind: EntryKind): string {
  switch (field) {
    case 'station':
      return 'АЗС'
    case 'fuel':
      return 'Топливо'
    case 'liters':
      return 'Литры'
    case 'price':
      return 'Цена литра'
    case 'amount':
      return 'Сумма'
    case 'odometer':
      return 'Пробег, км'
    case 'consumption':
      return 'Расход по компьютеру, л/100 км'
    case 'what':
      return kind === 'repair' ? 'Что делали' : 'Что'
    case 'service':
      return 'Где'
    case 'violation':
      return 'Нарушение'
    case 'paid':
      return 'Оплачен'
    case 'paidDate':
      return 'Когда оплачен'
  }
}

/** Числовые поля формы — для разбора и сообщений «не число». */
const NUMBER_FIELDS = ['liters', 'price', 'amount', 'odometer', 'consumption'] as const

type NumberField = (typeof NUMBER_FIELDS)[number]

/** Черновик формы. Строки — как в полях; флажок «оплачен» — как флажок. */
export type EntryDraft = {
  carId: string
  kind: EntryKind
  date: string
  note: string
  station: string
  fuel: string
  liters: string
  price: string
  amount: string
  odometer: string
  consumption: string
  what: string
  service: string
  violation: string
  paid: boolean
  paidDate: string
}

/**
 * Черновик новой записи: машина, дата и топливо подставлены, вид —
 * заправка. Остаётся сумма — или два числа из трёх.
 */
export function newDraft(carId: string, carFuel: string | undefined, date: string): EntryDraft {
  return {
    carId,
    kind: 'fuel',
    date,
    note: '',
    station: '',
    fuel: carFuel ?? '',
    liters: '',
    price: '',
    amount: '',
    odometer: '',
    consumption: '',
    what: '',
    service: '',
    violation: '',
    paid: false,
    paidDate: '',
  }
}

/** Черновик правки: запись как есть, числа — с запятой. */
export function draftOf(entry: Entry): EntryDraft {
  return {
    carId: entry.carId,
    kind: entry.kind,
    date: entry.date,
    note: entry.note ?? '',
    station: entry.station ?? '',
    fuel: entry.fuel ?? '',
    liters: numberInput(entry.liters),
    price: numberInput(entry.price),
    amount: numberInput(entry.amount),
    odometer: numberInput(entry.odometer),
    consumption: numberInput(entry.consumption),
    what: entry.what ?? '',
    service: entry.service ?? '',
    violation: entry.violation ?? '',
    paid: entry.paid === true,
    paidDate: entry.paidDate ?? '',
  }
}

/**
 * Смена вида. Поля других видов в черновике остаются — вернёшь вид, они
 * на месте; в запись уйдут только поля выбранного. Топливо у заправки
 * пустое — подставляется топливо машины.
 */
export function withKind(draft: EntryDraft, kind: EntryKind, carFuel: string | undefined): EntryDraft {
  const fuel = kind === 'fuel' && draft.fuel.trim() === '' ? (carFuel ?? '') : draft.fuel
  return { ...draft, kind, fuel }
}

/**
 * Смена машины. Топливо, подставленное от прежней машины и не тронутое, —
 * на топливо новой; вписанное руками остаётся.
 */
export function withCar(
  draft: EntryDraft,
  carId: string,
  oldFuel: string | undefined,
  newFuel: string | undefined,
): EntryDraft {
  const untouched = draft.fuel.trim() === (oldFuel ?? '').trim()
  return { ...draft, carId, fuel: untouched && draft.kind === 'fuel' ? (newFuel ?? '') : draft.fuel }
}

/** Флажок «оплачен»: при отметке дата оплаты — сегодня, если пуста. */
export function withPaid(draft: EntryDraft, paid: boolean, today: string): EntryDraft {
  return { ...draft, paid, paidDate: paid && draft.paidDate === '' ? today : draft.paidDate }
}

/** Что видно под формой, пока её заполняют. */
export type DraftCheck = {
  /** Почему сохранить нельзя. Пусто — можно. */
  errors: string[]
  /** У заправки: какое число посчитается и каким будет. */
  computed: { field: FuelField; value: number } | null
  /** У заправки: введены все три и не сходятся — какой была бы сумма. */
  expectedAmount: number | null
}

type Parsed = { numbers: Partial<Record<NumberField, number>>; errors: string[] }

/** Числа полей вида. Не число, ноль там, где его не бывает, — ошибки. */
function parseNumbers(draft: EntryDraft): Parsed {
  const fields = KIND_FIELDS[draft.kind]
  const numbers: Partial<Record<NumberField, number>> = {}
  const errors: string[] = []
  for (const field of NUMBER_FIELDS) {
    if (!fields.includes(field)) continue
    const value = parseNumber(draft[field])
    if (value === undefined) continue
    const label = fieldLabel(field, draft.kind)
    if (Number.isNaN(value)) errors.push(`${label} — не число`)
    // Пробег бывает нулевым у новой машины; литров, цены и суммы — нет.
    else if (field !== 'odometer' && value <= 0) errors.push(`${label} — больше нуля`)
    else numbers[field] = value
  }
  return { numbers, errors }
}

/** Проверка черновика: можно ли сохранить и что посчитается. */
export function checkDraft(draft: EntryDraft): DraftCheck {
  const { numbers, errors } = parseNumbers(draft)
  const badNumbers = errors.length > 0
  if (draft.carId === '') errors.push('Выберите машину')
  if (!isDateStr(draft.date)) errors.push('Укажите дату')

  let computed: DraftCheck['computed'] = null
  let expectedAmount: number | null = null

  if (draft.kind === 'fuel') {
    const solution = solveFuel(numbers)
    if (!solution.ok) {
      // Число с ошибкой уже названо выше — «введите ещё» про него было бы враньём.
      if (!badNumbers) errors.push(fuelMissingText(solution.missing))
    } else {
      if (solution.computed) computed = { field: solution.computed, value: solution[solution.computed] }
      expectedAmount = solution.expectedAmount
    }
  } else if (numbers.amount === undefined && parseNumber(draft.amount) === undefined) {
    errors.push('Укажите сумму')
  }

  if (draft.kind === 'fine' && draft.paid && draft.paidDate !== '' && !isDateStr(draft.paidDate)) {
    errors.push('Дата оплаты — не дата')
  }

  return { errors, computed, expectedAmount }
}

export type EntryResult = { ok: true; entry: Entry } | { ok: false; errors: string[] }

/**
 * Запись из черновика. `base` — прежняя запись при правке: её `id` и поля,
 * которых нет в форме, сохраняются; поля чужих видов стираются. У заправки
 * третье число считается здесь и хранится (Р-06).
 */
export function buildEntry(draft: EntryDraft, base: Entry | undefined, id: string, at: string): EntryResult {
  const check = checkDraft(draft)
  if (check.errors.length > 0) return { ok: false, errors: check.errors }

  const { numbers } = parseNumbers(draft)
  const kind = draft.kind
  const keep = new Set<string>([...KIND_FIELDS[kind], ...HIDDEN_FIELDS[kind]])

  const entry: Entry = {
    ...base,
    id: base?.id ?? id,
    updatedAt: at,
    carId: draft.carId,
    kind,
    date: draft.date,
    amount: numbers.amount ?? 0,
  }
  for (const field of KIND_ONLY) if (!keep.has(field)) delete entry[field]
  delete entry.note

  const note = draft.note.trim()
  if (note) entry.note = note

  // Пустое поле стирает прежнее значение: человек его очистил.
  const text = (field: 'station' | 'fuel' | 'what' | 'service' | 'violation') => {
    delete entry[field]
    const value = draft[field].trim()
    if (keep.has(field) && value) entry[field] = value
  }
  const number = (field: 'odometer' | 'consumption') => {
    delete entry[field]
    const value = numbers[field]
    if (keep.has(field) && value !== undefined) entry[field] = value
  }

  text('station')
  text('fuel')
  text('what')
  text('service')
  text('violation')
  number('odometer')
  number('consumption')

  if (kind === 'fuel') {
    const solution = solveFuel(numbers)
    // Проверка выше это уже гарантировала; ветка — для компилятора.
    if (!solution.ok) return { ok: false, errors: [fuelMissingText(solution.missing)] }
    entry.liters = solution.liters
    entry.price = solution.price
    entry.amount = solution.amount
  }

  if (kind === 'fine') {
    entry.paid = draft.paid
    delete entry.paidDate
    if (draft.paid && draft.paidDate !== '') entry.paidDate = draft.paidDate
  }

  return { ok: true, entry }
}

/** Свежие сверху: по дате, в один день — позже внесённая выше (id — ULID). */
export function sortEntries(entries: readonly Entry[]): Entry[] {
  return [...entries].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
  })
}

/**
 * Главное по виду — строкой под суммой в журнале: литры, цена и АЗС
 * у заправки, «что» у ремонта и прочего, нарушение и «не оплачен»
 * у штрафа. У мойки — ничего.
 */
export function entryDetails(entry: Entry, currency: string): string {
  const parts: string[] = []
  switch (entry.kind) {
    case 'fuel':
      if (entry.liters !== undefined) {
        const price = entry.price !== undefined ? ` по ${formatMoney(entry.price, currency)}/л` : ''
        parts.push(`${formatNumber(entry.liters)} л${price}`)
      }
      if (entry.station) parts.push(entry.station)
      break
    case 'repair':
    case 'other':
      if (entry.what) parts.push(entry.what)
      break
    case 'fine':
      if (entry.violation) parts.push(entry.violation)
      if (!entry.paid) parts.push('не оплачен')
      break
    case 'wash':
      break
  }
  return parts.join(' · ')
}
