import { describe, expect, it } from 'vitest'
import { config } from '../app/config.ts'
import type { Car, Entry, Prefs } from '../app/model.ts'
import { demoData } from '../screens/demo.ts'
import type { DateStr } from '../shared/core/dates.ts'
import { buildSummary, checkSummary, UNKNOWN, type Metric, type SummaryBody } from '../shared/core/summary.ts'
import { CURRENCY_CODES, currencyCode, NO_CURRENCY, summary, type SliceData } from './slice.ts'

/**
 * Срез итогов «Авто» (Р-27, Я-48 «FamilyCore»): отрезки, строки по машинам,
 * пробег правилом «Итогов» (Р-23), деньги в копейках с кодом валюты,
 * неоплаченные штрафы — во «внимание», и форма — по проверке ядра.
 */

const at = '2026-10-18T10:00:00.000Z'

/** Воскресенье: идущая неделя 12…18 октября, прошлая — 5…11, месяцы — сентябрь и октябрь. */
const DAY = '2026-10-18'

function car(id: string, name: string, fields: Partial<Car> = {}): Car {
  return { id, updatedAt: at, name, ...fields }
}

function entry(id: string, carId: string, fields: Partial<Entry>): Entry {
  return { id, updatedAt: at, carId, kind: 'fuel', date: DAY, amount: 0, ...fields }
}

function prefs(currency: string): Prefs[] {
  return [{ id: 'prefs:main', updatedAt: at, currency }]
}

const CARS: Car[] = [
  car('C1', 'Солярис', { plate: 'А123ВС77' }),
  car('C2', 'Нива'),
  car('C3', 'Старая', { archived: true }),
  car('C4', 'Удалённая', { deleted: true }),
]

const ENTRIES: Entry[] = [
  entry('E01', 'C1', { date: '2026-09-20', odometer: 10000, amount: 3000, station: 'Лукойл' }),
  entry('E02', 'C1', { date: '2026-10-06', odometer: 10400, amount: 2500.5, consumption: 7.8 }),
  entry('E03', 'C1', { date: '2026-10-08', kind: 'wash', amount: 700, note: 'пробег не записал' }),
  entry('E04', 'C1', { date: '2026-10-13', kind: 'fine', amount: 1500, violation: 'под знаком', paid: false }),
  entry('E05', 'C1', { date: '2026-10-14', kind: 'repair', amount: 4000.25, odometer: 10650, what: 'колодки', service: 'СТО' }),
  entry('E06', 'C2', { date: '2026-10-15', odometer: 5000, amount: 2000 }),
  entry('E07', 'C3', { date: '2026-09-10', kind: 'repair', odometer: 100, amount: 1000 }),
  // Машины нет — запись в срез не идёт.
  entry('E08', 'C4', { date: '2026-10-13', amount: 999, paid: false, kind: 'fine' }),
  entry('E09', 'C1', { date: '2026-09-25', kind: 'fine', amount: 500, paid: true }),
  entry('E10', 'C1', { date: '2026-10-14', kind: 'wash', amount: 10000, deleted: true }),
  // Дата испорчена: ни в один отрезок, но неоплаченный штраф — во «внимании».
  entry('E11', 'C2', { date: 'вчера', kind: 'fine', amount: 300, paid: false }),
]

const DATA: SliceData = { cars: CARS, entries: ENTRIES, prefs: prefs('₽') }

/** Строки отрезка; «не известно» целиком — ошибка теста. */
function metricsOf(body: SummaryBody, index: number): Metric[] {
  const metrics = body.periods[index]?.metrics
  if (!Array.isArray(metrics)) throw new Error(`отрезок ${index} — не строки`)
  return metrics
}

function row(metrics: Metric[], key: string): Metric | undefined {
  return metrics.find((metric) => metric.key === key)
}

