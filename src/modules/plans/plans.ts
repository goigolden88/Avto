/**
 * Планы ремонта и ТО по машине (Р-28): форма плана, пришёл ли срок,
 * порядок списка, ориентир по пробегу рядом с последним пробегом журнала
 * и «Сделано» — запись «Ремонт» из плана.
 *
 * Срок — дата, «с… по…» или без срока. Пришёл, когда дата (у «с… по…» —
 * «с») не позже сегодня: в сам день — «пора», после даты (у «с… по…» —
 * после «по») — «просрочено». Ориентир по пробегу справочный: на срок не
 * влияет (Р-11). Напоминаний нет — о сроке говорят «Планы» и строка на
 * «Главной», когда приложение открыто.
 *
 * Чистые функции, без React и без базы.
 */

import type { Car, Entry, Plan } from '../../app/model.ts'
import { formatDateLoose, isDateStr, type DateStr } from '../../shared/core/dates.ts'
import { activeCars, MISSING_CAR } from '../log/cars.ts'
import { newDraft, withKind, type EntryDraft } from '../log/entries.ts'
import { formatNumber, numberInput, parseNumber } from '../log/numbers.ts'

// ─── Форма ─────────────────────────────────────────────────────────────────

/** Вид срока в форме: дата, «с… по…» или без срока. */
export type Term = 'date' | 'range' | 'none'

/** Порядок и подписи кнопок срока. */
export const TERMS: readonly Term[] = ['date', 'range', 'none']

export const TERM_LABELS: Record<Term, string> = {
  date: 'К дате',
  range: 'С… по…',
  none: 'Без срока',
}

/** Поля формы плана — строками, как в полях ввода. */
export type PlanDraft = {
  carId: string
  what: string
  term: Term
  /** срок или «с» */
  date: string
  /** «по» */
  until: string
  odometer: string
  note: string
}

/** Новый план: машина подставлена (Р-21), без срока — обязательно только «что сделать». */
export function newPlanDraft(carId: string): PlanDraft {
  return { carId, what: '', term: 'none', date: '', until: '', odometer: '', note: '' }
}

/** Вид срока записанного плана: «по» без «с» не бывает — такой план без срока. */
export function termOf(plan: Plan): Term {
  if (plan.date === undefined) return 'none'
  return plan.until === undefined ? 'date' : 'range'
}

export function planDraftOf(plan: Plan): PlanDraft {
  return {
    carId: plan.carId,
    what: plan.what,
    term: termOf(plan),
    date: plan.date ?? '',
    until: plan.until ?? '',
    odometer: numberInput(plan.odometer),
    note: plan.note ?? '',
  }
}

export const WHAT_MISSING = 'Впишите, что сделать'

export const UNTIL_BEFORE = '«По» раньше, чем «с»: конец срока не может быть до его начала'

export type PlanResult = { ok: true; plan: Plan } | { ok: false; errors: string[] }

/**
 * План из формы. Что сделать и машина обязательны; срок — по виду: у даты —
 * дата, у «с… по…» — оба дня, «по» не раньше «с». Ориентир по пробегу —
 * число, по желанию. У правки «сделано» и запись ремонта остаются:
 * форма их не показывает.
 */
export function buildPlan(draft: PlanDraft, base: Plan | undefined, id: string, at: string): PlanResult {
  const errors: string[] = []
  const what = draft.what.trim()
  if (!what) errors.push(WHAT_MISSING)
  if (draft.carId === '') errors.push('Выберите машину')

  if (draft.term === 'date' && !isDateStr(draft.date)) errors.push('Укажите дату срока')
  if (draft.term === 'range') {
    if (!isDateStr(draft.date)) errors.push('Укажите, с какого дня')
    if (!isDateStr(draft.until)) errors.push('Укажите, по какой день')
    if (isDateStr(draft.date) && isDateStr(draft.until) && draft.until < draft.date) errors.push(UNTIL_BEFORE)
  }

  // Знака минус разбор числа не принимает: «-5» — тоже «не число».
  const odometer = parseNumber(draft.odometer)
  if (odometer !== undefined && Number.isNaN(odometer)) errors.push('Ориентир по пробегу — не число')

  if (errors.length > 0) return { ok: false, errors }

  const { date: _date, until: _until, odometer: _odometer, note: _note, ...rest } = base ?? { id, updatedAt: at }
  const plan: Plan = { ...rest, id: base?.id ?? id, updatedAt: at, carId: draft.carId, what }
  if (draft.term !== 'none') plan.date = draft.date
  if (draft.term === 'range') plan.until = draft.until
  if (odometer !== undefined) plan.odometer = odometer
  const note = draft.note.trim()
  if (note) plan.note = note
  return { ok: true, plan }
}

