/* calc.js — расчётный движок клона «Таблицы Шевелева»: ТОЛЬКО вычисления, без DOM.
   Здесь собрано всё, что считает: единицы расхода, скорость, уклон, потери, предупреждения
   по скорости, строка рекомендации и печать чисел. Константы формул — formulas.js,
   справочные таблицы — js/data/ (модуль на каждый тип труб + registry/docs/modes). ui.js читает
   контролы и рисует результат; webmcp.js
   вызывает те же функции. Движок тестится в node без jsdom (test/calc_test.js).

   Модель программы (реверс shev.exe ver 3.0):
     v = Q/(π·dp²/4)            π = 4·atan(1) (rtcAtn(1)·_DAT_004011f8); в скорость входят
                                ТОЛЬКО расход и диаметр — ν, ρ и температура не участвуют
     i = A·v²/dp^e, A ≡ λ/(2g)  2g = 19,6133 (в EXE 19,62, VA 0x4011d8); ν уже подставлена в A
                                (ν воды 1,3·10⁻⁶ м²/с, t = 10 °C)
     R = ρ·g·i [Па/м]           g = 9,80665 (одно на всю программу); ρ влияет ТОЛЬКО на эту строку
     H = i·L·(1+k) [м]          на страницах без местных сопротивлений k ≡ 0 → H = i·L

   Страницы без блока «Режим / теплоноситель» (по шаблонам форм EXE: в окне нет ни «Выбор
   системы»/t= °C, ни ν/ρ, ни «учесть потери на местные сопротивления»): чугун, а/ц, пластик,
   PEX, PEX-AL-PEX, ж/б, стеклопластик, стекло. Блок есть только на стальных страницах
   (frmtablII11 / frmtablII2: Frame4 «Выбор системы» + Option5/6 «холодного/горячего
   водоснабжения» + Label21 «t=» «°C» + Check2 «учесть потери на местные сопротивления»). */
"use strict";

/* Печать чисел (fmt/fmt2/fmt3/vbs) живёт в js/fmt.js — он подключается ПЕРВЫМ<script>, чтобы модули
   данных страниц (js/data/*.js), идущие раньше этого файла, могли строить подписи своих строк.
   В браузере это просто глобалы; в node их надо подставить себе — здесь, чтобы тестам
   (calc_test.js, help_check.js) не пришлось ничего знать про порядок подключения. */
if (typeof module!=='undefined' && module.exports){
  Object.assign(globalThis, require('./fmt.js'));
}

/* ─── печать чисел: как rtcRound(x,n) в программе, разделитель — запятая ─── */
function fmt(x,n){
 if(x!==0 && Math.abs(x)<Math.pow(10,-n)){
   // малые значения: добавляем знаки, чтобы не округлять до 0 (BUG-7)
   let s=x.toFixed(n+8).replace(/0+$/,'').replace(/\.$/,'');
   return s.replace('.',',');
 }
 return (Math.round(x*Math.pow(10,n))/Math.pow(10,n)).toString().replace('.',',');
}

/* ─── расход → м³/с (л/с и м³/ч — как Option1/Option2 в окне программы) ─── */
function qToM3s(q,unit){ return unit==='mh' ? q/3600 : q/1000 }

/* ─── скорость: v = Q/(π·dp²/4). Только Q и dp. ─── */
function velocity(q_m3s,dp_mm){ const d=dp_mm/1000; return q_m3s/(Math.PI*d*d/4) }

/* ─── удельные потери (уклон): i = A·v²/dp^e, A ≡ λ/(2g); формулы — formulas.js ─── */
function gradient(mat,wear,v,dp_mm,sys){
 const d=dp_mm/1000; const {A,e}=iCalc(wear,mat,v,d,sys);
 return {A,e,i:A*v*v/Math.pow(d,e)};
}
/* ─── удельные потери веткой материала ───
   сталь/э/с — точные формулы EXE (ν входит: агент const-check, 10.10.2026), остальные — степенная
   модель i = A·v²/d^e из gradient(). Одно место и для окна, и для внешнего calcLosses: копия этого
   правила уже разводила расчёт с выводом страницы. */
