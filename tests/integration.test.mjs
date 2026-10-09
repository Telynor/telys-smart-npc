import test from "node:test";
import assert from "node:assert/strict";
import {ID,HSR,turnKey,movementSpeed} from "../scripts/core.mjs";
import {snapshot,hsrTacticalScore,debitResources,refundResources} from "../scripts/hsr.mjs";
import {Navigator,canTraverse,lineOfSight,segmentCost,position} from "../scripts/navigation.mjs";
import {Planner,activityReady,spellChoice,inArea} from "../scripts/planner.mjs";
import {useMidiActivity,configureMidi,createAreaTemplate} from "../scripts/midi.mjs";
import {applyReaction,cleanupReactions,ReactionManager} from "../scripts/reactions.mjs";
import {Engine,authority} from "../scripts/engine.mjs";
import {hsrNotes,stateBadges,panelClass} from "../scripts/ui.mjs";
import {actor,item,token,install,enableHSR,simulateUse,deferred,Collection} from "./mocks.mjs";
function combatPair({range=5,type="attack",distance=100}={}){
  const i=item("attack",{range,activityType:type});const a=actor("npc",{items:[i]}),b=actor("pc",{type:"character"});const npc=token("npc",a,100,100),pc=token("pc",b,100+distance,100,{disposition:1});install([npc,pc]);return {npc,pc,a,b,i,activity:i.system.activities.contents[0]};
}
test("Only designated NPCs are eligible; protected bosses and PCs are excluded",()=>{
  const {npc,pc}=combatPair();const e=new Engine();assert.equal(e.eligible(),true);npc.document.flags[ID].config.enabled=false;assert.equal(e.eligible(),false);npc.document.flags[ID].config={enabled:true,mainStoryBoss:true};assert.equal(e.eligible(),false);game.combat.turn=1;pc.document.flags[ID].config.enabled=true;assert.equal(e.eligible(),false);
});
test("Aha, Elation, Talent, and Ultimate interrupt turns are not automated",()=>{
  combatPair();const e=new Engine();for(const flag of ["ahaInstantCombatant","elationActionCombatant","talentTurnCombatant","temporaryUltimate"]){game.combat.combatant.getFlag=(ns,key)=>ns===HSR&&key===flag;assert.equal(e.eligible(),false);}
});
test("Only one selected GM is the authority",()=>{
  const {settings}=install();const other={id:"other",active:true,isGM:true};game.users.set(other.id,other);assert.equal(authority(),true);game.user=other;assert.equal(authority(),false);settings.set(`${ID}.gmUser`,other.id);assert.equal(authority(),true);other.active=false;assert.equal(authority(),false);
});
test("Enabling midi automation preserves unrelated midi settings",async()=>{
  const {settings}=install();await configureMidi();const c=settings.get("midi-qol.ConfigSettings");assert.equal(c.preserveMe,123);assert.equal(c.autoApplyDamage,"yesCard");assert.equal(c.playerRollSaves,"none");
});
test("HSR snapshot reads temporary weakness overrides and equipment without changing them",()=>{
  const {npc}=combatPair();enableHSR();npc.actor.flags[HSR]={ultimate:{elementId:"fire",pathId:"nihility",current:80,max:100,enhancedStanceEnabled:true,enhancedStanceActive:true},toughness:{enabled:true,current:20,max:100,weaknesses:["ice"]}};npc.document.flags[HSR]={temporaryWeaknesses:["fire"]};npc.actor._planarBonuses={speed:15};const s=snapshot(npc);assert.deepEqual(s.hsr.weaknesses,["ice","fire"]);assert.equal(s.hsr.enhanced,true);assert.equal(s.hsr.planar.speed,15);npc.document.flags[HSR].weaknessMode="none";assert.deepEqual(snapshot(npc).hsr.weaknesses,[]);
});
test("Break and Super Break influence tactics without directly applying damage",()=>{
  const a={hsr:{present:true,element:"fire",break:true,superBreak:true}},d={hsr:{toughnessEnabled:true,toughness:10,maxToughness:100,weaknesses:["fire"]}};assert(hsrTacticalScore(a,d,"fire",{}).score>20);d.hsr.toughness=0;assert.equal(hsrTacticalScore(a,d,"fire",{}).score,24);
});
test("HSR charges refund additively after an intervening gain",async()=>{
  const {npc}=combatPair();const api=enableHSR();const debits=await debitResources(npc,{energyCost:20,skillCost:1});assert.equal(snapshot(npc).hsr.energy,30);assert.equal(api.getSkillPoints(),2);await api.setEnergy(npc.actor,35);await refundResources(debits);assert.equal(snapshot(npc).hsr.energy,55);assert.equal(api.getSkillPoints(),3);
});
test("Unavailable HSR charges are rejected before any spend",async()=>{
  const {npc}=combatPair();enableHSR();await assert.rejects(()=>debitResources(npc,{energyCost:60}),/resources/);assert.equal(snapshot(npc).hsr.energy,50);
});
test("A missing resource writer cannot leave a partially charged HSR ability",async()=>{
  const {npc}=combatPair();const api=enableHSR();delete api.setSkillPoints;await assert.rejects(()=>debitResources(npc,{energyCost:20,skillCost:1}),/API is unavailable/);assert.equal(snapshot(npc).hsr.energy,50);
});
test("A resource API that rejects the write prevents the ability",async()=>{
  const {npc}=combatPair();enableHSR({async setEnergy(){}});await assert.rejects(()=>debitResources(npc,{energyCost:20}),/not accepted/);assert.equal(snapshot(npc).hsr.energy,50);
});
test("Spent uses and insufficient spell slots exclude activities",()=>{
  const {npc,i,activity}=combatPair();i.system.uses={max:1,spent:1};assert.equal(activityReady(npc,i,activity,{},{}),false);i.system.uses={max:0,spent:0};i.type="spell";i.system.level=2;activity.consumption.spellSlot=true;assert.equal(activityReady(npc,i,activity,{},{}),false);npc.actor.system.spells.spell2={value:1};assert.equal(activityReady(npc,i,activity,{},{}),true);
});
test("Upcasting selects existing slots within the NPC's limit",()=>{
  const {npc,i,activity}=combatPair();i.type="spell";i.system.level=2;activity.consumption.spellSlot=true;npc.actor.system.spells={spell2:{value:0},spell3:{value:1},spell5:{value:2}};assert.equal(spellChoice(npc.actor,i,activity,{maxSpellLevel:9,useUpcasting:false}).level,3);assert.equal(spellChoice(npc.actor,i,activity,{maxSpellLevel:4,useUpcasting:true}).level,3);assert.equal(spellChoice(npc.actor,i,activity,{maxSpellLevel:9,useUpcasting:true}).level,5);
});
test("Wall-aware fallback routing goes around a blocked direct path",async()=>{
  const {npc,pc}=combatPair({distance:500});
  globalThis.collision=(a,b,type)=>type==="move"&&((a.x<400&&b.x>=400)||(b.x<400&&a.x>=400))&&Math.min(a.y,b.y)<450;
  npc.findMovementPath=()=>({promise:Promise.resolve([{x:100,y:100},{x:500,y:100}]),cancel(){}});
  const route=await new Navigator(npc,{}).route(pc,{range:5,budget:90});assert.equal(route.reached,true);assert(route.path.some(p=>p.y>=400));for(let i=1;i<route.path.length;i++)assert(canTraverse(npc,route.path[i-1],route.path[i]));
});
test("Token footprints and occupied spaces block movement",()=>{
  const {npc,pc}=combatPair();assert.equal(canTraverse(npc,{x:100,y:100},{x:200,y:100}),false);assert.equal(canTraverse(npc,{x:100,y:100},{x:100,y:200}),true);
});
test("Reaction terrain doubles cost and obstruction blocks sight",async()=>{
  const {npc,pc}=combatPair({distance:300});await canvas.scene.setFlag(ID,"areas",[{kind:"terrain",x:100,y:100,width:300,height:200,multiplier:2}]);assert.equal(segmentCost(npc,{x:100,y:100},{x:200,y:100}),10);await canvas.scene.setFlag(ID,"areas",[{kind:"obstruction",x:250,y:100,width:30,height:100,blocksSight:true}]);assert.equal(lineOfSight(npc,pc),false);
});
test("Planner excludes hidden and invisible targets it cannot sense",async()=>{
  const {pc}=combatPair();pc.document.hidden=true;assert((await new Planner(canvas.tokens.get("npc")).candidates()).every(p=>p.kind==="wait"));pc.document.hidden=false;pc.actor.statuses.add("invisible");assert((await new Planner(canvas.tokens.get("npc")).candidates()).every(p=>p.kind==="wait"));
});
test("Planner includes weakness reasoning and keeps exhausted actions spent",async()=>{
  const {npc,pc}=combatPair();enableHSR();npc.actor.flags[HSR]={ultimate:{elementId:"fire",current:100,max:100}};pc.actor.flags[HSR]={toughness:{enabled:true,current:15,max:100,weaknesses:["fire"]}};const plans=await new Planner(npc).candidates();assert(plans[0].reasons.some(s=>s.includes("weakness")));const rest=await new Planner(npc,{action:true,bonus:true,movement:30}).candidates();assert(rest.every(p=>p.kind==="wait"));
});
test("After replanning multiattack, remaining attacks do not grant another action",async()=>{
  const {npc,activity}=combatPair();const pending={type:"use",itemId:"attack",activityId:activity.id,targetIds:["pc"],rule:{},activation:"multiattack",label:"attack"};const plans=await new Planner(npc,{action:true,bonus:true,pendingAttacks:[pending]}).candidates();const attack=plans.find(p=>p.kind==="attack");assert(attack);assert.equal(attack.steps.at(-1).activation,"multiattack");assert.equal(attack.steps.filter(s=>s.type==="use").length,1);
});
test("Healing chooses a wounded ally and remains a real midi activity",async()=>{
  const heal=item("Heal",{activityType:"heal",range:30});const npc=token("healer",actor("healer",{items:[heal]}),100,100);const friend=token("friend",actor("friend",{hp:30}),200,100);friend.actor.system.attributes.hp.value=5;install([npc,friend]);const p=(await new Planner(npc).candidates())[0];assert.equal(p.kind,"heal");assert.deepEqual(p.steps.at(-1).targetIds,["friend"]);
});
test("Area shape containment handles circles, cones, and lines",()=>{
  const t=token("t",actor("t"),100,0);install([t]);assert(inArea(t,{type:"circle",x:50,y:50,elevation:0,size:5,scale:20}));assert(!inArea(t,{type:"circle",x:50,y:50,elevation:0,size:4,scale:20}));assert(inArea(t,{type:"cone",x:50,y:50,elevation:0,size:10,scale:20,direction:0,angle:60}));assert(!inArea(t,{type:"cone",x:50,y:50,elevation:0,size:10,scale:20,direction:180,angle:60}));
});
test("AoE plans reject clusters containing allies",async()=>{
  const i=item("Blast",{activityType:"save",range:90,template:{type:"sphere",size:10}}),npc=token("npc",actor("npc",{items:[i]}),100,100),enemy=token("enemy",actor("enemy",{type:"character"}),500,100,{disposition:1}),friend=token("friend",actor("friend"),600,100);install([npc,enemy,friend]);const plans=await new Planner(npc).candidates();assert(!plans.some(p=>p.kind==="attack"));
});
test("Attack waits for the GM reaction checkpoint before HP damage",async()=>{
  const {npc,pc,activity}=combatPair();let rolls=0,damage=0;simulateUse(activity,{onRoll:()=>rolls++,onDamage:()=>damage++});const gate=deferred(),entered=deferred();let resolved=false;
  const use=useMidiActivity(npc,{itemId:"attack",activityId:activity.id,targetIds:[pc.id],rule:{}},{checkpoint:async()=>{entered.resolve();return gate.promise;}}).then(r=>{resolved=true;return r;});
  await entered.promise;assert.equal(pc.actor.system.attributes.hp.value,30);assert.equal(resolved,false);assert.equal(rolls,1);gate.resolve({});const r=await use;assert.equal(r.aborted,false);assert.equal(pc.actor.system.attributes.hp.value,22);assert.equal(rolls,1);assert.equal(damage,1);
});
test("Shield applies before the hit check, avoiding damage and any reroll",async()=>{
  const {npc,pc,activity}=combatPair();let rolls=0;simulateUse(activity,{attackTotal:14,onRoll:()=>rolls++});await useMidiActivity(npc,{itemId:"attack",activityId:activity.id,targetIds:[pc.id],rule:{}},{checkpoint:async()=>{await applyReaction({type:"shield",sourceId:pc.id,targetId:pc.id,amount:5,duration:"nextTurn",consumeReaction:true});return {};}});assert.equal(pc.actor.system.attributes.ac.value,17);assert.equal(pc.actor.system.attributes.hp.value,30);assert.equal(rolls,1);assert.equal(MidiQOL.hasUsedReaction(pc.actor),true);
});
test("Save modifiers are applied before the actual saving throw",async()=>{
  const {npc,pc,activity}=combatPair({range:30,type:"save"});simulateUse(activity,{saveTotal:8,saveDC:12});const r=await useMidiActivity(npc,{itemId:"attack",activityId:activity.id,targetIds:[pc.id],rule:{}},{checkpoint:async({phase})=>{assert.equal(phase,"save");await applyReaction({type:"save",ability:"all",sourceId:pc.id,targetId:pc.id,amount:5,consumeReaction:false,duration:"nextAction"},{session:{id:"session",completedActions:0}});return {};}});assert.equal(r.workflow.saveResults[0].total,13);assert.equal(pc.actor.system.attributes.hp.value,30);
});
test("Incapacitation during a reaction aborts the pending attack safely",async()=>{
  const {npc,pc,activity}=combatPair();simulateUse(activity);const r=await useMidiActivity(npc,{itemId:"attack",activityId:activity.id,targetIds:[pc.id],rule:{}},{checkpoint:async()=>{npc.actor.statuses.add("stunned");return {replan:true};}});assert.equal(r.aborted,true);assert.equal(pc.actor.system.attributes.hp.value,30);
});
test("Workflow cleanup restores GM targets and unregisters every temporary hook",async()=>{
  const {npc,pc,activity}=combatPair();game.user.targets=new Set([npc]);simulateUse(activity);await useMidiActivity(npc,{itemId:"attack",activityId:activity.id,targetIds:[pc.id],rule:{}},{checkpoint:async()=>({})});assert.deepEqual([...game.user.targets].map(t=>t.id),["npc"]);assert.equal([...Hooks.events.values()].reduce((n,e)=>n+e.size,0),0);
});
test("Unrelated workflows cannot satisfy or pause the NPC workflow",async()=>{
  const {npc,pc,activity}=combatPair();let pauses=0;simulateUse(activity);await useMidiActivity(npc,{itemId:"attack",activityId:activity.id,targetIds:[pc.id],rule:{}},{checkpoint:async()=>{pauses++;await Hooks.emit("midi-qol.postCleanup",{sequenceId:"unrelated"});return {};}});assert.equal(pauses,1);
});
test("A real Shield activity owns its own effect; there is no duplicate +5",async()=>{
  const {npc,pc}=combatPair();const shield=item("Shield",{type:"spell",activityType:"heal",activation:"reaction",range:30});shield.actor=pc.actor;const ability=shield.system.activities.contents[0];ability.item=shield;ability.actor=pc.actor;pc.actor.items.set(shield.id,shield);simulateUse(ability,{damage:0,onRoll(){},onDamage:()=>{pc.actor.system.attributes.ac.value+=5;}});await applyReaction({type:"shield",sourceId:pc.id,targetId:pc.id,activityId:ability.id,amount:5,consumeReaction:true});assert.equal(pc.actor.system.attributes.ac.value,17);assert.equal(pc.actor.effects.size,0);
});
test("Next-action effects expire after one NPC action",async()=>{
  const {pc}=combatPair();const session={id:"session",completedActions:0};await applyReaction({type:"ac",sourceId:pc.id,targetId:pc.id,amount:2,duration:"nextAction",consumeReaction:false},{session});assert.equal(pc.actor.system.attributes.ac.value,14);session.completedActions=1;await cleanupReactions({combat:game.combat,session,actionDone:true});assert.equal(pc.actor.system.attributes.ac.value,12);
});
test("Shield lasts until the affected token's next turn",async()=>{
  const {pc}=combatPair();await applyReaction({type:"shield",sourceId:pc.id,targetId:pc.id,amount:5,duration:"nextTurn",consumeReaction:false});await cleanupReactions({combat:game.combat});assert.equal(pc.actor.system.attributes.ac.value,17);game.combat.turn=1;await cleanupReactions({combat:game.combat});assert.equal(pc.actor.system.attributes.ac.value,12);
});
test("Player requests cannot directly mutate actors",()=>{
  const {pc}=combatPair();pc.actor.owner="player";game.users.set("player",{id:"player",active:true,isGM:false});const manager=new ReactionManager();manager.current={id:"pause",requests:[],answers:new Map(),update(){}};manager.handleSocket({type:"request",pauseId:"pause",userId:"player",data:{type:"ac",sourceId:pc.id,targetId:pc.id,amount:100}});assert.equal(manager.current.requests.length,1);assert.equal(pc.actor.system.attributes.ac.value,12);manager.handleSocket({type:"request",pauseId:"old",userId:"player",data:{type:"ac",sourceId:pc.id}});assert.equal(manager.current.requests.length,1);
});
test("GM application verifies player ownership of the reacting token",async()=>{
  const {npc,pc}=combatPair();game.users.set("player",{id:"player",active:true,isGM:false});await assert.rejects(()=>applyReaction({type:"ac",sourceId:npc.id,targetId:pc.id,amount:100},{userId:"player"}),/does not own/);assert.equal(pc.actor.system.attributes.ac.value,12);
});
test("Multi-target AoE templates use the actual configured shape",async()=>{
  install();const doc=await createAreaTemplate({area:{type:"sphere",x:250,y:250,size:20,direction:0,angle:60,width:5,scale:20}});assert.equal(doc.t,"circle");assert.equal(doc.distance,20);assert.equal(doc.x,250);
});
test("A combat on a different scene does not start the NPC executor",()=>{
  combatPair();game.combat.scene={id:"other-scene"};assert.equal(new Engine().eligible(),false);
});
test("Healing can revive a downed living ally",async()=>{
  const heal=item("Revive",{activityType:"heal",range:30});const npc=token("healer",actor("healer",{items:[heal]}),100,100),friend=token("friend",actor("friend",{hp:30}),200,100);friend.actor.system.attributes.hp.value=0;friend.actor.statuses.add("unconscious");install([npc,friend]);const plan=(await new Planner(npc).candidates()).find(p=>p.kind==="heal");assert(plan);assert.deepEqual(plan.steps.at(-1).targetIds,["friend"]);simulateUse(heal.system.activities.contents[0],{damage:8});await useMidiActivity(npc,plan.steps.at(-1));assert.equal(friend.actor.system.attributes.hp.value,8);
});
test("Saving throw recommendations use prepared bonuses",async()=>{
  const {npc,pc,activity}=combatPair({type:"save",range:30});activity.save={ability:new Set(["dex"]),dc:{value:15}};pc.actor.system.abilities.dex.save={value:0};const first=(await new Planner(npc).candidates()).find(p=>p.kind==="attack");pc.actor.system.abilities.dex.save.value=10;const second=(await new Planner(npc).candidates()).find(p=>p.kind==="attack");assert(second.score<first.score);assert(second.reasons.some(r=>r.includes("20%")));
});
test("Opted-in self utility can resolve even without a midi workflow",async()=>{
  const utility=item("Defend",{activityType:"utility",range:0});const npc=token("npc",actor("npc",{items:[utility]}),100,100);const activity=utility.system.activities.contents[0];activity.target.affects.type="self";npc.document.flags[ID].config.abilityRules={[activity.id]:{allowUtility:true}};install([npc]);const plan=(await new Planner(npc).candidates()).find(p=>p.kind==="attack");assert(plan);assert.deepEqual(plan.steps.at(-1).targetIds,[npc.id]);activity.use=async()=>({used:true});const result=await useMidiActivity(npc,plan.steps.at(-1));assert.equal(result.aborted,false);
});
test("Custom obstruction blocks the footprint of a large token",()=>{
  const npc=token("large",actor("large"),100,100,{width:2,height:2});install([npc]);canvas.scene.flags[ID]={areas:[{kind:"obstruction",x:295,y:295,width:15,height:15}]};assert.equal(canTraverse(npc,{x:100,y:100,elevation:0},{x:200,y:100,elevation:0}),false);
});
test("Toughness reasoning follows the HSR actor element before item damage",()=>{
  const attacker={hsr:{present:true,element:"ice"}},defender={hsr:{toughnessEnabled:true,toughness:50,maxToughness:100,weaknesses:["fire"]}};assert.equal(hsrTacticalScore(attacker,defender,"fire",{}).score,0);
});
test("HSR kit notes escape custom text and show enhanced stance",()=>{
  const {npc}=combatPair();enableHSR();npc.actor.flags[HSR]={ultimate:{enhancedStanceEnabled:true,enhancedStanceActive:true,enhancedSkillText:'<p>Ice <img src=x onerror="alert(1)"> A&B</p>'}};const html=hsrNotes(npc);assert(html.includes("enhanced"));assert(!html.includes("<img"));assert(html.includes("A&amp;B"));assert(stateBadges(npc).includes("Enhanced stance"));
});
test("ApplicationV2 panels preserve configured width and clear rerender listeners",async()=>{
  install();foundry.applications={api:{ApplicationV2:class{constructor(options){this.options=options;}render(){return this;}async close(){return true;}}}};
  const Panel=panelClass(),app=new Panel({title:"Reaction",html:"",width:440});assert.equal(app.options.position.width,440);assert.equal(app.options.window.title,"Reaction");let listenerSignal;app.element={addEventListener(_name,_fn,options){listenerSignal=options.signal;}};app._onRender();const first=listenerSignal;app._onRender();assert(first.aborted);assert(!listenerSignal.aborted);await app.close();assert(listenerSignal.aborted);
});
test("Player reaction prompts follow the configured automation GM",()=>{
  const {settings}=install();const chosen={id:"chosen",active:true,isGM:true};game.users.set(chosen.id,chosen);game.user={id:"player",isGM:false};settings.set(`${ID}.gmUser`,chosen.id);const manager=new ReactionManager();manager.handleSocket({type:"openPause",gmId:"gm",sceneId:canvas.scene.id,pauseId:"wrong"});assert.equal(manager.playerPause,null);manager.handleSocket({type:"openPause",gmId:chosen.id,sceneId:canvas.scene.id,pauseId:"right",summary:"Attack",phase:"attack"});assert.equal(manager.playerPause.pauseId,"right");
});
test("Continue cannot race an asynchronous reaction approval",async()=>{
  install();const gate=deferred();let clicks=0,handler;
  const first={dataset:{command:"approve"},disabled:false,isConnected:true},second={dataset:{command:"continue"},disabled:false,isConnected:true};
  const app=new (panelClass())({title:"Reactions",html:"",onAction:async()=>{clicks++;await gate.promise;}});
  app.element={addEventListener(_type,fn){handler=fn;},querySelectorAll(selector){return selector==="[data-command]"?[first,second]:[];}};
  app._onRender();const inProgress=handler({target:{closest:()=>first}});assert(second.disabled);await handler({target:{closest:()=>second}});assert.equal(clicks,1);gate.resolve();await inProgress;assert(!second.disabled);
});
test("Routing uses walking costs instead of the token's previous movement mode",async()=>{
  const {npc,pc}=combatPair({distance:300});npc.document.movementAction="fly";
  npc.measureMovementPath=points=>({cost:points.every(p=>p.action==="walk")?canvas.grid.measurePath(points).cost:1000});
  const route=await new Navigator(npc,{movement:"close"}).route(pc,{range:5,budget:30});assert(route.reached);assert(route.cost<=30);
});
test("Prepared movement is converted to the scene's distance units",()=>{
  const {npc}=combatPair();npc.actor.system.attributes.movement.units="ft";canvas.scene.grid.units="m";assert(Math.abs(movementSpeed(npc.actor)-9.144)<0.001);
});
test("Crawling charges extra distance while retaining the prepared speed budget",()=>{
  const {npc}=combatPair();npc.actor.statuses.add("prone");const from=position(npc),to={...from,y:from.y+100};assert.equal(from.action,"crawl");assert.equal(movementSpeed(npc.actor),30);assert.equal(segmentCost(npc,from,to),10);
});
test("Crawling and difficult terrain add their extra costs without double charging",()=>{
  const {npc}=combatPair();npc.actor.statuses.add("prone");canvas.scene.flags[ID]={areas:[{kind:"terrain",x:0,y:0,width:1000,height:1000,multiplier:2}]};const from=position(npc),to={...from,y:from.y+100};assert.equal(segmentCost(npc,from,to),15);
  npc.measureMovementPath=()=>({cost:15,distance:5});assert.equal(segmentCost(npc,from,to),15);
});
