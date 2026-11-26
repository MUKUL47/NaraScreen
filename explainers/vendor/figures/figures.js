/*! figures.js v0.1.0 | MIT License | https://github.com/cherifya/figures
 * Expressive, deterministic stick-figure animation in pure SVG.
 * Every frame is a pure function of time: FIGURES.svg(spec, t) -> SVG markup for time t (seconds).
 * That makes renders frame-exact and trivially parallel (split a video into chunks, render each anywhere).
 *
 * Engine: angle-based skeletal rig with 2-bone IK, distance-driven walk/run cycles with planted feet,
 * damped-spring transitions with anticipation and squash/stretch, follow-through, idle breathing and sway,
 * seeded blinks, gaze toward the nearest character, blendable parametric faces, automatic emotion marks,
 * hand-drawn line boil on twos, ground shadows, dust puffs and a gentle camera drift.
 *
 * Pose library, props and effects derived from stix by Bassime Ledath (MIT): https://github.com/bassimeledath/stix
 */
(function(root){

const INK='#2b2117', PAPER='#efe3c6', RED='#a8322d', GOLD='#c08a2e', BLUE='#4f7fa3', GREY='#8a7f6c';
const cl=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const eio=x=>{x=cl(x);return x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2};
const eo=x=>1-Math.pow(1-cl(x),3);
const lerp=(a,b,u)=>a+(b-a)*u;
const f1=v=>Math.round(v*10)/10;

// ---------- pose library (stix library/poses.md, hip at 0,0; y up is negative) ----------
// each pose: neck, head, la/ra = [elbow, hand], ll/rl = [knee, foot]
const B={neck:[0,-42],head:[0,-60],la:[[-18,-17],[-20,0]],ra:[[18,-17],[20,0]],ll:[[-15,35],[-20,53]],rl:[[15,35],[20,53]]};
const mk=o=>Object.assign(JSON.parse(JSON.stringify(B)),o);
const POSES={
 standing:mk({}),
 walk_a:mk({la:[[-12,-18],[-5,-5]],ra:[[15,-22],[22,-12]],ll:[[-18,28],[-22,50]],rl:[[12,32],[8,53]]}),
 walk_b:mk({la:[[-15,-22],[-22,-12]],ra:[[12,-18],[5,-5]],ll:[[12,32],[8,53]].map(p=>[-p[0],p[1]]),rl:[[18,28],[22,50]]}),
 run_a:mk({neck:[5,-41],head:[8,-59],la:[[-15,-32],[-10,-22]],ra:[[22,-30],[18,-20]],ll:[[-22,22],[-28,45]],rl:[[15,25],[22,48]]}),
 run_b:mk({neck:[5,-41],head:[8,-59],la:[[-22,-30],[-18,-20]],ra:[[15,-32],[10,-22]],ll:[[-15,25],[-22,48]],rl:[[22,22],[28,45]]}),
 sitting:mk({la:[[-14,-17],[2,-4]],ra:[[16,-17],[22,-4]],ll:[[-22,2],[-24,30]],rl:[[24,2],[24,30]]}),
 sit_write:mk({la:[[-10,-18],[8,-8]],ra:[[22,-22],[36,-14]],ll:[[-22,2],[-24,30]],rl:[[24,2],[24,30]]}),
 arms_raised:mk({la:[[-10,-65],[-8,-80]],ra:[[10,-65],[8,-80]]}),
 cheer:mk({la:[[-22,-58],[-30,-76]],ra:[[22,-58],[30,-76]]}),
 waving:mk({ra:[[18,-55],[28,-60]]}),
 reaching:mk({ra:[[30,-25],[45,-20]]}),
 pointing:mk({ra:[[26,-46],[50,-58]]}),
 point_fwd:mk({ra:[[28,-36],[54,-38]]}),
 holding:mk({la:[[12,-24],[26,-26]],ra:[[18,-22],[30,-24]]}),
 hold_up:mk({la:[[14,-40],[24,-56]],ra:[[20,-40],[30,-58]]}),
 present:mk({la:[[20,-28],[38,-32]],ra:[[22,-24],[42,-28]]}),
 arms_crossed:mk({la:[[14,-26],[-10,-24]],ra:[[-12,-28],[10,-25]]}),
 hands_hips:mk({la:[[-24,-22],[-10,-6]],ra:[[24,-22],[10,-6]]}),
 facepalm:mk({ra:[[16,-38],[6,-56]],head:[2,-59]}),
 think:mk({ra:[[16,-26],[6,-46]]}),
 shrug:mk({la:[[-22,-30],[-32,-42]],ra:[[22,-30],[32,-42]]}),
 thumbs_up:mk({ra:[[22,-30],[24,-50]]}),
 pat:mk({ra:[[24,-42],[44,-44]]}),
 pat_low:mk({ra:[[24,-38],[44,-40]]}),
 sneak:mk({ra:[[22,-14],[42,-4]],la:[[-18,-17],[-20,0]]}),
 grab:mk({neck:[4,-41],head:[6,-59],ra:[[26,-38],[46,-40]],la:[[22,-28],[42,-30]]}),
 whisper:mk({neck:[7,-41],head:[11,-58],ra:[[16,-30],[16,-50]]}),
 bow:mk({neck:[16,-38],head:[28,-50],la:[[6,-22],[10,-6]],ra:[[22,-22],[26,-6]]}),
 kneel:mk({neck:[0,-42],ll:[[-20,22],[-38,30]],rl:[[16,30],[14,53]]}),
 slump:mk({neck:[6,-40],head:[12,-55],la:[[-12,-18],[-12,-2]],ra:[[18,-18],[18,-2]]}),
 dagger:mk({ra:[[14,-56],[20,-72]]}),
 telescope:mk({la:[[16,-34],[30,-46]],ra:[[18,-30],[30,-40]]}),
 handshake:mk({ra:[[24,-26],[40,-24]]}),
 sign:mk({la:[[-10,-18],[8,-8]],ra:[[22,-22],[38,-12]],ll:[[-22,2],[-24,30]],rl:[[24,2],[24,30]]}),
 lying:{neck:[-42,0],head:[-60,0],la:[[-40,14],[-34,24]],ra:[[-6,14],[0,24]],ll:[[30,2],[53,0]],rl:[[30,-2],[53,-1]]},
 crouch:mk({neck:[0,-30],head:[0,-48],la:[[-18,-10],[-22,5]],ra:[[18,-10],[22,5]],ll:[[-20,10],[-25,30]],rl:[[20,10],[25,30]]}),
 pat_sneak:mk({ra:[[24,-42],[44,-44]],la:[[16,-14],[40,-2]]}),
 sit_think:mk({ra:[[16,-26],[6,-46]],ll:[[-22,2],[-24,30]],rl:[[24,2],[24,30]]}),
 sit_handshake:mk({ra:[[24,-26],[40,-24]],ll:[[-22,2],[-24,30]],rl:[[24,2],[24,30]]}),
 stride:mk({la:[[-14,-20],[-8,-6]],ra:[[16,-20],[24,-10]],ll:[[-16,30],[-22,52]],rl:[[14,32],[14,53]]}),
};
function lp(a,b,u){const r={};for(const k of ['neck','head'])r[k]=[lerp(a[k][0],b[k][0],u),lerp(a[k][1],b[k][1],u)];
 for(const k of ['la','ra','ll','rl'])r[k]=[0,1].map(j=>[lerp(a[k][j][0],b[k][j][0],u),lerp(a[k][j][1],b[k][j][1],u)]);return r}
const P=n=>POSES[n]||POSES.standing;

// ---------- expressions (stix library/expressions.md, head centre 0,0) ----------
function face(e,c){const E=(r=2)=>`<circle cx="-6" cy="-3" r="${r}" fill="${c}"/><circle cx="6" cy="-3" r="${r}" fill="${c}"/>`;
 const L=(a,b,d,e2,w=1.9)=>`<line x1="${a}" y1="${b}" x2="${d}" y2="${e2}" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`;
 const M=d=>`<path d="${d}" stroke="${c}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
 switch(e){
  case 'happy':return E()+M('M -8 5 Q 0 15 8 5');
  case 'laughing':return M('M -8 -3 Q -6 -6 -4 -3')+M('M 4 -3 Q 6 -6 8 -3')+M('M -10 4 Q 0 18 10 4');
  case 'sad':return E()+L(-9,-7,-3,-6)+L(9,-7,3,-6)+M('M -8 8 Q 0 1 8 8');
  case 'surprised':return E(2.8)+L(-9,-10,-3,-9)+L(9,-10,3,-9)+`<circle cx="0" cy="7" r="4" stroke="${c}" stroke-width="2" fill="none"/>`;
  case 'determined':return E()+L(-9,-6,-3,-7)+L(9,-6,3,-7)+L(-5,5,5,5,2.4);
  case 'angry':return E()+L(-10,-5,-3,-8,2.2)+L(10,-5,3,-8,2.2)+M('M -6 7 Q 0 2 6 7');
  case 'smirk':return E()+L(3,-8,9,-7)+M('M -6 5 Q 0 6 6 2');
  case 'worried':return E()+L(-9,-8,-3,-6)+L(9,-8,3,-6)+M('M -6 6 Q -3 4 0 6 Q 3 8 6 6');
  case 'sleep':return M('M -9 -3 L -3 -3')+M('M 3 -3 L 9 -3')+M('M -4 6 Q 0 8 4 6');
  case 'cold':return E()+L(-9,-7,-3,-6)+L(9,-7,3,-6)+M('M -6 6 L -3 4 L 0 6 L 3 4 L 6 6');
  default:return E()+L(-5,5,5,5,2);
 }}

// ---------- accessories ----------
function hat(look,h,c){let s='';const [hx,hy]=h;
 if(look.includes('wig'))s+=[-1,1].map(d=>[0,1,2].map(k=>`<circle cx="${hx+d*17}" cy="${hy+2+k*9}" r="6.5" fill="${c}" opacity=".85"/>`).join('')).join('');
 if(look.includes('crown'))s+=`<path d="M ${hx-15} ${hy-15} L ${hx-15} ${hy-33} L ${hx-7} ${hy-23} L ${hx} ${hy-36} L ${hx+7} ${hy-23} L ${hx+15} ${hy-33} L ${hx+15} ${hy-15} Z" fill="${GOLD}" stroke="${c}" stroke-width="1.6" stroke-linejoin="round"/>`;
 if(look.includes('cap'))s+=`<path d="M ${hx-17} ${hy-9} Q ${hx} ${hy-34} ${hx+17} ${hy-9} Z" fill="${RED}" stroke="${c}" stroke-width="1.6"/>`;
 if(look.includes('musket'))s+=`<ellipse cx="${hx}" cy="${hy-15}" rx="30" ry="6" fill="${c}"/><path d="M ${hx-13} ${hy-16} Q ${hx} ${hy-36} ${hx+13} ${hy-16} Z" fill="${c}"/><path d="M ${hx+6} ${hy-26} Q ${hx+30} ${hy-48} ${hx+40} ${hy-30}" stroke="${RED}" stroke-width="4" fill="none" stroke-linecap="round"/>`;
 if(look.includes('tophat'))s+=`<rect x="${hx-20}" y="${hy-19}" width="40" height="5" rx="2" fill="${c}"/><rect x="${hx-13}" y="${hy-52}" width="26" height="35" fill="${c}"/>`;
 if(look.includes('beard'))s+=`<path d="M ${hx-15} ${hy+6} Q ${hx} ${hy+30} ${hx+15} ${hy+6}" fill="${c}" opacity=".9"/>`;
 if(look.includes('hair'))s+=`<path d="M ${hx-16} ${hy-2} Q ${hx-20} ${hy-22} ${hx} ${hy-20} Q ${hx+20} ${hy-22} ${hx+16} ${hy-2}" stroke="${c}" stroke-width="3" fill="none"/><path d="M ${hx-16} ${hy} Q ${hx-22} ${hy+16} ${hx-14} ${hy+26}" stroke="${c}" stroke-width="2.4" fill="none"/><path d="M ${hx+16} ${hy} Q ${hx+22} ${hy+16} ${hx+14} ${hy+26}" stroke="${c}" stroke-width="2.4" fill="none"/>`;
 if(look.includes('glasses'))s+=`<circle cx="${hx-6}" cy="${hy-3}" r="5" stroke="${c}" stroke-width="1.6" fill="none"/><circle cx="${hx+6}" cy="${hy-3}" r="5" stroke="${c}" stroke-width="1.6" fill="none"/>`;
 return s}
function held(item,hand,rot,c){if(!item)return '';const [x,y]=hand;const g=b=>`<g transform="translate(${f1(x)} ${f1(y)}) rotate(${f1(rot||0)})">${b}</g>`;
 switch(item){
  case 'mirror':return g(`<line x1="0" y1="0" x2="0" y2="-14" stroke="${c}" stroke-width="3"/><ellipse cx="0" cy="-44" rx="20" ry="30" fill="#dfe9ee" stroke="${GOLD}" stroke-width="5"/><path d="M -8 -58 L 4 -66" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`);
  case 'telescope':return g(`<path d="M -10 6 L 62 -30 L 66 -22 L -6 14 Z" fill="${GOLD}" stroke="${c}" stroke-width="2"/><line x1="0" y1="10" x2="-6" y2="50" stroke="${c}" stroke-width="2"/><line x1="0" y1="10" x2="10" y2="50" stroke="${c}" stroke-width="2"/>`);
  case 'scroll':return g(`<rect x="-4" y="-34" width="34" height="40" fill="#f7efd9" stroke="${c}" stroke-width="2"/><line x1="2" y1="-24" x2="24" y2="-24" stroke="${c}"/><line x1="2" y1="-16" x2="24" y2="-16" stroke="${c}"/><line x1="2" y1="-8" x2="18" y2="-8" stroke="${c}"/><circle cx="-4" cy="-34" r="4" fill="${RED}"/>`);
  case 'dagger':return g(`<path d="M -3 0 L 3 0 L 1 -26 L 0 -32 L -1 -26 Z" fill="#cfd5d8" stroke="${c}" stroke-width="1.4"/><line x1="-8" y1="0" x2="8" y2="0" stroke="${c}" stroke-width="3"/>`);
  case 'pen':return g(`<line x1="0" y1="0" x2="10" y2="-16" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`);
  case 'clipboard':return g(`<rect x="-2" y="-30" width="24" height="32" fill="#f7efd9" stroke="${c}" stroke-width="2"/><line x1="3" y1="-20" x2="17" y2="-20" stroke="${c}"/><line x1="3" y1="-12" x2="17" y2="-12" stroke="${c}"/>`);
  case 'coinbag':return g(`<path d="M -12 0 Q -18 -22 0 -24 Q 18 -22 12 0 Z" fill="${GOLD}" stroke="${c}" stroke-width="2"/><text x="0" y="-6" font-size="14" text-anchor="middle" font-family="Georgia" font-weight="700" fill="${c}">$</text>`);
  case 'crown':return g(`<path d="M -14 0 L -14 -18 L -7 -9 L 0 -22 L 7 -9 L 14 -18 L 14 0 Z" fill="${GOLD}" stroke="${c}" stroke-width="1.6"/>`);
  case 'wallet':return g(`<rect x="-2" y="-12" width="22" height="15" rx="2" fill="#6b4a2b" stroke="${c}" stroke-width="1.6"/>`);
  case 'paper':return g(`<rect x="-2" y="-28" width="26" height="30" fill="#fbf6ea" stroke="${c}" stroke-width="1.8"/><line x1="3" y1="-19" x2="19" y2="-19" stroke="${c}"/><line x1="3" y1="-12" x2="16" y2="-12" stroke="${c}"/>`);
  case 'medal':return g(`<line x1="0" y1="0" x2="0" y2="-10" stroke="${RED}" stroke-width="3"/><circle cx="0" cy="4" r="7" fill="${GOLD}" stroke="${c}" stroke-width="1.5"/>`);
  default:return ADD.it[item]?g(ADD.item(item,rot,c)):''; /* NARASCREEN ADDON HOOK */
 }}

const CARRY=['x','y','s','face','pose','expr','item','irot','glow','op','look','rot','wiggle'];
function norm(keys){if(keys._n)return keys;let prev={s:1,op:1,glow:0,face:1,pose:'standing',expr:'neutral',irot:0,rot:0};
 keys.forEach(k=>{for(const c of CARRY){if(k[c]===undefined&&prev[c]!==undefined)k[c]=prev[c]}prev=k});keys._n=1;return keys}
// ---------- actors: polar rig, springs, anticipation, IK walk cycles, idle life, blinks, gaze, blendable faces, boil ----------
const TAU=Math.PI*2;
const hsh=(a,b=0)=>{const x=Math.sin(a*127.1+b*311.7+a*b*.013)*43758.5453;return x-Math.floor(x)};
const nz=(seed,t)=>{const i=Math.floor(t),f=t-i,u=f*f*(3-2*f);return lerp(hsh(seed,i),hsh(seed,i+1),u)*2-1};
const angd=(a,b)=>{let d=(b-a)%TAU;if(d>Math.PI)d-=TAU;if(d<-Math.PI)d+=TAU;return d};
const pol=(p,q)=>[Math.hypot(q[0]-p[0],q[1]-p[1]),Math.atan2(q[1]-p[1],q[0]-p[0])];
const shOf=n=>[n[0]*37/42,n[1]*37/42];
function toPolar(p){const sh=shOf(p.neck);
 return {sp:pol([0,0],p.neck),hd:pol(p.neck,p.head),la:[pol(sh,p.la[0]),pol(p.la[0],p.la[1])],ra:[pol(sh,p.ra[0]),pol(p.ra[0],p.ra[1])],
  ll:[pol([0,0],p.ll[0]),pol(p.ll[0],p.ll[1])],rl:[pol([0,0],p.rl[0]),pol(p.rl[0],p.rl[1])]}}
const PP={};for(const k in POSES)PP[k]=toPolar(POSES[k]);
const Q=n=>PP[n]||ADD.pp[n]||PP.standing; /* NARASCREEN ADDON HOOK */
const bl=(a,b,u)=>[lerp(a[0],b[0],u),a[1]+angd(a[1],b[1])*u];
const blP=(A,B,u)=>({sp:bl(A.sp,B.sp,u),hd:bl(A.hd,B.hd,u),la:[bl(A.la[0],B.la[0],u),bl(A.la[1],B.la[1],u)],ra:[bl(A.ra[0],B.ra[0],u),bl(A.ra[1],B.ra[1],u)],
 ll:[bl(A.ll[0],B.ll[0],u),bl(A.ll[1],B.ll[1],u)],rl:[bl(A.rl[0],B.rl[0],u),bl(A.rl[1],B.rl[1],u)]});
const cpP=A=>JSON.parse(JSON.stringify(A));
const pt=(o,[L,a])=>[o[0]+L*Math.cos(a),o[1]+L*Math.sin(a)];
function fk(P){const neck=pt([0,0],P.sp),head=pt(neck,P.hd),sh=shOf(neck),le=pt(sh,P.la[0]),re=pt(sh,P.ra[0]),lk=pt([0,0],P.ll[0]),rk=pt([0,0],P.rl[0]);
 return {neck,head,sh,la:[le,pt(le,P.la[1])],ra:[re,pt(re,P.ra[1])],ll:[lk,pt(lk,P.ll[1])],rl:[rk,pt(rk,P.rl[1])]}}
// damped spring (zeta .62, ~8% overshoot) that first reaches 1 at T
const ZE=.62,WD=Math.sqrt(1-ZE*ZE);
function spring(tau,T){if(tau<=0)return 0;const w=2.855/Math.max(T,.05),e=Math.exp(-ZE*w*tau);return 1-e*(Math.cos(w*WD*tau)+(ZE/WD)*Math.sin(w*WD*tau))}
function ik(T,l1,l2){const d=Math.max(1,Math.min(Math.hypot(T[0],T[1]),l1+l2-.01)),a0=Math.atan2(T[1],T[0]);
 const a=Math.acos(cl((l1*l1+d*d-l2*l2)/(2*l1*d),-1,1)),k1=[l1*Math.cos(a0-a),l1*Math.sin(a0-a)],k2=[l1*Math.cos(a0+a),l1*Math.sin(a0+a)];return k1[0]>k2[0]?k1:k2}
// expression parameters: brow (+ angry, - worried), by (brow lift), m (mouth curve), o (open), e (eye open), arc (closed happy eyes), sk (smirk skew), r (eye radius)
const EX={neutral:{brow:0,by:0,m:.1,o:0,e:1,arc:0,sk:0,r:2},happy:{brow:-.1,by:-1,m:.95,o:0,e:1,arc:0,sk:0,r:2},laughing:{brow:-.2,by:-2,m:1,o:.9,e:0,arc:1,sk:0,r:2},
 sad:{brow:-.8,by:0,m:-.75,o:0,e:.85,arc:0,sk:0,r:2},surprised:{brow:-.2,by:-4,m:0,o:1,e:1.25,arc:0,sk:0,r:2.8},determined:{brow:.55,by:1,m:0,o:0,e:.85,arc:0,sk:0,r:2},
 angry:{brow:1,by:1.5,m:-.55,o:0,e:.9,arc:0,sk:0,r:2},smirk:{brow:.25,by:0,m:.35,o:0,e:.8,arc:0,sk:1,r:2},worried:{brow:-.9,by:-1,m:-.3,o:.15,e:1,arc:0,sk:0,r:2},
 sleep:{brow:0,by:1,m:.15,o:0,e:0,arc:0,sk:0,r:2},cold:{brow:-.5,by:0,m:-.25,o:.2,e:.9,arc:0,sk:0,r:2}};
const EXv=n=>EX[n]||ADD.ex[n]||EX.neutral; /* NARASCREEN ADDON HOOK */
function face2(F,c,look,blink){const L=(a,b,d,e2,w=1.9)=>`<line x1="${f1(a)}" y1="${f1(b)}" x2="${f1(d)}" y2="${f1(e2)}" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`;
 let s='';const eo2=F.e*blink,lx=look[0],ly=look[1];
 for(const sx of [-1,1]){const ex=sx*6;
  if(F.arc>.5&&eo2<.4)s+=`<path d="M ${ex-3.2} -2 Q ${ex} -6.5 ${ex+3.2} -2" stroke="${c}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
  else if(eo2<.25)s+=L(ex-3,-3,ex+3,-3,2);
  else s+=`<ellipse cx="${f1(ex+lx)}" cy="${f1(-3+ly)}" rx="${f1(F.r)}" ry="${f1(F.r*Math.min(1.3,eo2))}" fill="${c}"/>`;
  const by=-9+F.by;s+=L(ex+sx*-3.5+sx*0, by+F.brow*2.6*(1), ex+sx*3.5, by-F.brow*1.4,1.8)}
 const m0=6.5-F.m*1.5,cv=F.m*7,sk=F.sk*3.5;
 if(F.o>.12){const hw=6.5-3*(1-Math.min(1,Math.abs(F.m)))*F.o,top=m0-1+cv*.25-2.5*F.o*(1-Math.min(1,Math.abs(F.m))),bot=m0+cv*.9+F.o*7;s+=`<path d="M ${f1(-hw)} ${f1(m0)} Q 0 ${f1(top)} ${f1(hw)} ${f1(m0-sk)} Q 0 ${f1(bot)} ${f1(-hw)} ${f1(m0)} Z" fill="${c}" stroke="${c}" stroke-width="1.6" stroke-linejoin="round"/>`}
 else s+=`<path d="M -7 ${f1(m0)} Q 0 ${f1(m0+cv)} 7 ${f1(m0-sk)}" stroke="${c}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
 return s}
function prep(ac){if(ac._v2)return ac._v2;const K=norm(ac.keys),TR=[],XT=[],FT=[];
 for(let i=1;i<K.length;i++){
  if(K[i].pose!==K[i-1].pose){const D=Math.min(.42,K[i].t-K[i-1].t),A0=Q(K[i-1].pose),B0=Q(K[i].pose);
   const big=Math.abs(angd(A0.ra[0][1],B0.ra[0][1]))+Math.abs(angd(A0.la[0][1],B0.la[0][1]))+Math.abs(angd(A0.ra[1][1],B0.ra[1][1]))>1.3;
   TR.push({ts:K[i].t-D,D,A:big?Math.min(.13,D*.35):0,to:K[i].pose})}
  if(K[i].expr!==K[i-1].expr)XT.push({ts:K[i].t-.22,to:K[i].expr});
  if(K[i].face!==K[i-1].face)FT.push({tc:K[i].t-.12,from:K[i-1].face,to:K[i].face})}
 return ac._v2={K,TR,XT,FT,seed:hsh((ac.label||'x').length*13.7+(K[0].x||0)*.37+(K[0].t||0))*1000}}
const curve=(tau,tr)=>tau<tr.A?-.1*Math.sin(Math.PI*tau/tr.A):spring(tau-tr.A,tr.D-tr.A);
const squash=(tau,tr)=>{if(!tr.A||tau<0)return 0;if(tau<tr.A)return -Math.sin(Math.PI*tau/tr.A);const q=(tau-tr.A)/.22;return q<1?.7*Math.sin(Math.PI*q):0};
function poseTr(V,j,t){if(j<0)return Q(V.K[0].pose);const tr=V.TR[j];if(!tr.st)tr.st=poseTr(V,j-1,tr.ts);return blP(tr.st,Q(tr.to),curve(t-tr.ts,tr))}
function exprAt(V,t){let F=EXv(V.K[0].expr),last=null;
 for(const x of V.XT){if(x.ts>t)break;const u=eo((t-x.ts)/.22),A=F,B=EXv(x.to);F={};for(const k in B)F[k]=lerp(A[k],B[k],u);last=x}
 return {F,name:last?last.to:V.K[0].expr,since:last?t-last.ts-.22:t-V.K[0].t}}
function faceAt(V,t){let f=V.K[0].face??1;for(const x of V.FT){if(t>=x.tc+.1){f=x.to;continue}if(t>x.tc-.1){const v=lerp(x.from,x.to,eio((t-(x.tc-.1))/.2));return Math.abs(v)<.14?(x.to>0?.14:-.14):v}break}return f}
function baseAt(K,t){if(t<=K[0].t)return {...K[0]};const last=K[K.length-1];if(t>=last.t)return {...last};
 let i=0;while(i<K.length-1&&K[i+1].t<=t)i++;const a=K[i],b=K[i+1],u=(t-a.t)/(b.t-a.t),ue=b.move?u:eio(u),s={...a};
 for(const k of ['x','y','s','op','rot','irot','glow']){const va=a[k]??(k==='s'||k==='op'?1:0),vb=b[k]??va;s[k]=lerp(va,vb,ue)}
 s.item=u>.5?b.item:a.item;s.look=a.look;s._a=a;s._b=b;s._u=u;return s}
function walkPts(kind,ph,dir){const run=kind==='run',L=run?40:26,H=run?14:6.5,Ab=run?3:1.6,lean=run?.16:.07,bob=Ab*Math.cos(2*TAU*ph);
 const neck=[42*Math.sin(lean),-42*Math.cos(lean)],head=[neck[0]+18*Math.sin(lean*1.4),neck[1]-18*Math.cos(lean*1.4)];
 const leg=p=>{p=((p%1)+1)%1;let fx,lift;if(p<.5){fx=L/2-p/.5*L;lift=0}else{const q=(p-.5)/.5;fx=-L/2+L*eio(q);lift=H*Math.sin(Math.PI*q)}const T=[fx,53-bob-lift];return [ik(T,38.1,18.7),T]};
 const sh=shOf(neck),sw=(run?.8:.45)*Math.cos(TAU*ph);
 const arm=s=>{const a1=Math.PI/2+s*sw,e=[sh[0]+26*Math.cos(a1),sh[1]+26*Math.sin(a1)],a2=a1-(run?1.35:.35);return [e,[e[0]+17*Math.cos(a2),e[1]+17*Math.sin(a2)]]};
 let P={neck,head,la:arm(1),ra:arm(-1),ll:leg(ph),rl:leg(ph+.5)};
 if(dir<0){const m=q=>[-q[0],q[1]];P={neck:m(P.neck),head:m(P.head),la:P.la.map(m),ra:P.ra.map(m),ll:P.ll.map(m),rl:P.rl.map(m)}}
 return {P,bob}}
function actorState(ac,t){const V=prep(ac),s=baseAt(V.K,t),sc=(ac.s||1)*(s.s??1),fc=faceAt(V,t);
 // pose with springs/anticipation
 let j=-1;while(j+1<V.TR.length&&V.TR[j+1].ts<=t)j++;
 let P=cpP(poseTr(V,j,t)),sq=j>=0?squash(t-V.TR[j].ts,V.TR[j]):0,bobY=0,amp=0,walkEnd=null;
 const a=s._a,b=s._b;
 if(b&&(b.move==='walk'||b.move==='run')){const dist=Math.abs(s.x-a.x)/sc,run=b.move==='run',ph=dist/(2*(run?40:26));
  amp=Math.max(0,Math.min(1,(t-a.t)/.18,(b.t-t)/.18));const dir=Math.sign(b.x-a.x||1)*Math.sign(fc||1);
  const W=walkPts(b.move,ph,dir);P=blP(P,toPolar(W.P),amp);bobY=W.bob*amp*sc}
 // dust puff after a walk/run ends
 for(let i=1;i<V.K.length;i++){const k=V.K[i];if((k.move==='walk'||k.move==='run')&&t>=k.t&&t<k.t+.55){walkEnd={x:k.x,tau:t-k.t,y:(k.y??s.y)}}}
 const X=exprAt(V,t),idle=1-amp,sd=V.seed,ex=X.name;
 const slow=(ex==='sad'||a&&a.pose==='slump')?1.6:1;
 P.sp[0]+=idle*(.9*slow)*Math.sin(TAU*t/(3.4*slow)+sd);P.sp[1]+=idle*.028*nz(sd,t*.35);P.hd[1]+=idle*.08*nz(sd+5,t*.45);
 for(const [k,o] of [['la',11],['ra',23]]){P[k][0][1]+=idle*.05*nz(sd+o,t*.6);P[k][1][1]+=idle*.07*nz(sd+o+3,t*.7)}
 let hop=0;const curPose=(t>=(b?b.t:0)?(b||s).pose:(a||s).pose)||s.pose;
 if(s.wiggle){const w=Math.sin(TAU*t/(s.wiggle.p||.5))*(s.wiggle.a||5)/5;P.ra[0][1]+=.09*w;P.ra[1][1]+=.32*w}
 if(ex==='laughing'){P.hd[1]+=.11*Math.sin(TAU*t*4.2);hop+=2.2*Math.abs(Math.sin(TAU*t*2.1))}
 if(curPose==='cheer'&&(ex==='laughing'||ex==='happy')&&amp===0)hop+=4.5*Math.abs(Math.sin(TAU*t*1.55));
 const p=fk(P);
 // line boil on twos
 const fr=Math.floor(t*12),J=(k)=>[(hsh(sd+k,fr)-.5)*1.1,(hsh(sd+k+50,fr)-.5)*1.1];
 for(const [k,n] of [['la',1],['ra',2],['ll',3],['rl',4]]){p[k]=p[k].map((q,i)=>{const d=J(n*10+i);return [q[0]+d[0],q[1]+d[1]]})}
 const dn=J(77);p.neck=[p.neck[0]+dn[0]*.6,p.neck[1]+dn[1]*.6];p.head=[p.head[0]+dn[0]*.5,p.head[1]+dn[1]*.5];
 // follow-through lag (world dx over last 0.09 s, converted to local)
 const sp=baseAt(V.K,t-.09),lag=cl((s.x-sp.x)/sc*Math.sign(fc||1),-12,12);
 // blink + gaze
 let blink=1;const n0=Math.floor(t/3.3);for(let n=n0-1;n<=n0+1;n++){const tb=n*3.3+hsh(sd+3,n)*2.4,d=Math.abs(t-tb);if(d<.075)blink=Math.min(blink,d/.075);if(ex==='surprised'&&Math.abs(t-tb-.2)<.06)blink=0}
 return {s,V,P,p,sc,fc,sq,bobY,hop,amp,X,blink,lag,walkEnd,fr,sd}}
function drawActor2(ac,t,c,spec,st,all){
 const {s,p,sc,fc,sq,bobY,hop,X,blink,lag,fr,sd}=st;if((s.op??1)<=.01)return '';const look=s.look||ac.look||[];
 const col=ac.shadow?'#3a2f24':c,wv=k=>f1(3.05+.4*hsh(sd+k,fr));
 const curvy=(pts,soft=1)=>{const [a0,j,b0]=pts,m=[(a0[0]+b0[0])/2,(a0[1]+b0[1])/2],cc=[j[0]+soft*(j[0]-m[0]),j[1]+soft*(j[1]-m[1])];return `M ${f1(a0[0])} ${f1(a0[1])} Q ${f1(cc[0])} ${f1(cc[1])} ${f1(b0[0])} ${f1(b0[1])}`};
 const limb=(pts,k,soft)=>`<path d="${curvy(pts,soft)}" stroke="${col}" stroke-width="${wv(k)}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
 let g='';
 if(s.glow)g+=`<circle cx="0" cy="-30" r="${f1(80+6*Math.sin(t*3))}" fill="url(#glow)" opacity="${f1(s.glow)}"/>`;
 if(look.includes('dress'))g+=`<path d="M 0 -8 L -16 18 L 16 18 Z" fill="${col}" opacity=".9"/>`;
 if(look.includes('robe'))g+=`<path d="M ${f1(p.sh[0])} ${f1(p.sh[1])} L ${f1(-20-lag*.8)} 30 L ${f1(20-lag*.5)} 30 Z" fill="${RED}" opacity=".85" stroke="${col}" stroke-width="2"/>`;
 g+=ADD.look(look,'behind',p,col,lag,s); /* NARASCREEN ADDON HOOK */
 g+=limb([[0,0],p.ll[0],p.ll[1]],1,.15)+limb([[0,0],p.rl[0],p.rl[1]],2,.15);
 const mid=[p.neck[0]*.5+(p.neck[1]>-30?0:-.6*Math.sin(t)),p.neck[1]*.5];
 g+=`<path d="M 0 0 Q ${f1(mid[0])} ${f1(mid[1])} ${f1(p.neck[0])} ${f1(p.neck[1])}" stroke="${col}" stroke-width="${f1(3.4+.3*hsh(sd+9,fr))}" fill="none" stroke-linecap="round"/>`;
 if(look.includes('tie'))g+=`<g transform="rotate(${f1(-lag*2.6)} ${f1(p.sh[0])} ${f1(p.sh[1])})"><path d="M ${f1(p.sh[0])} ${f1(p.sh[1])} l -3 4 l 3 14 l 3 -14 Z" fill="${RED}"/></g>`;
 if(look.includes('sword'))g+=`<line x1="-4" y1="-4" x2="${f1(-30-lag*.6)}" y2="34" stroke="${GREY}" stroke-width="3" stroke-linecap="round"/>`;
 g+=ADD.look(look,'body',p,col,lag,s); /* NARASCREEN ADDON HOOK */
 g+=limb([p.sh,p.la[0],p.la[1]],3)+limb([p.sh,p.ra[0],p.ra[1]],4);
 const r=look.includes('dress')||look.includes('hair')?16:18;
 g+=`<circle cx="${f1(p.head[0])}" cy="${f1(p.head[1])}" r="${r}" fill="${ac.shadow?'#3a2f24':PAPER}" stroke="${col}" stroke-width="${wv(5)}"/>`;
 // gaze: look toward the nearest other visible actor, else forward with small saccades
 let gx=1.1,gy=0;const others=all.filter(o=>o!==st&&(o.s.op??1)>.3);
 if(others.length){const o=others.reduce((m,q)=>Math.abs(q.s.x-s.x)<Math.abs(m.s.x-s.x)?q:m),dx=(o.s.x-s.x)*Math.sign(fc||1);gx=1.5*cl(dx/120,-1,1);gy=cl((o.s.y-s.y)/200,-1,1)}
 gx+=.5*nz(sd+31,t*.8);gy+=.4*nz(sd+37,t*.7);
 const tilt=f1(nz(sd+41,t*.4)*4+(X.name==='sad'?6:0)+(X.name==='worried'?-4:0));
 if(!ac.shadow)g+=`<g transform="translate(${f1(p.head[0])} ${f1(p.head[1])}) rotate(${tilt})">${face2(X.F,col,[gx,gy],blink)}</g>`;
 // automatic emotion symbols
 const hx=p.head[0],hy=p.head[1],se=X.since;
 if(X.name==='surprised'&&se<.9&&se>-.2){const k=spring(se+.2,.18),o=f1(cl(1-(se-.3)/.6));g+=`<g transform="translate(${f1(hx)} ${f1(hy)}) scale(${f1(k)})" opacity="${o}">`+[-55,-25,25,55].map(a=>{const A=(a-90)*Math.PI/180;return `<line x1="${f1(25*Math.cos(A))}" y1="${f1(25*Math.sin(A))}" x2="${f1(36*Math.cos(A))}" y2="${f1(36*Math.sin(A))}" stroke="${col}" stroke-width="2.6" stroke-linecap="round"/>`}).join('')+'</g>'}
 if(X.name==='angry'&&se>-.1){const k=spring(se+.1,.18)*(1+.12*Math.sin(TAU*t*2.4));g+=`<g transform="translate(${f1(hx+15)} ${f1(hy-16)}) scale(${f1(k)})"><path d="M -6 -2 Q -2 -2 -2 -6 M 2 -6 Q 2 -2 6 -2 M 6 2 Q 2 2 2 6 M -2 6 Q -2 2 -6 2" stroke="${RED}" stroke-width="2.4" fill="none" stroke-linecap="round"/></g>`}
 if((X.name==='worried'||X.name==='cold')&&se>0){const q=(se%1.4)/1.4;g+=`<path transform="translate(${f1(hx+17)} ${f1(hy-6+q*12)})" d="M 0 0 q 5 9 0 13 q -5 -4 0 -13" fill="#8bb8d0" opacity="${f1(Math.sin(Math.PI*q))}"/>`}
 if(X.name==='laughing'&&se>0){const o=f1(.5+.5*Math.sin(TAU*t*4));g+=[-1,1].map(d=>`<g opacity="${o}">`+[-20,0,20].map(a=>{const A=(a+(d>0?0:180))*Math.PI/180;return `<line x1="${f1(hx+d*24+6*Math.cos(A))}" y1="${f1(hy-4+6*Math.sin(A))}" x2="${f1(hx+d*24+14*Math.cos(A))}" y2="${f1(hy-4+14*Math.sin(A))}" stroke="${col}" stroke-width="2" stroke-linecap="round"/>`}).join('')+'</g>').join('')}
 g+=ADD.mark(X.name,hx,hy,se,col); /* NARASCREEN ADDON HOOK */
 g+=`<g transform="translate(${f1(-lag*.45)} ${f1(Math.abs(lag)*.08)}) rotate(${f1(-lag*1.1)} ${f1(hx)} ${f1(hy)})">${hat(look,p.head,col)}${ADD.look(look,'head',p,col,lag,s)}</g>`; /* NARASCREEN ADDON HOOK */
 g+=held(s.item,p.ra[1],(s.irot||0)-lag*1.5,col);
 const sy=1+.05*sq,sx=1-.035*sq,rot=s.rot?` rotate(${f1(s.rot)} 0 53)`:'';
 const Y=s.y+bobY-hop*sc;
 let out=`<g transform="translate(${f1(s.x)} ${f1(Y)}) scale(${f1(fc*sc*sx*1000)/1000} ${f1(sc*sy*1000)/1000})${rot} translate(0 ${f1(53*(1-1/sy))})" opacity="${f1(s.op??1)}">${g}</g>`;
 if(ac.label&&(s.op??1)>.3&&s.x>-20&&s.x<(spec.w||900)+20){const ly=s.y+(p.head[1]-(look.some(l=>['crown','tophat','musket'].includes(l))?62:34))*sc+(ac.labelDy||0);
  const fs=spec.labelFs||15,tw=ac.label.length*fs*.78+14,W0=spec.w||900,lx=cl(s.x+p.head[0]*fc*sc,tw/2+16,W0-tw/2-16);
  out+=`<rect x="${f1(lx-tw/2)}" y="${f1(ly-fs*.95)}" width="${f1(tw)}" height="${f1(fs*1.3)}" rx="${f1(fs*.4)}" fill="#f6ecd4" opacity="${f1((s.op??1)*.88)}"/>`;
  out+=`<text x="${f1(lx)}" y="${f1(ly)}" text-anchor="middle" font-family="Cinzel,Georgia,serif" font-weight="700" font-size="${fs}" letter-spacing="2" fill="${ac.labelColor||RED}" opacity="${f1(s.op??1)}">${ac.label}</text>`}
 return out}
function groundFx(st,t){const {s,p,sc,hop,walkEnd}=st;if((s.op??1)<=.01)return '';const fy=s.y+Math.max(p.ll[1][1],p.rl[1][1])*sc,k=1-cl(hop/30);
 let g=`<ellipse cx="${f1(s.x)}" cy="${f1(fy+2)}" rx="${f1(22*sc*k)}" ry="${f1(4.5*sc*k)}" fill="#2b2117" opacity="${f1(.14*(s.op??1))}"/>`;
 if(walkEnd){const u=walkEnd.tau/.55;g+=[-1,0,1].map(d=>`<circle cx="${f1(walkEnd.x+d*(14+18*u)*sc)}" cy="${f1(fy-4*sc-u*6)}" r="${f1((3+6*u)*sc)}" fill="#b9a37b" opacity="${f1(.45*(1-u))}"/>`).join('')}
 return g}

// ---------- props / effects ----------
function win(f,t){const a=f.t0??-1e9,b=f.t1??1e9,fd=f.fade??.35;if(t<a||t>b)return 0;return Math.min(cl((t-a)/fd),cl((b-t)/fd))}
function kv(f,t,k,def){if(!f.k)return f[k]??def;const K=f.k;if(t<=K[0].t)return K[0][k]??f[k]??def;if(t>=K[K.length-1].t)return K[K.length-1][k]??f[k]??def;
 let i=0;while(K[i+1].t<=t)i++;const u=eio((t-K[i].t)/(K[i+1].t-K[i].t));const a=K[i][k]??f[k]??def,b=K[i+1][k]??a;return typeof a==='number'?lerp(a,b,u):(u<.5?a:b)}
function drawFx(f,t,W,H){const o=win(f,t);if(o<=0)return '';const op=o*(f.op??1);const c=INK;let s='';
 const X=kv(f,t,'x',0),Y=kv(f,t,'y',0),S=kv(f,t,'s',1);
 const G=b=>`<g transform="translate(${f1(X)} ${f1(Y)}) scale(${f1(S*100)/100})" opacity="${f1(op*100)/100}">${b}</g>`;
 switch(f.type){
  case 'sun':return G(`<circle r="30" fill="${GOLD}" opacity=".9"/>`+[...Array(12)].map((_,k)=>{const a=k/12*6.283+t*.4;return `<line x1="${f1(40*Math.cos(a))}" y1="${f1(40*Math.sin(a))}" x2="${f1(54*Math.cos(a))}" y2="${f1(54*Math.sin(a))}" stroke="${GOLD}" stroke-width="4" stroke-linecap="round"/>`}).join(''));
  case 'beam':{const x1=kv(f,t,'x1',0),y1=kv(f,t,'y1',0),x2=kv(f,t,'x2',0),y2=kv(f,t,'y2',0),w1=kv(f,t,'w1',6),w2=kv(f,t,'w2',30);
   const dx=x2-x1,dy=y2-y1,L=Math.hypot(dx,dy)||1,nx=-dy/L,ny=dx/L;
   return `<path d="M ${f1(x1+nx*w1)} ${f1(y1+ny*w1)} L ${f1(x2+nx*w2)} ${f1(y2+ny*w2)} L ${f1(x2-nx*w2)} ${f1(y2-ny*w2)} L ${f1(x1-nx*w1)} ${f1(y1-ny*w1)} Z" fill="${f.color||'#f6c95a'}" opacity="${f1(op*.55*100)/100}"/>`}
  case 'sparkle':return G([...Array(f.n||6)].map((_,k)=>{const a=k/(f.n||6)*6.283+.4;const r=(f.r||46)+8*Math.sin(t*5+k);const sz=6+3*Math.sin(t*7+k*2);
   return `<path d="M ${f1(r*Math.cos(a))} ${f1(r*Math.sin(a)-sz)} L ${f1(r*Math.cos(a)+sz*.3)} ${f1(r*Math.sin(a))} L ${f1(r*Math.cos(a))} ${f1(r*Math.sin(a)+sz)} L ${f1(r*Math.cos(a)-sz*.3)} ${f1(r*Math.sin(a))} Z" fill="${f.color||GOLD}"/>`}).join(''));
  case 'firework':{const age=t-(f.t0??0);const cols=[GOLD,RED,'#e9b949',BLUE];let b='';
   (f.bursts||[[0,0,0]]).forEach(([bx,by,d],j)=>{const a2=age-d;if(a2<0)return;const r=Math.min(1,a2/.7)*(f.r||60),fade=cl(1.6-a2*.8);
    for(let k=0;k<14;k++){const an=k/14*6.283;b+=`<line x1="${f1(bx+r*.35*Math.cos(an))}" y1="${f1(by+r*.35*Math.sin(an))}" x2="${f1(bx+r*Math.cos(an))}" y2="${f1(by+r*Math.sin(an))}" stroke="${cols[(j+k)%4]}" stroke-width="3" stroke-linecap="round" opacity="${f1(fade*100)/100}"/>`}});
   return G(b)}
  case 'bubble':{const w=f.w||170,h=f.h||56,tx=f.tail??-1;return G(`<path d="M 0 0 h ${w} v ${h} h ${-w*.55} l ${tx*-18} 22 l ${tx*4} -22 h ${-w*.45} Z" transform="translate(${-w/2} ${-h})" fill="#fffaf0" stroke="${c}" stroke-width="2.4" stroke-linejoin="round"/><text x="0" y="${-h/2+7}" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="${f.fs||22}" fill="${f.color||c}">${f.text}</text>`)}
  case 'thought':{const w=f.w||170,h=f.h||56;return G(`<ellipse cx="0" cy="${-h/2}" rx="${w/2}" ry="${h/2+6}" fill="#fffaf0" stroke="${c}" stroke-width="2.2"/><circle cx="${-w*.25}" cy="18" r="7" fill="#fffaf0" stroke="${c}" stroke-width="2"/><circle cx="${-w*.35}" cy="34" r="4" fill="#fffaf0" stroke="${c}" stroke-width="2"/><text x="0" y="${-h/2+7}" text-anchor="middle" font-family="Georgia,serif" font-style="italic" font-size="${f.fs||20}" fill="${c}">${f.text}</text>`)}
  case 'text':return G(`<text text-anchor="${f.anchor||'middle'}" font-family="${f.font||'Cinzel,Georgia,serif'}" font-weight="700" font-size="${f.fs||26}" letter-spacing="${f.ls??2}" fill="${f.color||c}">${f.text}</text>`);
  case 'table':return G(`<rect x="${-(f.w||300)/2}" y="0" width="${f.w||300}" height="12" rx="3" fill="#8a6a45" stroke="${c}" stroke-width="2"/><line x1="${-(f.w||300)/2+20}" y1="12" x2="${-(f.w||300)/2+20}" y2="${f.h||48}" stroke="${c}" stroke-width="3"/><line x1="${(f.w||300)/2-20}" y1="12" x2="${(f.w||300)/2-20}" y2="${f.h||48}" stroke="${c}" stroke-width="3"/>`);
  case 'chair':return G(`<line x1="-14" y1="0" x2="14" y2="0" stroke="${c}" stroke-width="3"/><line x1="${f.back??-14}" y1="0" x2="${f.back??-14}" y2="-40" stroke="${c}" stroke-width="3"/><line x1="-12" y1="0" x2="-12" y2="30" stroke="${c}" stroke-width="3"/><line x1="12" y1="0" x2="12" y2="30" stroke="${c}" stroke-width="3"/>`);
  case 'screen':{const w=f.w||220,h=f.h||140;let b=`<rect x="${-w/2}" y="${-h}" width="${w}" height="${h}" fill="#fbf6ea" stroke="${c}" stroke-width="3"/><line x1="0" y1="0" x2="0" y2="${f.leg??60}" stroke="${c}" stroke-width="3"/>`;
   if(f.title)b+=`<text x="0" y="${-h+28}" text-anchor="middle" font-family="Inter,Arial" font-weight="700" font-size="20" fill="${c}">${f.title}</text>`;
   if(f.big)b+=`<text x="0" y="${-h/2+24}" text-anchor="middle" font-family="Georgia" font-weight="700" font-size="${f.bfs||46}" fill="${kv(f,t,'bigColor',c)}">${kv(f,t,'big','')}</text>`;
   if(f.chart){const g2=kv(f,t,'g',1);const pts=f.chart.map((v,k)=>[-w/2+20+k*(w-40)/(f.chart.length-1),-16-v*(h-60)*g2]);b+=`<path d="M ${pts.map(q=>f1(q[0])+' '+f1(q[1])).join(' L ')}" stroke="${f.chartColor||'#3d7a4a'}" stroke-width="4" fill="none" stroke-linecap="round"/>`}
   return G(b)}
  case 'chateau':return G(`<g stroke="${c}" stroke-width="2.4" fill="none" opacity=".75"><rect x="-150" y="-90" width="300" height="90"/><rect x="-190" y="-120" width="50" height="120"/><rect x="140" y="-120" width="50" height="120"/><path d="M -190 -120 L -165 -150 L -140 -120 M 140 -120 L 165 -150 L 190 -120"/><path d="M -45 -90 Q 0 -170 45 -90"/><line x1="0" y1="-150" x2="0" y2="-170"/>${[...Array(6)].map((_,k)=>`<rect x="${-130+k*46}" y="-70" width="18" height="30"/>`).join('')}</g>`);
  case 'garden':return G(`<g stroke="#5c7a3c" stroke-width="2.4" fill="none" opacity=".7">${[...Array(f.n||5)].map((_,k)=>`<ellipse cx="${-200+k*100}" cy="0" rx="38" ry="12"/><line x1="${-200+k*100}" y1="-12" x2="${-200+k*100}" y2="-40"/><circle cx="${-200+k*100}" cy="-48" r="9"/>`).join('')}</g>`);
  case 'bars':{const drop=kv(f,t,'drop',0);const w=f.w||120,h=f.h||170;return G(`<g transform="translate(0 ${f1(-(1-drop)*260)})"><rect x="${-w/2}" y="${-h}" width="${w}" height="${h}" fill="none" stroke="${c}" stroke-width="4"/>${[...Array(6)].map((_,k)=>`<line x1="${-w/2+k*w/5}" y1="${-h}" x2="${-w/2+k*w/5}" y2="0" stroke="${c}" stroke-width="4"/>`).join('')}</g>`)}
  case 'jupiter':return G(`<circle r="${f.r||34}" fill="#d9a066" stroke="${c}" stroke-width="2"/><path d="M ${-(f.r||34)+4} -8 Q 0 -2 ${(f.r||34)-4} -8 M ${-(f.r||34)+3} 8 Q 0 14 ${(f.r||34)-3} 8" stroke="#a8673a" stroke-width="3" fill="none"/>`+[70,92,114,136].map((r,k)=>{const a=t*(1.4-k*.25)+k*1.7;return `<ellipse rx="${r}" ry="${r*.28}" fill="none" stroke="${GREY}" stroke-width="1" stroke-dasharray="3 5" opacity=".6"/><circle cx="${f1(r*Math.cos(a))}" cy="${f1(r*.28*Math.sin(a))}" r="5" fill="${PAPER}" stroke="${c}" stroke-width="2"/>`}).join(''));
  case 'stars':return G([...Array(f.n||14)].map((_,k)=>{const x=((k*137)%(f.w||800))-(f.w||800)/2,y=((k*71)%(f.h||160));const tw=.5+.5*Math.sin(t*3+k);return `<circle cx="${x}" cy="${y}" r="${1.5+tw*1.5}" fill="${GOLD}"/>`}).join(''));
  case 'bed':return G(`<rect x="-90" y="-26" width="180" height="26" fill="#e6d3ae" stroke="${c}" stroke-width="2.4"/><rect x="-96" y="-70" width="10" height="100" fill="${c}"/><line x1="86" y1="0" x2="86" y2="30" stroke="${c}" stroke-width="4"/><line x1="-90" y1="0" x2="-90" y2="30" stroke="${c}" stroke-width="4"/><ellipse cx="-60" cy="-32" rx="22" ry="9" fill="#fffaf0" stroke="${c}" stroke-width="2"/>`);
  case 'tint':return `<rect x="0" y="0" width="${W}" height="${H}" fill="${f.color||BLUE}" opacity="${f1(op*(f.a??.25)*100)/100}"/>`;
  case 'snow':return `<g opacity="${f1(op*100)/100}">`+[...Array(28)].map((_,k)=>{const x=(k*97)%W,y=((k*53)+t*40*(1+k%3))%H;return `<text x="${x}" y="${f1(y)}" font-size="${12+k%3*5}" fill="#dbeaf4">✻</text>`}).join('')+'</g>';
  case 'sweat':return G(`<path d="M 0 0 q 5 9 0 13 q -5 -4 0 -13" fill="#8bb8d0"/><path d="M 14 8 q 4 7 0 10 q -4 -3 0 -10" fill="#8bb8d0"/>`);
  case 'zzz':return G(`<text font-family="Georgia" font-weight="700" font-size="22" fill="${c}"><tspan x="0" y="0">z</tspan><tspan x="14" y="-16" font-size="28">z</tspan><tspan x="32" y="-36" font-size="34">Z</tspan></text>`);
  case 'heart':return G(`<path d="M 0 8 C -24 -10 -10 -28 0 -14 C 10 -28 24 -10 0 8 Z" fill="${RED}"/>`);
  case 'check':return G(`<circle r="22" fill="#3d7a4a"/><path d="M -10 0 L -3 8 L 11 -9" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round"/>`);
  case 'cross':return G(`<circle r="22" fill="${RED}"/><path d="M -9 -9 L 9 9 M 9 -9 L -9 9" stroke="#fff" stroke-width="5" stroke-linecap="round"/>`);
  case 'doc':return G(`<rect x="-34" y="-44" width="68" height="88" fill="#fbf6ea" stroke="${c}" stroke-width="2.4"/>${[...Array(5)].map((_,k)=>`<line x1="-24" y1="${-30+k*12}" x2="${k==4?4:24}" y2="${-30+k*12}" stroke="${GREY}" stroke-width="2"/>`).join('')}${f.title?`<text x="0" y="-50" text-anchor="middle" font-family="Inter,Arial" font-weight="700" font-size="13" fill="${c}">${f.title}</text>`:''}${kv(f,t,'signed',0)>.5?`<path d="M -20 36 q 8 -12 16 0 q 8 12 18 -4" stroke="${BLUE}" stroke-width="2.4" fill="none"/>`:''}`);
  case 'door':return G(`<rect x="-34" y="-130" width="68" height="130" fill="#d9c49c" stroke="${c}" stroke-width="2.4"/><circle cx="22" cy="-62" r="4" fill="${c}"/>`);
  case 'curtain':return `<g opacity="${f1(op*100)/100}"><path d="M 0 0 L ${W*.13} 0 Q ${W*.08} ${H*.45} ${W*.11} ${H} L 0 ${H} Z" fill="#7d1d1d"/><path d="M ${W} 0 L ${W*.87} 0 Q ${W*.92} ${H*.45} ${W*.89} ${H} L ${W} ${H} Z" fill="#7d1d1d"/><rect x="0" y="0" width="${W}" height="${H*.06}" fill="#5e1414"/></g>`;
  case 'arrow':return G(`<path d="M 0 0 L ${f.len||80} 0" stroke="${f.color||RED}" stroke-width="4" stroke-linecap="round"/><path d="M ${(f.len||80)-12} -9 L ${f.len||80} 0 L ${(f.len||80)-12} 9" stroke="${f.color||RED}" stroke-width="4" fill="none" stroke-linecap="round"/>`);
  case 'throne':return G(`<rect x="-30" y="-90" width="60" height="90" rx="6" fill="${RED}" stroke="${c}" stroke-width="2.4"/><rect x="-38" y="-20" width="76" height="20" fill="${GOLD}" stroke="${c}" stroke-width="2"/><line x1="-30" y1="0" x2="-30" y2="40" stroke="${c}" stroke-width="4"/><line x1="30" y1="0" x2="30" y2="40" stroke="${c}" stroke-width="4"/>`);
  case 'night':return `<rect x="0" y="0" width="${W}" height="${H}" fill="#1b1f2e" opacity="${f1(op*(f.a??.45)*100)/100}"/>`;
  case 'mirrorstand':{const r=kv(f,t,'rot',0);return G(`<line x1="-26" y1="0" x2="0" y2="-70" stroke="${c}" stroke-width="3"/><line x1="26" y1="0" x2="0" y2="-70" stroke="${c}" stroke-width="3"/><g transform="translate(0 -110) rotate(${f1(r)})"><ellipse rx="34" ry="52" fill="#dfe9ee" stroke="${GOLD}" stroke-width="7"/><path d="M -14 -30 L 6 -42" stroke="#fff" stroke-width="4" stroke-linecap="round"/></g>`)}
  case 'wallet':return G(`<rect x="-12" y="-8" width="24" height="16" rx="2" fill="#6b4a2b" stroke="${c}" stroke-width="1.8"/><line x1="-12" y1="-2" x2="12" y2="-2" stroke="${c}" stroke-width="1"/>`);
  case 'crownfx':return G(`<path d="M -14 0 L -14 -18 L -7 -9 L 0 -22 L 7 -9 L 14 -18 L 14 0 Z" fill="${GOLD}" stroke="${c}" stroke-width="1.6"/>`);
  case 'moon':return G(`<path d="M 0 -26 A 26 26 0 1 0 0 26 A 13 26 0 1 1 0 -26 Z" fill="#e9e1c8"/>`);
 }
 return ADD.fx(f,t,W,H,G,op,X,Y,S)} /* NARASCREEN ADDON HOOK */

function svg(spec,t){
 ADD.t=t;ADD.spec=spec; /* NARASCREEN ADDON HOOK */
 const W=spec.w||900,H=spec.h||400,gy=spec.ground??355;
 let s=`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block">`;
 s+=`<defs><radialGradient id="fg-paper" cx="50%" cy="45%" r="75%"><stop offset="0" stop-color="#f5ead0"/><stop offset=".7" stop-color="#ead9b4"/><stop offset="1" stop-color="#cdb487"/></radialGradient>`+
    `<radialGradient id="glow"><stop offset="0" stop-color="#ffd877" stop-opacity=".95"/><stop offset="1" stop-color="#ffd877" stop-opacity="0"/></radialGradient></defs>`;
 s+=`<rect width="${W}" height="${H}" fill="url(#fg-paper)"/>`;
 const acts=(spec.actors||[]),states=acts.map(a=>actorState(a,t));
 const vis=states.filter(q=>(q.s.op??1)>.3&&q.s.x>0&&q.s.x<W);
 const cxa=vis.length?vis.reduce((m,q)=>m+q.s.x,0)/vis.length:W/2;
 const z=1+.016*eio(cl(t/9)),cx=W/2+(cxa-W/2)*.12,cy=H/2;
 s+=`<g transform="translate(${f1(W/2)} ${f1(cy)}) scale(${f1(z*1000)/1000}) translate(${f1(-cx)} ${f1(-cy)})">`;
 const back=(spec.fx||[]).filter(f=>!f.front&&!ADD.over(f)),front=(spec.fx||[]).filter(f=>f.front); /* NARASCREEN ADDON HOOK */
 const over=(spec.fx||[]).filter(f=>!f.front&&ADD.over(f)); /* NARASCREEN ADDON HOOK */
 if(spec.groundLine!==false)s+=`<line x1="-40" y1="${gy}" x2="${W+40}" y2="${gy}" stroke="#b9a37b" stroke-width="2" stroke-dasharray="8 6"/>`;
 back.forEach(f=>s+=drawFx(f,t,W,H));
 states.forEach(q=>s+=groundFx(q,t));
 acts.forEach((a,i)=>s+=drawActor2(a,t,INK,spec,states[i],states));
 s+='</g>';
 over.forEach(f=>s+=drawFx(f,t,W,H));
 s+=`<g transform="translate(${f1(W/2)} ${f1(cy)}) scale(${f1(z*1000)/1000}) translate(${f1(-cx)} ${f1(-cy)})">`;front.forEach(f=>s+=drawFx(f,t,W,H));s+='</g>';
 s+=`<rect x="6" y="6" width="${W-12}" height="${H-12}" fill="none" stroke="${INK}" stroke-opacity=".55" stroke-width="2"/><rect x="13" y="13" width="${W-26}" height="${H-26}" fill="none" stroke="${INK}" stroke-opacity=".25" stroke-width="1"/>`;
 return s+'</svg>'}

const API={svg,POSES,EXPRESSIONS:Object.keys(EX),version:'0.1.0'};
/* NARASCREEN ADDON PATCH START
 * Add-on registry: FIGURES.extend(addon) and FIGURES.vocab(). Not upstream; see VENDORED.md and
 * explainers/addons/README.md. Built-in names always win; the hooks marked NARASCREEN ADDON HOOK only
 * reach this registry where the engine would otherwise fall back, so built-in output is unchanged. */
const ADD={pp:{},ex:{},mk:{},it:{},lk:{},fxd:{},fxl:{},fxw:{},sets:{},own:{},t:0,spec:null};
const HELP=Object.freeze({INK,PAPER,RED,GOLD,BLUE,GREY,TAU,f1,cl,lerp,eio,eo,kv,win,hsh,nz,
 esc:v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')});
const hOf=x=>{const sp=ADD.spec||{};return Object.assign({},HELP,{spec:sp,W:sp.w||900,H:sp.h||400,ground:sp.ground??355},x)};
const str=v=>v==null?'':String(v);
ADD.item=(n,rot,c)=>str(ADD.it[n]({type:n,rot:rot||0,c},ADD.t,hOf({})));
ADD.look=(look,layer,p,c,lag,st)=>{let o='';for(const n of (Array.isArray(look)?look:[look])){const L=ADD.lk[n];
 if(L&&L.layer===layer)o+=str(L.draw({type:n,layer,p,c,lag,state:st},ADD.t,hOf({})))}return o};
ADD.mark=(n,hx,hy,since,c)=>ADD.mk[n]?str(ADD.mk[n]({type:n,head:[hx,hy],since,c},ADD.t,hOf({}))):'';
ADD.over=f=>f.type==='tint'||f.type==='night'||f.type==='snow'||ADD.fxl[f.type]==='overlay';
ADD.fx=(f,t,W,H,G,op,X,Y,S)=>{const D=ADD.fxd[f.type];if(!D)return '';const b=str(D(f,t,hOf({W,H,op,x:X,y:Y,s:S})));return ADD.fxw[f.type]?G(b):b};
function extend(a){
 if(!a||typeof a!=='object')throw new Error('FIGURES.extend: expected an add-on object');
 const nm=String(a.name||'anonymous');
 for(const k in ADD.own)if(ADD.own[k]===nm){const [tb,n]=k.split('\u0000');delete ADD.own[k];for(const x of (tb==='fx'?['fxd','fxl','fxw']:tb==='ex'?['ex','mk']:[tb]))delete ADD[x][n]}
 const bad=m=>{throw new Error(`add-on ${nm}: ${m}`)};
 const claim=(tb,n,kind)=>{const o=ADD.own[tb+'\u0000'+n];if(o&&o!==nm)bad(`${kind} '${n}' is already defined by add-on ${o}`);ADD.own[tb+'\u0000'+n]=nm};
 const fn=(v,kind,n)=>{const d=typeof v==='function'?v:v&&v.draw;if(typeof d!=='function')bad(`${kind} '${n}' needs a draw function`);return d};
 for(const [n,p] of Object.entries(a.poses||{})){if(POSES[n])bad(`pose '${n}' is built in`);claim('pp',n,'pose');ADD.pp[n]=toPolar(Object.assign(JSON.parse(JSON.stringify(B)),p))}
 for(const [n,e] of Object.entries(a.exprs||{})){if(EX[n])bad(`expression '${n}' is built in`);claim('ex',n,'expression');
  const F={...EX.neutral};for(const k in F)if(typeof e[k]==='number')F[k]=e[k];ADD.ex[n]=F;if(typeof e.mark==='function')ADD.mk[n]=e.mark}
 for(const [n,d] of Object.entries(a.items||{})){claim('it',n,'item');ADD.it[n]=fn(d,'item',n)}
 for(const [n,d] of Object.entries(a.looks||{})){const layer=(d&&d.layer)||'body';if(!['behind','body','head'].includes(layer))bad(`look '${n}' layer must be behind, body or head`);
  claim('lk',n,'look');ADD.lk[n]={layer,draw:fn(d,'look',n)}}
 for(const [n,d] of Object.entries(a.fx||{})){const layer=(d&&d.layer)||'scene';if(!['scene','overlay'].includes(layer))bad(`fx '${n}' layer must be scene or overlay`);
  claim('fx',n,'fx');ADD.fxd[n]=fn(d,'fx',n);ADD.fxl[n]=layer;ADD.fxw[n]=!(d&&d.wrap===false)}
 for(const [n,s] of Object.entries(a.sets||{})){claim('sets',n,'set');ADD.sets[n]=s}
 return API}
API.extend=extend;
API.vocab=()=>({poses:Object.keys(ADD.pp),exprs:Object.keys(ADD.ex),items:Object.keys(ADD.it),looks:Object.keys(ADD.lk),fx:Object.keys(ADD.fxd),sets:Object.keys(ADD.sets)});
API.sets=ADD.sets;
/* NARASCREEN ADDON PATCH END */
root.FIGURES=API;
if(typeof module!=='undefined'&&module.exports)module.exports=API;
})(typeof window!=='undefined'?window:globalThis);
