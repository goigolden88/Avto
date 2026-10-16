/**
 * Ядро «Авто» — собранное по её конфигу (Р-02).
 *
 * Код приложения берёт `db` и `sync` отсюда. К хранилищу обращаются только
 * через этот `db`: напрямую в IndexedDB не ходит никто, кроме
 * `shared/core/db.ts`. Общий интерфейс ядра получает те же объекты
 * контекстом — `<CoreProvider>` в `app.tsx` (Я-03 «FamilyCore»).
 *
 * `layout` и `importing` ядра появятся здесь вместе с тем, кто их зовёт:
 * импорт — с журналом.
 */

import { createDb } from '../shared/core/db.ts'
import { createSync } from '../shared/core/sync.ts'
import { config } from './config.ts'

export const db = createDb(config)
// В демо синхронизации нет (Я-44 «FamilyCore»): база выдуманная, и `createSync`
// на ней падает — чтобы ни одна запись демо не уехала в `AvtoData`. Демо
// у «Авто» пока нет (задача 4), но условие верно и до него.
export const sync = db.demo ? undefined : createSync(config, db)
