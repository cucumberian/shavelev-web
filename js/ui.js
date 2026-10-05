/* ui.js — логика интерфейса клона: заполнение списков, валидация ввода, расчёт, справка.
   Зависимости (загружаются раньше в index.html): formulas.js, data.js. */
"use strict";

const $=id=>document.getElementById(id);
function fmt(x,n){
 if(x!==0 && Math.abs(x)<Math.pow(10,-n)){
   // малые значения: добавляем знаки, чтобы не округлять до 0 (BUG-7)
   let s=x.toFixed(n+8).replace(/0+$/,'').replace(/\.$/,'');
   return s.replace('.',',');
 }
 return (Math.round(x*Math.pow(10,n))/Math.pow(10,n)).toString().replace('.',',');
}
function fmt2(x){return x.toFixed(2).replace('.',',');}

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

/* Чугунная страница (frmtablII3): нет переключателя ХВС/ГВС, режимов и местных
   сопротивлений (chkMest/k) — скрываем, как в оригинале; ν/ρ фиксируем значениями
   t=10°C (ν=1,3·10⁻⁶, ρ=1000) — формулы чугуна ν-подставленные, ν=10°C вшита в константы */
function applySysVisibility(){
 const ci=!!currentMat().cls;
 ['sysRow','mestRow','modeRow','kRow'].forEach(id=>$(id).style.display=ci?'none':'');
 $('srcGrid').classList.toggle('two',ci); // класс слева, остальное справа (грид только на чугуне)
 $('sysField').style.display=currentMat().id==='asbes'?'none':''; // а/ц (frmtablII4): блока режим/теплоноситель в оригинале нет
 $('wearField').style.display=currentMat().id==='asbes'?'none':''; // а/ц: переключателя новые/неновые в окне нет — формула справедлива для обоих (справка оригинала)
 $('nuT').style.display=ci?'':'none';
 $('rhoHint').style.display=ci?'none':'';
 if(ci){$('nu').value='1.3e-6';$('nu').disabled=true;$('nuPreset').disabled=true;$('rho').value='1000';$('rho').disabled=true;}
 else{const cold=document.querySelector('input[name=sys]:checked').value==='cold';
  $('rho').disabled=false;if(cold)$('nu').value='0';$('nu').disabled=cold;$('nuPreset').disabled=cold;}
}

/* Класс чугунной трубы (frmtablII3: Option3=ЛА, Option4=А, Option7=Б) */
function curCls(){const r=document.querySelector('input[name=cls]:checked');return r?r.value:'ЛА';}
/* а/ц (frmtablII4): класс трубы ВТ и тип по размерам */
function curVt(){const r=document.querySelector('input[name=vt]:checked');return r?r.value:'ВТ6';}
function curTip(){const r=document.querySelector('input[name=tip]:checked');return r?+r.value:1;}

/* Состояние блока исходных данных (frmtablII3, проверка на живой программе):
   «другой» свободен при любом классе/dу; при включении блокируется весь блок —
   классы, селектор dу, строка dн/S/dв; dp — ручной ввод. Вызывается при смене
   материала/класса/чекбокса. */
function applyClsState(){
 const other=!!currentMat().cls&&$('danother').checked;
 document.querySelectorAll('input[name=cls]').forEach(r=>r.disabled=other);
 $('dsel').disabled=other;
 $('dcv').disabled=!$('danother').checked;
}

/* Заполнение списка диаметров; выбор диаметра/стенки сохраняется при пересборке. */
function fillDiameters(){
 const m=currentMat(); const sel=$('dsel');
 const prev=sel.value;
 sel.innerHTML='';
 $('clsRow').style.display=m.cls?'':'none';
 $('vtRow').style.display='none'; $('tipRow').style.display='none'; // селекторы а/ц — только на своей странице
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
     const dv=(m.wall||m.dvSame)? d : m.dv[i];
     o.value=dv;
     o.textContent=m.wall? `dн=${d} мм` : (m.dvSame?`dв=${d} мм`:`dу/dн=${d} мм (dв=${dv} мм)`);
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
 if(m.wall||m.gas) return dv; // у wall/gas-материалов dsel.value уже = dн
 for(let i=0;i<m.d.length;i++) if(m.dv[i]===dv) return m.d[i];
 return m.d[0];
}
function updDv(){
 const m=currentMat();
 if((m.gas||m.wall||m.cls||m.id==='asbes') && $('danother').checked) return; // ручной dp — поле не трогаем
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
  return parseFloat($('dsel').value);
}

