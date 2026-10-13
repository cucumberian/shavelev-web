/* ui.js — логика интерфейса расчёта: заполнение списков, чтение контролов, вывод, справка.
   Зависимости (загружаются раньше в index.html): formulas.js, js/data/* (registry, docs, modes,
   модули типов труб), calc.js.
   ВСЕ вычисления — в calc.js (shevCalc, velocity, gradient, speedNotes, recommendation, fmt);
   здесь только DOM: взять значения контролов → вызвать движок → нарисовать результат. */
"use strict";

const $=id=>document.getElementById(id);

/* Радио-группы страницы. На каждый расчёт ui.js спрашивал у DOM по 35–40 селекторов, и почти все
   были вида 'input[name=X]:checked' — одни и те же группы по 7–9 раз за цикл. В браузере это
   бесплатно, в jsdom (движок CSS-селекторов) — 85–92 % времени всех UI-наборов, поэтому группы
   кэшируем и ищем отмеченную перебором кэша (`.checked` — свойство узла, кэш не инвалидируется).
   ИСКЛЮЧЕНИЕ: 'cusys' (Frame2 меди/PEX) и 'pn' (кнопки ПЭ 100) собираются скриптом через
   innerHTML — их кэш сбрасывается в fillCuSys()/fillPnRadios(). */
const _rad={};
function radAll(name){ return _rad[name]||(_rad[name]=document.querySelectorAll('input[name='+name+']')); }
function rad(name){ const g=radAll(name); for(const r of g) if(r.checked) return r; return null; }
function radVal(name,val){ const g=radAll(name); for(const r of g) if(r.value===val) return r; return null; }
function dropRad(name){ delete _rad[name]; }

function fillMaterials(){
 const sel=$('material');
 sel.innerHTML='';
 MATERIALS.forEach(m=>{const o=document.createElement('option');o.value=m.id;o.textContent=m.name;sel.appendChild(o);});
}
function currentMat(){return MATERIALS.find(m=>m.id===$('material').value);}

/* Режимы участка зависят от системы (холодного/горячего водоснабжения) — как Combo3+Option5/6 */
function fillModes(keep){
 const sys=rad('sys').value;
 const sel=$('mode'); const prev=keep?sel.value:'';
 sel.innerHTML='';
 MODE_SYS[sys].forEach(id=>{const o=document.createElement('option');o.value=id;o.textContent=MODE_LABELS[id];sel.appendChild(o);});
 if(prev && [...sel.options].some(o=>o.value===prev)) sel.value=prev;
 else sel.value=MODE_SYS[sys][0];
}

/* Видимость блоков «Трубы» (новые/неновые) и «Режим / теплоноситель» по странице материала.
   Критерий один: блок показываем только там, где его данные участвуют в формулах и где он есть
   в оригинальном окне (шаблоны форм EXE). Карта видимости — декларативно в данных страниц
   (js/data/<тип>.js → m.ui: sys/wear/cu), читается движком (calc.js — usesSys/usesWear/usesCu/usesK):
    • сталь ВГП (frmtablII11) и электросварная (frmtablII2): Frame4 «Выбор системы» с Option5
      «холодного водоснабжения» / Option6 «горячего водоснабжения» и полем t= °C (Label21),
      Check2 «учесть потери на местные сопротивления» + k → блок активен;
    • чугун (frmtablII3): режима, t, ν/ρ и местных сопротивлений в окне нет (H = i·L), но есть
      классы ЛА/А/Б и Option3/4 «новые/неновые» → блок убран, переключатель труб оставлен;
    • а/ц, пластик, PEX, PEX-AL-PEX, ж/б, стеклопластик, стекло: в окне нет ни режима, ни ν/ρ,
      ни k, ни «новые/неновые» → блок УБРАН ЦЕЛИКОМ. Значения, которые он подразумевал,
      фиксированы самой программой: ν = 1,3·10⁻⁶ м²/с (t = 10 °C, вшита в константы A),
      ρ = 1000 кг/м³, k ≡ 0 → H = i·L; предупреждений по скорости в этих calc-функциях нет. */
function applySysVisibility(){
 const m=currentMat(), id=m.id;
 const ci=!!m.cls, sys=usesSys(id);            // режим/теплоноситель нужен только стали и э/с
 $('sysField').style.display=sys?'':'none';    // на остальных страницах блока нет вовсе
 ['sysRow','mestRow','modeRow','kRow'].forEach(r=>$(r).style.display=ci?'none':'');
 $('srcGrid').classList.toggle('two',ci);      // класс слева, остальное справа (грид только на чугуне)
 $('sysField').classList.remove('locked');
 $('sysField').querySelector('legend').textContent='Режим / теплоноситель';
 $('wearField').style.display=usesWear(id)?'':'none'; // «новые/неновые» только у стали, э/с и чугуна
 $('hLegend').textContent=usesK(id)?'Потери напора на участке, м':'Потери напора по длине, м';
 $('nuT').style.display='none';                    // подсказка «t=10°C (как в программе)» была у заблокированного блока
 $('rhoHint').style.display=sys?'':'none';           // «для ГВС рекомендуется t=60°C» — только где есть ГВС
 applySpVisibility(m);        // СП-страницы (медь/PEX/PEX-AL-PEX): свои блоки — Выбор системы,
                              // Температура, Теплоноситель, Местные сопротивления (page.blocks)
 radAll('sys').forEach(r=>{r.disabled=false;});
 if(!sys){
  // блок скрыт, но значения, которые реально участвуют в расчёте, держим в полях (ν=1,3·10⁻⁶ =
  // t=10°C вшита в константы A, ρ=1000, k≡0 → H=i·L) и запоминаем, что чекбокс снят принудительно
  $('nu').value='1.3e-6';$('nu').disabled=false;$('nuPreset').disabled=false;
  $('rho').value='1000';$('rho').disabled=false;
  $('mode').disabled=false;$('k').disabled=false;$('k').value='0';
  $('chkMest').checked=false;$('chkMest').dataset.forced='1';
 } else {
  if($('chkMest').dataset.forced){ delete $('chkMest').dataset.forced; $('chkMest').checked=true; } // вернулись на сталь/э/с
  $('chkMest').disabled=false;$('mode').disabled=false;$('k').disabled=false;
  const cold=rad('sys').value==='cold';
  $('rho').disabled=false;
  // у стали/э-с ν входит в формулы: в ХВС это 1,3·10⁻⁶ (вода 10 °C), а не 0; у прочих страниц ν не используется
  if(cold) $('nu').value=usesSys(currentMat().id)?'1.3e-6':'0';
  $('nu').disabled=cold;$('nuPreset').disabled=cold;
 }
}

