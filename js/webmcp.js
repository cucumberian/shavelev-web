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
  document.querySelector(`input[name=wear][value=${w}]`).checked=true;
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
  const r=document.querySelector(`input[name=cls][value="${c}"]`);
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
function readResult(){
  // парсим блок вывода в структурированный объект (расчёт + потери напора)
  const t=$('out').textContent+'\n'+$('outH').textContent;
  const num=(re)=>{const m=t.match(re);return m?parseFloat(m[1].replace(',','.')):null;};
  return {
    v_ms:num(/Скорость v = ([-\d,]+) м\/с/),
    i_mm_per_m:num(/i = ([-\d,]+) мм\/м/),
    R_Pa_per_m:num(/R = ([-\d,]+) Па\/м/),
    H_m:num(/H = (?:i·L(?:·\(1\+k\))?|i·L \+ V²Σξ\/2g) = ([-\d,]+) м/),   // медь: H = i·L + V²Σξ/2g
    dP_Pa:num(/потери давления = ([-\d,]+) Па/),
    dv_mm:parseFloat($('dcv').value.replace(',','.'))||null,
    warnings:(t.match(/Внимание![^\n]*|Малая скорость![^\n]*|Большая скорость![^\n]*/g)||[]),
    recommendation:(t.match(/[^\n]*(?:экономически обосновано|рекомендуется использовать трубу)[^\n]*/)||[null])[0],
    raw:t
  };
}