function iOf(mat,wear,v,dv_mm,nu,sys){
 if(mat==='steel'||mat==='steel-es'){
  const d=dv_mm/1000, i=steelI(v,d,(!isNaN(nu)&&nu>0)?nu:NU_FIX,wear);
  return {A:i/(v*v/Math.pow(d,1.3)), e:1.3, i};
 }
 return gradient(mat,wear,v,dv_mm,sys);
}
/* ─── R = ρ·g·i (Па/м) и H = i·L·(1+k) (м) ─── */
function pressure(i,rho){ return i*(rho||RHO_FIX)*G }   // g одно на программу (см. G в formulas.js)
function head(i,L,k){ return i*L*(1+(k||0)) }

/* ─── значения теплоносителя по умолчанию: вода 10 °C, как в программе ─── */
const NU_FIX=1.3e-6, RHO_FIX=1000;

/* ─── какие страницы не используют режим/теплоноситель/местные сопротивления ───
   Декларативная карта видимости блоков лежит в данных страниц (js/data/<тип>.js → m.ui):
     ui.sys  — в окне есть стальной блок «Режим / теплоноситель» (Система/местные/режим/k):
               true только у steel и steel-es (frmtablII11/frmtablII2: Frame4 «Выбор системы»,
               Option5/6, Label21 «t=», Check2 «учесть … местные сопротивления»);
     ui.wear — в окне есть «новые/неновые»: steel, steel-es, ci (строки EXE 0x62ce6..0x62d28,
               0x63c53/0x63c7a, 0x6905c/0x69085);
     ui.cu   — страница со своими рамками «Выбор системы»/«Температура»/«Теплоноситель»/ξ
               (copper frmtablII9, pex frmtablII10, metal-pex).
   NO_SYS/NO_WEAR — резервный список для страниц без карты (и эталон для calc_test.js). */
const NO_SYS=['ci','asbes','plastic','pe100','pex','metal-pex','conc','grp','glass','copper'];
const NO_WEAR=['asbes','plastic','pe100','pex','metal-pex','conc','grp','glass','copper'];
function matOf(id){ return MATERIALS.find(m=>m.id===id) }
function uiFlag(mat,key,fallback){ const m=matOf(mat); return (m&&m.ui&&key in m.ui)?!!m.ui[key]:fallback }
function usesSys(mat){ return uiFlag(mat,'sys',!NO_SYS.includes(mat)) }
function usesWear(mat){ return uiFlag(mat,'wear',!NO_WEAR.includes(mat)) }
// СП-страница (медь, PEX, PEX-AL-PEX и любая следующая) объявляет себя признаком page.kind='sp' —
// тем же, по которому движок выбирает spCalc(). Имени материала движок не знает.
function usesCu(mat){ const m=matOf(mat); return m&&m.page ? m.page.kind==='sp' : uiFlag(mat,'cu',false) }
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
  // сталь/э-с: в EXE только предупреждение по скорости («Внимание! Скорость больше 3 м/с…» / «…10 м/с…»).
  // Строка «Малая скорость! Рекомендуется уменьшить диаметр» — чугунная (0x42bc0, FUN_004ae2c0);
  // на стальной странице её нет (подтверждено 10.10.2026) — она противоречила рекомендации по ряду.
 return out;
}

