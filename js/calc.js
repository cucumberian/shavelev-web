/* calc.js — расчётный движок клона «Таблицы Шевелева»: ТОЛЬКО вычисления, без DOM.
   Здесь собрано всё, что считает: единицы расхода, скорость, уклон, потери, предупреждения
   по скорости, строка рекомендации и печать чисел. Константы формул — formulas.js,
   справочные таблицы — data.js. ui.js читает контролы и рисует результат; webmcp.js
   вызывает те же функции. Движок тестится в node без jsdom (test/calc_test.js).

   Модель программы (реверс shev.exe ver 3.0):
     v = Q/(π·dp²/4)            π = 4·atan(1) (rtcAtn(1)·_DAT_004011f8); в скорость входят
                                ТОЛЬКО расход и диаметр — ν, ρ и температура не участвуют
     i = A·v²/dp^e, A ≡ λ/(2g)  2g = 19,62 (VA 0x4011d8); ν уже подставлена в константы A
                                (ν воды 1,3·10⁻⁶ м²/с, t = 10 °C)
     R = ρ·g·i [Па/м]           g = 9,81; ρ влияет ТОЛЬКО на эту строку (и «потери давления, Па»)
     H = i·L·(1+k) [м]          на страницах без местных сопротивлений k ≡ 0 → H = i·L

   Страницы без блока «Режим / теплоноситель» (по шаблонам форм EXE: в окне нет ни «Выбор
   системы»/t= °C, ни ν/ρ, ни «учесть потери на местные сопротивления»): чугун, а/ц, пластик,
   PEX, PEX-AL-PEX, ж/б, стеклопластик, стекло. Блок есть только на стальных страницах
   (frmtablII11 / frmtablII2: Frame4 «Выбор системы» + Option5/6 «холодного/горячего
   водоснабжения» + Label21 «t=» «°C» + Check2 «учесть потери на местные сопротивления»). */
"use strict";

/* ─── печать чисел: как rtcRound(x,n) в программе, разделитель — запятая ─── */
function fmt(x,n){
 if(x!==0 && Math.abs(x)<Math.pow(10,-n)){
   // малые значения: добавляем знаки, чтобы не округлять до 0 (BUG-7)
   let s=x.toFixed(n+8).replace(/0+$/,'').replace(/\.$/,'');
   return s.replace('.',',');
 }
 return (Math.round(x*Math.pow(10,n))/Math.pow(10,n)).toString().replace('.',',');
}
function fmt2(x){return x.toFixed(2).replace('.',',');}

/* ─── расход → м³/с (л/с и м³/ч — как Option1/Option2 в окне программы) ─── */
function qToM3s(q,unit){ return unit==='mh' ? q/3600 : q/1000 }

/* ─── скорость: v = Q/(π·dp²/4). Только Q и dp. ─── */
function velocity(q_m3s,dp_mm){ const d=dp_mm/1000; return q_m3s/(Math.PI*d*d/4) }

/* ─── удельные потери (уклон): i = A·v²/dp^e, A ≡ λ/(2g); формулы — formulas.js ─── */
function gradient(mat,wear,v,dp_mm){
 const d=dp_mm/1000; const {A,e}=iCalc(wear,mat,v,d);
 return {A,e,i:A*v*v/Math.pow(d,e)};
}
/* ─── R = ρ·g·i (Па/м) и H = i·L·(1+k) (м) ─── */
function pressure(i,rho){ return i*(rho||RHO_FIX)*G }
function head(i,L,k){ return i*L*(1+(k||0)) }

/* ─── значения теплоносителя по умолчанию: вода 10 °C, как в программе ─── */
const NU_FIX=1.3e-6, RHO_FIX=1000;

/* ─── какие страницы не используют режим/теплоноситель/местные сопротивления ───
   usesSys() true только для steel и steel-es (там в окне есть «Выбор системы», t и k).
   usesWear() — где есть «новые/неновые»: строки «новые»/«неновые» в EXE лежат только в
   шаблонах frmtablII11 (сталь), frmtablII2 (э/с) и frmtablII3 (чугун). */
