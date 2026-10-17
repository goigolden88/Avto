import { Link } from 'react-router-dom'
import { config } from '../app/config.ts'
import { RECORD_STORES } from '../app/model.ts'
import { CHANGES } from '../changes.ts'
import { DemoOffer } from '../shared/ui/Demo.tsx'
import { IosNote } from '../shared/ui/Install.tsx'
import { syncDot } from '../shared/ui/syncDot.ts'
import { useSyncStatus } from '../shared/ui/useSync.ts'
import { useFirstRun } from '../shared/screens/useFirstRun.ts'
import { useWhatsNew } from '../shared/screens/useWhatsNew.ts'
import { WhatsNew } from '../shared/screens/WhatsNew.tsx'
import { Journal } from './Journal.tsx'
import { useLog, useMainCar } from './useLog.ts'

/**
 * Главный экран: шапка с шестерёнкой, «Что нового» после обновления и
 * журнал (Р-03). Без машины журнал зовёт её завести.
 *
 * Пустому устройству без токена «семья» — один раз предложение демо
 * (Я-45 «FamilyCore»): правила показа — ядра, хранилища записей — свои.
 *
 * Пуста ли база для «Что нового» и строки про iPhone — по всем хранилищам
 * записей, кроме общих настроек: выбранная валюта записью не считается.
 */
export function Home() {
  const mark = syncDot(useSyncStatus())
  const first = useFirstRun(RECORD_STORES)
  const news = useWhatsNew(first, CHANGES)
  const log = useLog()
  const main = useMainCar()

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

      <DemoOffer own={RECORD_STORES} />

      {log.error && <p className="error block">База не открылась: {log.error}</p>}

      {/* Пока журнал и главная машина не прочитаны — ничего: мигнуть «записей
          нет» у человека с данными хуже, чем опоздать на миг. */}
      {log.data && main.known && <Journal data={log.data} mainId={main.mainId} />}
    </>
  )
}
