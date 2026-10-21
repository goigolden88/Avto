/**
 * Вид места (Р-31): парковка, участок дороги, прочее. Отметки и расчёт у всех
 * видов общие, значения результата в базе прежние — `easy | hard | none`;
 * по виду меняются только подписи: кнопки результата, минуты, заголовок итога.
 *
 * Места без поля `kind` — парковки: так заведены все места до Р-31. Вид,
 * которого эта версия не знает (пришёл с более новой), тоже показывается
 * парковкой.
 *
 * Чистые функции, без React и без базы.
 */

import type { Parking, ParkingVisit } from '../../app/model.ts'

export type PlaceKind = NonNullable<Parking['kind']>
export type VisitResult = ParkingVisit['result']

/** Порядок кнопок вида в форме места. */
export const PLACE_KINDS: readonly PlaceKind[] = ['parking', 'road', 'other']

/** Как вид назван человеку. */
export const PLACE_KIND_LABELS: Record<PlaceKind, string> = {
  parking: 'парковка',
  road: 'участок дороги',
  other: 'прочее',
}

/** Вид места; нет поля, места нет или вид незнаком — парковка. */
export function kindOf(parking: Pick<Parking, 'kind'> | undefined): PlaceKind {
  const kind = parking?.kind
  return kind !== undefined && PLACE_KINDS.includes(kind) ? kind : 'parking'
}

/** Подписи отметок и итога для одного вида места. */
export type KindTexts = {
  /** кнопки результата и доли */
  results: Record<VisitResult, string>
  /** о чём кнопки результата — подпись группы и начало ошибки «не выбрано» */
  ask: string
  /** поле минут в форме отметки */
  minutesField: string
  /** минуты в строке отметки: «12 мин поиска» */
  minutes: (n: number) => string
  /** 0 минут в строке отметки */
  zero: string
  /** начало строки медианы в итоге: «Поиск: 7 мин — медиана 6 отметок» */
  median: string
  /** медиана, когда минут нет ни у одной отметки */
  noMinutes: string
  /** ошибка в минутах */
  minutesError: string
  /** пустой список отметок: «Отметить», когда … */
  when: string
}

export const KIND_TEXTS: Record<PlaceKind, KindTexts> = {
  parking: {
    results: { easy: 'сразу', hard: 'с трудом', none: 'мест нет' },
    ask: 'Как встали',
    minutesField: 'Сколько минут искали — по желанию, 0 — встали без поиска',
    minutes: (n) => `${n} мин поиска`,
    zero: 'встал без поиска',
    median: 'Поиск',
    noMinutes: 'минут поиска нет',
    minutesError: 'Минуты поиска — целое число от 0',
    when: 'когда встанете здесь',
  },
  road: {
    results: { easy: 'свободно', hard: 'плотно', none: 'стоим' },
    ask: 'Как проехали',
    minutesField: 'Минут проезда — по желанию',
    minutes: (n) => `${n} мин проезда`,
    zero: 'меньше минуты',
    median: 'Проезд',
    noMinutes: 'минут проезда нет',
    minutesError: 'Минуты проезда — целое число от 0',
    when: 'когда проедете здесь',
  },
  other: {
    results: { easy: 'легко', hard: 'с трудом', none: 'никак' },
    ask: 'Как вышло',
    minutesField: 'Минут ушло — по желанию',
    minutes: (n) => `${n} мин ушло`,
    zero: 'меньше минуты',
    median: 'Ушло',
    noMinutes: 'минут нет',
    minutesError: 'Минуты — целое число от 0',
    when: 'когда будете здесь',
  },
}

/** Подписи вида места; места нет или вид незнаком — подписи парковки. */
export function textsOf(parking: Pick<Parking, 'kind'> | undefined): KindTexts {
  return KIND_TEXTS[kindOf(parking)]
}
