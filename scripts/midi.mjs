import {ID,num,canAct} from "./core.mjs";
import {distance,lineOfSight} from "./navigation.mjs";
import {rangeFor} from "./planner.mjs";
export function midiConfig(){return globalThis.MidiQOL?.configSettings?.()??{};}
export function midiProblems(){
  if(!game.modules.get("midi-qol")?.active||!globalThis.MidiQOL)return ["Enable midi-QOL and its required dependencies."];
  const c=midiConfig(),problems=[];
  if(!String(c.autoApplyDamage??"").toLowerCase().startsWith("yes"))problems.push("midi-QOL must automatically apply damage (Yes + damage card recommended).");
  if(!c.autoCheckHit||c.autoCheckHit==="none")problems.push("midi-QOL automatic hit checking must be enabled.");
  if(!c.autoCheckSaves||c.autoCheckSaves==="none")problems.push("midi-QOL automatic saving throws must be enabled.");
  return problems;
}
export async function configureMidi(){
  if(!game.user.isGM)throw new Error("Only a GM can configure midi-QOL.");
  const c=foundry.utils.deepClone(midiConfig());
  Object.assign(c,{autoApplyDamage:"yesCard",autoCheckHit:"all",autoCheckSaves:"allShow",gmAutoAttack:true,gmAutoDamage:"onHit",playerRollSaves:"none"});
  await game.settings.set("midi-qol","ConfigSettings",c);
  ui.notifications.info("midi-QOL automatic attacks, damage, and saving throws are configured.");
}
export function legalTargets(token,activity,item,step){
  if(!canAct(token.actor))return [];
  const range=rangeFor(item,activity,step.rule??{});
  return (step.targetIds??[]).map(id=>canvas.tokens.get(id)).filter(t=>t?.actor&&!t.document.hidden&&(activity.type==="heal"||num(t.actor.system?.attributes?.hp?.value,1)>0)&&lineOfSight(token,t)&&(step.area||t.id===token.id||distance(token,t)<=range+0.01));
}
/**
 * Native midi activity use + unlimited cleanup wait. completeActivityUse itself
 * has a 90-second timeout; it cannot safely own an untimed player reaction pause.
 * We use the same activity entry point and sequenceId, without that timeout.
 */
