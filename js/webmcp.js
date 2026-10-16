/* webmcp.js — поддержка WebMCP (https://github.com/webmachinelearning/webmcp).
   Регистрирует инструменты калькулятора через document.modelContext.registerTool.
   В браузерах без нативного modelContext включается встроенный polyfill:
   реестр доступен как window.webmcp.getTools() / window.webmcp.executeTool(name, args)
   (паттерн author-provided agent из спецификации).
   Зависимости: formulas.js, js/data/* (registry, docs, modes, модули типов труб), calc.js, ui.js
   (загружаются раньше). */
"use strict";

/* ---- polyfill modelContext (когда браузер ещё не отдаёт нативный) ---- */
function getModelContext(){
  if(document.modelContext) return {mc:document.modelContext, native:document.modelContext.__native!==false};
  {
    const registry=[];
    window.__webmcpRegistry=registry;
    document.modelContext={
      __native:false,
      async registerTool(def){
        registry.push(def);
        document.dispatchEvent(new Event('toolchange'));
        return {unregister(){
          const i=registry.indexOf(def); if(i>=0) registry.splice(i,1);
          document.dispatchEvent(new Event('toolchange'));
        }};
      }
    };
  }
  return {mc:document.modelContext, native:false};
}

/* Author-agent/тестовый доступ: discover + invoke (как getTools/executeTool в спеке) */
window.webmcp={
  get native(){ return !!(document.modelContext && document.modelContext.__native!==false); },
  getTools(){ return (window.__webmcpRegistry||[]).map(t=>({name:t.name,description:t.description,inputSchema:t.inputSchema})); },
  async executeTool(name,args){
    const t=(window.__webmcpRegistry||[]).find(x=>x.name===name);
    // ОДИН конверт на все ошибки (рецензия 13.10.2026 §4.5): и «tool not found», и бросок из
    // валидации приходят как {ok:false,error} — обвязке агента не нужен try/catch.
    if(!t) return textResult({ok:false,error:'tool not found: '+name});
    try{ return await t.execute(args||{}); }
    catch(e){ return textResult({ok:false,error:e.message}); }
  }
};

/* ---- утилиты: чтение/запись UI как это делает пользователь ---- */
function textResult(obj){
  return {content:[{type:'text',text:typeof obj==='string'?obj:JSON.stringify(obj)}]};
}
function selectMaterial(id){
  const m=MATERIALS.find(x=>x.id===id);
  if(!m) throw new Error('неизвестный материал: '+id+'; доступны: '+MATERIALS.map(x=>x.id).join(', '));
  $('material').value=id; $('material').onchange();
  return m;
}
function setWear(w){
  if(w!=='new'&&w!=='old') throw new Error('wear должен быть new или old');
  radVal('wear',w).checked=true;
}
/* Страницы без «Режима / теплоносителя»: блок убран из UI, потому что его данные не входят в
   формулы этих страниц (режим/теплоноситель нужен только стали и электросварной — там в окне
   оригинала есть Frame4 «Выбор системы», t= °C и «учесть потери на местные сопротивления»).
   Критерий один для UI и WebMCP: calc.js → usesSys(). mode/ν/ρ/k в configure игнорируются,
   значения программы фиксированы: ν=1,3·10⁻⁶ (t=10°C), ρ=1000, k≡0, H=i·L. */
function fixedSys(){return !usesSys(currentMat().id)}
function setPipeClass(c){
  const m=currentMat();
  if(!m.cls) throw new Error('классы (ЛА/А/Б) есть только у чугунных труб');
  const r=radVal('cls',c);
  if(!r) throw new Error('класс должен быть ЛА, А или Б');
  r.checked=true; applyClsState(); fillDiameters();
}
function setDiameter(dv){
  const m=currentMat();
  // выбор из списка и ручной dв взаимоисключающи: в UI при включённой галке «другой» список погашен,
  // иначе осталось бы поле dв от прежнего материала. Галочку снимаем тем же состоянием, что и список.
  if($('danother').checked){ $('danother').checked=false; applyClsState(); }
  const opt=[...$('dsel').options].find(o=>parseFloat(o.value)===dv);
  if(opt){ $('dsel').value=opt.value; $('dsel').onchange(); return; }
  // для материалов с dв≠d: пользователь мыслит dу — ищем индекс в m.d
  const idx=m.d? m.d.indexOf(dv) : -1;
  if(idx>=0 && $('dsel').options[idx]){
    $('dsel').value=$('dsel').options[idx].value; $('dsel').onchange(); return;
  }
  // а/ц (frmtablII4): опции dsel = dу текущего ВТ/типа — dу уже найден общим поиском выше
  throw new Error('диаметр '+dv+' недоступен для текущего материала; доступны: '+[...$('dsel').options].map(o=>o.value).join(', '));
}
function setWall(s){
  const m=currentMat();
  if(!m.wall&&!m.gas&&!m.sMap) throw new Error('у текущего материала нет выбора стенки');
  const opt=[...$('tsel').options].find(o=>parseFloat(o.value)===s);
  if(!opt) throw new Error('толщина стенки '+s+' недоступна; доступны: '+[...$('tsel').options].map(o=>o.value).join(', '));
  $('tsel').value=opt.value; $('tsel').onchange();
}
/* dв напрямую (dv_mm) — тем же путём, каким его задаёт человек: галочка «другой» (page.gated) →
   список гаснут, поле dв открывается и в него пишется число. Так расчёт идёт РОВНО по запрошенному
   диаметру. Страницы без ручного dв (сталь и э/с — dв=dн−2s, чугун — из таблицы класса, а/ц и ж/б —
   dв=dу) его не отпускают: там вместо dv_mm задают diameter_mm и толщину/класс/тип. */