function calc(){
 const out=$('out');
 $('outH').innerHTML='—';
 const q=readQ();
 if(isNaN(q)){out.innerHTML='<span class="warn">ошибка ввода — введите значение расхода</span>';return;}
 if(q<0){out.innerHTML='<span class="warn">расход не должен быть отрицательным!</span>';return;}
 if(q===0){out.innerHTML='<span class="warn">расход не должен равняться нулю!</span>';return;}
 const dv=curDv();
 if(isNaN(dv)||dv<=0){out.innerHTML='<span class="warn">диаметр не может равняться нулю!</span>';return;}
 const L=numStrict($('len').value);
 if(isNaN(L)){out.innerHTML='<span class="warn">введите значение длины участка в м</span>';return;}
 if(L<0){out.innerHTML='<span class="warn">Длина участка не может быть отрицательной!</span>';return;}
 if(L===0){out.innerHTML='<span class="warn">Длина участка не может равняться нулю!</span>';return;}
 const m=currentMat();
 const ci=!!m.cls; // frmtablII3: k и местных сопротивлений нет — k≡0, H=i·L (FUN_004ae2c0)
 const nomisc=ci||m.id==='asbes'; // frmtablII4 (а/ц): locals/k в окне нет, h=i·L (скрин 05.10.2026)
 let k=nomisc?0:(numStrict($('k').value)||0);
 if(!nomisc){
  if(k<0){out.innerHTML='<span class="warn">коэффициент местных сопротивлений k не может быть отрицательным!</span>';return;}
  if(!$('chkMest').checked) k=0; // «учесть потери на местные сопротивления» выключен — k не применяется
 }
 const nu=numStrict($('nu').value);
 if(isNaN(nu)){out.innerHTML='<span class="warn">Вы не ввели значение коэффициента кинематической вязкости теплоносителя!</span>';return;}
 const rho=numStrict($('rho').value)||1000;
 const wear=document.querySelector('input[name=wear]:checked').value;
 const d=dv/1000;
 const v=q/(Math.PI*d*d/4);
 const {A,e}=iCalc(wear,m.id,v,d);
 const i=A*v*v/Math.pow(d,e);   // м/м
 const R=i*rho*G;               // Па/м (ρ·g·i, g=9.81)
 const H=i*L*(1+k);             // м
 const lines=[];
 lines.push(`Скорость v = ${fmt(v,3)} м/с`);
 lines.push(`i = ${fmt(i*1000,3)} мм/м  (1000i = ${fmt(i*1000,1)})`);
 lines.push(`удельные потери давления R = ${fmt(R,1)} Па/м`);
 // блок «Потери напора…» — как в программе: чугун (Frame4 «по длине») H=i·L без k; прочие — i·L·(1+k)
 $('hLegend').textContent=ci?'Потери напора по длине, м':'Потери напора на участке, м';
 $('outH').innerHTML=(nomisc?[]:[`k = ${fmt(k,2)}`]).concat(
   [`Потери напора ${ci?'по длине':'на участке'} H = i·L${nomisc?'':'·(1+k)'} = ${fmt(H,3)} м`,
    `потери давления = ${fmt(R*L*(1+k),0)} Па`]).join('\n');
 const cls=[];
 if(ci){ // frmtablII3 (FUN_004ae2c0): пары порогов 0,8…2 / 1…3 / 1,5…4 по диаметру (живая программа 05.10.2026):
  // dp≤200 → 0,8…2 (dp=99/100/150/200: v=0,95…1,23 нет; v=2,494 «Большая»); 200<dp<800 → 1…3 (dp=202,6 «Малая» при 0,931;
  // dp=500,8 1,015 нет; dp=700 1,2 нет); dp≥800 → 1,5…4 (dp=820 «Малая» при 0,899 и 1,201; v=2,462 нет).
  // Границы 200/800 подтверждены живой программой (пробы X1 dp=200 → нет; X2 dp=820 v=1,201 → «Малая»).
  const lo=dv<=200?0.8:(dv<800?1:1.5), hi=dv<=200?2:(dv<800?3:4);
  if(v>hi) cls.push('<span class="warn">Большая скорость! Рекомендуется увеличить диаметр</span>');
  if(v<lo) cls.push('<span class="warn">Малая скорость! Рекомендуется уменьшить диаметр</span>');
 } else {
  const lim=VEL_LIMIT[$('mode').value]||VEL_LIMIT.potable; // защита от пустого mode
  if(v>lim[1]) cls.push(`<span class="warn">Внимание! Скорость больше ${lim[1]} м/с, рекомендуется увеличить диаметр</span>`);
  if(v<lim[0]) cls.push(`<span class="warn">Малая скорость! Рекомендуется уменьшить диаметр</span>`);
 }
 // экономическая рекомендация по dу (сталь/чугун/пластик/ж/б)
 const econ=ECON[m.id==='steel-es'?'steel':m.id];
 if(econ && (m.id==='ci'||m.id==='steel'||m.id==='steel-es'||m.id==='plastic'||m.id==='conc')){
   const qls=q*1000; let best=null;
   for(const dd of Object.keys(econ).map(Number).sort((a,b)=>a-b)){
     if(qls>=econ[dd]) best=dd;
   }
   if(best===null) cls.push(`При расходе ${fmt2(qls)} л/сек рекомендуется использовать трубу с диаметром менее ${Math.min(...Object.keys(econ).map(Number))} мм`);
   else cls.push(`Применение трубы диаметром ${best} мм при расходе ${fmt2(qls)} л/сек экономически обосновано`);
 }
 out.innerHTML=lines.join('\n')+'\n'+cls.join('\n');
}

