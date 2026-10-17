import { describe, expect, it } from 'vitest'
import { config } from '../../app/config.ts'
import type { Car, Entry, StoreRecord } from '../../app/model.ts'
import type { StoreData } from '../../shared/core/db.ts'
import { createImporting, type ImportContext } from '../../shared/core/importing.ts'
import { fuelNotes } from './stats.ts'
import { IMPORT_SPECS, NOTE_COLUMNS, planLogImport, sectionFields, SKIPPED_COLUMNS, tankShare } from './import.ts'

const importing = createImporting(config)
const at = '2026-10-17T10:00:00.000Z'

const car: Car = { id: 'C1', updatedAt: at, name: 'Солярис', fuel: '95' }

function base(fields: Partial<StoreData<StoreRecord>> = {}): StoreData<StoreRecord> {
  return {
    cars: [car, { id: 'C2', updatedAt: at, name: 'Нива' }],
    entries: [],
    points: [],
    routes: [],
    trips: [],
    parkings: [],
    parkingVisits: [],
    prefs: [],
    ...fields,
  }
}

function context(): ImportContext {
  let seq = 0
  return { newId: () => `ID${String(++seq).padStart(3, '0')}`, now: at }
}

/** Файл импорта, как его отдаёт ИИ, — текстом. */
function file(sections: Record<string, unknown>): string {
  return JSON.stringify({ format: 'avto-import', version: 1, ...sections })
}

function plan(sections: Record<string, unknown>, data = base(), carId = 'C1') {
  return planLogImport(importing.readImportFile(file(sections)), data, context(), carId)
}

const entries = (result: ReturnType<typeof plan>): Entry[] => result.writes.entries ?? []

/** Выдуманный файл: по записи каждого листа. */
const SAMPLE = {
  fuel: [
    { date: '2025-03-01', amount: 2000, liters: 40, price: 50, station: 'Лукойл', odometer: 5000, tankBefore: 0.25, tankAfter: 1 },
    { date: '2025-03-15', liters: 40, price: 52.5, station: 'Газпром', odometer: 5600 },
  ],
  wash: [{ date: '2025-03-20', amount: 500, note: 'с ковриками' }],
  repair: [{ date: '2025-04-02', amount: 7000, what: 'замена колодок', service: 'Сервис на Лесной', odometer: 6100 }],
  fine: [{ date: '2025-04-10', amount: 500, violation: 'превышение скорости' }],
}

