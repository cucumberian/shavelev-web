/* formulas.js — расчётные формулы, извлечённые реверсом EXE «Таблицы Шевелева» ver 3.0.
   VA-адреса констант: /root/re/materials/formulas.md, constants_text.md.
   Модель: i [м/м] = A·v²/d^e, где A ≡ λ/(2g) — ν-подставленные формы программы. */
"use strict";

const G2 = 19.62;   // 2g — свёрнуто в константах λ→A
const G  = 9.81;    // g — для R = ρ·g·i (код: VA 0x4af565)

const F = {
 // новые стальные (2а): λ=0.0159(1+0.684/v)^0.226/d^0.226
 newSteel: v=>0.0159*Math.pow(1+0.684/v,0.226)/G2,
 // новые чугунные (3а): λ=0.0144(1+2.36/v)^0.284/d^0.284
 newCI:    v=>0.0144*Math.pow(1+2.36/v,0.284)/G2,
 // неновые ст./чуг. (6): A=0.00107 при v≥1.2
 oldA:     ()=>0.00107,
 // неновые (7): A=0.000912·(1+0.867/v)^0.3 при v<1.2
 oldB:     v=>0.000912*Math.pow(1+0.867/v,0.3),
 // асбестоцемент (17): A=0.000561·(1+1.19/v)^0.190
 asbes:    v=>0.000561*Math.pow(1+1.19/v,0.190),
 // железобетон (22): ×1.43 от а/ц: A=0.000802·(1+1.19/v)^0.190·φ
 conc:     (v,phi)=>0.000802*Math.pow(1+1.19/v,0.190)*(phi||1),
 // пластик (код 0x4ddc88): A=0.000685·(1+1.774/v)^0.226
 plastic:  v=>0.000685*Math.pow(1+1.774/v,0.226),
 // стекло (код 0x50e636): A=0.000745·(1+1.774/v)^0.226
 glass:    v=>0.000745*Math.pow(1+1.774/v,0.226),
};

/* Выбор формулы по материалу/состоянию.
   wear: 'new'|'old'; mat — id материала; v м/с; d — внутренний диаметр, м.
   Возврат {A, e} → i = A·v²/d^e */
function iCalc(wear, mat, v, d){
  if(mat==='steel'||mat==='steel-es'){
    if(wear==='new') return {A:F.newSteel(v), e:1.226};
    return v>=1.2 ? {A:F.oldA(), e:1.3} : {A:F.oldB(v), e:1.3};
  }
  if(mat==='ci') {
    if(wear==='new') return {A:F.newCI(v), e:1.284};
    return v>=1.2 ? {A:F.oldA(), e:1.3} : {A:F.oldB(v), e:1.3};
  }
  if(mat==='asbes')   return {A:F.asbes(v),  e:1.190};
  if(mat==='conc')    return {A:F.conc(v),   e:1.190};
  if(mat==='plastic'||mat==='pex'||mat==='metal-pex'||mat==='grp') return {A:F.plastic(v), e:1.226};
  if(mat==='glass')   return {A:F.glass(v),  e:1.226};
  return {A:F.oldA(), e:1.3};
}

// экспорт для node-тестов (в браузере window есть, в node — global)
if (typeof module!=='undefined' && module.exports){
  module.exports={G,G2,F,iCalc};
}