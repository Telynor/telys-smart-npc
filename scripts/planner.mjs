import {ID, HSR, num, get, configOf, hpRatio, canAct, movementSpeed, actionType, activityDamage, targetScore, chanceToHit, availableResources, meanFormula} from "./core.mjs";
import {snapshot, resolvedRule, hsrTacticalScore} from "./hsr.mjs";
import {Navigator, distance, position, center, visibleTarget, lineOfSight, flankingPosition} from "./navigation.mjs";
export function collection(value) { return value?.contents ?? (value instanceof Map || value instanceof Set ? [...value.values()] : Array.isArray(value) ? value : typeof value==="string"?[value]:Object.values(value ?? {})); }
export function activitiesFor(actor) {
  return collection(actor.items).flatMap(item => collection(item.system?.activities).map(activity => ({item,activity})));
}
function maxUses(uses,actor) { return num(uses?.max,meanFormula(uses?.max,actor.getRollData?.()??{})); }
export function spellChoice(actor,item,activity,cfg) {
  if(item.type!=="spell"||!num(item.system?.level)||activity.consumption?.spellSlot===false)return null;
  const mode=item.system?.preparation?.mode??item.system?.method;
  if(["atwill","innate","ritual"].includes(mode))return null;
  const base=num(item.system.level),spells=actor.system?.spells??{};
  const choices=[];
  for(let level=base;level<=Math.min(9,num(cfg.maxSpellLevel,9));level++)if(num(spells[`spell${level}`]?.value)>0)choices.push({key:`spell${level}`,level,base});
  if(num(spells.pact?.value)>0&&num(spells.pact?.level)>=base)choices.push({key:"pact",level:num(spells.pact.level),base});
  choices.sort((a,b)=>a.level-b.level);
  return (cfg.useUpcasting?choices.at(-1):choices[0])??false;
}
export function activityReady(token,item,activity,rule,cfg) {
  if(rule.disabled)return false;
  if(rule.requiresStance==="enhanced"&&!snapshot(token).hsr.enhanced)return false;
  if(rule.requiresStance==="normal"&&snapshot(token).hsr.enhanced)return false;
  if(token.actor.statuses?.has?.("silenced")&&item.type==="spell")return false;
  for(const uses of [item.system?.uses, activity.uses]) {
    const max=maxUses(uses,token.actor);
    if(max>0 && num(uses.spent)>=max)return false;
    if(max>0 && uses.value!=null&&num(uses.value)<=0)return false;
  }
  if(item.type==="weapon"&&item.system?.equipped===false&&rule.allowUnequipped!==true)return false;
  if(spellChoice(token.actor,item,activity,cfg)===false)return false;
  for(const c of activity.consumption?.targets??[]){
    const amount=meanFormula(c.value??1,token.actor.getRollData?.()??{});
    if(c.type==="attribute"&&num(get(token.actor.system,c.target,Infinity))<amount)return false;
    if(["itemUses","activityUses"].includes(c.type)&&c.target){
      const doc=token.actor.items.get?.(c.target)??token.actor.items.get?.(String(c.target).split(".").at(-1));
      const uses=doc?.system?.uses;
      if(uses&&maxUses(uses,token.actor)-num(uses.spent)<amount)return false;
    }
  }
  return availableResources(snapshot(token),rule);
}
function rangeFor(item,activity,rule){
  if(num(rule.range)>0)return num(rule.range);
  const r=activity.range??item.system?.range??{},units=r.units;
  if(units==="self")return 0;
  if(units==="touch")return canvas.scene.grid.distance;
  if(["any","spec"].includes(units))return num(rule.range,120);
  let value=num(r.value,num(item.system?.range?.value));
  if(units==="m"&&canvas.scene.grid.units==="ft")value*=3.28084;
  if(units==="ft"&&canvas.scene.grid.units==="m")value/=3.28084;
  if(value>0)return value;
  return activity.attack?.type?.value==="melee"||item.system?.actionType?.startsWith?.("m")?canvas.scene.grid.distance:30;
}
function damageElement(item,activity,rule){
  if(rule.element)return rule.element;
  const types=activity.damage?.parts?.flatMap(p=>collection(p.types))??[];
  return types.find(t=>typeof t==="string")??"";
}
function damageTrait(actor,prop,element) {
  const values=actor?.system?.traits?.[prop]?.value;
  return values?.has?.(element)??values?.includes?.(element)??false;
}
function attackBonus(token,item,activity){
  const rollData=item.getRollData?.()??token.actor.getRollData?.()??{};
  const ability=activity.attack?.ability??item.system?.ability??(item.type==="spell"?token.actor.system?.attributes?.spellcasting:"str");
  return num(token.actor.system?.abilities?.[ability]?.mod)+num(token.actor.system?.attributes?.prof)+(meanFormula(activity.attack?.bonus??item.system?.attackBonus??0,rollData));
}
function areaGeometry(token,target,activity,p){
  const tpl=activity.target?.template;
  if(!tpl?.type||!num(tpl.size))return null;
  const type=tpl.type,size=num(tpl.size),width=num(tpl.width,canvas.scene.grid.distance),scale=canvas.grid.size/canvas.scene.grid.distance;
  const origin=center(token,p),destination=center(target);
  const direction=Math.atan2(destination.y-origin.y,destination.x-origin.x);
  const anchored=["cone","line","ray"].includes(type);
  const x=anchored?origin.x:destination.x,y=anchored?origin.y:destination.y;
  return {type,size,width,x,y,direction:direction*180/Math.PI,elevation:origin.elevation,angle:num(tpl.angle,53.13),scale};
}
export function inArea(token,area){
  const c=center(token),dx=(c.x-area.x)/area.scale,dy=(c.y-area.y)/area.scale;
  const radial=Math.hypot(dx,dy,num(c.elevation)-num(area.elevation));
  if(["radius","sphere","circle","cylinder"].includes(area.type))return radial<=area.size+0.01;
  if(["cube","square","rect"].includes(area.type))return Math.abs(dx)<=area.size/2&&Math.abs(dy)<=area.size/2;
  let angle=Math.atan2(dy,dx)-area.direction*Math.PI/180;
  while(angle>Math.PI)angle-=Math.PI*2;while(angle<-Math.PI)angle+=Math.PI*2;
  if(area.type==="cone")return radial<=area.size&&Math.abs(angle)<=area.angle*Math.PI/360;
  if(["line","ray"].includes(area.type)){const projection=dx*Math.cos(area.direction*Math.PI/180)+dy*Math.sin(area.direction*Math.PI/180);return projection>=0&&projection<=area.size&&Math.abs(dx*Math.sin(area.direction*Math.PI/180)-dy*Math.cos(area.direction*Math.PI/180))<=area.width/2;}
  return false;
}
export class Planner {
  constructor(token,ledger={}){ this.token=token;this.cfg=configOf(token.document);this.ledger=ledger;this.nav=new Navigator(token,this.cfg); }
  combatTokens(){return collection(game.combat?.combatants).map(c=>c.token?.object??canvas.tokens.get(c.tokenId)).filter(Boolean);}
  async candidates(){
    const token=this.token,cfg=this.cfg,stats=snapshot(token),budget=Math.max(0,movementSpeed(token.actor)-num(this.ledger.movement));
    if(!canAct(token.actor))return [this.wait("Cannot act because of HP or an incapacitating status.")];
    const all=this.combatTokens(),disposition=num(token.document.disposition);
    const allies=all.filter(t=>num(t.document.disposition)===disposition&&!t.actor?.statuses?.has?.("dead"));
    const opponents=all.filter(t=>num(t.document.disposition)!==disposition&&num(t.document.disposition)!==0&&num(t.actor?.system?.attributes?.hp?.value)>0&&distance(token,t)<=cfg.detectionRange&&visibleTarget(token,t));
    const byPriority=opponents.map(t=>({t,s:targetScore(t,cfg.priority,distance(token,t))})).sort((a,b)=>b.s-a.s).slice(0,6).map(e=>e.t);
    const options=[];
    const available=activitiesFor(token.actor).map(({item,activity})=>({item,activity,rule:resolvedRule(token,item,activity,cfg)})).filter(({item,activity,rule})=>activityReady(token,item,activity,rule,cfg));
    const extras=this.ledger.pendingAttacks??[];
    const actionLeft=!this.ledger.action||extras.length>0,bonusLeft=cfg.allowBonus&&!this.ledger.bonus;
    for(const {item,activity,rule} of available){
      const activation=actionType(activity,item,rule);
      if(!["action","bonus"].includes(activation)||(activation==="action"&&!actionLeft)||(activation==="bonus"&&!bonusLeft))continue;
      if(activation==="action"&&this.ledger.action&&(activity.type!=="attack"||extras[0]?.activityId!==activity.id))continue;
      if(!["attack","save","damage","heal","utility"].includes(activity.type)&&!rule.allowOtherType)continue;
      if(activity.type==="utility"&&!rule.allowUtility)continue;
      const healing=activity.type==="heal"||rule.kind==="heal";
      const affects=activity.target?.affects?.type;
      const support=healing||(activity.type==="utility"&&affects==="self");
      const targets=affects==="self"&&!activity.target?.template?.type?[token]:healing?allies.filter(t=>hpRatio(t.actor)<=cfg.healThreshold):byPriority;
      const range=rangeFor(item,activity,rule),element=damageElement(item,activity,rule);
      for(const target of targets.slice(0,6)){
        let route={path:[position(token)],cost:0,reached:true};
        const desiredMin=cfg.movement==="range"?Math.max(0,Math.min(cfg.preferredRange,range)-canvas.scene.grid.distance):0;
        const desiredMax=cfg.movement==="range"?Math.min(range,Math.max(canvas.scene.grid.distance,cfg.preferredRange)):range;
        const needsApproach=target.id!==token.id&&(distance(token,target)>desiredMax||distance(token,target)<desiredMin||!lineOfSight(token,target));
        if(needsApproach){
          if(cfg.movement==="hold")continue;
          route=await this.nav.route(target,{range:desiredMax||canvas.scene.grid.distance,minRange:desiredMin,budget});
          if(!route.reached)continue;
        }
        const destination=route.path.at(-1);
        const area=areaGeometry(token,target,activity,destination);
        const areaTargets=area?all.filter(t=>inArea(t,area)&&lineOfSight(token,t,destination)):[target];
        const unwanted=areaTargets.filter(t=>support?num(t.document.disposition)!==disposition:num(t.document.disposition)===disposition);
        if(cfg.avoidFriendlyFire&&unwanted.length)continue;
        const intended=areaTargets.filter(t=>support?num(t.document.disposition)===disposition:num(t.document.disposition)!==disposition);
        if(!intended.length)continue;
        const damage=activityDamage(activity,item,item.getRollData?.()??{});
        const hsr=cfg.useHSR?hsrTacticalScore(stats,snapshot(target),element,rule):{score:0,reasons:[]};
        let probability=activity.type==="attack"?chanceToHit(target.actor.system?.attributes?.ac?.value,attackBonus(token,item,activity),activity.criticalThreshold??activity.attack?.critical?.threshold):1;
        if(activity.type==="save"){
          const abilities=collection(activity.save?.ability);const bonuses=abilities.map(key=>num(target.actor.system?.abilities?.[key]?.save?.value,num(target.actor.system?.abilities?.[key]?.save,num(target.actor.system?.abilities?.[key]?.mod))));
          const saveBonus=bonuses.length?Math.max(...bonuses):0;
          const dc=num(activity.save?.dc?.value,num(token.actor.system?.attributes?.spelldc,12));
          const fail=Math.max(0.05,Math.min(0.95,(dc-1-saveBonus)/20));probability=activity.damage?.onSave==="half"?fail+(1-fail)/2:fail;
        }
        let score=damage*probability*Math.max(1,intended.length)+hsr.score+num(rule.priority)+targetScore(target,cfg.priority,distance(token,target))-route.cost/8-unwanted.length*20;
        if(damageTrait(target.actor,"di",element)&&!healing)score-=60;
        if(damageTrait(target.actor,"dr",element)&&!healing)score-=damage/3;
        if(damageTrait(target.actor,"dv",element)&&!healing)score+=damage;
        if(healing)score=30+(1-hpRatio(target.actor))*40+num(rule.priority)-route.cost/8;
        const reasons=[...hsr.reasons,healing?`ally has ${Math.round(hpRatio(target.actor)*100)}% HP`:activity.type==="save"?`prepared saving throws suggest ${Math.round(probability*100)}% of full damage on average`:support?"configured self-targeted utility activity":`estimated ${Math.round(probability*100)}% hit chance`];
        const costs=[["energyCost","Energy"],["skillCost","SP"],["talentCost","Talent Points"],["punchlineCost","Punchline"],["memospriteCost","memosprite resource"]].filter(([key])=>num(rule[key])>0).map(([key,label])=>`${rule[key]} ${label}`);
        if(costs.length)reasons.push(`configured extra cost: ${costs.join(", ")}`);
        if(intended.length>1)reasons.push(`${intended.length} targets in area`);
        if(route.cost)reasons.push(`move ${Math.round(route.cost)} ${canvas.scene.grid.units} along a clear path`);
        if(cfg.flank&&flankingPosition(token,target,allies,destination)){score+=8;reasons.push("destination has an ally on the opposite side");}
        const slot=spellChoice(token.actor,item,activity,cfg);
        if(slot)reasons.push(`cast with ${slot.key} (${slot.level}${slot.level>slot.base?", upcast":""})`);
        const repeat=activation==="action"&&activity.type==="attack"&&!this.ledger.action?Math.max(1,Math.min(8,num(cfg.attacksPerAction,1))):1;
        const steps=[];
        if(route.path.length>1)steps.push({type:"move",path:route.path,cost:route.cost});
        if(activation==="action"&&this.ledger.action){for(const extra of extras)steps.push({...extra,targetIds:[target.id]});}
        else for(let i=0;i<repeat;i++)steps.push({type:"use",itemId:item.id,activityId:activity.id,targetIds:intended.map(t=>t.id),rule,slot,area,activation:i===0?activation:"multiattack",label:item.name});
        score+=damage*probability*(repeat-1);
        options.push({id:`${activity.id}:${target.id}`,label:`${item.name}${activity.name&&activity.name!==item.name?` — ${activity.name}`:""} → ${intended.map(t=>t.name).join(", ")}`,score,reasons,steps,kind:healing?"heal":"attack",activity,item,target});
      }
    }
    if(actionLeft&&!this.ledger.action&&cfg.multiattack?.length&&byPriority.length){
      for(const target of byPriority.slice(0,2)){
        const sequence=[];let sum=0;const spent={};let valid=true;
        for(const row of cfg.multiattack){
          const entry=available.find(e=>e.activity.id===row.activityId);
          if(!entry){valid=false;break;}
          const count=Math.max(1,Math.min(8,num(row.count,1)));
          for(let i=0;i<count;i++){
            if(!availableResources(stats,entry.rule,spent)){valid=false;break;}
            for(const [c,r] of [["energyCost","energy"],["skillCost","skillPoints"],["talentCost","talentPoints"],["punchlineCost","punchline"],["memospriteCost","memospriteResource"]])spent[r]=num(spent[r])+num(entry.rule[c]);
            sequence.push({type:"use",itemId:entry.item.id,activityId:entry.activity.id,targetIds:[target.id],rule:entry.rule,activation:sequence.length?"multiattack":"action",label:entry.item.name});sum+=activityDamage(entry.activity,entry.item);
          }
        }
        if(!valid||!sequence.length||sequence.length>8)continue;
        const ranges=sequence.map(s=>{const e=available.find(e=>e.activity.id===s.activityId);return rangeFor(e.item,e.activity,e.rule)});
        const route=await this.nav.route(target,{range:Math.min(...ranges),budget});
        if(!route.reached)continue;
        const steps=route.path.length>1?[{type:"move",path:route.path,cost:route.cost},...sequence]:sequence;
        options.push({id:`multi:${target.id}`,label:`Multiattack → ${target.name}`,score:sum+12-route.cost/8,reasons:[sequence.map(s=>s.label).join(" + "),"each attack pauses separately"],steps,kind:"attack",target});
      }
    }
    if(byPriority.length&&budget>0&&cfg.movement!=="hold"){
      const target=byPriority[0],flee=cfg.movement==="flee"||(hpRatio(token.actor)<=cfg.fleeThreshold);
      const range=flee?distance(token,target)+Math.max(canvas.scene.grid.distance,budget*0.75):cfg.movement==="range"?cfg.preferredRange:canvas.scene.grid.distance;
      const route=await this.nav.route(target,{range,minRange:cfg.movement==="range"?Math.max(0,cfg.preferredRange-5):0,budget,flee});
      if(route.path.length>1)options.push({id:"position",label:flee?"Retreat from the nearest threat":"Reposition for the next action",score:flee?95:4,reasons:[flee?`self-preservation at ${Math.round(hpRatio(token.actor)*100)}% HP`:`move toward ${target.name}`],steps:[{type:"move",path:route.path,cost:route.cost}],kind:"move"});
    }
    options.push(this.wait(byPriority.length?"Hold position and reserve remaining actions.":"No visible living opponents within detection range."));
    return options.sort((a,b)=>b.score-a.score).slice(0,12);
  }
  wait(reason){return {id:"wait",label:"Hold / end turn",score:-30,reasons:[reason],steps:[],kind:"wait"};}
}
export {rangeFor};
