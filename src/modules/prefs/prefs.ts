/**
 * Общие настройки — одна запись `prefs:main` на все устройства (Р-17).
 *
 * Пока в ней одна валюта. Записи может не быть — до первой правки валюта
 * «₽»: умолчание живёт здесь, а не в базе, и записи ради него не заводится.
 * Правят запись все устройства, побеждает поздняя правка — как у любой
 * записи семьи.
 *
 * Чистые функции, без React и без базы.
 */

import type { Prefs } from '../../app/model.ts'

/** id единственной записи общих настроек (02-Архитектура, «Общие настройки»). */
export const PREFS_ID = 'prefs:main'

/** Валюта до первой правки (Р-17). */
export const DEFAULT_CURRENCY = '₽'

/** Подсказки в «Настройках»; валюта — свободная строка, этим списком не ограничена. */
export const CURRENCY_HINTS: readonly string[] = ['₽', '€', '$', 'zł']

/** Длиннее — уже не знак валюты, а опечатка или вставленный текст. */
export const CURRENCY_MAX = 8

/**
 * Валюта по записям хранилища `prefs`. Записи нет, она удалена или валюта
 * в ней пустая — умолчание: испорченная настройка не должна оставить суммы
 * без единицы.
 */
export function readCurrency(records: readonly Prefs[]): string {
  const record = records.find((each) => each.id === PREFS_ID && !each.deleted)
  const stored = typeof record?.currency === 'string' ? record.currency.trim() : ''
  return stored || DEFAULT_CURRENCY
}

/**
 * Запись с новой валютой — или null, если сохранять нечего: строка пустая,
 * слишком длинная или та же, что уже стоит.
 *
 * Остальные поля прежней записи сохраняются: настройки прибавятся, и правка
 * валюты не должна стирать соседние.
 */
export function withCurrency(records: readonly Prefs[], input: string, at: string): Prefs | null {
  const currency = input.trim()
  if (!currency || currency.length > CURRENCY_MAX) return null
  if (currency === readCurrency(records)) return null
  const record = records.find((each) => each.id === PREFS_ID && !each.deleted)
  return { ...record, id: PREFS_ID, updatedAt: at, currency }
}
