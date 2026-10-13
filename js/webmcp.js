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
    if(!t) throw new Error('tool not found: '+name);
    return t.execute(args||{});
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
/* Серии труб — из тех же данных: ПЭ 100 отдаёт кнопки PN (page.pnList), пластик — марки и доступные
   каждой марке серии (page.peOrder + матрица m.pe), PEX — свои пять серий (m.series). */
function seriesInfo(m){
  if(m.pe100) return m.page.pnList().map(({sid,label})=>({id:sid,label,dn:dns(m,{sdr100:sid})}));
  if(m.pe){
    return Object.keys(m.pe).map(mark=>({mark,
      series:m.page.peOrder.filter(s=>m.pe[mark][s]).map(s=>({id:s,label:'SDR '+s,dn:dns(m,{pe:mark,sdr:s})}))}));
  }
  if(m.series) return m.series.map(s=>({id:s.id,label:s.cap,dn:dns(m,{series:s.id})}));
  return undefined;
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
  // Предел скорости — ровно тот, по которому speedNotes решает, писать ли строку-предупреждение:
  // чугун (свой ряд по dв), иначе страницы со стальным блоком режимов; у остальных блока нет и в
  // оригинале предупреждений нет (FUN_0050a140 стеклопластик, FUN_0050daf0 стекло) → lim=null.
  const lim=m.cls?ciLimits(r.dv_mm):(usesSys(m.id)?(VEL_LIMIT[inp.mode]||VEL_LIMIT.potable):null);
  return {
    // inputs = ровно то, чем считал движок (inp) + серия под именем параметра shev-configure.
    // Остальное состояние страницы (cls/vt/tip чужих страниц) сюда не тащим — оно не на что не влияло.
    inputs:Object.assign({},inp,{pe:m.pe?st.pe:undefined,
      sdr:m.pe100?st.sdr100:(m.pe?st.sdr:undefined), series:m.series?st.series:undefined}),
    result:{v:r.v,i_m_per_m:r.i,i1000_mm_per_m:r.i1000,R:r.R,H:r.H,dP:r.P,k:r.k,A:r.A,e:r.e,dv:r.dv_mm,L:r.L,rho:r.rho,q:r.q,
      method:methodOf(inp,r,m)},
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

/* Тексты формул — ОДИН текст на двух потребителей: карта для shev-get-formulas и поле method
   результата shev-calculate (какая формула фактически применена к этому расчёту) — чтобы агент
   объяснил результат пользователю без второго вызова. Источник значений — js/formulas.js. */
const MODEL_TEXT='i[м/м]=A·v²/d^e; A≡λ/(2g); R=ρ·g·i; H=i·L·(1+k), для ci, ж/б, стеклопластика и стекла H=i·L. Медь (СП 40-108-2004) — другие формулы, местные сопротивления не через k: H=i·L+V²Σξ/(2g), ΔP=R·L+Z. g=9.80665 — одно на всю программу, 2g=19.6133 (в оригинале было 9,80665 и 9,81, см. G в formulas.js)';
const FORMULA_TEXT=  {
          steel_new:'λ=0.0159·(1+0.684/v)^0.226/d^0.226',
          ci_new:'λ=0.0144·(1+2.36/v)^0.284/d^0.284',
          old_v_ge_1_2:'A=0.00107; e=1.3',
          old_v_lt_1_2:'A=0.000912·(1+0.867/v)^0.3; e=1.3',
          asbes:'A=0.000561·(1+3.51/v)^0.190; e=1.19',
          conc:'A=0.000802·(1+3.51/v)^0.190; e=1.19',
          plastic_pex:'i=0.000685·v^1.774/dp^1.226',
          glass:'i=0.000745·v^1.774/dp^1.226',
          grp:'λ=0.0146·(v·dp)^-0.226; i=λ·v²/(2g·dp) (A=λ/(2g), e=1) — СП 40-104-2001',
          copper_cold:'СП 40-108-2004 формула (2): i=0,0161·ν^0,25·V^1,75/d^1,25 — холодное водоснабжение и циркуляционные линии ГВС',
          copper_supply:'СП 40-108-2004 формула (3): i=0,051·((6,52·lg d+lg(Vd/ν))/(115·lg²d)+(0,66·lg d+0,1·lg(Vd/ν))/(lg(Vd/ν)·lg d))·V²/d — подающие линии ГВС',
          copper_heating:'СП 40-108-2004 формулы (5)–(9): R=λ·V²/(2d)·10³ Па/м; √λ=0,5·[b/2+1,312(2−b)·lg(3,7d/Kз)/(lg Re−1)]/lg(3,7d/Kз); Re_кз=500d/Kз; b=1+lg Re/lg Re_кз; Kз=10⁻⁵ (трубы медные)',
          copper_local:'СП 40-108-2004 п.3.4.4: ΔP=R·L+Z, Z=0,5·ρ·V²·Σξ; H=i·L+V²Σξ/(2g); ξ — Приложение А (отвод 90° 0,5 … калач 0,7)',
        pex:'СП 41-109-2005 п.3.5 — вариант программы (calc FUN_00526810): √λ=0,5·[b/2+1,312(2−b)]/(lg Re_φ−1); Re_φ=dV/ν_t, Re_кз=500d/Кэ, b=1+lgRe_φ/lgRe_кз (b≤2), Кэ=1,0·10⁻⁶ м; i=λ·V²/(2g·d). Множитель lg(3,7d/Кэ) в оригинале сокращается — см. pexLambda в js/formulas.js',
        pex_sp:'тот же λ, но по формуле (4) СП 41-109-2005 / (3) СП 40-102-2000 — галка «считать по формуле (4) СП»: √λ=0,5·[b/2+1,312(2−b)·lg(3,7d/Кэ)/(lg Re−1)]/lg(3,7d/Кэ)'
  };

/* Какая формула ФАКТИЧЕСКИ применена к этому расчёту — те же ветки, что в iCalc/lossesSP
   (js/formulas.js): сталь и э/с — по новым/неновым, у неновых ветка по v (и ГВС всегда (6));
   чугун — порог v ≥ 1,2; СП-семейство (медь/PEX/PEX-AL-PEX) — по системе и по галке «по (4) СП».
   Тексты берутся из той же карты FORMULA_TEXT, что отдаёт shev-get-formulas. */
function methodOf(inp,r,m){
  const id=m.id;
  if(id==='copper')
    return inp.cuSys==='supply'?FORMULA_TEXT.copper_supply
        :inp.cuSys==='heat'?FORMULA_TEXT.copper_heating:FORMULA_TEXT.copper_cold;
  if(id==='pex'||id==='metal-pex') return inp.pexSp?FORMULA_TEXT.pex_sp:FORMULA_TEXT.pex;
  if(id==='grp')   return FORMULA_TEXT.grp;
  if(id==='glass') return FORMULA_TEXT.glass;
  if(id==='asbes') return FORMULA_TEXT.asbes;
  if(id==='conc')  return FORMULA_TEXT.conc;
  if(id==='plastic'||id==='pe100') return FORMULA_TEXT.plastic_pex;
  if(inp.wear!=='old') return id==='ci'?FORMULA_TEXT.ci_new:FORMULA_TEXT.steel_new;
  if(inp.sys==='hot'||r.v>=1.2) return FORMULA_TEXT.old_v_ge_1_2;
  return FORMULA_TEXT.old_v_lt_1_2;
}

/* Расход, длина и местные сопротивления — параметры РАСЧЁТА, а не материала: именованная функция,
   потому что их задают и shev-calculate, и shev-sweep (один раз на весь срез). */
function calcInputs(a){
  if(a.q!==undefined){ $('q').value=String(a.q); }
  if(a.qunit!==undefined){ if(!['ls','mh'].includes(a.qunit)) throw new Error('qunit: ls|mh'); $('qunit').value=a.qunit; }
  if(a.length_m!==undefined) $('len').value=String(a.length_m);
  if(a.k!==undefined && !fixedSys()) $('k').value=String(a.k); // ci/ж/б: k выключен — поле не трогаем
  if(a.xi_total!==undefined){ // медь (frmtablII9): Frame6 — ξ-редактор; Σξ задаём «другими ξ» (они складываются без умножения)
    if(currentMat().id!=='copper') throw new Error('xi_total есть только на медной странице (frmtablII9)');
    if(!(a.xi_total>=0)) throw new Error('xi_total должен быть ≥ 0');
    $('xiother').checked=a.xi_total>0; $('xiotherval').value=String(a.xi_total); xiShow();
  }
}

/* Тело shev-configure — именованной функцией: ею пользуется и shev-sweep (выставить материал и
   серию один раз на весь срез), поэтому правила применения параметров живут в одном месте. */
function configure(a){
  if(a.material!==undefined) selectMaterial(a.material);
  if(a.pipe_class!==undefined) setPipeClass(a.pipe_class);
  if(a.wear!==undefined) setWear(a.wear);
  if(a.pe!==undefined) setPe(a.pe);
  if(a.sdr!==undefined) setSdr(a.sdr);
  if(a.diameter_mm!==undefined) setDiameter(a.diameter_mm);
  if(a.wall_mm!==undefined) setWall(a.wall_mm);
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
    {const cid=currentMat().id; if(cid!=='copper'&&cid!=='pex'&&cid!=='metal-pex') throw new Error('cu_system доступен на страницах меди, PEX и PEX-AL-PEX');}
    const r=radVal('cusys',a.cu_system);
    if(!r) throw new Error('cu_system должен быть cold, circ, supply или heat');
    r.checked=true; spSysSync();
  }
  // при Option1 «холодного водоснабжения» Frame4/Frame5 в оригинале неактивны: ν=1,3·10⁻⁶, ρ=1000
  // активность блоков как в frmtablII9: cold — оба неактивны; circ/supply — только «Температура»;
  // ручной теплоноситель (ν/ρ) — только в «системы отопления»
  const cuSysNow = spPage() ? spSysVal() : null;
  const CU_LOCK_T='на медной странице блок «Температура» неактивен при «холодного водоснабжения»: ν=1,3·10⁻⁶ м²/с, ρ=1000 кг/м³ (как в оригинале)';
  const CU_LOCK_C='на медной странице блок «Теплоноситель» неактивен кроме «системы отопления»: ν и ρ подставляются по температуре';
  if(a.t_c!==undefined){
    {const cid=currentMat().id; if(cid!=='copper'&&cid!=='pex'&&cid!=='metal-pex') throw new Error('t_c доступен на страницах меди, PEX и PEX-AL-PEX');}
    if(cuSysNow==='cold') throw new Error(CU_LOCK_T);
    $('tcombo').value=String(a.t_c); spHeatSync();   // по t программа подставляет ν и ρ (пороги 50/60/70/80/90)
  }
  if(a.nu!==undefined||a.rho!==undefined){
    if(currentMat().sMap){ // медь: ν и ρ — Frame5 «Теплоноситель»: «другой» + Text3 (ν) и Text18 (ρ)
      if(cuSysNow!=='heat') throw new Error(CU_LOCK_C);
      radVal('cool','other').checked=true;
      if(a.nu!==undefined){ if(!(a.nu>0)) throw new Error('ν должно быть > 0'); $('cunu').value=String(a.nu*1e6); }
      if(a.rho!==undefined){ if(!(a.rho>0)) throw new Error('ρ должно быть > 0'); $('curho').value=String(a.rho); }
      spHeatSync();
    } else {
      if(a.nu!==undefined && !fixedSys()){ if(!(a.nu>0)) throw new Error('ν должно быть > 0'); $('nu').value=String(a.nu); }
      if(a.rho!==undefined && !fixedSys()){ if(!(a.rho>0)) throw new Error('ρ должно быть > 0'); $('rho').value=String(a.rho); }
    }
  }
  updDv(); // dp зависит от wear (чугун: −1 мм только у «неновых») — обновить после всех параметров
  return textResult({ok:true,material:currentMat().id,wear:rad('wear').value,
    pipe_class:currentMat().cls?curCls():undefined,
    dv_mm:$('dcv').value,mode:$('mode').value,nu:$('nu').value,rho:$('rho').value,
    pe:currentMat().pe?curPe():undefined,
    sdr:currentMat().pe100?curPe100Sdr():(currentMat().pe?curSdr():undefined),
    series:currentMat().series?curPexSdr():undefined,
    cu_system:spPage()?spSysVal():undefined,
    t_c:currentMat().sMap?$('tcombo').value:undefined,
    cu_nu:currentMat().sMap?$('cunu').value:undefined,
    cu_rho:currentMat().sMap?$('curho').value:undefined,
    xi_sum:currentMat().sMap?xiTotal():undefined});
}

/* ---- определения инструментов ---- */
const TOOLS=[
 {
  name:'shev-list-materials',
  description:'Список материалов труб калькулятора Шевелева с id, названиями, доступными диаметрами (мм), сериями труб (у plastic, pe100, pex — с их рядами dн) и лимитами скорости по режимам. Вызывай первым, чтобы узнать допустимые значения для shev-configure. Ряд diameters_mm — ряд ВЫБРАННОЙ СЕРИИ (у plastic/pe100/pex по умолчанию ПЭ32+SDR21, SDR 17, SDR 13,6), полный список серий — в series.',
  inputSchema:{type:'object',properties:{}},
  async execute(){
    return textResult({
      materials:MATERIALS.map(m=>({
        id:m.id,name:m.name,
        diameters_mm:(m.pe||m.pe100||m.series)? dns(m,defState(m)) : (m.id==='asbes'? m.vt.map(v=>v.du) : (m.gas? m.gas.dn : (m.cls? (m.duList||[...new Set(Object.values(m.cls).flatMap(t=>Object.keys(t).map(Number)))].sort((a,b)=>a-b)) : m.d))),
        has_wall_thickness:!!(m.wall||m.gas||m.sMap),   // медь (frmtablII9): dн + толщина S
        dv_note:m.gas?'dp=dн−2s−1 (1 мм коррозия), задавай wall_mm':(m.wall?'dв=dн−2s, задавай wall_mm':(m.pe?'dв=dн−2e по ГОСТ 18599-2001 (марка pe и серия sdr в shev-configure, diameter_mm=dн)':(m.pe100?'dв=dн−2e, e — номинальная стенка выбранной серии (ГОСТ Р 70628.2-2023 табл. 2); series выбирается параметром sdr, diameter_mm=dн; «другой» — ручной dp':(m.id==='conc'?'dв=dу (ГОСТ 12586.0-83: 500…1600 мм, 9 значений); «другой» — ручной dp':(m.id==='grp'?'dв=d (СП40-104-2001: 50…400 мм, 13 значений списка программы); «другой» — ручной dp':(m.series?'diameter_mm=dн (СП 41-109-2005 табл. 1; список dн зависит от серии SDR — SDR 13,6: 16…110 (10), SDR 11 и SDR 9: 12…110 (13), SDR 7,4 и SDR 6: 12…110 (14)); dв = dн − 2S − ΔS + Δd/2 — подставляет программа (dн=16, SDR 13,6 → 13,15; dн=110 → 93,2); «другой dв» — ручной dp; местные сопротивления — ξ (xi_total в shev-calculate)':(m.sMap?'diameter_mm=dн (СП 40-108-2004: 6…267 мм — 20 значений списка программы); dв=dн−2S (S — толщина стенки из списка), задавай wall_mm; «другой» — ручной dp; местные сопротивления — ξ (xi_total в shev-calculate)':(m.dvMap?'diameter_mm=dн (ГОСТ 8894-86: 45, 67, 93, 122, 169, 221 мм — 6 значений списка программы); dв подставляет программа: 45→37, 67→57, 93→81, 122→108, 169→150, 221→198; «другой» — ручной dp':(m.dvSame?'dв=d':(m.cls?'dу единый список 65…1000 для ЛА/А/Б (450 нет); dв=dн−2S из таблицы класса; dp=dв−1 при dв≤300 и wear=old':'dв указан в dv')))))))))),
        pipe_classes:m.cls?Object.keys(m.cls):undefined,
        series:seriesInfo(m)
      })),
      modes:Object.keys(VEL_LIMIT).map(k=>({mode:k,min_v:VEL_LIMIT[k][0],max_v:VEL_LIMIT[k][1]})),
      units:['ls (л/с)','mh (м³/ч)']
    });
  }
 },
 {
  name:'shev-configure',
  description:'Задаёт входные данные расчёта в UI: материал, новые/неновые, диаметр (мм), толщину стенки (для электросварных), серию труб (pe — марка ПЭ, sdr — SDR), режим водопровода, кинематическую вязкость ν (м²/с), плотность ρ (кг/м³). Все параметры опциональны — меняется только переданное. На страницах чугуна, ж/б, стеклопластика и стекла режим/ν/ρ/k игнорируются (параметры программы). Возвращает подтверждение с расчётным dв и выбранной серией. ПОРЯДОК: material → pe → sdr → diameter_mm (серия меняет список диаметров, поэтому ставить её надо до диаметра), wall_mm после diameter_mm. ПРИМЕР: {material:"steel-es", diameter_mm:1120, wall_mm:10, wear:"old", mode:"dhw-supply"} → dp=1099; без wall_mm программа возьмёт ПЕРВУЮ доступную для этого dн толщину (у dн=1120 это 8 мм → dp=1103). У меди {material:"copper", diameter_mm:22, wall_mm:1.0, cu_system:"circ", t_c:50}; у ПЭ 100 {material:"pe100", sdr:"17", diameter_mm:110} — SDR без явного указания не задаётся и остаётся дефолтом страницы.',
  inputSchema:{type:'object',properties:{
    material:{type:'string',description:'id материала из shev-list-materials (steel, steel-es, ci, asbes, plastic, pe100, conc, grp, glass, copper, pex, metal-pex)'},
    pe:{type:'string',enum:['32','63','80','100'],description:'только plastic: марка ПЭ (frmtablII5 Frame2) — от неё зависит, какие серии SDR допустимы; ставь ДО sdr'},
    sdr:{type:'string',description:'серия труб: plastic/pe100 — номер SDR (например 11, 17; можно передать числом), pex — id серии (sdr11, sdr136). Серия меняет dв, а значит и ΔP: задавай её явно, не полагаясь на дефолт'},
    cu_system:{type:'string',enum:['cold','circ','supply','heat'],description:'только copper: система СП 40-108-2004 — cold=холодное водоснабжение (ф-ла 2, v≤4), circ=циркуляционный ГВС (ф-ла 2, v≤3), supply=подающие ГВС (ф-ла 3, v≤3), heat=отопление (ф-лы 5–9, v≤2)'},
    t_c:{type:'number',enum:[50,60,70,80,90],description:'только copper: температура воды °С (Combo3) — по ней программа подставляет ν и ρ (50→0,55e-6/990 … 90→0,36e-6/970); при пустой t ν=1,3e-6, ρ=1000'},
    wear:{type:'string',enum:['new','old'],description:'новые/неновые трубы'},
    pipe_class:{type:'string',enum:['ЛА','А','Б'],description:'класс чугунной трубы (только ci): единый список dу (14 значений, без 450/700/900) для всех классов, dp из таблицы класса'},
    diameter_mm:{type:'number',description:'выбранный диаметр из списка материала (dу/dн/du, мм)'},
    wall_mm:{type:'number',description:'толщина стенки мм (стальные gas/электросварные steel-es)'},
    mode:{type:'string',description:'режим: potable|combined|prod-fire|fire|dhw-supply|dhw-tp|dhw-risers (игнорируется для ci, conc, grp и glass — на этих страницах режима нет)'},
    nu:{type:'number',description:'кинематическая вязкость, м²/с (вода 10°C: 1.3e-6); игнорируется для ci, conc, grp и glass — там ν=1,3·10⁻⁶ (t=10°C) зафиксирована'},
    rho:{type:'number',description:'плотность, кг/м³; игнорируется для ci, conc, grp и glass — там ρ=1000 (t=10°C) зафиксирована'}
  }},
  async execute(a){ return configure(a); }
 },
 {
  name:'shev-calculate',
  description:'Выполняет гидравлический расчёт участка (как кнопка «Расчёт»): скорость v, удельные потери i (мм/м) и R (Па/м), потери напора H=i·L·(1+k) (для ci, conc, grp и glass — H=i·L, местные сопротивления отсутствуют), потери давления (Па), предупреждения о скорости и экономическая рекомендация по диаметру. Параметры расхода/длины/местных сопротивлений опциональны — без них берутся текущие значения UI. Кроме разобранного текста отдаёт inputs (все входы расчёта, включая материал и серию — по ним расчёт воспроизводится), result (числа без округления печати) и verdict (предел скорости, v_ok и рекомендация: ok=true — выбранный диаметр уже экономически обоснован).',
  inputSchema:{type:'object',properties:{
    q:{type:'number',description:'расход (по умолчанию л/с)'},
    qunit:{type:'string',enum:['ls','mh'],description:'единицы расхода: ls=л/с, mh=м³/ч'},
    length_m:{type:'number',description:'длина участка L, м'},
    k:{type:'number',description:'коэффициент местных сопротивлений k ≥ 0 (игнорируется для ci, conc, grp и glass: там H=i·L)'},
    xi_total:{type:'number',description:'только copper: сумма ξ местных сопротивлений (Frame6 окна меди = ξ·количество + «другие ξ»); входит в H как V²Σξ/2g и в потери давления как Z=0,5ρV²Σξ'}
  }},
  async execute(a){
    calcInputs(a);
    calc();
    const r=readResult();
    if(/ошибка|не должен|не может|не ввели/.test(r.raw)&&r.v_ms===null)
      return textResult({ok:false,error:r.raw.trim()});
    return textResult(Object.assign({ok:true},r,echo()));
  }
 },
 {
  name:'shev-sweep',
  description:'Срез расчёта по списку диаметров одним вызовом: те же параметры, что у shev-configure (material, pe, sdr, mode, nu, rho, wear, wall_mm, cu_system, t_c), плюс dn — список диаметров, и расход с длиной. Материал и серия выставляются ОДИН раз, затем расчёт идёт по каждому dн — один вызов вместо N. Диаметр, которого нет в ряду выбранной серии, не роняет весь срез: в его строке придёт {dn, error}. Экран остаётся на последнем рассчитанном диаметре.',
  inputSchema:{type:'object',properties:{
    dn:{type:'array',items:{type:'number'},description:'список диаметров для среза, мм (dу/dн — как у материала, см. shev-list-materials)'},
    material:{type:'string',description:'id материала; если не передан — остаётся текущий'},
    pe:{type:'string',enum:['32','63','80','100'],description:'только plastic: марка ПЭ'},
    sdr:{type:'string',description:'серия труб: plastic/pe100 — номер SDR, pex — id серии (sdr11, sdr136)'},
    wear:{type:'string',enum:['new','old'],description:'новые/неновые трубы'},
    wall_mm:{type:'number',description:'толщина стенки мм (сталь/э/с/медь). Ставится для каждого dн среза отдельно: толщина своя у каждого диаметра, и если у этого dн её нет — строка вернёт {dn, error} с перечнем доступных'},
    mode:{type:'string',description:'режим: potable|combined|prod-fire|fire|dhw-supply|dhw-tp|dhw-risers'},
    nu:{type:'number',description:'ν, м²/с (игнорируется там же, где у shev-configure)'},
    rho:{type:'number',description:'ρ, кг/м³ (игнорируется там же, где у shev-configure)'},
    q:{type:'number',description:'расход, общий для всех диаметров (по умолчанию л/с)'},
    qunit:{type:'string',enum:['ls','mh'],description:'единицы расхода: ls=л/с, mh=м³/ч'},
    length_m:{type:'number',description:'длина участка L, м'}
  }},
  async execute(a){
    if(!Array.isArray(a.dn)||!a.dn.length) throw new Error('dn — непустой массив диаметров, мм');
    configure(Object.assign({},a,{diameter_mm:undefined,wall_mm:undefined})); // материал/серия/режим — один раз
    calcInputs(a);                                              // расход и длина — тоже один раз
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
    return textResult({ok:true,material:m.id,
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

/* ---- регистрация ---- */
function registerWebMCP(){
  const {mc,native}=getModelContext();
  if(!native) document.modelContext.__native=false;
  TOOLS.forEach(def=>{
    try{ const r=mc.registerTool(def); if(r&&typeof r.catch==='function') r.catch(()=>{}); }catch(e){/* браузер отказал — polyfill-реестр всё равно доступен через window.webmcp */}
  });
}
registerWebMCP();