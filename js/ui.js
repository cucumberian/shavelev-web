/* ui.js — логика интерфейса клона: заполнение списков, чтение контролов, вывод, справка.
   Зависимости (загружаются раньше в index.html): formulas.js, data.js, calc.js.
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
   в оригинальном окне (шаблоны форм EXE; см. calc.js — usesSys/usesWear/usesK).
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
  $('rho').disabled=false;if(cold)$('nu').value='0';$('nu').disabled=cold;$('nuPreset').disabled=cold;
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

/* Состояние блока исходных данных (frmtablII3, проверка на живой программе):
   «другой» свободен при любом классе/dу; при включении блокируется весь блок —
   классы, селектор dу, строка dн/S/dв; dp — ручной ввод. Вызывается при смене
   материала/класса/чекбокса. */
function applyClsState(){
 const m=currentMat();
 const other=$('danother').checked;
 // чугун «другой» (frmtablII3), пластик «не по ГОСТу» (frmtablII5), ж/б «другой» (ГОСТ 12586.0-83)
 // и стеклопластик «другой» (СП40-104-2001): выбор по списку блокируется, dp — ручной ввод
 const gated=!!(m.cls||m.pe||m.id==='conc'||m.id==='grp'||m.id==='glass');
 document.querySelectorAll('input[name=cls]').forEach(r=>r.disabled=other&&!!m.cls);
 document.querySelectorAll('input[name=pe],input[name=sdr]').forEach(r=>r.disabled=other&&!!m.pe);
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
   // frmtablII4 (скрин оригинала 05.10.2026): радио ВТ6–ВТ15 + комбо dу + радио «Тип 1–3»;
   // dв — из таблицы ГОСТ 539-80 (пул подсказок 0x42e5c..0x44f5c). Тип 1 ⇒ ВТ15 недоступен (у ВТ15 только тип 2).
   $('vtRow').style.display=''; $('tipRow').style.display='';
   const t15=document.querySelector('input[name=vt][value="ВТ15"]');
   t15.disabled=curTip()===1;
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
 } else if(m.cls){
   // frmtablII3: ОДИН список dу для всех классов из duList программы (14 шт; 450/700/900 нет),
   // выбор сохраняется при смене класса; dp — из таблицы класса (см. curDv).
   const dus=m.duList||[...new Set(Object.values(m.cls).flatMap(t=>Object.keys(t).map(Number)))].sort((a,b)=>a-b);
   dus.forEach(du=>{const o=document.createElement('option');o.value=du;o.textContent=`dу=${du} мм`;sel.appendChild(o);});
   if(prev && [...sel.options].some(o=>o.value===prev)) sel.value=prev;
   $('thicknessRow').style.display='none';
  } else {
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
 } else if(m.cls){ // frmtablII3: чугун — dу + «другой», без стенки
   $('dLabel').textContent='Условный проход dу, мм:';
   $('tLabel').textContent='Толщина стенки, мм:';
   $('dvLabel').innerHTML='Расчётный внутренний диаметр dp, мм:';
   $('dpOther').style.display='';
 } else if(m.id==='asbes'){ // frmtablII4: dу + dв + «Другой» (помогает флажок из справки)
   $('dLabel').textContent='Условный проход dу, мм:';
   $('dvLabel').innerHTML='Внутренний диаметр dp, мм:';
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
 if((m.gas||m.wall||m.cls||m.pe||m.dvMap||m.id==='asbes'||m.id==='conc'||m.id==='grp') && $('danother').checked) return; // ручной dp — поле не трогаем
 const dv=curDv();
 $('dcv').value=isNaN(dv)?'':fmt(dv,2);
}

/* dу и тип труб по dн/s — как в программе (Label13 «Диаметр условного прохода dу=» +
   строки «трубы легкие/обыкновенные/усиленные» 0x4418a0/c0/ec). dу — Таблица 1 кн. Шевелева;
   «обыкновенная» стенка — по книжному dв (у 21.3/26.8 из четырёх — 2,8) */
function updDu(){
 const m=currentMat(), el=$('duLine');
 el.parentElement.style.display=m.gas?'':'none'; // у прочих материалов строки dу нет
 if(!m.gas){el.textContent='';return;}
 const dn=$('dsel').value, dy=m.gas.du[dn];
 if(dy===undefined){el.textContent='';return;}
 const w=m.gas.s[dn]||[], s=parseFloat($('tsel').value);
 const ord=m.gas.ord[dn]!==undefined?m.gas.ord[dn]:w[1];
 const typ=s===ord?'обыкновенные':(s===Math.max(...w)?'усиленные':'легкие');
 el.textContent=`Диаметр условного прохода dу=${dy}\nтрубы ${typ}`;
}