describe('отрезки', () => {
  const body = summary(DATA, DAY)

  it('четыре отрезка ядра; идущие верны по день расчёта, закончившиеся — null', () => {
    expect(body.periods.map((period) => [period.grain, period.from, period.to, period.through])).toEqual([
      ['week', '2026-10-05', '2026-10-11', null],
      ['week', '2026-10-12', '2026-10-18', DAY],
      ['month', '2026-09-01', '2026-09-30', null],
      ['month', '2026-10-01', '2026-10-31', DAY],
    ])
  })

  it('неделя без записей журнала у всех машин — отрезок целиком no-data', () => {
    const later = summary(DATA, '2026-10-25')
    expect(later.periods[1]?.metrics).toEqual({ unknown: UNKNOWN.noData, text: 'записей журнала в отрезке нет' })
    expect(Array.isArray(later.periods[0]?.metrics)).toBe(true)
  })

  it('записи удалённой машины и удалённые записи отрезок не оживляют', () => {
    const only = summary({ ...DATA, entries: [ENTRIES[7]!, ENTRIES[9]!] }, DAY)
    expect(only.periods[1]?.metrics).toMatchObject({ unknown: UNKNOWN.noData })
  })
})

describe('строки машины', () => {
  const body = summary(DATA, DAY)

  it('идущая неделя: траты всего и по видам с записями, счёты, пробег от показания до отрезка', () => {
    const week = metricsOf(body, 1)
    expect(week.filter((metric) => metric.key.startsWith('car.C1.')).map((metric) => metric.key)).toEqual([
      'car.C1.spend',
      'car.C1.spend.repair',
      'car.C1.spend.fine',
      'car.C1.fine.count',
      'car.C1.repair.count',
      'car.C1.km',
      'car.C1.kmCost',
    ])
    expect(row(week, 'car.C1.spend')).toEqual({
      key: 'car.C1.spend',
      label: 'Солярис: траты всего',
      value: { money: 550025, currency: 'RUB' },
      basis: 'по 2 записям',
    })
    expect(row(week, 'car.C1.spend.fine')).toMatchObject({ label: 'Солярис: траты: штраф', value: { money: 150000 }, basis: 'по 1 записи' })
    expect(row(week, 'car.C1.spend.repair')?.value).toEqual({ money: 400025, currency: 'RUB' })
    expect(row(week, 'car.C1.fine.count')).toMatchObject({ value: { n: 1, unit: 'count' }, basis: 'из 2 записей машины' })
    expect(row(week, 'car.C1.repair.count')?.value).toEqual({ n: 1, unit: 'count' })
    // 10 650 − 10 400 (последнее до отрезка); 5 500,25 ÷ 250 = 22,001 → 22,00.
    expect(row(week, 'car.C1.km')).toMatchObject({ value: { n: 250, unit: 'km' }, basis: 'по 1 записи с пробегом из 2' })
    expect(row(week, 'car.C1.kmCost')).toMatchObject({ value: { money: 2200, currency: 'RUB' }, basis: 'по 1 записи с пробегом из 2' })
  })

  it('одно показание без прошлого — пробег и цена километра not-enough с тем же основанием', () => {
    const week = metricsOf(body, 1)
    expect(row(week, 'car.C2.km')).toEqual({
      key: 'car.C2.km',
      label: 'Нива: пробег',
      value: { unknown: UNKNOWN.notEnough, text: 'показаний пробега меньше двух' },
      basis: 'по 1 записи с пробегом из 1',
    })
    expect(row(week, 'car.C2.kmCost')?.value).toMatchObject({ unknown: UNKNOWN.notEnough })
    expect(row(week, 'car.C2.fine.count')?.value).toEqual({ n: 0, unit: 'count' })
    expect(row(week, 'car.C2.spend.fuel')?.value).toEqual({ money: 200000, currency: 'RUB' })
  })

  it('машина не в архиве без записей — строки с нулём; в архиве без записей — строк нет', () => {
    const past = metricsOf(body, 0)
    expect(row(past, 'car.C2.spend')).toMatchObject({ value: { money: 0, currency: 'RUB' }, basis: 'записей нет' })
    expect(row(past, 'car.C2.fine.count')).toMatchObject({ value: { n: 0 }, basis: 'записей машины нет' })
    expect(past.some((metric) => metric.key.startsWith('car.C2.spend.'))).toBe(false)
    expect(past.some((metric) => metric.key.startsWith('car.C3.'))).toBe(false)
    expect(past.some((metric) => metric.key.startsWith('car.C4.'))).toBe(false)
  })

  it('машина в архиве с записями в отрезке — строки есть', () => {
    const september = metricsOf(body, 2)
    expect(row(september, 'car.C3.spend')).toMatchObject({ label: 'Старая: траты всего', value: { money: 100000 } })
    expect(row(september, 'car.C3.repair.count')?.value).toEqual({ n: 1, unit: 'count' })
  })

  it('прошлая неделя и месяц: пробег по правилу «Итогов», копейки целым, удалённое не считается', () => {
    const past = metricsOf(body, 0)
    expect(row(past, 'car.C1.spend')?.value).toEqual({ money: 320050, currency: 'RUB' })
    expect(row(past, 'car.C1.spend.wash')?.value).toEqual({ money: 70000, currency: 'RUB' })
    expect(row(past, 'car.C1.km')?.value).toEqual({ n: 400, unit: 'km' })
    expect(row(past, 'car.C1.kmCost')?.value).toEqual({ money: 800, currency: 'RUB' })

    const october = metricsOf(body, 3)
    expect(row(october, 'car.C1.spend')?.value).toEqual({ money: 870075, currency: 'RUB' })
    expect(row(october, 'car.C1.km')).toMatchObject({ value: { n: 650 }, basis: 'по 2 записям с пробегом из 4' })
    // 8 700,75 ÷ 650 = 13,385… → 13,39.
    expect(row(october, 'car.C1.kmCost')?.value).toEqual({ money: 1339, currency: 'RUB' })
  })

  it('пробег не больше нуля — not-enough', () => {
    const flat = summary(
      {
        ...DATA,
        entries: [
          entry('A', 'C1', { date: '2026-10-13', odometer: 500, amount: 100 }),
          entry('B', 'C1', { date: '2026-10-14', odometer: 500, amount: 100 }),
        ],
      },
      DAY,
    )
    expect(row(metricsOf(flat, 1), 'car.C1.km')).toMatchObject({
      value: { unknown: UNKNOWN.notEnough, text: 'пробег по одометру не больше нуля' },
      basis: 'по 2 записям с пробегом из 2',
    })
  })

  it('ключ — от id машины: переименование меняет подпись, а не ключ', () => {
    const renamed = summary({ ...DATA, cars: [car('C1', 'Хёндэ'), ...CARS.slice(1)] }, DAY)
    expect(row(metricsOf(renamed, 1), 'car.C1.spend')?.label).toBe('Хёндэ: траты всего')
  })
})

