"use strict";
/* ══════════════════════════════════════════════════════════════════════════
   JuQode Phase 4A — 하나의 기계, 아홉 개의 상태

   여덟 개의 설계 프레임은 여덟 개의 페이지가 아니다.
   껍데기는 그대로 있고 그 안의 상태가 바뀐다. 이 파일이 그 상태 기계다.

   목(mock)인 것    : Software 실행 · 코딩 에이전트 · 파일 · 결과 수치
   목이 아닌 것     : 사용자의 상호작용 전부
   ══════════════════════════════════════════════════════════════════════════ */
(function(){

var Q = JQ;
var MAC = /Mac|iPhone|iPad/.test(navigator.platform||navigator.userAgent);
var RUNKEY = MAC ? '\u2318R' : 'CTRL R';
var DPR = Math.min(2, window.devicePixelRatio || 1);

/* ── 결 그리기 — 굵기를 화면 픽셀 기준으로 고정한다(축소해도 희미해지지 않게) ── */
function paint(ctx, paths, dim, lwK){
  var T=Q.TSTR, BA=Q.BA, BW=Q.BW, t, b, al;
  for(t=0;t<4;t++){
    var boost=(t===1||t===2)?1.35:1;
    for(b=0;b<6;b++){
      al=BA[b]*boost*dim; if(al>0.96) al=0.96; if(al<0.002) continue;
      ctx.strokeStyle='rgba('+T[t]+','+al.toFixed(3)+')';
      ctx.lineWidth=BW[b]*lwK;
      ctx.stroke(paths[t][b]);
    }
  }
}
/* ── 집힘 = 나머지가 물러나는 것. 테두리를 만들지 않는다 ────────────────── */
var poolCv=null;
function lightPool(paths, pl, lwK){
  if(!poolCv){ poolCv=document.createElement('canvas'); }
  if(poolCv.width!==Q.W*DPR || poolCv.height!==Q.H*DPR){
    poolCv.width=Q.W*DPR; poolCv.height=Q.H*DPR;
  }
  var oc=poolCv.getContext('2d');
  oc.setTransform(1,0,0,1,0,0);
  oc.clearRect(0,0,poolCv.width,poolCv.height);
  oc.setTransform(DPR,0,0,DPR,0,0);
  oc.lineCap='round'; oc.lineJoin='round';
  oc.globalCompositeOperation='source-over';
  paint(oc,paths,1,lwK);
  oc.setTransform(DPR,0,0,DPR,0,0);
  oc.globalCompositeOperation='destination-in';
  oc.translate(pl.x.v,pl.y.v); oc.rotate(pl.rot);
  oc.scale(pl.rx.v*1.52, pl.ry.v*1.62);
  var g=oc.createRadialGradient(0,0,0,0,0,1);
  g.addColorStop(0,'rgba(0,0,0,1)');
  g.addColorStop(0.50,'rgba(0,0,0,1)');
  g.addColorStop(0.78,'rgba(0,0,0,0.55)');
  g.addColorStop(1,'rgba(0,0,0,0)');
  oc.fillStyle=g; oc.beginPath(); oc.arc(0,0,1,0,6.2832); oc.fill();
  return poolCv;
}

/* ══ 상태 ═══════════════════════════════════════════════════════════════
   흩어진 boolean 더미를 만들지 않는다. 화면은 이 객체의 함수다.          */
var S = {
  screen : 'launcher',   /* launcher | workspace                          */
  phase  : 'idle',       /* idle focused prepared working settled running */
  focus  : null,         /* 집힌 자리 id                                  */
  lens   : null,         /* null | 'deep'                                 */
  input  : '',
  problems : ['pay','store'],   /* 순서 = 지표 번호 = World의 번호        */
  fixed  : {},
  result : null,
  showChanged : false,
  runOn  : false, runT0 : 0,
  workKey: null,  workT0: 0,
  justNow: null,
  hover  : null,
  note   : null,         /* 판 머리에 한 줄. 다음 행동에서 사라진다        */
  obsNote: null,
  past   : null          /* 이전 평형 — 되돌리기용                        */
};

function placeName(id){
  for(var i=0;i<PLACES.length;i++) if(PLACES[i].id===id) return PLACES[i].name;
  return null;
}
function problemAt(placeId){
  for(var i=0;i<S.problems.length;i++)
    if(PROBLEM_DEFS[S.problems[i]].place===placeId) return S.problems[i];
  return null;
}
function ordOf(key){ return S.problems.indexOf(key)+1; }
function fmt(ms){
  var s=Math.max(0,Math.floor(ms/1000));
  return (s/60|0)+':'+('0'+(s%60)).slice(-2);
}

/* ══ 몸 — 모델은 하나뿐이다. 상태가 바뀌면 목표값만 바꾼다 ══════════════ */
var M=null, GRID=null, SEAMS={}, FK=Q.D(0,20);

function newBody(problemKeys, focusId){
  var m=Q.newModel(), i;
  Q.add(m,Q.mkPlace({id:'base',semantic:false,x:410,y:268,rx:336,ry:156,
    rot:-0.05,amp:0.40,mass:0.9}));
  for(i=0;i<PLACES.length;i++){
    var a=PLACES[i];
    Q.add(m,Q.mkPlace({id:a.id,names:[a.name],x:a.x,y:a.y,rx:a.rx,ry:a.ry,
      rot:a.rot,amp:a.amp,mass:a.mass,dir:a.dir}));
  }
  for(i=0;i<VOIDS.length;i++) m.voids.push(VOIDS[i]);
  return m;
}
function buildMain(){
  M=newBody(); GRID=Q.newGrid(); SEAMS={};
  syncWorld(true);
}
/* 상태 → 몸. 개별 값을 튕겨 보내고 물리가 나머지를 한다. */
function syncWorld(instant){
  var i,k,p,def;
  /* ① 자리의 질량 — 문제가 있으면 부풀고, 고쳐지면 새 평형으로 가라앉는다 */
  for(i=0;i<PLACES.length;i++){
    var a=PLACES[i]; p=M.byId[a.id];
    k=problemAt(a.id);
    var amp=a.amp;
    if(k) amp=PROBLEM_DEFS[k].amp;
    else { for(var fk in S.fixed) if(S.fixed[fk] && PROBLEM_DEFS[fk].place===a.id)
             amp=PROBLEM_DEFS[fk].settledAmp; }
    p.amp.t=amp;
    if(S.workKey && PROBLEM_DEFS[S.workKey].place===a.id) p.rx.t=a.rx*1.14;
    else p.rx.t=a.rx;
    /* ② 집힘 — 집힌 자리의 결은 조여들고 나머지는 발언권을 잃는다 */
    var on=(a.id===S.focus);
    p.coh.t = S.focus ? (on?1.55:0.40) : 1;
    p.lab.t = on?1:0;
    if(instant){ p.amp.v=p.amp.t; p.rx.v=p.rx.t; p.coh.v=p.coh.t; p.lab.v=p.lab.t; }
  }
  /* ③ 이음매 — 문제 하나 = 이음매 하나 */
  for(i=0;i<S.problems.length;i++){
    k=S.problems[i]; def=PROBLEM_DEFS[k];
    if(!SEAMS[k]){
      var s=Q.addSeam(M,{id:k,x:def.seam.x,y:def.seam.y,rx:def.seam.rx,ry:def.seam.ry,
        off:0,res:Q.BASE_RES,tint:def.seam.tint,brk:def.seam.brk||0});
      SEAMS[k]=s;
      if(instant){ s.off.v=def.seam.off; s.res.v=def.seam.res; }
    }
    SEAMS[k].dying=false;
    SEAMS[k].tint=def.seam.tint;
    SEAMS[k].off.t=def.seam.off;
    SEAMS[k].res.t=def.seam.res;
  }
  for(k in SEAMS){
    if(S.problems.indexOf(k)<0){
      /* 상태가 바뀌었으므로 색은 즉시 사라지고, 결은 눈에 보이게 다시 맞춰진다 */
      SEAMS[k].tint=0; SEAMS[k].off.t=0; SEAMS[k].res.t=Q.BASE_RES; SEAMS[k].dying=true;
    }
  }
  /* ④ 일하는 동안 — 그 자리만 실제로 흔들린다 */
  M.breath = (S.phase==='working' && S.workKey)
    ? {id:PROBLEM_DEFS[S.workKey].place, amp:0.085, w:0.0058} : null;
  FK.t = S.focus?1:0;
  if(instant) FK.v=FK.t;
  reapSeams();
}
function reapSeams(){
  for(var k in SEAMS){
    var s=SEAMS[k];
    if(s.dying && s.off.v<0.004){
      var i=M.seams.indexOf(s); if(i>=0) M.seams.splice(i,1);
      delete SEAMS[k];
    }
  }
}

/* ══ 애니메이션 — 상태 전이는 잘라 붙이지 않는다. 몸이 움직인다 ══════════ */
var raf=0, lastTs=0, cvSize={w:0,h:0}, scaleNow=1;
function req(){ if(!M) return; if(!raf) raf=requestAnimationFrame(tick); }
function tick(ts){
  raf=0;
  if(!M) return;
  var dt=Math.min(0.034,(ts-lastTs)/1000); if(!(dt>0)) dt=0.016; lastTs=ts;
  var moving=false, i, p, k;
  for(i=0;i<M.places.length;i++){
    p=M.places[i];
    moving = Q.stepD(p.amp,dt)|moving; moving = Q.stepD(p.rx,dt)|moving;
    moving = Q.stepD(p.coh,dt)|moving; moving = Q.stepD(p.lab,dt)|moving;
  }
  for(i=0;i<M.seams.length;i++){
    moving = Q.stepD(M.seams[i].off,dt)|moving;
    moving = Q.stepD(M.seams[i].res,dt)|moving;
  }
  moving = Q.stepD(FK,dt)|moving;
  reapSeams();
  draw(ts);
  if(S.phase==='working' || S.runOn) clocks();
  if(moving || S.phase==='working' || S.runOn) req();
}
function clocks(){
  var t=performance.now();
  var el=document.getElementById('clk');
  if(el) el.textContent = fmt(t - (S.phase==='working'?S.workT0:S.runT0));
  var rh=document.getElementById('runHint');
  if(S.runOn && rh) rh.textContent = fmt(t-S.runT0)+' · 멈추기';
}

/* ── 몸을 그린다. 판이 커지면 잘리지 않고 다시 자리잡는다 ────────────────── */
var BB={x0:120,y0:104,x1:754,y1:448};
function draw(now){
  var host=document.getElementById('world'); if(!host) return;
  var cv=document.getElementById('cv'), ctx=cv.getContext('2d');
  var hw=host.clientWidth, hh=host.clientHeight;
  if(hw<2||hh<2) return;
  var s=Math.min((hw-150)/(BB.x1-BB.x0),(hh-64)/(BB.y1-BB.y0));
  s=Math.max(0.52,Math.min(1.70,s)); scaleNow=s;
  if(cvSize.w!==Q.W*DPR || cvSize.h!==Q.H*DPR){
    cv.width=Q.W*DPR; cv.height=Q.H*DPR; cvSize={w:cv.width,h:cv.height};
  }
  var lwK=0.95/s;
  ctx.setTransform(DPR,0,0,DPR,0,0);
  ctx.clearRect(0,0,Q.W,Q.H);
  ctx.lineCap='round'; ctx.lineJoin='round';

  Q.compute(GRID,M,now||0,null);
  var P=Q.newPaths(); Q.tess(GRID,P); Q.streams(GRID,P,null);

  var fk=FK.v, fp=S.focus?M.byId[S.focus]:null;
  var dimBase=(S.lens==='deep')?0.26:0.42;
  paint(ctx,P,1-fk*(1-dimBase),lwK);
  if(fp && fk>0.012){
    var off=lightPool(P,fp,lwK);
    ctx.save(); ctx.setTransform(1,0,0,1,0,0);
    ctx.globalAlpha=Math.min(1,fk);
    ctx.drawImage(off,0,0);
    ctx.restore();
  }
  drawMarks(ctx,s,fk);

  cv.style.width=(Q.W*s)+'px'; cv.style.height=(Q.H*s)+'px';
  cv.style.left=Math.round(hw/2 - 437*s)+'px';
  cv.style.top =Math.round(hh/2 - 275*s)+'px';
}
/* 번호는 World가 스스로 붙인다. 아래 지표의 같은 번호와 같은 것을 가리킨다.
   이름은 집혔거나 가리켰을 때만 뒤따른다 — 지도와 범례의 관계다. */
function drawMarks(ctx,s,fk){
  var list=[], i, k, def, p;
  for(i=0;i<S.problems.length;i++){
    k=S.problems[i]; def=PROBLEM_DEFS[k]; p=M.byId[def.place]; if(!p) continue;
    list.push({p:p,n:String(i+1),
      name:(def.place===S.focus)?def.title:null,
      strong:(def.place===S.focus)});
  }
  if(S.focus && !problemAt(S.focus)){
    p=M.byId[S.focus];
    if(p) list.push({p:p,n:'',name:placeName(S.focus),strong:true});
  }
  if(S.hover && S.hover!==S.focus && !problemAt(S.hover)){
    p=M.byId[S.hover];
    if(p) list.push({p:p,n:'',name:placeName(S.hover),strong:false,soft:true});
  }
  if(S.hover && S.hover!==S.focus && problemAt(S.hover)){
    for(i=0;i<list.length;i++) if(list[i].p.id===S.hover){
      list[i].name=PROBLEM_DEFS[problemAt(S.hover)].title; list[i].soft=true;
    }
  }
  ctx.textBaseline='middle'; ctx.textAlign='left';
  var nf='500 '+(14/s).toFixed(2)+'px '+'ui-monospace,Menlo,monospace';
  var tf='700 '+(15/s).toFixed(2)+'px "Noto Sans KR","Malgun Gothic",sans-serif';
  for(i=0;i<list.length;i++){
    var it=list[i], px=it.p.x.v, py=it.p.y.v, nw=0, tw=0, gap=12/s;
    if(it.n){ ctx.font=nf; nw=ctx.measureText(it.n).width; }
    if(it.name){ ctx.font=tf; tw=ctx.measureText(it.name).width; }
    var tot=nw+(it.n&&it.name?gap:0)+tw, sx=px-tot/2;
    ctx.miterLimit=2;
    ctx.strokeStyle='rgba(255,255,255,0.90)'; ctx.lineWidth=4.5/s;
    if(it.n){ ctx.font=nf; ctx.strokeText(it.n,sx,py); }
    if(it.name){ ctx.font=tf; ctx.strokeText(it.name,sx+nw+(it.n?gap:0),py); }
    if(it.n){
      ctx.font=nf;
      ctx.fillStyle=it.strong?'rgba(13,12,11,0.95)':'rgba(13,12,11,'+(0.72*(1-fk*0.42)).toFixed(2)+')';
      ctx.fillText(it.n,sx,py);
    }
    if(it.name){
      ctx.font=tf;
      ctx.fillStyle=it.soft?'rgba(74,70,65,0.86)':'rgba(13,12,11,0.96)';
      ctx.fillText(it.name,sx+nw+(it.n?gap:0),py);
    }
    ctx.lineCap='round'; ctx.lineJoin='round';
  }
}

/* ══ 화면 ═══════════════════════════════════════════════════════════════ */
function esc(t){ return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;'); }

function bandHTML(){
  var n=S.problems.length, i, k, def, rows='', right, label, cls='';

  if(S.lens==='deep' && S.focus){
    var a=ANATOMY[S.focus]||ANATOMY.auth, name=placeName(S.focus);
    var pk=problemAt(S.focus);
    var sub = pk ? '이 자리를 이루는 것 · '+esc(PROBLEM_DEFS[pk].human)
                 : '이 자리를 이루는 것 · 지금은 조용해요';
    function col(t,rowsArr){
      var h='<div><div class="ch">'+t+'</div>';
      for(var j=0;j<rowsArr.length;j++){
        var r=rowsArr[j];
        h+='<div class="l'+(r[2]?' g':'')+'">'+esc(r[0])
          +(r[1]?'<u>'+esc(r[1])+'</u>':'')+'</div>';
      }
      return h+'</div>';
    }
    return {cls:'deep', html:
      '<div class="dh"><b>'+esc(name)+'</b><span>'+sub+'</span></div>'
      +'<div class="cols">'+col('파일',a.files)+col('바깥과의 관계',a.rel)+col('증거',a.ev)+'</div>'
      +'<div class="df">이 자리 밖의 것은 여기 없습니다.<div class="sp"></div>'
      +'<button type="button" data-act="closeDeep">닫기</button></div>'};
  }

  if(S.phase==='settled' && S.result){
    var d=S.result.def;
    return {cls:'res', html:
      '<div class="bh2"><span class="lb ok">확인됨</span><div class="sp"></div>'
      +'<span class="ac">'+(n?'남은 문제 <em>'+n+'</em>':'남은 문제 <em>0</em>')+'</span></div>'
      +'<div class="h">'+esc(d.result.title)+'</div>'
      +'<div class="d">'+esc(d.result.body)+'</div>'
      +'<div class="ev">'+esc(d.result.measure)+'</div>'
      +(S.showChanged?'<div class="chg">'+esc(d.result.changed)+'</div>':'')
      +'<div class="ac2">'
      +'<button type="button" data-act="changed">'
      +(S.showChanged?'접기':'무엇이 바뀌었나요?')+'</button>'
      +'<button type="button" class="pt" data-act="rollback">이전으로 돌아가기</button>'
      +'</div>'};
  }

  if(S.phase==='working' && S.workKey){
    def=PROBLEM_DEFS[S.workKey];
    return {cls:'', html:
      '<div class="bh2"><span class="lb a">고치는 중</span><div class="sp"></div>'
      +'<span class="ac"><span id="clk">0:00</span> · '
      +'<button type="button" data-act="stopWork" class="ac"><span class="stop">멈추기</span></button>'
      +'</span></div>'
      +'<div class="ix"><div class="r on"><i>'+ordOf(S.workKey)+'</i><b>'+esc(def.title)+'</b>'
      +'<span>'+esc(def.working)+'</span></div></div>'};
  }

  if(S.phase==='running'){
    return {cls:'', html:
      '<div class="bh2"><span class="lb a">실행 관측</span><div class="sp"></div>'
      +'<span class="ac"><span id="clk">0:00</span> · '
      +'<button type="button" data-act="stopRun" class="ac"><span class="stop">멈추기</span></button>'
      +'</span></div>'
      +'<div class="ix"><div class="r"><i>·</i><b>주문 서비스</b>'
      +'<span>'+esc(RUN_OBSERVE.watching)+'</span></div></div>'};
  }

  if(S.phase==='prepared' && S.focus && problemAt(S.focus)){
    k=problemAt(S.focus); def=PROBLEM_DEFS[k];
    var chips='';
    for(i=0;i<def.context.length;i++)
      chips += (i<2?'<b>':'<span>')+esc(def.context[i])+(i<2?'</b>':'</span>');
    return {cls:'', html:
      '<div class="bh2"><span class="lb">고칠 문제</span><div class="sp"></div>'
      +'<button type="button" class="ac" data-act="clearFocus">다른 문제 보기</button></div>'
      +'<div class="ix"><div class="r on"><i>'+ordOf(k)+'</i><b>'+esc(def.title)
      +(S.justNow===k?'<em>방금</em>':'')+'</b>'
      +'<span>'+esc(def.human)+'</span></div></div>'
      +'<div class="ldg"><span class="lb">준비됨</span>'+chips
      +'<div class="sp"></div><span class="ac">JuQode가 알아서 모았어요</span></div>'};
  }

  /* idle · focused — 문제 지표 */
  label='문제';
  right = S.note ? '<span class="ac">'+esc(S.note)+'</span>'
        : S.obsNote ? '<span class="ac">실행 관측 · '+esc(S.obsNote)+'</span>'
        : S.justNow ? '<span class="ac">방금 실행에서 발견</span>'
        : '<span class="ac">전부 <em>'+n+'</em></span>';
  for(i=0;i<S.problems.length;i++){
    k=S.problems[i]; def=PROBLEM_DEFS[k];
    var on=(def.place===S.focus), dim=(S.focus&&!on);
    rows+='<button type="button" class="r'+(on?' on':'')+(dim?' dim':'')+'" '
      +'data-act="pick" data-key="'+k+'" aria-pressed="'+(on?'true':'false')+'">'
      +'<i>'+(i+1)+'</i><b>'+esc(def.title)
      +(S.justNow===k?'<em>방금</em>':'')+'</b>'
      +'<span>'+esc(def.human)+'</span></button>';
  }
  if(!S.problems.length)
    rows='<div class="r"><i>·</i><b>고칠 것이 없어요</b>'
        +'<span>실행해서 실제 동작을 보면 새로 찾을 수 있어요</span></div>';
  return {cls:'', html:
    '<div class="bh2"><span class="lb">'+label+'</span><div class="sp"></div>'+right+'</div>'
    +'<div class="ix">'+rows+'</div>'};
}

function render(){
  document.getElementById('launcher').hidden = (S.screen!=='launcher');
  document.getElementById('ws').hidden       = (S.screen!=='workspace');
  if(S.screen!=='workspace') return;

  var n=S.problems.length;

  /* 상단 왼쪽 — 상태는 늘 사람 말 한 마디로 있다 */
  var st=document.getElementById('swState');
  if(S.phase==='working'){ st.textContent='고치는 중 · 문제 '+n; st.className='st a'; }
  else if(n){ st.textContent='문제 '+n; st.className='st f'; }
  else { st.textContent='확인됨'; st.className='st'; }

  /* 상단 가운데 — 유일한 동사 */
  var run=document.getElementById('btnRun');
  document.getElementById('runLabel').textContent = S.runOn?'실행 중':'실행';
  document.getElementById('runHint').textContent  = S.runOn?fmt(performance.now()-S.runT0)+' · 멈추기':RUNKEY;
  run.className = 'verb'+(S.runOn?' on':'');
  run.setAttribute('aria-pressed', S.runOn?'true':'false');

  /* 상단 오른쪽 — 렌즈 */
  var ld=document.getElementById('lensDeep');
  ld.setAttribute('aria-pressed', S.lens==='deep'?'true':'false');
  if(S.focus){ ld.removeAttribute('aria-disabled'); ld.title='이 자리의 해부도를 엽니다'; }
  else { ld.setAttribute('aria-disabled','true'); ld.title='먼저 자리를 하나 고르세요'; }

  /* 도구 판 — 하나. 절대 쌓이지 않는다 */
  var band=document.getElementById('band');
  var show = !!(S.problems.length || S.phase!=='idle' || S.note || S.obsNote || S.lens);
  band.hidden = !show;
  if(show){
    var b=bandHTML();
    band.className='band'+(b.cls?' '+b.cls:'');
    band.innerHTML=b.html;
  }

  /* 말하는 한 줄 — 주어는 제품이 쓴다 */
  document.getElementById('subj').textContent = S.focus? placeName(S.focus) : '주문 서비스';
  var hint=document.getElementById('hint'), inp=document.getElementById('inp');
  inp.value=S.input;
  if(S.input.trim() && S.focus && problemAt(S.focus)){
    hint.className='hint'; hint.innerHTML='<u>⏎</u> QODE';
  } else if(S.input.trim() && !S.focus){
    hint.className='hint na'; hint.textContent='문제 번호를 누르세요';
  } else if(S.input.trim() && S.focus){
    hint.className='hint na'; hint.textContent='이 자리엔 고칠 문제가 없어요';
  } else if(S.phase==='working'){
    var other=n-(S.workKey?1:0);
    hint.className='hint'; hint.textContent = other>0?'다른 문제 '+other:'';
  } else { hint.className='hint'; hint.textContent=''; }

  document.getElementById('world').className='world'+(S.screen==='workspace'?' pick':'');
  req();
}

/* ══ 행동 ═══════════════════════════════════════════════════════════════ */
var workTimer=0, runTimer=0;

function clearNote(){ S.note=null; S.obsNote=null; }
/* 무엇을 누르든 커서는 말하는 줄로 돌아온다 — 치는 것이 주 행위이므로.
   실제로 눌러 보고 알았다: 이것이 없으면 Enter 가 방금 누른 버튼을 다시 누른다. */
function refocus(){
  if(S.screen!=='workspace') return;
  var inp=document.getElementById('inp');
  if(inp && document.activeElement!==inp) inp.focus({preventScroll:true});
}

function focusPlace(id){
  clearNote();
  if(S.phase==='working') return;
  S.focus = (S.focus===id)?null:id;
  if(!S.focus) S.lens=null;
  S.phase = S.focus ? (S.input.trim()&&problemAt(S.focus)?'prepared':'focused') : 'idle';
  if(S.phase!=='settled') S.result=null;
  syncWorld(); render();
}
function clearFocus(){
  clearNote();
  S.focus=null; S.lens=null; S.input=''; S.phase='idle'; S.result=null;
  syncWorld(); render();
}
function snapshot(){
  return {problems:S.problems.slice(), fixed:JSON.parse(JSON.stringify(S.fixed)),
          focus:S.focus, justNow:S.justNow};
}
function startQode(){
  clearNote();
  if(!S.input.trim()) return;
  if(!S.focus){ S.note='고칠 문제를 먼저 고르세요'; render(); return; }
  var k=problemAt(S.focus);
  if(!k){ S.note='이 자리엔 아직 고칠 문제가 없어요'; render(); return; }
  S.past=snapshot();
  S.workKey=k; S.workT0=performance.now();
  S.phase='working'; S.lens=null; S.input=''; S.justNow=null; S.result=null;
  syncWorld(); render();
  clearTimeout(workTimer); workTimer=setTimeout(finishQode,2700);
}
function finishQode(){
  var k=S.workKey; if(!k) return;
  S.fixed[k]=true;
  S.problems=S.problems.filter(function(x){ return x!==k; });
  S.result={key:k, def:PROBLEM_DEFS[k]};
  S.showChanged=false;
  S.phase='settled'; S.workKey=null;
  S.focus=null;                     /* 몸이 통째로 새 평형으로 가라앉는다 */
  syncWorld(); render();
}
function stopWork(){
  clearTimeout(workTimer);
  var k=S.workKey; S.workKey=null;
  S.phase = k?'focused':'idle';
  S.focus = k?PROBLEM_DEFS[k].place:null;
  syncWorld(); render();
}
function rollback(){
  if(!S.past) return;
  S.problems=S.past.problems.slice();
  S.fixed=S.past.fixed;
  S.justNow=S.past.justNow;
  S.focus=S.past.focus;
  S.result=null; S.showChanged=false;
  S.phase=S.focus?'focused':'idle';
  S.past=null;
  syncWorld(); render();
}
function toggleRun(){
  clearNote();
  if(S.runOn){
    S.runOn=false; clearTimeout(runTimer);
    if(S.phase==='running') S.phase=S.focus?'focused':'idle';
    render(); return;
  }
  if(S.phase==='working') return;
  S.runOn=true; S.runT0=performance.now(); S.phase='running';
  S.lens=null; S.result=null; S.justNow=null;
  render(); req();
  clearTimeout(runTimer); runTimer=setTimeout(observe,2400);
}
/* 실행은 입력이 아니라 관측이다. 실제 동작이 몸에 들어온다. */
function observe(){
  var k=RUN_OBSERVE.finds;
  if(S.problems.indexOf(k)<0 && !S.fixed[k]){
    S.problems.unshift(k);                       /* 새 문제가 1번이 된다 */
    S.justNow=k;
    S.focus=PROBLEM_DEFS[k].place;               /* 그 자리가 스스로 집힌다 */
    S.phase='focused'; S.obsNote=null;
  } else {
    S.justNow=null; S.focus=null; S.phase='idle';
    S.obsNote = S.fixed[k]?RUN_OBSERVE.clean:RUN_OBSERVE.known;
  }
  syncWorld(); render();
}
function toggleDeep(){
  if(!S.focus) return;
  S.lens = (S.lens==='deep')?null:'deep';
  render();
}

/* ══ 런처 ═══════════════════════════════════════════════════════════════ */
function buildDash(){
  var m=Q.newModel();
  Q.add(m,Q.mkPlace({id:'base',semantic:false,x:410,y:268,rx:336,ry:156,rot:-0.05,amp:0.42,mass:0.9}));
  var ps=[['화면 진입',214,166,148,56,0.50,0.30,8],['로그인',424,196,130,58,0.62,0.45,44],
          ['편집기',330,318,176,78,0.85,0.60,-10],['설정',596,206,118,52,0.42,0.25,-38]];
  for(var i=0;i<ps.length;i++){var a=ps[i];
    Q.add(m,Q.mkPlace({id:'p'+i,names:[a[0]],x:a[1],y:a[2],rx:a[3],ry:a[4],amp:a[5],mass:a[6],dir:a[7]}));}
  return m;
}
function buildPipe(){
  var m=Q.newModel();
  Q.add(m,Q.mkPlace({id:'base',semantic:false,x:410,y:268,rx:336,ry:156,rot:-0.05,amp:0.40,mass:0.9}));
  var ps=[['수집',216,182,142,58,0.52,0.30,12],['정규화',392,220,138,68,0.72,0.45,-16],
          ['관계',556,264,136,70,0.80,0.55,-40],['저장',312,352,186,78,1.18,0.95,-56],
          ['내보내기',648,190,108,50,0.44,0.30,30]];
  for(var i=0;i<ps.length;i++){var a=ps[i];
    Q.add(m,Q.mkPlace({id:'p'+i,names:[a[0]],x:a[1],y:a[2],rx:a[3],ry:a[4],amp:a[5],mass:a[6],dir:a[7]}));}
  m.voids.push({x:600,y:190,rx:42,ry:29,depth:0.94});
  return m;
}
function orderMini(){
  var m=newBody();
  var d1=PROBLEM_DEFS.pay.seam, d2=PROBLEM_DEFS.store.seam, s;
  s=Q.addSeam(m,{id:'a',x:d1.x,y:d1.y,rx:d1.rx,ry:d1.ry,off:d1.off,res:d1.res,tint:d1.tint});
  s.off.v=d1.off; s.res.v=d1.res;
  s=Q.addSeam(m,{id:'b',x:d2.x,y:d2.y,rx:d2.rx,ry:d2.ry,off:d2.off,res:d2.res,tint:d2.tint});
  s.off.v=d2.off; s.res.v=d2.res;
  m.byId.pay.amp.v=PROBLEM_DEFS.pay.amp; m.byId.store.amp.v=PROBLEM_DEFS.store.amp;
  return m;
}
function paintMini(cv,m){
  var s=0.33, lwK=1.05/s;
  cv.width=Q.W*DPR; cv.height=Q.H*DPR;
  var ctx=cv.getContext('2d'); ctx.setTransform(DPR,0,0,DPR,0,0);
  ctx.lineCap='round'; ctx.lineJoin='round';
  var gr=Q.newGrid(); Q.compute(gr,m,0,null);
  var P=Q.newPaths(); Q.tess(gr,P); Q.streams(gr,P,null);
  paint(ctx,P,1.10,lwK);
  cv.style.width=(Q.W*s)+'px'; cv.style.height=(Q.H*s)+'px';
  cv.style.left=Math.round(131 - 437*s)+'px';
  cv.style.top =Math.round(51 - 275*s)+'px';
}
function buildLauncher(){
  var host=document.getElementById('recent'), h='', i;
  for(i=0;i<RECENT.length;i++){
    var r=RECENT[i];
    var cnt = r.open ? '<em>'+S.problems.length+'</em><i>문제</i>'
                     : '<span class="ok">확인됨</span>';
    h += '<'+(r.open?'button':'div')+' class="lr" '
      +(r.open?'type="button" data-open="'+r.id+'"':'aria-disabled="true" '
        +'title="Phase 4A 프로토타입에서는 주문 서비스만 열립니다"')+'>'
      +'<div class="mini"><canvas id="mini-'+r.id+'"></canvas></div>'
      +'<div class="meta"><b>'+esc(r.name)+'</b><span>'+esc(r.human)+'</span></div>'
      +'<div class="when">'+esc(r.when)+'</div>'
      +'<div class="cnt">'+cnt+'</div>'
      +'</'+(r.open?'button':'div')+'>';
  }
  host.innerHTML=h;
  paintMini(document.getElementById('mini-order'), orderMini());
  paintMini(document.getElementById('mini-dash'),  buildDash());
  paintMini(document.getElementById('mini-pipe'),  buildPipe());
  host.addEventListener('click',function(e){
    var b=e.target.closest('[data-open]'); if(!b) return;
    openSoftware();
  });
}
function openSoftware(){
  S.screen='workspace'; S.phase='idle';
  render();
  requestAnimationFrame(function(){ buildMain(); draw(0); render(); refocus(); });
}

/* ══ 사건 ═══════════════════════════════════════════════════════════════ */
function wire(){
  document.getElementById('btnRun').addEventListener('click',function(){ toggleRun(); refocus(); });
  document.getElementById('lensDeep').addEventListener('click',function(){ toggleDeep(); refocus(); });

  document.getElementById('band').addEventListener('click',function(e){
    var b=e.target.closest('[data-act]'); if(!b) return;
    var a=b.getAttribute('data-act');
    if(a==='pick')       focusPlace(PROBLEM_DEFS[b.getAttribute('data-key')].place);
    else if(a==='clearFocus') clearFocus();
    else if(a==='stopWork')   stopWork();
    else if(a==='stopRun')    toggleRun();
    else if(a==='changed'){ S.showChanged=!S.showChanged; render(); }
    else if(a==='rollback')   rollback();
    else if(a==='closeDeep'){ S.lens=null; render(); }
    refocus();
  });

  var inp=document.getElementById('inp');
  inp.addEventListener('input',function(){
    S.input=inp.value; clearNote();
    if(S.focus && problemAt(S.focus))
      S.phase = S.input.trim()?'prepared':'focused';
    render(); inp.focus();
  });
  document.getElementById('say').addEventListener('submit',function(e){
    e.preventDefault(); startQode();
  });

  /* World 를 직접 겨냥한다 — SEE → POINT → SAY */
  var cv=document.getElementById('cv');
  function at(e){
    var r=cv.getBoundingClientRect();
    var ex=(e.clientX-r.left)/scaleNow, ey=(e.clientY-r.top)/scaleNow;
    var hit=Q.meaningAt(M,ex,ey);
    return hit.length?hit[0].p.id:null;
  }
  cv.addEventListener('mousemove',function(e){
    if(!M) return;
    var id=at(e);
    if(id!==S.hover){ S.hover=id; cv.style.cursor=id?'pointer':'default'; req(); }
  });
  cv.addEventListener('mouseleave',function(){ if(S.hover){ S.hover=null; req(); } });
  cv.addEventListener('click',function(e){
    if(!M) return;
    var id=at(e); if(id){ focusPlace(id); refocus(); }
  });

  window.addEventListener('keydown',function(e){
    if(S.screen!=='workspace') return;
    if((e.metaKey||e.ctrlKey) && (e.key==='r'||e.key==='R')){ e.preventDefault(); toggleRun(); }
    else if(e.key==='Escape'){
      if(S.lens){ S.lens=null; render(); }
      else if(S.focus) clearFocus();
    }
  });
  window.addEventListener('resize',function(){ if(M){ draw(performance.now()); } });
}

/* ══ 부팅 ═══════════════════════════════════════════════════════════════ */
function boot(){
  document.getElementById('boot').remove();
  buildLauncher();
  wire();
  /* 근거 이미지 채취용 — 실제 상태 기계를 그대로 쓴다 */
  window.JQ_DEV = {S:S, open:openSoftware, focus:focusPlace, run:toggleRun,
    qode:startQode, deep:toggleDeep, render:render,
    say:function(t){ S.input=t; document.getElementById('inp').value=t;
      if(S.focus&&problemAt(S.focus)) S.phase=t.trim()?'prepared':'focused'; render(); }};
  render();
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot);
else boot();

})();
