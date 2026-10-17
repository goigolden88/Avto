import { describe, expect, it } from 'vitest'
import type { Entry } from '../../app/model.ts'
import { ALL, type LogFilter } from './filter.ts'
import {
  basisText,
  CHEAP_SPAN,
  cheapSince,
  cheapStations,
  consumptionText,
  fillsCount,
  fuelNotes,
  fuelNoteText,
  nameKey,
  periodStats,
  perKm,
  perKmText,
  priceChangeText,
} from './stats.ts'

/** Неразрывные пробелы `toLocaleString` — обычными, чтобы ожидание читалось. */
const flat = (text: string) => text.replace(/[  ]/g, ' ')

const at = '2026-10-16T10:00:00.000Z'

function entry(id: string, fields: Partial<Entry> = {}): Entry {
  return { id, updatedAt: at, carId: 'C1', kind: 'fuel', date: '2026-10-05', amount: 1000, ...fields }
}

const month = (m: string): LogFilter => ({ ...ALL, period: { kind: 'month', month: m } })

describe('строка заправки: км с прошлой', () => {
  it('у обеих есть одометр — разница', () => {
    const notes = fuelNotes([
      entry('E1', { date: '2026-10-01', odometer: 10000 }),
      entry('E2', { date: '2026-10-08', odometer: 10600 }),
    ])
    expect(notes.get('E1')?.km).toBeNull()
    expect(notes.get('E2')?.km).toBe(600)
    expect(flat(fuelNoteText(notes.get('E2')))).toBe('+600 км с прошлой')
  })

  it('прошлая — ближайшая заправка этой машины с одометром; чужая машина и мойка не в счёт', () => {
    const notes = fuelNotes([
      entry('E1', { date: '2026-10-01', odometer: 10000 }),
      entry('E2', { date: '2026-10-03' }),
      entry('E3', { date: '2026-10-04', carId: 'C2', odometer: 50000 }),
      entry('E4', { date: '2026-10-05', kind: 'wash', odometer: 10300 }),
      entry('E5', { date: '2026-10-08', odometer: 10600 }),
    ])
    expect(notes.get('E2')?.km).toBeNull()
    expect(notes.get('E5')?.km).toBe(600)
    expect(notes.has('E4')).toBe(false)
  })

  it('без одометра у заправки — км не показываются', () => {
    const notes = fuelNotes([entry('E1', { date: '2026-10-01', odometer: 10000 }), entry('E2', { date: '2026-10-08' })])
    expect(notes.get('E2')?.km).toBeNull()
    expect(fuelNoteText(notes.get('E2'))).toBe('')
  })

  it('в один день прошлая — раньше внесённая, как в `sortEntries`', () => {
    const notes = fuelNotes([
      entry('E2', { date: '2026-10-05', odometer: 10500 }),
      entry('E1', { date: '2026-10-05', odometer: 10000 }),
    ])
    expect(notes.get('E2')?.km).toBe(500)
    expect(notes.get('E1')?.km).toBeNull()
  })

  it('одометр меньше прошлого — так и сказано, без отрицательных км', () => {
    const notes = fuelNotes([
      entry('E1', { date: '2026-10-01', odometer: 10000 }),
      entry('E2', { date: '2026-10-08', odometer: 9000 }),
    ])
    expect(fuelNoteText(notes.get('E2'))).toBe('одометр меньше прошлого')
  })

  it('удалённая запись не считается прошлой', () => {
    const notes = fuelNotes([
      entry('E1', { date: '2026-10-01', odometer: 10000 }),
      entry('E2', { date: '2026-10-05', odometer: 10400, deleted: true }),
      entry('E3', { date: '2026-10-08', odometer: 10600 }),
    ])
    expect(notes.get('E3')?.km).toBe(600)
  })
})

