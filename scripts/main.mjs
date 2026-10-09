import {ID,configOf,turnKey,esc} from "./core.mjs";
import {Engine,authority} from "./engine.mjs";
import {configureToken,managerClass,registerSettings} from "./config.mjs";
import {cleanupReactions} from "./reactions.mjs";
import {clearHighlight} from "./ui.mjs";
import {integrationReport,snapshot} from "./hsr.mjs";
import {midiProblems} from "./midi.mjs";
const engine=new Engine();let Manager;let areaOverlay;
function openManager(){if(!game.user.isGM)return;new Manager().render({force:true});}
function addTools(controls){
  const group=Array.isArray(controls)?controls.find(c=>c.name==="tokens"):controls.tokens;
  if(!group||!game.user.isGM)return;
  const tools=[{name:"tsnpc-director",title:"Smart NPC combat director",icon:"fas fa-robot",order:96,button:true,visible:true,onChange:openManager,onClick:openManager},
    {name:"tsnpc-stop",title:"Stop NPC automation",icon:"fas fa-hand",order:97,button:true,visible:true,onChange:()=>engine.stop(),onClick:()=>engine.stop()}];
  for(const tool of tools)if(Array.isArray(group.tools))group.tools.push(tool);else group.tools[tool.name]=tool;
}
function drawAreas(){
  if(areaOverlay){areaOverlay.parent?.removeChild(areaOverlay);areaOverlay.destroy();areaOverlay=null;}
  if(!canvas.ready||!globalThis.PIXI)return;
  const areas=canvas.scene.getFlag(ID,"areas")??[];if(!areas.length)return;
  const g=new PIXI.Graphics();areaOverlay=g;g.eventMode="none";
  for(const a of areas){const color=a.kind==="terrain"?0xe7c875:0xef7c82;if(g.rect){g.rect(a.x,a.y,a.width,a.height).fill({color,alpha:0.16}).stroke({color,width:2,alpha:0.8});}else{g.lineStyle(2,color,0.8);g.beginFill(color,0.16);g.drawRect(a.x,a.y,a.width,a.height);g.endFill();}}
  canvas.interface.addChild(g);
}
function schedule(){engine.schedule();}
Hooks.once("init",()=>{
  Manager=managerClass(engine);registerSettings(Manager);
  game.keybindings.register(ID,"director",{name:"Open NPC combat director",editable:[],restricted:true,onDown:()=>{openManager();return true;}});
  game.keybindings.register(ID,"stop",{name:"Stop NPC automation",editable:[],restricted:true,onDown:()=>{engine.stop();return true;}});
});
Hooks.once("ready",()=>{
  const api={open:openManager,configureToken:token=>configureToken(token??canvas.tokens.controlled[0]),
    runCurrentTurn:()=>engine.runCurrent({force:true}),stop:()=>engine.stop(),
    setEnabled:async(token,enabled=true)=>{if(!game.user.isGM)throw new Error("Only the GM can designate AI tokens.");if(token.actor?.type!=="npc")throw new Error("Choose an NPC token.");const cfg=configOf(token.document);if(cfg.mainStoryBoss&&enabled)throw new Error("This NPC is protected as a main story boss.");await token.document.setFlag(ID,"config",{...cfg,enabled});},
    getPlans:token=>engine.preview(token??canvas.tokens.controlled[0]),getState:()=>({turn:turnKey(game.combat),active:engine.active?{id:engine.active.id,npc:engine.active.token.name,ledger:{...engine.active.ledger},paused:!!engine.reactions.current}:null}),
    getSnapshot:token=>snapshot(token??canvas.tokens.controlled[0]),registerAdapter:(id,adapter)=>engine.registerAdapter(id,adapter),
    diagnostics:()=>({module:game.modules.get(ID)?.version,core:game.version,system:game.system.version,integrations:integrationReport(),midiProblems:midiProblems(),state:api.getState()})};
  game.modules.get(ID).api=api;
  game.socket.on(`module.${ID}`,payload=>engine.reactions.handleSocket(payload));
  if(game.system.id!=="dnd5e"&&game.user.isGM)ui.notifications.error("Tely's Smart NPC Combat requires the D&D5e system.");
  if(game.user.isGM&&game.modules.get("smart-combat-npc")?.active)ui.notifications.warn("Disable Smart Combat NPC for tokens handled by Tely's Smart NPC Combat to avoid two turn executors.");
  drawAreas();schedule();
});
Hooks.on("getSceneControlButtons",addTools);
Hooks.on("combatStart",schedule);
Hooks.on("updateCombat",combat=>{
  if(combat.id!==game.combat?.id)return;
  schedule();
  if(authority())void cleanupReactions({combat}).catch(console.error);
});
Hooks.on("deleteCombat",combat=>{
  if(engine.active?.combatId===combat.id)engine.stop();
  if(authority())void cleanupReactions({combat,combatEnded:true}).catch(console.error);
  for(const key of engine.sessions.keys())if(key.startsWith(`${combat.id}:`))engine.sessions.delete(key);
});
Hooks.on("updateUser",schedule);
Hooks.on("canvasReady",()=>{drawAreas();schedule();});
Hooks.on("canvasTearDown",()=>{engine.active?.controller.abort();clearHighlight();if(areaOverlay){areaOverlay.destroy();areaOverlay=null;}});
Hooks.on("updateScene",(scene,changes)=>{if(scene.id===canvas.scene?.id&&(changes.flags?.[ID]||Object.keys(changes).some(k=>k.startsWith(`flags.${ID}`))))drawAreas();});
Hooks.on("deleteToken",token=>{if(engine.active?.token.id===token.id)engine.stop();});
Hooks.on("getActorSheetHeaderButtons",(app,buttons)=>{
  if(!game.user.isGM||app.actor?.type!=="npc")return;
  const token=app.token?.object??app.actor.token?.object;
  if(token)buttons.unshift({label:"NPC AI",class:"tsnpc-configure",icon:"fas fa-robot",onclick:()=>configureToken(token)});
});
Hooks.on("renderActorSheetV2",app=>{
  if(!game.user.isGM||app.actor?.type!=="npc")return;
  const token=app.token?.object??app.actor.token?.object;
  const header=app.element?.querySelector?.(".window-header");
  if(token&&header&&!header.querySelector(".tsnpc-configure")){const button=document.createElement("button");button.type="button";button.className="tsnpc-configure header-control";button.title="Configure NPC AI";button.innerHTML='<i class="fas fa-robot"></i>';button.addEventListener("click",()=>configureToken(token));header.insertBefore(button,header.querySelector(".window-controls"));}
});
