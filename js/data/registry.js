/* data/registry.js — реестр материалов клона. Каждый модуль типа труб (js/data/<тип>.js) объявляет
   здесь свой материал через registerMaterial(материал). Порядок подключения в index.html:
   fmt → formulas → registry → docs → modes → модули труб (steel, steel-es, ci, asbes, plastic,
   plastic, pe100, conc, grp, glass, pex, metal-pex) → calc → ui → webmcp.

   Структура материала (общая для всех модулей). Данные сортамента хранятся в поле, отвечающем за
   форму (gas / wall / cls / vt / pe / pe100 / series / sMap / dvMap / d+dv), а ПОВЕДЕНИЕ страницы —
   в объекте page (см. ниже и в ui.js: pageState()).

     id     — код материала в клоне
     name   — подпись вкладки выбора страницы
     doc    — ключ синей подписи нормативного документа (docs.js)
     ui     — {sys, wear, cu}: какие блоки страницы есть в окне оригинала (читает движок)
     page   — поведение страницы, см. ниже

   page — ЧИСТЫЕ функции без DOM (их проверяет test/page_test.js без jsdom):
     blocks      — какие блоки-селекторы страница показывает (clsRow, vtRow, peRow, …);
     labels      — подписи строк диаметра/стенки/dв;
     rows(st)    — строки списка диаметров [[значение, подпись], …];
     wallRows    — стенки для выбранного диаметра (нет поля — не задано);
     dvOf(st,d)  — ★ закон расчётного диаметра (единственный в проекте);
     rec         — правило строки рекомендации (см. ниже);
     discovery(st) — что страница сообщает о себе агенту в shev-list-materials:
                   {diameters, note, series?, pipe_classes?} — ряды, серии и подписи dв здесь,
                   а не в ветвлении инструмента.

   Рекомендации по диаметру объявляет САМА СТРАНИЦА (page.rec), а не отдельный реестр:
     rec.mode='vel'    — первый ряд, у которого v(его dв) ≤ VREC (сталь, чугун, ж/б);
     rec.mode='ranges' — таблица предельных экономических расходов [[д, Qпред], …] (а/ц, пластик,
                         ПЭ 100). Ряды дословно из BSTR программы (0x44fd4..0x47434) и из кн.
                         Шевелевых 1984 табл. 12 (колонка Э=0,75) — разбор в ../materials/.
   Реестр registerRec/registerRecRanges, который раньше хранил эти ряды отдельно от материала,
   удалён 13.10.2026. */
const MATERIALS = [];
function registerMaterial(m){ MATERIALS.push(m); return m; }
// в node-тестах модули грузятся require-ом: экспорт registry виден им только через globalThis
globalThis.MATERIALS = MATERIALS;
globalThis.registerMaterial = registerMaterial;

/* экспорт для node-тестов (в браузере window есть, в node — global) */
if (typeof module!=='undefined' && module.exports){
  module.exports={MATERIALS,registerMaterial};
}
