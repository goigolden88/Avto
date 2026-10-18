import { useCallback, useEffect, useState } from 'react'
import { db } from '../app/core.ts'
import type { Plan } from '../app/model.ts'

/**
 * Живые планы (Р-28) — для «Планов» и строки на «Главной». Перечитываются на
 * любую запись в хранилище планов: своей рукой или приехавшую
 * синхронизацией. Пока не прочитано — null.
 */
export function usePlans(): { plans: Plan[] | null; error: string } {
  const [plans, setPlans] = useState<Plan[] | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async (isCurrent: () => boolean) => {
    try {
      const all = await db.getAll('plans')
      if (isCurrent()) setPlans(all)
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
      if (event.store === 'plans') reload()
    })
    return () => {
      alive = false
      off()
    }
  }, [load])

  return { plans, error }
}