function setManualDv(v){
  const m=currentMat();
  if(!(v>0)) throw new Error('dv_mm должен быть > 0');
  if(!m.page.gated)
    throw new Error('на странице '+m.id+' ручного dв нет: он берётся из сортамента. Задай diameter_mm'
      +((m.gas||m.wall)?' вместе с wall_mm':(m.cls?' вместе с pipe_class':(m.id==='asbes'?' вместе с vt и tip':''))));
  $('danother').checked=true; applyClsState();
  $('dcv').value=String(v);
  if($('dcv').onchange) $('dcv').onchange();
}
/* Серия труб. Три страницы, три группы радио: пластик — 'sdr' (доступность по марке 'pe'),
   ПЭ 100 — 'pn' (кнопки собирает fillPnRadios, он же пересобирает группу с dropRad), PEX — 'pexsdr'.
   Ставим отмеченной и зовём ПЕРЕСБОРКУ СТРАНИЦЫ fillDiameters() — ровно как это делает собственный
   onchange радио; иначе список dн остался бы от прежней серии. Радио читаем через radVal/radAll
   (правило кэша групп в ui.js), не через document.querySelector. */
function setGrade(group,v,m){
  const all=[...radAll(group)];
  if(!all.length)
    throw new Error('серии у материала '+m.id+' нет; серии есть у plastic, pe100 и pex');
  const r=radVal(group,v);
  if(!r) throw new Error('серия '+v+' не найдена; доступны: '+all.map(x=>x.value).join(', '));
  if(r.disabled) throw new Error('серия '+v+' недопустима для этой марки/страницы; доступны: '
    +all.filter(x=>!x.disabled).map(x=>x.value).join(', '));
  r.checked=true; fillDiameters();
}
function setPe(v){
  const m=currentMat();
  if(!m.pe) throw new Error('марка ПЭ (pe) есть только у plastic (ГОСТ 18599-2001)');
  const r=radVal('pe',String(v));
  if(!r) throw new Error('марка ПЭ должна быть 32, 63, 80 или 100; доступны: '
    +[...radAll('pe')].map(x=>x.value).join(', '));
  r.checked=true; fillDiameters();
}
function setSdr(v){
  const m=currentMat();
  if(m.pe100) return setGrade('pn',String(v),m);
  if(m.pe)    return setGrade('sdr',String(v),m);
  if(m.series) return setGrade('pexsdr',String(v),m);
  throw new Error('у материала '+m.id+' нет выбора серии (серии есть у plastic, pe100 и pex)');
}
function readResult(){
  // парсим блок вывода в структурированный объект (расчёт + потери напора)
  const t=$('out').textContent+'\n'+$('outH').textContent;
  const num=(re)=>{const m=t.match(re);return m?parseFloat(m[1].replace(',','.')):null;};
  return {
    v_ms:num(/Скорость v = ([-\d,]+) м\/с/),
    i_mm_per_m:(()=>{const g=re=>{const m=re.exec(t);return m?parseFloat(m[1].replace(',','.')):null;};const a=g(/(?<![\d,.])1000i = ([-\d,]+)\s*мм\/м/);if(a!==null)return a;const b=g(/(?<![\d,.])i = ([-\d,]+)\s*мм\/м/);if(b!==null)return b;const c=g(/(?<![\d,.])i = ([-\d,]+)\s*м\/м/);return c!==null?c*1000:null;})(), // i в мм/м: 1000i у меди, «i … мм/м» у стали, «i … м/м» у PEX/PEX-AL-PEX
    R_Pa_per_m:num(/R = ([-\d,]+) Па\/м/),
    H_m:num(/H = (?:i·L(?:·\(1\+k\))?|i·L \+ V²Σξ\/2g) = ([-\d,]+) м/),   // медь: H = i·L + V²Σξ/2g
    dP_Pa:num(/потери давления = ([-\d,]+) Па/),
    dv_mm:parseFloat($('dcv').value.replace(',','.'))||null,
    warnings:(t.match(/Внимание![^\n]*|Малая скорость![^\n]*|Большая скорость![^\n]*/g)||[]),
    recommendation:(t.match(/[^\n]*(?:экономически обосновано|рекомендуется использовать трубу)[^\n]*/)||[null])[0],
    raw:t
  };
}

/* ---- ряды диаметров и серии: из ДАННЫХ страницы, а не из живой формы ----
   Ряд, который discovery отдаёт агенту, обязан принадлежать материалу. До 13.10.2026 он читался
   как [...$('dsel').options] — т.е. принадлежал материалу, ОТКРЫТОМУ в форме: для plastic
   возвращался стальной ряд, для pe100 (у него нет m.d) поля не было вовсе. Теперь ряд строит
   сама страница — чистая функция m.page.rows(st). Состояние st = отмеченные радио страницы: они
   есть в DOM всегда (скрыты или нет), поэтому это дефолт самой страницы, а не то, что открыто. */
function defState(m){
  if(m.pe100)  return {sdr100:(rad('pn')||{}).value||'17'};   // группа 'pn' пуста, пока страница не открыта
  if(m.pe)     return {pe:curPe(), sdr:m.page.pickSeries({pe:curPe(), sdr:curSdr()}, NaN)};
  if(m.series) return {series:curPexSdr()};
  return {};
}
const dns=(m,st)=>(m.page.rows(st)||[]).map(r=>r[0]);

/* Предел скорости — ровно тот, по которому speedNotes в js/calc.js решает, писать ли
   предупреждение: чугун (свой ряд по dв), иначе страницы со стальным блоком режимов; у остальных
   блока нет и в оригинале предупреждений нет (FUN_0050a140, FUN_0050daf0) → null. */
function vLimit(m,inp,dv_mm){
  return m.cls?ciLimits(dv_mm):(usesSys(m.id)?(VEL_LIMIT[inp.mode]||VEL_LIMIT.potable):null);
}