/* ─── рекомендация по ПРЕДЕЛЬНЫМ ЭКОНОМИЧЕСКИМ РАСХОДАМ (страница а/ц, frmtablII4) ───
   Источник таблицы — Шевелевы 1984, табл. 12, стр. 25, колонка Э=0,75 (разбор и живые точки —
   в js/data/asbes.js). Правило книги (стр. 23): берётся ПЕРВЫЙ диаметр, чей предельный расход не
   меньше Q. Строки EXE: 0x444fd8 «При расходе », 0x444ff8 «л/сек =», 0x44500c «м куб/ч », 0x445030
   «…менее 100мм», 0x4450b8…0x4457d0 красные 100…500, 0x445134…0x445750 зелёные «Применение трубы
   с условным проходом Nмм при расходе », 0x4451a8 «экономически обосновано», 0x44584c+0x445890
   «Большая скорость! …более 500мм»; в коде есть ветка `If Q < 5` (__vbaVarTstLt @0x4cb9c9).
   Оригинал: Q < 5 → «менее 100мм», Q ровно 5 → НИЧЕГО (строгие неравенства автора), Q выше предела
   последнего диаметра → «более 500мм». Числа в строке — как VB6 Str(): точка, хвостовые нули отброшены
   («При расходе 3л/сек =10.8м куб/ч …»). Печать числа как VB6 Str() — vbs() из js/fmt.js. */
/* opts — различия страниц а/ц и пластика (см. registry.js). По умолчанию — поведение а/ц. */
function recRanges(q_m3s,selD,rows,opts){
 const o=opts||{}, word=o.word||'с условным проходом';
 const qls=q_m3s*1000, m3=q_m3s*3600;
 // формат чисел: у а/ц — VB6 Str() («3л/сек =10.8м куб/ч»), у пластика — «2,00 л/сек = 7,20 м куб/ч»
 const nums=o.fmt2
   ? `${fmt2(qls)} л/сек = ${fmt2(m3)} м куб/ч`
   : `${vbs(qls)}л/сек =${vbs(m3)}м куб/ч`;
 const pre=`При расходе ${nums} `;   // красная строка: общий префикс EXE 0x444fd8 «При расходе »
 const first=rows[0], last=rows[rows.length-1];
 if(o.below!==false && qls<5)
   return {cls:'warn',text:pre+`рекомендуется использовать трубу ${word} менее ${first[0]}мм`};
 if(o.five!==false && qls===5) return null;   // дырка оригинала а/ц (строгие неравенства), проверено живьём
 if(qls>last[1]) return {cls:'warn',text:o.overflow
   ? 'Большая скорость! '+o.overflow
   : `Большая скорость! `+pre+`рекомендуется использовать трубу с диаметром более ${last[0]}мм`};
 let opt=null;
 for(const [du,qmax] of rows){ if(qls<=qmax){ opt=du; break; } }
 if(opt===null) return null;
 // зелёная строка — своя строка EXE на каждый диаметр: «Применение трубы … Nмм при расходе » (0x445130),
 // «при» здесь СТРОЧНАЯ (у общего префикса 0x444fd8 — заглавная)
 if(opt===selD) return {cls:'ok',text:`Применение трубы ${word} ${opt}мм при расходе ${nums} экономически обосновано`};
 return {cls:'warn',text:pre+`рекомендуется использовать трубу ${word} ${opt}мм`};
}

/* ─── строка рекомендации по РЯДУ ДИАМЕТРОВ (подписи строк в EXE 0x44fd4..0x47434) ───
   opt = минимальный ряд с v(dp) ≤ VREC; sel==opt → «экономически обосновано», иначе →
   «рекомендуется использовать трубу …». dpOf(d) замыкает ui.js: расчётный dp ряда зависит от
   стенки (газовые/э/с), класса и «неновые» (чугун), SDR (ПЭ). */