describe('строка заправки: рост цены', () => {
  it('к прошлой заправке того же топлива любой машины (Р-07)', () => {
    const notes = fuelNotes([
      entry('E1', { date: '2026-10-01', fuel: '95', price: 50 }),
      entry('E2', { date: '2026-10-03', fuel: '92', price: 40 }),
      entry('E3', { date: '2026-10-08', fuel: '95', price: 51.05, carId: 'C2' }),
    ])
    expect(notes.get('E1')?.priceChange).toBeNull()
    expect(fuelNoteText(notes.get('E3'))).toBe('цена +2,1 %')
  })

  it('дешевле — минус, равные — «без изменений»', () => {
    expect(priceChangeText(-0.5)).toBe('цена −0,5 %')
    expect(priceChangeText(0)).toBe('цена без изменений')
    expect(priceChangeText(0.04)).toBe('цена +0,04 %')
    const notes = fuelNotes([
      entry('E1', { date: '2026-10-01', fuel: '95', price: 55.5 }),
      entry('E2', { date: '2026-10-08', fuel: '95', price: 55.5 }),
    ])
    expect(fuelNoteText(notes.get('E2'))).toBe('цена без изменений')
  })

  it('названия сравниваются без пробелов по краям и регистра; «95» и «АИ-95» — разные', () => {
    expect(nameKey(' аи-95 ')).toBe(nameKey('АИ-95'))
    const notes = fuelNotes([
      entry('E1', { date: '2026-10-01', fuel: 'АИ-95', price: 50 }),
      entry('E2', { date: '2026-10-03', fuel: 'аи-95 ', price: 55 }),
      entry('E3', { date: '2026-10-05', fuel: '95', price: 60 }),
    ])
    expect(fuelNoteText(notes.get('E2'))).toBe('цена +10 %')
    expect(notes.get('E3')?.priceChange).toBeNull()
  })

  it('без топлива или без цены — роста нет; прошлая без цены пропускается', () => {
    const notes = fuelNotes([
      entry('E1', { date: '2026-10-01', fuel: '95', price: 50 }),
      entry('E2', { date: '2026-10-02', fuel: '95' }),
      entry('E3', { date: '2026-10-03', price: 60 }),
      entry('E4', { date: '2026-10-04', fuel: '95', price: 55 }),
    ])
    expect(notes.get('E2')?.priceChange).toBeNull()
    expect(notes.get('E3')?.priceChange).toBeNull()
    expect(fuelNoteText(notes.get('E4'))).toBe('цена +10 %')
  })

  it('км и цена — одной строкой', () => {
    const notes = fuelNotes([
      entry('E1', { date: '2026-10-01', fuel: '95', price: 50, odometer: 10000 }),
      entry('E2', { date: '2026-10-08', fuel: '95', price: 49.75, odometer: 11240 }),
    ])
    expect(flat(fuelNoteText(notes.get('E2')))).toBe('+1 240 км с прошлой · цена −0,5 %')
  })

  it('правка старой записи сразу меняет следующую — ничего не хранится', () => {
    const next = entry('E2', { date: '2026-10-08', odometer: 10600 })
    const before = [entry('E1', { date: '2026-10-01', odometer: 10000 }), next]
    const after = [entry('E1', { date: '2026-10-01', odometer: 10100 }), next]
    expect(fuelNotes(before).get('E2')?.km).toBe(600)
    expect(fuelNotes(after).get('E2')?.km).toBe(500)
  })
})

describe('итоги: цена километра', () => {
  const entries = [
    entry('E0', { date: '2026-09-28', odometer: 9000, amount: 3000 }),
    entry('E1', { date: '2026-10-02', odometer: 9500, amount: 2000 }),
    entry('E2', { date: '2026-10-10', kind: 'wash', amount: 600 }),
    entry('E3', { date: '2026-10-15', kind: 'fine', amount: 500 }),
    entry('E4', { date: '2026-10-20', kind: 'repair', amount: 4000, odometer: 10240 }),
    entry('E5', { date: '2026-11-01', odometer: 11000 }),
  ]

  it('пробег — от последнего показания до периода, любого вида; штрафы в «всём»', () => {
    const stats = periodStats(entries, { ...month('2026-10'), carId: 'C1' })
    const car = stats.cars[0]
    expect(stats.cars).toHaveLength(1)
    expect(car?.distance).toBe(1240)
    expect(car?.fuelMoney).toBe(2000)
    expect(car?.allMoney).toBe(7100)
    expect(perKm(car?.fuelMoney ?? 0, car?.distance ?? null)).toBeCloseTo(2000 / 1240)
    expect(flat(perKmText(7100, 1240, '₽'))).toBe('5,73 ₽/км')
    expect(flat(basisText(car!))).toBe('пробег 1 240 км, по 2 записям из 4')
  })

  it('показаний до периода нет — от первого в периоде', () => {
    const stats = periodStats(entries, month('2026-09'))
    expect(stats.cars[0]?.distance).toBeNull()
    expect(perKmText(3000, null, '₽')).toBe('мало данных')
    expect(basisText(stats.cars[0]!)).toBe('по 1 записи из 1')

    const two = periodStats(
      [entry('A', { date: '2026-10-01', odometer: 100 }), entry('B', { date: '2026-10-09', odometer: 400 })],
      month('2026-10'),
    )
    expect(two.cars[0]?.distance).toBe(300)
  })

  it('год и «всё»', () => {
    expect(periodStats(entries, { ...ALL, period: { kind: 'year', year: 2026 } }).cars[0]?.distance).toBe(2000)
    expect(periodStats(entries, ALL).cars[0]?.distance).toBe(2000)
    expect(periodStats(entries, ALL).records).toBe(6)
  })

  it('пробег ноль или меньше — «мало данных», деления на ноль нет', () => {
    const zero = periodStats(
      [entry('A', { date: '2026-10-01', odometer: 100 }), entry('B', { date: '2026-10-09', odometer: 100 })],
      month('2026-10'),
    )
    expect(zero.cars[0]?.distance).toBe(0)
    expect(perKmText(2000, 0, '₽')).toBe('мало данных')
    const back = periodStats(
      [entry('A', { date: '2026-10-01', odometer: 1000 }), entry('B', { date: '2026-10-09', odometer: 100 })],
      month('2026-10'),
    )
    expect(back.cars[0]?.distance).toBe(-900)
    expect(perKm(2000, -900)).toBeNull()
  })

  it('вид записи на итоги не действует', () => {
    const all = periodStats(entries, month('2026-10'))
    const washOnly = periodStats(entries, { ...month('2026-10'), kind: 'wash' })
    expect(washOnly).toEqual(all)
  })

  it('«Все машины» — строкой на каждую машину с записями, траты по видам общие', () => {
    const stats = periodStats(
      [...entries, entry('M1', { carId: 'C2', date: '2026-10-03', kind: 'wash', amount: 400 })],
      month('2026-10'),
    )
    expect(stats.cars.map((car) => car.carId)).toEqual(['C1', 'C2'])
    expect(stats.cars[1]?.distance).toBeNull()
    expect(stats.kinds).toEqual([
      { kind: 'fuel', amount: 2000, count: 1 },
      { kind: 'wash', amount: 1000, count: 2 },
      { kind: 'repair', amount: 4000, count: 1 },
      { kind: 'fine', amount: 500, count: 1 },
    ])
    expect(stats.total).toBe(7500)
    expect(stats.records).toBe(5)
  })

  it('записей в периоде нет — пусто и ноль, без падения', () => {
    const stats = periodStats(entries, month('2025-01'))
    expect(stats).toEqual({ records: 0, total: 0, kinds: [], cars: [] })
  })

  it('удалённые записи не считаются', () => {
    const stats = periodStats([...entries, entry('X', { date: '2026-10-25', odometer: 20000, deleted: true })], month('2026-10'))
    expect(stats.cars[0]?.distance).toBe(1240)
    expect(stats.records).toBe(4)
  })
})

