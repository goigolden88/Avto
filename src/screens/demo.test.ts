import { describe, expect, it } from 'vitest'
import { config } from '../app/config.ts'
import type { Entry } from '../app/model.ts'
import { KIND_FIELDS } from '../modules/log/entries.ts'
import { currentPeriod, type LogFilter } from '../modules/log/filter.ts'
import { cheapStations, fuelNotes, perKm, periodStats } from '../modules/log/stats.ts'
import { parkingsByCity, visitsOf } from '../modules/parking/parkings.ts'
import { parkingStats, percent } from '../modules/parking/stats.ts'
import { readCurrency } from '../modules/prefs/prefs.ts'
import { rankRoutes } from '../modules/routes/compare.ts'
import { pairsOf } from '../modules/routes/routes.ts'
import { addDays, daysBetween, isDateStr, type DateStr } from '../shared/core/dates.ts'
import { checkDemo } from '../shared/core/demo.ts'
import { isUlid } from '../shared/core/id.ts'
import { DEMO_DAYS, demoData, TRIP_DAYS } from './demo.ts'

/**
 * Демо (Я-44, Я-45 «FamilyCore»): состав по проверке ядра и то, что демо
 * оживляет расчёты журнала (Р-23) в любой день входа — понедельник,
 * воскресенье, 1-е число, 1 января, 29 февраля.
 */

const DAYS: DateStr[] = ['2026-10-17', '2026-10-19', '2026-10-18', '2026-11-01', '2027-01-01', '2028-02-29', '2026-03-02']

/** День года: 1 января — 1. */
function dayOfYear(day: DateStr): number {
  return daysBetween(`${day.slice(0, 4)}-01-01`, day) + 1
}

