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

/* Заполнение списка диаметров; выбор диаметра/стенки сохраняется при пересборке. */
function fillDiameters(){
 const m=currentMat(); const sel=$('dsel');
 const prev=sel.value;
 sel.innerHTML='';
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
   m.vt.forEach(v=>v.items.forEach(it=>{
     const o=document.createElement('option');
     o.value=it[2]; o.textContent=`dу=${v.du} мм; труба ${it[0]} тип${it[1]}; dв=${it[2]} мм`;
     sel.appendChild(o);}));
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
 if(!m.gas){ // подписи строк — общие (для газовой страницы заданы выше)
   $('dLabel').textContent='Диаметр:';
   $('tLabel').textContent='Толщина стенки, мм:';
   $('dvLabel').innerHTML='Расчётный d<sub>в</sub>, мм:';
   $('dpOther').style.display='none';
 }
 updDv();
  updDu();
}
function findDByDv(m,dv){
 if(m.wall||m.gas) return dv; // у wall/gas-материалов dsel.value уже = dн
 for(let i=0;i<m.d.length;i++) if(m.dv[i]===dv) return m.d[i];
 return m.d[0];
}
function updDv(){
 const m=currentMat();
 if(m.gas && $('danother').checked) return; // ручной dp — поле не трогаем
 const dv=curDv();
 $('dcv').value=isNaN(dv)?'':fmt(dv,2);
}

/* dу и тип труб по dн/s — как в программе (Label13 «Диаметр условного прохода dу=» +
   строки «трубы легкие/обыкновенные/усиленные» 0x4418a0/c0/ec). dу — Таблица 1 кн. Шевелева;
   «обыкновенная» стенка — по книжному dв (у 21.3/26.8 из четырёх — 2,8) */
