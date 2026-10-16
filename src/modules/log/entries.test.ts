import { describe, expect, it } from 'vitest'
import type { Entry } from '../../app/model.ts'
import {
  buildEntry,
  checkDraft,
  draftOf,
  entryDetails,
  KIND_FIELDS,
  KIND_LABELS,
  KINDS,
  newDraft,
  sortEntries,
  withCar,
  withKind,
  withPaid,
  type EntryDraft,
} from './entries.ts'

const at = '2026-10-16T10:00:00.000Z'
const day = '2026-10-16'

const flat = (text: string) => text.replace(/[  ]/g, ' ')

function fuel(fields: Partial<EntryDraft> = {}): EntryDraft {
  return { ...newDraft('C1', '95', day), ...fields }
}

function entry(id: string, fields: Partial<Entry> = {}): Entry {
  return { id, updatedAt: at, carId: 'C1', kind: 'wash', date: day, amount: 500, ...fields }
}

describe('виды записей', () => {
  it('пять видов вместо четырёх листов — Р-03', () => {
    expect(KINDS).toEqual(['fuel', 'wash', 'repair', 'fine', 'other'])
    expect(KINDS.map((kind) => KIND_LABELS[kind])).toEqual(['Заправка', 'Мойка', 'Ремонт', 'Штраф', 'Прочее'])
  })

  it('поля по виду', () => {
    expect(KIND_FIELDS.fuel).toEqual(['station', 'fuel', 'liters', 'price', 'amount', 'odometer', 'consumption'])
    expect(KIND_FIELDS.wash).toEqual(['amount', 'odometer'])
    expect(KIND_FIELDS.repair).toEqual(['what', 'service', 'amount', 'odometer'])
    expect(KIND_FIELDS.fine).toEqual(['violation', 'amount', 'paid', 'paidDate'])
    expect(KIND_FIELDS.other).toEqual(['what', 'amount', 'odometer'])
  })
})

describe('новая запись', () => {
  it('машина, дата и топливо машины подставлены, вид — заправка', () => {
    expect(newDraft('C1', '95', day)).toMatchObject({ carId: 'C1', date: day, kind: 'fuel', fuel: '95', amount: '' })
  })

  it('смена вида на заправку подставляет топливо машины, вписанное не трогает', () => {
    const wash = { ...newDraft('C1', undefined, day), kind: 'wash' as const }
    expect(withKind(wash, 'fuel', 'ДТ').fuel).toBe('ДТ')
    expect(withKind({ ...wash, fuel: '98' }, 'fuel', 'ДТ').fuel).toBe('98')
  })

  it('смена машины меняет нетронутое топливо', () => {
    expect(withCar(fuel(), 'C2', '95', 'газ')).toMatchObject({ carId: 'C2', fuel: 'газ' })
    expect(withCar(fuel({ fuel: '98' }), 'C2', '95', 'газ')).toMatchObject({ carId: 'C2', fuel: '98' })
  })

  it('отметка «оплачен» ставит сегодняшнюю дату оплаты', () => {
    const fine = { ...fuel(), kind: 'fine' as const }
    expect(withPaid(fine, true, day)).toMatchObject({ paid: true, paidDate: day })
    expect(withPaid({ ...fine, paidDate: '2026-10-01' }, true, day).paidDate).toBe('2026-10-01')
  })
})

describe('проверка формы', () => {
  it('у заправки меньше двух чисел — сохранить нельзя, видно, чего не хватает', () => {
    expect(checkDraft(fuel()).errors).toEqual([
      'Нужны два числа из трёх — литры, цена литра, сумма; третье посчитается само',
    ])
    expect(checkDraft(fuel({ liters: '40' })).errors).toEqual([
      'Введите ещё цену литра или сумму — третье посчитается само',
    ])
  })

  it('у остальных видов нет суммы — сохранить нельзя', () => {
    for (const kind of ['wash', 'repair', 'fine', 'other'] as const) {
      expect(checkDraft(fuel({ kind })).errors).toEqual(['Укажите сумму'])
    }
  })

  it('не число и ноль — названы', () => {
    expect(checkDraft(fuel({ liters: 'сорок', price: '55' })).errors).toEqual(['Литры — не число'])
    expect(checkDraft(fuel({ kind: 'wash', amount: '0' })).errors).toEqual(['Сумма — больше нуля'])
  })

  it('пробег ноль — можно', () => {
    expect(checkDraft(fuel({ kind: 'wash', amount: '500', odometer: '0' })).errors).toEqual([])
  })

  it('без машины и без даты — нельзя', () => {
    expect(checkDraft(fuel({ carId: '', date: '', kind: 'wash', amount: '500' })).errors).toEqual([
      'Выберите машину',
      'Укажите дату',
    ])
  })

  it('что посчитается — видно до сохранения', () => {
    expect(checkDraft(fuel({ liters: '45,5', price: '56,78' })).computed).toEqual({ field: 'amount', value: 2583.49 })
  })

  it('три числа не сходятся — предупреждение, но сохранить можно', () => {
    const check = checkDraft(fuel({ liters: '40', price: '55', amount: '2000' }))
    expect(check.errors).toEqual([])
    expect(check.expectedAmount).toBe(2200)
  })
})