/* Строгий разбор числа: запятая как разделитель допустима, мусор ('1e') — NaN;
   знак «минус» проходит дальше и отсекается валидацией calc() */
function numStrict(s){
 if(!s) return NaN;
 s=s.trim().replace(',','.');
 if(!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s)) return NaN;
 return parseFloat(s);
}
function readQ(){
 const q=numStrict($('q').value);
 if(isNaN(q)) return NaN;
 return $('qunit').value==='ls'? q/1000 : q/3600;   // л/с и м³/ч → м³/с
}
function curDv(){
 const m=currentMat();
 if(m.gas||m.wall){ // frmtablII1/2: dн→S→dp = dн − 2s − 1 (коррозия);
                    // для dн ≥ 300 мм уменьшение не учитывается (кн. Шевелевых, печатная стр. 6)
   if($('danother').checked) return numStrict($('dcv').value);
   const dn=parseFloat($('dsel').value), s=parseFloat($('tsel').value);
   if(isNaN(dn)||isNaN(s)) return NaN;
   return dn-2*s-((m.gas||dn<300)?1:0);
 }
 if(m.cls){ // frmtablII3: dв=dн−2S из таблицы класса; dp=dв−1 при dв≤300 и «неновые» (хвост FUN_004b1b00)
   if($('danother').checked) return numStrict($('dcv').value);
   const du=+$('dsel').value;
   const t=m.cls[curCls()][du]||[du,0]; // фолбэк как в EXE: нет строки (Б,1000) → dн=dу, S=0 → dp=dу
   const dv=t[0]-2*t[1];
   return dv-(dv<=300 && document.querySelector('input[name=wear]:checked').value==='old'?1:0);
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
function calc(){
 const out=$('out');
 $('outH').innerHTML='—';
 const m=currentMat();
 const dpOf=(d)=>{
   if(m.gas){const it=Object.entries(m.gas.du).find(([,u])=>u===d);if(!it)return NaN;
     const dn=+it[0],s=parseFloat($('tsel').value);return isNaN(s)?NaN:dn-2*s-1;}
   if(m.cls){const t=m.cls[curCls()][d];if(!t)return NaN;const dv=t[0]-2*t[1];
     return dv-(dv<=300&&document.querySelector('input[name=wear]:checked').value==='old'?1:0);}
   if(m.pe){const sd=m.pe[curPe()][curSdr()];return !sd||sd[d]===undefined?NaN:d-2*sd[d];}
   return d; // ж/б, а/ц, стеклопластик, стекло: dв = dу (или подставлен программой)
 };
 const r=shevCalc({
   mat:m.id,
   wear:document.querySelector('input[name=wear]:checked').value,
   dv_mm:curDv(),
   q:numStrict($('q').value), qunit:$('qunit').value,
   L:numStrict($('len').value),
   k:numStrict($('k').value), mest:$('chkMest').checked,
   nu:numStrict($('nu').value), rho:numStrict($('rho').value),
   mode:$('mode').value,
   selD:m.gas?m.gas.du[$('dsel').value]:+$('dsel').value,
   dpOf,
 });
 if(!r.ok){out.innerHTML=`<span class="warn">${r.error}</span>`;return;}
 $('hLegend').textContent=r.hLegend;
 out.innerHTML=r.lines.join('\n')+'\n'+r.notes.map(n=>`<span class="${n.cls}">${n.text}</span>`).join('\n');
 $('outH').innerHTML=r.outH.join('\n');
}

/* Дробь для «печатного» вида формул (офлайн: чистый CSS, без KaTeX/MathJax). */
const fr=(n,d)=>`<span class="frac"><span class="fnum">${n}</span><span class="fden">${d}</span></span>`;

function showHelp(){
 const h=$('help');
 if(h.style.display==='block'){h.style.display='none';return;}
 const HELP={steel:helpSteel,'steel-es':helpSteel,ci:helpCI,asbes:helpAsbes,plastic:helpPlastic,
  conc:helpConc,grp:helpGrp,glass:helpGlass};
 const hf=HELP[currentMat().id]; // диспатч по материалу; для неподтверждённых страниц — пусто, а НЕ стальная справка
 h.innerHTML=hf?hf():'';
 h.style.display='block';
}
/* Справка стальной страницы — как в оригинальной программе (frmtablII1 help, 0x50395) */
function helpSteel(){
 // верх — как в справке оригинальной программы (frmtablII1 help, 0x50395): формулы «в столбик»
 const mathSteel=`<b>Справка — для стальных труб</b>
 <div class="math">
  <div class="mrow"><span class="mlab">гидравлический уклон:</span>
   <span><i>i</i> = ${fr('λ','<i>d</i><sub>p</sub>')} · ${fr('<i>v</i><sup>2</sup>','2<i>g</i>')}</span></div>
  <div class="mrow"><span class="mlab">для новых стальных труб:</span>
   <span>λ = ${fr('0,312','<i>d</i><sub>p</sub><sup>0,226</sup>')} · <span class="grp">(1,9·10<sup>−6</sup> + ${fr('<span class="nu">ν</span>','<i>v</i>')})<sup>0,226</sup></span></span></div>
  <div class="mrow"><span class="mlab">для неновых стальных труб при <i>v</i>/<span class="nu">ν</span> ≥ 9,2·10<sup>5</sup> 1/м:</span>
   <span>λ = ${fr('0,021','<i>d</i><sub>p</sub><sup>0,3</sup>')}</span></div>
  <div class="mrow"><span class="mlab">то же при <i>v</i>/<span class="nu">ν</span> &lt; 9,2·10<sup>5</sup> 1/м:</span>
   <span>λ = ${fr('<span class="grp">(1,5·10<sup>−6</sup> + '+fr('<span class="nu">ν</span>','<i>v</i>')+')</span><sup>0,3</sup>','<i>d</i><sub>p</sub><sup>0,3</sup>')}</span></div>
  <div class="mrow"><span class="mlab">расчётный внутренний диаметр:</span>
   <span><i>d</i><sub>p</sub> = <i>d</i><sub>н</sub> − 2<i>s</i> − 1</span></div>
  <div class="mdef"><b>где</b>
   <div class="drow"><span class="dsym"><i>d</i><sub>p</sub></span><span>— расчётный внутренний диаметр, м;</span></div>
   <div class="drow"><span class="dsym"><i>d</i><sub>н</sub></span><span>— наружный диаметр трубы, мм;</span></div>
   <div class="drow"><span class="dsym"><i>s</i></span><span>— толщина стенки трубы, мм;</span></div>
   <div class="drow"><span class="dsym"><i>i</i></span><span>— гидравлический уклон;</span></div>
   <div class="drow"><span class="dsym">λ</span><span>— коэффициент сопротивления трения по длине;</span></div>
   <div class="drow"><span class="dsym"><i>v</i></span><span>— средняя скорость потока, м/с;</span></div>
   <div class="drow"><span class="dsym"><span class="nu">ν</span></span><span>— кинематическая вязкость воды, м²/с;</span></div>
   <div class="drow"><span class="dsym"><i>g</i></span><span>— ускорение свободного падения, g = 9,81 м/с² (2g = 19,62).</span></div>
  </div>
  <div class="hint">1 мм в формуле d<sub>p</sub> — толщина слоя коррозии и отложений на стенках.</div>
 </div>`;
 return mathSteel+`<hr>
 <b>Расчётные формулы (кн. Шевелева 1984; программа реализует ν-подставленные варианты)</b><br>
 i = λ·v²/(2g·d);  A ≡ λ/(2g);  i[м/м] = A·v²/d<sup>1+n</sup><br><br>
 <b>Новые стальные</b> (2а): λ = 0,0159·(1 + 0,684/v)<sup>0,226</sup> / d<sup>0,226</sup><br>
 <b>Новые чугунные</b> (3а): λ = 0,0144·(1 + 2,36/v)<sup>0,284</sup> / d<sup>0,284</sup><br>
 <b>Неновые ст./чуг.</b> (6) при v≥1,2: A = 0,021/(19,62·d<sup>0,3</sup>); <span class="hint">в программе A = 0,021/19,62 = 0,0010703…; коэффициент 0,00107 в книге — округление (расходится с программой на ≈0,03%)</span>&nbsp;
 (7) при v&lt;1,2: A = 0,000912·(1 + 0,867/v)<sup>0,3</sup> / d<sup>0,3</sup><br>
 <b>Асбестоцемент</b> (17): A = 0,000561·(1 + 3,51/v)<sup>0,190</sup> / d<sup>1,190</sup><br>
 <b>Железобетон</b> (22): A = 0,000802·(1 + 3,51/v)<sup>0,190</sup> / d<sup>1,190</sup> (×1,43 от а/ц)<br>
 <b>Пластик</b> (8): i = 0,000685·v<sup>1,774</sup> / d<sub>р</sub><sup>1,226</sup>;
 <b>Стекло</b> (9): i = 0,000745·v<sup>1,774</sup> / d<sub>р</sub><sup>1,226</sup> — не A·v²/d<sup>e</sup>, степень у v своя<br>
 <span class="hint">ν воды = 1,3·10⁻⁶ м²/с (t=10°C); пороги: 1,2 м/с = 9,2·10⁵·ν.<br>
  d в метрах. Обозначения — одна величина: d_р (книга) = dp (справка программы) = dв в интерфейсе,
  подставляется d_р = dв/1000. dв берётся из таблиц (для пластика по ГОСТ dв = dн − 2·e ном),
  «не по ГОСТу» — вводится вручную.</span>`;
}

/* Справка чугунной страницы (frmtablII3, help BSTR VA 0x4500aa): только чугунные формулы (кн. 3а, 6, 7)
   и примечания про ГОСТ/классы — по скрину оригинала */
function helpCI(){
 return `<b>Справка — для чугунных труб (ГОСТ 9583-75, ГОСТ 21053-75)</b>
 <div class="math">
  <div class="mrow"><span class="mlab">гидравлический уклон:</span>
   <span><i>i</i> = ${fr('λ','<i>d</i><sub>p</sub>')} · ${fr('<i>v</i><sup>2</sup>','2<i>g</i>')}</span></div>
  <div class="mrow"><span class="mlab">для новых чугунных труб:</span>
   <span>λ = ${fr('0,0144','<i>d</i><sub>p</sub><sup>0,284</sup>')} · <span class="grp">(1 + ${fr('2,36','<i>v</i>')})<sup>0,284</sup></span></span></div>
  <div class="mrow"><span class="mlab">для неновых чугунных труб при <i>v</i> &gt; 1,2 м/с или <i>v</i> = 1,2 м/с:</span>
   <span><i>i</i> = ${fr('0,00107·<i>v</i><sup>2</sup>','<i>d</i><sub>p</sub><sup>1,3</sup>')}</span></div>
  <div class="mrow"><span class="mlab">то же при <i>v</i> &lt; 1,2 м/с:</span>
   <span><i>i</i> = ${fr('0,000912·<i>v</i><sup>2</sup>','<i>d</i><sub>p</sub><sup>1,3</sup>')} · <span class="grp">(1 + ${fr('0,867','<i>v</i>')})<sup>0,3</sup></span></span></div>
  <div class="mdef"><b>где</b>
   <div class="drow"><span class="dsym"><i>d</i><sub>p</sub></span><span>— расчётный внутренний диаметр трубы, м;</span></div>
   <div class="drow"><span class="dsym"><i>i</i></span><span>— гидравлический уклон;</span></div>
   <div class="drow"><span class="dsym">λ</span><span>— коэффициент сопротивления трения по длине;</span></div>
   <div class="drow"><span class="dsym"><i>v</i></span><span>— средняя скорость потока, м/с;</span></div>
   <div class="drow"><span class="dsym"><span class="nu">ν</span></span><span>— кинематическая вязкость воды, м²/с;</span></div>
   <div class="drow"><span class="dsym"><i>g</i></span><span>— ускорение свободного падения, g = 9,81 м/с² (2g = 19,62).</span></div>
  </div>
  <div class="hint">в программе A = 0,021/19,62 = 0,0010703…; коэффициент 0,00107 в книге — округление</div>
 </div>
 <hr>
 <b>Размеры чугунных труб</b><br>
  Внутренний диаметр чугунных труб принимается по ГОСТ 9583-75 по данным классов ЛА, А и Б
  (наружный диаметр dн и толщина стенки S показываются под селектором dу; dв = dн − 2S).<br>
  Для чугунных труб диаметром менее 300 мм учтено уменьшение внутреннего диаметра на 1 мм на коррозию
  и отложения; для труб диаметром 300 мм и более такое уменьшение практического значения не имеет и поэтому не учтено.<br>
  Использование чугунных труб более тяжёлых классов в системах водоснабжения в подавляющем большинстве
  случаев не требуется. Однако при необходимости их можно рассчитать: установите флажок «другой» диаметр и
  введите соответствующее значение расчётного внутреннего диаметра в окно ввода.<br>
  <span class="hint">в программе уменьшение на 1 мм применяется при dв ≤ 300 мм только для «неновых» труб; для новых dp = dв</span><br>
  <span class="hint">ν воды = 1,3·10⁻⁶ м²/с (t=10°C); порог 1,2 м/с = 9,2·10⁵·ν; d в метрах.</span>`;
}

/* Справка страницы а/ц (help-форма frmtablII4, CP1251-строки EXE 0x4c7ae..0x4d000) — формула и
   тексты дословно из оригинала (включая оригинальные «асбетоцементных» и «неновых») */
function helpAsbes(){
 return `<b>асбестоцементные трубы ГОСТ 539-80</b><hr>
  Для гидравлического расчета асбестоцементных труб используют формулу:<br>
  <i>i</i>&nbsp;=&nbsp;0,000561·${fr('v<sup>2</sup>','dp<sup>1,190</sup>')}·(1&nbsp;+&nbsp;${fr('3,51','v')})<sup>0,190</sup><br>
  <i>i</i> – гидравлический уклон;&nbsp; <i>v</i> – скорость движения воды, м/с;&nbsp; dp – расчетный внутренний диаметр, м.<br><br>
  Как показал опыт эксплуатации асбетоцементных водопроводных труб, заметного возрастания их шероховатости обычно не происходит.
  Благодаря этому приведенная выше формула справедлива для расчета как новых, так и неновых водопроводных труб.<br><br>
  Величины внутренних диаметров приняты по ГОСТ 539-80. При расчете нестандартных асбестоцементных труб установите флажок
  "другой" диаметр и в окно ввода введите соответствующее значение расчетного внутреннего диаметра.`;
}

/* Справка ж/б-страницы (help-форма frmhelp6: заголовок 0x4e215, «Для гидравлического расчета
   железобетонных труб используют формулу:» 0x4ecac, константы 0,000802/1,190/3,51 —
   0x4ed56/0x4ee07/0x4ea36, примечания 0x4ee92 и 0x4e6ea) — дословно по скрину оригинала 06.10.2026 */
function helpConc(){
 return `<b>трубы железобетонные ГОСТ 12586.0-83</b><hr>
  Для гидравлического расчета железобетонных труб используют формулу:<br>
  <i>i</i>&nbsp;=&nbsp;0,000802·φ·${fr('v<sup>2</sup>','dp<sup>1,190</sup>')}·(1&nbsp;+&nbsp;${fr('3,51','v')})<sup>0,190</sup><br><br>
  <i>i</i> - гидравлический уклон<br>
  <i>v</i> - скорость движения воды, м/с<br>
  dp - расчетный внутренний диаметр, м<br>
  φ - коэффициент, зависящий от качества внутренней поверхности стенки трубы. Принимаем φ = 1<br><br>
  Опыт эксплуатации железобетонных труб показал, что внутренняя поверхность стенок с течением времени практически
  не изменяется, поэтому по приведенной выше формуле можно рассчитывать как новые, так и бывшие в употреблении
  железобетонные трубы.<br><br>
  Величины внутренних диаметров приняты по ГОСТ 12586.0-83. При расчете железобетонных труб не относящихся к
  ГОСТ 12586.0-83 установите флажок "другой" и в окно ввода введите соответствующее значение расчетного
  внутреннего диаметра.<br><br>
  <span class="hint">Диаметры страницы — dу 500…1600 мм (9 значений списка программы), dв = dу.
  Формула одна для новых и неновых труб (шероховатость со временем не растёт); ν воды = 1,3·10⁻⁶ м²/с
  (t=10°C) вшита в константы, поэтому блок «Режим / теплоноситель» показан заблокированным.
  Местные сопротивления не учитываются: H = i·L.</span>`;
}

/* Справка стеклопластиковой страницы (окно «трубы стеклопластиковые СП 40-104-2001», скрин оригинала
   07.10.2026). Тексты — дословно из шаблона формы EXE: заголовок 0x4d451, «Для гидравлического
   расчета …» 0x4df80, определения i/v/dp/λ/g 0x4dff6..0x4e139, абзац про коррозионную стойкость
   0x4da3b (в EXE опечатка «экплуатации»), абзац про флажок «другой» 0x4d927. В оригинале сами
   формулы — картинки/подписи (Label «i=», Line-объекты), поэтому их вид воспроизведён по скрину. */
function helpGrp(){
 return `<b>трубы стеклопластиковые СП 40-104-2001</b><hr>
  Для гидравлического расчета стеклопластиковых труб используют следующие формулы:<br>
  <i>i</i>&nbsp;=&nbsp;λ·${fr('<i>v</i><sup>2</sup>','2<i>g</i>·dp')}<br>
  λ = 0,0146·(<i>v</i>·dp)<sup>−0,226</sup><br><br>
  <i>i</i> - гидравлический уклон<br>
  <i>v</i> - скорость движения воды, м/с<br>
  dp - расчетный внутренний диаметр, м<br>
  λ - коэффициент сопротивления трения по длине<br>
  <i>g</i> - ускорение свободного падения<br><br>
  Благодаря высокой коррозионной стойкости стеклопластиковых труб увеличения их сопротивления в процессе
  эксплуатации практически не наблюдается. Поэтому приведенными выше формулами можно пользоваться как
  для расчета новых, так и для неновых стеклопластиковых труб.<br><br>
  Величины внутренних диаметров приняты по табл.2 и табл.3 СП40-104-2001. При расчете
  стеклопластиковых труб произвольного диаметра установите флажок "другой" и в окно ввода введите
  соответствующее значение расчетного внутреннего диаметра.<br><br>
  <span class="hint">Диаметры страницы — внутренние 50…400 мм (13 значений списка программы: 50, 60, 80,
  90, 110, 150, 175, 200, 215, 265, 300, 315, 400), dв = d. Формула одна для новых и неновых труб;
  ν воды = 1,3·10⁻⁶ м²/с (t=10°C) вшита в константы, поэтому блок «Режим / теплоноситель» показан
  заблокированным. Местные сопротивления не учитываются: H = i·L. Эталон скрина: d = 60 мм,
  Q = 4 л/с → v = 1,415 м/с, 1000i = 43,344 мм/м, h = i·L = 4,334 м (L = 100 м).</span>`;
}

/* Справка стеклянной страницы (окно «трубы стеклянные ГОСТ 8894-86», скрин оригинала 07.10.2026) —
   тексты дословно из EXE (frmhelp8): зачин 0x4ac94, абзац о коррозии 0x4abd9, абзац о диаметрах 0x4ab11.
   В EXE в последнем абзаце опечатка «стеклянных труб труб не относящихся» (воспроизведена и на скрине
   оригинала) — в клоне напечатано «стеклянных труб не относящихся». */
function helpGlass(){
 return `<b>трубы стеклянные ГОСТ 8894-86</b><hr>
  Для гидравлического расчета стеклянных труб используют формулу:<br>
  <i>i</i>&nbsp;=&nbsp;0,000745·${fr('v<sup>1,774</sup>','dp<sup>1,226</sup>')}<br><br>
  <i>i</i> - гидравлический уклон<br>
  <i>v</i> - скорость движения воды, м/с<br>
  dp - расчетный внутренний диаметр, м<br><br>
  Стеклянные трубы весьма стойки против коррозии, благодаря чему приведенная выше формула справедлива как
  для новых, так и для неновых стеклянных труб.<br><br>
  Величины диаметров приняты по ГОСТ 8894-86. При расчете стеклянных труб не относящихся к
  ГОСТ 8894-86 установите флажок "другой" и в окно ввода введите соответствующее значение расчетного
  внутреннего диаметра.<br><br>
  <span class="hint">Список страницы — наружные диаметры 45, 67, 93, 122, 169, 221 мм (6 значений списка
  программы); внутренний dв подставляется программой по таблице: 45→37, 67→57, 93→81, 122→108,
  169→150, 221→198 мм. Формула одна для новых и неновых труб; ν воды = 1,3·10⁻⁶ м²/с (t=10°C) вшита в
  константы, поэтому блок «Режим / теплоноситель» показан заблокированным. Местные сопротивления не
  учитываются: H = i·L. Эталон скрина: dн = 93 мм (dв = 81 мм), Q = 7 л/с → v = 1,358 м/с,
  1000i = 27,949 мм/м, h = i·L = 2,795 м (L = 100 м).</span>`;
}

/* Справка пластика (окно «пластмассовые трубы ГОСТ 18599-2001», скрин оригинала 05.10.2026) — дословно */
function helpPlastic(){
 return `<b>пластмассовые трубы ГОСТ 18599-2001</b><hr>
  Для гидравлического расчета пластмассовых труб используют формулу:<br>
  <i>i</i>&nbsp;=&nbsp;0,000685·${fr('v<sup>1,774</sup>','dp<sup>1,226</sup>')}<br><br>
  <i>i</i> - гидравлический уклон<br>
  <i>v</i> - скорость движения воды, м/с<br>
  dp - расчетный внутренний диаметр, м<br><br>
  Благодаря высокой коррозионной стойкости пластмассовых труб увеличения их сопротивления в процессе эксплуатации
  практически не наблюдается. Поэтому приведенной выше формулой можно пользоваться как для расчета новых,
  так и для неновых пластмассовых труб.<br><br>
  Величины внутренних диаметров приняты по ГОСТ 18599-2001. При расчете пластмассовых труб не относящихся к
  ГОСТ 18599-2001 установите флажок "не по ГОСТу" и в окно ввода введите соответствующее значение расчетного
  внутреннего диаметра.<br><br>
  <span class="hint">Внутренний расчетный диаметр dp = dв. Для труб по ГОСТ dв = dн − 2·e ном, где e — номинальная толщина стенки из таблиц
  ГОСТ 18599-2001 по выбранной марке и SDR; при «не по ГОСТу» dв вводится вручную.</span>`;
}

/* ==== init ==== */
fillMaterials();
$('material').onchange=()=>{const m=currentMat();$('gostLink').textContent=DOCS[m.doc]||'';if(!(m.cls||m.pe))$('danother').checked=false;applyClsState();applySysVisibility();fillDiameters();};
$('dsel').onchange=fillDiameters;
document.querySelectorAll('input[name=cls]').forEach(r=>r.onchange=()=>{applyClsState();fillDiameters();});
document.querySelectorAll('input[name=vt],input[name=tip]').forEach(r=>r.onchange=fillDiameters); // а/ц: ВТ/тип → пересборка dу и dв
document.querySelectorAll('input[name=pe]').forEach(r=>r.onchange=fillDiameters); // пластик: марка ПЭ → список dн и доступность SDR
document.querySelectorAll('input[name=sdr]').forEach(r=>r.onchange=fillDiameters); // пластик: серия SDR → список dн и dв
$('tsel').onchange=()=>{updDv();updDu();};
$('danother').onchange=()=>{applyClsState();if(!$('danother').checked)updDv();updCiDims();}; // как в программе: при «другой» dp-инпут редактируем, блок dу/классов/dн-S-dв блокируется
document.querySelectorAll('input[name=wear]').forEach(r=>r.onchange=updDv); // чугун: −1 мм только у «неновых» (VarCmpLe(dв,300) And Option1)
$('chkMest').onchange=()=>{const on=$('chkMest').checked;$('mode').disabled=!on;$('k').disabled=!on;if(!on)$('k').value='';}; // как в программе (FUN_00480b10): без местных сопротивлений k блокируется и очищается
$('nuPreset').onchange=e=>{if(e.target.value){const[a,b]=e.target.value.split('|');$('nu').value=a;$('rho').value=b;}};
$('mode').onchange=()=>{const kv=K_MODE[$('mode').value];if(kv!==undefined)$('k').value=String(kv);}; // k по режиму, как в программе
$('sysCold').onchange=()=>{fillModes(false);$('mode').onchange();
 // холодное водоснабжение: температура/ν блокируются, подставляются ν=0 и ρ=1000 (как в программе;
 // на расчёт ν не влияет — все формулы ν-подставленные, ν=1,3·10⁻⁶ «зашита» в константы 0,684/0,867)
 $('nu').value='0';$('nu').disabled=true;$('nuPreset').disabled=true;$('rho').value='1000';};
$('sysHot').onchange=()=>{fillModes(false);$('mode').onchange();
 $('nu').disabled=false;$('nuPreset').disabled=false;};
fillModes(false);
applySysVisibility(); // чугунная страница: скрыть система/режим/местные/k, зафиксировать ν/ρ (t=10°C)
$('mode').onchange(); // стартовое k по режиму по умолчанию (хоз-питьевой → 0,3)
$('btnCalc').onclick=calc;
$('btnHelp').onclick=showHelp;
$('gostLink').textContent=DOCS[MATERIALS[0].doc];
fillDiameters();