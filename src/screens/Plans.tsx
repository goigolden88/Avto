import { useState } from 'react'
import { Link } from 'react-router-dom'
import { db } from '../app/core.ts'
import type { Car, Plan } from '../app/model.ts'
import { activeCars, defaultCarId } from '../modules/log/cars.ts'
import type { EntryDraft } from '../modules/log/entries.ts'
import {
  buildPlan,
  carLabel,
  completePlan,
  doneDraft,
  doneText,
  dueCount,
  dueLineText,
  EMPTY_HINT,
  lastReading,
  listPlans,
  newPlanDraft,
  odometerText,
  planCarOptions,
  planDraftOf,
  planState,
  STATE_LABELS,
  TERM_LABELS,
  TERMS,
  termText,
  type PlanDraft,
} from '../modules/plans/plans.ts'
import { nowIso, today } from '../shared/core/dates.ts'
import { ulid } from '../shared/core/id.ts'
import { Fold } from '../shared/ui/Fold.tsx'
import { EntryForm } from './EntryForm.tsx'
import { useLog, useMainCar, type LogData } from './useLog.ts'
import { usePlans } from './usePlans.ts'

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'Неизвестная ошибка'
}

/** Что открыто вместо списка: форма плана (`id` нет — новый) или запись «Ремонт» по «Сделано». */
type Mode = { kind: 'plan'; id: string | null; draft: PlanDraft } | { kind: 'done'; plan: Plan; draft: EntryDraft } | null

/**
 * Вкладка «Планы» (Р-28): ремонт и ТО по машине — со сроком, «с… по…»,
 * регулярные (Р-29) или без срока. Сверху — планы, у которых срок пришёл, с
 * пометкой «пора» или «просрочено»; дальше — со сроком, от ближайшего;
 * внизу — без срока. У ориентира по пробегу — последний пробег машины из
 * журнала.
 *
 * «Сделано» открывает новую запись «Ремонт» с текстом и заметкой плана;
 * сохранена — план уходит в свёрнутый блок «Сделано» с датой, у регулярного
 * рядом заводится следующий; закрыта без сохранения — план как был. Машина
 * нового плана — как в журнале (Р-21).
 */
export function Plans() {
  const log = useLog()
  const main = useMainCar()
  const { plans, error } = usePlans()
  const [mode, setMode] = useState<Mode>(null)

  function open(next: Mode) {
    setMode(next)
    window.scrollTo(0, 0)
  }

  const failed = error || log.error
  let body = null
  if (log.data && main.known && plans) {
    if (mode?.kind === 'plan') {
      body = <PlanForm mode={mode} plans={plans} cars={log.data.cars} onChange={setMode} onDone={() => setMode(null)} />
    } else if (mode?.kind === 'done') {
      const plan = mode.plan
      body = (
        <>
          <p className="muted plans__done-note">
            «{plan.what}» — запись «Ремонт» в журнал: впишите сумму. Закроете без сохранения — план останется.
          </p>
          <EntryForm
            initial={mode.draft}
            cars={log.data.cars}
            currency={log.data.currency}
            // План — из базы, а не с экрана: его могли поправить или уже сделать на другом устройстве.
            onSaved={async (entry) => db.putMany('plans', completePlan((await db.get('plans', plan.id)) ?? plan, entry, ulid(), nowIso()))}
            onDone={() => setMode(null)}
          />
        </>
      )
    } else {
      body = <Overview log={log.data} mainId={main.mainId} plans={plans} open={open} />
    }
  }

  return (
    <>
      <header className="screen-head">
        <div className="screen-head__row">
          <h1>Планы</h1>
        </div>
      </header>

      {failed && <p className="error block">База не открылась: {failed}</p>}

      <div className="plans">{body}</div>
    </>
  )
}

