/* ui.js — логика интерфейса расчёта: заполнение списков, чтение контролов, вывод, справка.
   Зависимости (загружаются раньше в index.html): formulas.js, js/data/* (registry, docs, modes,
   модули типов труб), calc.js.
   ВСЕ вычисления — в calc.js (shevCalc, velocity, gradient, speedNotes, recommendation, fmt);
   здесь только DOM: взять значения контролов → вызвать движок → нарисовать результат. */
"use strict";

const $=id=>document.getElementById(id);

function fillMaterials(){
 const sel=$('material');
 sel.innerHTML='';
 MATERIALS.forEach(m=>{const o=document.createElement('option');o.value=m.id;o.textContent=m.name;sel.appendChild(o);});
}
function currentMat(){return MATERIALS.find(m=>m.id===$('material').value);}

/* Режимы участка зависят от системы (холодного/горячего водоснабжения) — как Combo3+Option5/6 */
function fillModes(keep){
 const sys=document.querySelector('input[name=sys]:checked').value;
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
 applyCopperVisibility(id);   // медная страница: свои блоки (Выбор системы/Температура/Теплоноситель/Местные)
 document.querySelectorAll('input[name=sys]').forEach(r=>{r.disabled=false;});
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
  const cold=document.querySelector('input[name=sys]:checked').value==='cold';
  $('rho').disabled=false;
  // у стали/э-с ν входит в формулы: в ХВС это 1,3·10⁻⁶ (вода 10 °C), а не 0; у прочих страниц ν не используется
  if(cold) $('nu').value=usesSys(currentMat().id)?'1.3e-6':'0';
  $('nu').disabled=cold;$('nuPreset').disabled=cold;
 }
}

/* Медная страница (frmtablII9 «для медных труб СП40-108-2004»): стального блока «Режим /
   теплоноситель», режима и k на ней НЕТ; вместо них — Frame2 «Выбор системы» (Option1–4),
   Frame4 «Температура, °С» (Combo3: 50,60,70,80,90), Frame5 «Теплоноситель» (Option7 «вода» /
   Option8 «другой» + Text18 ρ + Text3 ν) и Frame6 «Местные сопротивления» (Check1–12 + Text5–17
   «шт.», Check14 «другие» + Text17, Label11 «Sx=», Command4 «Сброс»). */
function applyCopperVisibility(id){
 const m=MATERIALS.find(x=>x.id===id);
 const cu = usesCu(id);   // карта m.ui.cu из данных страниц (copper/pex/metal-pex)
 ['cuSysField','cuTField','cuHeatField','xiField'].forEach(r=>$(r).style.display=cu?'':'none');
 // на этих страницах нет ни режима, ни k, ни «учесть местные» (Frame6 с ξ вместо этого)
 if(cu){ ['sysRow','mestRow','modeRow','kRow'].forEach(r=>$(r).style.display='none'); }
 if(cu){
  // Frame2 «Выбор системы»: у меди Option1–4 (шаблон 0x6fb58), у PEX Option1–3 (слоты 0x388
  // «холодного водоснабжения», 0x38c «горячего водоснабжения», 0x384 «отопления») — набор кнопок
  // и подписи пересобираются по данным материала
  const map = id==='copper' ? m.cuSys : m.pexSys;
  const box=$('cuSysField').querySelector('.cusys');
  const prev=(document.querySelector('input[name=cusys]:checked')||{}).value;
  box.innerHTML='';
  Object.keys(map).forEach(k=>{
   const lab=document.createElement('label');
   lab.innerHTML=`<input type="radio" name="cusys" value="${k}"${k===prev?' checked':''}> ${map[k].cap}`;
   box.appendChild(lab);
  });
  if(!document.querySelector('input[name=cusys]:checked')) box.querySelector('input').checked=true;
  box.querySelectorAll('input[name=cusys]').forEach(r=>r.onchange=cuSysSync);
  cuSysSync();
 }
}

/* Класс чугунной трубы (frmtablII3: Option3=ЛА, Option4=А, Option7=Б) */
function curCls(){const r=document.querySelector('input[name=cls]:checked');return r?r.value:'ЛА';}
/* а/ц (frmtablII4): класс трубы ВТ и тип по размерам */
function curVt(){const r=document.querySelector('input[name=vt]:checked');return r?r.value:'ВТ6';}
function curTip(){const r=document.querySelector('input[name=tip]:checked');return r?+r.value:1;}
/* пластик (frmtablII5): марка полиэтилена (Option1–4) и серия SDR (Option5–13) */
function curPe(){const r=document.querySelector('input[name=pe]:checked');return r?r.value:'32';}
function curSdr(){const r=document.querySelector('input[name=sdr]:checked');return r?r.value:null;}
/* PEX (frmtablII10): серия труб (Option4/9/10/11/12) и строка сортамента [S, ΔS, Δd] для dн */
function curPexSdr(){const r=document.querySelector('input[name=pexsdr]:checked');return r?r.value:'sdr136';}
function pexRow(){const m=currentMat(); if(!m.series) return null;
 const s=m.series.find(x=>x.id===curPexSdr())||m.series[0]; return s.t[+$('dsel').value]||null;}

/* Состояние блока исходных данных (frmtablII3, проверка на живой программе):
   «другой» свободен при любом классе/dу; при включении блокируется весь блок —
   классы, селектор dу, строка dн/S/dв; dp — ручной ввод. Вызывается при смене
   материала/класса/чекбокса. */
