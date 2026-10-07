/* js/data/metal-pex.js — металлополимерные трубы PEX-AL-PEX.
   Данные — реверс shev.exe (BSTR-списки комбо + пулы f64); комментарии указывают
   VA-адреса находки. */
"use strict";

 const MAT_METAL_PEX = {id:'metal-pex',name:'Металлополимерные «PEX-AL-PEX» СП 41-109-2005',      doc:'sp41_109',
  d:[16,20,26,40,63], dvSame:true}

registerMaterial(MAT_METAL_PEX);

/* экспорт для node-тестов */
if (typeof module!=='undefined' && module.exports){
  module.exports={MAT:MAT_METAL_PEX};
}
