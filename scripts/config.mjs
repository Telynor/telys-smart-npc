import {ID,HSR,esc,num,configOf,clone} from "./core.mjs";
import {panelClass,prompt,option,field,select,check,compatibilityHTML} from "./ui.mjs";
import {activitiesFor} from "./planner.mjs";
import {hsrConfig} from "./hsr.mjs";
import {midiProblems,configureMidi} from "./midi.mjs";
function elements(){try{return game.settings.get(HSR,"elements").map(e=>[e.id,e.name]);}catch{return [];}}
export async function configureToken(token){
  if(!game.user.isGM)throw new Error("Only the GM can configure NPC automation.");
  if(token?.actor?.type!=="npc")return ui.notifications.warn("Select an NPC token on the scene.");
  const cfg=configOf(token.document),entries=activitiesFor(token.actor),hc=hsrConfig(token.actor);
  const html=`<header class="tsnpc-hero"><img src="${esc(token.document.texture.src||token.actor.img)}" alt=""><div><h2>${esc(token.name)}</h2><p>Settings belong to this placed token. Duplicate it to copy its tactics.</p></div></header>${check("Controllable by AI","enabled",cfg.enabled)}${check("Protect as a main story boss","mainStoryBoss",cfg.mainStoryBoss)}<div class="tsnpc-form-grid">${select("Target priority","priority",[["smart","Smart (damage, weaknesses, survival)"],["nearest","Nearest"],["lowestHP","Lowest HP"],["lowestAC","Lowest AC"],["mostDamaged","Most damaged %"],["random","Random"]],cfg.priority)}${select("Movement behavior","movement",[["close","Close in"],["range","Hold preferred range"],["hold","Hold position"],["flee","Flee"]],cfg.movement)}${field("Detection range (scene units)","detectionRange",cfg.detectionRange,"number","min=0 max=10000")}${field("Preferred range","preferredRange",cfg.preferredRange,"number","min=0 max=10000")}${field("Heal below HP fraction (0–1)","healThreshold",cfg.healThreshold,"number","min=0 max=1 step=0.05")}${field("Flee below HP fraction (0–1)","fleeThreshold",cfg.fleeThreshold,"number","min=0 max=1 step=0.05")}${field("Repeated attacks per action","attacksPerAction",cfg.attacksPerAction,"number","min=1 max=8")}${field("Maximum spell level","maxSpellLevel",cfg.maxSpellLevel,"number","min=0 max=9")}</div>${check("Avoid friendly fire in area attacks","avoidFriendlyFire",cfg.avoidFriendlyFire)}${check("Prefer flanking positions (midi-QOL decides any advantage)","flank",cfg.flank)}${check("Allow bonus actions","allowBonus",cfg.allowBonus)}${check("Allow automatic upcasting to the highest available slot","useUpcasting",cfg.useUpcasting)}${check("Use HSR weaknesses, resources, and stance information","useHSR",cfg.useHSR)}<h3>Ability rules and HSR costs</h3><p>Attacks, saves, damage, and healing use real D&D5e activities. Set extra HSR costs only when those costs are not already consumed by the item's activity or macro.</p><p class="tsnpc-muted">HSR kit text informs the review; text alone has no executable roll. Create an activity for each ability you want automated. HSR NPCs should use activity costs instead of the character-only Skill button.</p><div class="tsnpc-ability-rules">${entries.map(({item,activity})=>{
    const r=cfg.abilityRules?.[activity.id]??{};const prefix=`rule.${activity.id}.`;
    const implied=/\b(ultimate|burst)\b/i.test(item.name+" "+activity.name)&&hc.enabled;
    return `<details class="tsnpc-ability"><summary>${esc(item.name)} · ${esc(activity.name??activity.type)}${implied?" · Ultimate cost can be configured below":""}</summary>${check("Disable this ability",prefix+"disabled",r.disabled)}<div class="tsnpc-form-grid">${select("Ability role",prefix+"kind",[["normal","Normal"],["basic","Basic attack"],["skill","Skill"],["talent","Talent"],["ultimate","Ultimate"],["heal","Heal"]],r.kind??"normal")}${select("Element",prefix+"element",[["","Actor's HSR element"],...elements()],r.element??"")}${field("Energy cost (number or full)",prefix+"energyCost",r.energyCost??0)}${field("Shared Skill Point cost",prefix+"skillCost",r.skillCost??0,"number","min=0")}${field("Talent Point cost",prefix+"talentCost",r.talentCost??0,"number","min=0")}${field("Punchline cost",prefix+"punchlineCost",r.punchlineCost??0,"number","min=0")}${field("Memosprite resource cost",prefix+"memospriteCost",r.memospriteCost??0,"number","min=0")}${select("Required stance",prefix+"requiresStance",[["","Either"],["normal","Normal"],["enhanced","Enhanced"]],r.requiresStance??"")}${field("Priority adjustment",prefix+"priority",r.priority??0,"number")}${field("Range override (0 = activity)",prefix+"range",r.range??0,"number","min=0")}</div>${check("Allow utility / custom activity",prefix+"allowUtility",r.allowUtility)}${check("Allow other activity types (review linked/summon effects manually)",prefix+"allowOtherType",r.allowOtherType)}</details>`;
  }).join("")||"<p>No activities found. Add attack/spell activities to the NPC's items.</p>"}</div><h3>Explicit multiattack sequence</h3><p>This sequence replaces the single-action choice and pauses after each attack. Leave blank to use repeated attacks above.</p>${Array.from({length:4},(_,i)=>`<div class="tsnpc-form-grid">${select(`Attack ${i+1}`,`multi.${i}.activityId`,[["","None"],...entries.filter(e=>e.activity.type==="attack").map(e=>[e.activity.id,`${e.item.name} · ${e.activity.name??"Attack"}`])],cfg.multiattack?.[i]?.activityId??"")}${field("Count",`multi.${i}.count`,cfg.multiattack?.[i]?.count??1,"number","min=1 max=8")}</div>`).join("")}`;
  const response=await prompt({title:`NPC tactics · ${token.name}`,html,width:730,buttons:[{id:"save",label:"Save NPC settings",primary:true},{id:"copy",label:"Save + apply to selected NPCs"},{id:"cancel",label:"Cancel"}],onAction:async(id,values)=>{
    if(id==="cancel")return null;
    const next={...cfg};for(const name of Object.keys(cfg))if(name in values)next[name]=values[name];
    next.detectionRange=Math.max(0,num(next.detectionRange));next.preferredRange=Math.max(0,num(next.preferredRange));
    next.healThreshold=Math.max(0,Math.min(1,num(next.healThreshold)));next.fleeThreshold=Math.max(0,Math.min(1,num(next.fleeThreshold)));
    next.attacksPerAction=Math.max(1,Math.min(8,num(next.attacksPerAction,1)));next.maxSpellLevel=Math.max(0,Math.min(9,num(next.maxSpellLevel,9)));
    next.abilityRules={};
    for(const {activity} of entries){const r={};for(const [key,value] of Object.entries(values))if(key.startsWith(`rule.${activity.id}.`))r[key.slice(`rule.${activity.id}.`.length)]=value;
      if(r.energyCost!=="full"){if(!Number.isFinite(Number(r.energyCost))||Number(r.energyCost)<0)throw new Error("Energy cost must be a nonnegative number or 'full'.");r.energyCost=num(r.energyCost);}
      for(const k of ["skillCost","talentCost","punchlineCost","memospriteCost"])r[k]=Math.max(0,num(r[k]));next.abilityRules[activity.id]=r;
    }
    next.multiattack=Array.from({length:4},(_,i)=>({activityId:values[`multi.${i}.activityId`],count:Math.max(1,Math.min(8,num(values[`multi.${i}.count`],1)))})).filter(e=>e.activityId);
    if(next.multiattack.reduce((n,e)=>n+e.count,0)>8)throw new Error("Limit the multiattack sequence to 8 attacks.");
    if(next.mainStoryBoss)next.enabled=false;
    await token.document.setFlag(ID,"config",next);
    if(id==="copy")for(const other of canvas.tokens.controlled){if(other.id===token.id||other.actor?.type!=="npc")continue;
      const copy=clone(next),otherEntries=activitiesFor(other.actor);copy.abilityRules={};copy.multiattack=[];
      for(const entry of entries){const match=otherEntries.find(e=>e.item.name===entry.item.name&&e.activity.name===entry.activity.name);if(match)copy.abilityRules[match.activity.id]=clone(next.abilityRules[entry.activity.id]);}
      for(const row of next.multiattack){const e=entries.find(e=>e.activity.id===row.activityId),match=otherEntries.find(o=>o.item.name===e?.item.name&&o.activity.name===e?.activity.name);if(match)copy.multiattack.push({...row,activityId:match.activity.id});}
      await other.document.setFlag(ID,"config",copy);
    }
    ui.notifications.info(`Saved NPC tactics for ${token.name}.`);return next;
  }});return response;
}
export function managerClass(engine){
  return class extends panelClass(){
    constructor(){super({title:"Tely's Smart NPC Combat",width:740,html:()=>{
      const npcTokens=canvas.tokens?.placeables?.filter(t=>t.actor?.type==="npc")??[];
      const problems=midiProblems();
      return `<header class="tsnpc-hero"><i class="fas fa-robot"></i><div><h2>NPC combat director</h2><p>Enable NPCs, review their turn plans, and resolve player reactions.</p></div></header>${compatibilityHTML()}${problems.length?`<div class="tsnpc-warning">${problems.map(p=>`<p>${esc(p)}</p>`).join("")}</div>`:"<p class=tsnpc-ok>midi-QOL is ready for automated attacks and damage.</p>"}<div class="tsnpc-npc-list">${npcTokens.map(t=>{const c=configOf(t.document);return `<div class="tsnpc-npc"><img src="${esc(t.document.texture.src||t.actor.img)}" alt=""><div><b>${esc(t.name)}</b><small>${esc(c.priority)} · ${esc(c.movement)}${c.mainStoryBoss?" · protected boss":""}</small></div><button type="button" data-command="toggle:${esc(t.id)}" ${c.mainStoryBoss?"disabled":""}>${c.enabled?"AI enabled":"Enable AI"}</button><button type="button" data-command="config:${esc(t.id)}">Configure</button></div>`;}).join("")||"<p>Place NPC tokens on the current scene to configure them.</p>"}</div><p class="tsnpc-muted">Player prompts and movement checkpoints are in Configure Settings → Tely's Smart NPC Combat. Automation starts with the current NPC's turn, after GM review.</p>`;
    },buttons:[{id:"selected",label:"Configure selected NPC",primary:true},{id:"run",label:"Review / resume current NPC"},{id:"stop",label:"Stop automation"},{id:"midi",label:"Configure midi-QOL"},{id:"clear",label:"Clear reaction areas"}],onAction:async(id,_values,app)=>{
      if(id.startsWith("config:")){await configureToken(canvas.tokens.get(id.slice(7)));await app.render({force:true});return;}
      if(id.startsWith("toggle:")){const token=canvas.tokens.get(id.slice(7));const cfg=configOf(token.document);if(cfg.mainStoryBoss)return;await token.document.setFlag(ID,"config",{...cfg,enabled:!cfg.enabled});await app.render({force:true});return;}
      if(id==="selected"){await configureToken(canvas.tokens.controlled[0]);await app.render({force:true});return;}
      if(id==="run"){await app.close();void engine.runCurrent({force:true}).catch(error=>ui.notifications.error(error.message));return;}
      if(id==="stop"){engine.stop();return;}
      if(id==="clear"){await canvas.scene?.setFlag(ID,"areas",[]);return;}
      if(id==="midi"){
        const confirmed=await foundry.applications.api.DialogV2.confirm({window:{title:"Configure midi-QOL automation"},content:"<p>Set midi-QOL to automatic hit checking, saving throws, and damage with a damage card. Player saves will roll automatically. Other midi-QOL settings are preserved.</p>",rejectClose:false});
        if(confirmed)await configureMidi();await app.render({force:true});
      }
    }});}
  };
}
export function registerSettings(Manager){
  const setting=(key,name,type,value,hint="")=>game.settings.register(ID,key,{name,hint,scope:"world",config:true,type,default:value});
  setting("enabled","Enable NPC turn prompts",Boolean,true,"Only tokens explicitly enabled for AI are reviewed.");
  setting("playerPrompts","Show player reaction windows",Boolean,true,"Players can request reactions. The GM reviews every request and controls Continue.");
  setting("pauseMovement","Pause after every movement segment",Boolean,true,"Allow reactions during movement; disable to pause once at the end of each move.");
  setting("autoEndTurn","Advance initiative when an NPC finishes",Boolean,true,"The GM still reviews the plan and must Continue through every reaction checkpoint.");
  setting("gmUser","Automation GM user ID",String,"","Leave blank for Foundry's active GM. With multiple GMs, only this selected user executes NPC plans.");
  game.settings.registerMenu(ID,"director",{name:"NPC combat director",label:"Open NPC combat director",hint:"Configure NPCs, resume automation, or configure midi-QOL.",icon:"fas fa-robot",type:Manager,restricted:true});
}
