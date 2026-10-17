import { describe, expect, it } from 'vitest'
import { readTimer, TIMER_LIMIT_TEXT, timerMinutes, timerOverdue, timerStart, tripFromTimer, type Timer } from './timer.ts'

const MINUTE = 60_000
/** 17.10.2026 08:05 по местному времени. */
const started = new Date(2026, 9, 17, 8, 5, 30).getTime()
const timer: Timer = { routeId: 'R1', startedAt: started }

describe('замер', () => {
  it('из настроек — только своего вида', () => {
    expect(readTimer(timer)).toEqual(timer)
    for (const bad of [undefined, null, 'R1', { routeId: 'R1' }, { routeId: '', startedAt: 1 }, { routeId: 'R1', startedAt: '1' }]) {
      expect(readTimer(bad)).toBeNull()
    }
  })

  it('минуты — округлённые до целых, не меньше одной', () => {
    expect(timerMinutes(timer, started)).toBe(1)
    expect(timerMinutes(timer, started + 20 * 1000)).toBe(1)
    expect(timerMinutes(timer, started + 37.4 * MINUTE)).toBe(37)
    expect(timerMinutes(timer, started + 37.6 * MINUTE)).toBe(38)
    // Часы устройства перевели назад — всё равно минута, а не минус.
    expect(timerMinutes(timer, started - 5 * MINUTE)).toBe(1)
  })

  it('дольше 12 часов — «забыл нажать», ровно 12 — ещё нет', () => {
    expect(TIMER_LIMIT_TEXT).toBe('12 часов')
    expect(timerOverdue(timer, started + 12 * 60 * MINUTE)).toBe(false)
    expect(timerOverdue(timer, started + 12 * 60 * MINUTE + 1)).toBe(true)
  })

  it('дата и время выезда — с «Поехал», по местному времени', () => {
    expect(timerStart(timer)).toEqual({ date: '2026-10-17', start: '08:05' })
  })

  it('поездка из замера — с отметкой «замер»; без машины поля нет', () => {
    expect(tripFromTimer(timer, 38, 'C1', 'T1', 'now')).toEqual({
      id: 'T1',
      updatedAt: 'now',
      routeId: 'R1',
      date: '2026-10-17',
      start: '08:05',
      minutes: 38,
      source: 'timer',
      carId: 'C1',
    })
    expect('carId' in tripFromTimer(timer, 38, null, 'T1', 'now')).toBe(false)
  })
})
