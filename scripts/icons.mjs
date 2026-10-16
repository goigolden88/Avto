/**
 * Иконки PWA «Авто» из геометрии public/favicon.svg.
 *
 * Растеризатор и PNG — ядра (`shared/scripts/icons.mjs`); здесь — свои цвет
 * и рисунок. Запускается руками (`npm run icons`), результат коммитится.
 * В сборку не входит: иконка меняется раз в год.
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BACKGROUND, INK, writeIcons } from '../src/shared/scripts/icons.mjs'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

/**
 * Акцент «Авто» — коралловый. Фон общий у всей семьи, акцент у каждого свой:
 * синий «Дневников», тёплый «Делу Время» и «Тотального Учёта», зелёный
 * «Трапезы», пурпурный «Злотых». Коралл — красноватый, с тёплыми не путается.
 */
const ACCENT = [0xef, 0x6f, 0x5e]

/**
 * Те же фигуры, что в favicon.svg. Расходиться им нельзя.
 *
 * Машина сбоку, мордой вправо, — силуэтом цвета фона на коралловом круге:
 * кузов, кабина с двумя окнами, фара и два колеса. Колесо отделено от кузова
 * коралловым ободом, иначе тёмное на тёмном слилось бы. Всё внутри
 * безопасной зоны maskable: круга в 80% стороны, который система не обрежет
 * никогда.
 */
const SHAPES = [
  // Круг
  { x: 56, y: 56, w: 400, h: 400, r: 200, color: ACCENT, alpha: 1 },
  // Кабина и кузов
  { x: 166, y: 168, w: 170, h: 96, r: 40, color: BACKGROUND, alpha: 1 },
  { x: 106, y: 236, w: 300, h: 84, r: 32, color: BACKGROUND, alpha: 1 },
  // Окна: заднее и переднее, между ними стойка
  { x: 186, y: 186, w: 64, h: 50, r: 18, color: ACCENT, alpha: 1 },
  { x: 260, y: 186, w: 58, h: 50, r: 18, color: ACCENT, alpha: 1 },
  // Фара
  { x: 382, y: 254, w: 16, h: 16, r: 8, color: INK, alpha: 1 },
  // Колёса: обод цвета круга, шина, ступица
  { x: 128, y: 270, w: 96, h: 96, r: 48, color: ACCENT, alpha: 1 },
  { x: 288, y: 270, w: 96, h: 96, r: 48, color: ACCENT, alpha: 1 },
  { x: 136, y: 278, w: 80, h: 80, r: 40, color: BACKGROUND, alpha: 1 },
  { x: 296, y: 278, w: 80, h: 80, r: 40, color: BACKGROUND, alpha: 1 },
  { x: 162, y: 304, w: 28, h: 28, r: 14, color: INK, alpha: 1 },
  { x: 322, y: 304, w: 28, h: 28, r: 14, color: INK, alpha: 1 },
]

writeIcons({ out: OUT, shapes: SHAPES, background: BACKGROUND })
