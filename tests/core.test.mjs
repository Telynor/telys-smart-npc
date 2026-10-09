import test from "node:test";
import assert from "node:assert/strict";
import {aStar,budgetPath,canAct,movementSpeed,meanFormula,availableResources,specialTurn,configOf,esc,ID,HSR} from "../scripts/core.mjs";
import {actor} from "./mocks.mjs";
const neighbors=p=>[[1,0],[-1,0],[0,1],[0,-1]].map(([x,y])=>({x:p.x+x,y:p.y+y}));
test("A* routes around a barrier without crossing it",()=>{
  const blocked=(_p,q)=>q.x<0||q.y<0||q.x>5||q.y>5||(q.x===2&&q.y<4);
  const r=aStar({start:{x:0,y:0},neighbors,blocked,cost:()=>1,goal:p=>p.x===4&&p.y===0,heuristic:p=>Math.abs(4-p.x)+p.y});
  assert.equal(r.reached,true);assert.equal(r.cost,12);assert(r.path.some(p=>p.y===4));assert(!r.path.some(p=>p.x===2&&p.y<4));
});
test("A* enforces terrain costs and a movement budget",()=>{
  const r=aStar({start:{x:0,y:0},neighbors,blocked:(_p,q)=>q.x<0||q.y!==0,cost:(_p,q)=>q.x===2?2:1,goal:p=>p.x===4,heuristic:p=>4-p.x,budget:3});
  assert.equal(r.reached,false);assert.equal(r.path.at(-1).x,2);assert.equal(r.cost,3);
});
test("A* stops at its node limit for unreachable targets",()=>{
  const r=aStar({start:{x:0,y:0},neighbors,blocked:()=>false,cost:()=>1,goal:()=>false,maxNodes:20});assert(r.visited<=20);assert.equal(r.reached,false);
});
test("Native paths are clipped to remaining speed",()=>{
  const r=budgetPath([{x:0},{x:1},{x:2},{x:3}],12,()=>5);assert.equal(r.path.length,3);assert.equal(r.cost,10);
});
test("Statuses prohibit actions and movement independently",()=>{
  const a=actor("a");a.statuses.add("restrained");assert.equal(canAct(a),true);assert.equal(movementSpeed(a),0);a.statuses.add("stunned");assert.equal(canAct(a),false);
});
test("Prepared speed is used without re-adding equipment bonuses",()=>{const a=actor("a",{speed:45});a._planarBonuses={speed:15};assert.equal(movementSpeed(a),45);a.statuses.add("prone");assert.equal(movementSpeed(a),45);});
test("Prepared exhaustion reductions are not applied twice",()=>{const a=actor("a",{speed:15,statuses:["exhaustion"]});a.system.attributes.exhaustion=2;assert.equal(movementSpeed(a),15);a.system.attributes.movement.walk=0;a.system.attributes.exhaustion=5;assert.equal(movementSpeed(a),0);});
test("Formula estimates resolve roll data and never evaluate code",()=>{assert.equal(meanFormula("2d6+@mod",{mod:3}),10);assert.equal(meanFormula("globalThis.hacked=1"),5);assert.equal(globalThis.hacked,undefined);});
test("HSR resource and stance constraints are enforced",()=>{assert.equal(availableResources({hsr:{energy:50,skillPoints:1,enhanced:false}},{energyCost:60}),false);assert.equal(availableResources({hsr:{energy:50}},{energyCost:45},{energy:10}),false);assert.equal(availableResources({hsr:{enhanced:false}},{requiresStance:"enhanced"}),false);});
test("Special HSR turns stay under the HSR module's control",()=>{for(const key of ["ahaInstantCombatant","elationActionCombatant","temporaryUltimate","talentTurnCombatant"])assert(specialTurn({getFlag:(ns,k)=>ns===HSR&&k===key}));});
test("NPC opt-in defaults to disabled and escapes names",()=>{assert.equal(configOf({}).enabled,false);assert.equal(esc('<script>"'),"&lt;script&gt;&quot;");});
