/* data/registry.js — реестр справочников клона. Модули типов труб (js/data/<тип>.js) регистрируют
   здесь свой справочник: registerMaterial(материал) и, если у страницы есть блок рекомендации,
   registerRec(тип, ряды). Порядок подключения в index.html: registry → docs → modes → модули труб
   (steel, steel-es, ci, asbes, plastic, conc, grp, glass, pex, metal-pex) → calc → ui → webmcp.

   Структура материала (общая для всех модулей):
     id     — код материала в клоне
     name   — подпись вкладки выбора страницы
     doc    — ключ синей подписи нормативного документа (docs.js)
     d      — диаметры списка (dу/dн, мм)
     dv     — внутренние диаметры (параллельно d), если dв≠d
     dvSame — dв = d
     dvMap  — {dн: dв}: в комбо наружный dн, dв подставляет программа по таблице (стекло)
     wall   — {dн: [толщины мм]} → dв = dн − 2s (электросварные)
     gas    — водогазопроводные: {dn:[dн…], s:{dн:[толщины…]}} → dp = dн − 2s − 1 (1 мм — коррозия)
     vt     — асбестоцемент: [{du, items:[[класс,тип,dв]…]}]
     cls    — чугун: {класс: {dу: [dн, S]}}
     pe     — пластик: {марка ПЭ: {SDR: {dн: e ном.}}}

   Ряды рекомендации (registerRec) — дословно из BSTR программы (0x44fd4..0x47434): сталь 100..500 и
   чугун 100..1000 (125 в строках НЕТ — своя особенность программы), ж/б 500..1600, пластик 63..630
   (+225). У ж/б подписи-пары есть для 600..1600 (0x46c28..0x47434), а для первого ряда 500 — только
   «…с условным проходом меньше 500мм» (0x46ba0) и «…более 1600мм» (0x47434) — совпадает с комбо
   FUN_005022c0 (500…1600, 9 значений), т.е. ряды рекомендации = ряды таблицы страницы. Порогов в
   бинаре нет — opt = минимальный ряд с v ≤ VREC. Прежний ECON (подогнанные пороги Q при v≈0,3)
   ошибочен — удалён 06.10.2026. Ветки «меньше первого ряда» (0x4502c у стали, 0x46ba0 у ж/б) в клоне
   пока не реализованы. */
"use strict";

const MATERIALS = [];
const ECON_ROWS = {};
function registerMaterial(m){ MATERIALS.push(m); return m; }
function registerRec(mat, rows){ ECON_ROWS[mat] = rows; }
// в node-тестах модули грузятся require-ом: экспорт registry виден им только через globalThis
globalThis.MATERIALS = MATERIALS; globalThis.ECON_ROWS = ECON_ROWS;
globalThis.registerMaterial = registerMaterial; globalThis.registerRec = registerRec;

/* экспорт для node-тестов (в браузере window есть, в node — global) */
if (typeof module!=='undefined' && module.exports){
  module.exports={MATERIALS,ECON_ROWS,registerMaterial,registerRec};
}