/* СП-страница (медь frmtablII9, PEX frmtablII10, PEX-AL-PEX): стального блока «Режим / теплоноситель»,
   режима и k на ней НЕТ — вместо них свои рамки Frame2 «Выбор системы», Frame4 «Температура, °С»
   (Combo3 50…90), Frame5 «Теплоноситель» (вода/другой + ν и ρ) и Frame6 «Местные сопротивления»
   (Check1–12 + Text5–17 «шт.», Check14 «другие», Label11 «Sx=», Command4 «Сброс»).
   Что показывать и какие кнопки строить — объявляет страница: page.blocks, page.sys, page.xi.
   Здесь только DOM; ни одного имени материала в коде нет. */
function applySpVisibility(m){
 const P=m.page, sp=(P.kind==='sp');
 ['cuSysField','cuTField','cuHeatField','xiField'].forEach(r=>$(r).style.display=sp?'':'none');
 if(!sp) return;
 // на этих страницах нет ни режима, ни k, ни «учесть местные» — вместо них редактор ξ (Frame6)
 ['sysRow','mestRow','modeRow','kRow'].forEach(r=>$(r).style.display='none');
 // Frame2 «Выбор системы»: кнопки и подписи собираются из карты page.sys. У меди это Option1–4
 // (шаблон 0x6fb58), у PEX — Option1–3 (слоты 0x388/0x38c/0x384): порядок и подписи приходят из данных.
 const box=$('cuSysField').querySelector('.cusys');
 const prev=(rad('cusys')||{}).value;
 box.innerHTML=''; dropRad('cusys');   // группа пересобрана — старые узлы отброшены
 Object.keys(P.sys).forEach(k=>{
  const lab=document.createElement('label');
  lab.innerHTML=`<input type="radio" name="cusys" value="${k}"${k===prev?' checked':''}> ${P.sys[k].cap}`;
  box.appendChild(lab);
 });
 if(!rad('cusys')) box.querySelector('input').checked=true;
 radAll('cusys').forEach(r=>r.onchange=spSysSync);
 spSysSync();
}

/* Класс чугунной трубы (frmtablII3: Option3=ЛА, Option4=А, Option7=Б) */
function curCls(){const r=rad('cls');return r?r.value:'ЛА';}
/* а/ц (frmtablII4): класс трубы ВТ и тип по размерам */
function curVt(){const r=rad('vt');return r?r.value:'ВТ6';}
function curTip(){const r=rad('tip');return r?+r.value:1;}
/* пластик (frmtablII5): марка полиэтилена (Option1–4) и серия SDR (Option5–13) */
function curPe(){const r=rad('pe');return r?r.value:'32';}
function curSdr(){const r=rad('sdr');return r?r.value:null;}
/* ПЭ 100 (ГОСТ Р 70628.2-2023): серия выбирается по НОМИНАЛЬНОМУ ДАВЛЕНИЮ PN — в проекте трубу
   указывают давлением, а не серией. Кнопки строит fillPnRadios() из данных страницы, value кнопки —
   id серии SDR, потому что серия и есть то, чем различаются строки сортамента. У SDR 6 (S 2,5)
   номинальное давление в стандарте не нормировано — у него подпись по серии. */
function curPe100Sdr(){const r=rad('pn');return r?r.value:null;}
function pe100Series(){const m=currentMat(); if(!m||!m.pe100) return null;
 const s=curPe100Sdr(); return (s&&m.pe100[s])?s:Object.keys(m.pe100)[0];}
/* PEX (frmtablII10): серия труб (Option4/9/10/11/12). Строка сортамента [S, ΔS, Δd] для выбранного
   dн берёт страница (page.seriesRow) — раньше это знание лежало здесь, в ui.js. */
function curPexSdr(){const r=rad('pexsdr');return r?r.value:'sdr136';}
function pexRow(){const P=currentMat().page; return P.seriesRow?P.seriesRow(+$('dsel').value):null;}

/* Состояние блока исходных данных (frmtablII3, проверка на живой программе):
   «другой» свободен при любом классе/dу; при включении блокируется весь блок —
   классы, селектор dу, строка dн/S/dв; dp — ручной ввод. Вызывается при смене
   материала/класса/чекбокса. */
function applyClsState(){
 const P=currentMat().page, other=$('danother').checked;
 /* Флажок «другой» (frmtablII3 чугун, frmtablII5 пластик «не по ГОСТу», ГОСТ 12586.0-83 ж/б,
    СП 40-104-2001 стеклопластик, медь/PEX/стекло): список диаметров и переключатели страницы
    гаснут, dв — ручной ввод. Гасит ли это — решает страница (page.gated), а не перечень полей
    в UI: раньше здесь стоял список m.cls||m.pe||m.pe100||m.sMap||m.series||conc||grp||glass,
    который надо было помнить и который молча разъезжался с остальным кодом. */
 const locked=other&&!!P.gated;
 // блоки-селекторы страницы объявлены в page.blocks: clsRow → радио name=cls, peRow → name=pe, …
 (P.blocks||[]).forEach(b=>radAll(b.replace(/Row$/,'').toLowerCase())
   .forEach(r=>r.disabled=locked));
 $('dsel').disabled=locked;
 $('dcv').disabled=!other;
 if($('peTableField')) $('peTableField').classList.toggle('off',locked&&!!P.table);
}