/** Список: несделанные по сроку, сделанные — свёрнутым блоком. */
function Overview({
  log,
  mainId,
  plans,
  open,
}: {
  log: LogData
  mainId: string | null
  plans: readonly Plan[]
  open: (mode: Mode) => void
}) {
  const { cars, entries } = log
  const day = today()
  const active = activeCars(cars)
  const list = listPlans(plans, day)

  function add() {
    const carId = defaultCarId(cars, entries, mainId)
    if (carId !== null) open({ kind: 'plan', id: null, draft: newPlanDraft(carId) })
  }

  function done(plan: Plan) {
    const fuel = cars.find((car) => car.id === plan.carId)?.fuel
    open({ kind: 'done', plan, draft: doneDraft(plan, fuel, today()) })
  }

  const edit = (plan: Plan) => open({ kind: 'plan', id: plan.id, draft: planDraftOf(plan) })

  return (
    <>
      {active.length === 0 ? (
        <section className="block home-empty">
          <p>{cars.length === 0 ? 'Сначала заведите машину.' : 'Все машины в архиве — верните машину или заведите новую.'}</p>
          <p className="muted">С машиной можно вести планы: ремонт и ТО, со сроком и без.</p>
          <div className="row">
            <Link className="btn btn--primary" to="/settings?block=cars">
              {cars.length === 0 ? 'Завести машину' : 'К машинам'}
            </Link>
          </div>
        </section>
      ) : list.open.length === 0 && list.done.length === 0 ? (
        <section className="block home-empty">
          <p>Планов пока нет.</p>
          <p className="muted">{EMPTY_HINT}</p>
          <div className="row">
            <button type="button" className="btn btn--primary" onClick={add}>
              Добавить план
            </button>
          </div>
        </section>
      ) : (
        <div className="row plans__add">
          <button type="button" className="btn btn--primary" onClick={add}>
            Добавить план
          </button>
        </div>
      )}

      {list.open.length > 0 && (
        <section className="block">
          <ul className="plain entries">
            {list.open.map((plan) => {
              const state = STATE_LABELS[planState(plan, day)]
              const odometer = odometerText(plan, lastReading(plan.carId, entries), day)
              const carFound = cars.some((car) => car.id === plan.carId && !car.deleted)
              return (
                <li key={plan.id} className="plan">
                  <button type="button" className="car plan__open" onClick={() => edit(plan)}>
                    <span className="entry__top">
                      <span className="car__name">{plan.what}</span>
                      {state && <span className="plan__state">{state}</span>}
                    </span>
                    <span className="muted">
                      {carLabel(plan.carId, cars)} · {termText(plan)}
                    </span>
                    {odometer && <span className="muted">{odometer}</span>}
                    {plan.note && <span className="muted">{plan.note}</span>}
                  </button>
                  {/* Машины нет — запись «Ремонт» некуда записать. */}
                  {carFound && (
                    <button type="button" className="btn" onClick={() => done(plan)}>
                      Сделано
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {list.done.length > 0 && (
        <Fold id="plans:done" title="Сделано" summary={String(list.done.length)} folded>
          <ul className="plain entries">
            {list.done.map((plan) => (
              <li key={plan.id}>
                <button type="button" className="car" onClick={() => edit(plan)}>
                  <span className="car__name">{plan.what}</span>
                  <span className="muted">
                    {carLabel(plan.carId, cars)} · {doneText(plan)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Fold>
      )}
    </>
  )
}

/** Строка на «Главной»: срок пришёл — сколько таких планов, со ссылкой. Нет таких — ничего. */
export function PlansLine() {
  const { plans } = usePlans()
  if (!plans) return null
  const count = dueCount(plans, today())
  if (count === 0) return null
  return (
    <section className="block panel timer-line plans-line">
      <span>{dueLineText(count)}</span>
      <Link className="link-btn" to="/plans">
        На «Планы»
      </Link>
    </section>
  )
}

/** Ошибки формы — после первого «Сохранить»: на пустой форме кричать незачем. */
function Errors({ list }: { list: readonly string[] }) {
  return list.map((each) => (
    <p key={each} className="error">
      {each}
    </p>
  ))
}

/**
 * Форма плана — нового и правки: машина, что сделать, срок одной из четырёх
 * кнопок, ориентир по пробегу и заметка. Срок с датой без неё — подставлено
 * сегодня. Удаление — после вопроса.
 */
function PlanForm({
  mode,
  plans,
  cars,
  onChange,
  onDone,
}: {
  mode: { kind: 'plan'; id: string | null; draft: PlanDraft }
  plans: readonly Plan[]
  cars: readonly Car[]
  onChange: (mode: Mode) => void
  onDone: () => void
}) {
  const [tried, setTried] = useState(false)
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState('')
  const [newId] = useState(ulid)
  const { draft } = mode
  const base = mode.id === null ? undefined : plans.find((plan) => plan.id === mode.id)
  const result = buildPlan(draft, base, newId, nowIso())

  async function run(work: () => Promise<unknown>) {
    setError('')
    try {
      await work()
      onDone()
    } catch (failure) {
      setError(describe(failure))
    }
  }

  const set = (next: Partial<PlanDraft>) => onChange({ ...mode, draft: { ...draft, ...next } })
  const field = (key: keyof PlanDraft) => (event: { target: { value: string } }) => set({ [key]: event.target.value })

  return (
    <form
      className="form entry-form"
      onSubmit={(event) => {
        event.preventDefault()
        setTried(true)
        if (result.ok) void run(() => db.put('plans', result.plan))
      }}
    >
      <h2 className="entry-form__title">{base ? 'План' : 'Новый план'}</h2>

      <label className="field">
        <span>Машина</span>
        <select name="plan-car" value={draft.carId} onChange={field('carId')}>
          {planCarOptions(cars, draft.carId).map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Что сделать</span>
        <input name="plan-what" value={draft.what} autoComplete="off" placeholder="заменить ремень ГРМ" onChange={field('what')} />
      </label>

      <div className="field">
        <span>Срок</span>
        <div className="row row--wrap" role="group" aria-label="Срок">
          {TERMS.map((term) => (
            <button
              key={term}
              type="button"
              className={term === draft.term ? 'btn btn--primary' : 'btn'}
              aria-pressed={term === draft.term}
              onClick={() => set({ term, date: term !== 'none' && draft.date === '' ? today() : draft.date })}
            >
              {TERM_LABELS[term]}
            </button>
          ))}
        </div>
      </div>

      {draft.term === 'date' && (
        <label className="field">
          <span>Дата</span>
          <input type="date" name="plan-date" value={draft.date} onChange={field('date')} />
        </label>
      )}
      {draft.term === 'range' && (
        <>
          <label className="field">
            <span>С</span>
            <input type="date" name="plan-date" value={draft.date} onChange={field('date')} />
          </label>
          <label className="field">
            <span>По</span>
            <input type="date" name="plan-until" value={draft.until} onChange={field('until')} />
          </label>
        </>
      )}
      {draft.term === 'every' && (
        <>
          <label className="field">
            <span>Первый срок</span>
            <input type="date" name="plan-date" value={draft.date} onChange={field('date')} />
          </label>
          <label className="field">
            <span>Каждые, мес.</span>
            <input name="plan-every" value={draft.every} inputMode="numeric" autoComplete="off" placeholder="6" onChange={field('every')} />
          </label>
        </>
      )}

      <label className="field">
        <span>Ориентир по пробегу, км — по желанию</span>
        <input
          name="plan-odometer"
          value={draft.odometer}
          inputMode="numeric"
          autoComplete="off"
          placeholder="120 000"
          onChange={field('odometer')}
        />
      </label>

      <label className="field">
        <span>Заметка — по желанию</span>
        <textarea name="plan-note" rows={2} value={draft.note} placeholder="совет мастера" onChange={field('note')} />
      </label>

      {tried && !result.ok && <Errors list={result.errors} />}
      {error && <p className="error">{error}</p>}

      {asking && base ? (
        <div className="panel confirm">
          <p>Удалить план «{base.what}»? Это не отменить.</p>
          <div className="row">
            <button type="button" className="btn btn--danger" onClick={() => void run(() => db.remove('plans', base.id))}>
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
