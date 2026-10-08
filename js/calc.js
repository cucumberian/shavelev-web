/* calc.js — расчётный движок клона «Таблицы Шевелева»: ТОЛЬКО вычисления, без DOM.
   Здесь собрано всё, что считает: единицы расхода, скорость, уклон, потери, предупреждения
   по скорости, строка рекомендации и печать чисел. Константы формул — formulas.js,
   справочные таблицы — js/data/ (модуль на каждый тип труб + registry/docs/modes). ui.js читает
   контролы и рисует результат; webmcp.js
   вызывает те же функции. Движок тестится в node без jsdom (test/calc_test.js).

   Модель программы (реверс shev.exe ver 3.0):
     v = Q/(π·dp²/4)            π = 4·atan(1) (rtcAtn(1)·_DAT_004011f8); в скорость входят
                                ТОЛЬКО расход и диаметр — ν, ρ и температура не участвуют
     i = A·v²/dp^e, A ≡ λ/(2g)  2g = 19,62 (VA 0x4011d8); ν уже подставлена в константы A
                                (ν воды 1,3·10⁻⁶ м²/с, t = 10 °C)
     R = ρ·g·i [Па/м]           g = 9,81; ρ влияет ТОЛЬКО на эту строку (и «потери давления, Па»)
     H = i·L·(1+k) [м]          на страницах без местных сопротивлений k ≡ 0 → H = i·L

   Страницы без блока «Режим / теплоноситель» (по шаблонам форм EXE: в окне нет ни «Выбор
   системы»/t= °C, ни ν/ρ, ни «учесть потери на местные сопротивления»): чугун, а/ц, пластик,
   PEX, PEX-AL-PEX, ж/б, стеклопластик, стекло. Блок есть только на стальных страницах
   (frmtablII11 / frmtablII2: Frame4 «Выбор системы» + Option5/6 «холодного/горячего
   водоснабжения» + Label21 «t=» «°C» + Check2 «учесть потери на местные сопротивления»). */
"use strict";

/* ─── печать чисел: как rtcRound(x,n) в программе, разделитель — запятая ─── */
function fmt(x,n){
 if(x!==0 && Math.abs(x)<Math.pow(10,-n)){
   // малые значения: добавляем знаки, чтобы не округлять до 0 (BUG-7)
   let s=x.toFixed(n+8).replace(/0+$/,'').replace(/\.$/,'');
   return s.replace('.',',');
 }
 return (Math.round(x*Math.pow(10,n))/Math.pow(10,n)).toString().replace('.',',');
}
function fmt2(x){return x.toFixed(2).replace('.',',');}
// R и ΔP — ровно 3 знака, хвостовые нули НЕ отбрасываются (запрос 08.10.2026: «2,010 так и пиши»)
function fmt3(x){return x.toFixed(3).replace('.',',');}

/* ─── расход → м³/с (л/с и м³/ч — как Option1/Option2 в окне программы) ─── */
function qToM3s(q,unit){ return unit==='mh' ? q/3600 : q/1000 }

/* ─── скорость: v = Q/(π·dp²/4). Только Q и dp. ─── */
function velocity(q_m3s,dp_mm){ const d=dp_mm/1000; return q_m3s/(Math.PI*d*d/4) }

/* ─── удельные потери (уклон): i = A·v²/dp^e, A ≡ λ/(2g); формулы — formulas.js ─── */
function gradient(mat,wear,v,dp_mm){
 const d=dp_mm/1000; const {A,e}=iCalc(wear,mat,v,d);
 return {A,e,i:A*v*v/Math.pow(d,e)};
}
/* ─── R = ρ·g·i (Па/м) и H = i·L·(1+k) (м) ─── */
function pressure(i,rho){ return i*(rho||RHO_FIX)*G }
function head(i,L,k){ return i*L*(1+(k||0)) }

/* ─── значения теплоносителя по умолчанию: вода 10 °C, как в программе ─── */
const NU_FIX=1.3e-6, RHO_FIX=1000;