/* Эхо входов, числа результата и машинный вердикт — из lastCalc (js/ui.js calc()), то есть из движка
   и из того состояния страницы, которым он считал, а НЕ из текста на экране: расчёт воспроизводим,
   числа не зависят от округления печати, а cls заметок дают «уже оптимально / надо поменять».
   Поля readResult() (v_ms, i_mm_per_m, R_Pa_per_m, H_m, dP_Pa, raw, recommendation, warnings)
   ОСТАЮТСЯ как были — это напечатанные программой значения, по ним держатся тесты и живая сверка. */
function echo(){
  const lc=lastCalc;
  if(!lc) return {};
  const {inp,st,r}=lc, m=currentMat();
  const REC=/экономически обосновано|рекомендуется использовать трубу/;
  const rec=(r.notes||[]).find(n=>REC.test(n.text));
  const mm=t=>{const x=t&&t.match(/(\d+(?:,\d+)?)\s*мм/); return x?parseFloat(x[1].replace(',','.')):null;};
  const lim=vLimit(m,inp,r.dv_mm);
  return {
    // inputs = ровно то, чем считал движок (inp) + серия под именем параметра shev-configure.
    // Остальное состояние страницы (cls/vt/tip чужих страниц) сюда не тащим — оно не на что не влияло.
    inputs:Object.assign({},inp,{pe:m.pe?st.pe:undefined,
      sdr:m.pe100?st.sdr100:(m.pe?st.sdr:undefined), series:m.series?st.series:undefined}),
    result:{v:r.v,i_m_per_m:r.i,i1000_mm_per_m:r.i1000,R:r.R,H:r.H,dP:r.P,k:r.k,A:r.A,e:r.e,dv:r.dv_mm,L:r.L,rho:r.rho,q:r.q,
      nu:r.nu, unit_suspect:r.unit_suspect,
      trace:r.trace,
      law:r.law, method:FORMULA_TEXT[r.law]},
    verdict:{
      v_limit:lim?{min:lim[0],max:lim[1]}:undefined,
      v_ok:lim? (r.v>=lim[0]&&r.v<=lim[1]) : undefined,
      // optimum_mm — число из строки рекомендации; axis говорит, ЧТО это за диаметр: у стали,
      // чугуна, а/ц и ж/б ряд задан в dу (у стали вдобавок переводится page.recKey), у пластика
      // и ПЭ 100 — в dн (ось объявляет страница: page.rec.axis, по умолчанию dу).
      // ok=true — выбранный диаметр и есть этот оптимум (зелёная строка программы).
      recommendation:rec?{text:rec.text,ok:rec.cls==='ok',
        axis:(m.page.rec&&m.page.rec.axis)||'dу',optimum_mm:mm(rec.text)}:null}};
}


/* Расход, длина и местные сопротивления — параметры РАСЧЁТА, а не материала: именованная функция,
   потому что их задают и shev-losses, и shev-sweep (один раз на весь срез). */
function calcInputs(a,ign){
  ign=ign||[];
  if(a.q!==undefined){ $('q').value=String(a.q); }
  if(a.qunit!==undefined){ if(!['ls','mh'].includes(a.qunit)) throw new Error('qunit: ls|mh'); $('qunit').value=a.qunit; }
  if(a.length_m!==undefined) $('len').value=String(a.length_m);
  if(a.k!==undefined){
    // Рецензия 13.10.2026 §4.1: переданный k означает «местные сопротивления учитывать» — гасим
    // молчаливый k=0, включая галку Check2, как это делает человек. В зоне порога (сталь dу≥80,
    // э/с dн≥88) строка скрыта оригиналом — там k не применяется, и мы об этом пишем.
    if(fixedSys()) ign.push('k: местных сопротивлений на странице '+currentMat().id+' нет (H=i·L)');
    else if($('k').disabled) ign.push('k: на этом диаметре местные сопротивления не учитываются (в оригинале строка скрыта)');
    else{
      if($('chkMest') && !$('chkMest').checked){ $('chkMest').checked=true; $('k').disabled=false; $('mode').disabled=false; }
      $('k').value=String(a.k);
    }
  }
  if(a.xi_total!==undefined){ // Frame6 «Местные сопротивления» — ξ-редактор; Σξ задаём «другими ξ» (они складываются без умножения)
    if(!currentMat().page.xi) ign.push('xi_total: ξ-редактор (Frame6) есть только у меди, PEX и PEX-AL-PEX');
    else{
      if(!(a.xi_total>=0)) throw new Error('xi_total должен быть ≥ 0');
      $('xiother').checked=a.xi_total>0; $('xiotherval').value=String(a.xi_total); xiShow();
    }
  }
  return ign;
}

/* Тело shev-configure — именованной функцией: ею пользуется и shev-sweep (выставить материал и
   серию один раз на весь срез), поэтому правила применения параметров живут в одном месте. */
