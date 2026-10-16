/**
 * Отбор журнала: по машине, виду и периоду — месяц, год, всё время.
 *
 * Месяц и год сначала текущие, стрелками — назад и вперёд. Запись с
 * испорченной датой в месяц и год не попадает, а во «всё» — попадает:
 * потерять её из виду хуже, чем показать странно.
 *
 * Чистые функции, без React и без базы.
 */

import type { Entry, EntryKind } from '../../app/model.ts'
import {
  addMonths,
  formatMonth,
  inPeriod,
  monthOf,
  monthPeriod,
  plural,
  yearPeriod,
  type DateStr,
  type MonthStr,
  type Period,
} from '../../shared/core/dates.ts'

export type PeriodKind = 'month' | 'year' | 'all'

export type PeriodChoice = { kind: 'month'; month: MonthStr } | { kind: 'year'; year: number } | { kind: 'all' }

export const PERIOD_LABELS: Record<PeriodKind, string> = { month: 'Месяц', year: 'Год', all: 'Всё' }

export const PERIOD_KINDS: readonly PeriodKind[] = ['month', 'year', 'all']

export type LogFilter = {
  /** null — все машины */
  carId: string | null
  /** null — все виды */
  kind: EntryKind | null
  period: PeriodChoice
}

/** Отбор при открытии: всё — только что сохранённая запись видна при любой дате. */
export const ALL: LogFilter = { carId: null, kind: null, period: { kind: 'all' } }

/** Период выбранного вида, текущий на день `day`. */
export function currentPeriod(kind: PeriodKind, day: DateStr): PeriodChoice {
  switch (kind) {
    case 'month':
      return { kind: 'month', month: monthOf(day) }
    case 'year':
      return { kind: 'year', year: Number(day.slice(0, 4)) }
    case 'all':
      return { kind: 'all' }
  }
}

/** Стрелка: месяц или год назад (−1) и вперёд (+1). «Всё» не сдвигается. */
export function shiftPeriod(period: PeriodChoice, step: number): PeriodChoice {
  switch (period.kind) {
    case 'month':
      return { kind: 'month', month: addMonths(period.month, step) }
    case 'year':
      return { kind: 'year', year: period.year + step }
    case 'all':
      return period
  }
}

function rangeOf(period: PeriodChoice): Period | null {
  switch (period.kind) {
    case 'month':
      return monthPeriod(period.month)
    case 'year':
      return yearPeriod(period.year)
    case 'all':
      return null
  }
}

/** `октябрь 2026`, `2026`, `всё время`. */
export function periodTitle(period: PeriodChoice): string {
  switch (period.kind) {
    case 'month':
      return formatMonth(period.month)
    case 'year':
      return String(period.year)
    case 'all':
      return 'всё время'
  }
}

/** Живые записи, подходящие под отбор. Порядок — как пришли. */
export function filterEntries(entries: readonly Entry[], filter: LogFilter): Entry[] {
  const range = rangeOf(filter.period)
  return entries.filter(
    (entry) =>
      !entry.deleted &&
      (filter.carId === null || entry.carId === filter.carId) &&
      (filter.kind === null || entry.kind === filter.kind) &&
      (range === null || inPeriod(entry.date, range)),
  )
}

/** Отбор что-то отсекает — выбрана машина, вид или период. */
export function isFiltered(filter: LogFilter): boolean {
  return filter.carId !== null || filter.kind !== null || filter.period.kind !== 'all'
}

/** `1 запись`, `3 записи`, `12 записей`. */
export function entriesCount(count: number): string {
  return `${count} ${plural(count, ['запись', 'записи', 'записей'])}`
}

/** Сколько показано рядом с отбором: `12 записей` или `показано 3 из 12`. */
export function shownText(shown: number, total: number): string {
  return shown === total ? entriesCount(total) : `показано ${shown} из ${total}`
}
