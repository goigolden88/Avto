import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { config } from './app/config.ts'
import { db, sync } from './app/core.ts'
import { CoreProvider } from './shared/ui/core.tsx'
import { Layout, type Tab } from './shared/ui/Layout.tsx'
import { Help } from './screens/Help.tsx'
import { Home } from './screens/Home.tsx'
import { Parkings } from './screens/Parkings.tsx'
import { Plans } from './screens/Plans.tsx'
import { RoutesTab } from './screens/RoutesTab.tsx'
import { Settings } from './screens/Settings.tsx'

/**
 * Роутинг через хеш: на GitHub Pages обычные пути дают 404 при обновлении
 * страницы — сервер ищет файл, которого нет. Всё после # до сервера не доходит.
 *
 * Синхронизация запускается здесь, один раз на приложение: проход идёт по
 * таймеру и по событиям и не зависит от того, какой экран открыт. Не
 * настроена — проход ничего не делает и в сеть не ходит.
 *
 * Общий интерфейс ядра — нижняя панель, «Настройки синхронизации»,
 * сворачивание, «Что нового» — берёт базу и синхронизацию из `CoreProvider`
 * (Я-03 «FamilyCore»); вкладки — пропсом.
 */
const TABS: readonly Tab[] = [
  // Журнал живёт на «Главной». Места — не вкладкой, а своим экраном
  // внутри «Маршрутов»: ими пользуются редко (Р-24). Планы — третьей
  // вкладкой (Р-28).
  { to: '/', name: 'Главная', end: true },
  { to: '/routes', name: 'Маршруты', end: false },
  { to: '/plans', name: 'Планы', end: false },
]

export function App() {
  useEffect(() => sync?.startAutoSync(), [])

  return (
    <CoreProvider value={{ config, db, sync }}>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Layout tabs={TABS} />}>
            <Route index element={<Home />} />
            <Route path="routes" element={<RoutesTab />} />
            {/* Места — экран по ссылке с «Маршрутов», не вкладка (Р-24, Р-31):
                вкладка «Маршруты» на нём остаётся подсвеченной. Адрес —
                прежний, с парковок. */}
            <Route path="routes/parkings" element={<Parkings />} />
            <Route path="plans" element={<Plans />} />
            {/* «Настройки» — не вкладка: шестерёнка в шапке главного экрана. */}
            <Route path="settings" element={<Settings />} />
            {/* Справка — «?» рядом с шестерёнкой, тоже не вкладка (Р-30). */}
            <Route path="help" element={<Help />} />
            {/* Незнакомый адрес — на главный: приложение открывается,
                а не показывает пустоту. */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </HashRouter>
    </CoreProvider>
  )
}