/* ─── какие страницы не используют режим/теплоноситель/местные сопротивления ───
   usesSys() true только для steel и steel-es (там в окне есть «Выбор системы», t и k).
   usesWear() — где есть «новые/неновые»: строки «новые»/«неновые» в EXE лежат только в
   шаблонах frmtablII11 (сталь), frmtablII2 (э/с) и frmtablII3 (чугун). */
const NO_SYS=['ci','asbes','plastic','pex','metal-pex','conc','grp','glass','copper'];
const NO_WEAR=['asbes','plastic','pex','metal-pex','conc','grp','glass','copper'];
function matOf(id){ return MATERIALS.find(m=>m.id===id) }
function usesSys(mat){ return !NO_SYS.includes(mat) }
function usesWear(mat){ return !NO_WEAR.includes(mat) }
function usesK(mat){ return usesSys(mat) }   // k ≡ 0 и H = i·L там, где нет местных сопротивлений

/* ─── предупреждения по скорости ───
   чугун (FUN_004ae2c0): «Большая скорость! Рекомендуется увеличить диаметр» / «Малая скорость!
   Рекомендуется уменьшить диаметр», пороги по диаметру 0,8…2 / 1…3 / 1,5…4 (границы 200/800
   подтверждены живой программой 05.10.2026);
   сталь/э/с (FUN_0047e8d0, FUN_004a22c0): «Внимание! Скорость больше 3 м/с…» и «…10 м/с…»;
   в клоне пороги берутся из режима (VEL_LIMIT), пороги 3/10 в EXE зафиксированы, режим задаёт k.
   а/ц, пластик, PEX, ж/б, стеклопластик, стекло (FUN_0050a140, FUN_0050daf0 и др.): строк
   предупреждения в функции расчёта НЕТ — их нет и в клоне. */
function ciLimits(dv_mm){ return dv_mm<=200?[0.8,2]:(dv_mm<800?[1,3]:[1.5,4]) }
function speedNotes(mat,dv_mm,v,mode){
 const m=matOf(mat), out=[];
 if(m&&m.cls){ const [lo,hi]=ciLimits(dv_mm);
  if(v>hi) out.push({cls:'warn',text:'Большая скорость! Рекомендуется увеличить диаметр'});
  if(v<lo) out.push({cls:'warn',text:'Малая скорость! Рекомендуется уменьшить диаметр'});
  return out; }
 if(!usesSys(mat)) return out;
 const lim=VEL_LIMIT[mode]||VEL_LIMIT.potable; // защита от пустого mode
 if(v>lim[1]) out.push({cls:'warn',text:`Внимание! Скорость больше ${lim[1]} м/с, рекомендуется увеличить диаметр`});
 if(v<lim[0]) out.push({cls:'warn',text:'Малая скорость! Рекомендуется уменьшить диаметр'});
 return out;
}

/* ─── строка рекомендации (ряды ECON_ROWS; подписи строк в EXE 0x44fd4..0x47434) ───
   opt = минимальный ряд с v(dp) ≤ VREC; sel==opt → «экономически обосновано», иначе →
   «рекомендуется использовать трубу …». dpOf(d) замыкает ui.js: расчётный dp ряда зависит от
   стенки (газовые/э/с), класса и «неновые» (чугун), SDR (ПЭ). */
function recommendation(mat,wear,q_m3s,selD,dpOf){
 const m=matOf(mat), rows=ECON_ROWS[mat];
 if(!rows) return null;
 const qls=q_m3s*1000, m3=q_m3s*3600;
 const vrow=d=>{const dp=dpOf(d); if(isNaN(dp)) return NaN; return velocity(q_m3s,dp);};
 let opt=null; for(const d of rows){ const v2=vrow(d); if(!isNaN(v2)&&v2<=VREC){opt=d;break;} }
 if(opt===null&&m&&m.id!=='steel'&&m.id!=='conc') opt=rows[rows.length-1]; // чугун/пластик: кламп к максимуму
 const word=(m&&m.pe)?'диаметром':'с условным проходом';
 if(opt===null) return {cls:'warn',text:m&&m.id==='steel'
   ?`Большая скорость! При расходе ${fmt2(qls)} л/сек = ${fmt2(m3)} м куб/ч рекомендуется использовать трубу с диаметром более 500мм`
   :`Большая скорость! Рекомендуется использовать трубу с условным проходом более 1600мм`};
 if(opt===selD) return {cls:'ok',text:`Применение трубы ${word} ${opt}мм при расходе ${fmt2(qls)} л/сек = ${fmt2(m3)} м куб/ч экономически обосновано`};
 return {cls:'warn',text:`При расходе ${fmt2(qls)} л/сек = ${fmt2(m3)} м куб/ч рекомендуется использовать трубу ${word} ${opt}мм`};
}

