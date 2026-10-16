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
   водоснабжения» + Label21 «t=» «°C» + Check2 «учесть потери на местные сопротивления»).

   ─── КАК ЧИТАТЬ ДВИЖОК: путь к числу ───
   Три слоя, подключаются именно в этом порядке (тот же порядок <script> в index.html):
     1) js/data/<мат>.js — ТАБЛИЦЫ И ФАКТЫ СТРАНИЦЫ. Ряды dн/S, серии, классы, таблицы ν/ρ,
        список ξ, закон расчётного dв (page.dvOf), подписи строк вывода. Ни одного вычисления:
        всё знание о материале живёт здесь, поэтому четвёртая такая страница = один новый файл.
     2) js/formulas.js — ФОРМУЛЫ И КОНСТАНТЫ ПРОГРАММЫ: i = A·v²/d^e по имени закона, λ
        СП-семейства, g. У каждой — комментарий с формулой и ссылкой на реверс.
     3) этот файл — РАСЧЁТ: единицы → v → i → R → H → потери давления → строки вывода.
   Главный вход shevCalc(inp) ветвит по ТАБЛИЦЕ CALC_TREE (внизу): это данные, а не картинка —
   движок идёт по ним, и у каждой ветки своё поле why, где сказано, когда она срабатывает.
   Что подставляет ОКНО, а что ДВИЖОК: ν и ρ считает движок (shevFluid/spFluid читают таблицы
   страницы — ровно как это делает окно), k приходит полем, режим и флаг «учесть потери на
   местные сопротивления» — тоже вход, а порог, по которому блок местных гаснет, объявляет
   страница (page.mestLimit). Правдоподобие расхода ловит unit_suspect.
   Пример прямого вызова: calcLosses({mat:'plastic',dv_mm:76,q:10,qunit:'ls',L:50})
   (вместо q/qunit можно передать готовый q_m3s). */
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
 const d=dp_mm/1000; const {A,e,law}=iCalc(wear,mat,v,d,sys);
 return {A,e,law,i:A*v*v/Math.pow(d,e)};
}
/* ─── удельные потери веткой материала ───
   сталь/э/с — точные формулы EXE (ν входит: агент const-check, 10.10.2026), остальные — степенная
   модель i = A·v²/d^e из gradient(). Одно место и для окна, и для внешнего calcLosses: копия этого
   правила уже разводила расчёт с выводом страницы. */
function iOf(mat,wear,v,dv_mm,nu,sys){
 if(mat==='steel'||mat==='steel-es'){                       // сталь и э/с: формулы EXE (5)–(7)
  const d=dv_mm/1000, g=steelI(v,d,(!isNaN(nu)&&nu>0)?nu:NU_FIX,wear);
  return {A:g.i/(v*v/Math.pow(d,1.3)), e:1.3, law:g.law, i:g.i};
 }
 return gradient(mat,wear,v,dv_mm,sys);
}
/* ─── R = ρ·g·i (Па/м) и H = i·L·(1+k) (м) ─── */
function pressure(i,rho){ return i*(rho||RHO_FIX)*G }   // g одно на программу (см. G в formulas.js)
function head(i,L,k){ return i*L*(1+(k||0)) }
/* Правдоподобие расхода: выше 50 м/с у программы не бывает (максимум живых точек EXE — 35,315
   м/с у а/ц), а получается ровно при передаче расхода в м³/с вместо л/с (ошибка ×1000).
   Поле возвращают все пути расчёта; ОКНО его не печатает — в оригинале такой строки нет,
   видят его агенты: WebMCP (echo().result.unit_suspect) и те, кто читает движок. */