function configure(a){
  // Рецензия 13.10.2026 §4.2: параметр не той страницы или неизвестное имя больше не проглатываются
  // молча — они возвращаются в warnings/ignored ответа. Значение НЕТО (нет в ряду, ≤ 0) — по-прежнему
  // бросок: без него агент не получит списка доступных значений.
  const ign=[];
  const KNOWN=['material','pe','sdr','cu_system','t_c','wear','pipe_class','wall_mm','mode','nu','rho',
    'diameter_mm','dv_mm','q','qunit','length_m','k','xi_total','v_ms','dn','vt','tip','sp4'];
  Object.keys(a).forEach(x=>{ if(a[x]!==undefined&&KNOWN.indexOf(x)<0)
    ign.push('неизвестный параметр '+x+'; известны: '+KNOWN.join(', ')); });
  if(a.material!==undefined) selectMaterial(a.material);
  if(a.pipe_class!==undefined){ currentMat().cls?setPipeClass(a.pipe_class)
    :ign.push('pipe_class: классы ЛА/А/Б есть только у чугуна'); }
  if(a.wear!==undefined){ currentMat().ui.wear?setWear(a.wear)
    :ign.push('wear: блок «новые/неновые» есть только у стали, электросварных и чугуна'); }
  if(a.pe!==undefined){ currentMat().pe?setPe(a.pe)
    :ign.push('pe: марка ПЭ есть только у plastic'); }
  if(a.sdr!==undefined){ const mm=currentMat();
    (mm.pe||mm.pe100||mm.series)?setSdr(a.sdr)
    :ign.push('sdr: выбора серии нет у материала '+mm.id); }
  // а/ц (frmtablII4): класс ВТ и тип по размерам — от них зависят и список dу, и dв
  if(a.vt!==undefined||a.tip!==undefined){
    if(currentMat().id==='asbes'){
      if(a.vt!==undefined){ const r=radVal('vt',String(a.vt));
        if(!r) throw new Error('vt должен быть ВТ6, ВТ9, ВТ12 или ВТ15'); r.checked=true; }
      if(a.tip!==undefined){ const r=radVal('tip',String(a.tip));
        if(!r) throw new Error('tip должен быть 1, 2 или 3'); r.checked=true; }
      fillDiameters();
    } else ign.push('vt/tip: класс ВТ и тип по размерам есть только на а/ц странице');
  }
  // PEX/PEX-AL-PEX: галка «считать по формуле (4) СП» (меняет λ примерно на треть)
  if(a.sp4!==undefined){ const sid=currentMat().id;
    (sid==='pex'||sid==='metal-pex') ? ($('pexSp').checked=!!a.sp4)
    :ign.push('sp4: галка «по формуле (4) СП» есть только у PEX и PEX-AL-PEX'); }
  if(a.diameter_mm!==undefined) setDiameter(a.diameter_mm);
  if(a.wall_mm!==undefined) setWall(a.wall_mm);
  /* dв напрямую (dv_mm) — самый естественный вопрос сантехника («посчитай при внутреннем 76 мм»).
     Если значение ровно из сортамента — берём ту строку (dв подставит программа, экран показывает
     настоящую трубу); иначе — ручной ввод галочкой «другой»: расчёт идёт РОВНО по dv_mm, и ответ
     честно помечает это: dv_matched=false. */
  let dvFrom='row', dvMatched;
  if(a.dv_mm!==undefined){
    const m=currentMat(), st=pageState();
    const row=(dns(m,st)||[]).find(d=>Math.abs(m.page.dvOf(st,d)-a.dv_mm)<0.005);
    if(row!==undefined) setDiameter(row); else{ setManualDv(a.dv_mm); dvFrom='manual'; }
    dvMatched=dvFrom==='row';
  }
  if(a.mode!==undefined && fixedSys()) ign.push('mode: блока «Режим» на странице '+currentMat().id+' нет');
  if(a.mode!==undefined && !fixedSys()){ // ci/ж/б: режимов и k нет — игнорируем
    if(!VEL_LIMIT[a.mode]) throw new Error('неизвестный режим: '+a.mode);
    const wantHot=MODE_SYS.hot.includes(a.mode);
    const r=radVal('sys',wantHot?'hot':'cold');
    if(r.checked!==wantHot){r.checked=true;fillModes(false);}
    $('mode').value=a.mode;
    const kv=K_MODE[a.mode]; if(kv!==undefined) $('k').value=String(kv);
  }
  // медь (frmtablII9): Frame2 «Выбор системы» и Frame4 «Температура, °С» вместо стального режима
  if(a.cu_system!==undefined){
    const spc=currentMat();
    if(!spc.page.sys){ ign.push('cu_system: выбор системы есть только у меди, PEX и PEX-AL-PEX'); }
    else{
      const r=radVal('cusys',a.cu_system);
      if(!r) throw new Error('cu_system='+a.cu_system+' на странице '+spc.id+' нет; доступны: '+Object.keys(spc.page.sys).join(', '));
      r.checked=true; spSysSync();
    }
  }
  // при Option1 «холодного водоснабжения» Frame4/Frame5 в оригинале неактивны: ν=1,3·10⁻⁶, ρ=1000
  // активность блоков как в frmtablII9: cold — оба неактивны; circ/supply — только «Температура»;
  // ручной теплоноситель (ν/ρ) — только в «системы отопления»
  const cuSysNow = spPage() ? spSysVal() : null;
  const CU_LOCK_T='на медной странице блок «Температура» неактивен при «холодного водоснабжения»: ν=1,3·10⁻⁶ м²/с, ρ=1000 кг/м³ (как в оригинале)';
  const CU_LOCK_C='на медной странице блок «Теплоноситель» неактивен кроме «системы отопления»: ν и ρ подставляются по температуре';
  if(a.t_c!==undefined){
    if(!spPage()) ign.push('t_c: температура есть только на страницах меди, PEX и PEX-AL-PEX');
    else{
      if(cuSysNow==='cold') throw new Error(CU_LOCK_T);
      if(![...$('tcombo').options].some(o=>o.value===String(a.t_c)))
        throw new Error('t_c должен быть 50, 60, 70, 80 или 90 (как в Combo3 оригинала)');
      $('tcombo').value=String(a.t_c); spHeatSync();   // по t программа подставляет ν и ρ (пороги 50/60/70/80/90)
    }
  }
  if(a.nu!==undefined||a.rho!==undefined){
    if(currentMat().sMap){ // медь: ν и ρ — Frame5 «Теплоноситель»: «другой» + Text3 (ν) и Text18 (ρ)
      if(cuSysNow!=='heat') throw new Error(CU_LOCK_C);
      radVal('cool','other').checked=true;
      if(a.nu!==undefined){ if(!(a.nu>0)) throw new Error('ν должно быть > 0'); $('cunu').value=String(a.nu*1e6); }
      if(a.rho!==undefined){ if(!(a.rho>0)) throw new Error('ρ должно быть > 0'); $('curho').value=String(a.rho); }
      spHeatSync();
    } else {
      if(a.nu!==undefined && fixedSys()) ign.push('nu: на странице '+currentMat().id+' ν зафиксирована (1,3·10⁻⁶, вода 10 °C)');
      if(a.rho!==undefined && fixedSys()) ign.push('rho: на странице '+currentMat().id+' ρ зафиксирована (1000 кг/м³)');
      if(a.nu!==undefined && !fixedSys()){ if(!(a.nu>0)) throw new Error('ν должно быть > 0'); $('nu').value=String(a.nu); }
      if(a.rho!==undefined && !fixedSys()){ if(!(a.rho>0)) throw new Error('ρ должно быть > 0'); $('rho').value=String(a.rho); }
    }
  }
  updDv(); // dp зависит от wear (чугун: −1 мм только у «неновых») — обновить после всех параметров
  const m=currentMat();
  return {ok:true,material:m.id,
    // wear — только там, где блок «новые/неновые» ЕСТЬ (сталь, э/с, чугун): на остальных страницах его
    // нет и в формулу он не входит, поэтому эхом «old» агент был бы введён в заблуждение.
    wear:m.ui.wear?rad('wear').value:undefined,
    pipe_class:m.cls?curCls():undefined,
    diameter_mm:numStrict($('dsel').value)||undefined,
    dv_mm:numStrict($('dcv').value)||undefined,dv_from:dvFrom,dv_matched:dvMatched,
    mode:$('mode').value,nu:numStrict($('nu').value),rho:numStrict($('rho').value),
    pe:m.pe?curPe():undefined,
    sdr:m.pe100?curPe100Sdr():(m.pe?curSdr():undefined),
    series:m.series?curPexSdr():undefined,
    cu_system:spPage()?spSysVal():undefined,
    t_c:m.sMap?numStrict($('tcombo').value):undefined,
    cu_nu:m.sMap?numStrict($('cunu').value):undefined,
    cu_rho:m.sMap?numStrict($('curho').value):undefined,
    xi_sum:m.sMap?xiTotal():undefined,
    vt:m.id==='asbes'?curVt():undefined,
    tip:m.id==='asbes'?curTip():undefined,
    sp4:(m.id==='pex'||m.id==='metal-pex')?$('pexSp').checked:undefined,
    warnings:ign.length?ign:undefined};
}

