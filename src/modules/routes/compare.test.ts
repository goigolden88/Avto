import { describe, expect, it } from 'vitest'
import type { Route, Trip } from '../../app/model.ts'
import { basisText, hourOf, isWeekend, manualText, median, NO_TRIPS, rankRoutes, routeStats, tripsCount } from './compare.ts'

const at = '2026-10-17T10:00:00.000Z'

function trip(id: string, minutes: number, fields: Partial<Trip> = {}): Trip {
  return { id, updatedAt: at, routeId: 'R1', date: '2026-10-14', start: '08:10', minutes, source: 'timer', ...fields }
}

function route(id: string): Route {
  return { id, updatedAt: at, fromId: 'P1', toId: 'P2', name: `Маршрут ${id}` }
}

describe('медиана', () => {
  it('нечётное число — середина; чётное — среднее двух средних, до минуты', () => {
    expect(median([40, 30, 50])).toBe(40)
    expect(median([30, 40])).toBe(35)
    expect(median([30, 31])).toBe(31)
    expect(median([10, 30, 33, 90])).toBe(32)
  })

  it('пусто — null, а не ноль', () => {
    expect(median([])).toBeNull()
  })
})

describe('час и день', () => {
  it('7:00–7:59 — «7 ч»; испорченное время — null', () => {
    expect(hourOf('07:00')).toBe(7)
    expect(hourOf('07:59')).toBe(7)
    expect(hourOf('23:10')).toBe(23)
    expect(hourOf('утро')).toBeNull()
  })

  it('выходные — суббота и воскресенье', () => {
    // 17.10.2026 — суббота.
    expect(isWeekend('2026-10-16')).toBe(false)
    expect(isWeekend('2026-10-17')).toBe(true)
    expect(isWeekend('2026-10-18')).toBe(true)
    expect(isWeekend('2026-10-19')).toBe(false)
    expect(isWeekend('не дата')).toBeNull()
  })
})

describe('расчёт маршрута', () => {
  it('медиана с числом поездок, ручные, по часу — только часы с поездками, будни и выходные', () => {
    const stats = routeStats([
      trip('T1', 30, { start: '07:20' }),
      trip('T2', 50, { start: '08:05', source: 'manual' }),
      trip('T3', 46, { start: '08:40' }),
      trip('T4', 25, { start: '10:00', date: '2026-10-17' }),
      trip('T5', 99, { deleted: true }),
    ])
    expect(stats).toEqual({
      median: 38,
      count: 4,
      manual: 1,
      byHour: [
        { hour: 7, median: 30, count: 1 },
        { hour: 8, median: 48, count: 2 },
        { hour: 10, median: 25, count: 1 },
      ],
      weekdays: { median: 46, count: 3 },
      weekend: { median: 25, count: 1 },
    })
  })

  it('без поездок — «поездок нет», а не «0 мин»', () => {
    const stats = routeStats([])
    expect(basisText(stats)).toBe(NO_TRIPS)
    expect(stats.byHour).toEqual([])
    expect(basisText(stats.weekend)).toBe('поездок нет')
  })

  it('число вместе с основанием', () => {
    expect(basisText({ median: 38, count: 6 })).toBe('38 мин — медиана 6 поездок')
    expect(basisText({ median: 40, count: 1 })).toBe('40 мин — медиана 1 поездки')
    expect(basisText({ median: 40, count: 21 })).toBe('40 мин — медиана 21 поездки')
    expect(manualText(routeStats([trip('T1', 30), trip('T2', 40, { source: 'manual' })]))).toBe('вручную — 1 из 2')
    expect(manualText(routeStats([trip('T1', 30)]))).toBe('все замером')
    expect(tripsCount(3)).toBe('3 поездки')
  })
})

describe('маршруты пары', () => {
  it('по возрастанию медианы, без поездок — в конце', () => {
    const routes = [route('R1'), route('R2'), route('R3')]
    const trips = [
      trip('T1', 50, { routeId: 'R1' }),
      trip('T2', 30, { routeId: 'R2' }),
      trip('T3', 34, { routeId: 'R2' }),
      trip('T4', 10, { routeId: 'R3', deleted: true }),
    ]
    expect(rankRoutes(routes, trips).map((each) => [each.route.id, each.stats.median])).toEqual([
      ['R2', 32],
      ['R1', 50],
      ['R3', null],
    ])
  })
})