function unitSuspect(v){ return v>50
  ? `v=${fmt(v,1)} м/с — похоже, расход передан в м³/с вместо л/с (ошибка ×1000); в программе больше 35 м/с не бывает`
  : null; }

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
   Рекомендуется уменьшить диаметр», пороги по диаметру 0,8…2 / 1…3 / 1,5…4. Границы полос
   сняты живой программой 14.10.2026 (кадры tmp/wine/pts/, таблица materials/ci_points.json):
   dp=250 v=0,815 → без предупреждения (p20), dp=251 v=0,889 → «Малая» (p28) — нижняя граница
   ровно 250 (прежнее «200» из 05.10.2026 опровергнуто); dp=799 v=1,201 → без предупреждения
   (p25), dp=800 v=1,200 → «Малая» (p27) — верхняя граница ровно 800; hi подтверждён точками
   p30 (300/2,504 → нет) и p7 (351,4/4,101 → «Большая»);
   сталь/э/с (FUN_0047e8d0, FUN_004a22c0): «Внимание! Скорость больше 3 м/с…» и «…10 м/с…»;
   в клоне пороги берутся из режима (VEL_LIMIT), пороги 3/10 в EXE зафиксированы, режим задаёт k.
   а/ц, пластик, PEX, ж/б, стеклопластик, стекло (FUN_0050a140, FUN_0050daf0 и др.): строк
   предупреждения в функции расчёта НЕТ — их нет и в клоне. */
/* Полосы скорости чугуна — границы 250/800, живые точки p20/p28 (250/251) и p25/p27 (799/800),
   tmp/wine/pts/*.png + materials/ci_points.json; декомпиляции не использовались. */
function ciLimits(dv_mm){ return dv_mm<=250?[0.8,2]:(dv_mm<800?[1,3]:[1.5,4]) }
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
   : o.decComma
   ? `${vbsc(qls)}л/сек =${vbsc(m3)}м куб/ч`      // ж/б: запятая и в числе («=118,8м куб/ч,»)
   : `${vbs(qls)}л/сек =${vbs(m3)}м куб/ч`;      // а/ц: точка («=28.8м куб/ч »)
 const pre=`При расходе ${nums}${o.comma?', ':' '}`;   // красная строка: общий префикс EXE 0x444fd8 «При расходе »; ж/б ставит ЗАПЯТУЮ после «м куб/ч» («…=1800м куб/ч, рекомендуется…», кадр recA_q20), а/ц и пластик — пробел
 const first=rows[0], last=rows[rows.length-1];
 const bq=o.belowQ===undefined?5:o.belowQ;   // а/ц — 5 (ветка `If Q < 5` @0x4cb9c9); ж/б — 36 л/с:
   // при Q=35 строка «меньше 500мм» есть (recA_q35), при Q=РОВНО 36 полосы нет (recA_q36), при 37 нет
   // (recA_q37) — та же строгая дырка, что у а/ц на Q=5
 if(o.below!==false && qls<bq)
   return {cls:'warn',text:pre+`рекомендуется использовать трубу ${word} ${o.belowWord||'менее'} ${first[0]}мм`};
   // у ж/б в EXE своё слово: «…условным проходом МЕНЬШЕ 500мм» (кадр recA_q20), у а/ц — «менее 100мм»
 if(o.five!==false && qls===bq) return null;   // дырка оригинала а/ц (строгие неравенства), проверено живьём
 if(qls>last[1]) return {cls:'warn',text:o.overflow
   ? 'Большая скорость! '+o.overflow
   : `Большая скорость! `+pre+`рекомендуется использовать трубу с диаметром более ${last[0]}мм`};
 let opt=null;
 for(const [du,qmax] of rows){ if(qls<=qmax){ opt=du; break; } }
 if(opt===null) return null;
 // ж/б: подписей строки для 500мм в EXE НЕТ (группа 0x46c28…0x47434 начинается с 600, ниже только
 // «меньше 500мм» 0x46ba0) → при оптимуме 500 полоса пустая целиком. Живьём: conc_p03 (500/Q70),
 // conc_p07 (600/Q70), conc_p10 (700/Q100), conc_p12, p14, p16, p22 — во всех пусто, и при opt=500
 // строки нет ни для какого выбранного диаметра.
 if(o.noFirstLine && opt===first[0]) return null;
 // зелёная строка — своя строка EXE на каждый диаметр: «Применение трубы … Nмм при расходе » (0x445130),
 // «при» здесь СТРОЧНАЯ (у общего префикса 0x444fd8 — заглавная)
 if(opt===selD) return {cls:'ok',text:`Применение трубы ${word} ${opt}мм при расходе ${nums} экономически обосновано${o.okDot?'.':''}`};
   // точка в конце — только у ж/б (кадр recB_d800_q700: «…экономически обосновано.»)
 return {cls:'warn',text:pre+`рекомендуется использовать трубу ${word} ${opt}мм`};
}