/* ─── медные трубы (frmtablII9, СП 40-108-2004): отдельная ветка движка ───
    inp.cuSys: cold|circ|supply|heat (Option1…4); inp.xiSum — Σξ из Frame6; inp.cool — вода/другой;
    inp.cuNu/inp.cuRho — ν и ρ (для «вода» ui.js подставляет их по температуре из Combo3).
    Модель программы (FUN_00515500):
      cold/circ → i по (2); supply → i по (3); heat → R по (5)–(9), i = R/(ρ·g)
      R = ρ·g·i, g = 9,80665 (на этой странице — не 9,81: @0x5191ea/0x51a7a4/0x51a8be)
      H = i·L + V²·Σξ/(2g), 2g = 19,62 (DAT_004011d8 @0x51a4c8) — ξ входит ОТДЕЛЬНЫМ слагаемым,
          не через k
      ΔP = R·L + Z, Z = 0,5·ρ·V²·Σξ (СП 40-108-2004 (10), (3.4.4)) */
function copperCalc(inp){
 const m=matOf('copper'); if(!m) return {ok:false,error:'материал не найден'};
 const sys=['cold','circ','supply','heat'].includes(inp.cuSys)?inp.cuSys:'cold';
 const S=m.cuSys[sys];
 const qraw=inp.q;
 if(isNaN(qraw)) return {ok:false,error:'ошибка ввода — введите значение расхода'};
 if(qraw<0) return {ok:false,error:'расход не должен быть отрицательным!'};
 if(qraw===0) return {ok:false,error:'расход не должен равняться нулю! введите значение расхода'};
 const dv=inp.dv_mm;
 if(isNaN(dv)) return {ok:false,error:'ошибка ввода — Введите значение диаметра в мм'};
 if(dv<=0) return {ok:false,error:'диаметр не может равняться нулю! Введите значение диаметра в мм'};
 const L=inp.L;
 if(isNaN(L)) return {ok:false,error:'введите значение длины участка в м'};
 if(L<0) return {ok:false,error:'Длина участка не может быть отрицательным!'};
 if(L===0) return {ok:false,error:'Длина участка не может равняться нулю! введите значение длины участка в м'};
 let nu=inp.cuNu, rho=inp.cuRho;
 if(sys==='cold'){
  // Option1 «холодного водоснабжения»: Frame4 «Температура» и Frame5 «Теплоноситель» неактивны —
  // вода со стандартными ν=1,3·10⁻⁶ (DAT_00402448) и ρ=1000
  nu=NU_FIX; rho=RHO_FIX;
 } else {
  if((sys==='circ'||sys==='supply') && isNaN(inp.t))
   return {ok:false,error:'Вы не ввели температуру! Для систем горячего водоснабжения рекомендуется t=60°С. Введите значение температуры, в °С'};
  // Option2/3 (циркуляционный и подающий ГВС): активен только Frame4 — ν и ρ берутся по t,
  // ручной теплоноситель недоступен. Frame5 «Теплоноситель» («вода/другой», Text3 ν, Text18 ρ)
  // активен только при Option4 «системы отопления».
  if(sys==='heat' && inp.cool==='other'){
   if(isNaN(nu)) return {ok:false,error:'Вы не ввели значение коэффициента кинематической вязкости теплоностеля'};
   if(isNaN(rho)||rho<=0) return {ok:false,error:'Вы не ввели значение плотности теплоностеля!'};
  }
 }
 if(isNaN(nu)) nu=NU_FIX;                 // t<50 или t не выбран: ν = 1,3·10⁻⁶ (DAT_00402448 @0x5166da)
 if(isNaN(rho)||rho<=0) rho=RHO_FIX;
 const q=qToM3s(qraw,inp.qunit), d=dv/1000, v=velocity(q,dv);
 let i,R;
 if(S.f===2){ i=cuI2(nu,v,d); R=i*rho*CU.GC }
 else if(S.f===3){ i=cuI3(nu,v,d); R=i*rho*CU.GC }
 else { R=cuR5(nu,v,d); i=R/(rho*CU.GC) }
 const xi=isNaN(inp.xiSum)?0:inp.xiSum;
 const H=i*L + v*v*xi/CU.G2;
 const Z=0.5*rho*v*v*xi;
 const P=R*L+Z;
 const lines=[`Скорость v = ${fmt(v,3)} м/с`];
 if(S.f===5) lines.push(`удельные потери давления R = ${fmt3(R)} Па/м`);
 else lines.push(`i = ${fmt(i,3)} м/м  (1000i = ${fmt(i*1000,3)} мм/м)`,
                 `удельные потери давления R = ${fmt3(R)} Па/м`);
 // оригинал печатает «Потери напора на участке H=… м» и «Потери давления на участке … Па»;
 // слагаемое ξ показано явно (в меди местные сопротивления НЕ через k): H = i·L + V²Σξ/(2g)
 const outH=[`Потери напора на участке H = i·L + V²Σξ/2g = ${fmt3(H)} м`, `потери давления = ${fmt3(P)} Па`];
 if(S.f===5) outH.push(`Падение давления в системе отопления = ${fmt3(P)} Па`);
 const notes=[];
 if(v>S.lim){ notes.push({cls:'warn',text:'Большая скорость! Рекомендуется увеличить диаметр'});
              notes.push({cls:'warn',text:S.note}); }
 return {ok:true,q,qunit:inp.qunit,v,i,i1000:i*1000,R,H,P,Z,xi,dv_mm:dv,L,rho,nu,sys,
   hLegend:'Потери напора на участке, м',lines,outH,notes};
}