/* ---- определения инструментов ---- */
const TOOLS=[
 {
  name:'shev-list-materials',
  description:'Список материалов труб калькулятора Шевелева с id, названиями, доступными диаметрами (мм) и лимитами скорости по режимам. Вызывай первым, чтобы узнать допустимые значения для shev-configure.',
  inputSchema:{type:'object',properties:{}},
  async execute(){
    return textResult({
      materials:MATERIALS.map(m=>({
        id:m.id,name:m.name,
        diameters_mm:m.id==='asbes'? m.vt.map(v=>v.du) : (m.pe? [...$('dsel').options].map(o=>+o.value) : (m.gas? m.gas.dn : (m.cls? (m.duList||[...new Set(Object.values(m.cls).flatMap(t=>Object.keys(t).map(Number)))].sort((a,b)=>a-b)) : m.d))),
        has_wall_thickness:!!(m.wall||m.gas||m.sMap),   // медь (frmtablII9): dн + толщина S
        dv_note:m.gas?'dp=dн−2s−1 (1 мм коррозия), задавай wall_mm':(m.wall?'dв=dн−2s, задавай wall_mm':(m.pe?'dв=dн−2e по ГОСТ 18599-2001 (марка ПЭ и серия SDR выбираются в UI, diameter_mm=dн)':(m.id==='conc'?'dв=dу (ГОСТ 12586.0-83: 500…1600 мм, 9 значений); «другой» — ручной dp':(m.id==='grp'?'dв=d (СП40-104-2001: 50…400 мм, 13 значений списка программы); «другой» — ручной dp':(m.sMap?'diameter_mm=dн (СП 40-108-2004: 6…267 мм — 20 значений списка программы); dв=dн−2S (S — толщина стенки из списка), задавай wall_mm; «другой» — ручной dp; местные сопротивления — ξ (xi_total в shev-calculate)':(m.dvMap?'diameter_mm=dн (ГОСТ 8894-86: 45, 67, 93, 122, 169, 221 мм — 6 значений списка программы); dв подставляет программа: 45→37, 67→57, 93→81, 122→108, 169→150, 221→198; «другой» — ручной dp':(m.dvSame?'dв=d':(m.cls?'dу единый список 65…1000 для ЛА/А/Б (450 нет); dв=dн−2S из таблицы класса; dp=dв−1 при dв≤300 и wear=old':'dв указан в dv')))))))),
        pipe_classes:m.cls?Object.keys(m.cls):undefined
      })),
      modes:Object.keys(VEL_LIMIT).map(k=>({mode:k,min_v:VEL_LIMIT[k][0],max_v:VEL_LIMIT[k][1]})),
      units:['ls (л/с)','mh (м³/ч)']
    });
  }
 },
 {
  name:'shev-configure',
  description:'Задаёт входные данные расчёта в UI: материал, новые/неновые, диаметр (мм), толщину стенки (для электросварных), режим водопровода, кинематическую вязкость ν (м²/с), плотность ρ (кг/м³). Все параметры опциональны — меняется только переданное. На страницах чугуна, ж/б, стеклопластика и стекла режим/ν/ρ/k игнорируются (параметры программы). Возвращает подтверждение с расчётным dв.',
  inputSchema:{type:'object',properties:{
    material:{type:'string',description:'id материала из shev-list-materials (steel, steel-es, ci, asbes, plastic, conc, grp, glass, copper, pex, metal-pex)'},
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
  async execute(a){
    if(a.material!==undefined) selectMaterial(a.material);
    if(a.pipe_class!==undefined) setPipeClass(a.pipe_class);
    if(a.wear!==undefined) setWear(a.wear);
    if(a.diameter_mm!==undefined) setDiameter(a.diameter_mm);
    if(a.wall_mm!==undefined) setWall(a.wall_mm);
    if(a.mode!==undefined && !fixedSys()){ // ci/ж/б: режимов и k нет — игнорируем
      if(!VEL_LIMIT[a.mode]) throw new Error('неизвестный режим: '+a.mode);
      const wantHot=MODE_SYS.hot.includes(a.mode);
      const r=document.querySelector('input[name=sys][value='+(wantHot?'hot':'cold')+']');
      if(r.checked!==wantHot){r.checked=true;fillModes(false);}
      $('mode').value=a.mode;
      const kv=K_MODE[a.mode]; if(kv!==undefined) $('k').value=String(kv);
    }
    // медь (frmtablII9): Frame2 «Выбор системы» и Frame4 «Температура, °С» вместо стального режима
    if(a.cu_system!==undefined){
      if(currentMat().id!=='copper') throw new Error('cu_system есть только на медной странице (frmtablII9)');
      const r=document.querySelector('input[name=cusys][value="'+a.cu_system+'"]');
      if(!r) throw new Error('cu_system должен быть cold, circ, supply или heat');
      r.checked=true; cuSysSync();
    }
    // при Option1 «холодного водоснабжения» Frame4/Frame5 в оригинале неактивны: ν=1,3·10⁻⁶, ρ=1000
    // активность блоков как в frmtablII9: cold — оба неактивны; circ/supply — только «Температура»;
    // ручной теплоноситель (ν/ρ) — только в «системы отопления»
    const cuSysNow = currentMat().id==='copper' ? cuSysVal() : null;
    const CU_LOCK_T='на медной странице блок «Температура» неактивен при «холодного водоснабжения»: ν=1,3·10⁻⁶ м²/с, ρ=1000 кг/м³ (как в оригинале)';
    const CU_LOCK_C='на медной странице блок «Теплоноситель» неактивен кроме «системы отопления»: ν и ρ подставляются по температуре';
    if(a.t_c!==undefined){
      if(currentMat().id!=='copper') throw new Error('t_c есть только на медной странице (frmtablII9)');
      if(cuSysNow==='cold') throw new Error(CU_LOCK_T);
      $('tcombo').value=String(a.t_c); cuHeatSync();   // по t программа подставляет ν и ρ (пороги 50/60/70/80/90)
    }
    if(a.nu!==undefined||a.rho!==undefined){
      if(currentMat().sMap){ // медь: ν и ρ — Frame5 «Теплоноситель»: «другой» + Text3 (ν) и Text18 (ρ)
        if(cuSysNow!=='heat') throw new Error(CU_LOCK_C);
        document.querySelector('input[name=cool][value="other"]').checked=true;
        if(a.nu!==undefined){ if(!(a.nu>0)) throw new Error('ν должно быть > 0'); $('cunu').value=String(a.nu); }
        if(a.rho!==undefined){ if(!(a.rho>0)) throw new Error('ρ должно быть > 0'); $('curho').value=String(a.rho); }
        cuHeatSync();
      } else {
        if(a.nu!==undefined && !fixedSys()){ if(!(a.nu>0)) throw new Error('ν должно быть > 0'); $('nu').value=String(a.nu); }
        if(a.rho!==undefined && !fixedSys()){ if(!(a.rho>0)) throw new Error('ρ должно быть > 0'); $('rho').value=String(a.rho); }
      }
    }
    updDv(); // dp зависит от wear (чугун: −1 мм только у «неновых») — обновить после всех параметров
    return textResult({ok:true,material:currentMat().id,wear:document.querySelector('input[name=wear]:checked').value,
      pipe_class:currentMat().cls?curCls():undefined,
      dv_mm:$('dcv').value,mode:$('mode').value,nu:$('nu').value,rho:$('rho').value,
      cu_system:currentMat().sMap?cuSysVal():undefined,
      t_c:currentMat().sMap?$('tcombo').value:undefined,
      cu_nu:currentMat().sMap?$('cunu').value:undefined,
      cu_rho:currentMat().sMap?$('curho').value:undefined,
      xi_sum:currentMat().sMap?xiTotal():undefined});
  }
 },
 {
  name:'shev-calculate',
  description:'Выполняет гидравлический расчёт участка (как кнопка «Расчёт»): скорость v, удельные потери i (мм/м) и R (Па/м), потери напора H=i·L·(1+k) (для ci, conc, grp и glass — H=i·L, местные сопротивления отсутствуют), потери давления (Па), предупреждения о скорости и экономическая рекомендация по диаметру. Параметры расхода/длины/местных сопротивлений опциональны — без них берутся текущие значения UI.',
  inputSchema:{type:'object',properties:{
    q:{type:'number',description:'расход (по умолчанию л/с)'},
    qunit:{type:'string',enum:['ls','mh'],description:'единицы расхода: ls=л/с, mh=м³/ч'},
    length_m:{type:'number',description:'длина участка L, м'},
    k:{type:'number',description:'коэффициент местных сопротивлений k ≥ 0 (игнорируется для ci, conc, grp и glass: там H=i·L)'},
    xi_total:{type:'number',description:'только copper: сумма ξ местных сопротивлений (Frame6 окна меди = ξ·количество + «другие ξ»); входит в H как V²Σξ/2g и в потери давления как Z=0,5ρV²Σξ'}
  }},
  async execute(a){
    if(a.q!==undefined){ $('q').value=String(a.q); }
    if(a.qunit!==undefined){ if(!['ls','mh'].includes(a.qunit)) throw new Error('qunit: ls|mh'); $('qunit').value=a.qunit; }
    if(a.length_m!==undefined) $('len').value=String(a.length_m);
    if(a.k!==undefined && !fixedSys()) $('k').value=String(a.k); // ci/ж/б: k выключен — поле не трогаем
    if(a.xi_total!==undefined){ // медь (frmtablII9): Frame6 — ξ-редактор; Σξ задаём «другими ξ» (они складываются без умножения)
      if(currentMat().id!=='copper') throw new Error('xi_total есть только на медной странице (frmtablII9)');
      if(!(a.xi_total>=0)) throw new Error('xi_total должен быть ≥ 0');
      $('xiother').checked=a.xi_total>0; $('xiotherval').value=String(a.xi_total); xiShow();
    }
    calc();
    const r=readResult();
    if(/ошибка|не должен|не может|не ввели/.test(r.raw)&&r.v_ms===null)
      return textResult({ok:false,error:r.raw.trim()});
    return textResult(Object.assign({ok:true},r));
  }
 },
 {
  name:'shev-get-formulas',
  description:'Возвращает расчётные формулы Шевелева, реализованные в программе (λ, A=λ/(2g), i=A·v²/d^e по материалам и состояниям труб), для справки и объяснения результата пользователю.',
  inputSchema:{type:'object',properties:{}},
  async execute(){
    return textResult({
      model:'i[м/м]=A·v²/d^e; A≡λ/(2g); R=ρ·g·i; H=i·L·(1+k), для ci, ж/б, стеклопластика и стекла H=i·L; g=9.81. Медь (СП 40-108-2004) — другие формулы, местные сопротивления не через k: H=i·L+V²Σξ/(2g), ΔP=R·L+Z, g=9.80665',
      formulas:{
        steel_new:'λ=0.0159·(1+0.684/v)^0.226/d^0.226',
        ci_new:'λ=0.0144·(1+2.36/v)^0.284/d^0.284',
        old_v_ge_1_2:'A=0.00107; e=1.3',
        old_v_lt_1_2:'A=0.000912·(1+0.867/v)^0.3; e=1.3',
        asbes:'A=0.000561·(1+3.51/v)^0.190; e=1.19',
        conc:'A=0.000802·(1+3.51/v)^0.190; e=1.19',
        plastic_pex:'i=0.000685·v^1.774/dp^1.226',
        glass:'i=0.000745·v^1.774/dp^1.226',
        grp:'λ=0.0146·(v·dp)^-0.226; i=λ·v²/(2g·dp) (A=λ/19.62, e=1) — СП 40-104-2001',
        copper_cold:'СП 40-108-2004 формула (2): i=0,0161·ν^0,25·V^1,75/d^1,25 — холодное водоснабжение и циркуляционные линии ГВС',
        copper_supply:'СП 40-108-2004 формула (3): i=0,051·((6,52·lg d+lg(Vd/ν))/(115·lg²d)+(0,66·lg d+0,1·lg(Vd/ν))/(lg(Vd/ν)·lg d))·V²/d — подающие линии ГВС',
        copper_heating:'СП 40-108-2004 формулы (5)–(9): R=λ·V²/(2d)·10³ Па/м; √λ=0,5·[b/2+1,312(2−b)·lg(3,7d/Kз)/(lg Re−1)]/lg(3,7d/Kз); Re_кз=500d/Kз; b=1+lg Re/lg Re_кз; Kз=10⁻⁵ (трубы медные)',
        copper_local:'СП 40-108-2004 п.3.4.4: ΔP=R·L+Z, Z=0,5·ρ·V²·Σξ; H=i·L+V²Σξ/(2g); ξ — Приложение А (отвод 90° 0,5 … калач 0,7)'
      },
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