describe('импорт журнала — разбор разделов', () => {
  it('каждый лист — своим видом, к выбранной машине, с датой, суммой и пробегом', () => {
    const result = plan(SAMPLE)
    expect(result.issues).toEqual([])
    expect(result.skipped).toBe(0)
    expect(result.added).toEqual([
      { count: 2, forms: ['заправка', 'заправки', 'заправок'] },
      { count: 1, forms: ['мойка', 'мойки', 'моек'] },
      { count: 1, forms: ['ремонт', 'ремонта', 'ремонтов'] },
      { count: 1, forms: ['штраф', 'штрафа', 'штрафов'] },
    ])
    const list = entries(result)
    expect(list.every((each) => each.carId === 'C1' && each.updatedAt === at)).toBe(true)
    expect(list.map((each) => [each.kind, each.date, each.amount, each.odometer])).toEqual([
      ['fuel', '2025-03-01', 2000, 5000],
      ['fuel', '2025-03-15', 2100, 5600],
      ['wash', '2025-03-20', 500, undefined],
      ['repair', '2025-04-02', 7000, 6100],
      ['fine', '2025-04-10', 500, undefined],
    ])
    expect(list[2]).toMatchObject({ note: 'с ковриками' })
    expect(list[3]).toMatchObject({ what: 'замена колодок', service: 'Сервис на Лесной' })
  })

  it('выбрана другая машина — записи идут к ней', () => {
    expect(entries(plan({ wash: SAMPLE.wash }, base(), 'C2'))[0]?.carId).toBe('C2')
  })

  it('машины нет — внятный отказ', () => {
    expect(() => plan(SAMPLE, base(), 'нет такой')).toThrow('Машина для импорта не найдена')
    expect(() => plan(SAMPLE, base({ cars: [{ ...car, deleted: true }] }))).toThrow('не найдена')
  })

  it('у заправки третье число считается (Р-06), топливо — машины, бак — долей', () => {
    const [first, second] = entries(plan({ fuel: SAMPLE.fuel }))
    expect(first).toMatchObject({ liters: 40, price: 50, amount: 2000, fuel: '95', station: 'Лукойл', tankBefore: 0.25, tankAfter: 1 })
    expect(second).toMatchObject({ liters: 40, price: 52.5, amount: 2100, fuel: '95' })
    expect(entries(plan({ fuel: [{ date: '2025-03-01', amount: 2000, price: 50, fuel: 92 }] }))[0]).toMatchObject({
      liters: 40,
      fuel: '92',
    })
  })

  it('после импорта у заправок видно км с прошлой и рост цены', () => {
    const list = entries(plan({ fuel: SAMPLE.fuel }))
    const second = fuelNotes(list).get(list[1]?.id ?? '')
    expect(second?.km).toBe(600)
    expect(second?.priceChange).toBeCloseTo(5)
  })

  it('три числа не сходятся больше допуска — запись как есть, в сводке заметка', () => {
    const result = plan({ fuel: [{ date: '2025-03-01', amount: 2000, liters: 40, price: 55 }] })
    expect(entries(result)[0]).toMatchObject({ amount: 2000, liters: 40, price: 55 })
    expect(result.notes).toHaveLength(1)
    expect(result.notes?.[0]?.text.replace(/[  ]/g, ' ')).toBe(
      'сумма 2 000 ₽ расходится с «литры × цена» = 2 200 ₽ больше чем на 1 % — загрузится как есть',
    )
    expect(plan({ fuel: [{ date: '2025-03-01', amount: 2210, liters: 40, price: 55 }] }).notes).toEqual([])
  })

  it('валюта заметки — из настроек (Р-17)', () => {
    const data = base({ prefs: [{ id: 'prefs:main', updatedAt: at, currency: 'zł' }] })
    const result = plan({ fuel: [{ date: '2025-03-01', amount: 200, liters: 40, price: 55 }] }, data)
    expect(result.notes?.[0]?.text).toContain('zł')
  })

  it('штраф с суммой — оплачен; дата оплаты — только если есть; неоплаченный — false', () => {
    const [paid, dated, unpaid] = entries(
      plan({
        fine: [
          { date: '2025-04-10', amount: 500 },
          { date: '2025-04-11', amount: 800, paidDate: '2025-04-12' },
          { date: '2025-04-12', amount: 1000, paid: false, paidDate: '2025-04-13' },
        ],
      }),
    )
    expect(paid).toMatchObject({ paid: true })
    expect(paid?.paidDate).toBeUndefined()
    expect(dated).toMatchObject({ paid: true, paidDate: '2025-04-12' })
    expect(unpaid).toMatchObject({ paid: false })
    expect(unpaid?.paidDate).toBeUndefined()
  })

  it('у штрафа пробега нет, у мойки нет литров: чужие поля вида не пишутся', () => {
    const [fine] = entries(plan({ fine: [{ date: '2025-04-10', amount: 500, odometer: 100 }] }))
    expect(fine?.odometer).toBeUndefined()
    const [wash] = entries(plan({ wash: [{ date: '2025-04-10', amount: 500, liters: 10, station: 'Лукойл' }] }))
    expect(wash?.liters).toBeUndefined()
    expect(wash?.station).toBeUndefined()
  })

  it('«прочее» — свой раздел', () => {
    const result = plan({ other: [{ date: '2025-01-15', amount: 9800, what: 'ОСАГО' }] })
    expect(entries(result)[0]).toMatchObject({ kind: 'other', what: 'ОСАГО', amount: 9800 })
    expect(result.added[0]?.forms[0]).toBe('запись «прочее»')
  })

  it('числа строкой — как их пишут: «1 829,50»', () => {
    expect(entries(plan({ repair: [{ date: '2025-04-02', amount: '1 829,50', odometer: '6 100' }] }))[0]).toMatchObject({
      amount: 1829.5,
      odometer: 6100,
    })
  })
})

