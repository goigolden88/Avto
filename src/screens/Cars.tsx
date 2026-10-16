import { useEffect, useRef, useState } from 'react'
import { db } from '../app/core.ts'
import type { Car } from '../app/model.ts'
import {
  activeCars,
  buildCar,
  canChooseMain,
  carDraftOf,
  deletionOf,
  EMPTY_CAR,
  entriesOf,
  sortCars,
  type CarDraft,
} from '../modules/log/cars.ts'
import { entriesCount } from '../modules/log/filter.ts'
import { FUEL_HINTS } from '../modules/log/fuel.ts'
import { formatNumber } from '../modules/log/numbers.ts'
import { ulid } from '../shared/core/id.ts'
import { nowIso, plural } from '../shared/core/dates.ts'
import { Fold } from '../shared/ui/Fold.tsx'
import { useLog, useMainCar } from './useLog.ts'

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'Неизвестная ошибка'
}

/** Госномер, топливо и бак — строкой под названием. */
function carLine(car: Car): string {
  const parts: string[] = []
  if (car.plate) parts.push(car.plate)
  if (car.fuel) parts.push(car.fuel)
  if (car.tank !== undefined) parts.push(`бак ${formatNumber(car.tank)} л`)
  return parts.join(' · ')
}

/** Что открыто в блоке: форма машины (новой — `id` null) или подтверждение удаления. */
type Mode = { kind: 'edit'; id: string | null; draft: CarDraft; errors: string[] } | { kind: 'delete'; id: string } | null

/**
 * «Настройки» → «Машины» (Р-04): завести, поправить, убрать в архив,
 * вернуть, удалить. Удаление машины с записями — метками на машине и на
 * каждой записи, чтобы оно доехало до других устройств; подтверждение
 * называет, сколько записей уйдёт, и предлагает архив.
 *
 * Главная машина (Р-21) — здесь же, когда активных машин две и больше;
 * она своя на каждом устройстве.
 *
 * `reveal` — пришли с «Главной» по «Завести машину»: блок разворачивается
 * и встаёт на экран.
 */