/* Дробь для «печатного» вида формул (офлайн: чистый CSS, без KaTeX/MathJax). */
const fr=(n,d)=>`<span class="frac"><span class="fnum">${n}</span><span class="fden">${d}</span></span>`;

function showHelp(){
 const h=$('help');
 if(h.style.display==='block'){h.style.display='none';return;}
 h.innerHTML = currentMat().id==='ci' ? helpCI() : (currentMat().id==='asbes' ? helpAsbes() : helpSteel());
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
 <span class="hint">ν воды = 1,3·10⁻⁶ м²/с (t=10°C); пороги: 1,2 м/с = 9,2·10⁵·ν; d в метрах.</span>`;
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
  <i>i</i>&nbsp;=&nbsp;0,000561·${fr('v<sup>2</sup>','dp<sup>1,190</sup>')}·(1&nbsp;+&nbsp;${fr('3,51','dp')})<sup>0,190</sup><br>
  <i>i</i> – гидравлический уклон;&nbsp; <i>v</i> – скорость движения воды, м/с;&nbsp; dp – расчетный внутренний диаметр, м.<br><br>
  Как показал опыт эксплуатации асбетоцементных водопроводных труб, заметного возрастания их шероховатости обычно не происходит.
  Благодаря этому приведенная выше формула справедлива для расчета как новых, так и неновых водопроводных труб.<br><br>
  Величины внутренних диаметров приняты по ГОСТ 539-80. При расчете нестандартных асбестоцементных труб установите флажок
  "другой" диаметр и в окно ввода введите соответствующее значение расчетного внутреннего диаметра.`;
}

/* ==== init ==== */
fillMaterials();
$('material').onchange=()=>{const m=currentMat();$('gostLink').textContent=DOCS[m.doc]||'';if(!m.cls)$('danother').checked=false;applyClsState();applySysVisibility();fillDiameters();};
$('dsel').onchange=fillDiameters;
document.querySelectorAll('input[name=cls]').forEach(r=>r.onchange=()=>{applyClsState();fillDiameters();});
document.querySelectorAll('input[name=vt],input[name=tip]').forEach(r=>r.onchange=fillDiameters); // а/ц: ВТ/тип → пересборка dу и dв
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