function updDu(){
 const m=currentMat(), el=$('duLine');
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
 if(m.gas){
   if($('danother').checked) return numStrict($('dcv').value);
   const dn=parseFloat($('dsel').value), s=parseFloat($('tsel').value);
   return (isNaN(dn)||isNaN(s))?NaN:dn-2*s-1; // dp = dн − 2s − 1, 1 мм — коррозия (help frmtablII1)
 }
 let dv=parseFloat($('dsel').value);
 if(m.wall){
   const s=parseFloat($('tsel').value);
   if(!isNaN(s)) dv=dv-2*s;
 }
 return dv;
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
 let k=numStrict($('k').value)||0;
 if(k<0){out.innerHTML='<span class="warn">коэффициент местных сопротивлений k не может быть отрицательным!</span>';return;}
 if(!$('chkMest').checked) k=0; // «учесть потери на местные сопротивления» выключен — k не применяется
 const nu=numStrict($('nu').value);
 if(isNaN(nu)){out.innerHTML='<span class="warn">Вы не ввели значение коэффициента кинематической вязкости теплоносителя!</span>';return;}
 const rho=numStrict($('rho').value)||1000;
 const m=currentMat();
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
 // блок «Потери напора на участке, м» — как в программе: применённый k, H и потери давления
 $('outH').innerHTML=[`k = ${fmt(k,2)}`,
   `Потери напора на участке H = i·L·(1+k) = ${fmt(H,3)} м`,
   `потери давления = ${fmt(R*L*(1+k),0)} Па`].join('\n');
 const cls=[];
 const lim=VEL_LIMIT[$('mode').value]||VEL_LIMIT.potable; // защита от пустого mode
 if(v>lim[1]) cls.push(`<span class="warn">Внимание! Скорость больше ${lim[1]} м/с, рекомендуется увеличить диаметр</span>`);
 if(v<lim[0]) cls.push(`<span class="warn">Малая скорость! Рекомендуется уменьшить диаметр</span>`);
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
 // верх — как в справке оригинальной программы (frmtablII1 help, 0x50395): формулы «в столбик»
 const mathSteel=`<b>Справка — для стальных труб</b>
 <div class="math">
  <div class="mrow"><span class="mlab">удельные потери напора на трение:</span>
   <span><i>i</i> = ${fr('λ','<i>d</i><sub>п</sub>')} · ${fr('<i>v</i><sup>2</sup>','2<i>g</i>')}</span></div>
  <div class="mrow"><span class="mlab">для новых стальных труб:</span>
   <span>λ = ${fr('0,312','<i>d</i><sub>п</sub><sup>0,226</sup>')} · <span class="grp">(1,9·10<sup>−6</sup> + ${fr('<span class="nu">ν</span>','<i>v</i>')})<sup>0,226</sup></span></span></div>
  <div class="mrow"><span class="mlab">для неновых стальных труб при <i>v</i>/<span class="nu">ν</span> ≥ 9,2·10<sup>5</sup> 1/м:</span>
   <span>λ = ${fr('0,021','<i>d</i><sub>п</sub><sup>0,3</sup>')}</span></div>
  <div class="mrow"><span class="mlab">то же при <i>v</i>/<span class="nu">ν</span> &lt; 9,2·10<sup>5</sup> 1/м:</span>
   <span>λ = ${fr('<span class="grp">(1,5·10<sup>−6</sup> + '+fr('<span class="nu">ν</span>','<i>v</i>')+')</span><sup>0,3</sup>','<i>d</i><sub>п</sub><sup>0,3</sup>')}</span></div>
  <div class="mrow"><span class="mlab">расчётный внутренний диаметр:</span>
   <span><i>d</i><sub>п</sub> = <i>d</i><sub>н</sub> − 2<i>s</i> − 1</span></div>
  <div class="mdef"><b>где</b>
   <div class="drow"><span class="dsym"><i>d</i><sub>п</sub></span><span>— расчётный внутренний диаметр, м;</span></div>
   <div class="drow"><span class="dsym"><i>d</i><sub>н</sub></span><span>— наружный диаметр трубы, мм;</span></div>
   <div class="drow"><span class="dsym"><i>s</i></span><span>— толщина стенки трубы, мм;</span></div>
   <div class="drow"><span class="dsym"><i>i</i></span><span>— удельные потери напора на трение, м/м;</span></div>
   <div class="drow"><span class="dsym">λ</span><span>— коэффициент трения;</span></div>
   <div class="drow"><span class="dsym"><i>v</i></span><span>— средняя скорость потока, м/с;</span></div>
   <div class="drow"><span class="dsym"><span class="nu">ν</span></span><span>— кинематическая вязкость воды, м²/с;</span></div>
   <div class="drow"><span class="dsym"><i>g</i></span><span>— ускорение свободного падения, g = 9,81 м/с² (2g = 19,62).</span></div>
  </div>
  <div class="hint">1 мм в формуле d<sub>п</sub> — толщина слоя коррозии и отложений на стенках.</div>
 </div>`;
 h.innerHTML=mathSteel+`<hr>
 <b>Расчётные формулы (кн. Шевелева 1984; программа реализует ν-подставленные варианты)</b><br>
 i = λ·v²/(2g·d);  A ≡ λ/(2g);  i[м/м] = A·v²/d<sup>1+n</sup><br><br>
 <b>Новые стальные</b> (2а): λ = 0,0159·(1 + 0,684/v)<sup>0,226</sup> / d<sup>0,226</sup><br>
 <b>Новые чугунные</b> (3а): λ = 0,0144·(1 + 2,36/v)<sup>0,284</sup> / d<sup>0,284</sup><br>
 <b>Неновые ст./чуг.</b> (6) при v≥1,2: A = 0,00107 / d<sup>0,3</sup>;&nbsp;
 (7) при v&lt;1,2: A = 0,000912·(1 + 0,867/v)<sup>0,3</sup> / d<sup>0,3</sup><br>
 <b>Асбестоцемент</b> (17): A = 0,000561·(1 + 1,19/v)<sup>0,190</sup> / d<sup>0,190</sup><br>
 <b>Железобетон</b> (22): A = 0,000802·(1 + 1,19/v)<sup>0,190</sup> / d<sup>0,190</sup> (×1,43 от а/ц)<br>
 <b>Пластик</b>: A = 0,000685·(1 + 1,774/v)<sup>0,226</sup> / d<sup>0,226</sup>;
 <b>Стекло</b>: A = 0,000745·(1 + 1,774/v)<sup>0,226</sup> / d<sup>0,226</sup><br>
 <span class="hint">ν воды = 1,3·10⁻⁶ м²/с (t=10°C); пороги: 1,2 м/с = 9,2·10⁵·ν; d в метрах.</span>`;
 h.style.display='block';
}

/* ==== init ==== */
fillMaterials();
$('material').onchange=()=>{const m=currentMat();$('gostLink').textContent=DOCS[m.doc]||'';fillDiameters();};
$('dsel').onchange=fillDiameters;
$('tsel').onchange=()=>{updDv();updDu();};
$('danother').onchange=()=>{const c=$('danother').checked;$('dcv').disabled=!c;if(!c)updDv();}; // как в программе: тот же инпут, disabled при авторасчёте
$('nuPreset').onchange=e=>{if(e.target.value){const[a,b]=e.target.value.split('|');$('nu').value=a;$('rho').value=b;}};
$('mode').onchange=()=>{const kv=K_MODE[$('mode').value];if(kv!==undefined)$('k').value=String(kv);}; // k по режиму, как в программе
$('sysCold').onchange=$('sysHot').onchange=()=>{fillModes(false);$('mode').onchange();};
fillModes(false);
$('mode').onchange(); // стартовое k по режиму по умолчанию (хоз-питьевой → 0,3)
$('btnCalc').onclick=calc;
$('btnHelp').onclick=showHelp;
$('gostLink').textContent=DOCS[MATERIALS[0].doc];
fillDiameters();