import {ID,HSR} from "../scripts/core.mjs";
export class Collection extends Map{
  constructor(values=[]){super(values.map(v=>[v.id,v]));}
  get contents(){return [...this.values()];}
  [Symbol.iterator](){return this.values();}
  map(fn){return this.contents.map(fn);}
  filter(fn){return this.contents.filter(fn);}
  find(fn){return this.contents.find(fn);}
  some(fn){return this.contents.some(fn);}
}
export const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
let counter=0;
function put(object,path,value){const keys=path.split("."),last=keys.pop();let at=object;for(const k of keys)at=at[k]??={};at[last]=value;}
export function actor(id,{type="npc",hp=30,ac=12,speed=30,flags={},statuses=[],items=[]}={}){
  const a={id,uuid:`Actor.${id}`,name:id,type,flags,statuses:new Set(statuses),system:{attributes:{hp:{value:hp,max:hp,temp:0},ac:{value:ac,bonus:"0"},movement:{walk:speed},prof:2},abilities:{str:{mod:3},dex:{mod:2,bonuses:{save:"0"}}},bonuses:{abilities:{save:"0"}},spells:{},traits:{}},items:new Collection(items),effects:new Collection(),
    getFlag(ns,key){return this.flags[ns]?.[key];},async setFlag(ns,key,value){this.flags[ns]??={};this.flags[ns][key]=value;},getRollData(){return {...this.system,mod:3,prof:2};},testUserPermission(user){return user.isGM||this.owner===user.id;},
    async update(changes){for(const [key,value] of Object.entries(changes))put(this,key,value);},
    async createEmbeddedDocuments(_type,docs){return docs.map(data=>{const e={...data,id:`effect${++counter}`,getFlag(ns,key){return this.flags?.[ns]?.[key];},async setFlag(ns,key,value){this.flags??={};this.flags[ns]??={};this.flags[ns][key]=value;}};this.effects.set(e.id,e);for(const c of e.changes??[]){if(c.key==="system.attributes.ac.bonus")this.system.attributes.ac.value+=Number(c.value);put(this,c.key,String(Number(c.value)));}return e;});},
    async deleteEmbeddedDocuments(_type,ids){for(const id of ids){const e=this.effects.get(id);for(const c of e?.changes??[])if(c.key==="system.attributes.ac.bonus")this.system.attributes.ac.value-=Number(c.value);this.effects.delete(id);}},
    async toggleStatusEffect(status,{active}){if(active){this.statuses.add(status);await this.createEmbeddedDocuments("ActiveEffect",[{name:status,statuses:[status],flags:{}}]);}else this.statuses.delete(status);}
  };
  for(const i of a.items){i.actor=a;for(const activity of i.system.activities){activity.item=i;activity.actor=a;}}
  return a;
}
export function item(id,{type="weapon",activityType="attack",damage="1d8+3",range=5,activation="action",level=0,template=null}={}){
  const activity={id:`a-${id}`,uuid:`Actor.npc.Item.${id}.Activity.a-${id}`,name:id,type:activityType,activation:{type:activation},range:{value:range,units:"ft"},target:{affects:{type:"creature"},template},attack:{type:{value:range<=5?"melee":"ranged"},ability:"str"},damage:{parts:[{formula:damage}]},consumption:{targets:[],spellSlot:level>0},uses:{max:"",spent:0}};
  return {id,name:id,type,flags:{},system:{equipped:true,uses:{max:"",spent:0},activities:new Collection([activity]),level,preparation:{mode:"prepared"}},getRollData(){return {mod:3,prof:2};},getFlag(ns,key){return this.flags[ns]?.[key];}};
}
export function token(id,a,x=0,y=0,{disposition=-1,width=1,height=1,enabled=true,flags={}}={}){
  const document={id,uuid:`Scene.scene.Token.${id}`,documentName:"Token",actor:a,x,y,elevation:0,level:null,width,height,hidden:false,disposition,texture:{src:"icons/svg/mystery-man.svg"},flags:{[ID]:{config:{enabled}},...flags},getFlag(ns,key){return this.flags[ns]?.[key];},async setFlag(ns,key,value){this.flags[ns]??={};this.flags[ns][key]=value;},async move(path){const p=path.at(-1);this.x=p.x;this.y=p.y;return true;}};
  const t={id,name:id,actor:a,document,w:width*100,h:height*100,control(){canvas.tokens.controlled=[this];},get center(){return{x:document.x+this.w/2,y:document.y+this.h/2};},getSnappedPosition(p){return{x:Math.round(p.x/100)*100,y:Math.round(p.y/100)*100};},checkCollision(destination,{origin,type}){return globalThis.collision?.(origin,destination,type)??false;},measureMovementPath(points){const result=canvas.grid.measurePath(points);return {...result,cost:result.cost+(points.some(p=>p.action==="crawl")?result.distance:0)};},createTerrainMovementPath(p){return p;},movementAnimationPromise:Promise.resolve()};document.object=t;return t;
}
export function install(tokens=[]){
  counter=0;globalThis.collision=null;const events=new Map();
  globalThis.Hooks={on(name,fn){const id=++counter;if(!events.has(name))events.set(name,new Map());events.get(name).set(id,fn);return id;},off(name,id){events.get(name)?.delete(id);},callAll(name,...args){for(const f of events.get(name)?.values()??[])void f(...args);},async emit(name,...args){for(const f of [...(events.get(name)?.values()??[])])if(await f(...args)===false)return false;return true;},events};
  globalThis.foundry={utils:{randomID:()=>`random${++counter}`,deepClone:obj=>structuredClone(obj)}};
  globalThis.CONST={ACTIVE_EFFECT_MODES:{ADD:2}};globalThis.CONFIG={statusEffects:[{id:"stunned",name:"Stunned"},{id:"prone",name:"Prone"}]};
  const gm={id:"gm",name:"GM",isGM:true,active:true,targets:new Set(),color:"#ffffff",updateTokenTargets(ids){this.targets=new Set(ids.map(id=>canvas.tokens.get(id)).filter(Boolean));}};
  const settings=new Map([[`${ID}.enabled`,true],[`${ID}.gmUser`,""],[`${ID}.playerPrompts`,false],[`${ID}.autoEndTurn`,true],[`${ID}.pauseMovement`,false]]);
  const scene={id:"scene",grid:{distance:5,units:"ft"},flags:{},tokens:new Collection(tokens.map(t=>t.document)),templates:new Collection(),getFlag(ns,key){return this.flags[ns]?.[key];},async setFlag(ns,key,value){this.flags[ns]??={};this.flags[ns][key]=value;},async createEmbeddedDocuments(type,docs){return docs.map(d=>{const doc={...d,id:`template${++counter}`,uuid:`Scene.scene.MeasuredTemplate.template${counter}`,async delete(){scene.templates.delete(this.id);}};scene.templates.set(doc.id,doc);return doc;});}};
  globalThis.canvas={ready:true,scene,dimensions:{sceneRect:{x:0,y:0,width:2000,height:2000}},tokens:{placeables:tokens,controlled:[],get:id=>tokens.find(t=>t.id===id),releaseAll(){this.controlled=[];}},grid:{size:100,isHexagonal:false,measurePath(p){let d=0;for(let i=1;i<p.length;i++)d+=Math.max(Math.abs(p[i].x-p[i-1].x),Math.abs(p[i].y-p[i-1].y))/100*5;return{distance:d,cost:d};}},async animatePan(){}};
  const users=new Collection([gm]);users.activeGM=gm;
  globalThis.game={user:gm,users,scenes:new Collection([scene]),actors:new Collection(tokens.map(t=>t.actor)),version:"14.368",system:{id:"dnd5e",version:"5.3.3"},modules:new Collection([{id:"midi-qol",active:true,version:"14.0.13"},{id:ID,active:true,version:"1.0.0"}]),settings:{get:(ns,key)=>settings.get(`${ns}.${key}`),async set(ns,key,value){settings.set(`${ns}.${key}`,value);return value;}},i18n:{localize:x=>x},socket:{emit(){}}};
  game.combat={id:"combat",round:1,started:true,combatants:new Collection(tokens.map(t=>({id:`c-${t.id}`,tokenId:t.id,token:t.document,actor:t.actor,defeated:false,getFlag(){return false;}}))),get combatant(){return this.combatants.contents[this.turn??0];},turn:0,async nextTurn(){this.turn++;}};
  globalThis.ui={notifications:{error(){},warn(){},info(){}}};
  const usedReactions=new Set();let midiSettings={autoApplyDamage:"yesCard",autoCheckHit:"all",autoCheckSaves:"allShow",preserveMe:123};
  globalThis.MidiQOL={completeActivityUse:()=>{},configSettings:()=>midiSettings,hasUsedReaction:a=>usedReactions.has(a.id),async setReactionUsed(a){usedReactions.add(a.id);},canSense:()=>false};
  globalThis.ChatMessage={getSpeaker:({actor,token})=>({actor:actor.id,token:token?.id}),async create(data){return data;}};
  return {settings,scene,gm,events,setMidiSettings:c=>midiSettings=c};
}
export function enableHSR(config={}){
  const api={getConfig:a=>({enabled:true,current:50,max:100,...a.getFlag(HSR,"ultimate")}),async setEnergy(a,value){await a.setFlag(HSR,"ultimate",{...this.getConfig(a),current:value});},getSkillPoints:()=>3,getTalentPoints:a=>a.getFlag(HSR,"ultimate")?.talentPointsCurrent??2,getPunchline:()=>4,async setSkillPoints(value){api.getSkillPoints=()=>value;},async setTalentPoints(a,value){await a.setFlag(HSR,"ultimate",{...api.getConfig(a),talentPointsCurrent:value});},async setPunchline(value){api.getPunchline=()=>value;},...config};
  game.modules.set(HSR,{id:HSR,active:true,api,version:"3.14.0-preview.5"});return api;
}
export function simulateUse(activity,{attackTotal=18,damage=8,saveTotal=8,saveDC=12,onRoll=()=>{},onDamage=()=>{}}={}){
  activity.use=async usage=>{
    const w={sequenceId:usage.sequenceId,actor:activity.item.actor,activity,item:activity.item,targets:new Set(usage.midiOptions.targetsToUse),hitTargets:new Set(),aborted:false,attackRoll:null,damageRolls:[],saveResults:[]};usage.workflow=w;
    await Hooks.emit("midi-qol.preStart",w);
    if(activity.type==="attack"){
      await Hooks.emit("midi-qol.preAttackRoll",w);
      if(!w.aborted){w.attackRoll={total:attackTotal};onRoll(w);await Hooks.emit("midi-qol.preCheckHits",w);if(!w.aborted)w.hitTargets=new Set([...w.targets].filter(t=>t.actor.system.attributes.ac.value<=attackTotal));}
    }else if(activity.type==="save"){
      await Hooks.emit("midi-qol.preCheckSaves",w);
      if(!w.aborted){w.saveResults=[...w.targets].map(t=>({total:saveTotal+Number(t.actor.system.bonuses.abilities.save||0)}));w.hitTargets=new Set([...w.targets].filter((t,i)=>w.saveResults[i].total<saveDC));}
    }else if(activity.type==="heal")w.hitTargets=w.targets;
    if(!w.aborted){w.damageRolls=[{total:damage}];for(const target of w.hitTargets){target.actor.system.attributes.hp.value+=activity.type==="heal"?damage:-damage;onDamage(target,w);}await Hooks.emit("midi-qol.RollComplete",w);}
    await Hooks.emit("midi-qol.postCleanup",w);return {workflow:w};
  };
}