/* ─── PEX (frmtablII10, СП 41-109-2005): отдельная ветка движка ───
    inp.cuSys: cold|hot|heat (Option1/Option2/Option3 Frame2 «Выбор системы»);
    inp.xiSum — Σξ из Frame6; inp.cool — «вода»/«другой»; inp.cuNu/inp.cuRho — ν и ρ.
    Модель программы (FUN_00526810): i = λV²/(2·9,81·d) (Variant 9,81 @0x528e10,
    VarPow v² @0x528e2e, VarDiv @0x528e7b), λ — (4) СП 41-109 с Кэ = 10⁻⁶;
    R = λV²/(2d)·10³ Па/м (картинка x024, печать «удельные потери давления R=» 0x447c40 @0x529050);
    H = i·L + V²Σξ/19,62 (fld [0x4011d8]=19,62 @0x52a5b9, VarPow @0x52a639, VarAdd @0x52a66d);
    ΔP = R·L + Z, Z = 0,5ρV²Σξ (9,80665 @0x529064/0x52a7bc).
    ν(t) — табл. 2 СП 41-109 (цепочки 0x527a13…0x5281b7), по умолчанию 1,3·10⁻⁶ (@0x528842).
    Лимиты скорости: 4 (Option1 @0x52a97b), 3 (Option2 @0x52acb7), 2 (Option3, текст 0x4483b0). */
