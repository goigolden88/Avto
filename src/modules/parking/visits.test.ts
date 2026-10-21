import { describe, expect, it } from 'vitest'
import type { Parking, ParkingVisit } from '../../app/model.ts'
import { KIND_TEXTS } from './kinds.ts'
import {
  buildVisit,
  newVisitDraft,
  parseSearchMinutes,
  resultError,
  searchLabel,
  sortVisits,
  timeOf,
  visitDraftOf,
  withPlace,
} from './visits.ts'

const at = '2026-10-17T10:00:00.000Z'

function visit(id: string, fields: Partial<ParkingVisit> = {}): ParkingVisit {
  return { id, updatedAt: at, parkingId: 'K1', date: '2026-10-14', time: '08:10', result: 'easy', ...fields }
}

function place(id: string, kind?: Parking['kind']): Parking {
  return { id, updatedAt: at, city: 'Москва', where: `Место ${id}`, ...(kind ? { kind } : {}) }
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
    expect(buildVisit({ ...draft, searchMinutes: '-1' }, undefined, 'V1', at, 'parking')).toEqual({
      ok: false,
      errors: ['Отметьте, как встали: сразу, с трудом или мест нет', 'Минуты поиска — целое число от 0'],
    })
    expect(buildVisit({ ...draft, parkingId: '', date: '', time: 'утро', result: 'hard' }, undefined, 'V1', at, 'parking')).toEqual({
      ok: false,
      errors: ['Выберите место', 'Укажите дату', 'Укажите время — ЧЧ:ММ'],
    })
  })

  it('ошибки — словами вида места', () => {
    expect(buildVisit({ ...draft, searchMinutes: 'долго' }, undefined, 'V1', at, 'road')).toEqual({
      ok: false,
      errors: ['Отметьте, как проехали: свободно, плотно или стоим', KIND_TEXTS.road.minutesError],
    })
    expect(resultError('other')).toBe('Отметьте, как вышло: легко, с трудом или никак')
  })

  it('минуты и заметка по желанию; время дополняется нулём; 0 минут — пишется', () => {
    expect(buildVisit({ ...draft, result: 'easy' }, undefined, 'V1', at, 'parking')).toEqual({
      ok: true,
      visit: { id: 'V1', updatedAt: at, parkingId: 'K1', date: '2026-10-17', time: '07:05', result: 'easy' },
    })
    expect(buildVisit({ ...draft, result: 'easy', searchMinutes: '0', note: ' двор ' }, undefined, 'V1', at, 'parking')).toEqual({
      ok: true,
      visit: { id: 'V1', updatedAt: at, parkingId: 'K1', date: '2026-10-17', time: '07:05', result: 'easy', searchMinutes: 0, note: 'двор' },
    })
  })

  it('правка сохраняет id, стёртые минуты и заметка уходят', () => {
    const base = visit('V1', { searchMinutes: 5, note: 'снег' })
    const result = buildVisit({ ...visitDraftOf(base), result: 'none', searchMinutes: '', note: '' }, base, 'другой', at, 'parking')
    expect(result).toEqual({
      ok: true,
      visit: { id: 'V1', updatedAt: at, parkingId: 'K1', date: '2026-10-14', time: '08:10', result: 'none' },
    })
  })
})

describe('смена места в форме', () => {
  const parkings = [place('K1'), place('K2', 'parking'), place('R1', 'road'), place('O1', 'other')]
  const draft = { ...newVisitDraft('K1', '2026-10-17', '07:05'), result: 'hard' as const, searchMinutes: '5' }

  it('вид тот же — результат остаётся; место без вида — парковка', () => {
    expect(withPlace(draft, 'K2', parkings)).toEqual({ ...draft, parkingId: 'K2' })
  })

  it('вид другой — результат сбрасывается, остальное остаётся', () => {
    expect(withPlace(draft, 'R1', parkings)).toEqual({ ...draft, parkingId: 'R1', result: '' })
    expect(withPlace({ ...draft, parkingId: 'R1' }, 'O1', parkings)).toEqual({ ...draft, parkingId: 'O1', result: '' })
  })

  it('прежнее место не найдено — оно парковка', () => {
    expect(withPlace({ ...draft, parkingId: 'X' }, 'K1', parkings).result).toBe('hard')
    expect(withPlace({ ...draft, parkingId: 'X' }, 'R1', parkings).result).toBe('')
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
    expect(searchLabel(visit('V1', { searchMinutes: 12 }), 'parking')).toBe('12 мин поиска')
    expect(searchLabel(visit('V1', { searchMinutes: 0 }), 'parking')).toBe('встал без поиска')
    expect(searchLabel(visit('V1'), 'parking')).toBe('')
  })

  it('у участка — «N мин проезда», 0 — «меньше минуты»; у прочего — «N мин ушло»', () => {
    expect(searchLabel(visit('V1', { searchMinutes: 12 }), 'road')).toBe('12 мин проезда')
    expect(searchLabel(visit('V1', { searchMinutes: 0 }), 'road')).toBe('меньше минуты')
    expect(searchLabel(visit('V1', { searchMinutes: 7 }), 'other')).toBe('7 мин ушло')
    expect(searchLabel(visit('V1'), 'road')).toBe('')
  })
})