describe('валюта', () => {
  it('знаки таблицы — в коды ISO 4217, без пробелов по краям и регистра', () => {
    expect(currencyCode('₽')).toBe('RUB')
    expect(currencyCode(' руб. ')).toBe('RUB')
    expect(currencyCode('р.')).toBe('RUB')
    expect(currencyCode('rub')).toBe('RUB')
    expect(currencyCode('$')).toBe('USD')
    expect(currencyCode('€')).toBe('EUR')
    expect(currencyCode('zł')).toBeNull()
    expect(new Set(Object.values(CURRENCY_CODES))).toEqual(new Set(['RUB', 'USD', 'EUR']))
  })

  it('нет настроек — валюта по умолчанию, рубли', () => {
    const body = summary({ ...DATA, prefs: [] }, DAY)
    expect(row(metricsOf(body, 1), 'car.C1.spend')?.value).toEqual({ money: 550025, currency: 'RUB' })
  })

  it('знак не узнан — денежные строки no-currency, счёты и пробег идут', () => {
    const body = summary({ ...DATA, prefs: prefs('zł') }, DAY)
    const week = metricsOf(body, 1)
    expect(row(week, 'car.C1.spend')).toMatchObject({ value: { unknown: NO_CURRENCY }, basis: 'по 2 записям' })
    expect(row(week, 'car.C1.spend.fine')?.value).toMatchObject({ unknown: NO_CURRENCY })
    expect(row(week, 'car.C1.kmCost')?.value).toMatchObject({ unknown: NO_CURRENCY })
    expect(row(week, 'car.C1.km')?.value).toEqual({ n: 250, unit: 'km' })
    expect(row(week, 'car.C1.fine.count')?.value).toEqual({ n: 1, unit: 'count' })
    expect(() => checkSummary(buildSummary(body, { cars: CARS, entries: ENTRIES }, DAY))).not.toThrow()
  })
})