const NO_SYS=['ci','asbes','plastic','pex','metal-pex','conc','grp','glass'];
const NO_WEAR=['asbes','plastic','pex','metal-pex','conc','grp','glass'];
function matOf(id){ return MATERIALS.find(m=>m.id===id) }
function usesSys(mat){ return !NO_SYS.includes(mat) }
function usesWear(mat){ return !NO_WEAR.includes(mat) }
function usesK(mat){ return usesSys(mat) }   // k ≡ 0 и H = i·L там, где нет местных сопротивлений

/* ─── предупреждения по скорости ───
   чугун (FUN_004ae2c0): «Большая скорость! Рекомендуется увеличить диаметр» / «Малая скорость!
   Рекомендуется уменьшить диаметр», пороги по диаметру 0,8…2 / 1…3 / 1,5…4 (границы 200/800
   подтверждены живой программой 05.10.2026);
   сталь/э/с (FUN_0047e8d0, FUN_004a22c0): «Внимание! Скорость больше 3 м/с…» и «…10 м/с…»;
   в клоне пороги берутся из режима (VEL_LIMIT), пороги 3/10 в EXE зафиксированы, режим задаёт k.
   а/ц, пластик, PEX, ж/б, стеклопластик, стекло (FUN_0050a140, FUN_0050daf0 и др.): строк
   предупреждения в функции расчёта НЕТ — их нет и в клоне. */
function ciLimits(dv_mm){ return dv_mm<=200?[0.8,2]:(dv_mm<800?[1,3]:[1.5,4]) }
function speedNotes(mat,dv_mm,v,mode){
 const m=matOf(mat), out=[];
 if(m&&m.cls){ const [lo,hi]=ciLimits(dv_mm);
  if(v>hi) out.push({cls:'warn',text:'Большая скорость! Рекомендуется увеличить диаметр'});
  if(v<lo) out.push({cls:'warn',text:'Малая скорость! Рекомендуется уменьшить диаметр'});
  return out; }
 if(!usesSys(mat)) return out;
 const lim=VEL_LIMIT[mode]||VEL_LIMIT.potable; // защита от пустого mode
 if(v>lim[1]) out.push({cls:'warn',text:`Внимание! Скорость больше ${lim[1]} м/с, рекомендуется увеличить диаметр`});
 if(v<lim[0]) out.push({cls:'warn',text:'Малая скорость! Рекомендуется уменьшить диаметр'});
 return out;
}

/* ─── строка рекомендации (ряды ECON_ROWS; подписи строк в EXE 0x44fd4..0x47434) ───
   opt = минимальный ряд с v(dp) ≤ VREC; sel==opt → «экономически обосновано», иначе →
   «рекомендуется использовать трубу …». dpOf(d) замыкает ui.js: расчётный dp ряда зависит от
   стенки (газовые/э/с), класса и «неновые» (чугун), SDR (ПЭ). */
function recommendation(mat,wear,q_m3s,selD,dpOf){
 const m=matOf(mat), rows=ECON_ROWS[mat];
 if(!rows) return null;
 const qls=q_m3s*1000, m3=q_m3s*3600;
 const vrow=d=>{const dp=dpOf(d); if(isNaN(dp)) return NaN; return velocity(q_m3s,dp);};
 let opt=null; for(const d of rows){ const v2=vrow(d); if(!isNaN(v2)&&v2<=VREC){opt=d;break;} }
 if(opt===null&&m&&m.id!=='steel'&&m.id!=='conc') opt=rows[rows.length-1]; // чугун/пластик: кламп к максимуму
 const word=(m&&m.pe)?'диаметром':'с условным проходом';
 if(opt===null) return {cls:'warn',text:m&&m.id==='steel'
   ?`Большая скорость! При расходе ${fmt2(qls)} л/сек = ${fmt2(m3)} м куб/ч рекомендуется использовать трубу с диаметром более 500мм`
   :`Большая скорость! Рекомендуется использовать трубу с условным проходом более 1600мм`};
 if(opt===selD) return {cls:'ok',text:`Применение трубы ${word} ${opt}мм при расходе ${fmt2(qls)} л/сек = ${fmt2(m3)} м куб/ч экономически обосновано`};
 return {cls:'warn',text:`При расходе ${fmt2(qls)} л/сек = ${fmt2(m3)} м куб/ч рекомендуется использовать трубу ${word} ${opt}мм`};
}