describe('запись из формы', () => {
  it('заправка двумя числами — третье посчитано и хранится', () => {
    const result = buildEntry(fuel({ liters: '45,5', price: '56.78', station: ' Лукойл ' }), undefined, 'E1', at)
    expect(result).toEqual({
      ok: true,
      entry: {
        id: 'E1',
        updatedAt: at,
        carId: 'C1',
        kind: 'fuel',
        date: day,
        amount: 2583.49,
        liters: 45.5,
        price: 56.78,
        station: 'Лукойл',
        fuel: '95',
      },
    })
  })

  it('из суммы и литров — цена, из суммы и цены — литры', () => {
    expect(buildEntry(fuel({ amount: '2200', liters: '40' }), undefined, 'E1', at)).toMatchObject({
      ok: true,
      entry: { price: 55, liters: 40, amount: 2200 },
    })
    expect(buildEntry(fuel({ amount: '2200', price: '55' }), undefined, 'E1', at)).toMatchObject({
      ok: true,
      entry: { price: 55, liters: 40, amount: 2200 },
    })
  })

  it('три несходящихся числа сохраняются как введены', () => {
    expect(buildEntry(fuel({ liters: '40', price: '55', amount: '2000' }), undefined, 'E1', at)).toMatchObject({
      ok: true,
      entry: { liters: 40, price: 55, amount: 2000 },
    })
  })

  it('с ошибкой — не сохраняется', () => {
    expect(buildEntry(fuel(), undefined, 'E1', at)).toMatchObject({ ok: false })
  })

  it('в запись уходят только поля выбранного вида', () => {
    const draft = fuel({ kind: 'wash', amount: '500', station: 'Лукойл', liters: '40', what: 'колодки', odometer: '1000' })
    expect(buildEntry(draft, undefined, 'E1', at)).toEqual({
      ok: true,
      entry: { id: 'E1', updatedAt: at, carId: 'C1', kind: 'wash', date: day, amount: 500, odometer: 1000 },
    })
  })

  it('ремонт, штраф, прочее', () => {
    expect(
      buildEntry(fuel({ kind: 'repair', amount: '3000', what: 'колодки', service: 'у дома', note: ' скрипели ' }), undefined, 'E1', at),
    ).toMatchObject({ ok: true, entry: { kind: 'repair', what: 'колодки', service: 'у дома', note: 'скрипели' } })
    const fine = buildEntry(fuel({ kind: 'fine', amount: '500', violation: 'скорость', odometer: '1000' }), undefined, 'E1', at)
    expect(fine).toEqual({
      ok: true,
      entry: { id: 'E1', updatedAt: at, carId: 'C1', kind: 'fine', date: day, amount: 500, violation: 'скорость', paid: false },
    })
    expect(
      buildEntry(fuel({ kind: 'fine', amount: '500', paid: true, paidDate: '2026-10-20' }), undefined, 'E1', at),
    ).toMatchObject({ ok: true, entry: { paid: true, paidDate: '2026-10-20' } })
    expect(buildEntry(fuel({ kind: 'other', amount: '7000', what: 'ОСАГО' }), undefined, 'E1', at)).toMatchObject({
      ok: true,
      entry: { kind: 'other', what: 'ОСАГО' },
    })
  })

  it('правка: id тот же, доля бака остаётся, очищенное стирается', () => {
    const base = entry('E1', {
      kind: 'fuel',
      liters: 40,
      price: 55,
      amount: 2200,
      station: 'Лукойл',
      note: 'полный',
      tankBefore: 0.25,
      tankAfter: 1,
    })
    const draft = { ...draftOf(base), station: '', note: '', amount: '2300' }
    expect(buildEntry(draft, base, 'другой', at)).toEqual({
      ok: true,
      entry: {
        id: 'E1',
        updatedAt: at,
        carId: 'C1',
        kind: 'fuel',
        date: day,
        liters: 40,
        price: 55,
        amount: 2300,
        tankBefore: 0.25,
        tankAfter: 1,
      },
    })
  })

  it('правка заправки в мойку стирает поля заправки', () => {
    const base = entry('E1', { kind: 'fuel', liters: 40, price: 55, amount: 2200, tankBefore: 0.25, tankAfter: 1 })
    expect(buildEntry({ ...draftOf(base), kind: 'wash' }, base, 'E1', at)).toEqual({
      ok: true,
      entry: { id: 'E1', updatedAt: at, carId: 'C1', kind: 'wash', date: day, amount: 2200 },
    })
  })

  it('черновик правки — числа с запятой', () => {
    expect(draftOf(entry('E1', { kind: 'fuel', liters: 45.5, amount: 2583.49 }))).toMatchObject({
      liters: '45,5',
      amount: '2583,49',
      price: '',
    })
  })
})

describe('журнал', () => {
  it('свежие сверху, в один день — позже внесённая выше', () => {
    const list = [
      entry('E1', { date: '2026-10-01' }),
      entry('E3', { date: '2026-09-01' }),
      entry('E2', { date: '2026-10-01' }),
    ]
    expect(sortEntries(list).map((each) => each.id)).toEqual(['E2', 'E1', 'E3'])
  })

  it('главное по виду', () => {
    expect(flat(entryDetails(entry('E1', { kind: 'fuel', liters: 45.5, price: 56.78, station: 'Лукойл' }), '₽'))).toBe(
      '45,5 л по 56,78 ₽/л · Лукойл',
    )
    expect(entryDetails(entry('E1', { kind: 'repair', what: 'колодки', service: 'у дома' }), '₽')).toBe('колодки')
    expect(entryDetails(entry('E1', { kind: 'other', what: 'ОСАГО' }), '₽')).toBe('ОСАГО')
    expect(entryDetails(entry('E1', { kind: 'fine', violation: 'скорость' }), '₽')).toBe('скорость · не оплачен')
    expect(entryDetails(entry('E1', { kind: 'fine', violation: 'скорость', paid: true }), '₽')).toBe('скорость')
    expect(entryDetails(entry('E1'), '₽')).toBe('')
  })
})