export async function useMidiActivity(token,step,{signal,checkpoint,onWorkflow,isReaction=false}={}){
  const item=token.actor.items.get(step.itemId),activity=item?.system?.activities?.get(step.activityId);
  if(!item||!activity)throw new Error("The planned item/activity was removed. Recalculate the turn.");
  if(typeof activity.use!=="function"||!MidiQOL.completeActivityUse)throw new Error("This midi-QOL version does not expose the supported activity API.");
  if(signal?.aborted)return {aborted:true,rolled:false};
  const targets=legalTargets(token,activity,item,step);
  if(!targets.length&&activity.target?.affects?.type!=="self")return {aborted:true,rolled:false};
  const sequenceId=foundry.utils.randomID(),hooks=[],seen=new Set(),savedTargets=[...game.user.targets].map(t=>t.id);
  let workflow,done=false,settle,rejectResult;
  const result=new Promise((resolve,reject)=>{settle=resolve;rejectResult=reject;});
  const matches=w=>w?.sequenceId===sequenceId;
  const register=(name,fn)=>hooks.push([name,Hooks.on(name,fn)]);
  const complete=w=>{if(!done){done=true;settle({workflow:w,aborted:!!w?.aborted,rolled:!!(w?.attackRoll||w?.damageRolls?.length||w?.saveResults?.length)});}};
  const receive=w=>{if(!matches(w))return;workflow=w;onWorkflow?.(w);};
  const invalidate=w=>{
    if(signal?.aborted||!canAct(token.actor)){w.aborted=true;return false;}
    const valid=legalTargets(token,activity,item,step);
    if(!valid.length&&activity.target?.affects?.type!=="self"){w.aborted=true;return false;}
    const ids=new Set(valid.map(t=>t.id));
    w.targets=new Set([...w.targets].filter(t=>ids.has(t.id)));
    w.hitTargets=new Set([...(w.hitTargets??[])].filter(t=>ids.has(t.id)));
    // midi hit processing consults the current user's targets again.
    game.user.updateTokenTargets([...ids]);return true;
  };
  const gate=phase=>async w=>{
    if(!matches(w)||isReaction)return;
    receive(w);
    if(!invalidate(w))return false;
    if(seen.has(phase))return;
    seen.add(phase);
    const answer=await checkpoint?.({phase,step,workflow:w,token,summary:phase==="attack"?`${item.name}: attack ${num(w.attackRoll?.total)} — resolve reactions before checking AC.`:`${item.name}: resolve reactions before saving throws.`});
    if(answer?.stop||!invalidate(w)){w.aborted=true;return false;}
  };
  register("midi-qol.preStart",receive);
  register("midi-qol.preCheckHits",gate("attack"));
  register("midi-qol.preCheckSaves",gate("save"));
  register("midi-qol.postCleanup",w=>{if(matches(w))complete(w);});
  register("midi-qol.postAbort",w=>{if(matches(w))complete(w);});
  register("midi-qol.preAttackRoll",w=>{if(matches(w)){receive(w);return invalidate(w);}});
  const abort=()=>{
    if(workflow){workflow.aborted=true;if(workflow.suspended&&workflow.performState)void workflow.performState(workflow.WorkflowState_Abort).catch(console.error);}
  };
  signal?.addEventListener("abort",abort);
  game.user.updateTokenTargets(targets.map(t=>t.id));
  try{
    const usage={sequenceId,subsequentActions:false,consume:{action:step.activation!=="multiattack"},
      midiOptions:{targetsToUse:new Set(targets),targetUuids:targets.map(t=>t.document.uuid),fastForward:true,fastForwardAttack:true,fastForwardDamage:true,
        workflowOptions:{autoRollAttack:true,autoRollDamage:"onHit",fastForwardAttack:true,fastForwardDamage:true,forceCompletion:true,targetConfirmation:"none",noProvokeReaction:true,notReaction:!isReaction,notBonusAction:step.activation!=="bonus"}}};
    if(step.slot){usage.spell={slot:step.slot.key};usage.scaling=step.slot.level-step.slot.base;}
    // The module creates a prepositioned AoE template; Midi still rolls the actual activity.
    if(step.templateUuid){usage.create={measuredTemplate:false};usage.midiOptions.workflowOptions.templateUuid=step.templateUuid;}
    const launch=activity.use(usage,{configure:false},{create:true,data:{speaker:ChatMessage.getSpeaker({actor:token.actor,token:token.document}),flags:{[ID]:{sequenceId}}}});
    Promise.resolve(launch).then(value=>{
      workflow??=usage.workflow;onWorkflow?.(workflow);
      if(!value||!workflow){if(!done){done=true;settle({aborted:!value,rolled:false,workflow});}}
    }).catch(error=>{if(!done){done=true;rejectResult(error);}});
    return await result;
  }finally{
    for(const [name,id] of hooks)Hooks.off(name,id);
    signal?.removeEventListener("abort",abort);
    game.user.updateTokenTargets(savedTargets.filter(id=>canvas.tokens.get(id)));
  }
}
export async function createAreaTemplate(step){
  if(!step.area)return null;
  const a=step.area,t=["sphere","radius","circle","cylinder"].includes(a.type)?"circle":["cube","square","rect"].includes(a.type)?"rect":a.type==="line"?"ray":a.type;
  const data={t,x:a.x,y:a.y,distance:a.size,direction:a.direction,angle:a.angle,width:a.width,fillColor:game.user.color?.toString?.()??"#64dfed",flags:{[ID]:{temporary:true}}};
  if(t==="rect"){data.x-=a.size/2*a.scale;data.y-=a.size/2*a.scale;data.distance=a.size*Math.SQRT2;data.direction=45;}
  const [doc]=await canvas.scene.createEmbeddedDocuments("MeasuredTemplate",[data]);return doc;
}
