import {ID, aStar, budgetPath, num, movementSpeed} from "./core.mjs";
export function position(token) { return {x:token.document.x, y:token.document.y, elevation:num(token.document.elevation), level:token.document.level,action:token.actor?.statuses?.has?.("prone")?"crawl":"walk"}; }
export function center(token, p = position(token)) { return {...p, x:p.x + token.w/2, y:p.y + token.h/2}; }
export function distance(token, target, p = position(token)) {
  const a = center(token,p), b = center(target);
  const measured = canvas.grid?.measurePath?.([a,b])?.distance;
  const planar = num(measured, Math.hypot(a.x-b.x,a.y-b.y) / canvas.grid.size * canvas.scene.grid.distance);
  const allowance = Math.max(0,(Math.max(token.document.width, token.document.height)-1)/2) + Math.max(0,(Math.max(target.document.width,target.document.height)-1)/2);
  const flat = Math.max(0,planar - allowance * canvas.scene.grid.distance);
  return Math.hypot(flat, a.elevation-b.elevation);
}
export function sameLevel(token, target) { return !token.document.level || !target.document.level || token.document.level === target.document.level; }
export function lineOfSight(token, target, p = position(token)) {
  if (!sameLevel(token,target)) return false;
  const a = center(token,p), b = center(target);
  try {
    for(const area of areas()){
      if(area.kind!=="obstruction"||!area.blocksSight)continue;
      const steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/(canvas.grid.size/4)));
      for(let i=0;i<=steps;i++)if(contains(area,{...a,x:a.x+(b.x-a.x)*i/steps,y:a.y+(b.y-a.y)*i/steps}))return false;
    }
    return !token.checkCollision(b,{origin:a,type:"sight",mode:"any"});
  } catch { return false; }
}
export function visibleTarget(token, target) {
  if (target.document.hidden || !target.actor || !sameLevel(token,target)) return false;
  const invisible = target.actor.statuses?.has?.("invisible");
  if (invisible) {
    try { if (!globalThis.MidiQOL?.canSense?.(token,target)) return false; } catch { return false; }
  }
  // Awareness uses LOS; movement may subsequently route around a blocking wall.
  return lineOfSight(token,target);
}
function areas() { return canvas.scene?.getFlag?.(ID,"areas") ?? []; }
function contains(a, p) { return p.x>=a.x && p.y>=a.y && p.x<=a.x+a.width && p.y<=a.y+a.height && (a.level == null || p.level===a.level); }
function overlaps(a,b) { return a.x < b.x+b.width-1 && a.x+a.width > b.x+1 && a.y < b.y+b.height-1 && a.y+a.height > b.y+1; }
export function canTraverse(token, from, to, cfg = {}) {
  const r = canvas.dimensions.sceneRect;
  if (to.x<r.x || to.y<r.y || to.x+token.w>r.x+r.width || to.y+token.h>r.y+r.height) return false;
  const box={x:to.x,y:to.y,width:token.w,height:token.h};
  if ((canvas.tokens.placeables??[]).some(t => t.id!==token.id && t.actor && sameLevel(token,t) && Math.abs(num(t.document.elevation)-num(to.elevation)) < canvas.scene.grid.distance && num(t.actor.system?.attributes?.hp?.value,1)>0 && overlaps(box,{x:t.document.x,y:t.document.y,width:t.w,height:t.h}))) return false;
  const fromCenter=center(token,from),toCenter=center(token,to);
  for (const area of areas()) {
    if (area.kind!=="obstruction") continue;
    const steps=Math.max(1,Math.ceil(Math.hypot(toCenter.x-fromCenter.x,toCenter.y-fromCenter.y)/(canvas.grid.size/3)));
    for(let i=0;i<=steps;i++){
      const box={x:from.x+(to.x-from.x)*i/steps,y:from.y+(to.y-from.y)*i/steps,width:token.w,height:token.h};
      if((area.level==null||area.level===to.level)&&overlaps(area,box))return false;
    }
  }
  // Probe footprint, not just the center of a large token.
  const offsets=[[token.w/2,token.h/2],[2,2],[token.w-2,2],[2,token.h-2],[token.w-2,token.h-2]];
  try {
    for(const [x,y] of offsets) if(token.checkCollision({...to,x:to.x+x,y:to.y+y},{origin:{...from,x:from.x+x,y:from.y+y},type:"move",mode:"any"}))return false;
  } catch { return false; }
  return true;
}
export function segmentCost(token, from, to) {
  let cost;
  const base=num(canvas.grid?.measurePath?.([center(token,from),center(token,to)])?.distance,Math.hypot(to.x-from.x,to.y-from.y)/canvas.grid.size*canvas.scene.grid.distance);
  const crawling=token.actor?.statuses?.has?.("prone");
  try {
    const waypoints=token.createTerrainMovementPath?.([from,to],{preview:false})??[from,to];
    const result=token.measureMovementPath?.(waypoints,{preview:false}) ?? token.document.measureMovementPath?.(waypoints);
    cost=num(result?.cost,num(result?.distance,NaN));
  }catch{}
  if(!Number.isFinite(cost))cost=base+(crawling?base:0);
  else if(crawling&&game.settings.get("dnd5e","movementAutomation")==="none")cost+=base;
  // Custom reaction areas stack as the highest multiplier, matching difficult terrain.
  const midway={...to,x:(from.x+to.x)/2+token.w/2,y:(from.y+to.y)/2+token.h/2};
  const multiplier=areas().filter(a=>a.kind==="terrain"&&contains(a,midway)).reduce((m,a)=>Math.max(m,num(a.multiplier,2)),1);
  return Math.max(cost,base*multiplier+(crawling?base:0));
}
function neighbors(token,p) {
  const grid=canvas.grid, step=grid.size;
  if(grid.isHexagonal && grid.getAdjacentOffsets && grid.getOffset && grid.getCenterPoint){
    const off=grid.getOffset(center(token,p));
    return grid.getAdjacentOffsets(off).map(o=>{const c=grid.getCenterPoint(o);return {...p,x:c.x-token.w/2,y:c.y-token.h/2};});
  }
  return [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]].map(([x,y])=>({...p,x:p.x+x*step,y:p.y+y*step}));
}
function blocked(token,from,to,cfg){
  if(!canTraverse(token,from,to,cfg))return true;
  if(!canvas.grid.isHexagonal&&from.x!==to.x&&from.y!==to.y){
    if(!canTraverse(token,from,{...from,x:to.x},cfg)||!canTraverse(token,from,{...from,y:to.y},cfg))return true;
  }
  return false;
}
function densify(path, token) {
  if(!path?.length)return [];
  const out=[path[0]],step=canvas.grid.size;
  for(let i=1;i<path.length;i++){
    const a=path[i-1],b=path[i],count=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/step));
    for(let j=1;j<=count;j++)out.push({...a,...b,x:a.x+(b.x-a.x)*j/count,y:a.y+(b.y-a.y)*j/count});
  }
  return out;
}
export class Navigator {
  constructor(token,cfg) { this.token=token; this.cfg=cfg; }
  async route(target,{range=5,minRange=0,budget=movementSpeed(this.token.actor),origin=position(this.token),flee=false}={}){
    const token=this.token,unit=canvas.scene.grid.distance;
    const goal=p=>flee?distance(token,target,p)>=range:distance(token,target,p)<=range+0.01&&distance(token,target,p)>=minRange-0.01&&lineOfSight(token,target,p);
    if(goal(origin)||budget<=0)return {path:[origin],cost:0,reached:goal(origin)};
    const heuristic=p=>flee?Math.max(0,range-distance(token,target,p)):Math.max(0,distance(token,target,p)-range, minRange-distance(token,target,p));
    const at=center(token,origin),enemy=center(target);
    // Prefer Foundry's native job so installed routing/region/level integrations participate.
    const endpoints=[];
    const rings=flee?[range]:[Math.max(unit,Math.min(range,unit)),Math.max(unit,range),Math.max(unit,minRange)];
    for(const radius of rings) for(let i=0;i<8;i++){
      const angle=i*Math.PI/4,cx=enemy.x+Math.cos(angle)*radius/unit*canvas.grid.size,cy=enemy.y+Math.sin(angle)*radius/unit*canvas.grid.size;
      const p=token.getSnappedPosition?.({x:cx-token.w/2,y:cy-token.h/2})??{x:cx-token.w/2,y:cy-token.h/2};
      const endpoint={...origin,...p};if(goal(endpoint))endpoints.push(endpoint);
    }
    endpoints.sort((a,b)=>Math.hypot(a.x-origin.x,a.y-origin.y)-Math.hypot(b.x-origin.x,b.y-origin.y));
    let best=null;
    if(typeof token.findMovementPath==="function")for(const endpoint of endpoints.slice(0,4)){
      let job,timer;
      try{
        job=token.findMovementPath([origin,endpoint],{preview:false,delay:0,constrainOptions:{ignoreWalls:false,ignoreCost:false}});
        const native=await Promise.race([job.promise,new Promise(resolve=>{timer=setTimeout(()=>{job.cancel();resolve(null);},1200);})]);
        const path=densify(native,token);
        if(path.length<2||path.some((p,i)=>i&&blocked(token,path[i-1],p,this.cfg)))continue;
        const cut=budgetPath(path,budget,(a,b)=>segmentCost(token,a,b));
        const candidate={...cut,reached:goal(cut.path.at(-1)),native:true};
        if(candidate.reached&&(!best||candidate.cost<best.cost))best=candidate;
      }catch(error){ console.debug(`${ID} | native routing fallback`,error); }
      finally{clearTimeout(timer);}
    }
    if(best)return best;
    return aStar({start:origin,neighbors:p=>neighbors(token,p),blocked:(a,b)=>blocked(token,a,b,this.cfg),cost:(a,b)=>segmentCost(token,a,b),goal,heuristic,maxNodes:3500,budget});
  }
}
export function flankingPosition(token,target,allies,p=position(token)){
  const c=center(target),a=center(token,p),dx=a.x-c.x,dy=a.y-c.y;
  return allies.some(other=>other.id!==token.id&&distance(other,target)<=canvas.scene.grid.distance+0.1&&lineOfSight(other,target)&&((center(other).x-c.x)*dx+(center(other).y-c.y)*dy)<0);
}
