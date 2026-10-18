import { useState } from 'react'
import { db } from '../app/core.ts'
import type { Car, Entry } from '../app/model.ts'
import { activeCars, MISSING_CAR } from '../modules/log/cars.ts'
import {
  buildEntry,
  checkDraft,
  fieldLabel,
  KIND_FIELDS,
  KIND_LABELS,
  KINDS,
  TANK_FULL,
  TANK_MARKS,
  withCar,
  withKind,
  withPaid,
  type EntryDraft,
  type KindField,
} from '../modules/log/entries.ts'
import { FUEL_HINTS, MISMATCH, type FuelField } from '../modules/log/fuel.ts'
import { formatMoney, formatNumber, parseNumber } from '../modules/log/numbers.ts'
import { nowIso, today } from '../shared/core/dates.ts'
import { ulid } from '../shared/core/id.ts'

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'Неизвестная ошибка'
}

/** Текстовые поля вида — строкой ввода. */
const TEXT_FIELDS: readonly KindField[] = ['station', 'what', 'service', 'violation']

/** Строка под числами заправки: что посчитается при сохранении. */
const COMPUTED: Record<FuelField, string> = {
  liters: 'Литры посчитаются',
  price: 'Цена литра посчитается',
  amount: 'Сумма посчитается',
}

/** Поля бака стоят отдельно — после строки «посчитается». */
const isTank = (field: KindField) => field === 'tankBefore' || field === 'tankAfter'

/** Числовые — с дробной клавиатурой; запятая принимается. */
const NUMBER_FIELDS: readonly KindField[] = ['liters', 'price', 'amount', 'odometer', 'consumption']

/**
 * Форма записи журнала — новой и правки, одна и та же. Поля — по виду
 * (`KIND_FIELDS`); дата и примечание — у всех. У заправки под числами
 * видно, какое посчитается и каким, а три несходящихся числа дают
 * предупреждение — сохраняется всё равно, как введено (Р-06). Бак до и
 * после — процентами, по желанию (Р-25).
 *
 * Чего не хватает, видно после первого «Сохранить»: кричать «нет суммы»
 * на пустой форме, которую только открыли, незачем.
 */
