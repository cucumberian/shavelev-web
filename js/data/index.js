/* data/index.js — сборка всех справочников для node-тестов. В браузере модули подключаются
   отдельными <script> прямо в index.html; порядок здесь такой же. */
"use strict";
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
const {DOCS} = require("./docs.js");
const {VREC,VEL_LIMIT,K_MODE,MODE_SYS,MODE_LABELS} = require("./modes.js");

if (typeof module!=='undefined' && module.exports){
  module.exports={MATERIALS:reg.MATERIALS, ECON_ROWS:reg.ECON_ROWS, DOCS, VREC, VEL_LIMIT,
    K_MODE, MODE_SYS, MODE_LABELS};
}