// ─── Срок ──────────────────────────────────────────────────────────────────

/**
 * Где план в списке: `overdue` и `due` — срок пришёл; `later` — срок
 * впереди; `none` — без срока; `done` — сделан.
 */
export type PlanState = 'overdue' | 'due' | 'later' | 'none' | 'done'

/** Пометка у плана, срок которого пришёл. */
export const STATE_LABELS: Partial<Record<PlanState, string>> = {
  due: 'пора',
  overdue: 'просрочено',
}

/**
 * Состояние плана в день `day`. Испорченная дата (приехала синхронизацией)
 * срока не даёт — план без срока; испорченное «по» — срок одной датой.
 */
export function planState(plan: Plan, day: DateStr): PlanState {
  if (plan.doneDate !== undefined) return 'done'
  if (plan.date === undefined || !isDateStr(plan.date)) return 'none'
  if (plan.date > day) return 'later'
  const end = plan.until !== undefined && isDateStr(plan.until) ? plan.until : plan.date
  return end < day ? 'overdue' : 'due'
}

/** Пришёл ли срок несделанного плана: дата, у «с… по…» — «с», не позже `day`. */
export function isDue(plan: Plan, day: DateStr): boolean {
  const state = planState(plan, day)
  return state === 'due' || state === 'overdue'
}

/** Сколько живых несделанных планов, у которых пришёл срок, — для строки на «Главной». */
export function dueCount(plans: readonly Plan[], day: DateStr): number {
  return plans.filter((plan) => !plan.deleted && isDue(plan, day)).length
}

/** Строка на «Главной»: «Планы: пора — 2». */
export function dueLineText(count: number): string {
  return `Планы: ${STATE_LABELS.due} — ${count}`
}

const byId = (a: Plan, b: Plan) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

const byDate = (a: Plan, b: Plan) => {
  const left = a.date ?? ''
  const right = b.date ?? ''
  return left !== right ? (left < right ? -1 : 1) : byId(a, b)
}

/** Список «Планов»: несделанные по порядку показа и сделанные отдельно. */
export type PlanList = { open: Plan[]; done: Plan[] }

/**
 * Порядок списка. Сверху — срок пришёл: просроченные, за ними «пора», по дате;
 * дальше — со сроком впереди, от ближайшего; внизу — без срока, в порядке
 * заведения. Сделанные — свежие сверху.
 */
export function listPlans(plans: readonly Plan[], day: DateStr): PlanList {
  const live = plans.filter((plan) => !plan.deleted)
  const of = (state: PlanState) => live.filter((plan) => planState(plan, day) === state)
  const done = of('done').sort((a, b) => {
    const left = a.doneDate ?? ''
    const right = b.doneDate ?? ''
    return left !== right ? (left < right ? 1 : -1) : byId(b, a)
  })
  return {
    open: [...of('overdue').sort(byDate), ...of('due').sort(byDate), ...of('later').sort(byDate), ...of('none').sort(byId)],
    done,
  }
}

/** Срок словами: «срок 12.10.2026», «с 01.10.2026 по 31.10.2026», «без срока». */
export function termText(plan: Plan): string {
  if (plan.date === undefined) return 'без срока'
  if (plan.until === undefined) return `срок ${formatDateLoose(plan.date)}`
  return `с ${formatDateLoose(plan.date)} по ${formatDateLoose(plan.until)}`
}

