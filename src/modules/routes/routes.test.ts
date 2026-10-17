import { describe, expect, it } from 'vitest'
import type { Point, Route, Trip } from '../../app/model.ts'
import {
  buildRoute,
  newRouteDraft,
  pairsOf,
  pairTitle,
  pointNames,
  routeAlive,
  routeDeletion,
  routeDraftOf,
  routeTitle,
  SAME_POINT,
  tripsOf,
} from './routes.ts'

const at = '2026-10-17T10:00:00.000Z'

function point(id: string, name: string, fields: Partial<Point> = {}): Point {
  return { id, updatedAt: at, name, city: 'Москва', ...fields }
}

function route(id: string, fromId: string, toId: string, fields: Partial<Route> = {}): Route {
  return { id, updatedAt: at, fromId, toId, name: `Маршрут ${id}`, ...fields }
}

function trip(id: string, routeId: string, fields: Partial<Trip> = {}): Trip {
  return { id, updatedAt: at, routeId, date: '2026-10-01', start: '08:00', minutes: 30, source: 'timer', ...fields }
}

const points = [point('P1', 'Дом'), point('P2', 'Работа'), point('P3', 'ТЦ Мега')]

describe('маршрут из формы', () => {
  it('откуда, куда и имя обязательны', () => {
    expect(buildRoute(newRouteDraft(), undefined, 'R1', at)).toEqual({
      ok: false,
      errors: ['Выберите, откуда', 'Выберите, куда', 'Впишите имя маршрута'],
    })
  })

  it('одна точка в «откуда» и «куда» — нельзя, понятной фразой', () => {
    expect(buildRoute({ ...newRouteDraft('P1', 'P1'), name: 'по кругу' }, undefined, 'R1', at)).toEqual({
      ok: false,
      errors: [SAME_POINT],
    })
  })

  it('ссылка и заметка — по желанию; ссылка не проверяется', () => {
    expect(buildRoute({ ...newRouteDraft('P1', 'P2'), name: ' по МКАД ' }, undefined, 'R1', at)).toEqual({
      ok: true,
      route: { id: 'R1', updatedAt: at, fromId: 'P1', toId: 'P2', name: 'по МКАД' },
    })
    expect(
      buildRoute({ ...newRouteDraft('P1', 'P2'), name: 'по МКАД', link: 'не адрес', note: 'платный участок' }, undefined, 'R1', at),
    ).toMatchObject({ ok: true, route: { link: 'не адрес', note: 'платный участок' } })
  })

  it('правка: id остаётся, очищенная ссылка стирается', () => {
    const base = route('R1', 'P1', 'P2', { link: 'https://yandex.ru/maps', note: 'платный' })
    const result = buildRoute({ ...routeDraftOf(base), link: '', name: 'через центр' }, base, 'другой', at)
    expect(result).toEqual({
      ok: true,
      route: { id: 'R1', updatedAt: at, fromId: 'P1', toId: 'P2', name: 'через центр', note: 'платный' },
    })
  })
})

describe('пары точек', () => {
  it('«Дом → Работа» и «Работа → Дом» — разные пары; удалённые маршруты не в счёт', () => {
    const routes = [
      route('R2', 'P1', 'P2'),
      route('R1', 'P1', 'P2'),
      route('R3', 'P2', 'P1'),
      route('R4', 'P1', 'P3', { deleted: true }),
    ]
    const pairs = pairsOf(routes, points)
    expect(pairs.map((pair) => [pair.title, pair.routes.map((each) => each.id)])).toEqual([
      ['Дом → Работа', ['R1', 'R2']],
      ['Работа → Дом', ['R3']],
    ])
  })

  it('нет точки — «точка не найдена» вместо имени', () => {
    expect(pairTitle('P1', 'P9', pointNames(points))).toBe('Дом → точка не найдена')
    expect(routeTitle(route('R1', 'P1', 'P2', { name: 'по МКАД' }), pointNames(points))).toBe('Дом → Работа · по МКАД')
  })

  it('удалённая точка — тоже не найдена', () => {
    expect(pairTitle('P1', 'P2', pointNames([point('P1', 'Дом'), point('P2', 'Работа', { deleted: true })]))).toBe(
      'Дом → точка не найдена',
    )
  })
})

describe('маршрут замера жив', () => {
  it('маршрут и обе точки на месте', () => {
    expect(routeAlive('R1', [route('R1', 'P1', 'P2')], points)?.id).toBe('R1')
  })

  it('маршрут удалён, не найден или точки нет — замер только выбросить', () => {
    expect(routeAlive('R1', [route('R1', 'P1', 'P2', { deleted: true })], points)).toBeNull()
    expect(routeAlive('R1', [], points)).toBeNull()
    expect(routeAlive('R1', [route('R1', 'P1', 'P9')], points)).toBeNull()
  })
})

describe('удаление маршрута с поездками', () => {
  it('метка на маршруте и на каждой его живой поездке', () => {
    const target = route('R1', 'P1', 'P2')
    const trips = [trip('T1', 'R1'), trip('T2', 'R2'), trip('T3', 'R1'), trip('T4', 'R1', { deleted: true })]
    expect(tripsOf('R1', trips).map((each) => each.id)).toEqual(['T1', 'T3'])
    const result = routeDeletion(target, trips)
    expect(result.route).toEqual({ ...target, deleted: true })
    expect(result.trips.map((each) => [each.id, each.deleted])).toEqual([
      ['T1', true],
      ['T3', true],
    ])
  })
})
