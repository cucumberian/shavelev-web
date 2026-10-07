/* js/data/pex.js — трубы PEX (сшитый полиэтилен).
   Данные — реверс shev.exe (BSTR-списки комбо + пулы f64); комментарии указывают
   VA-адреса находки. */
"use strict";

 const MAT_PEX = {id:'pex',      name:'«PEX» (сшитый полиэтилен) СП 40-108-2004',           doc:'sp40_108',
  d:[16,20,26,32,40,63,75,90,110,160], dvSame:true}

registerMaterial(MAT_PEX);

/* экспорт для node-тестов */
if (typeof module!=='undefined' && module.exports){
  module.exports={MAT:MAT_PEX};
}