export function EntryForm({
  initial,
  base,
  cars,
  currency,
  onSaved,
  onDone,
}: {
  initial: EntryDraft
  /** Прежняя запись при правке. Нет — новая. */
  base?: Entry
  /** Живые машины, и в архиве тоже: у правки старой записи машина могла уйти в архив. */
  cars: readonly Car[]
  currency: string
  /** Запись сохранена — до `onDone`: «Сделано» у плана ставит ему дату и ссылку на запись (Р-28). */
  onSaved?: (entry: Entry) => Promise<unknown>
  onDone: () => void
}) {
  const [draft, setDraft] = useState(initial)
  const [tried, setTried] = useState(false)
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState('')
  // Id новой записи — один на форму: повторное «Сохранить» после ошибки
  // перепишет ту же запись, а не заведёт вторую.
  const [newId] = useState(ulid)

  const check = checkDraft(draft)
  const fuelOf = (carId: string) => cars.find((car) => car.id === carId)?.fuel

  // В выборе — активные машины. Машина записи, ушедшая в архив или ещё не
  // приехавшая, остаётся в выборе: иначе правка молча пересадила бы запись.
  const options = activeCars(cars).map((car) => ({ id: car.id, name: car.name }))
  if (draft.carId !== '' && !options.some((option) => option.id === draft.carId)) {
    const car = cars.find((each) => each.id === draft.carId)
    options.push({ id: draft.carId, name: car ? `${car.name} — в архиве` : MISSING_CAR })
  }

  async function save() {
    setTried(true)
    const result = buildEntry(draft, base, newId, nowIso())
    if (!result.ok) return
    setError('')
    try {
      await db.put('entries', result.entry)
      await onSaved?.(result.entry)
      onDone()
    } catch (failure) {
      setError(describe(failure))
    }
  }

  async function remove() {
    if (!base) return
    setError('')
    try {
      await db.remove('entries', base.id)
      onDone()
    } catch (failure) {
      setError(describe(failure))
    }
  }

  const text = (field: 'station' | 'what' | 'service' | 'violation' | 'fuel' | 'note' | 'date' | 'paidDate') =>
    (event: { target: { value: string } }) => setDraft({ ...draft, [field]: event.target.value })

  function input(field: KindField) {
    const label = fieldLabel(field, draft.kind)

    if (field === 'fuel') {
      return (
        <div key={field} className="field">
          <span>{label}</span>
          <div className="row row--wrap" role="group" aria-label="Подсказки топлива">
            {FUEL_HINTS.map((hint) => (
              <button
                key={hint}
                type="button"
                className={hint === draft.fuel.trim() ? 'btn btn--primary' : 'btn'}
                aria-pressed={hint === draft.fuel.trim()}
                onClick={() => setDraft({ ...draft, fuel: hint })}
              >
                {hint}
              </button>
            ))}
          </div>
          <input name="fuel" value={draft.fuel} autoComplete="off" placeholder="или своё: 98" onChange={text('fuel')} />
        </div>
      )
    }

    // Бак — процентом в поле или кнопкой «¼ ½ ¾ полный» (Р-25).
    if (field === 'tankBefore' || field === 'tankAfter') {
      const percent = parseNumber(draft[field])
      return (
        <div key={field} className="field">
          <span>{label}, %</span>
          <div className="row row--wrap" role="group" aria-label={`${label} — быстро`}>
            {TANK_MARKS.map((mark) => (
              <button
                key={mark.label}
                type="button"
                className={percent === mark.percent ? 'btn btn--primary' : 'btn'}
                aria-pressed={percent === mark.percent}
                onClick={() => setDraft({ ...draft, [field]: String(mark.percent) })}
              >
                {mark.label}
              </button>
            ))}
          </div>
          <input
            name={field}
            value={draft[field]}
            inputMode="decimal"
            autoComplete="off"
            aria-label={`${label}, %`}
            placeholder={`от 0 до ${TANK_FULL}`}
            onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
          />
        </div>
      )
    }

    if (field === 'paid') {
      return (
        <label key={field} className="check">
          <input
            type="checkbox"
            name="paid"
            checked={draft.paid}
            onChange={(event) => setDraft(withPaid(draft, event.target.checked, today()))}
          />
          <span>{label}</span>
        </label>
      )
    }

    if (field === 'paidDate') {
      if (!draft.paid) return null
      return (
        <label key={field} className="field">
          <span>{label}</span>
          <input type="date" name="paidDate" value={draft.paidDate} onChange={text('paidDate')} />
        </label>
      )
    }

    if (NUMBER_FIELDS.includes(field)) {
      const key = field as 'liters' | 'price' | 'amount' | 'odometer' | 'consumption'
      const computed = check.computed?.field === key ? check.computed : null
      return (
        <label key={field} className="field">
          <span>{key === 'amount' || key === 'price' ? `${label}, ${currency}` : label}</span>
          <input
            name={key}
            value={draft[key]}
            inputMode="decimal"
            autoComplete="off"
            placeholder={computed ? `посчитается: ${formatNumber(computed.value)}` : undefined}
            onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
          />
        </label>
      )
    }

    if (TEXT_FIELDS.includes(field)) {
      const key = field as 'station' | 'what' | 'service' | 'violation'
      return (
        <label key={field} className="field">
          <span>{label}</span>
          <input name={key} value={draft[key]} autoComplete="off" onChange={text(key)} />
        </label>
      )
    }

    return null
  }

  const computed = check.computed
  const fields = KIND_FIELDS[draft.kind]

  return (
    <form
      className="form entry-form"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <h2 className="entry-form__title">{base ? 'Запись' : 'Новая запись'}</h2>

      <div className="row row--wrap kinds" role="group" aria-label="Вид записи">
        {KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            className={kind === draft.kind ? 'btn btn--primary' : 'btn'}
            aria-pressed={kind === draft.kind}
            onClick={() => setDraft(withKind(draft, kind, fuelOf(draft.carId)))}
          >
            {KIND_LABELS[kind]}
          </button>
        ))}
      </div>

      <label className="field">
        <span>Машина</span>
        <select
          name="car"
          value={draft.carId}
          onChange={(event) =>
            setDraft(withCar(draft, event.target.value, fuelOf(draft.carId), fuelOf(event.target.value)))
          }
        >
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Дата</span>
        <input type="date" name="date" value={draft.date} onChange={text('date')} />
      </label>

      {fields.filter((field) => !isTank(field)).map(input)}

      {draft.kind === 'fuel' && computed && (
        <p className="muted computed">
          {COMPUTED[computed.field]}:{' '}
          {computed.field === 'liters' ? `${formatNumber(computed.value)} л` : formatMoney(computed.value, currency)}
        </p>
      )}

      {draft.kind === 'fuel' && check.expectedAmount !== null && (
        <p className="warning">
          Литры × цена = {formatMoney(check.expectedAmount, currency)}, а сумма введена другая — расходится больше чем
          на {formatNumber(MISMATCH * 100)}&nbsp;%. Сохранится, как введено; чтобы сумма посчиталась сама, очистите её.
        </p>
      )}

      {/* Бак — после чисел и строки «посчитается»: она про литры, цену и сумму. */}
      {fields.filter(isTank).map(input)}

      <label className="field">
        <span>Примечание</span>
        <textarea name="note" rows={2} value={draft.note} onChange={text('note')} />
      </label>

      {tried &&
        check.errors.map((each) => (
          <p key={each} className="error">
            {each}
          </p>
        ))}
      {error && <p className="error">{error}</p>}

      {asking ? (
        <div className="panel confirm">
          <p>Удалить запись? Это не отменить.</p>
          <div className="row">
            <button type="button" className="btn btn--danger" onClick={() => void remove()}>
              Удалить
            </button>
            <button type="button" className="btn" onClick={() => setAsking(false)}>
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <div className="form__actions row--wrap">
          {base && (
            <button type="button" className="btn btn--danger" onClick={() => setAsking(true)}>
              Удалить
            </button>
          )}
          <button type="button" className="btn" onClick={onDone}>
            Отмена
          </button>
          <button type="submit" className="btn btn--primary">
            Сохранить
          </button>
        </div>
      )}
    </form>
  )
}
