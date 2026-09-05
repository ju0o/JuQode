
"use strict";
/* ── 동결된 물리 엔진 — docs/design/mvp-wireframe.html 에서 그대로 옮겼다.
   프로토타입에서 표상을 다시 만들지 않는다. 바꾼 것은 반환 목록 한 줄뿐이다. ── */
var JQ = (function(){
/* ══════════════════════════════════════════════════════════════════════════
   JuQode — Semantic Place
   재료는 3R.4 그대로다. 바뀐 것은 하나뿐이다:
   결의 방향이 상수가 아니라 의미가 정하는 값이 되었다.
   ══════════════════════════════════════════════════════════════════════════ */
var W = 864, H = 470;
var G = 7;
var SURF = 0.060;      // 겉면 레벨
var DG   = 0.034;      // 결 간격
var MASSK= 0.20;       // 질량이 그 자리의 결을 얼마나 조이는가 — 방향은 건드리지 않는다
var WARP = 50;         // 재료의 고정된 흔들림
var BASE_RES = 0.62;
var W0   = 0.20;       // 주변 결의 발언권 — 자리가 없는 곳은 이 방향으로 흐른다
var GDIR = 0.00350;    // 자리의 결도 주변과 같은 간격을 갖는다
var SEM  = 1.06;       // 뜻이 미치는 범위 (질량 타원 대비)
var AMB  = -20;        // 뜻이 없는 곳이 향하는 방향(도)
var SHLD = 0.34;       // 어깨 — 이 폭에서 결이 돈다. 선이 아니다

function resStep(r){ return r < 0.34 ? 4 : (r < 0.70 ? 2 : 1); }
function bandOf(mass){ return mass<0.26?0:(mass<0.62?1:(mass<1.04?2:3)); }

function D(v,k){ return {v:v, t:v, vel:0, k:k||24}; }
function stepD(d,dt){
  if(d.v === d.t && d.vel === 0) return false;
  var c = 2*Math.sqrt(d.k);
  d.vel += ((d.t-d.v)*d.k - d.vel*c)*dt;
  d.v   += d.vel*dt;
  if(Math.abs(d.t-d.v) < 2e-4 && Math.abs(d.vel) < 2e-3){ d.v=d.t; d.vel=0; return false; }
  return true;
}
function stiff(mass){ return 30/(1 + 2.4*(mass||0)); }

/* ── 모델 ─────────────────────────────────────────────────────────────── */
function newModel(){
  return {places:[], byId:{}, seams:[], voids:[], pulses:[], timers:[], breath:null, focus:null};
}
/* 자리 하나 = 의미 하나. 질량도 방향도 이름도 여기 붙는다. 개체가 아니라 성질이다. */
function mkPlace(o){
  var k = stiff(o.mass);
  return {id:o.id, names:o.names||[], mass:o.mass||0, rot:o.rot||0, semantic:o.semantic!==false,
    x:D(o.x,k), y:D(o.y,k), rx:D(o.rx,k), ry:D(o.ry,k), amp:D(o.amp||0,k),
    dir:D(o.dir||0, 14), coh:D(o.coh===undefined?1:o.coh, 16), lab:D(0,20)};
}
function add(m,p){ m.places.push(p); m.byId[p.id]=p; return p; }
function to(m,id,f,v){ var p=m.byId[id]; if(p) p[f].t=v; }
function jump(m,id,f,v){ var p=m.byId[id]; if(p){ p[f].v=v; p[f].t=v; p[f].vel=0; } }
function addSeam(m,o){
  var s={id:o.id, x:o.x, y:o.y, rx:o.rx, ry:o.ry,
    off:D(o.off||0,26), res:D(o.res===undefined?BASE_RES:o.res,26), tint:o.tint||0, brk:o.brk||0};
  m.seams.push(s); return s;
}
function seam(m,id){ for(var i=0;i<m.seams.length;i++) if(m.seams[i].id===id) return m.seams[i]; return null; }

/* ── 격자 ─────────────────────────────────────────────────────────────── */
function newGrid(){
  var cols=Math.ceil(W/G)+1, rows=Math.ceil(H/G)+1, n=cols*rows;
  var wx=new Float32Array(n), wy=new Float32Array(n), flow=new Float32Array(n);
  var agx=new Float32Array(n), agy=new Float32Array(n);
  var i,j,px,py,o,ax,ay,da;
  for(j=0;j<rows;j++) for(i=0;i<cols;i++){
    px=i*G; py=j*G; o=j*cols+i;
    ax=px+26*Math.sin(py*0.0132+0.7)+13*Math.sin(px*0.0207+2.1)+5*Math.sin(px*0.045+0.3);
    ay=py+19*Math.sin(px*0.0111+1.9)+10*Math.sin(py*0.0241+0.4)+4.5*Math.sin(py*0.041+1.1);
    wx[o]=ax; wy[o]=ay;
    /* 주변 결 — 뜻이 없는 곳이 향하는 방향. 완만하게 흔들린다(재료의 성질) */
    da=(AMB+7.5*Math.sin(px*0.0052+py*0.0031+1.1))*Math.PI/180;
    agx[o]=-Math.sin(da)*GDIR; agy[o]=Math.cos(da)*GDIR;
    flow[o]=0.00358*(ay*0.92+ax*0.34)+0.130*Math.sin(ax*0.0068+ay*0.0045+1.2);
  }
  return {cols:cols, rows:rows, wx:wx, wy:wy, flow:flow, agx:agx, agy:agy, warm:false,
    val:new Float32Array(n), gf:new Float32Array(n),
    ws:new Float32Array(n), gxs:new Float32Array(n), gys:new Float32Array(n),
    res:new Float32Array(n), tint:new Uint8Array(n), mask:new Uint8Array(n)};
}
function sampleFlow(gr,x,y){
  var i=Math.round(x/G), j=Math.round(y/G);
  if(i<0)i=0; if(i>gr.cols-1)i=gr.cols-1;
  if(j<0)j=0; if(j>gr.rows-1)j=gr.rows-1;
  return gr.flow[j*gr.cols+i];
}
function addMass(gr,x,y,rx,ry,rot,amp){
  if(Math.abs(amp)<0.004||rx<=1||ry<=1) return;
  var cols=gr.cols, rows=gr.rows, val=gr.val, R=Math.max(rx,ry)+WARP;
  var i0=Math.max(0,Math.floor((x-R)/G)), i1=Math.min(cols-1,Math.ceil((x+R)/G));
  var j0=Math.max(0,Math.floor((y-R)/G)), j1=Math.min(rows-1,Math.ceil((y+R)/G));
  var co=Math.cos(rot), si=Math.sin(rot), i,j,o,px,py,dx,dy,u,v,d2,w;
  for(j=j0;j<=j1;j++) for(i=i0;i<=i1;i++){
    o=j*cols+i; px=gr.wx[o]-x; py=gr.wy[o]-y;
    dx=px*co+py*si; dy=-px*si+py*co;
    u=dx/rx; v=dy/ry; d2=u*u+v*v;
    if(d2>=1) continue;
    w=1-d2; val[o]+=amp*w*w;
  }
}
/* 뜻이 미치는 범위 안에서 결의 방향을 자기 쪽으로 당긴다.
   테두리를 만들지 않는다 — 어깨에서 서서히 이긴다. */
function addDir(gr,p){
  var ax=p.x.v, ay=p.y.v, RX=p.rx.v*SEM, RY=p.ry.v*SEM, rot=p.rot;
  var coh=p.coh.v;
  /* 질량은 자기 결의 기울기를 키운다 = 그 자리의 결이 조여든다.
     방향은 그대로다 — 같은 축을 따라 더 가팔라질 뿐이다. */
  var slope=GDIR*(1+MASSK*p.amp.v);
  var vx=-Math.sin(p.dir.v*Math.PI/180)*slope, vy=Math.cos(p.dir.v*Math.PI/180)*slope;
  var cols=gr.cols, rows=gr.rows, R=Math.max(RX,RY)+WARP;
  var i0=Math.max(0,Math.floor((ax-R)/G)), i1=Math.min(cols-1,Math.ceil((ax+R)/G));
  var j0=Math.max(0,Math.floor((ay-R)/G)), j1=Math.min(rows-1,Math.ceil((ay+R)/G));
  var co=Math.cos(rot), si=Math.sin(rot), i,j,o,px,py,dx,dy,u,v,d2,d,t,w;
  for(j=j0;j<=j1;j++) for(i=i0;i<=i1;i++){
    o=j*cols+i; px=gr.wx[o]-ax; py=gr.wy[o]-ay;
    dx=px*co+py*si; dy=-px*si+py*co;
    u=dx/RX; v=dy/RY; d2=u*u+v*v;
    if(d2>=1) continue;
    d=Math.sqrt(d2); t=(1-d)/SHLD; if(t>1)t=1;
    w=coh*t*t*(3-2*t);
    if(w<0.004) continue;
    gr.ws[o]+=w; gr.gxs[o]+=w*vx; gr.gys[o]+=w*vy;
  }
}
/* 한 지점에서 어떤 뜻이 얼마나 지배하는가 — 가리킨 곳의 의미는 계산된다 */
function meaningAt(m,x,y){
  var out=[], i,p,px,py,dx,dy,u,v,d2,d,t,w,co,si;
  for(i=0;i<m.places.length;i++){
    p=m.places[i]; if(!p.semantic) continue;
    co=Math.cos(p.rot); si=Math.sin(p.rot);
    px=x-p.x.v; py=y-p.y.v;
    dx=px*co+py*si; dy=-px*si+py*co;
    u=dx/(p.rx.v*SEM); v=dy/(p.ry.v*SEM); d2=u*u+v*v;
    if(d2>=1) continue;
    d=Math.sqrt(d2); t=(1-d)/SHLD; if(t>1)t=1;
    w=t*t*(3-2*t);
    if(w>0.02) out.push({p:p, w:w});
  }
  out.sort(function(a,b){ return b.w-a.w; });
  return out;
}
function ellipseVisit(gr,x,y,rx,ry,fn){
  var cols=gr.cols, rows=gr.rows, R=Math.max(rx,ry)+WARP;
  var i0=Math.max(0,Math.floor((x-R)/G)), i1=Math.min(cols-1,Math.ceil((x+R)/G));
  var j0=Math.max(0,Math.floor((y-R)/G)), j1=Math.min(rows-1,Math.ceil((y+R)/G));
  var i,j,o,u,v,d2;
  for(j=j0;j<=j1;j++) for(i=i0;i<=i1;i++){
    o=j*cols+i;
    u=(gr.wx[o]-x)/rx; v=(gr.wy[o]-y)/ry; d2=u*u+v*v;
    if(d2<1) fn(o, Math.sqrt(d2));
  }
}

function compute(gr,m,now,attn,resOv){
  var base=(resOv===undefined? BASE_RES : resOv), i, j, p;
  var n=gr.val.length;
  gr.val.fill(0); gr.res.fill(base); gr.tint.fill(0); gr.mask.fill(0);
  /* ① 몸 */
  for(i=0;i<m.places.length;i++){
    p=m.places[i];
    var a=p.amp.v;
    if(m.breath && m.breath.id===p.id) a += m.breath.amp*Math.sin(now*m.breath.w);
    addMass(gr,p.x.v,p.y.v,p.rx.v,p.ry.v,p.rot,a);
  }
  for(i=0;i<m.pulses.length;i++){
    var pu=m.pulses[i], u=(now-pu.t0)/pu.dur;
    if(u<0||u>1) continue;
    addMass(gr, pu.x0+(pu.x1-pu.x0)*u, pu.y0+(pu.y1-pu.y0)*u, pu.rx, pu.ry, 0, pu.amp*Math.sin(Math.PI*u));
  }
  for(i=0;i<m.voids.length;i++){
    var vd=m.voids[i];
    addMass(gr, vd.x, vd.y, vd.rx*1.55, vd.ry*1.55, 0, -vd.depth);
    ellipseVisit(gr, vd.x, vd.y, vd.rx, vd.ry, function(o){ gr.mask[o]=3; });
  }
  /* ② 방향장 — 자리가 없는 곳은 주변 결로 흐른다 */
  var ws=gr.ws, gxs=gr.gxs, gys=gr.gys, flow=gr.flow;
  for(i=0;i<n;i++){ ws[i]=W0; gxs[i]=W0*gr.agx[i]; gys[i]=W0*gr.agy[i]; }
  for(i=0;i<m.places.length;i++){
    p=m.places[i];
    if(p.semantic && p.coh.v>0.02) addDir(gr,p);
  }
  /* ③ 결 — 방향장 + 질량이 눌러 조인 만큼 */
  var val=gr.val, cols=gr.cols, rows=gr.rows, iw;
  for(i=0;i<n;i++){ iw=1/ws[i]; gxs[i]*=iw; gys[i]*=iw; }
  for(i=0;i<m.seams.length;i++){
    (function(sm){
      var rr=sm.res.v, tn=sm.tint, brk=sm.brk, mr=Math.min(sm.rx,sm.ry), cut=sm.off.v;
      ellipseVisit(gr, sm.x, sm.y, sm.rx, sm.ry, function(o,d){
        var w=(1-d)/0.22; if(w>1)w=1; if(w<0)w=0;
        var f=(w-0.35)/0.30; if(f>1)f=1; if(f<0)f=0;
        if(f>0){ var v2=gr.res[o]+(rr-gr.res[o])*f; if(v2<gr.res[o]) gr.res[o]=v2; }
        if(w>0.45 && tn) gr.tint[o]=tn;
        /* 새 재료의 결은 몸의 결과 이어지지 않는다 — 경계에서 끊긴다 */
        if(cut>0.004){ var dp=(1-d)*mr; if(dp>-3 && dp<(brk?20:11)) gr.mask[o]=3; }
      });
    })(m.seams[i]);
  }
  /* 주의를 받은 자리는 결이 더 촘촘해진다 — 이름이 아니라 몸이 먼저 답한다 */
  for(i=0;i<m.places.length;i++){
    (function(p2){
      if(!p2.semantic||p2.lab.v<0.04) return;
      var st=p2.lab.v;
      ellipseVisit(gr, p2.x.v, p2.y.v, p2.rx.v*1.05, p2.ry.v*1.05, function(o,d){
        var f=(1-d)/0.45; if(f>1)f=1; if(f<0)f=0;
        var r2=base+(1-base)*st*f;
        if(r2>gr.res[o]) gr.res[o]=r2;
      });
    })(m.places[i]);
  }
  if(attn && attn.a>0.02){
    ellipseVisit(gr, attn.x, attn.y, 104, 104, function(o,d){
      var f=(1-d)*attn.a, r2=base+(1-base)*(f>1?1:f);
      if(r2>gr.res[o]) gr.res[o]=r2;
    });
  }
}

/* ── 결 뽑기 ──────────────────────────────────────────────────────────── */
function newPaths(){
  var a=[],i,j;
  for(i=0;i<4;i++){ a.push([]); for(j=0;j<6;j++) a[i].push(new Path2D()); }
  return a;
}
/* ── ① 겉면 — 몸이 끝나는 자리 (등치선 하나) ─────────────────────────── */
function tess(gr,paths,forceTint){
  var cols=gr.cols, rows=gr.rows, val=gr.val, tint=gr.tint, mask=gr.mask;
  var i,j,o,a,b,c,d,mn,mx,lv,tn,ci,xi,yj,xr,yb,tX,rY,bX,lY;
  for(j=0;j<rows-1;j++){
    yj=j*G; yb=yj+G;
    for(i=0;i<cols-1;i++){
      o=j*cols+i; xi=i*G; xr=xi+G;
      a=val[o]; b=val[o+1]; c=val[o+cols+1]; d=val[o+cols];
      mn=a; mx=a;
      if(b<mn)mn=b; else if(b>mx)mx=b;
      if(c<mn)mn=c; else if(c>mx)mx=c;
      if(d<mn)mn=d; else if(d>mx)mx=d;
      if(mx<=SURF||mn>SURF) continue;
      if(mask[o]===2) continue;
      tn=(forceTint===undefined? tint[o] : forceTint);
      lv=SURF;
      ci=(a>lv?1:0)|(b>lv?2:0)|(c>lv?4:0)|(d>lv?8:0);
      if(ci===0||ci===15) continue;
      tX=xi+G*(lv-a)/(b-a); rY=yj+G*(lv-b)/(c-b);
      bX=xi+G*(lv-d)/(c-d); lY=yj+G*(lv-a)/(d-a);
      emit(paths[tn][4],ci,a,b,c,d,lv,xi,yj,xr,yb,tX,rY,bX,lY);
    }
  }
}
/* ── ② 결 — 방향장을 따라 흐르는 선들 ────────────────────────────────────
   등치선으로는 이것을 그릴 수 없다. 방향이 자리마다 다른 장은 하나의 스칼라로
   적분되지 않기 때문이다(회전 성분이 버려진다). 그래서 결을 직접 따라 그린다.
   ──────────────────────────────────────────────────────────────────────── */
var D0=15, SEED_K=0.92, BREAK_K=0.52, STEP=3.0, MAXLEN=760;
function bilin(arr,gr,x,y){
  var fx=x/G, fy=y/G, i=fx|0, j=fy|0, cols=gr.cols;
  if(i<0)i=0; if(j<0)j=0; if(i>gr.cols-2)i=gr.cols-2; if(j>gr.rows-2)j=gr.rows-2;
  var tx=fx-i, ty=fy-j, o=j*cols+i;
  return arr[o]*(1-tx)*(1-ty)+arr[o+1]*tx*(1-ty)+arr[o+cols]*(1-tx)*ty+arr[o+cols+1]*tx*ty;
}
function nearIdx(gr,x,y){
  var i=Math.round(x/G), j=Math.round(y/G);
  if(i<0)i=0; if(j<0)j=0; if(i>gr.cols-1)i=gr.cols-1; if(j>gr.rows-1)j=gr.rows-1;
  return j*gr.cols+i;
}
function streams(gr,paths,attn,forceTint){
  var cols=gr.cols, rows=gr.rows, val=gr.val, res=gr.res, tint=gr.tint, mask=gr.mask;
  var gxs=gr.gxs, gys=gr.gys;
  /* 간격 격자 — 이미 그린 결과 너무 가까우면 새 결을 시작하지 않는다 */
  var CS=D0, gc=Math.ceil(W/CS)+1, gr2=Math.ceil(H/CS)+1;
  var buckets=new Array(gc*gr2); for(var z=0;z<buckets.length;z++) buckets[z]=null;
  function push(x,y){
    var b=((y/CS)|0)*gc+((x/CS)|0);
    if(b<0||b>=buckets.length) return;
    if(!buckets[b]) buckets[b]=[];
    buckets[b].push(x,y);
  }
  function tooClose(x,y,r){
    var bi=(x/CS)|0, bj=(y/CS)|0, r2=r*r, i,j,b,arr,k,dx,dy;
    for(j=bj-1;j<=bj+1;j++) for(i=bi-1;i<=bi+1;i++){
      if(i<0||j<0||i>=gc||j>=gr2) continue;
      arr=buckets[j*gc+i]; if(!arr) continue;
      for(k=0;k<arr.length;k+=2){ dx=arr[k]-x; dy=arr[k+1]-y; if(dx*dx+dy*dy<r2) return true; }
    }
    return false;
  }
  function sepAt(o,x,y){
    var m=val[o], d=D0/(1+0.45*m);
    var r=res[o]; if(r>0.70) d*=0.56; else if(r<0.34) d*=1.7;
    return d;
  }
  function ok(x,y){
    if(x<2||y<2||x>W-2||y>H-2) return 0;
    var o=nearIdx(gr,x,y);
    if(mask[o]===3) return 0;
    return bilin(val,gr,x,y)>SURF ? o : 0;
  }
  /* 한 줄 그리기 — 앞뒤 양쪽으로 자란다 */
  function grow(sx,sy){
    var o0=ok(sx,sy); if(!o0) return null;
    if(tooClose(sx,sy,sepAt(o0,sx,sy)*SEED_K)) return null;
    var pts=[], k, x, y, gx, gy, tx, ty, px, py, o, sgn, run, n;
    for(sgn=1;sgn>=-1;sgn-=2){
      x=sx; y=sy; px=0; py=0; run=[];
      for(k=0;k<MAXLEN/STEP;k++){
        o=ok(x,y); if(!o) break;
        gx=bilin(gxs,gr,x,y); gy=bilin(gys,gr,x,y);
        tx=-gy; ty=gx;
        n=Math.sqrt(tx*tx+ty*ty); if(n<1e-7) break;
        tx/=n; ty/=n; tx*=sgn; ty*=sgn;
        if(px||py){ if(tx*px+ty*py<0){ tx=-tx; ty=-ty; } }
        if(k>1 && tooClose(x,y,sepAt(o,x,y)*BREAK_K)) break;
        run.push(x,y); px=tx; py=ty;
        x+=tx*STEP; y+=ty*STEP;
      }
      if(sgn===1) pts=run; else { for(k=run.length-2;k>=0;k-=2) pts.unshift(run[k],run[k+1]); }
    }
    if(pts.length<10) return null;
    var mid=(pts.length>>1)&~1;
    var o1=nearIdx(gr,pts[mid],pts[mid+1]);
    var tn;
    if(forceTint!==undefined) tn=forceTint;
    else {                       /* 선 전체에서 투표 — 상태는 선 하나 단위로 읽힌다 */
      var vote=[0,0,0,0], q, oq;
      for(q=0;q<pts.length;q+=2){ oq=nearIdx(gr,pts[q],pts[q+1]); vote[tint[oq]]++; }
      tn=0; var bestv=0;
      for(q=1;q<4;q++) if(vote[q]>bestv && vote[q]*3>pts.length/2){ bestv=vote[q]; tn=q; }
    }
    var pth=paths[tn][bandOf(val[o1])];
    pth.moveTo(pts[0],pts[1]);
    for(k=2;k<pts.length;k+=2) pth.lineTo(pts[k],pts[k+1]);
    for(k=0;k<pts.length;k+=2) push(pts[k],pts[k+1]);
    return pts;
  }
  /* 씨앗은 이미 그린 결의 옆에서 나온다 — 고르게 채워지고, 난수는 없다 */
  var queue=[], head=0, best=-1, bx=0, by=0, i2, j2, oo;
  for(j2=0;j2<rows;j2++) for(i2=0;i2<cols;i2++){
    oo=j2*cols+i2; if(val[oo]<=SURF||mask[oo]===3) continue;
    if(val[oo]>best){ best=val[oo]; bx=i2*G; by=j2*G; }
  }
  if(best<0) return;
  queue.push(bx,by);
  var guard=0;
  while(head<queue.length && guard++<12000){
    var qx=queue[head], qy=queue[head+1]; head+=2;
    var pts=grow(qx,qy); if(!pts) continue;
    for(var k2=0;k2<pts.length;k2+=2){
      if(k2%8) continue;
      var o3=nearIdx(gr,pts[k2],pts[k2+1]), dd=sepAt(o3,pts[k2],pts[k2+1]);
      var ax2=bilin(gxs,gr,pts[k2],pts[k2+1]), ay2=bilin(gys,gr,pts[k2],pts[k2+1]);
      var nn=Math.sqrt(ax2*ax2+ay2*ay2); if(nn<1e-7) continue;
      ax2/=nn; ay2/=nn;
      queue.push(pts[k2]+ax2*dd, pts[k2+1]+ay2*dd);
      queue.push(pts[k2]-ax2*dd, pts[k2+1]-ay2*dd);
    }
  }
  /* 끊긴 자리로 둘러싸인 구역은 옆에서 씨앗이 넘어가지 못한다 — 남은 곳을 훑어 채운다.
     그래야 이음매 안쪽에도 결이 있고, 그 결이 바깥과 만나지 못하는 것이 보인다. */
  for(j2=0;j2<rows;j2+=2) for(i2=0;i2<cols;i2+=2){
    oo=j2*cols+i2; if(val[oo]<=SURF||mask[oo]===3) continue;
    grow(i2*G, j2*G);
  }
}
function emit(p,ci,a,b,c,d,lv,xi,yj,xr,yb,tX,rY,bX,lY){
  switch(ci){
    case 1: case 14: p.moveTo(xi,lY); p.lineTo(tX,yj); break;
    case 2: case 13: p.moveTo(tX,yj); p.lineTo(xr,rY); break;
    case 3: case 12: p.moveTo(xi,lY); p.lineTo(xr,rY); break;
    case 4: case 11: p.moveTo(xr,rY); p.lineTo(bX,yb); break;
    case 6: case 9:  p.moveTo(tX,yj); p.lineTo(bX,yb); break;
    case 7: case 8:  p.moveTo(xi,lY); p.lineTo(bX,yb); break;
    default:
      var ctr=(a+b+c+d)*0.25;
      var joinAC=(ci===5)?(ctr>lv):(ctr<=lv);
      if(joinAC){ p.moveTo(tX,yj); p.lineTo(xr,rY); p.moveTo(xi,lY); p.lineTo(bX,yb); }
      else      { p.moveTo(xi,lY); p.lineTo(tX,yj); p.moveTo(xr,rY); p.lineTo(bX,yb); }
  }
}
var TSTR=['13,12,11','154,91,18','140,43,32','91,107,132'];
var BA=[0.26,0.40,0.58,0.78,0.46,0.15], BW=[0.55,0.62,0.72,0.86,0.95,0.58];
function drawSet(ctx,paths,dim){
  for(var t=0;t<4;t++){
    var boost=(t===1||t===2)?1.35:1;
    for(var b=0;b<6;b++){
      var al=BA[b]*boost*dim; if(al>0.96) al=0.96;
      ctx.strokeStyle='rgba('+TSTR[t]+','+al.toFixed(3)+')';
      ctx.lineWidth=BW[b]*(dim<1?0.85:1);
      ctx.stroke(paths[t][b]);
    }
  }
}
return {W:W,H:H,G:G,SURF:SURF,DG:DG,BASE_RES:BASE_RES,SEM:SEM,
  TSTR:TSTR,BA:BA,BW:BW,bandOf:bandOf,stiff:stiff,
  D:D,stepD:stepD,newModel:newModel,mkPlace:mkPlace,add:add,to:to,jump:jump,
  addSeam:addSeam,seam:seam,newGrid:newGrid,compute:compute,meaningAt:meaningAt,
  newPaths:newPaths,tess:tess,streams:streams,drawSet:drawSet};
})();