/* Схемы параметров — константами, потому что их принимают четыре инструмента: объявлять один и тот
   же ключ в четырёх схемах — значит держать в проекте четыре копии описаний, которые разъезжаются.
   CONF_PROPS — входы страницы (apply → configure), D_PROPS — параметры ДИАМЕТРА (dн и dв),
   CALC_PROPS — расход, длина и местные сопротивления (apply → calcInputs). */
const CONF_PROPS={
  material:{type:'string',description:'id материала из shev-list-materials (steel, steel-es, ci, asbes, plastic, pe100, conc, grp, glass, copper, pex, metal-pex); если не передан — остаётся текущий'},
  pe:{type:'string',enum:['32','63','80','100'],description:'только plastic: марка ПЭ (frmtablII5 Frame2) — от неё зависит, какие серии SDR допустимы; ставь ДО sdr'},
  sdr:{type:'string',description:'серия труб: plastic/pe100 — номер SDR (например 11, 17; можно передать числом), pex — id серии (sdr11, sdr136). Серия меняет dв, а значит и ΔP: задавай её явно, не полагаясь на дефолт'},
  cu_system:{type:'string',enum:['cold','circ','supply','heat','hot'],description:'только copper/pex/metal-pex. У меди: cold=ХВС (ф-ла 2, v≤4), circ=циркуляционный ГВС (ф-ла 2, v≤3), supply=подающие ГВС (ф-ла 3, v≤3), heat=отопление (ф-лы 5–9, v≤2). У PEX и PEX-AL-PEX выбор меньше: cold=ХВС, hot=ГВС, heat=отопление (одна λ, v≤4/3/2) — на их странице значения circ/supply не действуют'},
  vt:{type:'string',enum:['ВТ6','ВТ9','ВТ12','ВТ15'],description:'только asbes: класс трубы ВТ по ГОСТ 539-80 — от пары (ВТ, тип) зависит dв; ставь вместе с tip'},
  tip:{type:'string',enum:['1','2','3'],description:'только asbes: тип труб по размерам (frmtablII4); ВТ15 при типе 1 скрыта'},
  sp4:{type:'boolean',description:'только pex/metal-pex: считать по формуле (4) СП 41-109-2005 (галка в окне); без неё — вариант программы, λ у него отличается примерно на треть'},
  t_c:{type:'number',enum:[50,60,70,80,90],description:'только copper/pex/metal-pex: температура воды °С (Combo3) — по ней программа подставляет ν и ρ (50→0,55e-6/990 … 90→0,36e-6/970); при пустой t ν=1,3e-6, ρ=1000'},
  wear:{type:'string',enum:['new','old'],description:'новые/неновые. Блок есть только у стали, электросварных и чугуна (там wear меняет формулу); на остальных страницах параметр не входит в расчёт и в ответе не эхомется'},
  pipe_class:{type:'string',enum:['ЛА','А','Б'],description:'класс чугунной трубы (только ci): единый список dу (14 значений, без 450/700/900) для всех классов, dp из таблицы класса'},
  wall_mm:{type:'number',description:'толщина стенки мм (сталь/э/с/медь). У этих страниц толщина своя у КАЖДОГО диаметра, поэтому задавай её после diameter_mm; в срезе shev-sweep она ставится на каждый dн отдельно и если у этого dн такой толщины нет — строка вернёт {dn, error}'},
  mode:{type:'string',description:'режим: potable|combined|prod-fire|fire|dhw-supply|dhw-tp|dhw-risers (блок режима есть только у стали и электросварных; на остальных страницах игнорируется — факт игнора приходит в warnings)'},
  nu:{type:'number',description:'кинематическая вязкость, м²/с (вода 10°C: 1.3e-6); действительна только на стальных страницах (и как «другой» теплоноситель у меди в отоплении); на остальных игнорируется с предупреждением'},
  rho:{type:'number',description:'плотность, кг/м³; действительна только на стальных страницах (у меди — «другой» теплоноситель в отоплении); на остальных игнорируется с предупреждением'}
};
const D_PROPS={
  diameter_mm:{type:'number',description:'диаметр ИЗ РЯДА страницы (dу/dн/du, мм). Значения не из ряда здесь ошибка — перечисли доступные в сообщении'},
  dv_mm:{type:'number',description:'расчётный ВНУТРЕННИЙ диаметр напрямую, мм — как формулирует вопрос сантехник. Если значение ровно из сортамента, выбирается та строка (dv_from=»row«); иначе включается ручной ввод галочкой «другой» и расчёт идёт РОВНО по этому dв (dv_from=»manual«, dv_matched=false). На стали, э/с, чугуне, а/ц и ж/б ручного dв нет — там dв из сортамента, задавай diameter_mm (+ wall_mm/pipe_class)'}
};
const CALC_PROPS={
  q:{type:'number',description:'расход (по умолчанию л/с)'},
  qunit:{type:'string',enum:['ls','mh'],description:'единицы расхода: ls=л/с, mh=м³/ч'},
  length_m:{type:'number',description:'длина участка L, м'},
  k:{type:'number',description:'коэффициент местных сопротивлений k ≥ 0 (только сталь и электросварные: переданный k сам включает галку «учесть потери на местные сопротивления»; на остальных страницах H=i·L и k игнорируется с предупреждением, как и при dу≥80/dн≥88, где блок скрыт)'},
  xi_total:{type:'number',description:'сумма ξ местных сопротивлений для страниц с редактором ξ (медь, PEX, PEX-AL-PEX — Frame6 окна; задаётся «другими ξ», складываются без умножения); входит в H как V²Σξ/2g и в потери давления как Z=0,5ρV²Σξ; на остальных страницах игнорируется с предупреждением'}
};
const schema=props=>({type:'object',properties:props});

