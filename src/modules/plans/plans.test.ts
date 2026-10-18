import { describe, expect, it } from 'vitest'
import type { Car, Entry, Plan } from '../../app/model.ts'
import { buildEntry } from '../log/entries.ts'
import {
  buildPlan,
  carLabel,
  doneDraft,
  dueCount,
  dueLineText,
  isDue,
  lastReading,
  listPlans,
  markDone,
  newPlanDraft,
  odometerText,
  planCarOptions,
  planDraftOf,
  planState,
  termText,
  UNTIL_BEFORE,
  WHAT_MISSING,
  type PlanDraft,
} from './plans.ts'

const at = '2026-10-18T10:00:00.000Z'
const day = '2026-10-18'

/** Неразрывные пробелы разрядов — обычными: так проще сравнивать. */
const plain = (text: string) => text.replace(/[  ]/g, ' ')

function plan(id: string, fields: Partial<Plan> = {}): Plan {
  return { id, updatedAt: at, carId: 'car-1', what: 'заменить колодки', ...fields }
}

function draft(fields: Partial<PlanDraft> = {}): PlanDraft {
  return { ...newPlanDraft('car-1'), what: 'ТО-4', ...fields }
}

function entry(id: string, fields: Partial<Entry> = {}): Entry {
  return { id, updatedAt: at, carId: 'car-1', kind: 'wash', date: '2026-10-01', amount: 500, ...fields }
}

describe('форма плана', () => {
  it('новый — без срока: обязательно только «что сделать»', () => {
    const result = buildPlan(draft(), undefined, 'p-1', at)
    expect(result).toEqual({ ok: true, plan: { id: 'p-1', updatedAt: at, carId: 'car-1', what: 'ТО-4' } })
  })

  it('без «что сделать» и машины не сохранить', () => {
    const result = buildPlan(draft({ what: '  ', carId: '' }), undefined, 'p-1', at)
    expect(result).toEqual({ ok: false, errors: [WHAT_MISSING, 'Выберите машину'] })
  })

  it('к дате — дата обязательна', () => {
    expect(buildPlan(draft({ term: 'date' }), undefined, 'p-1', at)).toEqual({ ok: false, errors: ['Укажите дату срока'] })
    const result = buildPlan(draft({ term: 'date', date: '2026-11-01', until: '2026-12-01' }), undefined, 'p-1', at)
    expect(result.ok && result.plan).toMatchObject({ date: '2026-11-01' })
    expect(result.ok && result.plan.until).toBeUndefined()
  })

  it('«с… по…»: оба дня, «по» раньше «с» — понятная фраза, не сохраняется', () => {
    expect(buildPlan(draft({ term: 'range', date: '2026-11-01' }), undefined, 'p-1', at)).toEqual({
      ok: false,
      errors: ['Укажите, по какой день'],
    })
    expect(buildPlan(draft({ term: 'range', date: '2026-11-10', until: '2026-11-01' }), undefined, 'p-1', at)).toEqual({
      ok: false,
      errors: [UNTIL_BEFORE],
    })
    const same = buildPlan(draft({ term: 'range', date: '2026-11-01', until: '2026-11-01' }), undefined, 'p-1', at)
    expect(same.ok && same.plan).toMatchObject({ date: '2026-11-01', until: '2026-11-01' })
  })

  it('без срока — даты из полей не уходят в план', () => {
    const result = buildPlan(draft({ term: 'none', date: '2026-11-01', until: '2026-12-01' }), undefined, 'p-1', at)
    expect(result.ok && result.plan.date).toBeUndefined()
    expect(result.ok && result.plan.until).toBeUndefined()
  })

  it('ориентир по пробегу — число с пробелами и запятой; текст и минус — нет', () => {
    const result = buildPlan(draft({ odometer: '120 000' }), undefined, 'p-1', at)
    expect(result.ok && result.plan.odometer).toBe(120_000)
    expect(buildPlan(draft({ odometer: 'скоро' }), undefined, 'p-1', at)).toEqual({ ok: false, errors: ['Ориентир по пробегу — не число'] })
    expect(buildPlan(draft({ odometer: '-5' }), undefined, 'p-1', at).ok).toBe(false)
  })

  it('правка: id и «сделано» прежние, стёртое поле уходит', () => {
    const base = plan('p-1', { date: '2026-11-01', until: '2026-11-30', odometer: 90_000, note: 'совет мастера', doneDate: '2026-10-10', entryId: 'e-1' })
    const edited = planDraftOf(base)
    expect(edited).toMatchObject({ term: 'range', date: '2026-11-01', until: '2026-11-30', odometer: '90000', note: 'совет мастера' })
    const result = buildPlan({ ...edited, term: 'date', odometer: '', note: '' }, base, 'p-2', '2026-10-19T00:00:00.000Z')
    expect(result).toEqual({
      ok: true,
      plan: { id: 'p-1', updatedAt: '2026-10-19T00:00:00.000Z', carId: 'car-1', what: 'заменить колодки', date: '2026-11-01', doneDate: '2026-10-10', entryId: 'e-1' },
    })
  })
})