function recommendation(mat,wear,q_m3s,selD,dpOf){
 const m=matOf(mat), rec=m&&m.page&&m.page.rec;
 if(!rec) return null;
 if(rec.mode==='ranges') return recRanges(q_m3s,selD,rec.rows,rec.opts);
 const rows=rec.rows;
 if(!rows) return null;
 const qls=q_m3s*1000, m3=q_m3s*3600;
 // v(его dв) считается ЗАКОНОМ СТРАНИЦЫ (dpOf — это page.dvOf, см. ui.js), поэтому у стали ряд
 // задан в dу, а расчётный диаметр берётся через перевод dу → dн (page.recKey).
 const vrow=d=>{const dp=dpOf(d); if(isNaN(dp)) return NaN; return velocity(q_m3s,dp);};
 let opt=null; for(const d of rows){ const v2=vrow(d); if(!isNaN(v2)&&v2<=VREC){opt=d;break;} }
 // clamp: при расходе, не влезающем ни в один ряд, строка всё равно называет максимум ряда
 // (так в оригинале у чугуна; у стали и ж/б — нет, там печатается «более Nмм»).
 if(opt===null && rec.clamp) opt=rows[rows.length-1];
 const word=(m&&m.pe)?'диаметром':'с условным проходом';
 const nums=`${fmt2(qls)} л/сек = ${fmt2(m3)} м куб/ч`;
 if(opt===null) return {cls:'warn',text:rec.overflow?rec.overflow(q_m3s):`Большая скорость! Рекомендуется использовать трубу ${word} более ${rows[rows.length-1]}мм`};
 if(opt===selD) return {cls:'ok',text:`Применение трубы ${word} ${opt}мм при расходе ${nums} экономически обосновано`};
 return {cls:'warn',text:`При расходе ${nums} рекомендуется использовать трубу ${word} ${opt}мм`};
}

/* ─── проверка ввода ───────────────────────────────────────────────────────────────────────
   Тексты ошибок в программе свои у каждой calc-функции, поэтому и здесь два набора: ERR для ведущей
   ветки (сталь/э/с, чугун, а/ц, пластик, ж/б, стеклопластик, стекло, ПЭ 100) и ERR_SP для страниц
   меди и PEX — у них в каждой строке добавлено уточнение про ввод. Порядок проверок тот же, что
   в EXE: сначала расход, потом диаметр, потом длина. */
const ERR={qNaN:'ошибка ввода — введите значение расхода', qNeg:'расход не должен быть отрицательным!',
 qZero:'расход не должен равняться нулю!', dvZero:'диаметр не может равняться нулю!',
 LNaN:'введите значение длины участка в м', LNeg:'Длина участка не может быть отрицательным!',
 LZero:'Длина участка не может равняться нулю!'};
const ERR_SP={qNaN:ERR.qNaN, qNeg:ERR.qNeg,
 qZero:'расход не должен равняться нулю! введите значение расхода',
 dvNaN:'ошибка ввода — Введите значение диаметра в мм',
 dvZero:'диаметр не может равняться нулю! Введите значение диаметра в мм',
 LNaN:ERR.LNaN, LNeg:ERR.LNeg,
 LZero:'Длина участка не может равняться нулю! введите значение длины участка в м'};
/* Единая проверка расхода/диаметра/длины. Возвращает либо {ok:false,error:текст}, либо
   {ok:true, qraw, q (м³/с), dv (мм), L} — дальше считают все три ветки движка. */
function validate(inp,E){
 const qraw=inp.q;
 if(isNaN(qraw)) return {ok:false,error:E.qNaN};
 if(qraw<0) return {ok:false,error:E.qNeg};
 if(qraw===0) return {ok:false,error:E.qZero};
 const dv=inp.dv_mm;
 if(isNaN(dv)) return {ok:false,error:E.dvNaN||E.dvZero};
 if(dv<=0) return {ok:false,error:E.dvZero};
 const L=inp.L;
 if(isNaN(L)) return {ok:false,error:E.LNaN};
 if(L<0) return {ok:false,error:E.LNeg};
 if(L===0) return {ok:false,error:E.LZero};
 return {ok:true,qraw:qraw,q:qToM3s(qraw,inp.qunit),dv:dv,L:L};
}

