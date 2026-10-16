import { useCallback, useEffect, useState } from 'react'
import { db } from '../app/core.ts'
import type { Car, Entry } from '../app/model.ts'
import { readCurrency } from '../modules/prefs/prefs.ts'

export type LogData = {
  /** Живые машины, и в архиве тоже. */
  cars: Car[]
  /** Живые записи журнала. */
  entries: Entry[]
  /** Валюта из `prefs:main` (Р-17). */
  currency: string
}

/**
 * Машины, журнал и валюта — для «Главной» и «Настроек». Перечитываются на
 * любую запись в эти хранилища: своей рукой или приехавшую синхронизацией.
 * Пока не прочитано — null: «записей нет» не мигает у человека с данными.
 */
export function useLog(): { data: LogData | null; error: string } {
  const [data, setData] = useState<LogData | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async (isCurrent: () => boolean) => {
    try {
      const [cars, entries, prefs] = await Promise.all([db.getAll('cars'), db.getAll('entries'), db.getAll('prefs')])
      if (isCurrent()) setData({ cars, entries, currency: readCurrency(prefs) })
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
      if (event.store === 'cars' || event.store === 'entries' || event.store === 'prefs') reload()
    })
    return () => {
      alive = false
      off()
    }
  }, [load])

  return { data, error }
}

/** Ключ главной машины в `settings` устройства: в базу журнала и в синхронизацию не попадает (Р-21). */
const MAIN_CAR = 'mainCar'

/** Кто ещё на этой странице показывает главную: «Настройки» сменили — «Главная» знает. */
const listeners = new Set<(id: string | null) => void>()

/**
 * Главная машина этого устройства (Р-21) — как свёрнутость блоков: в
 * настройках устройства, у каждого телефона своя. Null — не выбрана.
 */
export function useMainCar(): { mainId: string | null; known: boolean; setMain: (id: string | null) => void } {
  const [mainId, setMainId] = useState<string | null>(null)
  const [known, setKnown] = useState(false)

  useEffect(() => {
    let alive = true
    db.settings
      .get<string>(MAIN_CAR)
      .then((value) => {
        if (!alive) return
        setMainId(typeof value === 'string' && value !== '' ? value : null)
        setKnown(true)
      })
      // Не прочиталось — как не выбрана: подставится машина последней записи.
      .catch(() => alive && setKnown(true))
    listeners.add(setMainId)
    return () => {
      alive = false
      listeners.delete(setMainId)
    }
  }, [])

  const setMain = useCallback((id: string | null) => {
    for (const listener of listeners) listener(id)
    void (id === null ? db.settings.remove(MAIN_CAR) : db.settings.set(MAIN_CAR, id)).catch(() => undefined)
  }, [])

  return { mainId, known, setMain }
}