/* Кнопки «Номинальное давление» страницы ПЭ 100 (ГОСТ Р 70628.2-2023): список и подписи приходят
   из данных страницы (page.pnList), здесь только DOM. value кнопки = id серии SDR, потому что серия
   и есть то, чем различаются строки сортамента. */
function fillPnRadios(){
  const P=currentMat().page; if(!P.pnList) return;
  const box=$('pnBox'), prev=(rad('pn')||{}).value;
  box.innerHTML=''; dropRad('pn');  // группа пересобрана — старые узлы отброшены
  P.pnList().forEach(({sid,label})=>{
   const lab=document.createElement('label');
   lab.innerHTML=`<input type="radio" name="pn" value="${sid}"${sid===prev?' checked':''}> ${label}`;
   box.appendChild(lab);
  });
  if(!rad('pn')){
   // по умолчанию — PN 10 (SDR 17): именно этот размер приводит сам стандарт в примере
   // условного обозначения трубы для воды (раздел 13, «ПЭ 100 ВОДА SDR 17 63 × 3,8»)
   const d=radVal('pn','17')||radAll('pn')[0];
   if(d) d.checked=true;
  }
  radAll('pn').forEach(r=>r.onchange=()=>fillDiameters());
}

/* Таблица размеров выбранной серии (страница ПЭ 100): dн, e (номинальная толщина стенки) и
   dв = дн − 2e. Строка выбранного диаметра подсвечена, клик по строке выбирает диаметр — это и
   есть замена выпадающему списку: видно весь ряд серии сразу, а не одно значение. Содержимое
   приходит из page.table(sid). */
function renderPeTable(sid){
  const P=currentMat().page, body=$('peTableBody');
  if(!P.table||!body) return;
  const {cap,rows}=P.table(sid);
  const cur=$('dsel').value, off=$('danother').checked;
  $('peTableCap').innerHTML=cap;
  body.innerHTML='';
  rows.forEach(r=>{
   const tr=document.createElement('tr');
   tr.className=(String(r.dn)===cur?'sel ':'')+(off?'off':'');
   tr.innerHTML=`<td>${r.dn}</td><td>${r.e}</td><td>${r.dv}</td>`;
   tr.onclick=()=>{ if($('danother').checked) return; $('dsel').value=String(r.dn); fillDiameters(); };
   body.appendChild(tr);
  });
  // выбранная строка может оказаться ниже видимой части (у SDR 21 — 34 размера): подводим её к окну,
  // иначе не видно, какой диаметр выбран. block:'nearest' не дёргает страницу целиком.
  const selRow=body.querySelector('tr.sel');
  if(selRow&&typeof selRow.scrollIntoView==='function') selRow.scrollIntoView({block:'nearest'});
}

/* ─── страница целиком: списки, подписи, поля ─────────────────────────────────────────────────
   Здесь больше НЕТ лестницы «if (m.gas) … else if (m.pe100) …»: всё, что раньше разбиралось
   по форме данных материала, страница теперь объявляет сама (js/data/<id>.js → m.page).
   До 13.10.2026 один только fillDiameters() был 90 строк if/else if плюс 30 строк хардкода
   подписей, и та же форма данных опознавалась здесь, в curDv(), в dpOf() и в applyClsState().

   Что страница объявляет:
     blocks    — какие блоки-селекторы (clsRow/vtRow/…) она показывает; остальные скрыты;
     labels    — подписи строк d / t / dv (t отсутствует, если поля толщины стенки нет);
     otherCap  — подпись флажка «другой» (у пластика — «не по ГОСТу»);
     rows(st)  — строки списка диаметров как [значение, подпись];
     wallRows  — стенки для выбранного диаметра (нет поля — null);
     dvOf(st,d)— ★ закон расчётного диаметра (см. pageState());
     gated     — гасит ли «другой» выбор по списку;
     hideDsel / keepNearest — частности ПЭ 100 (список скрыт, при смене серии берётся ближайший dн). */
const PAGE_BLOCKS=['clsRow','vtRow','tipRow','peRow','sdrRow','pexSdrRow','pexSpRow','pnRow','peTableField'];
// Подписи по умолчанию — на случай страницы без своего page.labels: лучше нейтральный текст,
// чем подписи от предыдущего материала.
const DEF_LABELS={d:'Диаметр:', t:'Толщина стенки, мм:', dv:'Расчётный внутренний диаметр dp, мм:'};

/* Заполнение <select> строками [значение, подпись]. Прежний выбор сохраняется, если он есть в
   новом списке; nearest (страница ПЭ 100) — если нет, берётся ближайший меньший. */
function fillSel(sel,rows,nearest){
 const prev=sel.value;
 sel.innerHTML='';
 if(rows) for(const [v,t] of rows){const o=document.createElement('option');o.value=String(v);o.textContent=t;sel.appendChild(o);}
 if(prev!=='' && [...sel.options].some(o=>o.value===prev)) sel.value=prev;
 else if(nearest && prev!==''){
  const below=[...sel.options].map(o=>+o.value).filter(x=>isFinite(x)&&x<=+prev);
  if(below.length) sel.value=String(below[below.length-1]);
 }
}