/* ─── СП-семейство: страницы, считающие по λ и редактору ξ ─────────────────────────────────────
   Сейчас это медь (frmtablII9, СП 40-108-2004), PEX (frmtablII10, СП 41-109-2005 / СП 40-102-2000)
   и PEX-AL-PEX. Движок НЕ ЗНАЕТ их имён: он видит у страницы page.kind==='sp' и берёт оттуда
   карту систем (page.sys), формулу (page.loss), теплоноситель (page.fluid), список ξ и подписи
   вывода (page.out). Четвёртая такая страница = один новый модуль данных, здесь ничего не меняется.

   Общее у этих страниц (справка EXE frmtablII9/II10, см. также js/help/copper.js, js/help/pex.js):
     inp.cuSys — система из Frame2 «Выбор системы»;
     inp.t    — температура из Frame4; обязательна для систем с признаком t (Frame2 ГВС);
     inp.cool — «вода»/«другой» из Frame5; ручные inp.cuNu/inp.cuRho — только для «другой»;
     inp.xiSum — Σξ из Frame6. Местные сопротивления входят ОТДЕЛЬНЫМ слагаемым, не через k:
       H = i·L + V²·Σξ/(2g),  2g = 19,6133 (в EXE 19,62, DAT_004011d8 @0x51a4c8)
       ΔP = R·L + Z,  Z = 0,5·ρ·V²·Σξ  (СП 40-108-2004 (10), (3.4.4))
   Признаки карты систем: cold — холодное водоснабжение (ν и ρ фиксированы программой, блоки
   «Температура»/«Теплоноситель» неактивны), t — требуется температура, heat — системы отопления
   («Теплоноситель» активен, расчёт идёт по R). */
function spCalc(inp,m){
 const P=m.page, map=P.sys;
 const sys=map[inp.cuSys]?inp.cuSys:'cold', S=map[sys];
 const b=validate(inp,ERR_SP); if(!b.ok) return b;
 let nu=inp.cuNu, rho=inp.cuRho;
 // «холодного водоснабжения»: Frame4 «Температура» и Frame5 «Теплоноситель» неактивны —
 // программа берёт воду со стандартными ν=1,3·10⁻⁶ (DAT_00402448) и ρ=1000
 if(S.cold){ nu=NU_FIX; rho=RHO_FIX; }
 else {
  if(S.t && isNaN(inp.t))
   return {ok:false,error:'Вы не ввели температуру! Для систем горячего водоснабжения рекомендуется t=60°С. Введите значение температуры, в °С'};
  // Frame5 «Теплоноситель» («вода»/«другой») активен только при системе отопления; для ГВС ν и ρ
  // берутся по температуре из Combo3, ручной теплоноситель недоступен.
  if(S.heat && inp.cool==='other'){
   if(isNaN(nu)) return {ok:false,error:'Вы не ввели значение коэффициента кинематической вязкости теплоностеля'};
   if(isNaN(rho)||rho<=0) return {ok:false,error:'Вы не ввели значение плотности теплоностеля!'};
  }
 }
 if(isNaN(nu)) nu=NU_FIX;                 // t<50 или t не выбран: ν = 1,3·10⁻⁶ (DAT_00402448)
 if(isNaN(rho)||rho<=0) rho=RHO_FIX;
 const v=velocity(b.q,b.dv), d=b.dv/1000;
 const {i,R}=P.loss(S,nu,v,d,rho,inp.pexSp);
 const xi=isNaN(inp.xiSum)?0:inp.xiSum;
 const H=i*b.L + v*v*xi/G2, Z=0.5*rho*v*v*xi, P_dP=R*b.L+Z;
 // Строки вывода собирает движок, но ТЕКСТЫ и формат задаёт страница (page.out) — у меди и PEX
 // шаблоны форм разные, и это не косметика: живой скрин 08.10.2026 (525,819 · 326,02 · 32602,001).
 const O=P.out||{}, heat=!!S.heat;
 const lines=[`Скорость v = ${fmt(v,3)} м/с`];
 if(heat) lines.push(O.rHeat(R));
 else lines.push(`i = ${fmt(i,3)} м/м` + (O.iWith1000?`  (1000i = ${fmt(i*1000,3)} мм/м)`:''),
                 `удельные потери давления R = ${fmt3(R)} Па/м`);
 const outH=[`Потери напора на участке H = i·L + V²Σξ/2g = ${fmt3(H)} м`, (heat?O.dPHeat:O.dP)(P_dP)];
 if(heat && O.drop) outH.push(O.drop(P_dP));
 const notes=[];
 if(v>S.lim){ notes.push({cls:'warn',text:'Большая скорость! Рекомендуется увеличить диаметр'});
              notes.push({cls:'warn',text:S.note}); }
 return {ok:true,q:b.q,qunit:inp.qunit,v,i,i1000:i*1000,R,H,P:P_dP,Z,xi,dv_mm:b.dv,L:b.L,rho,nu,sys,
   hLegend:'Потери напора на участке, м',lines,outH,notes};
}