function applyClsState(){
 const m=currentMat();
 const other=$('danother').checked;
 // чугун «другой» (frmtablII3), пластик «не по ГОСТу» (frmtablII5), ж/б «другой» (ГОСТ 12586.0-83)
 // и стеклопластик «другой» (СП40-104-2001): выбор по списку блокируется, dp — ручной ввод
 const gated=!!(m.cls||m.pe||m.sMap||m.series||m.id==='conc'||m.id==='grp'||m.id==='glass');
 document.querySelectorAll('input[name=cls]').forEach(r=>r.disabled=other&&!!m.cls);
 document.querySelectorAll('input[name=pe],input[name=sdr]').forEach(r=>r.disabled=other&&!!m.pe);
 document.querySelectorAll('input[name=pexsdr]').forEach(r=>r.disabled=other&&!!m.series);
 $('dsel').disabled=other&&gated;
 $('dcv').disabled=!other;
}

/* Заполнение списка диаметров; выбор диаметра/стенки сохраняется при пересборке. */
function fillDiameters(){
 const m=currentMat(); const sel=$('dsel');
 const prev=sel.value;
 sel.innerHTML='';
 $('clsRow').style.display=m.cls?'':'none';
 $('vtRow').style.display='none'; $('tipRow').style.display='none'; // селекторы а/ц — только на своей странице
 $('peRow').style.display='none'; $('sdrRow').style.display='none'; // блоки пластика — только на своей странице
 $('pexSdrRow').style.display='none'; $('pexSpRow').style.display='none'; // рамка «Серия труб» PEX — только на своей странице
 $('dpOtherCap').textContent=m.pe?'не по ГОСТу':'другой'; // Check1 frmtablII5 озаглавлен иначе, чем «другой» прочих страниц
 if(m.gas){
   // frmtablII1: dн → связанная стенка S → dp = dн − 2s − 1
   m.gas.dn.forEach(d=>{
     const o=document.createElement('option');
     o.value=String(d); o.textContent=`dн=${fmt(d,1)} мм`;
     sel.appendChild(o);});
   if(prev && [...sel.options].some(o=>o.value===prev)) sel.value=prev;
   const t=$('tsel'); const prevT=t.value; t.innerHTML='';
   (m.gas.s[sel.value]||[]).forEach(s=>{const o=document.createElement('option');o.value=s;o.textContent=fmt(s,2);t.appendChild(o);});
   if(prevT && [...t.options].some(o=>o.value===prevT)) t.value=prevT;
   $('thicknessRow').style.display='';
   $('dLabel').textContent='Наружный диаметр dн, мм:';
   $('tLabel').textContent='Толщина стенки S, мм:';
   $('dvLabel').innerHTML='Расчётный внутренний диаметр dp, мм:';
   $('dpOther').style.display='';
 } else if(m.id==='asbes'){
   // frmtablII4: радио ВТ6–ВТ15 + комбо dу + радио «Тип 1–3»; dв — из таблицы ГОСТ 539-80.
   // При Тип 1 программа ВТ15 ПРЯЧЕТ целиком (живой кадр ac_v15_tip1: подписи нет вовсе,
   // 0 тёмных пикселей против 71 при Тип 2/3), а не гасит её: в ГОСТ 539-80 табл. 2 класса
   // ВТ15 нет вообще, так что здесь программа и стандарт совпадают. Прежняя запись «у ВТ15
   // только тип 2» неверна — при Тип 3 ВТ15 видна и выбирается (ac_v15_tip3), см. данные.
   $('vtRow').style.display=''; $('tipRow').style.display='';
   const t15=document.querySelector('input[name=vt][value="ВТ15"]');
   const hide15=curTip()===1;
   t15.closest('label').style.display=hide15?'none':'';
   t15.disabled=hide15;
   if(t15.disabled&&t15.checked)document.querySelector('input[name=vt][value="ВТ6"]').checked=true;
   const vt=curVt(),tip=curTip();
   m.vt.filter(v=>v.items.some(it=>it[0]===vt&&it[1]===tip)).forEach(v=>{
    const o=document.createElement('option');
    o.value=String(v.du); o.textContent=`dу=${v.du} мм`;
    sel.appendChild(o);});
   if(prev && [...sel.options].some(o=>o.value===prev)) sel.value=prev;
   $('thicknessRow').style.display='none';
 } else if(m.pe){
   // frmtablII5 (скрины 05.10.2026 + ГОСТ 18599-2001 табл.1–4): марка ПЭ + серия SDR + комбо dн.
   // Доступность серии — только по марке (матрица живой программы); список dн — строки выбранной серии
   // (подтверждено из программы: MRS3.2+SDR21 → 32,40,50,63,75,90,110,125,140,160); dв = dн − 2·e ном.
   $('peRow').style.display=''; $('sdrRow').style.display='';
   $('thicknessRow').style.display='none';
   const g=m.pe[curPe()];
   const dnPrev=+prev||null;
   let sdr=curSdr();
   if(!sdr||!g[sdr]){ // серия недопустима для новой марки — берём первую допустимую (предпочитая с текущей dн)
     sdr=null;
     const rs=[...document.querySelectorAll('input[name=sdr]')].filter(r=>g[r.value]);
     for(const r of rs) if(dnPrev&&g[r.value][dnPrev]!==undefined){sdr=r.value;break;}
     if(!sdr&&rs.length)sdr=rs[0].value;
     const r=document.querySelector('input[name=sdr][value="'+sdr+'"]');if(r)r.checked=true;
   }
   document.querySelectorAll('input[name=sdr]').forEach(r=>{r.disabled=!g[r.value];});
   const col=g[sdr]||{};
   Object.keys(col).map(Number).sort((a,b)=>a-b).forEach(dn=>{
     const o=document.createElement('option');o.value=String(dn);o.textContent=`dн=${dn} мм`;sel.appendChild(o);});
   if(prev && [...sel.options].some(o=>o.value===prev)) sel.value=prev;
 } else if(m.series){
   // frmtablII10 PEX (СП 41-109-2005 табл. 1): рамка «Серия труб» — Option4 «SDR 13,6 (S6,3)»,
   // Option9 «SDR 11 (S5)», Option10 «SDR 9 (4)», Option11 «SDR 7,4 (S3,2)», Option12 «SDR 6 (2,5)»;
   // комбо dн пересобирается (Clear 0x1e8 + AddItem 0x1ec): 0x5340e0 → 16…110 (10 значений),
   // 0x5312b0 и 0x534920 → 12,16,18,20,22,25…110 (13), 0x531910 и 0x531fd0 → 12,15,16…110 (14).
   // Это ровно строки табл. 1, где для выбранной серии есть S (у SDR 13,6 прочерк у 12, 15, 18, 22;
   // у SDR 11 и SDR 9 — у 15).
   $('pexSdrRow').style.display='';
   $('thicknessRow').style.display='none';
   const col=(m.series.find(s=>s.id===curPexSdr())||m.series[0]).t;
   // null — строка табл. 1 без толщины для этой серии (у SDR 13,6 это 12, 15, 18, 22): в комбо
   // программы их нет (AddItem 0x5340e0 даёт ровно 16…110)
   Object.keys(col).filter(dn=>col[dn]).map(Number).sort((a,b)=>a-b).forEach(dn=>{
    const o=document.createElement('option');o.value=String(dn);o.textContent=`dн=${dn} мм`;sel.appendChild(o);});
   if(prev && [...sel.options].some(o=>o.value===prev)) sel.value=prev;
   $('dLabel').textContent='Наружный диаметр dн, мм:';
   $('dvLabel').innerHTML='Внутренний диаметр dв, мм:';
   $('dpOther').style.display='';
 } else if(m.sMap){
   // frmtablII9 медь (СП 40-108-2004): комбо dн (20 значений, FUN_00510a20) → комбо толщин S
   // (FUN_00512ce0, 20 групп в порядке dн) → dв = dн − 2S (FUN_005148a0)
   m.d.forEach(d=>{const o=document.createElement('option');o.value=String(d);o.textContent=`dн=${fmt(d,1)} мм`;sel.appendChild(o);});
   if(prev && [...sel.options].some(o=>o.value===prev)) sel.value=prev;
   const t=$('tsel'); const prevT=t.value; t.innerHTML='';
   (m.sMap[sel.value]||[]).forEach(s=>{const o=document.createElement('option');o.value=s;o.textContent=fmt(s,2);t.appendChild(o);});
   if(prevT && [...t.options].some(o=>o.value===prevT)) t.value=prevT;
   $('thicknessRow').style.display='';
 } else if(m.cls){
   // frmtablII3: ОДИН список dу для всех классов из duList программы (14 шт; 450/700/900 нет),
   // выбор сохраняется при смене класса; dp — из таблицы класса (см. curDv).
   const dus=m.duList||[...new Set(Object.values(m.cls).flatMap(t=>Object.keys(t).map(Number)))].sort((a,b)=>a-b);
   dus.forEach(du=>{const o=document.createElement('option');o.value=du;o.textContent=`dу=${du} мм`;sel.appendChild(o);});
   if(prev && [...sel.options].some(o=>o.value===prev)) sel.value=prev;
   $('thicknessRow').style.display='none';
  } else {
   if(m.id==='metal-pex') $('pexSpRow').style.display=''; // у PEX-AL-PEX тоже доступен вариант СП
   m.d.forEach((d,i)=>{
     const o=document.createElement('option');
     // wall-материалы (электросварка): d — наружный, dв=d−2s считается по выбранной стенке
     // dvMap (стекло): в комбо НАРУЖНЫЙ dн, dв подставляет программа по таблице (скрин 93 → 81)
     const dv=m.dvMap? m.dvMap[d] : ((m.wall||m.dvSame)? d : m.dv[i]);
     o.value=m.dvMap? d : dv;
     o.textContent=(m.wall||m.dvMap)? `dн=${d} мм` : (m.dvSame?`dв=${d} мм`:`dу/dн=${d} мм (dв=${dv} мм)`);
     sel.appendChild(o);});
   if(prev && [...sel.options].some(o=>o.value===prev)) sel.value=prev;
   const showWall = !!m.wall;
   $('thicknessRow').style.display=showWall?'':'none';
   if(showWall){
     const t=$('tsel'); const prevT=t.value; t.innerHTML='';
     const dval=parseFloat(sel.value);
     (m.wall[String(dval)]||[]).forEach(s=>{const o=document.createElement('option');o.value=s;o.textContent=s;t.appendChild(o);});
     if(prevT && [...t.options].some(o=>o.value===prevT)) t.value=prevT;
   }
 }
 if(m.wall){ // frmtablII2: подписи как у газовых (dн/S/dp + «другой»), но без dу и типа труб
   $('dLabel').textContent='Наружный диаметр dн, мм:';
   $('tLabel').textContent='Толщина стенки S, мм:';
   $('dvLabel').innerHTML='Расчётный внутренний диаметр dp, мм:';
   $('dpOther').style.display='';
 } else if(m.sMap){ // frmtablII9 медь: рамка «Диаметр трубы, мм» — dн + S + dв + «другой» (Check13)
   $('dLabel').textContent='Наружный диаметр dн, мм:';
   $('tLabel').textContent='Толщина стенки S, мм:';
   $('dvLabel').innerHTML='Внутренний диаметр dв, мм:';
   $('dpOther').style.display='';
 } else if(m.series){ // frmtablII10 PEX: dн + dв (подставляет программа) + «другой dв» (Check13 0x300)
   $('dLabel').textContent='Наружный диаметр dн, мм:';
   $('dvLabel').innerHTML='Внутренний диаметр dв, мм:';
   $('dpOther').style.display='';
   $('pexSpRow').style.display=''; // галка «считать по формуле (4) СП»
 }
 else if(m.id==='metal-pex'){ $('dLabel').textContent='Наружный диаметр dн, мм:'; $('dvLabel').innerHTML='Внутренний диаметр dв, мм:'; $('dpOther').style.display=''; }
 else if(m.cls){ // frmtablII3: чугун — dу + «другой», без стенки
   $('dLabel').textContent='Условный проход dу, мм:';
   $('tLabel').textContent='Толщина стенки, мм:';
   $('dvLabel').innerHTML='Расчётный внутренний диаметр dp, мм:';
   $('dpOther').style.display='';
 } else if(m.id==='asbes'){ // frmtablII4: dу + dв + «Другой» (помогает флажок из справки)
   $('dLabel').textContent='Условный проход dу, мм:';
   // Подпись ровно как рамка оригинала: «Внутренний диаметр, мм» — без «dp» (живые кадры
   // ac_du150_vt12_t1 и др.). В оригинале шапка его таблицы результатов печатает «d= <номинальный dу>»
   // (не dв); клон выводит результаты текстом, такой шапки у него нет — это различие структуры, не баг.
   $('dvLabel').innerHTML='Внутренний диаметр, мм:';
   $('dpOther').style.display='';
  } else if(m.pe){ // frmtablII5: dн + dв + «не по ГОСТу» (Check1, 0x5fcfe)
   $('dLabel').textContent='Наружный диаметр dн, мм:';
   $('dvLabel').innerHTML='Внутренний диаметр dв, мм:';
   $('dpOther').style.display='';
  } else if(m.dvMap){ // frmtablII8 стекло (скрин 07.10.2026): рамка «Диаметр, мм» — комбо dн,
   // предзаполненное dв из таблицы программы, флажок «другой» + окно ручного dp
   $('dLabel').textContent='Наружный диаметр dн, мм:';
   $('dvLabel').innerHTML='Внутренний диаметр dв, мм:';
   $('dpOther').style.display='';
  } else if(m.id==='conc'||m.id==='grp'){ // ж/б (скрин 06.10.2026) и стеклопластик (скрин 07.10.2026):
   // рамка «Внутренний диаметр, мм» + комбо d (= dв), флажок «другой» и окно ручного dp
   // («…установите флажок "другой" и в окно ввода введите … расчетного внутреннего диаметра» — справки)
   $('dLabel').textContent='Внутренний диаметр, мм:';
   $('dvLabel').innerHTML='Расчётный внутренний диаметр dp, мм:';
   $('dpOther').style.display='';
  } else if(!m.gas){ // подписи строк — общие (для газовой страницы заданы выше)
   $('dLabel').textContent='Диаметр:';
   $('tLabel').textContent='Толщина стенки, мм:';
   $('dvLabel').innerHTML='Расчётный внутренний диаметр dp, мм:';
   $('dpOther').style.display='none';
 }
 updDv();
  updDu();
  updCiDims();
}
/* Строка «наружный dн= / толщина стенки S= / внутренний dв=» (frmtablII3, Label16/17/18) */
function updCiDims(){
 const m=currentMat(), row=$('ciDims');
 if(!m.cls){row.style.display='none';$('ciDimsLine').textContent='';return;}
 row.style.display='';
 const du=+$('dsel').value;
 const t=m.cls[curCls()][du]||[du,0];
 $('ciDimsLine').innerHTML=`наружный dн=${fmt(t[0],1)} мм<br>толщина стенки S=${fmt(t[1],2)} мм<br>внутренний dв=${fmt(t[0]-2*t[1],1)} мм`;
 row.classList.toggle('dimmed',$('danother').checked);
}
function findDByDv(m,dv){
 if(m.wall||m.gas||m.dvMap) return dv; // у wall/gas/dvMap-материалов dsel.value уже = dн
 for(let i=0;i<m.d.length;i++) if(m.dv[i]===dv) return m.d[i];
 return m.d[0];
}
function updDv(){
 const m=currentMat();
 if((m.gas||m.wall||m.cls||m.pe||m.sMap||m.series||m.dvMap||m.id==='asbes'||m.id==='conc'||m.id==='grp') && $('danother').checked) return; // ручной dp — поле не трогаем
 const dv=curDv();
 $('dcv').value=isNaN(dv)?'':fmt(dv,2);
}

