import {ID,HSR,esc,num,clone,turnKey} from "./core.mjs";
import {panel,prompt,option,field,select,check} from "./ui.mjs";
import {activitiesFor} from "./planner.mjs";
import {useMidiActivity} from "./midi.mjs";
import {hsrApi} from "./hsr.mjs";
const SOCKET=`module.${ID}`;
export const REACTION_TYPES=[["shield","Shield"],["terrain","Difficult terrain"],["obstruction","Obstruction / cover"],["status","Status effect"],["ac","Change AC"],["save","Change saving throw"],["tempHP","Temporary HP"],["movement","Change movement speed"],["energy","Change HSR Energy"],["toughness","Change Toughness"],["item","Use a reaction item / spell"],["other","Other / manual change"]];
const durations=[["nextTurn","Until affected token's next turn"],["nextAction","Until this/next NPC action resolves"],["combatEnd","Until combat ends"],["permanent","Until removed manually"]];
function tokens(){return canvas.tokens.placeables.filter(t=>t.actor&&!t.document.hidden);}
function ownedTokens(){return tokens().filter(t=>game.user.isGM||t.actor.testUserPermission(game.user,"OWNER"));}
export async function reactionForm({defaults={},signal,title="Record a reaction"}={}){
  const owned=ownedTokens(),all=tokens(),sources=owned.map(t=>[t.id,t.name]);
  if(!sources.length)return null;
  const sourceId=defaults.sourceId??owned[0].id,targetId=defaults.targetId??sourceId;
  const statuses=(CONFIG.statusEffects??[]).map(s=>[s.id,game.i18n.localize(s.name??s.label??s.id)]);
  const html=`<p>The GM reviews player requests before applying changes.</p><div class="tsnpc-form-grid">${select("Reaction type","type",REACTION_TYPES,defaults.type??"shield")}${select("Reacting token","sourceId",sources,sourceId)}${select("Affected token / area center","targetId",all.map(t=>[t.id,t.name]),targetId)}${field("Bonus / amount (+ or −)","amount",defaults.amount??5,"number")}${select("Duration","duration",durations,defaults.duration??"nextTurn")}${select("Status","statusId",statuses,defaults.statusId??statuses[0]?.[0])}${select("Saving throw ability","ability",[["all","All saves"],["str","Strength"],["dex","Dexterity"],["con","Constitution"],["int","Intelligence"],["wis","Wisdom"],["cha","Charisma"]],defaults.ability??"all")}${field("Area width (grid spaces)","width",defaults.width??2,"number","min=1 max=100")}${field("Area height (grid spaces)","height",defaults.height??2,"number","min=1 max=100")}${field("Terrain cost multiplier","multiplier",defaults.multiplier??2,"number","min=1 max=10")}</div><label class="tsnpc-field"><span>Reaction item / spell (optional for Shield)</span><select name="activityId"></select></label>${check("Consume this token's reaction","consumeReaction",defaults.consumeReaction!==false)}${check("Apply status (uncheck to remove)","statusActive",defaults.statusActive!==false)}${check("Obstruction also blocks line of sight","blocksSight",defaults.blocksSight!==false)}<label class="tsnpc-field"><span>Notes / other change</span><textarea name="notes" rows="3">${esc(defaults.notes??"")}</textarea></label><p class="tsnpc-muted">Shield or AC bonuses affect pending hit checks. Saving throw bonuses affect pending saves. An item/spell uses its real activity and consumes its configured resources. Other changes can be made on the sheet while combat stays paused.</p>`;
  return prompt({title,html,signal,buttons:[{id:"save",label:game.user.isGM?"Apply reaction":"Send request to GM",primary:true},{id:"cancel",label:"Cancel"}],onRender:app=>{
    const source=app.element.querySelector("[name=sourceId]"),activity=app.element.querySelector("[name=activityId]");
    const fill=()=>{const token=canvas.tokens.get(source.value);const entries=activitiesFor(token.actor).filter(e=>String(e.activity.activation?.type??e.item.system.activation?.type??"").startsWith("reaction"));activity.innerHTML=option("","Manual change (no item)",defaults.activityId)+entries.map(e=>option(e.activity.id,`${e.item.name} · ${e.activity.name||e.activity.type}`,defaults.activityId)).join("");};
    fill();source.addEventListener("change",fill);
    const type=app.element.querySelector("[name=type]");type.addEventListener("change",()=>{const amount=app.element.querySelector("[name=amount]");if(type.value==="shield")amount.value=5;});
  },onAction:(id,values)=>id==="save"?values:null});
}
function effectExpiry(request,context,target){
  return {type:request.duration??"nextTurn",combatId:game.combat?.id,round:num(game.combat?.round),turnKey:turnKey(game.combat),tokenId:target.id,sessionId:context.session?.id,afterAction:num(context.session?.completedActions)+1};
}
async function addBonusEffect(target,key,amount,name,expiry){
  return target.actor.createEmbeddedDocuments("ActiveEffect",[{name,img:"icons/svg/shield.svg",origin:target.actor.uuid,disabled:false,transfer:false,changes:[{key,mode:CONST.ACTIVE_EFFECT_MODES.ADD,value:String(amount),priority:20}],flags:{[ID]:{expiry}}}]);
}
export async function applyReaction(request,context={}){
  if(!game.user.isGM)throw new Error("Only the GM can apply reactions.");
  const source=canvas.tokens.get(request.sourceId),target=canvas.tokens.get(request.targetId);
  if(!source?.actor||!target?.actor)throw new Error("Choose valid reacting and affected tokens.");
  if(context.userId){const user=game.users.get(context.userId);if(!user?.active||!source.actor.testUserPermission(user,"OWNER"))throw new Error("This player does not own the reacting token.");}
  if(request.consumeReaction&&MidiQOL.hasUsedReaction?.(source.actor))throw new Error(`${source.name} already used its reaction. Uncheck reaction consumption for an environmental/manual change.`);
  const amount=num(request.amount),expiry=effectExpiry(request,context,target);
  let usedItem=false;
  if(request.activityId){
    const entry=activitiesFor(source.actor).find(e=>e.activity.id===request.activityId);
    if(!entry||!String(entry.activity.activation?.type??entry.item.system.activation?.type??"").startsWith("reaction"))throw new Error("Select an actual reaction activity.");
    source.control({releaseOthers:true});
    const result=await useMidiActivity(source,{itemId:entry.item.id,activityId:entry.activity.id,targetIds:[target.id],rule:{},activation:"reaction"},{isReaction:true});
    if(result.aborted)throw new Error("The reaction item was cancelled; no extra change was applied.");
    usedItem=true;
    context.session?.token?.control({releaseOthers:true});
  }
  // A Shield item owns its AC effect; never add a second +5 on top.
  if(!usedItem){
    switch(request.type){
      case "shield":case "ac":await addBonusEffect(target,"system.attributes.ac.bonus",request.type==="shield"?(amount||5):amount,`${request.type==="shield"?"Shield":"AC reaction"} (${amount>=0?"+":""}${amount})`,expiry);break;
      case "save":{
        const key=request.ability&&request.ability!=="all"?`system.abilities.${request.ability}.bonuses.save`:"system.bonuses.abilities.save";
        if(!["str","dex","con","int","wis","cha","all"].includes(request.ability))throw new Error("Select a valid saving throw ability.");
        await addBonusEffect(target,key,amount,`Save reaction (${amount>=0?"+":""}${amount})`,expiry);break;
      }
      case "movement":await addBonusEffect(target,"system.attributes.movement.walk",amount,`Movement reaction (${amount})`,expiry);break;
      case "tempHP":await target.actor.update({"system.attributes.hp.temp":Math.max(num(target.actor.system.attributes.hp.temp),Math.max(0,amount))});break;
      case "energy":{
        const api=hsrApi();if(!api?.setEnergy)throw new Error("The HSR Energy API is unavailable.");
        const config=api.getConfig(target.actor);await api.setEnergy(target.actor,num(config.current)+amount);break;
      }
      case "toughness":{
        const config=target.actor.getFlag(HSR,"toughness");if(!config)throw new Error("The affected token has no HSR Toughness configuration.");
        await target.actor.update({[`flags.${HSR}.toughness.current`]:Math.max(0,Math.min(num(config.max,100),num(config.current)+amount))});break;
      }
      case "status":{
        if(!(CONFIG.statusEffects??[]).some(s=>s.id===request.statusId))throw new Error("Select a valid status effect.");
        const previous=new Set(target.actor.effects.map(e=>e.id));
        await target.actor.toggleStatusEffect(request.statusId,{active:request.statusActive!==false});
        const added=target.actor.effects.filter(e=>!previous.has(e.id));
        for(const e of added)await e.setFlag(ID,"expiry",expiry);break;
      }
      case "terrain":case "obstruction":{
        const size=canvas.grid.size,width=Math.max(1,Math.min(100,num(request.width,2)))*size,height=Math.max(1,Math.min(100,num(request.height,2)))*size;
        const area={id:foundry.utils.randomID(),kind:request.type==="terrain"?"terrain":"obstruction",x:target.document.x+target.w/2-width/2,y:target.document.y+target.h/2-height/2,width,height,level:target.document.level,multiplier:Math.max(1,Math.min(10,num(request.multiplier,2))),blocksSight:request.blocksSight!==false,expiry};
        const areas=clone(canvas.scene.getFlag(ID,"areas")??[]);areas.push(area);await canvas.scene.setFlag(ID,"areas",areas);break;
      }
      case "item":throw new Error("Select the reaction item/spell to use.");
      case "other":ui.notifications.info("Combat remains paused. Apply the described change on the sheet or map, then Continue.");break;
      default:throw new Error("Choose a supported reaction type.");
    }
  }
  if(request.consumeReaction&&!MidiQOL.hasUsedReaction?.(source.actor))await MidiQOL.setReactionUsed?.(source.actor);
  Hooks.callAll("tsnpcReactionApplied",request,{source,target,...context});
  await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor:source.actor,token:source.document}),content:`<p><strong>${esc(source.name)} reacts:</strong> ${esc(REACTION_TYPES.find(([id])=>id===request.type)?.[1]??request.type)} → ${esc(target.name)}${usedItem?" (item resolved)":""} ${esc(request.notes??"")}</p>`});
  return {replan:["terrain","obstruction","status","movement","toughness","energy","other"].includes(request.type)};
}
function expired(expiry,{combat,session,actionDone=false,combatEnded=false}={}){
  if(!expiry||expiry.type==="permanent")return false;
  if(combatEnded)return expiry.combatId===combat?.id;
  if(!combat?.started&&expiry.combatId)return true;
  if(expiry.combatId&&expiry.combatId!==combat?.id)return false;
  if(expiry.type==="nextAction")return actionDone&&session?.id===expiry.sessionId&&session.completedActions>=expiry.afterAction;
  if(expiry.type==="nextTurn")return combat?.combatant?.tokenId===expiry.tokenId&&turnKey(combat)!==expiry.turnKey;
  return false;
}
export async function cleanupReactions(context={}){
  if(!game.user.isGM)return;
  const actors=new Map();for(const actor of game.actors??[])actors.set(actor.uuid,actor);
  for(const scene of game.scenes??[])for(const token of scene.tokens??[])if(token.actor)actors.set(token.actor.uuid,token.actor);
  for(const token of canvas.tokens?.placeables??[])if(token.actor)actors.set(token.actor.uuid,token.actor);
  for(const actor of actors.values()){
    const ids=actor.effects.filter(e=>expired(e.getFlag(ID,"expiry"),context)).map(e=>e.id);
    if(ids.length)await actor.deleteEmbeddedDocuments("ActiveEffect",ids);
  }
  for(const scene of game.scenes){const all=scene.getFlag(ID,"areas")??[],keep=all.filter(a=>!expired(a.expiry,context));if(keep.length!==all.length)await scene.setFlag(ID,"areas",keep);}
}
export class ReactionManager {
  constructor(){this.current=null;this.playerWindow=null;this.playerPause=null;}
  async checkpoint({session,phase,summary,step,workflow,signal}){
    if(signal?.aborted)return {stop:true};
    const pauseId=foundry.utils.randomID();let finish;
    const result=new Promise(resolve=>{finish=resolve;});
    const pause={id:pauseId,session,phase,summary,step,workflow,requests:[],answers:new Map(),replan:false,finish,app:null};this.current=pause;
    const close=async result=>{
      if(this.current!==pause)return;
      this.current=null;if(result.stop)session.controller?.abort();game.socket.emit(SOCKET,{type:"closePause",pauseId,gmId:game.user.id});
      await pause.app?.close();finish(result);
    };
    const update=()=>{
      const root=pause.app?.element?.querySelector(".tsnpc-request-list");if(!root)return;
      root.innerHTML=pause.requests.filter(r=>!r.handled).map(r=>`<div class="tsnpc-request"><span><b>${esc(game.users.get(r.userId)?.name??"Player")}</b> · ${esc(r.data.type)} · ${esc(canvas.tokens.get(r.data.sourceId)?.name??"token")}</span><button type="button" data-command="review:${esc(r.id)}">Review</button><button type="button" data-command="deny:${esc(r.id)}">Dismiss</button></div>`).join("")||"<p>No reaction requests pending.</p>";
      const answer=pause.app.element.querySelector(".tsnpc-player-answers");if(answer)answer.textContent=[...pause.answers].map(([id,value])=>`${game.users.get(id)?.name??"Player"}: ${value}`).join(" · ");
    };pause.update=update;
    pause.app=panel({title:`Reaction pause · ${session.token.name}`,html:`<h2>${esc(summary)}</h2><p class="tsnpc-phase">${phase==="attack"?"Before AC / hits":phase==="save"?"Before saving throws":"Action finished"}</p><p>Ask the players whether they react. Continue advances only when you click it.</p><div class="tsnpc-player-answers"></div><div class="tsnpc-request-list"></div>`,
      buttons:[{id:"continue",label:"Continue — no more reactions",primary:true},{id:"record",label:"Yes — record a reaction"},{id:"replan",label:"Continue and replan"},{id:"stop",label:"Stop NPC automation"}],onRender:update,
      onClose:()=>{if(this.current===pause)void close({stop:true});},onAction:async(id)=>{
        if(id==="record"){
          const data=await reactionForm({signal,defaults:{sourceId:step?.targetIds?.[0]??session.token.id,targetId:step?.targetIds?.[0]??session.token.id}});if(!data)return;
          const applied=await applyReaction(data,{session,phase});pause.replan||=applied.replan;update();return;
        }
        if(id.startsWith("review:")){
          const request=pause.requests.find(r=>r.id===id.slice(7));if(!request||request.handled)return;
          const data=await reactionForm({signal,title:`Approve reaction · ${game.users.get(request.userId)?.name}`,defaults:request.data});if(!data)return;
          const applied=await applyReaction(data,{session,phase,userId:request.userId});request.handled=true;pause.replan||=applied.replan;update();return;
        }
        if(id.startsWith("deny:")){const request=pause.requests.find(r=>r.id===id.slice(5));if(request)request.handled=true;update();return;}
        if(["continue","replan"].includes(id)&&pause.requests.some(r=>!r.handled)){ui.notifications.warn("Review or dismiss pending player requests first.");return;}
        if(id==="stop")return close({stop:true});
        if(id==="continue"||id==="replan")return close({replan:pause.replan||id==="replan"});
      }});
    const abort=()=>void close({stop:true});signal?.addEventListener("abort",abort,{once:true});
    if(game.settings.get(ID,"playerPrompts"))game.socket.emit(SOCKET,{type:"openPause",pauseId,gmId:game.user.id,sceneId:canvas.scene.id,tokenId:session.token.id,summary,phase});
    try{return await result;}finally{signal?.removeEventListener("abort",abort);}
  }
  handleSocket(payload){
    if(!payload||typeof payload!=="object")return;
    if(payload.type==="openPause"&&!game.user.isGM){
      const gm=game.users.get(payload.gmId),selected=game.settings.get(ID,"gmUser")||game.users.activeGM?.id;
      if(!gm?.active||!gm.isGM||selected&&selected!==gm.id)return;
      if(canvas.scene?.id!==payload.sceneId)return;
      this.playerPause=payload;
      void this.playerWindow?.close();
      this.playerWindow=panel({title:"NPC action — reaction window",width:440,html:`<h2>${esc(payload.summary)}</h2><p>The GM is waiting for reactions.</p>`,buttons:[{id:"no",label:"No reaction",primary:true},{id:"yes",label:"Yes — react"}],onAction:async id=>{
        if(this.playerPause?.pauseId!==payload.pauseId)return;
        if(id==="no"){game.socket.emit(SOCKET,{type:"answer",pauseId:payload.pauseId,userId:game.user.id,answer:"No reaction"});await this.playerWindow?.close();return;}
        const data=await reactionForm();if(!data||this.playerPause?.pauseId!==payload.pauseId)return;
        game.socket.emit(SOCKET,{type:"request",pauseId:payload.pauseId,userId:game.user.id,data});await this.playerWindow?.close();
      }});return;
    }
    if(payload.type==="closePause"&&!game.user.isGM&&this.playerPause?.pauseId===payload.pauseId&&this.playerPause?.gmId===payload.gmId){this.playerPause=null;void this.playerWindow?.close();return;}
    if(!game.user.isGM||!this.current||this.current.id!==payload.pauseId)return;
    const user=game.users.get(payload.userId);if(!user?.active||user.isGM)return;
    if(payload.type==="answer"){this.current.answers.set(user.id,"No reaction");this.current.update?.();}
    if(payload.type==="request"){
      const data=payload.data,source=canvas.tokens.get(data?.sourceId);if(!source?.actor?.testUserPermission(user,"OWNER")||!REACTION_TYPES.some(([type])=>type===data.type))return;
      if(this.current.requests.filter(r=>r.userId===user.id&&!r.handled).length>=3)return;
      this.current.requests.push({id:foundry.utils.randomID(),userId:user.id,data});this.current.answers.set(user.id,"Reaction requested");this.current.update?.();
    }
  }
}
