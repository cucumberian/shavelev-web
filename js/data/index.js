/* data/index.js — сборка всех справочников для node-тестов. В браузере модули подключаются
   отдельными <script> прямо в index.html; порядок здесь такой же. */
"use strict";
/* Модули данных страниц строят подписи своих строк через fmt() из js/fmt.js (подписи «dн=88,5 мм»).
   В браузере fmt.js подключён ПЕРВЫМ <script>, в node глобалы надо подставить самому — иначе
   требование данных неявно зависело бы от порядка подключения в index.html. */
const FMT=require("../fmt.js");
Object.assign(globalThis,FMT);
const reg = require("./registry.js");
require("./docs.js");
require("./modes.js");
require("./steel.js");
require("./steel-es.js");
require("./ci.js");
require("./asbes.js");
require("./plastic.js");
require("./conc.js");
require("./grp.js");
require("./glass.js");
require("./copper.js");
require("./pex.js");
require("./metal-pex.js");
require("./pe100.js");   // ГОСТ Р 70628.2-2023 (ПЭ 100) — страница клона, в EXE её нет
const {DOCS} = require("./docs.js");
const {VREC,VEL_LIMIT,K_MODE,MODE_SYS,MODE_LABELS} = require("./modes.js");

if (typeof module!=='undefined' && module.exports){
  module.exports={MATERIALS:reg.MATERIALS, DOCS, VREC, VEL_LIMIT, ...FMT,
    K_MODE, MODE_SYS, MODE_LABELS};
}