function fillDiameters(){
 const m=currentMat(), P=m.page;
 PAGE_BLOCKS.forEach(r=>{const e=$(r); if(e) e.style.display='none';});
 if(m.pe100) fillPnRadios();        // кнопки PN строятся из данных страницы (fillPnRadios), и без
                                   // них не выбрана серия — список dн был бы пуст
 if(m.pe100) renderPeTable(pe100Series());   // таблица размеров выбранной серии (клик по строке выбирает dн)
 let st=pageState();
 // Пластик: серия может стать недопустимой после смены марки — страница выбирает допустимую,
 // и её переключатели гасятся по марке (frmtablII5: Option5–13).
 if(P.pickSeries){
  const s=P.pickSeries(st,+$('dsel').value);
  if(s!==st.sdr){ const r=radVal('sdr',s); if(r) r.checked=true; }
  const ok=P.seriesEnabled(st);
  radAll('sdr').forEach(r=>r.disabled=!ok.has(r.value));
  st=pageState();
 }
 fillSel($('dsel'), P.rows(st), P.keepNearest);
 const wall=P.wallRows ? P.wallRows(st, +$('dsel').value) : null;
 fillSel($('tsel'), wall && wall.map(s=>[s, fmt(s,2)]));
 $('thicknessRow').style.display=wall?'':'none';
 (P.blocks||[]).forEach(r=>{const e=$(r); if(e) e.style.display='';});
 $('dRow').style.display=P.hideDsel?'none':'';
 // Класс/тип, которого нет в сортаменте при текущем типе (а/ц: ВТ15 при типе 1 — программа прячет
 // радиокнопку целиком, а не гасит). Правило объявлено в данных страницы, DOM трогаем здесь.
 if(P.hiddenVt){
  const h=P.hiddenVt, r=radVal('vt',h.value);
  const hide=st.tip===h.tip;
  if(r){ r.closest('label').style.display=hide?'none':''; r.disabled=hide;
         if(hide&&r.checked) radVal('vt',h.fallback).checked=true; }
 }
 const L=P.labels||DEF_LABELS;
 $('dLabel').textContent=L.d; $('dvLabel').textContent=L.dv;
 if(L.t) $('tLabel').textContent=L.t;
 $('dpOtherCap').textContent=P.otherCap||'другой';
 $('dpOther').style.display='';
 updDv();
 updDu();
}
function updDv(){
 if($('danother').checked) return;          // ручной dв — поле не трогаем (во всех 12 страницах)
 const dv=curDv();
 $('dcv').value=isNaN(dv)?'':fmt(dv,2);
}

/* Блок местных сопротивлений гаснется ПО ДИАМЕТРУ, а не по системе: с порога страницы строки
   «учесть потери…», «Режим» и k ИСЧЕЗАЮТ (живые скрины dн=88,5 ВГП и dн=88 э/с: в рамке остаётся
   только «Длина участка L=»). Порог свой у каждой страницы и объявлен в её данных
   (page.mestLimit — dу ≥ 80 у водогазопроводных, dн ≥ 88 у электросварных; живые пробы 12.10.2026).
   Флаги disabled держим теми же — на них опирается остальной код и тесты. */
function applyMestLimit(){
 const P=currentMat().page, cb=$('chkMest');
 if(!P.mestLimit||!cb) return;
 const off=P.mestLimit(pageState(), +$('dsel').value);
 const wasOff=cb.dataset.mestOff==='1';
 if(off!==wasOff){
  cb.dataset.mestOff=off?'1':'0';
  if(off){                                                 // уходим в зону порога: помним галочку И значение k
   cb.dataset.mestRemembered=cb.checked?'1':'0';
   cb.dataset.mestKPrev=$('k').value;                      // в т.ч. введённый вручную 0 — не подменяем на k режима
  } else if(cb.dataset.mestRemembered!==undefined){
   cb.checked=(cb.dataset.mestRemembered!=='0'); delete cb.dataset.mestRemembered;
   if(cb.dataset.mestKPrev!==undefined){ $('k').value=cb.dataset.mestKPrev; delete cb.dataset.mestKPrev; }
   // Вернулись из зоны порога с включённой галочкой, а k пуст — ставим k режима.
   // Только на самом переходе off→on: подставлять k при каждом вызове нельзя, иначе очищенное
   // пользователем поле молча заполняется и обходится проверка «Вы не ввели значение коэффициента»
   // (BSTR 0x047b70; замечание независимой рецензии 11.10.2026).
   if(cb.checked && $('k').value===''){ const kv=K_MODE[$('mode').value]; if(kv!==undefined) $('k').value=String(kv); }
  }
 }
 ['mestRow','modeRow','kRow'].forEach(r=>{ const e=$(r); if(e) e.style.display=off?'none':''; });
 cb.disabled=off;
 if(off){
  cb.checked=false; $('k').value='0';                      // местные не учитываются
  $('mode').disabled=true; $('k').disabled=true;
 } else {
  const on=cb.checked;
  $('mode').disabled=!on; $('k').disabled=!on;
 }
}

/* Две строки под селектором диаметра, которые показывают не все страницы:
   «Диаметр условного прохода dу= … трубы лёгкие/обыкновенные/усиленные» (Label13 + строки
   0x4418a0/c0/ec, водогазопроводная сталь) и «наружный dн / толщина S / внутренний dв»
   (Label16/17/18, чугун). Текст и признак «показывать ли строку» приходят из данных страницы. */
function updDu(){
 const P=currentMat().page, st=pageState(), d=+$('dsel').value;
 const el=$('duLine');
 if(P.duLine){ el.parentElement.style.display=''; el.textContent=P.duLine(st,d); }
 else{ el.parentElement.style.display='none'; el.textContent=''; }
 const row=$('ciDims'), line=$('ciDimsLine');
 if(P.ciDims){ row.style.display=''; line.innerHTML=P.ciDims(st,d); }
 else{ row.style.display='none'; line.textContent=''; }
 row.classList.toggle('dimmed',$('danother').checked);
 applyMestLimit();
}

/* Строгий разбор числа: запятая как разделитель допустима, мусор ('1e') — NaN;
   знак «минус» проходит дальше и отсекается валидацией calc() */
