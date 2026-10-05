/* webmcp.js — поддержка WebMCP (https://github.com/webmachinelearning/webmcp).
   Регистрирует инструменты калькулятора через document.modelContext.registerTool.
   В браузерах без нативного modelContext включается встроенный polyfill:
   реестр доступен как window.webmcp.getTools() / window.webmcp.executeTool(name, args)
   (паттерн author-provided agent из спецификации).
   Зависимости: formulas.js, data.js, ui.js (загружаются раньше). */
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
function setDiameter(dv){
  const m=currentMat();
  const opt=[...$('dsel').options].find(o=>parseFloat(o.value)===dv);
  if(opt){ $('dsel').value=opt.value; $('dsel').onchange(); return; }
  // для материалов с dв≠d: пользователь мыслит dу — ищем индекс в m.d
  const idx=m.d? m.d.indexOf(dv) : -1;
  if(idx>=0 && $('dsel').options[idx]){
    $('dsel').value=$('dsel').options[idx].value; $('dsel').onchange(); return;
  }
  // а/ц: dу из vt → первый вариант dв этого dу
  if(m.vt){
    const vt=m.vt.find(v=>v.du===dv);
    if(vt){
      const opt2=[...$('dsel').options].find(o=>o.textContent.includes('dу='+dv+' '));
      if(opt2){ $('dsel').value=opt2.value; $('dsel').onchange(); return; }
    }
  }
  throw new Error('диаметр '+dv+' недоступен для текущего материала; доступны: '+[...$('dsel').options].map(o=>o.value).join(', '));
}
function setWall(s){
  const m=currentMat();
  if(!m.wall) throw new Error('у текущего материала нет выбора стенки');
  const opt=[...$('tsel').options].find(o=>parseFloat(o.value)===s);
  if(!opt) throw new Error('толщина стенки '+s+' недоступна; доступны: '+[...$('tsel').options].map(o=>o.value).join(', '));
  $('tsel').value=opt.value; $('tsel').onchange();
}
function readResult(){
  // парсим блок вывода в структурированный объект
  const t=$('out').textContent;
  const num=(re)=>{const m=t.match(re);return m?parseFloat(m[1].replace(',','.')):null;};
  return {
    v_ms:num(/Скорость v = ([-\d,]+) м\/с/),
    i_mm_per_m:num(/i = ([-\d,]+) мм\/м/),
    R_Pa_per_m:num(/R = ([-\d,]+) Па\/м/),
    H_m:num(/H = i·L·\(1\+k\) = ([-\d,]+) м/),
    dP_Pa:num(/потери давления = ([-\d,]+) Па/),
    dv_mm:parseFloat($('dcv').textContent.replace(',','.'))||null,
    warnings:(t.match(/Внимание![^\n]*|Малая скорость![^\n]*/g)||[]),
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
        diameters_mm:m.id==='asbes'? m.vt.map(v=>v.du) : m.d,
        has_wall_thickness:!!m.wall,
        dv_note:m.wall?'dв=dн−2s, задавай wall_mm':(m.dvSame?'dв=d':'dв указан в dv')
      })),
      modes:Object.keys(VEL_LIMIT).map(k=>({mode:k,min_v:VEL_LIMIT[k][0],max_v:VEL_LIMIT[k][1]})),
      units:['ls (л/с)','mh (м³/ч)']
    });
  }
 },
 {
  name:'shev-configure',
  description:'Задаёт входные данные расчёта в UI: материал, новые/неновые, диаметр (мм), толщину стенки (для электросварных), режим водопровода, кинематическую вязкость ν (м²/с), плотность ρ (кг/м³). Все параметры опциональны — меняется только переданное. Возвращает подтверждение с расчётным dв.',
  inputSchema:{type:'object',properties:{
    material:{type:'string',description:'id материала из shev-list-materials (steel, steel-es, ci, asbes, plastic, conc, grp, glass, pex, metal-pex)'},
    wear:{type:'string',enum:['new','old'],description:'новые/неновые трубы'},
    diameter_mm:{type:'number',description:'выбранный диаметр из списка материала (dу/dн/du, мм)'},
    wall_mm:{type:'number',description:'толщина стенки мм (только электросварные steel-es)'},
    mode:{type:'string',description:'режим: potable|combined|prod-fire|fire|dhw-supply|dhw-tp|dhw-risers'},
    nu:{type:'number',description:'кинематическая вязкость, м²/с (вода 10°C: 1.3e-6)'},
    rho:{type:'number',description:'плотность, кг/м³'}
  }},
  async execute(a){
    if(a.material!==undefined) selectMaterial(a.material);
    if(a.wear!==undefined) setWear(a.wear);
    if(a.diameter_mm!==undefined) setDiameter(a.diameter_mm);
    if(a.wall_mm!==undefined) setWall(a.wall_mm);
    if(a.mode!==undefined){
      if(!VEL_LIMIT[a.mode]) throw new Error('неизвестный режим: '+a.mode);
      $('mode').value=a.mode;
    }
    if(a.nu!==undefined){ if(!(a.nu>0)) throw new Error('ν должно быть > 0'); $('nu').value=String(a.nu); }
    if(a.rho!==undefined){ if(!(a.rho>0)) throw new Error('ρ должно быть > 0'); $('rho').value=String(a.rho); }
    return textResult({ok:true,material:currentMat().id,wear:document.querySelector('input[name=wear]:checked').value,
      dv_mm:$('dcv').textContent,mode:$('mode').value,nu:$('nu').value,rho:$('rho').value});
  }
 },
 {
  name:'shev-calculate',
  description:'Выполняет гидравлический расчёт участка (как кнопка «Расчёт»): скорость v, удельные потери i (мм/м) и R (Па/м), потери напора H=i·L·(1+k), потери давления (Па), предупреждения о скорости и экономическая рекомендация по диаметру. Параметры расхода/длины/местных сопротивлений опциональны — без них берутся текущие значения UI.',
  inputSchema:{type:'object',properties:{
    q:{type:'number',description:'расход (по умолчанию л/с)'},
    qunit:{type:'string',enum:['ls','mh'],description:'единицы расхода: ls=л/с, mh=м³/ч'},
    length_m:{type:'number',description:'длина участка L, м'},
    k:{type:'number',description:'коэффициент местных сопротивлений k ≥ 0'}
  }},
  async execute(a){
    if(a.q!==undefined){ $('q').value=String(a.q); }
    if(a.qunit!==undefined){ if(!['ls','mh'].includes(a.qunit)) throw new Error('qunit: ls|mh'); $('qunit').value=a.qunit; }
    if(a.length_m!==undefined) $('len').value=String(a.length_m);
    if(a.k!==undefined) $('k').value=String(a.k);
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
      model:'i[м/м]=A·v²/d^e; A≡λ/(2g); R=ρ·g·i; H=i·L·(1+k); g=9.81',
      formulas:{
        steel_new:'λ=0.0159·(1+0.684/v)^0.226/d^0.226',
        ci_new:'λ=0.0144·(1+2.36/v)^0.284/d^0.284',
        old_v_ge_1_2:'A=0.00107; e=1.3',
        old_v_lt_1_2:'A=0.000912·(1+0.867/v)^0.3; e=1.3',
        asbes:'A=0.000561·(1+1.19/v)^0.190; e=1.19',
        conc:'A=0.000802·(1+1.19/v)^0.190; e=1.19',
        plastic_grp_pex:'A=0.000685·(1+1.774/v)^0.226; e=1.226',
        glass:'A=0.000745·(1+1.774/v)^0.226; e=1.226'
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