describe('требует внимания', () => {
  it('неоплаченные штрафы живых машин — одним пунктом, без имени машины', () => {
    expect(summary(DATA, DAY).attention).toEqual([
      {
        key: 'fines.unpaid',
        label: 'Штрафы не оплачены',
        count: 2,
        day: DAY,
        link: '/',
        basis: 'не оплачено 2 из 3 штрафов журнала, по всем машинам',
      },
    ])
  })

  it('оплачены все — пункта нет; штраф без отметки «оплачен» неоплаченным не считается', () => {
    const paid = ENTRIES.filter((each) => each.paid !== false)
    expect(summary({ ...DATA, entries: paid }, DAY).attention).toEqual([])
    const unmarked = entry('X', 'C1', { kind: 'fine', amount: 500 })
    expect(summary({ ...DATA, entries: [...paid, unmarked] }, DAY).attention).toEqual([])
  })
})

describe('чего в срезе нет никогда', () => {
  it('госномера, нарушения, «что делали», сервиса, АЗС, заметок, расхода', () => {
    const text = JSON.stringify(summary(DATA, DAY))
    for (const secret of ['А123ВС77', 'под знаком', 'колодки', 'СТО', 'Лукойл', 'пробег не записал', 'consumption', '7.8']) {
      expect(text).not.toContain(secret)
    }
  })

  it('итога по всем машинам нет: каждая строка — машины', () => {
    const body = summary(DATA, DAY)
    for (const index of [0, 1, 2, 3]) {
      for (const metric of metricsOf(body, index)) expect(metric.key).toMatch(/^car\.C[123]\./)
    }
  })
})

describe('форма — по проверке ядра', () => {
  const DAYS: DateStr[] = ['2026-10-18', '2026-10-19', '2026-11-01', '2027-01-01', '2028-02-29']

  it('свои данные', () => {
    const body = summary(DATA, DAY)
    expect(() => checkSummary(buildSummary(body, { cars: CARS, entries: ENTRIES }, DAY))).not.toThrow()
  })

  it.each(DAYS)('демо от %s — через config.summary', (day) => {
    const data = demoData(day)
    const make = config.summary
    if (!make) throw new Error('summary в конфиге не задан')
    const result = checkSummary(buildSummary(make(data, day), data, day))
    expect(result.periods).toHaveLength(4)
    // В демо — неоплаченный штраф.
    expect(result.attention.map((item) => item.key)).toEqual(['fines.unpaid'])
    // Идущий месяц демо не пуст: заправка в день входа.
    const month = result.periods[3]?.metrics
    expect(Array.isArray(month) && month.some((metric) => metric.key.endsWith('.spend'))).toBe(true)
  })

  it('одинаковые данные в один день — одинаковый срез', () => {
    expect(JSON.stringify(summary(DATA, DAY))).toBe(JSON.stringify(summary({ ...DATA, cars: [...CARS].reverse() }, DAY)))
  })
})