function numStrict(s){
 if(!s) return NaN;
 s=s.trim().replace(',','.');
 if(!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s)) return NaN;
 return parseFloat(s);
}
/* Состояние страницы — единственный мост между DOM и чистыми функциями материала
   (js/data/<id>.js → m.page). Контролы читаются здесь ОДИН раз и складываются в обычный объект;
   дальше страница сама решает, как из выбранных значений получается расчётный диаметр.
   До 13.10.2026 закон «как считать dв» был написан в ui.js ДВАЖДЫ — curDv() для выбранного
   значения и dpOf() для рядов строки рекомендации; эти копии разошлись на пороге 300 мм у чугуна
   (коммит v0.2.2). Теперь это один m.page.dvOf(st, d), а две точки вызова различаются только тем,
   как получают d (выбранное значение #dsel против элемента ряда рекомендации). */
function pageState(){
  const t=$('tsel');
  return {
   cls:curCls(),                                          // чугун: класс ЛА/А/Б
   vt:curVt(), tip:curTip(),                              // а/ц: класс ВТ и тип по размерам
   pe:curPe(), sdr:curSdr(),                              // пластик: марка ПЭ и серия SDR
   sdr100:curPe100Sdr(),                                  // ПЭ 100: серия (кнопки «PN»)
   series:curPexSdr(),                                    // PEX: серия труб
   S:t?parseFloat(t.value):NaN,                           // стенка S, мм (сталь/э-с/медь)
   wear:(rad('wear')||{}).value,
  };
}

/* Расчётный внутренний диаметр ВЫБРАННОГО значения. Флажок «другой» (ручной ввод) разбирается
   здесь, а не в m.page.dvOf: тот считает по таблице всегда и обслуживает также ряды строки
   рекомендации, где ручного ввода не бывает. */
function curDv(){
  const m=currentMat();
  if($('danother').checked) return numStrict($('dcv').value);
  return m.page.dvOf(pageState(), +$('dsel').value);
}

/* Расчёт: здесь ТОЛЬКО чтение контролов и вывод. Валидация, v, i, R, H, предупреждения и
   строка рекомендации — в calc.js (shevCalc). dpOf(d) остаётся в ui.js, потому что зависит от
   контролов: стенка (газовые/э/с), класс и «неновые» (чугун), SDR (ПЭ). */
/* Единая точка сборки входа движка: calc() берёт объект отсюда, поэтому «что видит пользователь»
   и «что считает движок» не разъезжаются. Подстановка чисел в справку (js/help/<id>.js) читает
   ровно те же контролы и зовёт тот же движок shevCalc — потому числа справки равны выводу страницы.
   Это не «единственное чтение контролов»: ниже делегируется в curDv(), spSysVal(),
   xiTotal(), spCool(), а calc() дополнительно строит dpOf — осознанно зависимые читатели, их
   результат обязан совпадать с тем, что вернул readForm(). */
function readForm(){
 const m=currentMat();
 return {
  mat:m.id,
  sys:(rad('sys')||{}).value,
  wear:(rad('wear')||{}).value,
  dv_mm:curDv(),
  q:numStrict($('q').value), qunit:$('qunit').value,
  L:numStrict($('len').value),
  k:numStrict($('k').value), mest:!!($('chkMest') && $('chkMest').checked),
  nu:numStrict($('nu').value), rho:numStrict($('rho').value),
  mode:$('mode').value,
  selD:m.gas?m.gas.du[$('dsel').value]:+$('dsel').value,
  // медная страница (frmtablII9): система из Frame2, ξ из Frame6, ν/ρ из Frame5 (или по t из Combo3)
  cuSys:spSysVal(), xiSum:xiTotal(), t:numStrict($('tcombo').value),
  cool:spCool(), cuNu:numStrict($('cunu').value)*1e-6, cuRho:numStrict($('curho').value),
  pexSp:!!($('pexSp') && $('pexSp').checked), // PEX: по формуле (4) СП вместо кода программы
 };
}
/* Результат последнего расчёта: входы, состояние страницы и движковый r — то, что calc() рисует.
   Отдаётся WebMCP-инструменту shev-calculate, поэтому числа уходят числами (а не выскребаются из
   отрендеренного текста регулярками) и вместе с cls заметок дают машинный вердикт по скорости и
   рекомендации. Прямой вызов calc(), не дошедший до расчёта, → null (сброс в начале calc()). */
let lastCalc=null;
function calc(){
 const out=$('out');
 lastCalc=null;
 $('outH').innerHTML='—';
  const m=currentMat(), st=pageState();
  /* Расчётный диаметр для ЭЛЕМЕНТА РЯДА строки рекомендации. Ряд у стали задан в dу, а #dsel этой
     страницы хранит dн — переводит recKey (есть только у стали; у остальных страниц значение ряда
     и есть значение #dsel). Сам закон — тот же m.page.dvOf, что и у выбранного значения: до
     13.10.2026 здесь стояла вторая копия правила, и именно она разошлась с curDv() на пороге
     300 мм у чугуна (коммит v0.2.2). */
  const dpOf=(d)=>m.page.dvOf(st, m.page.recKey?m.page.recKey(d):d);
 // оригинал перед расчётом проверяет введённый коэффициент (MessageBox «Вы не ввели значение коэффициента», BSTR 0x047b70)
 if(usesK(m.id) && $('chkMest') && $('chkMest').checked && String($('k').value).trim()===''){
  out.innerHTML='<span class="warn">Вы не ввели значение коэффициента</span>'; return; }
 const inp=readForm(); inp.dpOf=dpOf;
 const r=shevCalc(inp);
 if(!r.ok){out.innerHTML=`<span class="warn">${r.error}</span>`;return;}
  lastCalc={inp,st,r};
 $('hLegend').textContent=r.hLegend;
 out.innerHTML=r.lines.join('\n')+'\n'+r.notes.map(n=>`<span class="${n.cls}">${n.text}</span>`).join('\n');
 $('outH').innerHTML=r.outH.join('\n');
}