/** «сделано 12.10.2026» — в блоке «Сделано». */
export function doneText(plan: Plan): string {
  return plan.doneDate === undefined ? '' : `сделано ${formatDateLoose(plan.doneDate)}`
}

// ─── Машина и пробег ───────────────────────────────────────────────────────

/** Имя машины у плана: в архиве — с пометкой; не найдена — «машина не найдена». */
export function carLabel(carId: string, cars: readonly Car[]): string {
  const car = cars.find((each) => each.id === carId && !each.deleted)
  if (!car) return MISSING_CAR
  return car.archived ? `${car.name} · в архиве` : car.name
}

/**
 * Машины для выбора в форме плана: активные. Машина плана, ушедшая в архив
 * или ещё не приехавшая, остаётся в выборе — иначе правка молча пересадила
 * бы план; новому плану архивную не выбрать.
 */
export function planCarOptions(cars: readonly Car[], carId: string): { id: string; name: string }[] {
  const options = activeCars(cars).map((car) => ({ id: car.id, name: car.name }))
  if (carId !== '' && !options.some((option) => option.id === carId)) {
    const car = cars.find((each) => each.id === carId && !each.deleted)
    options.push({ id: carId, name: car ? `${car.name} — в архиве` : MISSING_CAR })
  }
  return options
}

/** Последний известный пробег машины: показание и день записи. */
export type Reading = { odometer: number; date: DateStr }

/**
 * Последний пробег машины по журналу: живая запись этой машины с одометром,
 * самая поздняя по дате, в один день — позже внесённая (id — ULID). Записи
 * с испорченной датой не берутся: у показания должен быть день. Нет — null.
 */
export function lastReading(carId: string, entries: readonly Entry[]): Reading | null {
  let last: Entry | undefined
  for (const entry of entries) {
    if (entry.deleted || entry.carId !== carId) continue
    if (typeof entry.odometer !== 'number' || !Number.isFinite(entry.odometer) || !isDateStr(entry.date)) continue
    if (!last || entry.date > last.date || (entry.date === last.date && entry.id > last.id)) last = entry
  }
  return last && last.odometer !== undefined ? { odometer: last.odometer, date: last.date } : null
}

/** День показания коротко: в год `day` — «12.10», в другой — «12.10.2025». */
function readingDay(date: DateStr, day: DateStr): string {
  const full = formatDateLoose(date)
  return date.slice(0, 4) === day.slice(0, 4) ? full.slice(0, 5) : full
}

/**
 * Ориентир по пробегу словами: «к 120 000 км · сейчас 112 340 км (12.10)».
 * Пробега в журнале нет — только «к 120 000 км». Ориентира нет — пусто.
 */
export function odometerText(plan: Plan, reading: Reading | null, day: DateStr): string {
  if (plan.odometer === undefined) return ''
  const target = `к ${formatNumber(plan.odometer, 0)} км`
  if (!reading) return target
  return `${target} · сейчас ${formatNumber(reading.odometer, 0)} км (${readingDay(reading.date, day)})`
}

// ─── «Сделано» ─────────────────────────────────────────────────────────────

/**
 * Черновик записи «Ремонт» из плана: машина плана, дата — `day`, «что
 * делали» — текст плана, примечание — заметка плана. Остаётся сумма.
 */
export function doneDraft(plan: Plan, carFuel: string | undefined, day: DateStr): EntryDraft {
  const draft = withKind(newDraft(plan.carId, carFuel, day), 'repair', carFuel)
  return { ...draft, what: plan.what, note: plan.note ?? '' }
}

/** План, сделанный записью `entry`: день — дата записи, ссылка — её id. */
export function markDone(plan: Plan, entry: Entry, at: string): Plan {
  return { ...plan, updatedAt: at, doneDate: entry.date, entryId: entry.id }
}

/** Подсказка пустых «Планов»: что сюда писать. */
export const EMPTY_HINT =
  'Сюда — что по машине предстоит: ремонт, ТО, совет мастера, «сделать в ближайшее время». ' +
  'Срок — дата, «с… по…» или без срока; когда он придёт, «Главная» скажет об этом строкой. ' +
  'Сделали — «Сделано», и план станет записью «Ремонт» в журнале.'
