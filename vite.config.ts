/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'
import { familyVite } from './src/shared/scripts/vite.ts'

// GitHub Pages отдаёт сайт проекта не с корня домена, а по /<имя репозитория>/.
// Репозиторий называется Avto → https://goigolden88.github.io/Avto/ (Р-01).
// Переименуете репозиторий — правьте эту строку, остальное подтянется.
const BASE = '/Avto/'

// Сборка, работник и манифест — фабрикой ядра; своё здесь — адрес, имя
// и описание. Ярлыков пока нет: запись появится с журналом.
export default defineConfig({
  ...familyVite({
    base: BASE,
    name: 'Авто',
    description: 'Учёт машины: заправки, ремонты, штрафы и прочие траты, маршруты и парковки. Работает без сети.',
  }),

  // Тесты ядра гоняет CI ядра; здесь — только свои.
  test: {
    exclude: [...configDefaults.exclude, 'src/shared/**'],
  },
})