describe('пришёл ли срок', () => {
  it('дата: раньше — «позже», в день — «пора», после — «просрочено»', () => {
    expect(planState(plan('p', { date: '2026-10-19' }), day)).toBe('later')
    expect(planState(plan('p', { date: day }), day)).toBe('due')
    expect(planState(plan('p', { date: '2026-10-17' }), day)).toBe('overdue')
  })

  it('«с… по…»: «пора» с первого дня и по последний, «просрочено» после «по»', () => {
    const range = { date: '2026-10-10', until: '2026-10-25' }
    expect(planState(plan('p', range), '2026-10-09')).toBe('later')
    expect(planState(plan('p', range), '2026-10-10')).toBe('due')
    expect(planState(plan('p', range), '2026-10-25')).toBe('due')
    expect(planState(plan('p', range), '2026-10-26')).toBe('overdue')
  })

  it('без срока, сделанный, испорченная дата — срок не приходит', () => {
    expect(planState(plan('p'), day)).toBe('none')
    expect(planState(plan('p', { date: '2026-10-01', doneDate: '2026-10-02' }), day)).toBe('done')
    expect(planState(plan('p', { date: 'вчера' }), day)).toBe('none')
    expect(isDue(plan('p'), day)).toBe(false)
  })

  it('ориентир по пробегу на срок не влияет', () => {
    expect(planState(plan('p', { odometer: 1 }), day)).toBe('none')
    expect(planState(plan('p', { date: '2026-12-01', odometer: 1 }), day)).toBe('later')
  })

  it('для «Главной»: только живые несделанные с пришедшим сроком', () => {
    const plans = [
      plan('a', { date: '2026-10-01' }),
      plan('b', { date: '2026-10-10', until: '2026-10-30' }),
      plan('c', { date: '2026-10-19' }),
      plan('d'),
      plan('e', { date: '2026-10-01', doneDate: '2026-10-02' }),
      plan('f', { date: '2026-10-01', deleted: true }),
    ]
    expect(dueCount(plans, day)).toBe(2)
    expect(dueCount([], day)).toBe(0)
    expect(dueLineText(2)).toBe('Планы: пора — 2')
  })
})

describe('порядок списка', () => {
  it('сверху пришедшие (просроченные, затем «пора»), дальше по сроку от ближайшего, внизу без срока', () => {
    const plans = [
      plan('01-none-b'),
      plan('02-later-far', { date: '2026-12-01' }),
      plan('03-due-range', { date: '2026-10-01', until: '2026-10-31' }),
      plan('04-overdue', { date: '2026-10-12' }),
      plan('05-later-near', { date: '2026-10-20' }),
      plan('00-none-a'),
      plan('06-due-today', { date: day }),
      plan('07-done-old', { doneDate: '2026-09-01' }),
      plan('08-done-new', { doneDate: '2026-10-15' }),
      plan('09-deleted', { deleted: true }),
    ]
    const list = listPlans(plans, day)
    expect(list.open.map((each) => each.id)).toEqual([
      '04-overdue',
      '03-due-range',
      '06-due-today',
      '05-later-near',
      '02-later-far',
      '00-none-a',
      '01-none-b',
    ])
    expect(list.done.map((each) => each.id)).toEqual(['08-done-new', '07-done-old'])
  })

  it('срок словами', () => {
    expect(termText(plan('p'))).toBe('без срока')
    expect(termText(plan('p', { date: '2026-11-01' }))).toBe('срок 01.11.2026')
    expect(termText(plan('p', { date: '2026-11-01', until: '2026-11-30' }))).toBe('с 01.11.2026 по 30.11.2026')
  })
})