/* Текст справки текущего материала: единый диспатч по HELP_PAGES (js/help/<id>.js → registerHelp),
   печать — каркасом js/help.js. Функция отдельная, чтобы справка перерисовывалась при смене
   класса труб (иначе остаётся открытой от прежнего материала). Пустая строка — если у страницы
   файла справки нет: показывать справку другого материала нельзя.
   Прежние legacy-тексты (helpSteel/helpCI/helpAsbes/helpPlastic/helpConc/helpGrp/helpGlass/
   helpCopper/helpPex) и резервный шаг calcStepHtml отсюда удалены 12.10.2026 — с тех пор как у всех
   11 страниц появился свой js/help/<id>.js, до них не было ни одной достижимой ветки (320 строк).
   Постоянство «файл справки есть у каждой страницы» сторожит тест test/ui/05-global.js. */
function helpHtml(){
 const m=currentMat();
 return (m && typeof HELP_PAGES!=='undefined' && HELP_PAGES[m.id]) ? renderCalcHelp(m.id) : '';
}
function showHelp(){
 const h=$('help');
 if(h.style.display==='block'){h.style.display='none';return;}
 h.innerHTML=helpHtml();
 h.style.display='block';
}

/* Страница меди ИЛИ PEX: обе пользуются блоками Frame4 «Температура» / Frame5 «Теплоноситель».
   Таблица ν/ρ берётся КОНКРЕТНОЙ страницы: у меди t=90 → 0,36·10⁻⁶ (DAT_00402428 @0x5166da-цепочка),
   у PEX t=90 → 0,32·10⁻⁶ (DAT_00402670 @0x527da9/@0x5281b7) — таблицы различаются на этом шаге. */
/* СП-страница текущая: медь, PEX или PEX-AL-PEX. Признак — page.kind==='sp' (данные страницы),
   а не имя материала. У всех трёх таблица ν/ρ своя: у меди t=90 → 0,36·10⁻⁶ (DAT_00402428
   @0x5166da-цепочка), у PEX и PEX-AL-PEX t=90 → 0,32·10⁻⁶ (DAT_00402670 @0x527da9/@0x5281b7) —
   таблицы различаются на этом шаге, поэтому ν/ρ берёт page.fluid(S, t) своей страницы. */
function spPage(){ const m=currentMat(); return (m&&m.page&&m.page.kind==='sp')?m:null }
function xiRows(){ const m=spPage(); if(m&&m.page.xi) return m.page.xi;
                   const any=MATERIALS.find(x=>x.page&&x.page.xi); return any?any.page.xi:[]; }
function spSysVal(){ const r=rad('cusys'); return r?r.value:'cold' }
function spCool(){ const r=rad('cool'); return r?r.value:'water' }
/* Frame6: Check1–12 + Text5–17 («шт.») — порядок и ξ по инициализации FUN_00515500 0x518a67–0x518c43.
   Перед каждой подписью — мини-схема сопротивления (XI_PICS, js/data/xi-pics.js). */
function xiPic(label){
 const p=(typeof XI_PICS!=='undefined')?XI_PICS[label]:null; if(!p) return '';
 const seg=x=>typeof x==='string' ? `<path class="pipe" d="${x}"/>`
  : `<path class="pipe ${x.w}" d="${x.d}"/>`;
 return `<svg class="xiPic" viewBox="0 0 44 30" role="img" aria-label="${label}">`+
  p.body.map(seg).join('')+p.flow.map(d=>`<path class="flow" d="${d}"/>`).join('')+`</svg>`;
}
function fillXiGrid(){
 /* Список ξ берём из данных СТРАНИЦЫ (page.xi) — у меди это Приложение А СП 40-108-2004, у PEX
   те же 12 позиции (Variant-константы calc 0x526810 @0x529fcc…0x52a160), у PEX-AL-PEX последняя
   позиция своя («соединение с обжимной гайкой»). На странице без ξ берём любой список — сетка всё
   равно скрыта. */
 const g=$('xiGrid'); g.innerHTML='';
 xiRows().forEach((row,i)=>{
  const lab=document.createElement('label'); lab.className='xiItem';
  lab.innerHTML=`<input type="checkbox" id="xi${i}"> ${xiPic(row[0])} <span class="xiName">${row[0]}</span> <span class="hint">ξ=${fmt(row[1],1)}</span>`+
                `<input type="number" id="xin${i}" class="w-xi" min="0" step="1" value="1"> <span class="unit">шт.</span>`;
  g.appendChild(lab);
 });
}
/* Σξ = Σ ξ_i·шт. (цепочка VarMul→VarAdd 0x518c80–0x518e79); «другие ξ» (Text17/Check14)
   прибавляется последним VarAdd БЕЗ умножения */
function xiTotal(){
 let s=0;
 xiRows().forEach((row,i)=>{
  const c=$('xi'+i), n=numStrict(($('xin'+i)||{}).value||'');
  if(c && c.checked && !isNaN(n)) s+=row[1]*n;
 });
 if($('xiother').checked){ const o=numStrict($('xiotherval').value); if(!isNaN(o)) s+=o; }
 return s;
}
function xiShow(){ $('xiSum').textContent=fmt(xiTotal(),2) }   // Label11 «Sx=»
/* «Сброс» (Command4 → FUN_0051c530): обнуляет 13 пар Text/Check (слоты 0x338…0x39c) */
function xiResetAll(){
 xiRows().forEach((row,i)=>{ $('xi'+i).checked=false; $('xin'+i).value='1'; });   // количество — по умолчанию 1 шт.
 $('xiother').checked=false; $('xiotherval').value='';
 xiShow();
}

