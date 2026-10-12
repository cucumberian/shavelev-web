/* js/help.js — реестр и отрисовка раздела «Расчёты» справки.
   Каждая страница описывает свои формулы в своём файле js/help/<id>.js:
     registerHelp('<id>', { title, intro:[…html], formulas:[{h,s,t,step,note,p}], outro:[…html], step(kind) });
   где h — заголовок (считаемый параметр), s — документ + номер формулы, t — формула в LaTeX,
   step — ключ шага, note — метаданные, p — список параметров; step(kind) — функция страницы,
   возвращающая строку «= <числа> = <результат с единицами>» для этого шага.
   Если у страницы своей функции step нет, строка подстановки не печатается. */
"use strict";

const HELP_PAGES={};
function registerHelp(id,page){ HELP_PAGES[id]=page; }

/* Дробь для «печатного» вида формул (офлайн: чистый CSS, без KaTeX/MathJax). Стоит здесь, а не в
   ui.js, потому что её читатели — только файлы справок js/help/<id>.js (7 страниц из 11). */
const fr=(n,d)=>`<span class="frac"><span class="fnum">${n}</span><span class="fden">${d}</span></span>`;

/* Текстовые поля (заголовки, цитаты, пометки, расшифровки) печатаются как HTML,
   поэтому LaTeX-записи в них приводятся к HTML одним общим преобразователем. */
function helpText(s){
 if(s==null) return "";
 let x=String(s);
 x=x.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g,"$1/$2");
 x=x.replace(/\\sqrt\{\\lambda\}/g,"√λ").replace(/\\sqrt\{([^{}]*)\}/g,"√($1)");
 x=x.replace(/\\text\{([^{}]*)\}/g,"$1");
 x=x.replace(/_\{([^{}]*)\}/g,"<sub>$1</sub>");
 x=x.replace(/\\lg\b/g,"lg").replace(/\\ln\b/g,"ln");
 x=x.replace(/\\cdot\b/g,"·").replace(/\\Delta\b/g,"Δ").replace(/\\nu\b/g,"ν").replace(/\\rho\b/g,"ρ");
 x=x.replace(/\\lambda\b/g,"λ").replace(/\\xi\b/g,"ξ").replace(/\\alpha\b/g,"α").replace(/\\pi\b/g,"π");
 x=x.replace(/\\le\b/g,"≤").replace(/\\ge\b/g,"≥");
 x=x.replace(/\\left|\\right|\\Big|\\big/g,"");
 x=x.replace(/\\[;,!]/g,"").replace(/\\ /g," ");
 x=x.replace(/10\^\{-6\}/g,"10⁻⁶").replace(/10\^\{-5\}/g,"10⁻⁵").replace(/10\^\{3\}/g,"10³");
 x=x.replace(/\^\{([^{}]*)\}/g,"<sup>$1</sup>");
 return x;
}
/* Общий пайплайн подстановки: страница возвращает данные, строку собирает ТОЛЬКО эта функция.
   step(kind) может вернуть: {sub,res,note} — подстановка/результат/пометка, ЛИБО строку (старый вид).
   Формат строки один для всех справок: «= <подстановка>… = <b>результат</b> <пометка>». */
function helpStepHtml(pg,kind){
 let out = pg.step ? pg.step(kind) : "";
 if(!out) return "";
 if(typeof out==="string") return out;
 let s="";
 if(out.sub!=null && out.sub!=="") s+=" = "+tex(out.sub);
 if(out.res!=null && out.res!=="") s+=" = <b>"+helpText(out.res)+"</b>";
 if(out.note) s+=" <span class=\"fParam\">"+helpText(out.note)+"</span>";
 return s;
}

function renderCalcHelp(id){
 const pg=HELP_PAGES[id]; if(!pg) return "";
 let h=pg.title?("<b>"+pg.title+"</b><hr>"):"";
 h+=(pg.intro||[]).map(helpText).join("");
 for(const f of (pg.formulas||[])){
  let st="";
  if(f.step){
   st=helpStepHtml(pg,f.step);
   if(!st) st=" <span class=\"fNote\">расчёт не ведётся — введите исходные данные и нажмите «Рассчитать»</span>";
  }
   // «лёгкие» формулы: по ним расчёт не ведётся (справочная/книжная запись) — приглушаем блок целиком
   const off=/расчёт не ведётся|информационная запись/.test(f.note||"");
   h+="<div class=\"fBlock"+(off?" fUnused":"")+"\">";
  h+="<div class=\"fHead\">"+helpText(f.h)+"</div>";
  h+="<span class=\"fSrc\">"+helpText(f.s)+"</span>";   // где формула (документ + номер) — своей строкой
  h+="<span class=\"fLine\">"+tex(f.t)+st+"</span>";  // сама формула = подстановка = результат
  h+="<span class=\"fLegend\">"+(f.note?"<span class=\"fParam\">"+helpText(f.note)+"</span>":"")+
     ((f.p||[]).map(x=>"<span class=\"fParam\">"+helpText(x)+"</span>").join(""))+"</span>";
   h+="</div>";
 }
 h+=(pg.outro||[]).map(helpText).join("");
 return h;
}

if (typeof module!=="undefined" && module.exports){ module.exports={HELP_PAGES,registerHelp,renderCalcHelp,helpStepHtml,helpText,fr}; }