export function CarsSettings({ reveal }: { reveal: boolean }) {
  const { data, error: loadError } = useLog()
  const main = useMainCar()
  const [mode, setMode] = useState<Mode>(null)
  const [error, setError] = useState('')
  const top = useRef<HTMLDivElement>(null)

  const loaded = data !== null
  useEffect(() => {
    if (reveal && loaded) top.current?.scrollIntoView({ block: 'start' })
  }, [reveal, loaded])

  const cars = data ? sortCars(data.cars) : []
  const active = data ? activeCars(data.cars) : []
  const archived = cars.length - active.length
  const summary = data === null ? undefined : archived > 0 ? `${active.length} · ${archived} в архиве` : String(active.length)

  async function run(work: () => Promise<unknown>) {
    setError('')
    try {
      await work()
      setMode(null)
    } catch (failure) {
      setError(describe(failure))
    }
  }

  function save(id: string | null, draft: CarDraft) {
    const base = id === null ? undefined : cars.find((car) => car.id === id)
    const result = buildCar(draft, base, ulid(), nowIso())
    if (!result.ok) {
      setMode({ kind: 'edit', id, draft, errors: result.errors })
      return
    }
    void run(() => db.put('cars', result.car))
  }

  function setArchived(car: Car, value: boolean) {
    const { archived: _archived, ...rest } = car
    void run(() => db.put('cars', value ? { ...rest, archived: true } : rest))
  }

  function remove(car: Car) {
    void run(async () => {
      // Записи — из базы, а не с экрана: могли приехать синхронизацией только что.
      const marked = deletionOf(car, await db.getByIndex('entries', 'carId', car.id))
      await db.putMany('entries', marked.entries)
      await db.put('cars', marked.car)
    })
  }

  return (
    <Fold id="settings:cars" title="Машины" summary={summary} folded reveal={reveal}>
      <div ref={top} />
      {loadError && <p className="error">База не открылась: {loadError}</p>}
      {data && (
        <>
          {cars.length === 0 && <p className="muted">Машин пока нет. Заведите первую — с неё начнётся журнал.</p>}

          <ul className="plain">
            {cars.map((car) => {
              if (mode?.kind === 'edit' && mode.id === car.id) {
                return (
                  <li key={car.id}>
                    <CarForm
                      mode={mode}
                      car={car}
                      onChange={(draft) => setMode({ ...mode, draft })}
                      onSave={() => save(car.id, mode.draft)}
                      onCancel={() => setMode(null)}
                      onArchive={() => setArchived(car, !car.archived)}
                      onDelete={() => setMode({ kind: 'delete', id: car.id })}
                    />
                  </li>
                )
              }
              if (mode?.kind === 'delete' && mode.id === car.id) {
                const count = entriesOf(car.id, data.entries).length
                return (
                  <li key={car.id} className="panel confirm">
                    {count === 0 ? (
                      <p>Удалить «{car.name}»?</p>
                    ) : (
                      <>
                        <p>
                          Вместе с «{car.name}» {plural(count, ['удалится', 'удалятся', 'удалятся'])}{' '}
                          {entriesCount(count)} журнала — и на других устройствах после
                          синхронизации. Это не отменить.
                        </p>
                        {!car.archived && (
                          <p className="muted">Если машина продана — уберите её в архив: записи останутся в журнале.</p>
                        )}
                      </>
                    )}
                    <div className="row row--wrap">
                      <button type="button" className="btn btn--danger" onClick={() => remove(car)}>
                        {count === 0 ? 'Удалить' : 'Удалить с записями'}
                      </button>
                      {count > 0 && !car.archived && (
                        <button type="button" className="btn" onClick={() => setArchived(car, true)}>
                          В архив
                        </button>
                      )}
                      <button type="button" className="btn" onClick={() => setMode(null)}>
                        Отмена
                      </button>
                    </div>
                  </li>
                )
              }
              return (
                <li key={car.id}>
                  <button
                    type="button"
                    className="car"
                    onClick={() => setMode({ kind: 'edit', id: car.id, draft: carDraftOf(car), errors: [] })}
                  >
                    <span className="car__name">
                      {car.name}
                      {car.archived && <span className="muted"> · в архиве</span>}
                    </span>
                    {carLine(car) && <span className="muted">{carLine(car)}</span>}
                  </button>
                </li>
              )
            })}
          </ul>

          {mode?.kind === 'edit' && mode.id === null ? (
            <CarForm
              mode={mode}
              onChange={(draft) => setMode({ ...mode, draft })}
              onSave={() => save(null, mode.draft)}
              onCancel={() => setMode(null)}
            />
          ) : (
            <div className="row">
              <button
                type="button"
                className="btn"
                onClick={() => setMode({ kind: 'edit', id: null, draft: EMPTY_CAR, errors: [] })}
              >
                Добавить машину
              </button>
            </div>
          )}

          {canChooseMain(data.cars) && (
            <label className="field main-car">
              <span>Главная на этом устройстве — подставляется в новую запись</span>
              <select
                name="main-car"
                value={main.mainId !== null && active.some((car) => car.id === main.mainId) ? main.mainId : ''}
                onChange={(event) => main.setMain(event.target.value === '' ? null : event.target.value)}
              >
                <option value="">не выбрана — машина последней записи</option>
                {active.map((car) => (
                  <option key={car.id} value={car.id}>
                    {car.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      )}
      {error && <p className="error">{error}</p>}
    </Fold>
  )
}

/** Форма машины: название обязательно, остальное — по желанию. */
function CarForm({
  mode,
  car,
  onChange,
  onSave,
  onCancel,
  onArchive,
  onDelete,
}: {
  mode: { draft: CarDraft; errors: string[] }
  car?: Car
  onChange: (draft: CarDraft) => void
  onSave: () => void
  onCancel: () => void
  onArchive?: () => void
  onDelete?: () => void
}) {
  const { draft, errors } = mode
  const field = (key: keyof CarDraft) => (event: { target: { value: string } }) =>
    onChange({ ...draft, [key]: event.target.value })

  return (
    <form
      className="form"
      onSubmit={(event) => {
        event.preventDefault()
        onSave()
      }}
    >
      <label className="field">
        <span>Название</span>
        <input name="car-name" value={draft.name} autoComplete="off" placeholder="Солярис" onChange={field('name')} />
      </label>
      <label className="field">
        <span>Госномер — по желанию</span>
        <input name="car-plate" value={draft.plate} autoComplete="off" onChange={field('plate')} />
      </label>
      <div className="field">
        <span>Топливо — по желанию</span>
        <div className="row row--wrap" role="group" aria-label="Подсказки топлива машины">
          {FUEL_HINTS.map((hint) => (
            <button
              key={hint}
              type="button"
              className={hint === draft.fuel.trim() ? 'btn btn--primary' : 'btn'}
              aria-pressed={hint === draft.fuel.trim()}
              onClick={() => onChange({ ...draft, fuel: hint === draft.fuel.trim() ? '' : hint })}
            >
              {hint}
            </button>
          ))}
        </div>
        <input name="car-fuel" value={draft.fuel} autoComplete="off" placeholder="или своё: 98" onChange={field('fuel')} />
      </div>
      <label className="field">
        <span>Объём бака, л — по желанию</span>
        <input name="car-tank" value={draft.tank} inputMode="decimal" autoComplete="off" onChange={field('tank')} />
      </label>

      {errors.map((each) => (
        <p key={each} className="error">
          {each}
        </p>
      ))}

      <div className="form__actions row--wrap">
        {car && onDelete && (
          <button type="button" className="btn btn--danger" onClick={onDelete}>
            Удалить
          </button>
        )}
        {car && onArchive && (
          <button type="button" className="btn" onClick={onArchive}>
            {car.archived ? 'Вернуть из архива' : 'В архив'}
          </button>
        )}
        <button type="button" className="btn" onClick={onCancel}>
          Отмена
        </button>
        <button type="submit" className="btn btn--primary">
          Сохранить
        </button>
      </div>
    </form>
  )
}