/* Активность блоков СП-страницы — как в оригинальном окне frmtablII9/frmtablII10. Что активно,
   решают признаки выбранной системы в карте page.sys, а не имя материала:
     cold — «холодного водоснабжения»: Frame4 «Температура» и Frame5 «Тепно��итель» оба неактивны,
            программа берёт воду со стандартными ν = 1,3·10⁻⁶ м²/с (DAT_00402448) и ρ = 1000;
     t    — системы ГВС: активна только Frame4 (Combo3 50…90), по ней подставляются ν и ρ;
     heat — системы отопления: активны оба блока, «другой» открывает ручные ν (Text3) и ρ (Text18). */
function spSysSync(){
 const m=spPage(); if(!m) return;
 const S=m.page.sys[spSysVal()]||m.page.sys.cold;
 const tActive=!S.cold;          // Frame4 «Температура»
 const coolActive=!!S.heat;      // Frame5 «Теплоноситель»: «вода/другой» только при отоплении
 $('tcombo').disabled=!tActive;
 $('cuTField').classList.toggle('off',!tActive);   // весь блок выглядит неактивным
 $('cuHeatField').classList.toggle('off',!coolActive);
 radAll('cool').forEach(r=>r.disabled=!coolActive);
 if(!coolActive) radVal('cool','water').checked=true;
 if(!tActive) $('tcombo').value='';
 $('cuTHint').textContent   = tActive ? '' : 'в оригинале блок неактивен: вода ν = 1,3·10⁻⁶ м²/с, ρ = 1000 кг/м³';
 $('cuCoolHint').textContent= coolActive ? '' : (tActive
  ? 'в оригинале блок неактивен: ν и ρ подставляются по температуре'
  : 'в оригинале блок неактивен: вода ν = 1,3·10⁻⁶ м²/с, ρ = 1000 кг/м³');
 spHeatSync();
}

/* «вода» (Option7): ρ и ν подставляются по температуре из Combo3 — пороги 50/60/70/80/90 °C.
   Значения берёт СТРАНИЦА (page.fluid), потому что таблицы ν/ρ у меди и PEX различаются на шаге
   t=90, а у циркуляционного ГВС меди ν вообще не зависит от t (0,36·10⁻⁶ при любом t — живые
   скрины 08.10.2026: t=50/60/70 → 0,36, i=0,398). page.fluid вернёт null, если строки для этой
   температуры нет (при t<50 строк Таблицы 5 СП в EXE нет) — тогда берутся умолчания программы:
   ν = 1,3·10⁻⁶ (DAT_00402448), ρ = 1000. «другой» (Option8) — ρ и ν из полей (они разблокированы). */
function spHeatSync(){
 const m=spPage(); if(!m) return;
 const water=spCool()==='water';
 $('cunu').disabled=water; $('curho').disabled=water;
 if(water){
  const S=m.page.sys[spSysVal()]||m.page.sys.cold;
  const t=numStrict($('tcombo').value), f=m.page.fluid(S,isNaN(t)?null:t);
  $('cunu').value=f?(f.nu*1e6).toFixed(2):'1.3';
  $('curho').value=f?String(f.rho):'1000';
 }
 $('tHint').style.display=(spSysVal()!=='cold')?'':'none';
}

/* Синие ссылки на документы страницы: у PEX-AL-PEX их две («СП 41-102-98» и «СП40-102-2000»),
   у остальных — одна. */
function setDocLinks(m){
 const ids=m.docs&&m.docs.length?m.docs:[m.doc];
 $('gostLink').textContent=DOCS[ids[0]]||'';
 const two=ids.length>1&&DOCS[ids[1]];
 $('gostLink2').textContent=two?DOCS[ids[1]]:'';
 $('gostLink2').style.display=two?'':'none';
}

/* ==== init ==== */
fillMaterials();
$('material').onchange=()=>{const m=currentMat();setDocLinks(m); fillXiGrid();if(!m.page.gated)$('danother').checked=false;applyClsState();applySysVisibility();fillDiameters(); const hp=$('help'); if(hp&&hp.style.display==='block') hp.innerHTML=helpHtml();};
$('dsel').onchange=fillDiameters;
radAll('cls').forEach(r=>r.onchange=()=>{applyClsState();fillDiameters();});
[...radAll('vt'),...radAll('tip')].forEach(r=>r.onchange=fillDiameters); // а/ц: ВТ/тип → пересборка dу и dв
radAll('pe').forEach(r=>r.onchange=fillDiameters); // пластик: марка ПЭ → список dн и доступность SDR
radAll('sdr').forEach(r=>r.onchange=fillDiameters); // пластик: серия SDR → список dн и dв
radAll('pexsdr').forEach(r=>r.onchange=fillDiameters); // PEX: серия SDR → список dн и dв
$('tsel').onchange=()=>{updDv();updDu();};
$('danother').onchange=()=>{applyClsState();if(!$('danother').checked)updDv();updDu();
 if(currentMat().pe100) renderPeTable(pe100Series());}; // ПЭ 100: «другой» гасит таблицу размеров
radAll('wear').forEach(r=>r.onchange=updDv); // чугун: −1 мм у «неновых» при любом dу (живые точки 13.10.2026)
$('chkMest').onchange=()=>{const on=$('chkMest').checked;$('mode').disabled=!on;$('k').disabled=!on;
 if(!on){ $('k').value='0'; }                                 // 10.10.2026: не оставляем пусто — 0 (иначе подстановка в справке вырождается в NaN)
 else { const kv=K_MODE[$('mode').value]; if(kv!==undefined) $('k').value=String(kv); } // включаем — k снова по режиму (0,3 и т. п.)
}; // как в программе (FUN_00480b10): без местных сопротивлений k блокируется и очищается
$('nuPreset').onchange=e=>{if(e.target.value){const[a,b]=e.target.value.split('|');$('nu').value=a;$('rho').value=b;}};
/* k по режиму, как в программе (FUN_00480b10). syncK() — явный вызов из обработчиков;
   раньше обработчики дёргали $('mode').onchange() друг из друга — скрытая цепочка, её нет. */
