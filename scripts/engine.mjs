import {ID,HSR,num,canAct,configOf,turnKey,specialTurn,movementSpeed} from "./core.mjs";
import {Planner,activityReady,activitiesFor} from "./planner.mjs";
import {position,canTraverse,segmentCost} from "./navigation.mjs";
import {choosePlan,clearHighlight,highlightPlan} from "./ui.mjs";
import {midiProblems,useMidiActivity,legalTargets,createAreaTemplate} from "./midi.mjs";
import {debitResources,refundResources,snapshot} from "./hsr.mjs";
import {ReactionManager,cleanupReactions} from "./reactions.mjs";
export function authority(){
  if(!game.user?.isGM)return false;
  const selected=game.settings.get(ID,"gmUser");
  const user=selected?game.users.get(selected):game.users.activeGM??game.users.filter(u=>u.active&&u.isGM).sort((a,b)=>a.id.localeCompare(b.id))[0];
  return user?.active&&user.id===game.user.id;
}
export class Engine {
  constructor(){this.active=null;this.sessions=new Map();this.reactions=new ReactionManager();this.adapters=new Map();this.timer=null;this.starting=false;}
  eligible(combat=game.combat){
    if(!canvas.ready||!combat?.started||combat.scene?.id&&combat.scene.id!==canvas.scene?.id||specialTurn(combat.combatant))return false;
    const token=combat.combatant.token?.object??canvas.tokens?.get(combat.combatant.tokenId);
    const cfg=configOf(token?.document);
    return !!token&&token.actor?.type==="npc"&&cfg.enabled&&!cfg.mainStoryBoss&&!combat.combatant.defeated;
  }
  schedule(){
    clearTimeout(this.timer);
    if(this.active&&this.active.key!==turnKey(game.combat)){this.active.suspended=!this.active.ending;this.active.controller.abort();}
    if(!authority()||!game.settings.get(ID,"enabled"))return;
    this.timer=setTimeout(()=>this.runCurrent().catch(error=>{console.error(ID,error);ui.notifications.error(`Smart NPC: ${error.message}`);}),350);
  }
  valid(session){return authority()&&!session.controller.signal.aborted&&canvas.scene?.id===session.sceneId&&turnKey(game.combat)===session.key&&game.combat?.id===session.combatId;}
  async runCurrent({force=false}={}){
    if(!authority()){if(force)ui.notifications.warn("The selected automation GM must run the NPC turn.");return;}
    if(this.starting||this.active?.running){if(force)ui.notifications.warn("An NPC turn is already being reviewed or executed.");return;}
    if(!this.eligible()){if(force)ui.notifications.warn("The current combatant must be an enabled NPC, outside an HSR special turn.");return;}
    const key=turnKey(game.combat),prior=this.sessions.get(key);
    if(prior&&!force&&!prior.suspended)return;
    const problems=midiProblems();if(problems.length){ui.notifications.error(problems.join(" "));return;}
    const token=game.combat.combatant.token?.object??canvas.tokens.get(game.combat.combatant.tokenId);
    const session={id:prior?.id??foundry.utils.randomID(),key,token,sceneId:canvas.scene.id,combatId:game.combat.id,
      controller:new AbortController(),ledger:prior?.ledger??{action:false,bonus:false,movement:0},completedActions:prior?.completedActions??0,running:true,finished:false,suspended:false,replan:false,workflow:null};
    this.sessions.set(key,session);this.active=session;this.starting=true;
    const savedControl=canvas.tokens.controlled.map(t=>t.id);
    token.control({releaseOthers:true});await canvas.animatePan({x:token.center.x,y:token.center.y,duration:250});
    this.starting=false;
    try{
      await cleanupReactions({combat:game.combat});
      let reviewed=0;
      while(this.valid(session)&&reviewed++<10){
        const plans=await new Planner(token,session.ledger).candidates();
        for(const adapter of this.adapters.values())await adapter.decoratePlans?.(plans,{token,session,snapshot:snapshot(token)});
        if(!this.valid(session))break;
        if(reviewed>1&&plans.every(p=>p.kind==="wait")){await this.endTurn(session);break;}
        const choice=await choosePlan(token,plans,{signal:session.controller.signal,remaining:reviewed>1||session.ledger.action||session.ledger.movement>0});
        if(!this.valid(session)||!choice)break;
        if(choice.command==="manual")break;
        if(choice.command==="replan")continue;
        if(choice.command==="end"||choice.plan?.kind==="wait"){await this.endTurn(session);break;}
        if(choice.command!=="execute"||!choice.plan)continue;
        if(!session.ledger.action)session.ledger.pendingAttacks=choice.plan.steps.filter(s=>s.type==="use"&&s.activation==="multiattack").map(s=>({...s}));
        session.replan=false;
        for(const step of choice.plan.steps){
          if(!this.valid(session)||!canAct(token.actor))break;
          highlightPlan(token,{steps:[step]});
          if(step.type==="move")await this.move(session,step);
          else if(step.type==="use")await this.use(session,step);
          if(session.replan||!this.valid(session))break;
        }
        clearHighlight();
      }
      if(reviewed>=10&&this.valid(session))ui.notifications.warn("Smart NPC paused after 10 planning passes. Use manual control or Resume current NPC.");
    }finally{
      clearHighlight();session.running=false;
      if(!session.suspended)session.finished=true;
      if(this.active===session)this.active=null;
      session.controller.abort();
      canvas.tokens.releaseAll();for(const id of savedControl)canvas.tokens.get(id)?.control({releaseOthers:false});
      // If an HSR interrupt ended while the cancelled workflow was cleaning up,
      // pick up the next eligible turn only after this runner has released its lock.
      if(turnKey(game.combat)!==key||session.suspended)this.schedule();
    }
  }
  async move(session,step){
    const token=session.token,signal=session.controller.signal;
    let moved=0;
    const points=step.path.slice(1);
    for(const destination of points){
      if(!this.valid(session))return;
      const origin=position(token),cost=segmentCost(token,origin,destination),budget=movementSpeed(token.actor)-session.ledger.movement;
      if(cost>budget+0.001||!canTraverse(token,origin,destination)){session.replan=true;return;}
      const completed=await token.document.move([{...destination,checkpoint:true}],{showRuler:true,constrainOptions:{ignoreWalls:false,ignoreCost:false}});
      if(!completed){session.replan=true;return;}
      await token.movementAnimationPromise;
      session.ledger.movement+=cost;moved+=cost;
      if(game.settings.get(ID,"pauseMovement")){
        session.completedActions++;
        await cleanupReactions({combat:game.combat,session,actionDone:true});
        const result=await this.reactions.checkpoint({session,phase:"move",step,summary:`${token.name} moved ${Math.round(cost)} ${canvas.scene.grid.units}.`,signal});
        if(result.stop){signal.aborted||session.controller.abort();return;}
        if(result.replan){session.replan=true;return;}
      }
    }
    if(moved&&!game.settings.get(ID,"pauseMovement")){
      session.completedActions++;await cleanupReactions({combat:game.combat,session,actionDone:true});
      const result=await this.reactions.checkpoint({session,phase:"move",step,summary:`${token.name} finished moving ${Math.round(moved)} ${canvas.scene.grid.units}.`,signal});
      if(result.stop)session.controller.abort();session.replan||=!!result.replan;
    }
  }
  async use(session,step){
    const token=session.token,cfg=configOf(token.document),item=token.actor.items.get(step.itemId),activity=item?.system?.activities?.get(step.activityId);
    if(!item||!activity||!activityReady(token,item,activity,step.rule,cfg)||!legalTargets(token,activity,item,step).length){session.replan=true;return;}
    if(step.activation==="action"&&session.ledger.action||step.activation==="bonus"&&session.ledger.bonus){session.replan=true;return;}
    for(const adapter of this.adapters.values())if(await adapter.beforeUse?.(step,{token,session})===false){session.replan=true;return;}
    const debits=await debitResources(token,step.rule);let template,launchResult;
    try{
      template=await createAreaTemplate(step);if(template)step.templateUuid=template.uuid;
      if(step.activation==="action")session.ledger.action=true;
      if(step.activation==="bonus")session.ledger.bonus=true;
      if(step.activation==="multiattack")session.ledger.pendingAttacks?.shift();
      launchResult=await useMidiActivity(token,step,{signal:session.controller.signal,onWorkflow:w=>session.workflow=w,checkpoint:async args=>{
        const result=await this.reactions.checkpoint({...args,session,signal:session.controller.signal});session.replan||=!!result.replan;return result;
      }});
      if(launchResult.aborted&&!launchResult.rolled){await refundResources(debits);session.replan=true;}
      session.completedActions++;
      await cleanupReactions({combat:game.combat,session,actionDone:true});
      for(const adapter of this.adapters.values())await adapter.afterUse?.(launchResult.workflow,{token,step,session});
      if(!this.valid(session))return;
      const result=await this.reactions.checkpoint({session,phase:"resolved",step,workflow:launchResult.workflow,summary:`${token.name}: ${step.label??item.name} ${launchResult.aborted?"was interrupted":"resolved"}.`,signal:session.controller.signal});
      if(result.stop)session.controller.abort();session.replan||=!!result.replan;
    }catch(error){
      if(!session.workflow)await refundResources(debits);
      session.controller.abort();throw error;
    }finally{
      session.workflow=null;
      if(template&&canvas.scene?.templates?.has(template.id))await template.delete();
    }
  }
  async endTurn(session){
    session.finished=true;
    if(game.settings.get(ID,"autoEndTurn")&&this.valid(session)){session.ending=true;await game.combat.nextTurn();}
  }
  stop(){this.active?.controller.abort();clearTimeout(this.timer);clearHighlight();ui.notifications.info("NPC automation stopped. You have manual control.");}
  async preview(token){if(!game.user.isGM)throw new Error("Only a GM can inspect NPC plans.");return new Planner(token).candidates();}
  registerAdapter(id,adapter){if(!id||typeof adapter!=="object")throw new Error("Provide an adapter ID and adapter object.");this.adapters.set(id,adapter);return()=>this.adapters.delete(id);}
}