describe.each(DAYS)('демо от %s', (day) => {
  const data = demoData(day)
  const [daily, rare] = data.cars
  const entries = data.entries
  const ofCar = (carId: string | undefined) => entries.filter((entry) => entry.carId === carId)
  const filter = (carId: string | null, kind: 'month' | 'year' | 'all'): LogFilter => ({
    carId,
    kind: null,
    period: currentPeriod(kind, day),
  })

  it('по проверке ядра изъянов нет: пустых хранилищ нет', () => {
    expect(checkDemo(config, day)).toEqual([])
  })

  it('id — ULID у всего, машины, точки, маршруты, места и записи', () => {
    const all = [...data.cars, ...entries, ...data.points, ...data.routes, ...data.trips, ...data.parkings, ...data.parkingVisits, ...data.prefs]
    for (const record of all) {
      if (record.id !== 'prefs:main') expect(isUlid(record.id)).toBe(true)
    }
  })

  it('две машины, валюта — «₽»', () => {
    expect(data.cars.map((car) => car.name)).toEqual(['Солярис', 'Нива'])
    expect(readCurrency(data.prefs)).toBe('₽')
  })

  it('записи — за год до дня входа, в будущее не уходят, последняя — не старше недели', () => {
    for (const entry of entries) {
      expect(isDateStr(entry.date)).toBe(true)
      expect(entry.date <= day).toBe(true)
      expect(entry.date >= addDays(day, -DEMO_DAYS)).toBe(true)
      if (entry.paidDate !== undefined) expect(entry.paidDate <= day).toBe(true)
    }
    const last = entries.map((entry) => entry.date).sort().at(-1) ?? ''
    expect(daysBetween(last, day)).toBeLessThanOrEqual(7)
  })

  it('пробег каждой машины растёт вместе с датой её записей', () => {
    for (const car of data.cars) {
      const readings = ofCar(car.id)
        .filter((entry) => entry.odometer !== undefined)
        .sort((a, b) => (a.date < b.date ? -1 : 1))
      expect(readings.length).toBeGreaterThan(2)
      for (let i = 1; i < readings.length; i++) {
        expect(readings[i]?.date).not.toBe(readings[i - 1]?.date)
        expect(readings[i]?.odometer ?? 0).toBeGreaterThan(readings[i - 1]?.odometer ?? 0)
      }
    }
  })

  it('у записи — только поля её вида', () => {
    const common = new Set(['id', 'updatedAt', 'deleted', 'carId', 'kind', 'date', 'amount', 'note'])
    for (const entry of entries) {
      const own = new Set<string>(KIND_FIELDS[entry.kind])
      for (const key of Object.keys(entry)) expect(common.has(key) || own.has(key), `${entry.kind}.${key}`).toBe(true)
    }
  })

  it('заправка: литры × цена сходятся с суммой до 1 %; расход — только у каждодневной', () => {
    const fills = entries.filter((entry) => entry.kind === 'fuel')
    for (const fill of fills) {
      const expected = (fill.liters ?? 0) * (fill.price ?? 0)
      expect(Math.abs(fill.amount - expected) / fill.amount).toBeLessThanOrEqual(0.01)
      expect(fill.consumption !== undefined).toBe(fill.carId === daily?.id)
    }
  })

  it('бак: у части заправок каждодневной — до и после, после не меньше до; у редкой — нет', () => {
    const fills = entries.filter((entry) => entry.kind === 'fuel')
    const withTank = fills.filter((fill) => fill.tankBefore !== undefined || fill.tankAfter !== undefined)
    expect(withTank.length).toBeGreaterThan(0)
    expect(fills.filter((fill) => fill.carId === daily?.id && fill.tankBefore === undefined).length).toBeGreaterThan(0)
    for (const fill of withTank) {
      expect(fill.carId).toBe(daily?.id)
      const before = fill.tankBefore ?? -1
      const after = fill.tankAfter ?? -1
      expect(before).toBeGreaterThanOrEqual(0)
      expect(after).toBeGreaterThanOrEqual(before)
      expect(after).toBeLessThanOrEqual(1)
    }
  })

  it('ремонтов два — с «что» и «сервисом»; штрафов два — оплачен с датой и не оплачен', () => {
    const repairs = entries.filter((entry) => entry.kind === 'repair')
    expect(repairs).toHaveLength(2)
    for (const repair of repairs) {
      expect(repair.what).toBeTruthy()
      expect(repair.service).toBeTruthy()
    }
    const fines = entries.filter((entry) => entry.kind === 'fine')
    expect(fines).toHaveLength(2)
    const paid = fines.filter((fine) => fine.paid === true)
    const unpaid = fines.filter((fine) => fine.paid === false)
    expect(paid).toHaveLength(1)
    expect(unpaid).toHaveLength(1)
    expect(paid[0]?.paidDate !== undefined && paid[0].paidDate >= paid[0].date).toBe(true)
    expect(unpaid[0]?.paidDate).toBeUndefined()
  })

  it('без пробега — одна запись не штраф', () => {
    const without = entries.filter((entry) => entry.kind !== 'fine' && entry.odometer === undefined)
    expect(without).toHaveLength(1)
  })

  it('каждодневная за текущий месяц: цена километра, расход и траты — и 1-го числа', () => {
    const stats = periodStats(entries, filter(daily?.id ?? null, 'month'))
    const car = stats.cars[0]
    expect(car?.distance ?? 0).toBeGreaterThan(0)
    expect(perKm(car?.fuelMoney ?? 0, car?.distance ?? null)).not.toBeNull()
    expect(perKm(car?.allMoney ?? 0, car?.distance ?? null)).not.toBeNull()
    expect(car?.consumption?.count ?? 0).toBeGreaterThan(0)
    expect(stats.kinds.length).toBeGreaterThan(0)
  })

  it('редкая: средней строки расхода нет, цена километра считается', () => {
    const all = periodStats(entries, filter(rare?.id ?? null, 'all')).cars[0]
    expect(all).toBeDefined()
    for (const kind of ['all', 'month'] as const) {
      const car = periodStats(entries, filter(rare?.id ?? null, kind)).cars[0]
      // Месяц у редкой бывает пуст — 1-го числа она ещё не ездила; тогда считать нечего.
      if (!car) continue
      expect(car.consumption).toBeNull()
      expect(perKm(car.allMoney, car.distance)).not.toBeNull()
    }
  })

  it('в строках заправок — км с прошлой; цена в основном растёт, бывает без изменений', () => {
    const notes = fuelNotes(entries)
    const fills = entries.filter((entry) => entry.kind === 'fuel')
    const changes = fills.map((fill) => notes.get(fill.id)?.priceChange).filter((change): change is number => typeof change === 'number')
    const rises = changes.filter((change) => change > 0).length
    expect(rises).toBeGreaterThan(changes.length / 2)
    expect(changes.filter((change) => change === 0).length).toBeGreaterThan(0)
    expect(fills.filter((fill) => (notes.get(fill.id)?.km ?? 0) > 0).length).toBe(fills.length - data.cars.length)
  })

  it('АЗС подешевле: три АЗС с разной средней ценой', () => {
    const groups = cheapStations(entries, day)
    expect(groups).toHaveLength(1)
    const prices = groups[0]?.stations.map((station) => station.price.toFixed(2)) ?? []
    expect(prices).toHaveLength(3)
    expect(new Set(prices).size).toBe(3)
  })

  describe('маршруты', () => {
    const pairs = pairsOf(data.routes, data.points)
    const homeWork = pairs.find((pair) => pair.title === 'Дом → Работа')
    const ranked = homeWork ? rankRoutes(homeWork.routes, data.trips) : []

    it('точки с городом, маршруты по парам, поездки — к своим маршрутам и машинам', () => {
      expect(data.points.map((point) => point.name)).toEqual(['Дом', 'Работа', 'ТЦ Мега'])
      for (const point of data.points) expect(point.city).toBeTruthy()
      expect(pairs.map((pair) => pair.title)).toEqual(['Дом → Работа', 'Дом → ТЦ Мега', 'Работа → Дом'])
      const routeIds = new Set(data.routes.map((route) => route.id))
      const carIds = new Set(data.cars.map((car) => car.id))
      for (const trip of data.trips) {
        expect(routeIds.has(trip.routeId)).toBe(true)
        if (trip.carId !== undefined) expect(carIds.has(trip.carId)).toBe(true)
      }
    })

    it(`поездки — примерно за два месяца до дня входа, в будущее не уходят`, () => {
      const dates = data.trips.map((trip) => trip.date).sort()
      for (const date of dates) {
        expect(isDateStr(date)).toBe(true)
        expect(date < day).toBe(true)
      }
      expect(daysBetween(dates[0] ?? day, day)).toBeGreaterThanOrEqual(TRIP_DAYS - 7)
      expect(daysBetween(dates.at(-1) ?? '', day)).toBeLessThanOrEqual(3)
    })

    it('на «Дом → Работа» два маршрута с заметно разной медианой', () => {
      expect(ranked).toHaveLength(2)
      const [fast, slow] = ranked
      expect((slow?.stats.median ?? 0) - (fast?.stats.median ?? 0)).toBeGreaterThanOrEqual(5)
    })

    it('расклад по часам разный: в один час быстрее один маршрут, в другой — другой', () => {
      const byHour = (index: number) => new Map(ranked[index]?.stats.byHour.map((each) => [each.hour, each.median]))
      const [first, second] = [byHour(0), byHour(1)]
      const hours = [...first.keys()].filter((hour) => second.has(hour))
      const firstFaster = hours.filter((hour) => (first.get(hour) ?? 0) < (second.get(hour) ?? 0))
      expect(firstFaster.length).toBeGreaterThan(0)
      expect(firstFaster.length).toBeLessThan(hours.length)
    })

    it('замером и вручную, в будни и в выходные, несколько — с заметкой', () => {
      for (const { stats } of ranked) {
        expect(stats.manual).toBeGreaterThan(0)
        expect(stats.manual).toBeLessThan(stats.count)
        expect(stats.weekdays.count).toBeGreaterThan(0)
        expect(stats.weekend.count).toBeGreaterThan(0)
      }
      expect(data.trips.filter((trip) => trip.note).length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('парковки', () => {
    const visits = data.parkingVisits
    const byWhere = (where: string) => data.parkings.find((parking) => parking.where === where)
    const statsOf = (where: string) => parkingStats(visitsOf(byWhere(where)?.id ?? '', visits))
    /** Доля результата в часе места, %. Часа нет — null. */
    const shareAt = (where: string, hour: number, result: 'easy' | 'hard' | 'none') => {
      const each = statsOf(where).byHour.find((row) => row.hour === hour)
      return each ? percent(each[result], each.count) : null
    }

    it('места по городу, у точек — свои точки, отметки — к своим местам', () => {
      expect(parkingsByCity(data.parkings).map((group) => group.city)).toEqual(['Москва', 'Тверь'])
      const pointIds = new Set(data.points.map((point) => point.id))
      for (const parking of data.parkings) if (parking.pointId !== undefined) expect(pointIds.has(parking.pointId)).toBe(true)
      expect(data.parkings.filter((parking) => parking.pointId === undefined)).toHaveLength(1)
      const ids = new Set(data.parkings.map((parking) => parking.id))
      for (const visit of visits) expect(ids.has(visit.parkingId)).toBe(true)
    })

    it('отметки — примерно за два месяца до дня входа, в будущее не уходят, время — ЧЧ:ММ', () => {
      const dates = visits.map((visit) => visit.date).sort()
      for (const visit of visits) {
        expect(isDateStr(visit.date)).toBe(true)
        expect(visit.date < day).toBe(true)
        expect(/^([01]\d|2[0-3]):[0-5]\d$/.test(visit.time)).toBe(true)
      }
      expect(daysBetween(dates[0] ?? day, day)).toBeGreaterThanOrEqual(TRIP_DAYS - 7)
      expect(daysBetween(dates.at(-1) ?? '', day)).toBeLessThanOrEqual(3)
    })

    it('у работы утром сразу, вечером мест нет', () => {
      expect(shareAt('вдоль забора у работы', 8, 'easy')).toBe(100)
      expect(shareAt('вдоль забора у работы', 18, 'none') ?? 0).toBeGreaterThanOrEqual(50)
    })

    it('дома днём сразу, вечером — с трудом или мест нет', () => {
      expect(shareAt('двор за домом', 13, 'easy')).toBe(100)
      expect(shareAt('двор за домом', 19, 'hard')).toBe(100)
      expect(shareAt('двор за домом', 21, 'none')).toBe(100)
    })

    it('в ТЦ разный расклад по дням недели: в субботу хуже, чем в воскресенье', () => {
      const days = new Map(statsOf('ТЦ Мега, минус первый').byWeekday.map((row) => [row.day, row]))
      expect(days.get(6)?.easy).toBe(days.get(6)?.count)
      expect(days.get(5)?.easy).toBe(0)
    })

    it('есть отметки без минут и с нулём минут, несколько — с заметкой; медиана считается', () => {
      expect(visits.filter((visit) => visit.searchMinutes === undefined).length).toBeGreaterThan(0)
      expect(visits.filter((visit) => visit.searchMinutes === 0).length).toBeGreaterThan(0)
      expect(visits.filter((visit) => visit.note).length).toBeGreaterThanOrEqual(2)
      const search = statsOf('вдоль забора у работы').search
      expect(search.median).not.toBeNull()
      expect(search.without).toBeGreaterThan(0)
    })
  })

  // 1 января год — это один день; ремонт и штрафы — за полтора месяца до входа.
  it.runIf(dayOfYear(day) > 45)('за год: траты по всем видам журнала, у машины есть запись без пробега', () => {
    const stats = periodStats(entries, filter(null, 'year'))
    expect(stats.kinds.map((each) => each.kind)).toEqual(expect.arrayContaining(['fuel', 'wash', 'repair', 'fine']))
    expect(stats.cars.some((car) => car.withOdometer < car.records)).toBe(true)
  })
})

describe('повторный вход', () => {
  it('демо собирается заново от нового дня, id новые', () => {
    const before = demoData('2026-10-17')
    const after = demoData('2026-10-24')
    const ids = new Set(before.entries.map((entry: Entry) => entry.id))
    expect(after.entries.some((entry) => ids.has(entry.id))).toBe(false)
    expect(after.entries.map((entry) => entry.date).sort().at(-1)).toBe('2026-10-24')
  })
})
