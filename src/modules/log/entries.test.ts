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
  TANK_LESS,
  TANK_MARKS,
  tankGauge,
  tankInput,
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
    expect(KIND_FIELDS.fuel).toEqual([
      'station',
      'fuel',
      'liters',
      'price',
      'amount',
      'odometer',
      'consumption',
      'tankBefore',
      'tankAfter',
    ])
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

describe('бак — Р-25', () => {
  const fill = (fields: Partial<EntryDraft>) => fuel({ liters: '40', price: '55', ...fields })
  const saved = (draft: EntryDraft, base?: Entry) => {
    const result = buildEntry(draft, base, 'E1', at)
    if (!result.ok) throw new Error(result.errors.join('; '))
    return result.entry
  }

  it('быстрые кнопки — ¼, ½, ¾, полный: 25, 50, 75, 100', () => {
    expect(TANK_MARKS).toEqual([
      { label: '¼', percent: 25 },
      { label: '½', percent: 50 },
      { label: '¾', percent: 75 },
      { label: 'полный', percent: 100 },
    ])
  })

  it('в форме — проценты, в записи — доля; 0 — пустой бак, дробные — можно', () => {
    expect(saved(fill({ tankBefore: '25', tankAfter: '100' }))).toMatchObject({ tankBefore: 0.25, tankAfter: 1 })
    expect(saved(fill({ tankBefore: '0', tankAfter: '37,5' }))).toMatchObject({ tankBefore: 0, tankAfter: 0.375 })
  })

  it('по желанию: без бака — как раньше; одно из двух — можно', () => {
    const plain = saved(fill({}))
    expect('tankBefore' in plain || 'tankAfter' in plain).toBe(false)
    const after = saved(fill({ tankAfter: '100' }))
    expect(after.tankAfter).toBe(1)
    expect('tankBefore' in after).toBe(false)
  })

  it('не число, с минусом, больше 100 — названо, не сохраняется', () => {
    expect(checkDraft(fill({ tankBefore: 'полбака' })).errors).toEqual(['Бак до — не число'])
    expect(checkDraft(fill({ tankBefore: '-5' })).errors).toEqual(['Бак до — не число'])
    expect(checkDraft(fill({ tankAfter: '120' })).errors).toEqual(['Бак после — от 0 до 100 %'])
    expect(buildEntry(fill({ tankAfter: '120' }), undefined, 'E1', at)).toMatchObject({ ok: false })
  })

  it('ошибка бака не прячет, каких чисел заправки не хватает', () => {
    expect(checkDraft(fuel({ liters: '40', tankAfter: '120' })).errors).toEqual([
      'Бак после — от 0 до 100 %',
      'Введите ещё цену литра или сумму — третье посчитается само',
    ])
  })

  it('после меньше до — нельзя; равно — можно', () => {
    expect(checkDraft(fill({ tankBefore: '50', tankAfter: '25' })).errors).toEqual([TANK_LESS])
    expect(buildEntry(fill({ tankBefore: '50', tankAfter: '25' }), undefined, 'E1', at)).toMatchObject({ ok: false })
    expect(checkDraft(fill({ tankBefore: '50', tankAfter: '50' })).errors).toEqual([])
  })

  it('у других видов полей бака нет: в черновике остались — в запись не уходят и не проверяются', () => {
    for (const kind of ['wash', 'repair', 'fine', 'other'] as const) {
      expect(KIND_FIELDS[kind]).not.toContain('tankBefore')
      const draft = fuel({ kind, amount: '500', tankBefore: '90', tankAfter: 'ноль' })
      expect(checkDraft(draft).errors).toEqual([])
      const entry = saved(draft)
      expect('tankBefore' in entry || 'tankAfter' in entry).toBe(false)
    }
  })

  it('доля импорта — процентом без хвоста плавающей точки', () => {
    expect(tankInput(0.25)).toBe('25')
    expect(tankInput(0.29)).toBe('29')
    expect(tankInput(0.333)).toBe('33,3')
    expect(tankInput(0.375)).toBe('37,5')
    expect(tankInput(0)).toBe('0')
    expect(tankInput(undefined)).toBe('')
    expect(draftOf(entry('E1', { kind: 'fuel', amount: 2200, tankBefore: 0.29, tankAfter: 1 }))).toMatchObject({
      tankBefore: '29',
      tankAfter: '100',
    })
  })

  it('правка без бака не трогает долю до последнего знака', () => {
    for (const [before, after] of [
      [0.29, 0.57],
      [0.333, 0.667],
      [0.1234567, 0.9876543],
    ] as const) {
      const base = entry('E1', { kind: 'fuel', liters: 40, price: 55, amount: 2200, tankBefore: before, tankAfter: after })
      const edited = saved({ ...draftOf(base), station: 'Лукойл' }, base)
      expect(edited.tankBefore).toBe(before)
      expect(edited.tankAfter).toBe(after)
    }
  })

  it('правка бака — новая доля; стёртое поле — доля уходит', () => {
    const base = entry('E1', { kind: 'fuel', liters: 40, price: 55, amount: 2200, tankBefore: 0.333, tankAfter: 1 })
    const edited = saved({ ...draftOf(base), tankBefore: '40', tankAfter: ' ' }, base)
    expect(edited.tankBefore).toBe(0.4)
    expect('tankAfter' in edited).toBe(false)
  })

  it('импорт с «после» меньше «до»: правка не сохраняется, пока не поправить', () => {
    const base = entry('E1', { kind: 'fuel', liters: 40, price: 55, amount: 2200, tankBefore: 0.8, tankAfter: 0.5 })
    expect(buildEntry(draftOf(base), base, 'E1', at)).toEqual({ ok: false, errors: [TANK_LESS] })
    expect(saved({ ...draftOf(base), tankAfter: '100' }, base)).toMatchObject({ tankBefore: 0.8, tankAfter: 1 })
  })

  it('полоска: до и после — было и долито, подпись числами до целого', () => {
    const gauge = tankGauge(entry('E1', { kind: 'fuel', tankBefore: 0.25, tankAfter: 1 }))
    expect(gauge && { ...gauge, text: flat(gauge.text) }).toEqual({ was: 25, added: 75, text: 'бак 25 % → 100 %' })
    expect(flat(tankGauge(entry('E1', { kind: 'fuel', tankBefore: 0.29, tankAfter: 0.375 }))?.text ?? '')).toBe(
      'бак 29 % → 38 %',
    )
  })

  it('полоска: одно значение — по нему', () => {
    const before = tankGauge(entry('E1', { kind: 'fuel', tankBefore: 0.25 }))
    expect(before && { ...before, text: flat(before.text) }).toEqual({ was: 25, added: 0, text: 'бак до 25 %' })
    const after = tankGauge(entry('E1', { kind: 'fuel', tankAfter: 1 }))
    expect(after && { ...after, text: flat(after.text) }).toEqual({ was: 100, added: 0, text: 'бак после 100 %' })
  })

  it('полоска: «после» меньше «до» из импорта — как есть; без доли и не у заправки — ничего', () => {
    const odd = tankGauge(entry('E1', { kind: 'fuel', tankBefore: 0.8, tankAfter: 0.5 }))
    expect(odd && { ...odd, text: flat(odd.text) }).toEqual({ was: 80, added: 0, text: 'бак 80 % → 50 %' })
    expect(tankGauge(entry('E1', { kind: 'fuel', liters: 40 }))).toBeNull()
    expect(tankGauge(entry('E1', { kind: 'wash', tankBefore: 0.5 }))).toBeNull()
  })

  it('строка «главное» про бак не говорит — у бака своя полоска', () => {
    expect(entryDetails(entry('E1', { kind: 'fuel', liters: 40, tankBefore: 0.25, tankAfter: 1 }), '₽')).not.toContain('бак')
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