function syncK(){ const kv=K_MODE[$('mode').value]; if(kv!==undefined) $('k').value=String(kv); }
$('mode').onchange=syncK;
/* ν/ρ по выбранной t из поля «t = … °C» (ГВС стали). Таблица — в данных страницы (page.nuTable),
   раньше стояла константой T_NU_RHO в этом файле. syncSteelT() — явный вызов, не обработчик.
   Страница без своей таблицы (у остальных материалов поля t нет) — ничего не трогаем. */
function syncSteelT(){
 const P=currentMat().page, nu=P.nuTable&&P.nuTable[$('tSteel').value];
 if(nu){ $('nu').value=nu; $('rho').value=String(P.rhoTable!==undefined?P.rhoTable:1000); }
}
$('tSteel').onchange=syncSteelT;
$('sysCold').onchange=()=>{fillModes(false);syncK();
 $('tSteelRow').style.display='none'; $('nuRow').style.display='none'; $('rhoRow').style.display='none'; // в оригинале полей ν/ρ на стальной странице нет
 if(usesSys(currentMat().id)){ $('mestRow').style.display=''; $('modeRow').style.display=''; $('kRow').style.display='';
  syncK(); }   // галочку НЕ поднимаем: оригинал сохраняет её состояние при смене системы
 // (живая проверка 12.10.2026: отмеченная в ГВС галочка остаётся отмеченной и в ХВС, и в ГВС),
 // а по умолчанию в оригинале она СНЯТА — как и в клоне.
 // холодное водоснабжение: температура/ν блокируются, подставляются ν=0 и ρ=1000 (как в программе;
 // на расчёт ν не влияет — все формулы ν-подставленные, ν=1,3·10⁻⁶ «зашита» в константы 0,684/0,867)
 $('nu').value='1.3e-6';$('nu').disabled=true;$('nuPreset').disabled=true;$('rho').value='1000';
 applyMestLimit();   // на большом dу галочка местных остаётся погашенной и снятой
}; // ν входит в формулы стали (ХВС: вода 10 °C)
$('sysHot').onchange=()=>{fillModes(false);syncK();
 $('nu').disabled=false;$('nuPreset').disabled=false;
 // ГВС стали: в оригинале есть подписанное поле «t = … °C», поля ν/ρ отсутствуют, а блок местных
 // сопротивлений ОСТАЁТСЯ — гасит его не система, а диаметр (applyMestLimit, dу ≥ 80), одинаково
 // для ХВС и ГВС (живая проверка 12.10.2026): ГВС dн=60 (dу=50) — галочка есть, k=0,2 по режиму
 // «подающий/циркуляционный», H=1,33 м; ГВС dн=75,5 (dу=65) — есть; ГВС dн=88,5 (dу=80) — нет.
 if(usesSys(currentMat().id)){ $('tSteelRow').style.display=''; $('nuRow').style.display='none'; $('rhoRow').style.display='none';
  $('mestRow').style.display=''; $('modeRow').style.display=''; $('kRow').style.display='';
  applyMestLimit();   // на большом dу галочка погашена и снята — в любом режиме водоснабжения
  if(!$('tSteel').value||$('tSteel').value==='40') $('tSteel').value='60'; syncSteelT(); } };
$('tSteel').onchange();
fillModes(false);
// сталь/э-с: полей ν и ρ в оригинале нет — они скрыты, значения подставляет программа
// (ХВС: ν=0, ρ=1000; ГВС: по выбранной t из поля «t = … °C»)
if(usesSys(currentMat().id)){ $('nuRow').style.display='none'; $('rhoRow').style.display='none'; }
applySysVisibility(); // чугунная страница: скрыть система/режим/местные/k, зафиксировать ν/ρ (t=10°C)
syncK(); // стартовое k по режиму по умолчанию (хоз-питьевой → 0,3)
fillXiGrid();
radAll('cusys').forEach(r=>r.onchange=spSysSync); // Frame2 Option1–4
radAll('cool').forEach(r=>r.onchange=spHeatSync);  // Frame5 вода/другой
$('tcombo').onchange=spHeatSync;                                                  // Combo3 50…90 °C
$('xiGrid').onchange=xiShow; $('xiother').onchange=xiShow; $('xiotherval').oninput=xiShow;
$('xiReset').onclick=xiResetAll;
xiShow();
$('btnCalc').onclick=calc;
$('btnHelp').onclick=showHelp;
/* Справка обновляется «на лету»: после «Рассчитать», смены системы, температуры, диаметра,
   расхода и длины — иначе в открытой справке останутся прежние подстановки и результаты. */
/* Пересчёт панели по текущим данным (если расчёт уже делали) + перерисовка открытой справки.
   doCalc — исходный обработчик кнопки «Рассчитать»; вызываем его напрямую, чтобы не зациклиться. */
const doCalc=$('btnCalc').onclick;
function refreshHelp(){
 const out=$('out');
 const hasRes=out && out.textContent.trim()!=='' && out.textContent.trim()!=='—';
 if(hasRes && doCalc) doCalc();
 const hp=$('help'); if(hp && hp.style.display==='block') hp.innerHTML=helpHtml();
}
$('btnCalc').addEventListener('click',refreshHelp);
$('cuSysField').addEventListener('change',refreshHelp);
['tcombo','dsel','q','len','dcv','pexSp'].forEach(id=>{ const el=$(id); if(el) el.addEventListener('change',refreshHelp); });
document.addEventListener('change',e=>{ if(e.target && (e.target.name==='cusys'||e.target.name==='cool'||e.target.id==='xiother')) refreshHelp(); });
setDocLinks(MATERIALS[0]);
fillDiameters();