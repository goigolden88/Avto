import { describe, expect, it } from 'vitest'
import type { ParkingVisit } from '../../app/model.ts'
import {
  buildVisit,
  newVisitDraft,
  parseSearchMinutes,
  SEARCH_MINUTES_ERROR,
  searchLabel,
  sortVisits,
  timeOf,
  visitDraftOf,
} from './visits.ts'

const at = '2026-10-17T10:00:00.000Z'

function visit(id: string, fields: Partial<ParkingVisit> = {}): ParkingVisit {
  return { id, updatedAt: at, parkingId: 'K1', date: '2026-10-14', time: '08:10', result: 'easy', ...fields }
}

describe('новая отметка', () => {
  it('дата — сегодня, время — сейчас, результат не выбран', () => {
    expect(newVisitDraft('K1', '2026-10-17', '07:05')).toEqual({
      parkingId: 'K1',
      date: '2026-10-17',
      time: '07:05',
      result: '',
      searchMinutes: '',
      note: '',
    })
  })

  it('время — ЧЧ:ММ по часам устройства', () => {
    expect(timeOf(new Date(2026, 9, 17, 7, 5))).toBe('07:05')
    expect(timeOf(new Date(2026, 9, 17, 18, 40))).toBe('18:40')
  })
})

describe('минуты поиска', () => {
  it('пусто — не указаны; целое от 0 — число, 0 тоже', () => {
    expect(parseSearchMinutes(' ')).toBeUndefined()
    expect(parseSearchMinutes('0')).toBe(0)
    expect(parseSearchMinutes(' 12 ')).toBe(12)
  })

  it('минус, дробь, текст — ошибка', () => {
    expect(parseSearchMinutes('-3')).toBeNull()
    expect(parseSearchMinutes('2,5')).toBeNull()
    expect(parseSearchMinutes('долго')).toBeNull()
  })
})

describe('отметка из формы', () => {
  const draft = newVisitDraft('K1', '2026-10-17', '7:05')

  it('результат обязателен; минуты с ошибкой не сохраняются', () => {
    expect(buildVisit({ ...draft, searchMinutes: '-1' }, undefined, 'V1', at)).toEqual({
      ok: false,
      errors: ['Отметьте, как встали: сразу, с трудом или мест нет', SEARCH_MINUTES_ERROR],
    })
    expect(buildVisit({ ...draft, parkingId: '', date: '', time: 'утро', result: 'hard' }, undefined, 'V1', at)).toEqual({
      ok: false,
      errors: ['Выберите место', 'Укажите дату', 'Укажите время — ЧЧ:ММ'],
    })
  })

  it('минуты и заметка по желанию; время дополняется нулём; 0 минут — пишется', () => {
    expect(buildVisit({ ...draft, result: 'easy' }, undefined, 'V1', at)).toEqual({
      ok: true,
      visit: { id: 'V1', updatedAt: at, parkingId: 'K1', date: '2026-10-17', time: '07:05', result: 'easy' },
    })
    expect(buildVisit({ ...draft, result: 'easy', searchMinutes: '0', note: ' двор ' }, undefined, 'V1', at)).toEqual({
      ok: true,
      visit: { id: 'V1', updatedAt: at, parkingId: 'K1', date: '2026-10-17', time: '07:05', result: 'easy', searchMinutes: 0, note: 'двор' },
    })
  })

  it('правка сохраняет id, стёртые минуты и заметка уходят', () => {
    const base = visit('V1', { searchMinutes: 5, note: 'снег' })
    const result = buildVisit({ ...visitDraftOf(base), result: 'none', searchMinutes: '', note: '' }, base, 'другой', at)
    expect(result).toEqual({
      ok: true,
      visit: { id: 'V1', updatedAt: at, parkingId: 'K1', date: '2026-10-14', time: '08:10', result: 'none' },
    })
  })
})

describe('список отметок', () => {
  it('свежие сверху: дата, время, внесение; без удалённых', () => {
    const list = [
      visit('V1', { date: '2026-10-13' }),
      visit('V2', { time: '19:00' }),
      visit('V3'),
      visit('V4'),
      visit('V5', { deleted: true }),
    ]
    expect(sortVisits(list).map((each) => each.id)).toEqual(['V2', 'V4', 'V3', 'V1'])
  })

  it('минуты в строке: «N мин поиска», 0 — «встал без поиска», нет — пусто', () => {
    expect(searchLabel(visit('V1', { searchMinutes: 12 }))).toBe('12 мин поиска')
    expect(searchLabel(visit('V1', { searchMinutes: 0 }))).toBe('встал без поиска')
    expect(searchLabel(visit('V1'))).toBe('')
  })
})