describe('импорт журнала — что не разобрано', () => {
  it('без даты или без суммы — в «не разобрано» с причиной, остальные идут', () => {
    const result = plan({
      wash: [{ amount: 500 }, { date: '2025-03-20' }, { date: '20.03.2025', amount: 500 }, { date: '2025-03-21', amount: 500 }],
      fuel: [{ date: '2025-03-01', amount: 2000 }],
    })
    expect(entries(result).map((each) => each.date)).toEqual(['2025-03-21'])
    expect(result.issues.map((each) => `${each.title}: ${each.reason}`)).toEqual([
      'Заправка 1, 01.03.2025: нужны два числа из трёх — литры, цена литра, сумма',
      'Мойка 1: нет даты',
      'Мойка 2, 20.03.2025: нет суммы',
      'Мойка 3: дата «20.03.2025» — не ГГГГ-ММ-ДД',
    ])
  })

  it('сумма не число или не больше нуля — отказ', () => {
    const result = plan({ wash: [{ date: '2025-03-20', amount: 'пятьсот' }, { date: '2025-03-20', amount: 0 }] })
    expect(entries(result)).toEqual([])
    expect(result.issues.map((each) => each.reason)).toEqual([
      'сумма «пятьсот» — не число больше нуля',
      'сумма «0» — не число больше нуля',
    ])
  })

  it('испорченное необязательное поле отбрасывается с заметкой, запись идёт', () => {
    const result = plan({
      fuel: [{ date: '2025-03-01', amount: 2000, liters: 40, odometer: 'много', consumption: -1 }],
      fine: [{ date: '2025-04-10', amount: 500, paidDate: 'вчера' }],
    })
    const [fuel, fine] = entries(result)
    expect(fuel?.odometer).toBeUndefined()
    expect(fuel?.consumption).toBeUndefined()
    expect(fine).toMatchObject({ paid: true })
    expect(fine?.paidDate).toBeUndefined()
    expect(result.notes?.map((each) => each.text)).toEqual([
      'пробег «много» — не число, поле не загружено',
      'расход «-1» — не число, поле не загружено',
      'дата оплаты «вчера» — не ГГГГ-ММ-ДД, поле не загружено',
    ])
  })

  it('раздел не списком, запись не объектом, неизвестный раздел — в отчёт', () => {
    const result = plan({ wash: 'много', repair: [5, { date: '2025-04-02', amount: 100 }], cars: [] })
    expect(entries(result)).toHaveLength(1)
    expect(result.issues.map((each) => `${each.title}: ${each.reason}`)).toEqual([
      'раздел «cars»: такого раздела нет — пропущен',
      'раздел «wash»: не список записей — пропущен целиком',
      'запись 1: не объект с полями',
    ])
  })

  it('не JSON, чужой формат, копия приложения — понятный отказ ядра', () => {
    expect(() => importing.readImportFile('привет')).toThrow('Это не JSON')
    expect(() => importing.readImportFile(JSON.stringify({ format: 'trapeza-import' }))).toThrow('avto-import')
    expect(() => importing.readImportFile(JSON.stringify({ schemaVersion: 1, data: {} }))).toThrow('копия приложения')
  })
})

describe('доля бака', () => {
  it('доля 0…1 — как есть, больше 1 и до 100 — процент, «25 %» — процент', () => {
    expect(tankShare(0.25)).toBe(0.25)
    expect(tankShare(1)).toBe(1)
    expect(tankShare(0)).toBe(0)
    expect(tankShare('0,5')).toBe(0.5)
    expect(tankShare(25)).toBe(0.25)
    expect(tankShare(100)).toBe(1)
    expect(tankShare('25 %')).toBe(0.25)
    expect(tankShare('25%')).toBe(0.25)
  })

  it('не написано — нет поля; вне 0…100 или не число — отказ поля', () => {
    expect(tankShare(undefined)).toBeUndefined()
    expect(tankShare('')).toBeUndefined()
    expect(tankShare(150)).toBeNull()
    expect(tankShare(-0.1)).toBeNull()
    expect(tankShare('полбака')).toBeNull()
  })

  it('в записи: процент хранится долей, вне 0…100 — поле отброшено с заметкой', () => {
    const result = plan({ fuel: [{ date: '2025-03-01', amount: 2000, liters: 40, tankBefore: '25 %', tankAfter: 150 }] })
    const [fuel] = entries(result)
    expect(fuel?.tankBefore).toBe(0.25)
    expect(fuel?.tankAfter).toBeUndefined()
    expect(result.notes?.map((each) => each.text)).toEqual([
      'доля бака после «150» — не доля 0…1 и не процент 0…100, поле не загружено',
    ])
  })
})

