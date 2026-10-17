import { useCallback, useEffect, useState } from 'react'
import { db } from '../app/core.ts'
import type { Parking, ParkingVisit, Point } from '../app/model.ts'

export type ParkingsData = {
  /** Живые точки: у какой точки место и город нового места. */
  points: Point[]
  /** Живые места. */
  parkings: Parking[]
  /** Живые отметки. */
  visits: ParkingVisit[]
}

/**
 * Точки, места и отметки — для экрана парковок. Перечитываются на любую
 * запись в эти хранилища: своей рукой или приехавшую синхронизацией. Пока
 * не прочитано — null.
 */
export function useParkings(): { data: ParkingsData | null; error: string } {
  const [data, setData] = useState<ParkingsData | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async (isCurrent: () => boolean) => {
    try {
      const [points, parkings, visits] = await Promise.all([db.getAll('points'), db.getAll('parkings'), db.getAll('parkingVisits')])
      if (isCurrent()) setData({ points, parkings, visits })
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
      if (event.store === 'points' || event.store === 'parkings' || event.store === 'parkingVisits') reload()
    })
    return () => {
      alive = false
      off()
    }
  }, [load])

  return { data, error }
}