function pexCalc(inp){
 const m=matOf('pex'); if(!m) return {ok:false,error:'материал не найден'};
 const sys=['cold','hot','heat'].includes(inp.cuSys)?inp.cuSys:'cold';
 const S=m.pexSys[sys];
 const qraw=inp.q;
 if(isNaN(qraw)) return {ok:false,error:'ошибка ввода — введите значение расхода'};
 if(qraw<0) return {ok:false,error:'расход не должен быть отрицательным!'};
 if(qraw===0) return {ok:false,error:'расход не должен равняться нулю! введите значение расхода'};
 const dv=inp.dv_mm;
 if(isNaN(dv)) return {ok:false,error:'ошибка ввода — Введите значение диаметра в мм'};
 if(dv<=0) return {ok:false,error:'диаметр не может равняться нулю! Введите значение диаметра в мм'};
 const L=inp.L;
 if(isNaN(L)) return {ok:false,error:'введите значение длины участка в м'};
 if(L<0) return {ok:false,error:'Длина участка не может быть отрицательным!'};
 if(L===0) return {ok:false,error:'Длина участка не может равняться нулю! введите значение длины участка в м'};
 let nu=inp.cuNu, rho=inp.cuRho;
 if(sys==='cold'){ nu=NU_FIX; rho=RHO_FIX; }        // Option1: блоки «Температура»/«Теплоноситель» неактивны
 else {
  if(sys==='hot' && isNaN(inp.t)) return {ok:false,error:'Вы не ввели температуру! Для систем горячего водоснабжения рекомендуется t=60°С. Введите значение температуры, в °С'};
  if(sys==='heat' && inp.cool==='other'){
   if(isNaN(nu)) return {ok:false,error:'Вы не ввели значение коэффициента кинематической вязкости теплоностеля'};
   if(isNaN(rho)||rho<=0) return {ok:false,error:'Вы не ввели значение плотности теплоностеля!'};
  }
 }
 if(isNaN(nu)) nu=NU_FIX;
 if(isNaN(rho)||rho<=0) rho=RHO_FIX;
 const q=qToM3s(qraw,inp.qunit), d=dv/1000, v=velocity(q,dv);
 const lam=inp.pexSp?pexLambdaSP(nu,v,d):pexLambda(nu,v,d); // галка «по СП» = формула (4) с L
 const i=lam*v*v/(2*9.81*d);                        // Variant 9,81 @0x528e10
 const R=lam*v*v/(2*d)*CU.K1000;                    // λV²/(2d)·10³, Па/м
 const xi=isNaN(inp.xiSum)?0:inp.xiSum;
 const H=i*L + v*v*xi/CU.G2;
 const Z=0.5*rho*v*v*xi;
 const P=R*L+Z;
 // Вывод зависит от системы: ХВС/ГВС — уклон i (м/м); «отопление» — удельные потери R (Па/м).
 // Потери напора H (м) печатаются ВСЕГДА (в т.ч. для «отопления»), чтобы блок «Потери напора на
 // участке, м» в заголовке соответствовал содержимому; в оригинале для «отопления» H не печатался.
 // ΔP — «Потери давления на участке» (Па); R печатается до 3 знаков с отбрасыванием хвостовых нулей
 // (живые скрины 08.10.2026: 525,819 · 326,02 · 32602,001).
 const lines=[`Скорость v = ${fmt(v,3)} м/с`];
 const outH=[]; const HLINE=`Потери напора на участке H = i·L + V²Σξ/2g = ${fmt(H,3)} м`;
 if(sys==='heat'){
  lines.push(`R = ${fmt3(R)} Па/м`);
  outH.push(HLINE, `Потери давления на участке ${fmt3(P)} Па`);
 } else {
  lines.push(`i = ${fmt(i,3)} м/м`, `удельные потери давления R = ${fmt3(R)} Па/м`);
  outH.push(HLINE, `потери давления = ${fmt(P,0)} Па`);
 }
 const notes=[];
 if(v>S.lim){ notes.push({cls:'warn',text:'Большая скорость! Рекомендуется увеличить диаметр'});
              notes.push({cls:'warn',text:S.note}); }
 return {ok:true,q,qunit:inp.qunit,v,i,i1000:i*1000,R,H,P,Z,xi,dv_mm:dv,L,rho,nu,sys,
   hLegend:'Потери напора на участке, м',lines,outH,notes};
}

/* ─── главный вход движка: вход — числа, выход — объект; DOM не трогает ───
   inp = {mat, wear, dv_mm, q, qunit, L, k, mest, nu, rho, mode, selD, dpOf}
   dpOf(d) нужен только материалам с рядом рекомендации (сталь, э/с, чугун, пластик). */