describe('итоги: средний расход', () => {
  it('среднее введённого по заправкам периода', () => {
    const stats = periodStats(
      [
        entry('A', { consumption: 7.5 }),
        entry('B', { consumption: 8.1 }),
        entry('C'),
        entry('D', { kind: 'wash', amount: 500 }),
      ],
      month('2026-10'),
    )
    expect(stats.cars[0]?.consumption).toEqual({ average: 7.8, count: 2 })
    expect(consumptionText({ average: 7.8, count: 2 })).toBe('7,8 л/100 км по 2 заправкам')
    expect(consumptionText({ average: 7, count: 1 })).toBe('7 л/100 км по 1 заправке')
  })

  it('ни одного — нет', () => {
    expect(periodStats([entry('A')], month('2026-10')).cars[0]?.consumption).toBeNull()
  })
})

describe('АЗС подешевле', () => {
  const today = '2026-10-17'

  it('полгода от сегодня; нет такого дня — последний день месяца', () => {
    expect(cheapSince(today)).toBe('2026-04-17')
    expect(cheapSince('2026-08-31')).toBe('2026-02-28')
    expect(CHEAP_SPAN).toBe('за последние 6 месяцев')
  })

  it('по топливу, от дешёвой к дорогой: сумма ÷ литры, число заправок', () => {
    const list = cheapStations(
      [
        entry('A', { date: '2026-09-01', fuel: '95', station: 'Лукойл', liters: 40, amount: 2200 }),
        entry('B', { date: '2026-09-15', fuel: '95', station: ' лукойл ', liters: 10, amount: 600 }),
        entry('C', { date: '2026-10-01', fuel: '95', station: 'Газпром', liters: 50, amount: 2650, carId: 'C2' }),
        entry('D', { date: '2026-10-02', fuel: 'ДТ', station: 'Роснефть', liters: 30, amount: 1950 }),
      ],
      today,
    )
    expect(list).toEqual([
      {
        fuel: '95',
        count: 3,
        stations: [
          { name: 'Газпром', price: 53, count: 1 },
          { name: 'лукойл', price: 56, count: 2 },
        ],
      },
      { fuel: 'ДТ', count: 1, stations: [{ name: 'Роснефть', price: 65, count: 1 }] },
    ])
    expect(fillsCount(2)).toBe('2 заправки')
  })

  it('старше полугода, без АЗС, без топлива, без литров, не заправки и удалённые не входят', () => {
    const list = cheapStations(
      [
        entry('A', { date: '2026-04-16', fuel: '95', station: 'Старая', liters: 40, amount: 2000 }),
        entry('B', { date: '2026-10-01', fuel: '95', liters: 40, amount: 2000 }),
        entry('C', { date: '2026-10-01', station: 'Без топлива', liters: 40, amount: 2000 }),
        entry('D', { date: '2026-10-01', fuel: '95', station: 'Без литров', amount: 2000 }),
        entry('E', { date: '2026-10-01', fuel: '95', station: 'Удалённая', liters: 40, amount: 2000, deleted: true }),
        entry('F', { date: '2026-10-01', kind: 'wash', fuel: '95', station: 'Мойка', liters: 40, amount: 2000 }),
        entry('G', { date: '2026-04-17', fuel: '95', station: 'Граница', liters: 40, amount: 2000 }),
      ],
      today,
    )
    expect(list).toEqual([{ fuel: '95', count: 1, stations: [{ name: 'Граница', price: 50, count: 1 }] }])
  })
})
