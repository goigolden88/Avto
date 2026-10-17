import { describe, expect, it } from 'vitest'
import type { Parking, Point, Route } from '../../app/model.ts'
import { buildPoint, newPointDraft, parkingsOfPoint, pointDeleteBlock, pointDraftOf, routesOfPoint, sortPoints } from './points.ts'

const at = '2026-10-17T10:00:00.000Z'

function point(id: string, fields: Partial<Point> = {}): Point {
  return { id, updatedAt: at, name: `Точка ${id}`, city: 'Москва', ...fields }
}

function route(id: string, fromId: string, toId: string, fields: Partial<Route> = {}): Route {
  return { id, updatedAt: at, fromId, toId, name: `Маршрут ${id}`, ...fields }
}

function parking(id: string, pointId?: string, fields: Partial<Parking> = {}): Parking {
  return { id, updatedAt: at, city: 'Москва', where: `Место ${id}`, ...(pointId ? { pointId } : {}), ...fields }
}

describe('точка из формы', () => {
  it('имя и город обязательны', () => {
    expect(buildPoint({ name: ' ', city: '' }, undefined, 'P1', at)).toEqual({
      ok: false,
      errors: ['Впишите имя точки', 'Впишите город'],
    })
  })

  it('пробелы по краям срезаются; правка сохраняет id', () => {
    expect(buildPoint({ name: ' Дом ', city: ' Москва ' }, undefined, 'P1', at)).toEqual({
      ok: true,
      point: { id: 'P1', updatedAt: at, name: 'Дом', city: 'Москва' },
    })
    const base = point('P1')
    expect(buildPoint({ ...pointDraftOf(base), name: 'Работа' }, base, 'другой', at)).toEqual({
      ok: true,
      point: { id: 'P1', updatedAt: at, name: 'Работа', city: 'Москва' },
    })
  })
})

describe('новая точка', () => {
  it('город — из последней заведённой точки, удалённая не в счёт', () => {
    const points = [point('P2', { city: 'Тверь' }), point('P1', { city: 'Москва' }), point('P3', { city: 'Сочи', deleted: true })]
    expect(newPointDraft(points)).toEqual({ name: '', city: 'Тверь' })
  })

  it('точек нет — город пустой', () => {
    expect(newPointDraft([])).toEqual({ name: '', city: '' })
  })

  it('по порядку заведения, без удалённых', () => {
    expect(sortPoints([point('P2'), point('P1'), point('P3', { deleted: true })]).map((each) => each.id)).toEqual(['P1', 'P2'])
  })
})

describe('удаление точки', () => {
  const routes = [route('R1', 'P1', 'P2'), route('R2', 'P2', 'P1'), route('R3', 'P1', 'P3', { deleted: true }), route('R4', 'P3', 'P4')]

  const parkings = [parking('K1', 'P1'), parking('K2', 'P4'), parking('K3', 'P4'), parking('K4', 'P5', { deleted: true }), parking('K5')]

  it('точка в маршрутах — откуда или куда — не удаляется, с числом маршрутов', () => {
    expect(routesOfPoint('P1', routes).map((each) => each.id)).toEqual(['R1', 'R2'])
    expect(pointDeleteBlock('P1', routes, [])).toBe('Сначала удалите маршруты: 2')
  })

  it('точка у мест парковки не удаляется, с числом мест', () => {
    expect(parkingsOfPoint('P4', parkings).map((each) => each.id)).toEqual(['K2', 'K3'])
    expect(pointDeleteBlock('P2', [], parkings.slice(1))).toBeNull()
    expect(pointDeleteBlock('P4', [], parkings)).toBe('Сначала уберите точку у мест: 2')
  })

  it('и в маршрутах, и у мест — фраза называет оба', () => {
    expect(pointDeleteBlock('P1', routes, parkings)).toBe('Сначала удалите маршруты: 2 и уберите точку у мест: 1')
    expect(pointDeleteBlock('P4', routes, parkings)).toBe('Сначала удалите маршруты: 1 и уберите точку у мест: 2')
  })

  it('только в удалённых маршрутах и местах или нигде — удаляется', () => {
    expect(pointDeleteBlock('P5', routes, parkings)).toBeNull()
    expect(pointDeleteBlock('P1', routes.filter((each) => each.id === 'R3'), [])).toBeNull()
  })
})
