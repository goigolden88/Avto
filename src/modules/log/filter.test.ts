import { describe, expect, it } from 'vitest'
import type { Entry } from '../../app/model.ts'
import {
  ALL,
  currentPeriod,
  entriesCount,
  filterEntries,
  isFiltered,
  periodTitle,
  shiftPeriod,
  shownText,
  type LogFilter,
} from './filter.ts'

const at = '2026-10-16T10:00:00.000Z'

function entry(id: string, fields: Partial<Entry> = {}): Entry {
  return { id, updatedAt: at, carId: 'C1', kind: 'wash', date: '2026-10-05', amount: 500, ...fields }
}

const entries = [
  entry('E1'),
  entry('E2', { kind: 'fuel', carId: 'C2' }),
  entry('E3', { date: '2026-09-30' }),
  entry('E4', { date: '2025-10-05', kind: 'fuel' }),
  entry('E5', { date: 'вчера' }),
  entry('E6', { deleted: true }),
]

const ids = (filter: LogFilter) => filterEntries(entries, filter).map((each) => each.id)

describe('отбор журнала', () => {
  it('всё — все живые записи, и с испорченной датой', () => {
    expect(ids(ALL)).toEqual(['E1', 'E2', 'E3', 'E4', 'E5'])
    expect(isFiltered(ALL)).toBe(false)
  })

  it('по машине и по виду', () => {
    expect(ids({ ...ALL, carId: 'C2' })).toEqual(['E2'])
    expect(ids({ ...ALL, kind: 'fuel' })).toEqual(['E2', 'E4'])
    expect(isFiltered({ ...ALL, kind: 'fuel' })).toBe(true)
  })

  it('месяц и год — сначала текущие', () => {
    expect(currentPeriod('month', '2026-10-16')).toEqual({ kind: 'month', month: '2026-10' })
    expect(currentPeriod('year', '2026-10-16')).toEqual({ kind: 'year', year: 2026 })
    expect(currentPeriod('all', '2026-10-16')).toEqual({ kind: 'all' })
    expect(ids({ ...ALL, period: { kind: 'month', month: '2026-10' } })).toEqual(['E1', 'E2'])
    expect(ids({ ...ALL, period: { kind: 'year', year: 2026 } })).toEqual(['E1', 'E2', 'E3'])
  })

  it('стрелки — назад и вперёд, через границу года', () => {
    expect(shiftPeriod({ kind: 'month', month: '2026-01' }, -1)).toEqual({ kind: 'month', month: '2025-12' })
    expect(shiftPeriod({ kind: 'month', month: '2025-12' }, 1)).toEqual({ kind: 'month', month: '2026-01' })
    expect(shiftPeriod({ kind: 'year', year: 2026 }, -1)).toEqual({ kind: 'year', year: 2025 })
    expect(shiftPeriod({ kind: 'all' }, 1)).toEqual({ kind: 'all' })
  })

  it('название периода', () => {
    expect(periodTitle({ kind: 'month', month: '2026-10' })).toBe('октябрь 2026')
    expect(periodTitle({ kind: 'year', year: 2026 })).toBe('2026')
    expect(periodTitle({ kind: 'all' })).toBe('всё время')
  })

  it('сколько показано', () => {
    expect(entriesCount(1)).toBe('1 запись')
    expect(entriesCount(3)).toBe('3 записи')
    expect(shownText(12, 12)).toBe('12 записей')
    expect(shownText(3, 12)).toBe('показано 3 из 12')
  })
})
