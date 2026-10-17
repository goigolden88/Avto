import { describe, expect, it } from 'vitest'
import type { Trip } from '../../app/model.ts'
import { buildTrip, MINUTES_ERROR, newTripDraft, parseMinutes, parseTime, sortTrips, tripDraftOf } from './trips.ts'

const at = '2026-10-17T10:00:00.000Z'

function trip(id: string, fields: Partial<Trip> = {}): Trip {
  return { id, updatedAt: at, routeId: 'R1', date: '2026-10-01', start: '08:00', minutes: 30, source: 'timer', ...fields }
}

describe('минуты и время', () => {
  it('минуты — целое число больше нуля', () => {
    expect(parseMinutes('38')).toBe(38)
    expect(parseMinutes(' 7 ')).toBe(7)
    for (const bad of ['0', '-5', '12,5', '1.5', 'сорок', '']) expect(parseMinutes(bad)).toBeNull()
  })

  it('время — ЧЧ:ММ; «7:05» дополняется нулём', () => {
    expect(parseTime('07:05')).toBe('07:05')
    expect(parseTime('7:05')).toBe('07:05')
    for (const bad of ['25:00', '07:60', '7', '', 'утро']) expect(parseTime(bad)).toBeNull()
  })
})

describe('поездка из формы', () => {
  const draft = { ...newTripDraft('R1', '2026-10-17', 'C1'), start: '8:15', minutes: '42' }

  it('новая — «вручную», с машиной и без заметки', () => {
    expect(buildTrip(draft, undefined, 'T1', at)).toEqual({
      ok: true,
      trip: { id: 'T1', updatedAt: at, routeId: 'R1', date: '2026-10-17', start: '08:15', minutes: 42, source: 'manual', carId: 'C1' },
    })
  })

  it('без машины — поле не пишется; заметка — срезанной', () => {
    const result = buildTrip({ ...draft, carId: '', note: ' ливень ' }, undefined, 'T1', at)
    expect(result).toMatchObject({ ok: true, trip: { note: 'ливень' } })
    expect(result.ok && 'carId' in result.trip).toBe(false)
  })

  it('ноль, минус или текст в минутах — понятная фраза, поездки нет', () => {
    for (const minutes of ['0', '-3', 'долго']) {
      expect(buildTrip({ ...draft, minutes }, undefined, 'T1', at)).toEqual({ ok: false, errors: [MINUTES_ERROR] })
    }
  })

  it('маршрут, дата и время обязательны', () => {
    expect(buildTrip({ ...draft, routeId: '', date: '', start: '' }, undefined, 'T1', at)).toEqual({
      ok: false,
      errors: ['Выберите маршрут', 'Укажите дату', 'Укажите время выезда — ЧЧ:ММ'],
    })
  })

  it('правка: id и отметка «замер» остаются, убранная машина стирается', () => {
    const base = trip('T1', { carId: 'C1', note: 'ливень' })
    const result = buildTrip({ ...tripDraftOf(base), carId: '', minutes: '35' }, base, 'другой', at)
    expect(result).toEqual({
      ok: true,
      trip: { id: 'T1', updatedAt: at, routeId: 'R1', date: '2026-10-01', start: '08:00', minutes: 35, source: 'timer', note: 'ливень' },
    })
  })
})

describe('список поездок', () => {
  it('свежие сверху: дата, затем время выезда; удалённых нет', () => {
    const trips = [
      trip('T1', { date: '2026-10-01', start: '08:00' }),
      trip('T2', { date: '2026-10-02', start: '07:00' }),
      trip('T3', { date: '2026-10-01', start: '18:30' }),
      trip('T4', { deleted: true }),
    ]
    expect(sortTrips(trips).map((each) => each.id)).toEqual(['T2', 'T3', 'T1'])
  })
})