/* ПОТЕРИ — ДВА МАРШРУТА ВХОДА (описание — у shev-losses).
   lossesByFlow: расход → скорость → потери, ровно как кнопка «Расчёт»: экран показывает результат,
   в ответе есть raw (напечатанный программой текст) и рекомендация по диаметру.
   lossesByVelocity: скорость УЖЕ известна (её принесли извне — паспорт, справочник, shev-velocity).
   Расход не нужен, экран не трогается (там лежит прежний расчёт), числа считает движок напрямую:
   calcLosses в js/calc.js заранее умеет v вместо q (lossesIn), поэтому движок не менялся.
   Ключи ответа те же; рекомендации по диаметру нет — это «какой диаметр выгоден при расходе». */
async function lossesByFlow(a){
  const cfg=configure(a), ign=(cfg.warnings||[]).slice();
  calcInputs(a,ign); calc();
  const r=readResult();
  if(/ошибка|не должен|не может|не ввели/.test(r.raw)&&r.v_ms===null)
    return textResult({ok:false,error:r.raw.trim()});
  const out=Object.assign({ok:true},r,echo());
  // рецензия §4.4: dv_from/dv_matched — и в ответе расчёта, не только в configure
  if(a.dv_mm!==undefined){ out.dv_from=cfg.dv_from; out.dv_matched=cfg.dv_matched; }
  if(ign.length){ out.warnings=(out.warnings||[]).concat(ign); out.ignored=ign; }
  return textResult(out);
}
async function lossesByVelocity(a){
  const ign=[];
  const v=+a.v_ms;
  if(!(v>0)) throw new Error('v_ms — скорость в м/с (> 0)');
  const cfg=configure(a); ign.push.apply(ign,cfg.warnings||[]);
  if(a.q!==undefined) ign.push('получены q и v_ms: расчёт по скорости v_ms, q проигнорирован');
  calcInputs(a,ign);                  // L, k, ξ — те же правила, что у расчёта по расходу
  const inp=readForm();
  const g=calcLosses(Object.assign({},inp,{q_m3s:NaN,v}));   // расход не нужен: скорость уже дана
  if(!g.ok) return textResult({ok:false,error:g.error});
  const m=currentMat(), lim=vLimit(m,inp,g.dv_mm);
  return textResult({ok:true,screen:false,v_from:'v_ms',
    inputs:Object.assign({},inp,{q:undefined}),
    dv_mm:g.dv_mm,v_ms:g.v,i_mm_per_m:g.i1000,i_m_per_m:g.i,A:g.A,e:g.e,R_Pa_per_m:g.R,
    H_m:g.H===undefined?null:g.H,dP_Pa:g.P===undefined?null:g.P,L_m:g.L===undefined?null:g.L,
    law:g.law,method:FORMULA_TEXT[g.law],
    // H и ΔP есть только при длине L (как в движке): без неё — только i и R
    note:g.L===undefined?'length_m не задан — H и потери давления не считаются, только i и R':undefined,
    warnings:speedNotes(m.id,g.dv_mm,g.v,inp.mode).map(n=>n.text).concat(ign),
    ignored:ign.length?ign:undefined,
    dv_from:a.dv_mm!==undefined?cfg.dv_from:undefined,
    dv_matched:a.dv_mm!==undefined?cfg.dv_matched:undefined,
    verdict:{v_limit:lim?{min:lim[0],max:lim[1]}:undefined,
      v_ok:lim?(g.v>=lim[0]&&g.v<=lim[1]):undefined,recommendation:null}});
}