/* dу и тип труб по dн/s — как в программе (Label13 «Диаметр условного прохода dу=» +
   строки «трубы легкие/обыкновенные/усиленные» 0x4418a0/c0/ec). dу — Таблица 1 кн. Шевелева;
   «обыкновенная» стенка — по книжному dв (у 21.3/26.8 из четырёх — 2,8) */
/* Местные сопротивления у газовых стальных труб: при dу ≥ 80 (dн ≥ 88,5 по ГОСТ 3262-75)
   программа отключает галочку «учесть потери на местные сопротивления» — местные не учитываются
   (живое наблюдение 10.10.2026; на малых диаметрах галочка доступна). */
function applyMestLimit(){
 const m=currentMat(); if(!m) return;
 const cb=$('chkMest'); if(!cb) return;
 // Порог — по диаметру, и он разный на двух стальных страницах (живые пробы 12.10.2026):
 // ВГП frmtablII11: dу ≥ 80 (dн ≥ 88,5); электросварные frmtablII2: dн ≥ 88 (dн=76 — галочка
 // есть, dн=88 и 89 — нет). Правило НЕ по расчётному dp: при dн=89, S=5 (dp=79) галочки тоже нет.
 let off;
 if(m.gas){ const dy=m.gas.du[$('dsel').value]; off=(dy!==undefined && dy>=80); }
 else if(m.mestDn!==undefined){ const dn=parseFloat($('dsel').value); off=(!isNaN(dn) && dn>=m.mestDn); }
 else return;
 const wasOff=cb.dataset.mestOff==='1';
 if(off!==wasOff){
  cb.dataset.mestOff=off?'1':'0';
  if(off){                                                // уходим в зону порога: помним галочку И значение k
   cb.dataset.mestRemembered=cb.checked?'1':'0';
   cb.dataset.mestKPrev=$('k').value;                     // в т.ч. введённый вручную 0 — не подменяем на k режима
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
 // В оригинале строки не затемняются, а ИСЧЕЗАЮТ (живые скрины dн=88,5 ВГП и dн=88 э/с:
 // в рамке «Потери напора на участке, м» остаётся только «Длина участка L=»). Флаги disabled
 // держим теми же — на них опирается остальной код и тесты.
 ['mestRow','modeRow','kRow'].forEach(r=>{ const e=$(r); if(e) e.style.display=off?'none':''; });
 cb.disabled=off;
 if(off){
  cb.checked=false; $('k').value='0';                     // местные не учитываются
  $('mode').disabled=true; $('k').disabled=true;
 } else {
  const on=cb.checked;
  $('mode').disabled=!on; $('k').disabled=!on;
 }
}
function updDu(){
 const m=currentMat(), el=$('duLine');
 el.parentElement.style.display=m.gas?'':'none'; // у прочих материалов строки dу нет
 if(!m.gas){el.textContent=''; if(m.mestDn!==undefined) applyMestLimit(); return;}
 const dn=$('dsel').value, dy=m.gas.du[dn];
 if(dy===undefined){el.textContent='';return;}
 const w=m.gas.s[dn]||[], s=parseFloat($('tsel').value);
 const ord=m.gas.ord[dn]!==undefined?m.gas.ord[dn]:w[1];
 const typ=s===ord?'обыкновенные':(s===Math.max(...w)?'усиленные':'легкие');
 el.textContent=`Диаметр условного прохода dу=${dy}\nтрубы ${typ}`;
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
function curDv(){
 const m=currentMat();
 if(m.series){ // frmtablII10 PEX: Combo1_Click FUN_00522aa0 → Text2 (слот 0x304). На каждый
   // диаметр в EXE лежат (S, ΔS, Δd) из табл. 1 СП 41-109 (dн=16 и SDR 13,6 → 1,3; 0,4; 0,3),
   // арифметика 0x5263e9…0x5264ca (int 2 @0x5263f4, int 4 @0x526457, 0,5 @0x526437) →
   // dв = 0,5(2dн + Δd − 4S − 2ΔS) = dн − 2S − ΔS + Δd/2 = 16 − 2,6 − 0,4 + 0,15 = 13,15 — ровно
   // как в оригинале (живые показания 08.10.2026, «другой dв» снят: dн=16, SDR 13,6 → dв=13,15,
   // v=22,089, i=34,505; dн=110, SDR 13,6 → dв=93,2, v=2,932, i=0,098). Прежняя запись
   // dн − 2(S+ΔS) + Δd/2 давала 12,75 и 92,1; показание 12,75 было ручным «другой dв».
   if($('danother').checked) return numStrict($('dcv').value);   // Check13 «другой dв»
   const r=pexRow(); if(!r) return NaN;
   return +$('dsel').value - 2*r[0] - r[1] + r[2]/2;   // dн − 2S − ΔS + Δd/2
  }
 if(m.sMap){ // frmtablII9 медь: dв = dн − 2S (FUN_005148a0: fld S → fadd st(0),st(0) → __vbaVarSub(dн, 2S)
             // @0x514aa6 → формат с «,» (0x441884/0x44188c) → Text2 (слот 0x54c) @0x514b56)
   if($('danother').checked) return numStrict($('dcv').value);
   const dn=parseFloat($('dsel').value), s=parseFloat($('tsel').value);
   return (isNaN(dn)||isNaN(s))?NaN:dn-2*s;
  }
 if(m.gas||m.wall){ // frmtablII1/2: dн→S→dp = dн − 2s − 1 (коррозия);
   // порога «dн ≥ 300 мм» в программе НЕТ (живые точки 12.10.2026, электросварные:
   // dн=325 S=4 → dp=316; dн=426 S=4 → 417; dн=530 S=20 → 489; dн=1120 S=10 → 1099,
   // а при «новые» там же → 1100). Книжное «при диаметре более 300 мм единицу можно не
   // отнимать» (кн. Шевелевых, печатная стр. 6) программой не реализовано.
   if($('danother').checked) return numStrict($('dcv').value);
   const dn=parseFloat($('dsel').value), s=parseFloat($('tsel').value);
   if(isNaN(dn)||isNaN(s)) return NaN;
   // «−1 мм» — только у «неновых» (живые точки 10.10.2026: «новые» dн=26,8 S=2,35 → dв=22,1;
   // «неновые» dн=26,8 S=2,5 → dв=20,8; dн=114 S=4,5 → dв=104)
   const oldWear=document.querySelector('input[name=wear]:checked').value==='old';
   return dn-2*s-(oldWear?1:0);
 }
 if(m.cls){ // frmtablII3 (чугун): dв=dн−2S из таблицы класса; dp=dв−1 у «неновых» при ЛЮБОМ dу
   if($('danother').checked) return numStrict($('dcv').value);
   const du=+$('dsel').value;
   const t=m.cls[curCls()][du]||[du,0]; // страховка на неполную таблицу; у всех классов EXE строки есть (16, включая dу=1000)
   const dv=t[0]-2*t[1];
   // Порога «dв ≤ 300» в программе НЕТ (живые точки 13.10.2026, 20 пар «новые/неновые»: dв=304,4
   // →303,4; 503,6→502,6; 799,8→798,8; 803,6→802,6; 1003→1002; 994→993). Прежнее условие dv<=300
   // выросло из строки VarCmpLe(…,300) в декомпиляции — это путаница Ghidra со стековыми слотами:
   // в FUN_004b1b00 48 Variant-пар = ровно 48 толщин, ни одной «круглой» константы там нет.
   // То же правило, что на обеих стальных страницах; см. ../AGENTS.md (раздел про чугун).
   return dv-(document.querySelector('input[name=wear]:checked').value==='old'?1:0);
 }
 if(m.id==='asbes'){ // frmtablII4: dв из таблицы (ВТ,тип,dу); «Другой» — ручной ввод
   if($('danother').checked) return numStrict($('dcv').value);
   const du=+$('dsel').value,vt=curVt(),tip=curTip();
   const row=m.vt.find(v=>v.du===du);
   const it=row&&row.items.find(x=>x[0]===vt&&x[1]===tip);
   return it?it[2]:NaN;
  }
  if(m.pe){ // frmtablII5: dв = dн − 2e (ГОСТ 18599-2001, табл.1–4 по марке и SDR); «не по ГОСТу» — ручной dв в окно ввода
    if($('danother').checked) return numStrict($('dcv').value);
    const dn=+$('dsel').value,g=m.pe[curPe()],e=g[curSdr()]&&g[curSdr()][dn];
    return e===undefined?NaN:dn-2*e;
  }
  if(m.dvMap){ // frmtablII8 стекло (скрин 07.10.2026): dн из комбо → dв из таблицы программы
                 // (93 → 81); «другой» — ручной dp (FUN_0050d4c0)
    if($('danother').checked) return numStrict($('dcv').value);
    return m.dvMap[+$('dsel').value];
  }
  if(m.id==='conc'||m.id==='grp'){ // frmtablII ж/б (скрин: d=600 → dp=600) и стеклопластик
    // (скрин: d=60 → dp=60): dв = d из списка; «другой» — ручной dp
    if($('danother').checked) return numStrict($('dcv').value);
    return parseFloat($('dsel').value);
  }
  return parseFloat($('dsel').value);
}

/* Расчёт: здесь ТОЛЬКО чтение контролов и вывод. Валидация, v, i, R, H, предупреждения и
   строка рекомендации — в calc.js (shevCalc). dpOf(d) остаётся в ui.js, потому что зависит от
   контролов: стенка (газовые/э/с), класс и «неновые» (чугун), SDR (ПЭ). */
/* Единая точка сборки входа движка: calc() берёт объект отсюда, поэтому «что видит пользователь»
   и «что считает движок» не разъезжаются. Подстановка чисел в справку (js/help/<id>.js) читает
   ровно те же контролы и зовёт тот же движок shevCalc — потому числа справки равны выводу страницы.
   Это не «единственное чтение контролов»: ниже делегируется в curDv(), cuSysVal(),
   xiTotal(), cuCool(), а calc() дополнительно строит dpOf — осознанно зависимые читатели, их
   результат обязан совпадать с тем, что вернул readForm(). */
function readForm(){
 const m=currentMat();
 return {
  mat:m.id,
  sys:(document.querySelector('input[name=sys]:checked')||{}).value,
  wear:(document.querySelector('input[name=wear]:checked')||{}).value,
  dv_mm:curDv(),
  q:numStrict($('q').value), qunit:$('qunit').value,
  L:numStrict($('len').value),
  k:numStrict($('k').value), mest:!!($('chkMest') && $('chkMest').checked),
  nu:numStrict($('nu').value), rho:numStrict($('rho').value),
  mode:$('mode').value,
  selD:m.gas?m.gas.du[$('dsel').value]:+$('dsel').value,
  // медная страница (frmtablII9): система из Frame2, ξ из Frame6, ν/ρ из Frame5 (или по t из Combo3)
  cuSys:cuSysVal(), xiSum:xiTotal(), t:numStrict($('tcombo').value),
  cool:cuCool(), cuNu:numStrict($('cunu').value)*1e-6, cuRho:numStrict($('curho').value),
  pexSp:!!($('pexSp') && $('pexSp').checked), // PEX: по формуле (4) СП вместо кода программы
 };
}
function calc(){
 const out=$('out');
 $('outH').innerHTML='—';
 const m=currentMat();
 const dpOf=(d)=>{
   if(m.gas){const it=Object.entries(m.gas.du).find(([,u])=>u===d);if(!it)return NaN;
     const dn=+it[0],s=parseFloat($('tsel').value);if(isNaN(s))return NaN;
     // Тот же закон, что в curDv(): «−1 мм» (коррозия/отложения) только у «неновых», порога
     // «dн ≥ 300 мм» в программе нет (живые точки 12.10.2026, электросварные: dн=325 S=4 → 316;
     // dн=1120 S=10 → 1099, «новые» → 1100). У ВГП максимальный dн=165, так что там правка
     // ничего и не меняла. Живые точки 10.10.2026: «новые» dн=26,8 S=2,35 → dв=22,1;
     // «неновые» dн=26,8 S=2,5 → dв=20,8.
     return dn-2*s-(document.querySelector('input[name=wear]:checked').value==='old'?1:0);}
   if(m.wall){const dn=+d,s=parseFloat($('tsel').value);if(isNaN(dn)||isNaN(s))return NaN;
     // электросварные (frmtablII2): тот же dр = dн − 2S − 1 при любом диаметре
     return dn-2*s-(document.querySelector('input[name=wear]:checked').value==='old'?1:0);}
   if(m.cls){const t=m.cls[curCls()][d];if(!t)return NaN;const dv=t[0]-2*t[1];
     // чугун: dр = dв − 1 у «неновых» при любом диаметре — то же правило, что в curDv()
     return dv-(document.querySelector('input[name=wear]:checked').value==='old'?1:0);}
   if(m.pe){const sd=m.pe[curPe()][curSdr()];return !sd||sd[d]===undefined?NaN:d-2*sd[d];}
   if(m.dvMap){const x=m.dvMap[d];return x===undefined?NaN:x;}
   return d; // ж/б, а/ц, стеклопластик, стекло: dв = dу (или подставлен программой)
 };
 // оригинал перед расчётом проверяет введённый коэффициент (MessageBox «Вы не ввели значение коэффициента», BSTR 0x047b70)
 if(usesK(m.id) && $('chkMest') && $('chkMest').checked && String($('k').value).trim()===''){
  out.innerHTML='<span class="warn">Вы не ввели значение коэффициента</span>'; return; }
 const inp=readForm(); inp.dpOf=dpOf;
 const r=shevCalc(inp);
 if(!r.ok){out.innerHTML=`<span class="warn">${r.error}</span>`;return;}
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
function cuMat(){ const m=currentMat(); return m&&usesCu(m.id)?m:null } // у PEX-AL-PEX свои «Температура» и «Теплоноситель»
function cuSysVal(){ const r=document.querySelector('input[name=cusys]:checked'); return r?r.value:'cold' }
function cuCool(){ const r=document.querySelector('input[name=cool]:checked'); return r?r.value:'water' }
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
 /* ξ-список меди и PEX идентичен (Variant 0x529fcc…0x52a160), поэтому сетку строим один раз при
   инициализации; на странице, где нет меди/PEX, берём медный список. */
 const m=cuMat()||MATERIALS.find(x=>x.id==='copper'), g=$('xiGrid'); g.innerHTML='';
 m.xi.forEach((row,i)=>{
  const lab=document.createElement('label'); lab.className='xiItem';
  lab.innerHTML=`<input type="checkbox" id="xi${i}"> ${xiPic(row[0])} <span class="xiName">${row[0]}</span> <span class="hint">ξ=${fmt(row[1],1)}</span>`+
                `<input type="number" id="xin${i}" class="w-xi" min="0" step="1" value="1"> <span class="unit">шт.</span>`;
  g.appendChild(lab);
 });
}
/* Σξ = Σ ξ_i·шт. (цепочка VarMul→VarAdd 0x518c80–0x518e79); «другие ξ» (Text17/Check14)
   прибавляется последним VarAdd БЕЗ умножения */
function xiTotal(){
 const m=cuMat(); if(!m) return 0;
 let s=0;
 m.xi.forEach((row,i)=>{
  const c=$('xi'+i), n=numStrict(($('xin'+i)||{}).value||'');
  if(c && c.checked && !isNaN(n)) s+=row[1]*n;
 });
 if($('xiother').checked){ const o=numStrict($('xiotherval').value); if(!isNaN(o)) s+=o; }
 return s;
}
function xiShow(){ $('xiSum').textContent=fmt(xiTotal(),2) }   // Label11 «Sx=»
/* «Сброс» (Command4 → FUN_0051c530): обнуляет 13 пар Text/Check (слоты 0x338…0x39c) */
function xiResetAll(){
 const m=cuMat()||MATERIALS.find(x=>x.id==='copper');
 m.xi.forEach((row,i)=>{ $('xi'+i).checked=false; $('xin'+i).value='1'; });   // количество — по умолчанию 1 шт.
 $('xiother').checked=false; $('xiotherval').value='';
 xiShow();
}

/* Активность блоков меди — как в оригинальном окне frmtablII9:
   «холодного водоснабжения» (Option1): Frame4 «Температура» и Frame5 «Теплоноситель» оба
   неактивны — программа берёт воду со стандартными ν = 1,3·10⁻⁶ м²/с (DAT_00402448 @0x5166da)
   и ρ = 1000 кг/м³; «циркуляционного» (Option2) и «подающего» (Option3) ГВС: активен только
   Frame4 «Температура» (Combo3 50…90), по которому подставляются ν и ρ, Frame5 неактивен;
   «системы отопления» (Option4): активны оба блока, «другой» открывает ручной ν (Text3) и ρ (Text18). */
function cuSysSync(){
 const m=cuMat(); if(!m) return;
 const sys=cuSysVal();
 const tActive = sys!=='cold';                                    // Frame4
 const coolActive = sys==='heat';                                  // Frame5: «вода/другой» только в отоплении
 $('tcombo').disabled=!tActive;
 $('cuTField').classList.toggle('off',!tActive);   // весь блок выглядит неактивным
 $('cuHeatField').classList.toggle('off',!coolActive);
 document.querySelectorAll('input[name=cool]').forEach(r=>r.disabled=!coolActive);
 if(!coolActive) document.querySelector('input[name=cool][value=water]').checked=true;
 if(!tActive) $('tcombo').value='';
 $('cuTHint').textContent   = tActive ? '' : 'в оригинале блок неактивен: вода ν = 1,3·10⁻⁶ м²/с, ρ = 1000 кг/м³';
 $('cuCoolHint').textContent= coolActive ? '' : (tActive
  ? 'в оригинале блок неактивен: ν и ρ подставляются по температуре'
  : 'в оригинале блок неактивен: вода ν = 1,3·10⁻⁶ м²/с, ρ = 1000 кг/м³');
 $('tHint').style.display=(sys==='circ'||sys==='supply'||sys==='hot')?'':'none';
 cuHeatSync();
}

/* «вода» (Option7): ρ и ν подставляются по температуре из Combo3 — пороги 50/60/70/80/90 °C
   (0x516bfa…0x5176e3), ρ = 10³·{0,99;0,98;0,98;0,97;0,97}, ν = 10⁻⁶·{0,55;0,47;0,41;0,36;0,36}.
   Строк Таблицы 5 СП для t = 5…20 °C (1,52·10⁻⁶; 1,01·10⁻⁶) в EXE нет: при t<50 или пустом t
   программа держит ν = 1,3·10⁻⁶ (DAT_00402448 @0x5166da) и ρ = 1000. «другой» (Option8) — ρ и ν
   из Text18/Text3 (поля разблокированы). */
function cuHeatSync(){
 const m=cuMat(); if(!m) return;
 const water=cuCool()==='water';
 $('cunu').disabled=water; $('curho').disabled=water;
 if(water){
  const t=numStrict($('tcombo').value);
  const row=isNaN(t)?null:(m.t||[]).filter(r=>r.t<=t).pop(); // у страницы может не быть своей таблицы ν/ρ
  $('cunu').value=row?(cuSysVal()==='circ'?'0.36':(row.nu*1e6).toFixed(2)):'1.3'; // медь «циркуляционный»: оригинал берёт 0,36e-6 при любом t (живые скрины 08.10.2026: t=50/60/70 → 0,36, i=0,398)
  $('curho').value=row?String(row.rho):'1000';
 }
 $('tHint').style.display=(cuSysVal()==='circ'||cuSysVal()==='supply'||cuSysVal()==='hot')?'':'none';
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
$('material').onchange=()=>{const m=currentMat();setDocLinks(m); fillXiGrid();if(!(m.cls||m.pe||m.series))$('danother').checked=false;applyClsState();applySysVisibility();fillDiameters(); const hp=$('help'); if(hp&&hp.style.display==='block') hp.innerHTML=helpHtml();};
$('dsel').onchange=fillDiameters;
document.querySelectorAll('input[name=cls]').forEach(r=>r.onchange=()=>{applyClsState();fillDiameters();});
document.querySelectorAll('input[name=vt],input[name=tip]').forEach(r=>r.onchange=fillDiameters); // а/ц: ВТ/тип → пересборка dу и dв
document.querySelectorAll('input[name=pe]').forEach(r=>r.onchange=fillDiameters); // пластик: марка ПЭ → список dн и доступность SDR
document.querySelectorAll('input[name=sdr]').forEach(r=>r.onchange=fillDiameters); // пластик: серия SDR → список dн и dв
document.querySelectorAll('input[name=pexsdr]').forEach(r=>r.onchange=fillDiameters); // PEX: серия SDR → список dн и dв
$('tsel').onchange=()=>{updDv();updDu();};
$('danother').onchange=()=>{applyClsState();if(!$('danother').checked)updDv();updCiDims();}; // как в программе: при «другой» dp-инпут редактируем, блок dу/классов/dн-S-dв блокируется
document.querySelectorAll('input[name=wear]').forEach(r=>r.onchange=updDv); // чугун: −1 мм у «неновых» при любом dу (живые точки 13.10.2026)
$('chkMest').onchange=()=>{const on=$('chkMest').checked;$('mode').disabled=!on;$('k').disabled=!on;
 if(!on){ $('k').value='0'; }                                 // 10.10.2026: не оставляем пусто — 0 (иначе подстановка в справке вырождается в NaN)
 else { const kv=K_MODE[$('mode').value]; if(kv!==undefined) $('k').value=String(kv); } // включаем — k снова по режиму (0,3 и т. п.)
}; // как в программе (FUN_00480b10): без местных сопротивлений k блокируется и очищается
$('nuPreset').onchange=e=>{if(e.target.value){const[a,b]=e.target.value.split('|');$('nu').value=a;$('rho').value=b;}};
/* k по режиму, как в программе (FUN_00480b10). syncK() — явный вызов из обработчиков;
   раньше обработчики дёргали $('mode').onchange() друг из друга — скрытая цепочка, её нет. */
function syncK(){ const kv=K_MODE[$('mode').value]; if(kv!==undefined) $('k').value=String(kv); }
$('mode').onchange=syncK;
const T_NU_RHO={40:['0.66e-6','1000'],45:['0.605e-6','1000'],50:['0.55e-6','1000'],55:['0.51e-6','1000'],60:['0.47e-6','1000'],65:['0.44e-6','1000'],70:['0.41e-6','1000'],75:['0.385e-6','1000'],80:['0.36e-6','1000'],85:['0.34e-6','1000'],90:['0.32e-6','1000'],95:['0.30e-6','1000']}; // ν — точная таблица EXE FUN_0047de20 (реверс 10.10.2026), ρ — книжные пресеты
/* ν/ρ по выбранной t из поля «t = … °C» (ГВС стали); syncSteelT() — явный вызов, не $('tSteel').onchange() */
function syncSteelT(){ const p=T_NU_RHO[$('tSteel').value]; if(p){ $('nu').value=p[0]; $('rho').value=p[1]; } }
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
document.querySelectorAll('input[name=cusys]').forEach(r=>r.onchange=cuSysSync); // Frame2 Option1–4
document.querySelectorAll('input[name=cool]').forEach(r=>r.onchange=cuHeatSync);  // Frame5 вода/другой
$('tcombo').onchange=cuHeatSync;                                                  // Combo3 50…90 °C
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