function shevCalc(inp){
 const mat=inp.mat, sys=usesSys(mat), kused=usesK(mat);
 if(mat==='copper') return copperCalc(inp);   // свои формулы (2)/(3)/(5)–(9), ν/ρ по t, ξ-редактор
 if(mat==='pex') return pexCalc(inp);          // λ-семейство СП 41-109 (Кэ=10⁻⁶), ν/ρ по t, ξ-редактор
 const qraw=inp.q;
 if(isNaN(qraw)) return {ok:false,error:'ошибка ввода — введите значение расхода'};
 if(qraw<0) return {ok:false,error:'расход не должен быть отрицательным!'};
 if(qraw===0) return {ok:false,error:'расход не должен равняться нулю!'};
 const dv=inp.dv_mm;
 if(isNaN(dv)||dv<=0) return {ok:false,error:'диаметр не может равняться нулю!'};
 const L=inp.L;
 if(isNaN(L)) return {ok:false,error:'введите значение длины участка в м'};
 if(L<0) return {ok:false,error:'Длина участка не может быть отрицательным!'};
 if(L===0) return {ok:false,error:'Длина участка не может равняться нулю!'};
 let k=kused?((isNaN(inp.k)?0:inp.k)||0):0;
 if(kused){
  if(k<0) return {ok:false,error:'коэффициент местных сопротивлений k не может быть отрицательным!'};
  if(!inp.mest) k=0; // «учесть потери на местные сопротивления» выключен — k не применяется
 }
 if(sys && isNaN(inp.nu)) return {ok:false,error:'Вы не ввели значение коэффициента кинематической вязкости теплоносителя!'};
 // на страницах без блока «теплоноситель» ρ фиксирована (1000, t=10 °C) — поле UI не участвует
 const rho=sys?((!isNaN(inp.rho)&&inp.rho>0)?inp.rho:RHO_FIX):RHO_FIX;

 const q=qToM3s(qraw,inp.qunit);
 const v=velocity(q,dv);
 const {A,e,i}=gradient(mat,inp.wear,v,dv);
 const R=pressure(i,rho), H=head(i,L,k), P=R*L*(1+k);

 const lines=[
  `Скорость v = ${fmt(v,3)} м/с`,
  // 1000i — как в программе: rtcRound(1000·i,3) без лишних нулей (FUN_0047e8d0, FUN_004a22c0,
  // FUN_004ae2c0, FUN_0050a140, FUN_0050daf0); скрин стеклопластика 43,344; ж/б 0,151
  `i = ${fmt(i*1000,3)} мм/м  (1000i = ${fmt(i*1000,3)})`,
  `удельные потери давления R = ${fmt(R,1)} Па/м`,
 ];
 // блок «Потери напора…» — как в программе: где местных сопротивлений нет (kused=false) —
 // «по длине», H = i·L, строки k нет; где есть — «на участке», H = i·L·(1+k) и строка k
 const outH=(kused?[`k = ${fmt(k,2)}`]:[]).concat([
  `Потери напора ${kused?'на участке':'по длине'} H = i·L${kused?'·(1+k)':''} = ${fmt(H,3)} м`,
  `потери давления = ${fmt(P,0)} Па`]);
 const notes=speedNotes(mat,dv,v,inp.mode);
 const rec=recommendation(mat,inp.wear,q,inp.selD,inp.dpOf||(()=>NaN));
 if(rec) notes.push(rec);
 return {ok:true,q,qunit:inp.qunit,v,i,i1000:i*1000,A,e,R,H,P,k,dv_mm:dv,L,rho,
   hLegend:kused?'Потери напора на участке, м':'Потери напора по длине, м',
   lines,outH,notes};
}

/* экспорт для node-тестов (в браузере window есть, в node — global) */
if (typeof module!=='undefined' && module.exports){
 module.exports={fmt,fmt2,qToM3s,velocity,gradient,pressure,head,NU_FIX,RHO_FIX,copperCalc,pexCalc,
   NO_SYS,NO_WEAR,matOf,usesSys,usesWear,usesK,ciLimits,speedNotes,recommendation,shevCalc};
}