/* ---- определения инструментов ---- */
const TOOLS=[
 {
  name:'shev-list-materials',
  description:'Список материалов труб калькулятора Шевелева с id, названиями, доступными диаметрами (мм), сериями труб (у plastic, pe100, pex — с их рядами dн) и лимитами скорости по режимам. Вызывай первым, чтобы узнать допустимые значения для shev-configure. Ряд diameters_mm — ряд ВЫБРАННОЙ СЕРИИ (у plastic/pe100/pex по умолчанию ПЭ32+SDR21, SDR 17, SDR 13,6), полный список серий — в series.',
  inputSchema:{type:'object',properties:{}},
  async execute(){
    return textResult({
      materials:MATERIALS.map(m=>{
        // всё знание о странице (ряд d, серии, классы, подпись dв) — в m.page.discovery
        const d=m.page.discovery(defState(m));
        return {id:m.id,name:m.name,
          diameters_mm:d.diameters,
          has_wall_thickness:!!(m.wall||m.gas||m.sMap),   // медь (frmtablII9): dн + толщина S
          dv_note:d.note,
          pipe_classes:d.pipe_classes,
          series:d.series,
          wall_options:d.wall_options};
      }),
      modes:Object.keys(VEL_LIMIT).map(k=>({mode:k,min_v:VEL_LIMIT[k][0],max_v:VEL_LIMIT[k][1]})),
      units:['ls (л/с)','mh (м³/ч)']
    });
  }
 },
 {
  name:'shev-configure',
  description:'Задаёт входные данные расчёта в UI: материал, новые/неновые, диаметр (dн из ряда страницы ИЛИ dv_mm — расчётный внутренний напрямую), толщину стенки, серию труб (pe — марка ПЭ, sdr — SDR), класс ВТ и тип а/ц трубы (vt/tip), галку «по формуле (4) СП» для PEX (sp4), режим водопровода, кинематическую вязкость ν (м²/с), плотность ρ (кг/м³). Параметр не той страницы и неизвестное имя НЕ проглатываются — возвращаются в warnings. Все параметры опциональны — меняется только переданное. На страницах чугуна, ж/б, стеклопластика и стекла режим/ν/ρ/k игнорируются (параметры программы). Возвращает подтверждение: что выбрано, чему равен расчётный dв и откуда он взят (dv_from: row — из сортамента, manual — ручной ввод). ПОРЯДОК: material → pe → sdr → diameter_mm (серия меняет список диаметров, поэтому ставить её надо до диаметра), wall_mm после diameter_mm, dv_mm последним (перекрывает diameter_mm). ПРИМЕР: {material:"steel-es", diameter_mm:1120, wall_mm:10, wear:"old", mode:"dhw-supply"} → dp=1099; без wall_mm программа возьмёт ПЕРВУЮ доступную для этого dн толщину (у dн=1120 это 8 мм → dp=1103). У меди {material:"copper", diameter_mm:22, wall_mm:1.0, cu_system:"circ", t_c:50}; у ПЭ 100 {material:"pe100", sdr:"17", diameter_mm:110}; по внутреннему диаметру {material:"pe100", dv_mm:76} — расчёт ровно при dв=76 (dv_from=manual, dv_matched=false).',
  inputSchema:schema(Object.assign({},CONF_PROPS,D_PROPS)),
  async execute(a){ return textResult(configure(a)); }
 },
 {
  name:'shev-velocity',
  description:'СКОРОСТЬ ПОТОКА В ТРУБЕ: v = Q/(π·dв²/4). Принимает ровно то, что входит в формулу, — расчётный внутренний диаметр dв (мм) и расход: материал, ν, ρ, режим и длина в скорость не входят (одна формула velocity() на все 12 страниц, js/calc.js). Поэтому вызов НЕ зависит от того, что открыто на странице, и НИЧЕГО на экране не меняет: два одинаковых вызова дают одинаковый ответ. dв берётся из shev-list-materials (ряды диаметров и серии) или из shev-configure (dv_mm). Потери по этой скорости — shev-losses с v_ms.',
  inputSchema:{type:'object',properties:{
    dv_mm:{type:'number',description:'расчётный внутренний диаметр dв, мм (у стали и чугуна «неновых» — уже с поправкой −1 мм на отложения; у полиэтилена — dн−2e выбранной серии)'},
    q:{type:'number',description:'расход'},
    qunit:{type:'string',enum:['ls','mh'],description:'единицы расхода: ls=л/с (по умолчанию), mh=м³/ч'}
  }},
  async execute(a){
    if(!(a.dv_mm>0)) throw new Error('dv_mm — расчётный внутренний диаметр в мм (> 0)');
    if(!(a.q>0)) throw new Error('q — расход (> 0)');
    const q=qToM3s(a.q,a.qunit||'ls'), d=a.dv_mm/1000;
    return textResult({ok:true,dv_mm:a.dv_mm,q:a.q,qunit:a.qunit||'ls',q_m3s:q,
      S_cm2:+(Math.PI*d*d/4*1e4).toFixed(3),v_ms:velocity(q,a.dv_mm)});
  }
 },
 {
  name:'shev-losses',
  description:'ПОТЕРИ НАПОРА И ДАВЛЕНИЯ на участке — считает по ОДНОМУ из двух входов: РАСХОД q (скорость посчитается сама; экран покажет расчёт как кнопка «Расчёт», в ответе будут raw-текст программы и экономическая рекомендация по диаметру) или СКОРОСТЬ v_ms, если она уже известна извне (расход тогда не нужен; результат на экране не пересчитывается, рекомендации по диаметру нет — для неё нужен расход). Отдаёт: i (мм/м и м/м), R (Па/м), при длине L — H (м) и потери давления (Па), law/method — какой формулой фактически посчитано, предупреждения по скорости. Вход материала/сортамента — тот же словарь, что у shev-configure: он нужен, чтобы получить расчётный dв. Если надо и задать входы, и посчитать — это один вызов shev-losses.',
  inputSchema:schema(Object.assign({},CONF_PROPS,D_PROPS,CALC_PROPS,
    {v_ms:{type:'number',description:'СКОРОСТЬ, м/с — если она уже известна, q не нужен: потери считаются прямо по ней (экран не меняется, рекомендации по диаметру нет)'}})),
  async execute(a){ return a.v_ms===undefined?lossesByFlow(a):lossesByVelocity(a); }
 },
 {
  name:'shev-sweep',
  description:'Срез расчёта по списку диаметров одним вызовом: те же параметры страницы, что у shev-configure, плюс dn — список диаметров, и расход с длиной (k и xi_total тоже принимаются и действуют на весь срез). Материал и серия выставляются ОДИН раз, затем расчёт идёт по каждому dн — один вызов вместо N. Диаметр, которого нет в ряду выбранной серии, не роняет весь срез: в его строке придёт {dn, error}. Экран остаётся на последнем рассчитанном диаметре. Список — по dн: dv_mm здесь не принимается (ручной dв не менялся бы от строки к строке).',
  inputSchema:schema(Object.assign({},CONF_PROPS,CALC_PROPS,{dn:{type:'array',items:{type:'number'},description:'список диаметров для среза, мм (dу/dн — как у материала, см. shev-list-materials)'}})),

  async execute(a){
    if(!Array.isArray(a.dn)||!a.dn.length) throw new Error('dn — непустой массив диаметров, мм');
    const cfg=configure(Object.assign({},a,{diameter_mm:undefined,dv_mm:undefined,wall_mm:undefined})); // материал/серия/режим — один раз
    const ign=(cfg.warnings||[]).slice();
    calcInputs(a,ign);                                          // расход и длина — тоже один раз
    const rows=[];
    for(const dn of a.dn){
      try{
        setDiameter(dn);
        // стенку — на КАЖДЫЙ dн: у стали, э/с и меди толщина своя у каждого диаметра, и после
        // смены dн страница пересобирает список. Нет такой толщины → строка с error, срез живёт.
        if(a.wall_mm!==undefined) setWall(a.wall_mm);
        calc();
        const r=readResult(), e=echo();
        rows.push({dn,dv:e.result.dv,v:r.v_ms,i:r.i_mm_per_m,R:r.R_Pa_per_m,H:r.H_m,dP:r.dP_Pa,
          v_ok:e.verdict.v_ok,
          optimum_mm:e.verdict.recommendation?e.verdict.recommendation.optimum_mm:null,
          optimum_ok:e.verdict.recommendation?e.verdict.recommendation.ok:null});
      }catch(err){ rows.push({dn,error:err.message}); }
    }
    const st=pageState(), m=currentMat();
    return textResult({ok:true,material:m.id, warnings:ign.length?ign:undefined,
      pe:m.pe?st.pe:undefined,sdr:m.pe100?st.sdr100:(m.pe?st.sdr:undefined),series:m.series?st.series:undefined,
      q:numStrict($('q').value),qunit:$('qunit').value,length_m:numStrict($('len').value),rows});
  }
 },
 {
  name:'shev-get-formulas',
  description:'Возвращает расчётные формулы Шевелева, реализованные в программе (λ, A=λ/(2g), i=A·v²/d^e по материалам и состояниям труб), для справки и объяснения результата пользователю.',
  inputSchema:{type:'object',properties:{}},
  async execute(){
    return textResult({model:MODEL_TEXT, formulas:FORMULA_TEXT,
      source:'кн. Шевелевы 1984; программа «Таблицы Шевелева» ver 3.0, БрГТУ 2008'
    });
  }
 }
];

