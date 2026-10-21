import { useCallback, useEffect, useState } from 'react'
import { db } from '../app/core.ts'
import type { Parking, Point, Route, Trip } from '../app/model.ts'
import { readTimer, TIMER_KEY, type Timer } from '../modules/routes/timer.ts'

export type RoutesData = {
  /** Живые точки. */
  points: Point[]
  /** Живые маршруты. */
  routes: Route[]
  /** Живые поездки. */
  trips: Trip[]
  /** Живые места любого вида: точку, которая стоит у места, не удалить. */
  parkings: Parking[]
}

/**
 * Точки, маршруты, поездки и места — для вкладки «Маршруты»
 * и строки о замере на «Главной». Перечитываются на любую запись в эти
 * хранилища: своей рукой или приехавшую синхронизацией. Пока не прочитано — null.
 */
export function useRoutes(): { data: RoutesData | null; error: string } {
  const [data, setData] = useState<RoutesData | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async (isCurrent: () => boolean) => {
    try {
      const [points, routes, trips, parkings] = await Promise.all([
        db.getAll('points'),
        db.getAll('routes'),
        db.getAll('trips'),
        db.getAll('parkings'),
      ])
      if (isCurrent()) setData({ points, routes, trips, parkings })
    } catch (failure) {
      if (isCurrent()) setError(failure instanceof Error ? failure.message : 'База не открылась')
    }
  }, [])

  useEffect(() => {
    let alive = true
    // Чтения могут закончиться не по порядку: показывается только последнее.
    let seq = 0
    const reload = () => {
      const mine = ++seq
      void load(() => alive && mine === seq)
    }
    reload()
    const off = db.onChange((event) => {
      if (event.store === 'points' || event.store === 'routes' || event.store === 'trips' || event.store === 'parkings') reload()
    })
    return () => {
      alive = false
      off()
    }
  }, [load])

  return { data, error }
}

/** Кто ещё на этой странице показывает замер: карточка на «Маршрутах» и строка на «Главной». */
const listeners = new Set<(timer: Timer | null) => void>()

/**
 * Идущий замер этого устройства (Р-13) — как главная машина (Р-21): в
 * настройках устройства, в базу записей и в синхронизацию не попадает.
 * Переживает закрытие приложения и перезагрузку страницы.
 */
export function useTimer(): {
  timer: Timer | null
  known: boolean
  start: (routeId: string) => void
  stop: () => void
} {
  const [timer, setTimer] = useState<Timer | null>(null)
  const [known, setKnown] = useState(false)

  useEffect(() => {
    let alive = true
    db.settings
      .get<unknown>(TIMER_KEY)
      .then((value) => {
        if (!alive) return
        setTimer(readTimer(value))
        setKnown(true)
      })
      // Не прочиталось — как нет замера.
      .catch(() => alive && setKnown(true))
    listeners.add(setTimer)
    return () => {
      alive = false
      listeners.delete(setTimer)
    }
  }, [])

  const save = useCallback((next: Timer | null) => {
    for (const listener of listeners) listener(next)
    void (next === null ? db.settings.remove(TIMER_KEY) : db.settings.set(TIMER_KEY, next)).catch(() => undefined)
  }, [])

  const start = useCallback((routeId: string) => save({ routeId, startedAt: Date.now() }), [save])
  const stop = useCallback(() => save(null), [save])

  return { timer, known, start, stop }
}

/** Сейчас, мс, — обновляется раз в `every` мс, пока `on`: минуты замера идут сами. */
export function useNow(on: boolean, every = 15_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), every)
    return () => window.clearInterval(id)
  }, [on, every])
  return now
}