/* ─── главный вход движка: вход — числа, выход — объект; DOM не трогает ───
   inp = {mat, wear, dv_mm, q, qunit, L, k, mest, nu, rho, mode, selD, dpOf}
   dpOf(d) нужен только материалам с рядом рекомендации (сталь, э/с, чугун, пластик). */
function shevCalc(inp){
 const mat=inp.mat, sys=usesSys(mat), kused=usesK(mat);
 const qraw=inp.q;
 if(isNaN(qraw)) return {ok:false,error:'ошибка ввода — введите значение расхода'};
 if(qraw<0) return {ok:false,error:'расход не должен быть отрицательным!'};
 if(qraw===0) return {ok:false,error:'расход не должен равняться нулю!'};
 const dv=inp.dv_mm;
 if(isNaN(dv)||dv<=0) return {ok:false,error:'диаметр не может равняться нулю!'};
 const L=inp.L;
 if(isNaN(L)) return {ok:false,error:'введите значение длины участка в м'};
 if(L<0) return {ok:false,error:'Длина участка не может быть отрицательным!'};
 if(L===0) return {ok:false,error:'Длина участка не может равняться нулю!'};
 let k=kused?((isNaN(inp.k)?0:inp.k)||0):0;
 if(kused){
  if(k<0) return {ok:false,error:'коэффициент местных сопротивлений k не может быть отрицательным!'};
  if(!inp.mest) k=0; // «учесть потери на местные сопротивления» выключен — k не применяется
 }
 if(sys && isNaN(inp.nu)) return {ok:false,error:'Вы не ввели значение коэффициента кинематической вязкости теплоносителя!'};
 // на страницах без блока «теплоноситель» ρ фиксирована (1000, t=10 °C) — поле UI не участвует
 const rho=sys?((!isNaN(inp.rho)&&inp.rho>0)?inp.rho:RHO_FIX):RHO_FIX;

 const q=qToM3s(qraw,inp.qunit);
 const v=velocity(q,dv);
 const {A,e,i}=gradient(mat,inp.wear,v,dv);
 const R=pressure(i,rho), H=head(i,L,k), P=R*L*(1+k);

 const lines=[
  `Скорость v = ${fmt(v,3)} м/с`,
  // 1000i — как в программе: rtcRound(1000·i,3) без лишних нулей (FUN_0047e8d0, FUN_004a22c0,
  // FUN_004ae2c0, FUN_0050a140, FUN_0050daf0); скрин стеклопластика 43,344; ж/б 0,151
  `i = ${fmt(i*1000,3)} мм/м  (1000i = ${fmt(i*1000,3)})`,
  `удельные потери давления R = ${fmt(R,1)} Па/м`,
 ];
 // блок «Потери напора…» — как в программе: где местных сопротивлений нет (kused=false) —
 // «по длине», H = i·L, строки k нет; где есть — «на участке», H = i·L·(1+k) и строка k
 const outH=(kused?[`k = ${fmt(k,2)}`]:[]).concat([
  `Потери напора ${kused?'на участке':'по длине'} H = i·L${kused?'·(1+k)':''} = ${fmt(H,3)} м`,
  `потери давления = ${fmt(P,0)} Па`]);
 const notes=speedNotes(mat,dv,v,inp.mode);
 const rec=recommendation(mat,inp.wear,q,inp.selD,inp.dpOf||(()=>NaN));
 if(rec) notes.push(rec);
 return {ok:true,q,qunit:inp.qunit,v,i,i1000:i*1000,A,e,R,H,P,k,dv_mm:dv,L,rho,
   hLegend:kused?'Потери напора на участке, м':'Потери напора по длине, м',
   lines,outH,notes};
}

/* экспорт для node-тестов (в браузере window есть, в node — global) */
if (typeof module!=='undefined' && module.exports){
 module.exports={fmt,fmt2,qToM3s,velocity,gradient,pressure,head,NU_FIX,RHO_FIX,
   NO_SYS,NO_WEAR,matOf,usesSys,usesWear,usesK,ciLimits,speedNotes,recommendation,shevCalc};
}