/* ---- deep link: расчёт открывается ссылкой ----
   ?material=pe100&sdr=13.6&diameter_mm=90&q=10&length_m=50 — те ЖЕ ключи и тот же apply, что у
   shev-configure/shev-losses (один словарь параметров на весь проект, второй набор имён не
   заводим). Применяется один раз при загрузке страницы; пустая строка и неизвестные ключи — ничего.
   Обратную запись (подставлять состояние в адрес) не делаем: адрес и так собирается из inputs в
   ответе расчёта, а replaceState на file:// в части браузеров бросает. */
function applyQuery(qs){
  const src=qs!==undefined?qs:(typeof location!=='undefined'?location.search:'');
  if(!src||src.charAt(0)!=='?') return false;
  const num=v=>{const n=numStrict(String(v).replace(',','.'));return isNaN(n)?undefined:n;};
  const a={};
  for(const [k,v] of new URLSearchParams(src.slice(1))){
    if(k==='material'||k==='pe'||k==='sdr'||k==='wear'||k==='pipe_class'||k==='mode'||k==='cu_system'||k==='qunit'||k==='vt'||k==='tip') a[k]=v;
    else if(k==='sp4') a[k]=(v==='1'||v==='true');
    else if(k==='diameter_mm'||k==='wall_mm'||k==='dv_mm'||k==='t_c'||k==='q'||k==='length_m'||k==='k'||k==='xi_total'){ const n=num(v); if(n!==undefined) a[k]=n; }
  }
  if(!Object.keys(a).length) return false;
  try{ configure(a); calcInputs(a); calc(); return true; }
  catch(e){ $('out').textContent='Ошибка параметров ссылки: '+e.message; return false; }
}

/* ---- регистрация ---- */
function registerWebMCP(){
  const {mc,native}=getModelContext();
  if(!native) document.modelContext.__native=false;
  TOOLS.forEach(def=>{
    const safe=Object.assign({},def,{execute:a=>Promise.resolve(def.execute(a))
      .catch(e=>textResult({ok:false,error:e.message}))});
    try{ const r=mc.registerTool(safe); if(r&&typeof r.catch==='function') r.catch(()=>{}); }catch(e){/* браузер отказал — polyfill-реестр всё равно доступен через window.webmcp */}
  });
}
registerWebMCP();
applyQuery();   // ?material=…&diameter_mm=… — расчёт из ссылки открывается уже посчитанным