import { describe, expect, it } from 'vitest'
import type { ParkingVisit } from '../../app/model.ts'
import {
  NO_VISITS,
  parkingStats,
  percent,
  searchText,
  sharesLine,
  sharesText,
  visitsCount,
  weekdayOf,
  withoutText,
} from './stats.ts'

const at = '2026-10-17T10:00:00.000Z'

let seq = 0
function visit(result: ParkingVisit['result'], fields: Partial<ParkingVisit> = {}): ParkingVisit {
  return { id: `V${seq++}`, updatedAt: at, parkingId: 'K1', date: '2026-10-14', time: '08:10', result, ...fields }
}

describe('доли', () => {
  it('«сразу 60 %, с трудом 30 %, мест нет 10 % — по 10 отметкам»', () => {
    const visits = [
      ...Array.from({ length: 6 }, () => visit('easy')),
      ...Array.from({ length: 3 }, () => visit('hard')),
      visit('none'),
      visit('none', { deleted: true }),
    ]
    const stats = parkingStats(visits)
    expect(stats.count).toBe(10)
    expect(sharesText(stats, 'parking')).toBe('сразу 60 %, с трудом 30 %, мест нет 10 % — по 10 отметкам')
  })

  it('подписи — по виду места, счёт тот же', () => {
    const stats = parkingStats([visit('easy'), visit('easy'), visit('hard'), visit('none')])
    expect(sharesText(stats, 'road')).toBe('свободно 50 %, плотно 25 %, стоим 25 % — по 4 отметкам')
    expect(sharesLine(stats, 'other')).toBe('легко 50 %, с трудом 25 %, никак 25 %')
  })

  it('до целых процентов; в сумме не 100 — так и показывается', () => {
    const stats = parkingStats([visit('easy'), visit('hard'), visit('none')])
    expect(sharesText(stats, 'parking')).toBe('сразу 33 %, с трудом 33 %, мест нет 33 % — по 3 отметкам')
    expect(sharesText(parkingStats([visit('hard')]), 'parking')).toBe('сразу 0 %, с трудом 100 %, мест нет 0 % — по 1 отметке')
    expect(percent(2, 3)).toBe(67)
  })

  it('отметок нет — «отметок нет», а не «0 %»', () => {
    const stats = parkingStats([])
    expect(sharesText(stats, 'road')).toBe(NO_VISITS)
    expect(stats.byHour).toEqual([])
    expect(stats.byWeekday).toEqual([])
  })
})

describe('по часу и дню недели', () => {
  it('только часы с отметками, по порядку; 18:00–18:59 — 18', () => {
    const stats = parkingStats([
      visit('none', { time: '18:59' }),
      visit('hard', { time: '18:00' }),
      visit('easy', { time: '08:10' }),
      visit('easy', { time: 'утро' }),
    ])
    expect(stats.byHour).toEqual([
      { hour: 8, easy: 1, hard: 0, none: 0, count: 1 },
      { hour: 18, easy: 0, hard: 1, none: 1, count: 2 },
    ])
  })

  it('дни с понедельника, только дни с отметками', () => {
    // 12.10.2026 — понедельник, 18.10.2026 — воскресенье.
    expect(weekdayOf('2026-10-12')).toBe(0)
    expect(weekdayOf('2026-10-18')).toBe(6)
    expect(weekdayOf('вчера')).toBeNull()
    const stats = parkingStats([visit('easy', { date: '2026-10-18' }), visit('none', { date: '2026-10-12' }), visit('hard', { date: '2026-10-19' })])
    expect(stats.byWeekday).toEqual([
      { day: 0, easy: 0, hard: 1, none: 1, count: 2 },
      { day: 6, easy: 1, hard: 0, none: 0, count: 1 },
    ])
  })
})

describe('минуты поиска', () => {
  it('медиана — только по отметкам с минутами; 0 входит', () => {
    const stats = parkingStats([
      visit('easy', { searchMinutes: 0 }),
      visit('hard', { searchMinutes: 7 }),
      visit('hard', { searchMinutes: 8 }),
      visit('none', { searchMinutes: 20 }),
      visit('easy'),
    ])
    expect(stats.search).toEqual({ median: 8, count: 4, without: 1 })
    expect(searchText(stats.search, 'parking')).toBe('8 мин — медиана 4 отметок')
    expect(withoutText(stats.search)).toBe('без минут — 1 из 5, в медиану не входят')
  })

  it('минут нет ни у одной — так и сказано; все с минутами — подписи нет', () => {
    expect(searchText(parkingStats([visit('easy')]).search, 'parking')).toBe('минут поиска нет')
    expect(searchText(parkingStats([visit('easy')]).search, 'road')).toBe('минут проезда нет')
    const one = parkingStats([visit('easy', { searchMinutes: 0 })]).search
    expect(searchText(one, 'road')).toBe('0 мин — медиана 1 отметки')
    expect(withoutText(one)).toBe('')
  })

  it('число отметок', () => {
    expect(visitsCount(1)).toBe('1 отметка')
    expect(visitsCount(3)).toBe('3 отметки')
    expect(visitsCount(11)).toBe('11 отметок')
  })
})