describe('повторный импорт', () => {
  it('тот же файл ещё раз — всё в «пропущено», ничего не добавится', () => {
    const first = entries(plan(SAMPLE))
    const again = plan(SAMPLE, base({ entries: first }))
    expect(entries(again)).toEqual([])
    expect(again.added).toEqual([])
    expect(again.skipped).toBe(5)
  })

  it('второй блок частью повторяет первый — добавится только новое', () => {
    const first = entries(plan({ wash: SAMPLE.wash }))
    const second = plan(
      { wash: [...SAMPLE.wash, { date: '2025-05-01', amount: 600 }], fine: SAMPLE.fine },
      base({ entries: first }),
    )
    expect(entries(second).map((each) => [each.kind, each.date])).toEqual([
      ['wash', '2025-05-01'],
      ['fine', '2025-04-10'],
    ])
    expect(second.skipped).toBe(1)
  })

  it('повтор внутри файла — пропущен', () => {
    const result = plan({ wash: [SAMPLE.wash[0], { date: '2025-03-20', amount: '500' }] })
    expect(entries(result)).toHaveLength(1)
    expect(result.skipped).toBe(1)
  })

  it('«уже есть» — той же машины, того же вида, даты и суммы; удалённая не в счёт', () => {
    const existing: Entry = { id: 'E1', updatedAt: at, carId: 'C1', kind: 'wash', date: '2025-03-20', amount: 500 }
    expect(plan({ wash: SAMPLE.wash }, base({ entries: [{ ...existing, carId: 'C2' }] })).skipped).toBe(0)
    expect(plan({ wash: SAMPLE.wash }, base({ entries: [{ ...existing, kind: 'repair' }] })).skipped).toBe(0)
    expect(plan({ wash: SAMPLE.wash }, base({ entries: [{ ...existing, amount: 501 }] })).skipped).toBe(0)
    expect(plan({ wash: SAMPLE.wash }, base({ entries: [{ ...existing, deleted: true }] })).skipped).toBe(0)
    expect(plan({ wash: SAMPLE.wash }, base({ entries: [existing] })).skipped).toBe(1)
  })

  it('заправка без суммы в файле совпадает по посчитанной сумме', () => {
    const first = entries(plan({ fuel: [SAMPLE.fuel[1]] }))
    expect(plan({ fuel: [{ ...SAMPLE.fuel[1], amount: 2100 }] }, base({ entries: first })).skipped).toBe(1)
  })
})

describe('промпт импорта', () => {
  const prompt = importing.buildPrompt(IMPORT_SPECS, '2026-10-17')

  it('разделы — пять видов, поля — как у формы плюс дата, бак у заправки и примечание', () => {
    expect(IMPORT_SPECS.map((spec) => spec.section)).toEqual(['fuel', 'wash', 'repair', 'fine', 'other'])
    expect(sectionFields('fuel')).toEqual([
      'date',
      'station',
      'fuel',
      'liters',
      'price',
      'amount',
      'odometer',
      'consumption',
      'tankBefore',
      'tankAfter',
      'note',
    ])
    expect(sectionFields('fine')).toEqual(['date', 'violation', 'amount', 'paid', 'paidDate', 'note'])
  })

  it('листы Excel → разделы', () => {
    expect(prompt).toContain('"fuel" — заправки — лист «Заправки»')
    expect(prompt).toContain('"wash" — мойки — лист «Автомойка»')
    expect(prompt).toContain('"repair" — ремонты и обслуживание — лист «Ремонт»')
    expect(prompt).toContain('"fine" — штрафы — лист «Штрафы»')
    expect(prompt).toContain('"other" — прочие траты')
  })

  it('столбцы Excel → поля', () => {
    for (const column of [
      'amount — «Уплачено»',
      'price — «Цена»',
      'liters — «Объём»',
      'station — «Компания»',
      'fuel — «Тип топлива»',
      'odometer — «Пробег»',
      'consumption — «Расход…»',
      'tankBefore — «Заполняемость полоски бака до»',
      'tankAfter — «Заполняемость полоски бака после»',
      'what — «Предмет ремонта»',
      'service — «Компания» на листе «Ремонт»',
      'violation — «Тип нарушения»',
    ]) {
      expect(prompt).toContain(column)
    }
    for (const column of NOTE_COLUMNS) expect(prompt).toContain(`«${column}»`)
  })

  it('разницу в цене и пробегов не переносить, машину не писать', () => {
    expect(SKIPPED_COLUMNS).toEqual(['Разница в цене', 'Разница пробегов'])
    for (const column of SKIPPED_COLUMNS) expect(prompt.toLowerCase()).toContain(column.toLowerCase())
    expect(prompt).toContain('Машину не пиши')
  })

  it('пример из промпта разбирается без отказов', () => {
    const example = /Пример файла:\n\n([\s\S]*?)\n\nМои данные:/.exec(prompt)?.[1] ?? ''
    const result = planLogImport(importing.readImportFile(example), base(), context(), 'C1')
    expect(result.issues).toEqual([])
    expect(result.notes).toEqual([])
    expect(entries(result)).toHaveLength(6)
  })
})
