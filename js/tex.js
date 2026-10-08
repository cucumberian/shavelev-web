/* js/tex.js — крошечный рендер LaTeX в HTML для раздела «Расчёты» справки.
   Без внешних библиотек и CDN: клон обязан работать из file://. Поддержано то, что нужно
   формулам СП: \frac, \sqrt, ^{}, _{}, греческие буквы, \cdot, \lg, \Sigma, \Delta и знаки сравнения. */
"use strict";
const TEX_SYM={lambda:'λ',nu:'ν',rho:'ρ',mu:'μ',Delta:'Δ',delta:'δ',xi:'ξ',pi:'π',Sigma:'Σ',sum:'Σ',
  sigma:'σ',eta:'η',epsilon:'ε',tau:'τ',varphi:'φ',phi:'φ',ell:'ℓ',cdot:'·',times:'×',le:'≤',ge:'≥',
  approx:'≈',ne:'≠',pm:'±',lg:'lg',ln:'ln',sin:'sin',cos:'cos',tan:'tan',exp:'exp',max:'max',min:'min',
  to:'→',Rightarrow:'⇒',quad:' ',qquad:'  '};
function texEsc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
/* tex(src) → HTML; рекурсивный разбор групп {…} без полного парсера LaTeX */
function tex(src){
 const s=String(src==null?'':src);
 /* KaTeX, если подключён (vendor/katex): настоящий LaTeX; иначе — встроенный мини-рендер */
 if(typeof katex!=='undefined' && katex && katex.renderToString){
  try{ return katex.renderToString(s,{throwOnError:false,display:false,output:'html'}); }catch(e){}
 }
 return texNode(s);
}
function texGroup(s,i){ // возвращает [содержимое, индекс после закрывающей скобки]
  let d=0,out='',j=i;
  for(;j<s.length;j++){const c=s[j];
   if(c==='{'){d++; if(d===1) continue;}
   else if(c==='}'){d--; if(d===0){j++; break;}}
   out+=c;}
  return [out,j];
}
function texNode(s){
  let out='',i=0;
  while(i<s.length){
   const c=s[i];
   if(c==='\\'){
    const m=/^\\([A-Za-z]+)/.exec(s.slice(i));
    if(m){const name=m[1]; i+=m[0].length;
     if(name==='frac'){const [a,i2]=texGroup(s,i); const [b,i3]=texGroup(s,i2); i=i3;
      out+='<span class="tex-frac"><span class="tex-num">'+texNode(a)+'</span><span class="tex-den">'+texNode(b)+'</span></span>'; continue;}
     if(name==='sqrt'){const [a,i2]=texGroup(s,i); i=i2;
      out+='<span class="tex-sqrt">√<span class="tex-rad">'+texNode(a)+'</span></span>'; continue;}
     if(name==='text'||name==='mathrm'){const [a,i2]=texGroup(s,i); i=i2; out+=texEsc(a); continue;}
     if(name==='left'||name==='right'){continue;}
     if(/^(Bigg?|bigg?|Bigl|Bigr|bigl|bigr|biggl|biggr)$/.test(name)){continue;} // \Big/ \big( и т.п. — размер скобки
     out+=TEX_SYM[name]!==undefined?TEX_SYM[name]:texEsc(name); continue;}
    i++; out+=' '; continue;}
   if(c==='^'||c==='_'){
    const tag=c==='^'?'sup':'sub'; let arg='',i2=i+1;
    if(s[i2]==='{'){const r=texGroup(s,i2); arg=r[0]; i2=r[1];} else {arg=s[i2]||''; i2++;}
    i=i2; out+='<'+tag+'>'+texNode(arg)+'</'+tag+'>'; continue;}
   if(c==='{'){const r=texGroup(s,i); out+=texNode(r[0]); i=r[1]; continue;}
   if(c==='}'){i++; continue;}
   out+=texEsc(c); i++;
  }
  return out;
}
if (typeof module!=='undefined' && module.exports){ module.exports={tex}; }
