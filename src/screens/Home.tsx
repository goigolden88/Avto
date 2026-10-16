import { Link } from 'react-router-dom'
import { config } from '../app/config.ts'
import { CHANGES } from '../changes.ts'
import { IosNote } from '../shared/ui/Install.tsx'
import { syncDot } from '../shared/ui/syncDot.ts'
import { useSyncStatus } from '../shared/ui/useSync.ts'
import { useFirstRun } from '../shared/screens/useFirstRun.ts'
import { useWhatsNew } from '../shared/screens/useWhatsNew.ts'
import { WhatsNew } from '../shared/screens/WhatsNew.tsx'

/**
 * Главный экран. В скелете — шапка с шестерёнкой, «Что нового» после
 * обновления и строка о том, что записей пока нет: машины и журнал
 * приходят следующими задачами Авто-3.
 *
 * Пуста ли база — по всем хранилищам: запись может приехать синхронизацией
 * с другого устройства раньше, чем здесь появится журнал, и тогда «записей
 * нет» было бы неправдой.
 */
export function Home() {
  const mark = syncDot(useSyncStatus())
  const first = useFirstRun(config.stores)
  const news = useWhatsNew(first, CHANGES)

  return (
    <>
      <header className="screen-head">
        <div className="screen-head__row">
          <h1>{config.name}</h1>
          <div className="screen-head__tools">
            <Link className="gear" to="/settings" aria-label="Настройки">
              <span aria-hidden="true">⚙</span>
              {/* Синхронизация живёт в фоне: точка зовёт в «Настройки». */}
              {mark && <span className={mark} aria-hidden="true" />}
            </Link>
          </div>
        </div>
      </header>

      {/* После обновления — что поменялось. Свежей установке — ничего. */}
      {news.show.length > 0 && <WhatsNew changes={news.show} onDone={news.dismiss} />}

      {/* iPhone во вкладке Safari: у установленного своё хранилище. */}
      {first.iosNote && (
        <section className="stub block">
          <IosNote empty={first.iosNote === 'before'} />
          <button type="button" className="link-btn" onClick={first.hideIosNote}>
            Скрыть
          </button>
        </section>
      )}

      {/* Пока база не посчитана — ничего: мигнуть «записей нет» у человека
          с данными хуже, чем опоздать на миг. */}
      {first.counted && (
        <section className="block home-empty">
          {first.empty ? (
            <>
              <p>Записей пока нет.</p>
              <p className="muted">Первые появятся с журналом — заправки, мойки, ремонты и штрафы придут следующими обновлениями.</p>
            </>
          ) : (
            <>
              <p>Записи в базе есть.</p>
              <p className="muted">Показывать их начнёт журнал — он придёт следующими обновлениями.</p>
            </>
          )}
        </section>
      )}
    </>
  )
}