/* ─── строка рекомендации: есть только у страниц с page.rec (а/ц, пластик, ПЭ 100, ж/б) ───
   Правило одно — РЯД ПРЕДЕЛЬНЫХ ЭКОНОМИЧЕСКИХ РАСХОДОВ (кн. Шевелевых 1984, табл. 12), см.
   recRanges() выше. Прежняя ветка 'vel' («первый ряд с v ≤ VREC = 1,02 м/с») удалена 15.10.2026:
   живой оригинал на стали, э/с и чугуне строку рекомендации не печатает вообще (5 кадров стали
   recC_*, 2 кадра э/с recD_*, 10 кадров чугуна), а на ж/б ряд предельных расходов даёт 26/26
   против 4/26 у порога скорости. dpOf(d) замыкает ui.js: расчётный dp ряда зависит от стенки
   (газовые/э/с), класса и «неновые» (чугун), SDR (ПЭ). */
function recommendation(mat,wear,q_m3s,selD,dpOf){
 const m=matOf(mat), rec=m&&m.page&&m.page.rec;
 if(!rec) return null;
 if(rec.mode==='ranges'){
   // ж/б: «Большая скорость!» включается по скорости ВЫБРАННОЙ трубы, а не по пределу ряда: книжный
   // верх 1600 (6742 л/с, «прокладка второй нитки», стр. 27) программой не используется. Граница
   // зажата живыми точками: v=4,937 (conc_v494) — строки нет, v=5,034 (conc_v504) — есть, т.е. 5 м/с.
   if(rec.vmax && dpOf){ const dp=dpOf(selD); if(!isNaN(dp) && velocity(q_m3s,dp)>rec.vmax)
     return {cls:'warn',text:'Большая скорость! '+(rec.opts&&rec.opts.overflow(q_m3s))}; }
   return recRanges(q_m3s,selD,rec.rows,rec.opts);
 }
 return null;        // mode:'vel' в клоне больше не используется (см. шапку функции)
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
/* ν и ρ теплоносителя СП-семейства — ОДНО место на оба пути (окно и движок). Именно этим
   закрыта ловушка, найденная замером агентов 14.10.2026: раньше значения писал в поля формы
   ui.js (spHeatSync), а движок их не искал, и прямой вызов shevCalc на меди при t=80 давал
   ν=1,3·10⁻⁶ вместо 0,36·10⁻⁶ — R завышен на 23 % (303,435 вместо живых 246,154 Па/м).
     S.cold                   — «холодного водоснабжения»: Frame4/Frame5 неактивны, программа
                                берёт воду 10 °C (ν=1,3·10⁻⁶, DAT_00402448; ρ=1000);
     S.heat && cool==='other' — ручной теплоноситель Frame5 (только при отоплении): значения
                                полей, проверку «введены ли» делает вызывающий (тексты прежние);
     иначе                    — «вода»: таблица страницы page.fluid по температуре inp.t; при
                                t<50 строки нет (СП 40-108 начинает таблицу с t=50) → умолчания.
   Явно заданные inp.cuNu/inp.cuRho всегда побеждают таблицу — так поступает и окно. */
function spFluid(P,S,inp){
 const num=v=>(v===null||v===undefined||v==='')?NaN:+v;
 let nu=num(inp.cuNu), rho=num(inp.cuRho);
 if(S.cold) return {nu:NU_FIX, rho:RHO_FIX};
 if(S.heat && inp.cool==='other') return {nu, rho, manual:true};
 if(isNaN(nu)||isNaN(rho)||!(rho>0)){
  const f=P.fluid(S, isNaN(inp.t)?null:inp.t);
  if(f){ if(isNaN(nu)) nu=f.nu; if(isNaN(rho)||!(rho>0)) rho=f.rho; } }
 if(isNaN(nu)||nu<=0) nu=NU_FIX;
 if(isNaN(rho)||!(rho>0)) rho=RHO_FIX;
 return {nu, rho};
}
/* Детали СП-СЕМЕЙСТВА (медь frmtablII9, PEX frmtablII10, PEX-AL-PEX). Тот же список стадий,
   другие пять деталей: система приходит из Frame2, формула и R — из page.loss, теплоноситель —
   из page.fluid (spFluid), местные сопротивления — Σξ (Frame6) отдельным слагаемым, а не k. */
const DETAIL_SP={
 fluid:c=>{ const F=spFluid(c.m.page,c.S,c);
  if(F.manual){ // Frame5 «Теплоноситель» активен только при системе отопления; для ГВС ручной недоступен
   if(isNaN(F.nu)||F.nu<=0) return {ok:false,error:'Вы не ввели значение коэффициента кинематической вязкости тепноностеля'};
   if(isNaN(F.rho)||F.rho<=0) return {ok:false,error:'Вы не ввели значение плотности теплоностеля!'}; }
  return {nu:F.nu,rho:F.rho,k:0}; },
 law:c=>{ const g=c.m.page.loss(c.S,c.nu,c.v,c.dv_mm/1000,c.rho,c.pexSp);
  return {i:g.i,i1000:g.i*1000,R:g.R,law:g.law}; },
 head:c=>({H:c.i*c.L + c.v*c.v*c.xi/(2*G)}),
 losses:c=>({P:c.R*c.L + 0.5*c.rho*c.v*c.v*c.xi}),
 print:c=>{ const {v,i,i1000,R,H,P,S}=c, O=c.m.page.out||{}, heat=!!S.heat;
  // Строки вывода собирает движок, но ТЕКСТЫ и формат задаёт страница (page.out) — у меди и PEX
  // шаблоны форм разные, и это не косметика: живой скрин 08.10.2026 (525,819 · 326,02 · 32602,001).
  const lines=[`Скорость v = ${fmt(v,3)} м/с`];
  if(heat) lines.push(O.rHeat(R));
  else lines.push(`i = ${fmt(i,3)} м/м` + (O.iWith1000?`  (1000i = ${fmt(i1000,3)} мм/м)`:''),
                   `удельные потери давления R = ${fmt3(R)} Па/м`);
  const outH=[`Потери напора на участке H = i·L + V²Σξ/2g = ${fmt3(H)} м`, (heat?O.dPHeat:O.dP)(P)];
  if(heat && O.drop) outH.push(O.drop(P));
  return {lines,outH}; } };

function calcSP(inp,m){
 const map=m.page.sys, sys=map[inp.cuSys]?inp.cuSys:'cold', S=map[sys];
 // ошибки в СП-семействе свои (ERR_SP) и температура обязательна там, где система это требует
 const errs=Object.assign({},ERR,{qNaN:ERR_SP.qNaN,qNeg:ERR_SP.qNeg,qZero:ERR_SP.qZero,
   LNaN:ERR_SP.LNaN,LNeg:ERR_SP.LNeg,LZero:ERR_SP.LZero});
 if(S.t && isNaN(inp.t))
  return {ok:false,error:'Вы не ввели температуру! Для систем горячего водоснабжения рекомендуется t=60°С. Введите значение температуры, в °С'};
 const c=Object.assign({},inp,{m,S,sys,xi:isNaN(inp.xiSum)?0:inp.xiSum,errs,detail:DETAIL_SP,
   wantLines:true,needQ:true});
 const r=runStages(c); if(!r.ok) return r;
 const notes=[];
 if(c.v>S.lim){ notes.push({cls:'warn',text:'Большая скорость! Рекомендуется увеличить диаметр'});
              notes.push({cls:'warn',text:S.note}); }
 return {ok:true,q:c.q_m3s,qunit:inp.qunit,v:c.v,i:c.i,i1000:c.i1000,R:c.R,law:c.law,H:c.H,P:c.P,
   Z:0.5*c.rho*c.v*c.v*c.xi,xi:c.xi,dv_mm:c.dv_mm,L:c.L,rho:c.rho,nu:c.nu,sys:sys,
   unit_suspect:unitSuspect(c.v),hLegend:'Потери напора на участке, м',
   lines:c.lines,outH:c.outH,notes,trace:c.trace};
}

/* ─── ДЕРЕВО РАСЧЁТА: главный вход идёт по этим данным, а не по разбросанным if.
   Узлы проверяются сверху вниз, побеждает первый с истинным test; поле why читается рядом с
   кодом, который эту ветку выполняет, — поэтому описание не разойдётся с поведением. */
const CALC_TREE=[
 {id:'sp', test:m=>!!(m&&m.page&&m.page.kind==='sp'), go:calcSP,
  why:'СП-семейство (медь frmtablII9, PEX frmtablII10, PEX-AL-PEX): формулу, Кэ и подписи приносит page.loss, ν/ρ — page.fluid через spFluid, местные сопротивления — Σξ вместо k'},
 {id:'steel', test:m=>usesSys(m.id), go:calcShevelev,
  why:'сталь и электросварные: блок «Режим / теплоноситель» есть — ν обязательна, ρ из поля, k из значения, снятая галка обнуляет его (порог диаметра объявляет page.mestLimit)'},
 {id:'shevelev', test:()=>true, go:calcShevelev,
  why:'чугун, а/ц, пластик, ПЭ 100, ж/б, стеклопластик, стекло: блока нет — ν=1,3·10⁻⁶, ρ=1000, k≡0 (H = i·L); формула i = A·v²/d^e по имени закона из iCalc'}];

/* ν, ρ и k ШЕВЕЛЕВСКОЙ семьи — как в окне, в одном месте. Сталь и электросварные: блок
   «Режим / теплоноситель» есть (ν обязательна, ρ иначе 1000), k — из переданного значения и
   обнуляется снятой галочкой «учесть потери на местные сопротивления». Остальные семь страниц:
   блока нет вовсе — H = i·L, строки k в выводе нет, k≡0. */
function shevFluid(inp,m){
 if(!usesK(m.id)) return {nu:inp.nu, rho:RHO_FIX, k:0};
 const k=(isNaN(inp.k)?0:inp.k)||0;
 if(k<0) return {err:{ok:false,error:'коэффициент местных сопротивлений k не может быть отрицательным!'}};
 if(isNaN(inp.nu)) return {err:{ok:false,error:'Вы не ввели значение коэффициента кинематической вязкости теплоносителя!'}};
 return {nu:inp.nu, rho:(!isNaN(inp.rho)&&inp.rho>0)?inp.rho:RHO_FIX, k:inp.mest?k:0};
}

/* ─── РАСЧЁТ СПИСКОМ СТАДИЙ ────────────────────────────────────────────────────────────────
   Списание расчёта — данные: у каждой стадии написано, что она берёт (from), что кладёт (to) и
   зачем она (why). Одна функция runStages идёт по списку и делает шаги, попутно ЗАПИСЫВАЯ
   пройденный путь в ctx.trace. Поэтому описание расчёта и сам расчёт не могут разойтись —
   это ровно та вторая правда, которую мы убрали вместе с агентским входом на CLI.
   Различие семейств не в списке, а в том, что в него положили: ctx.detail — пять деталей
   (откуда ν/ρ/k, чем считать i, как считать H и ΔP, какими словами печатать). Список один. */
const STAGES=[
 {id:'validate', from:[], to:['q_m3s','dv_mm','L'],
  why:'проверка ввода: расход обязателен для окна, а для потерь достаточно dв и (v или расхода); длина необязательна',
  run:c=>{
   if(!c.needQ){                                          // потери снаружи: нужен dв и v либо q_m3s
    const hasV=(c.v!==undefined&&!isNaN(c.v)), hasQ=!isNaN(c.q_m3s)&&c.q_m3s>0;
    if(!hasV&&!hasQ) return {ok:false,error:'нужна скорость v или расход q_m3s (м³/с): по одному dв потери не считаются'};
    const L=c.L, hasL=!isNaN(L)&&L>0;
    return {dv_mm:c.dv_mm,L:hasL?L:null,hasL}; }
   const b=validate(c,c.errs||ERR); if(!b.ok) return b;   // окно: полная проверка, тексты семейства
   return {q_m3s:b.q,dv_mm:b.dv,L:b.L}; }},
 {id:'velocity', from:['dv_mm'], to:['v'],
  why:'v = Q/(π·dв²/4) — только расход и диаметр; если v уже дана вызывающим, берётся она',
  run:c=>({v:(c.v!==undefined&&!isNaN(c.v))?c.v:velocity(c.q_m3s,c.dv_mm)})},
 {id:'fluid',    hook:'fluid',  from:[], to:['nu','rho','k'],
  why:'откуда ν, ρ и k — знает страница: shevFluid (блок «Режим») или spFluid (page.fluid)'},
 {id:'i',        hook:'law',    from:['v','dv_mm','nu','rho'], opt:['nu'], to:['i','i1000','A','e','law'],
  why:'уклон: i = A·v²/d^e по имени закона (iCalc) либо λ СП (page.loss) — отсюда и law'},
 // R: у Шевелевской семьи он считается из i (R = ρ·g·i), у СП-семейства формула отдаёт R сама
 // (λ уже входит в неё) — тогда чужий не перетираем.
 {id:'pressure', from:['i','rho'], to:['R'], why:'удельные потери давления R [Па/м]',
  run:c=>({R:c.R!==undefined?c.R:pressure(c.i,c.rho)})},
 {id:'head',     hook:'head',   from:['i','L','k'], to:['H'], skip:c=>c.hasL===false,
  why:'потери напора: i·L·(1+k), а где местных сопротивлений нет k≡0 → i·L'},
 {id:'losses',   hook:'losses', from:['R','L','k'], to:['P'], skip:c=>c.hasL===false,
  why:'потери давления: R·L·(1+k); в СП-семействе добавляется Z = 0,5·ρ·V²·Σξ'},
 {id:'lines',    hook:'print',  from:['v','i','R','H','P'], to:[], skip:c=>!c.wantLines,
  why:'строки вывода окна — их тексты и формат задаёт страница (page.out)'}];
function runStages(ctx){
 const trace=ctx.trace=[];
 for(const st of STAGES){
  if(st.skip&&st.skip(ctx)){ trace.push({id:st.id,skipped:'нет данных: нечего считать'}); continue; }
  const miss=st.from.filter(k=>ctx[k]===undefined && !(st.opt||[]).includes(k));
  if(miss.length) return {ok:false,error:'стадия '+st.id+': не хватает значения '+miss.join(', ')};
  const r=st.hook?ctx.detail[st.hook](ctx):st.run(ctx);
  if(r&&r.ok===false) return r;         // ошибка ввода/расчёта — дальше не идём
  Object.assign(ctx,r);                 // что стадия положила в контекст
  trace.push({id:st.id,from:st.from,to:st.to,why:st.why});
 }
 return {ok:true};
}

/* Детали ШЕВЕЛЕВСКОЙ семьи: блок «Режим / теплоноситель» есть только на стали и
   электросварных (usesK), ν обязательна, k обнуляется снятой галкой, ΔP = R·L·(1+k). */
const DETAIL_SHEVELEV={
 fluid:c=>{ const F=shevFluid(c,c.m); if(F.err) return F.err; return {nu:F.nu,rho:F.rho,k:F.k}; },
 law:c=>{ const g=iOf(c.m.id,c.wear,c.v,c.dv_mm,c.nu,c.sys); return {i:g.i,i1000:g.i*1000,A:g.A,e:g.e,law:g.law}; },
 head:c=>({H:head(c.i,c.L,c.k)}),
 losses:c=>({P:c.R*c.L*(1+c.k)}),
 print:c=>{ const {v,i,i1000,R,H,P,k}=c, kused=usesK(c.m.id);
  return { lines:[
    `Скорость v = ${fmt(v,3)} м/с`,
    // 1000i — как в программе: rtcRound(1000·i,3) без лишних нулей (FUN_0047e8d0, FUN_004a22c0,
    // FUN_004ae2c0, FUN_0050a140, FUN_0050daf0); скрин стеклопластика 43,344; ж/б 0,151
    `i = ${fmt(i1000,3)} мм/м  (1000i = ${fmt(i1000,3)})`,
    `удельные потери давления R = ${fmt(R,1)} Па/м`],
   // блок «Потери напора…» — как в программе: где местных сопротивлений нет (kused=false) —
   // «по длине», H = i·L, строки k нет; где есть — «на участке», H = i·L·(1+k) и строка k
   outH:(kused?[`k = ${fmt(k,2)}`]:[]).concat([
    `Потери напора ${kused?'на участке':'по длине'} H = i·L${kused?'·(1+k)':''} = ${fmt(H,3)} м`,
    `потери давления = ${fmt(P,0)} Па`]) }; } };

/* ─── главный вход движка: вход — числа, выход — объект; DOM не трогает ───
   inp = {mat, wear, dv_mm, q, qunit, L, k, mest, nu, rho, mode, selD, dpOf}
   dpOf(d) нужен только материалам с рядом рекомендации (сталь, э/с, чугун, пластик).
   СП-семейство дополнительно читает cuSys, t, cool, cuNu, cuRho, xiSum, pexSp. */
function shevCalc(inp){
 const m=matOf(inp.mat);
 if(!m) return {ok:false,error:'неизвестный материал: '+inp.mat};
 return CALC_TREE.find(n=>n.test(m)).go(inp,m);
}

function calcShevelev(inp,m){
 const c=Object.assign({},inp,{m,detail:DETAIL_SHEVELEV,wantLines:true,needQ:true});
 const r=runStages(c); if(!r.ok) return r;
 const notes=speedNotes(m.id,c.dv_mm,c.v,inp.mode);
 const rec=recommendation(m.id,inp.wear,c.q_m3s,inp.selD,
   // dpOf замыкает ui.js (это page.dvOf). Если страница его не передала, известен хотя бы
   // расчётный диаметр ВЫБРАННОЙ трубы — его хватает проверке vmax (ж/б) и ряду из одного ряда.
   inp.dpOf||(d=>d===inp.selD?c.dv_mm:NaN));
 if(rec) notes.push(rec);
 return {ok:true,q:c.q_m3s,qunit:inp.qunit,v:c.v,i:c.i,i1000:c.i1000,A:c.A,e:c.e,law:c.law,
   R:c.R,H:c.H,P:c.P,k:c.k,dv_mm:c.dv_mm,L:c.L,rho:c.rho,
   unit_suspect:unitSuspect(c.v),
   hLegend:usesK(m.id)?'Потери напора на участке, м':'Потери напора по длине, м',
   lines:c.lines,outH:c.outH,notes,trace:c.trace};
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
/* ─── ПОТЕРИ ОТДЕЛЬНО: те же стадии, но для вызывающего снаружи ───
   lossesShevelev (строка-закон, реестр не нужен) и lossesSP (обязательно СП-страница) идут по
   ТОМУ ЖЕ списку STAGES: скорость либо уже дана, либо считается из q_m3s; длина может отсутствовать
   (тогда стадии head/losses пропускаются); строки окна не печатаются. Отличие от окна только в
   границе входа — здесь mest выключается явно (mest:false), а не галочкой, — поэтому у них свои
   детали, но своя арифметика им не нужна. */
const LOSS_SHEVELEV={
 fluid:c=>{ const hot=(c.fam==='steel'||c.fam==='steel-es');
  let k=hot?((isNaN(c.k)?0:c.k)||0):0;
  if(c.mest===false) k=0;                       // в окне снятая галка обнуляет k; здесь opt-out явный
  return {nu:c.nu, rho:hot?((!isNaN(c.rho)&&c.rho>0)?c.rho:RHO_FIX):RHO_FIX, k}; },
 law:c=>{ const g=iOf(c.fam,c.wear,c.v,c.dv_mm,c.nu,c.sys); return {i:g.i,i1000:g.i*1000,A:g.A,e:g.e,law:g.law}; },
 head:c=>({H:head(c.i,c.L,c.k)}),
 losses:c=>({P:c.R*c.L*(1+c.k)}),
 print:c=>({})};
const LOSS_SP={
 fluid:c=>{ const F=spFluid(c.page,c.S,c);
  if(F.manual&&(isNaN(F.nu)||F.nu<=0)) return {ok:false,error:'Вы не ввели значение коэффициента кинематической вязкости теплостотеля'};
  return {nu:F.nu,rho:F.rho,k:0}; },
 law:c=>{ const g=c.page.loss(c.S,c.nu,c.v,c.dv_mm/1000,c.rho,c.pexSp); return {i:g.i,i1000:g.i*1000,R:g.R,law:g.law}; },
 head:c=>({H:c.i*c.L + c.v*c.v*c.xi/(2*G)}),
 losses:c=>({P:c.R*c.L + 0.5*c.rho*c.v*c.v*c.xi}),
 print:c=>({})};
/* Прогон потерь: те же стадии; длина необязательна, строки не нужны (стадия lines пропускается). */
function runLosses(inp,detail,base){
 const c=Object.assign({},inp,base,{detail,hasL:!(isNaN(inp.L)&&inp.L>0),wantLines:false,needQ:false});
 if((isNaN(c.q_m3s)||c.q_m3s===undefined) && c.q!==undefined && c.q!==null)
  c.q_m3s=qToM3s(c.q,c.qunit);
 if(isNaN(c.dv_mm)||c.dv_mm<=0)
  return {ok:false,error:'нужен расчётный внутренний диаметр dv_mm (см. pipeDv)'};
 const r=runStages(c);
 return r.ok?{ok:true,c}:r;
}
function lossesShevelev(inp){
 const fam=inp.law||inp.mat;                 // имя СЕМЕЙСТВА (строка закона), не имя формулы
 if(!fam) return {ok:false,error:'нужен закон: law (steel|ci|asbes|conc|plastic|pex|pe100|grp|glass)'};
 const r=runLosses(inp,LOSS_SHEVELEV,{fam}); if(!r.ok) return r;
 const c=r.c;
 const out=Object.assign({i:c.i,i1000:c.i1000,A:c.A,e:c.e,law:c.law,R:c.R,k:c.k,rho:c.rho,xi:0},
                         {v:c.v,dv_mm:c.dv_mm,L:c.hasL?c.L:null});
 if(c.hasL) Object.assign(out,{H:c.H,P:c.P});
 return Object.assign({ok:true},out,{trace:c.trace});
}
function lossesSP(inp){
 const P=inp.page||(inp.mat&&matOf(inp.mat)||{}).page;
 if(!P||!P.loss) return {ok:false,error:'нужна СП-страница: page (или mat: copper|pex|metal-pex)'};
 const map=P.sys, sys=(inp.cuSys&&map[inp.cuSys])?inp.cuSys:'cold', S=map[sys];
 const r=runLosses(inp,LOSS_SP,{page:P,S,sys,xi:isNaN(inp.xiSum)?0:inp.xiSum}); if(!r.ok) return r;
 const c=r.c;
 const out=Object.assign({i:c.i,i1000:c.i1000,R:c.R,law:c.law,xi:c.xi,nu:c.nu,rho:c.rho,sys,heat:!!S.heat},
                         {v:c.v,dv_mm:c.dv_mm,L:c.hasL?c.L:null});
 if(c.hasL) Object.assign(out,{Z:0.5*c.rho*c.v*c.v*c.xi,H:c.H,P:c.P});
 return Object.assign({ok:true},out,{trace:c.trace});
}
/* Диспетчер: кому не нужно знать семейство — тот зовёт это (окно, WebMCP). */
function calcLosses(inp){
 const m=inp.mat&&matOf(inp.mat);
 if(!m) return {ok:false,error:'неизвестный материал: '+inp.mat};
 return (m.page&&m.page.kind==='sp')?lossesSP(inp):lossesShevelev(inp); // тот же выбор семейства, что CALC_TREE
}

/* экспорт для node-тестов (в браузере window есть, в node — global) */
if (typeof module!=='undefined' && module.exports){
 module.exports={fmt,fmt2,qToM3s,velocity,gradient,iOf,pressure,head,unitSuspect,NU_FIX,RHO_FIX,
   CALC_TREE,STAGES,runStages,spFluid,shevFluid,calcSP,calcShevelev,DETAIL_SHEVELEV,DETAIL_SP,
   NO_SYS,NO_WEAR,matOf,usesSys,usesWear,usesCu,usesK,ciLimits,speedNotes,recommendation,shevCalc,
   pipeDv,calcVelocity,lossesShevelev,lossesSP,calcLosses};
}