describe('машина плана', () => {
  const cars: Car[] = [
    { id: 'car-1', updatedAt: at, name: 'Солярис' },
    { id: 'car-2', updatedAt: at, name: 'Нива', archived: true },
    { id: 'car-3', updatedAt: at, name: 'Старая', deleted: true },
  ]

  it('имя видно; в архиве — с пометкой; нет машины — «машина не найдена»', () => {
    expect(carLabel('car-1', cars)).toBe('Солярис')
    expect(carLabel('car-2', cars)).toBe('Нива · в архиве')
    expect(carLabel('car-3', cars)).toBe('машина не найдена')
  })

  it('новому плану архивную не выбрать; у плана архивной она остаётся в выборе', () => {
    expect(planCarOptions(cars, 'car-1').map((each) => each.name)).toEqual(['Солярис'])
    expect(planCarOptions(cars, 'car-2').map((each) => each.name)).toEqual(['Солярис', 'Нива — в архиве'])
  })
})

describe('ориентир по пробегу', () => {
  const entries = [
    entry('01J0000000000000000000000A', { date: '2026-10-12', odometer: 112_340 }),
    entry('01J0000000000000000000000B', { date: '2026-10-12', odometer: 112_300 }),
    entry('01J0000000000000000000000C', { date: '2026-10-14' }),
    entry('01J0000000000000000000000D', { date: '2026-10-15', odometer: 120_000, deleted: true }),
    entry('01J0000000000000000000000E', { date: '2026-10-16', odometer: 999, carId: 'car-2' }),
    entry('01J0000000000000000000000F', { date: 'вчера', odometer: 130_000 }),
    entry('01J00000000000000000000000', { date: '2026-09-01', odometer: 110_000 }),
  ]

  it('последний пробег машины — по дате, в один день — позже внесённая; без одометра, удалённые и чужие — мимо', () => {
    expect(lastReading('car-1', entries)).toEqual({ odometer: 112_300, date: '2026-10-12' })
    expect(lastReading('car-9', entries)).toBeNull()
  })

  it('рядом с ориентиром — последний пробег из журнала; нет его — только ориентир', () => {
    const target = plan('p', { odometer: 120_000 })
    expect(plain(odometerText(target, { odometer: 112_340, date: '2026-10-12' }, day))).toBe('к 120 000 км · сейчас 112 340 км (12.10)')
    expect(plain(odometerText(target, { odometer: 112_340, date: '2025-12-30' }, day))).toBe('к 120 000 км · сейчас 112 340 км (30.12.2025)')
    expect(plain(odometerText(target, null, day))).toBe('к 120 000 км')
    expect(odometerText(plan('p'), { odometer: 1, date: day }, day)).toBe('')
  })
})

describe('«Сделано»', () => {
  const source = plan('p-1', { carId: 'car-2', what: 'заменить ремень ГРМ', note: 'совет мастера', date: '2026-10-01' })

  it('черновик записи: «Ремонт», машина плана, сегодня, «что делали» и примечание из плана', () => {
    expect(doneDraft(source, '95', day)).toMatchObject({
      kind: 'repair',
      carId: 'car-2',
      date: day,
      what: 'заменить ремень ГРМ',
      note: 'совет мастера',
      amount: '',
    })
  })

  it('с суммой черновик сохраняется ремонтом, без неё — нет', () => {
    const empty = buildEntry(doneDraft(source, '95', day), undefined, 'e-1', at)
    expect(empty).toEqual({ ok: false, errors: ['Укажите сумму'] })
    const saved = buildEntry({ ...doneDraft(source, '95', day), amount: '7000' }, undefined, 'e-1', at)
    expect(saved.ok && saved.entry).toEqual({
      id: 'e-1',
      updatedAt: at,
      carId: 'car-2',
      kind: 'repair',
      date: day,
      amount: 7000,
      what: 'заменить ремень ГРМ',
      note: 'совет мастера',
    })
  })

  it('сохранена запись — у плана дата записи и ссылка на неё; план уходит в «Сделано»', () => {
    const repair = entry('e-1', { kind: 'repair', date: '2026-10-17' })
    const done = markDone(source, repair, '2026-10-18T12:00:00.000Z')
    expect(done).toEqual({ ...source, updatedAt: '2026-10-18T12:00:00.000Z', doneDate: '2026-10-17', entryId: 'e-1' })
    expect(listPlans([done], day)).toEqual({ open: [], done: [done] })
    expect(dueCount([done], day)).toBe(0)
  })
})
