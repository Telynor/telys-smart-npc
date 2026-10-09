import {ID, esc, num, configOf} from "./core.mjs";
import {snapshot,integrationReport} from "./hsr.mjs";
import {position,center} from "./navigation.mjs";
export const option=(value,label,selected)=>`<option value="${esc(value)}" ${value===selected?"selected":""}>${esc(label)}</option>`;
export const field=(label,name,value,type="text",extra="")=>`<label class="tsnpc-field"><span>${esc(label)}</span><input name="${esc(name)}" type="${type}" value="${esc(value)}" ${extra}></label>`;
export const check=(label,name,value)=>`<label class="tsnpc-check"><input type="checkbox" name="${esc(name)}" ${value?"checked":""}><span>${esc(label)}</span></label>`;
export const select=(label,name,options,value)=>`<label class="tsnpc-field"><span>${esc(label)}</span><select name="${esc(name)}">${options.map(([v,l])=>option(v,l,value)).join("")}</select></label>`;
export function formValues(element){const out={};for(const f of element.querySelectorAll("[name]")){if(f.type==="radio"&&!f.checked)continue;out[f.name]=f.type==="checkbox"?f.checked:f.type==="number"?Number(f.value):f.value;}return out;}
let PanelClass;
export function panelClass(){
  return PanelClass??=class extends foundry.applications.api.ApplicationV2{
    static DEFAULT_OPTIONS={classes:["tsnpc-window"],tag:"section",window:{resizable:true,minimizable:true,icon:"fas fa-robot"},position:{width:660,height:"auto"}};
    constructor({title,html,buttons=[],onRender,onAction,onClose,width=660},options={}){
      const {width:optionWidth,...rest}=options;
      super({...rest,id:`tsnpc-${foundry.utils.randomID()}`,window:{...options.window,title},position:{width:optionWidth??width,height:"auto"}});
      this.html=html;this.buttons=buttons;this.onRender=onRender;this.onAction=onAction;this.onClose=onClose;
    }
    async _renderHTML(){const div=document.createElement("div");div.className="tsnpc-content";div.innerHTML=typeof this.html==="function"?this.html():this.html;div.insertAdjacentHTML("beforeend",`<footer class="tsnpc-buttons">${this.buttons.map(b=>`<button type="button" data-command="${esc(b.id)}" class="${b.primary?"primary":""}">${esc(b.label)}</button>`).join("")}</footer>`);return div;}
    _replaceHTML(result,content){content.replaceChildren(result);}
    _onRender(){
      this._tsnpcListeners?.abort();this._tsnpcListeners=new AbortController();
      this.element.addEventListener("click",async event=>{
        const button=event.target.closest("[data-command]");if(!button||button.disabled||this._tsnpcBusy)return;
        this._tsnpcBusy=true;
        const disabled=new Map([...this.element.querySelectorAll("[data-command]")].map(b=>[b,b.disabled]));
        for(const b of disabled.keys())b.disabled=true;
        try{await this.onAction?.(button.dataset.command,formValues(this.element),this,event);}
        catch(error){console.error(ID,error);ui.notifications.error(error.message);}
        finally{this._tsnpcBusy=false;for(const [b,value] of disabled)if(b.isConnected)b.disabled=value;}
      },{signal:this._tsnpcListeners?.signal});
      this.onRender?.(this);
    }
    async close(options){this._tsnpcListeners?.abort();const value=await super.close(options);this.onClose?.();return value;}
  };
}
export function panel(options){const app=new (panelClass())(options,{width:options.width});void app.render({force:true});return app;}
export function prompt(options){
  return new Promise(resolve=>{
    let settled=false;
    const finish=async result=>{if(settled)return;settled=true;resolve(result);await app.close();};
    const app=panel({...options,onAction:async(id,values,app,event)=>{const result=await options.onAction?.(id,values,app,event);if(result!==undefined)await finish(result);},onClose:()=>{if(!settled){settled=true;resolve(null);}options.onClose?.();}});
    if(options.signal){if(options.signal.aborted)void finish(null);else options.signal.addEventListener("abort",()=>void finish(null),{once:true});}
  });
}
let highlight;
export function clearHighlight(){if(highlight){highlight.parent?.removeChild(highlight);highlight.destroy();highlight=null;}}
export function highlightPlan(token,plan){
  clearHighlight();
  if(!globalThis.PIXI||!canvas.ready)return;
  const g=new PIXI.Graphics();highlight=g;g.eventMode="none";
  const stroke=(points,color,width)=>{if(g.poly){g.poly(points,false).stroke({color,width,alpha:0.9});}else{g.lineStyle(width,color,0.9);g.moveTo(points[0],points[1]);for(let i=2;i<points.length;i+=2)g.lineTo(points[i],points[i+1]);}};
  stroke([token.document.x-4,token.document.y-4,token.document.x+token.w+4,token.document.y-4,token.document.x+token.w+4,token.document.y+token.h+4,token.document.x-4,token.document.y+token.h+4,token.document.x-4,token.document.y-4],0xe7c875,4);
  for(const step of plan?.steps??[]){
    if(step.type==="move")stroke(step.path.flatMap(p=>{const c=center(token,p);return[c.x,c.y]}),0x64dfed,3);
    if(step.type==="use")for(const id of step.targetIds??[]){const target=canvas.tokens.get(id);if(!target)continue;const c=center(target);if(g.circle)g.circle(c.x,c.y,Math.max(target.w,target.h)/2+6).stroke({color:0xef7c82,width:3});else{g.lineStyle(3,0xef7c82,0.9);g.drawCircle(c.x,c.y,Math.max(target.w,target.h)/2+6);}}
  }
  canvas.interface.addChild(g);
}
export function stateBadges(token){
  const s=snapshot(token),h=s.hsr;
  return `<div class="tsnpc-badges"><span>HP ${s.hp}/${s.maxHp}</span><span>AC ${s.ac}</span>${h.present?`<span>${esc(h.element||"no element")} · ${esc(h.path||"no path")}</span><span>Energy ${h.energy}/${h.maxEnergy}</span><span>Talent ${h.talentPoints} · SP ${h.skillPoints} · Punchline ${h.punchline}</span>${h.toughnessEnabled?`<span>Toughness ${h.toughness}/${h.maxToughness}</span>`:""}${h.enhanced?"<span>Enhanced stance</span>":""}${h.memospriteOwner||h.memospriteSummoned?`<span>Memosprite resource ${h.memospriteResource}</span>`:""}`:""}${s.statuses.map(v=>`<span>${esc(v)}</span>`).join("")}</div>`;
}
export function hsrNotes(token){
  const h=snapshot(token).hsr;if(!h.present)return "";
  const entries=Object.entries(h.kit).filter(([,text])=>text.trim());if(!entries.length)return "";
  const plain=text=>typeof DOMParser==="function"?new DOMParser().parseFromString(text,"text/html").body.textContent:text.replace(/<[^>]*>/g," ");
  return `<details class="tsnpc-ability"><summary>HSR kit notes · ${h.enhanced?"enhanced":"normal"} stance</summary><p class="tsnpc-muted">Review custom conditions here. Executable activities and their configured costs determine automation.</p>${entries.map(([label,text])=>`<p><b>${esc(label[0].toUpperCase()+label.slice(1))}</b> · ${esc(plain(text))}</p>`).join("")}</details>`;
}
export async function choosePlan(token,plans,{signal,remaining=false}={}){
  const html=`<header class="tsnpc-hero"><img src="${esc(token.document.texture.src||token.actor.img)}" alt=""><div><h2>${esc(token.name)}</h2><p>${remaining?"Choose the remaining action":"NPC turn — review the plan"}</p></div></header>${stateBadges(token)}${hsrNotes(token)}<p>Select a plan to preview its path and targets. Every action stops for reactions.</p><div class="tsnpc-plans">${plans.map((p,i)=>`<label class="tsnpc-plan"><input type="radio" name="plan" value="${esc(p.id)}" ${i===0?"checked":""}><div><strong>${i===0?"Recommended · ":""}${esc(p.label)}</strong><ul>${p.reasons.map(r=>`<li>${esc(r)}</li>`).join("")}</ul></div></label>`).join("")}</div>`;
  highlightPlan(token,plans[0]);
  const result=await prompt({title:`Smart NPC · ${token.name}`,html,signal,
    buttons:[{id:"execute",label:"Execute selected plan",primary:true},{id:"replan",label:"Recalculate"},{id:"manual",label:"Take manual control"},{id:"end",label:"End turn"}],
    onRender:app=>app.element.querySelectorAll("[name=plan]").forEach(input=>input.addEventListener("change",()=>highlightPlan(token,plans.find(p=>p.id===input.value)))),
    onAction:(id,values)=>({command:id,plan:plans.find(p=>p.id===values.plan)})});
  clearHighlight();return result;
}
export function compatibilityHTML(){return `<div class="tsnpc-integrations">${integrationReport().map(m=>`<div><b>${esc(m.id)}</b><span class="${m.active?"ok":"muted"}">${m.active?"active":"inactive"} · ${esc(m.version)}</span></div>`).join("")}</div>`;}