/* ─── главный вход движка: вход — числа, выход — объект; DOM не трогает ───
   inp = {mat, wear, dv_mm, q, qunit, L, k, mest, nu, rho, mode, selD, dpOf}
   dpOf(d) нужен только материалам с рядом рекомендации (сталь, э/с, чугун, пластик). */
function shevCalc(inp){
 const mat=inp.mat, m=matOf(mat), sys=usesSys(mat), kused=usesK(mat);
 // СП-семейство (медь, PEX, PEX-AL-PEX и любая следующая такая страница) объявляет себя
 // признаком page.kind='sp' и приносит карту систем, формулу и теплоноситель с собой.
 if(m && m.page && m.page.kind==='sp') return spCalc(inp,m);
 const b=validate(inp,ERR); if(!b.ok) return b;
 const dv=b.dv, L=b.L, q=b.q;
 let k=kused?((isNaN(inp.k)?0:inp.k)||0):0;
 if(kused){
  if(k<0) return {ok:false,error:'коэффициент местных сопротивлений k не может быть отрицательным!'};
  if(!inp.mest) k=0; // «учесть потери на местные сопротивления» выключен — k не применяется
 }
 if(sys && isNaN(inp.nu)) return {ok:false,error:'Вы не ввели значение коэффициента кинематической вязкости теплоносителя!'};
 // на страницах без блока «теплоноситель» ρ фиксирована (1000, t=10 °C) — поле UI не участвует
 const rho=sys?((!isNaN(inp.rho)&&inp.rho>0)?inp.rho:RHO_FIX):RHO_FIX;

 const v=velocity(q,dv);
 const g=iOf(mat,inp.wear,v,dv,inp.nu,inp.sys); const A=g.A,e=g.e,i=g.i;
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

/* ─── ПУБЛИЧНЫЙ ВЫЗОВ В ТРИ ШАГА (без DOM: скрипты, агенты, WebMCP) ───
   ЕДИНИЦЫ — часть контракта, переключателя единиц в аргументах НЕТ:
     расход Q        — м³/с (СИ);
     диаметры dу/dн/dв — мм (так считает и печатает оригинал, так же в ГОСТах и справке);
     v — м/с, i — м/м, R — Па/м, H — м, потери давления — Па, ν — м²/с, ρ — кг/м³.
   Перевод в СИ — отдельная функция: qToM3s(Q,'ls'|'mh') превращает л/с или м³/ч в м³/с.
   Замысел: выбор материала отделён от физики, скорость — одна на все 12 страниц, потери — две семьи.
     pipeDv(mat, sel, d)           слой материала: dу/dн → расчётный dв (единственный закон, page.dvOf);
                                  sel = {S, wear, cls, vt, tip, pe, sdr, sdr100, series} — нужные поля
     calcVelocity(dv_mm, q_m3s)   dв + расход (м³/с) → v; больше ничего не нужно — ни ν, ни ρ, ни режим
     lossesShevelev({law,…})       потери ШЕВЕЛЕВСКОЙ семьи — от материала отвязаны, нужна строка-закон
     lossesSP({page|mat,…})        потери СП-семейства (медь, PEX, ПЭ-AL-PEX) — нужна СП-страница
     calcLosses({mat,…})           то же через диспетчер, если семейство знать не нужно
   Расход можно не передавать, если скорость уже посчитана: принимается v напрямую. */
function pipeDv(mat,sel,d){
 const m=matOf(mat);
 if(!m||!m.page||!m.page.dvOf) return NaN;
 return m.page.dvOf(sel||{},+d);
}
/* Тот же порядок аргументов, что у низкоуровневой velocity(q, dv): расход первым. */
function calcVelocity(dv_mm,q_m3s){ return isNaN(q_m3s)?NaN:velocity(q_m3s,dv_mm) }

/* ─── ПОТЕРИ, ДВЕ СЕМЬИ ОТДЕЛЬНО ───
   Вход и выход у них одинаковые (dв мм + скорость v м/с или расход q м³/с → i м/м, R Па/м,
   при L м → H м и потери давления Па). Различается только то, ОТ ЧЕГО считает каждая:

   1) lossesShevelev({law, …}) — ШЕВЕЛЕВСКАЯ семья (сталь, э/с, чугун, а/ц, ж/б, пластик, ПЭ 100,
      стекло, стеклопластик): i = A·v²/d^e. Отвязана от материала полностью — достаточно СТРОКИ
      с названием закона (те же строки, что в iCalc): 'steel'|'ci'|'asbes'|'conc'|'plastic'|'pex'
      |'pe100'|'grp'|'glass'. Ни реестра MATERIALS, ни страницы, ни DOM: в гидравлике закон и ЕСТЬ
      материал — у чугуна и у стали разные A и e, а сортамент тут ни при чём. ν/ρ/k в этой семье
      есть только у закона 'steel' — как и в окне, где блок стоит лишь на стальных страницах.

   2) lossesSP({page|mat, …}) — СП-СЕМЕЙСТВО (медь, PEX, ПЭ-AL-PEX): λ считается по СП, ветка
      выбирается системой, местные сопротивления — Σξ, а не k. Отвязать от материала НЕЛЬЗЯ:
      формула, карта систем и таблица ν/ρ лежат в данных страницы (page.loss / page.sys /
      page.fluid) — у меди три ветки и Кэ=10⁻⁵, у PEX одна и Кэ=10⁻⁶. Поэтому принимается либо
      page (без реестра), либо mat — id, тогда страница ищется сама.

   calcLosses({mat,…}) — диспетчер для тех, кому знать семейство не нужно (окно, WebMCP):
   смотрит признак page.kind='sp'. ν/ρ/k/xi необязательны, умолчания те же, что в окне.
   Ни валидации текстами, ни строки рекомендации, ни предупреждений: это не shevCalc. */

/* Общий разбор входа обеих функций — одна проверка, чтобы ошибки границы совпадали. */
function lossesIn(inp){
 const dv=inp.dv_mm;
 if(isNaN(dv)||dv<=0) return {ok:false,error:'нужен расчётный внутренний диаметр dv_mm (см. pipeDv)'};
 const v=(inp.v!==undefined&&!isNaN(inp.v))?inp.v:calcVelocity(dv,inp.q);
 if(isNaN(v)||v<=0) return {ok:false,error:'нужна скорость v или расход q: по одному dв потери не считаются'};
 const L=inp.L, hasL=!isNaN(L)&&L>0;
 return {ok:true,v,d:dv/1000,dv,L:hasL?L:null,hasL};
}
function lossesShevelev(inp){
 const law=inp.law||inp.mat;
 if(!law) return {ok:false,error:'нужен закон: law (steel|ci|asbes|conc|plastic|pex|pe100|grp|glass)'};
 const b=lossesIn(inp); if(!b.ok) return b;
 const hot=law==='steel'||law==='steel-es';
 const rho=hot?((!isNaN(inp.rho)&&inp.rho>0)?inp.rho:RHO_FIX):RHO_FIX;
 let k=hot?(isNaN(inp.k)?0:(inp.k||0)):0;
 if(inp.mest===false) k=0; // в окне снятая галка обнуляет k; здесь opt-out явный
 const g=iOf(law,inp.wear,b.v,b.dv,inp.nu,inp.sys), R=pressure(g.i,rho);
 const out=Object.assign({i:g.i,i1000:g.i*1000,A:g.A,e:g.e,R,k,rho,xi:0,law},{v:b.v,dv_mm:b.dv,L:b.L});
 if(b.hasL) Object.assign(out,{H:head(g.i,b.L,k), P:R*b.L*(1+k)});
 return Object.assign({ok:true},out);
}
function lossesSP(inp){
 const P=inp.page||(inp.mat&&matOf(inp.mat)||{}).page;
 if(!P||!P.loss) return {ok:false,error:'нужна СП-страница: page (или mat: copper|pex|metal-pex)'};
 const b=lossesIn(inp); if(!b.ok) return b;
 const map=P.sys, sys=(inp.cuSys&&map[inp.cuSys])?inp.cuSys:'cold', S=map[sys];
 let nu=inp.cuNu, rho=inp.cuRho;
 if(S.cold){ nu=NU_FIX; rho=RHO_FIX; }
 else if(S.heat&&inp.cool==='other'){ // ручной теплоноситель — только для систем отопления
  if(isNaN(nu)||nu<=0) return {ok:false,error:'Вы не ввели значение коэффициента кинематической вязкости теплоностеля'};
  if(isNaN(rho)||rho<=0) return {ok:false,error:'Вы не ввели значение плотности тепноностеля!'};
 } else { // «вода»: таблица страницы (page.fluid) по температуре — так же, как в окне
  const f=P.fluid(S,isNaN(inp.t)?null:inp.t);
  if(f){ if(isNaN(nu)) nu=f.nu; if(isNaN(rho)||rho<=0) rho=f.rho; }
 }
 if(isNaN(nu)||nu<=0) nu=NU_FIX;
 if(isNaN(rho)||rho<=0) rho=RHO_FIX;
 const {i,R}=P.loss(S,nu,b.v,b.d,rho,inp.pexSp);
 const xi=isNaN(inp.xiSum)?0:inp.xiSum;
 const out=Object.assign({i,i1000:i*1000,R,xi,nu,rho,sys,heat:!!S.heat},{v:b.v,dv_mm:b.dv,L:b.L});
 if(b.hasL) Object.assign(out,{Z:0.5*rho*b.v*b.v*xi, H:i*b.L+b.v*b.v*xi/G2, P:R*b.L+0.5*rho*b.v*b.v*xi});
 return Object.assign({ok:true},out);
}
/* Диспетчер: кому не нужно знать семейство — тот зовёт это (окно, WebMCP). */
function calcLosses(inp){
 const m=inp.mat&&matOf(inp.mat);
 if(!m) return {ok:false,error:'неизвестный материал: '+inp.mat};
 return (m.page&&m.page.kind==='sp')?lossesSP(inp):lossesShevelev(inp);
}

/* экспорт для node-тестов (в браузере window есть, в node — global) */
if (typeof module!=='undefined' && module.exports){
 module.exports={fmt,fmt2,qToM3s,velocity,gradient,iOf,pressure,head,NU_FIX,RHO_FIX,spCalc,
   NO_SYS,NO_WEAR,matOf,usesSys,usesWear,usesCu,usesK,ciLimits,speedNotes,recommendation,shevCalc,
   pipeDv,calcVelocity,lossesShevelev,lossesSP,calcLosses};
}
