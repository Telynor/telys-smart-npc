export const ID = "telys-smart-npc";
export const HSR = "telys-star-rail-ultimates";
export const DEFAULT_CONFIG = Object.freeze({
  enabled: false, priority: "smart", movement: "close", detectionRange: 120,
  preferredRange: 30, healThreshold: 0.35, fleeThreshold: 0.15,
  avoidFriendlyFire: true, flank: false, allowBonus: true,
  attacksPerAction: 1, useUpcasting: false, maxSpellLevel: 9,
  useHSR: true, mainStoryBoss: false, abilityRules: {}, multiattack: []
});
export const IMMOBILE = new Set(["grappled", "restrained", "petrified", "stunned", "paralyzed", "unconscious", "dead"]);
export const INCAPACITATED = new Set(["incapacitated", "petrified", "stunned", "paralyzed", "unconscious", "dead"]);
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));
export const num = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
export const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
export function clone(v) { return globalThis.structuredClone ? structuredClone(v) : JSON.parse(JSON.stringify(v)); }
export function get(object, path, fallback) {
  let value = object;
  for (const key of String(path).split(".")) value = value?.[key];
  return value ?? fallback;
}
export function configOf(doc) {
  return {...DEFAULT_CONFIG, ...(doc?.getFlag?.(ID, "config") ?? doc?.flags?.[ID]?.config ?? {})};
}
export function hpRatio(actor) { const hp = actor?.system?.attributes?.hp; return clamp(num(hp?.value) / Math.max(1, num(hp?.max, 1)), 0, 1); }
export function canAct(actor) { return num(actor?.system?.attributes?.hp?.value, 1) > 0 && ![...(actor?.statuses ?? [])].some(s => INCAPACITATED.has(s)); }
export function movementSpeed(actor, action = "walk") {
  if ([...(actor?.statuses ?? [])].some(s => IMMOBILE.has(s))) return 0;
  let speed = Math.max(0, num(actor?.system?.attributes?.movement?.[action]));
  // D&D5e has already applied exhaustion, encumbrance, and effect bonuses to
  // the prepared speed. Crawling is charged by the movement path's action cost.
  const units=actor?.system?.attributes?.movement?.units,sceneUnits=globalThis.canvas?.scene?.grid?.units;
  if(units==="ft"&&sceneUnits==="m")speed/=3.28084;
  if(units==="m"&&sceneUnits==="ft")speed*=3.28084;
  return speed;
}
export function meanFormula(formula, data = {}) {
  const replaced = String(formula ?? "0").replace(/@([\w.]+)/g, (_, p) => String(num(get(data, p))));
  const expanded = replaced.replace(/(\d*)d(\d+)(?:\[[^\]]+\])?/gi, (_, count, sides) => String(num(count || 1) * (num(sides) + 1) / 2));
  // Estimates only: unsupported operators/modifiers do not get evaluated as code.
  if (!/^[\d.\s+\-*/()]+$/.test(expanded)) return 5;
  const terms = expanded.match(/[+\-]?\s*\d+(?:\.\d+)?/g) ?? [];
  return Math.max(0, terms.reduce((n, term) => n + num(term.replace(/\s/g, "")), 0));
}
export function activityDamage(activity, item, data = {}) {
  const parts = activity?.damage?.parts ?? [];
  if (parts.length) return parts.reduce((n, p) => n + meanFormula(p.formula ?? (p.custom?.enabled ? p.custom.formula : `${p.number || 0}d${p.denomination || 0}${p.bonus ? `+${p.bonus}` : ""}`), data), 0);
  const healing = activity?.healing;
  if (healing) return meanFormula(healing.formula ?? (healing.custom?.enabled ? healing.custom.formula : `${healing.number || 0}d${healing.denomination || 0}${healing.bonus ? `+${healing.bonus}` : ""}`), data);
  return (item?.system?.damage?.parts ?? []).reduce((n, p) => n + meanFormula(Array.isArray(p) ? p[0] : p.formula, data), 0);
}
export function actionType(activity, item, rule = {}) {
  if (rule.activation) return rule.activation;
  const type = activity?.activation?.type ?? item?.system?.activation?.type ?? "action";
  return type === "bonus" ? "bonus" : ["action", "", undefined].includes(type) ? "action" : type;
}
export function chanceToHit(ac, attackBonus, threshold = 20) {
  return clamp((21 - num(ac, 10) + num(attackBonus)) / 20, (21 - clamp(threshold, 1, 20)) / 20, 0.95);
}
export function targetScore(target, priority, distance, random = Math.random) {
  const hp = target.actor?.system?.attributes?.hp ?? {};
  if (priority === "nearest") return -distance;
  if (priority === "lowestHP") return -num(hp.value);
  if (priority === "lowestAC") return -num(target.actor?.system?.attributes?.ac?.value, 10);
  if (priority === "mostDamaged") return (1 - hpRatio(target.actor)) * 100;
  if (priority === "random") return random() * 100;
  return (1 - hpRatio(target.actor)) * 18 - distance / 6;
}
class MinHeap {
  constructor() { this.items = []; }
  push(node) { const a = this.items; a.push(node); let i = a.length - 1; while (i) { const p = (i - 1) >> 1; if (a[p].score <= node.score) break; a[i] = a[p]; i = p; } a[i] = node; }
  pop() { const a = this.items, first = a[0], last = a.pop(); if (!a.length) return first; let i = 0; while (true) { let c = i * 2 + 1; if (c >= a.length) break; if (c + 1 < a.length && a[c + 1].score < a[c].score) c++; if (a[c].score >= last.score) break; a[i] = a[c]; i = c; } a[i] = last; return first; }
  get size() { return this.items.length; }
}
/** Bounded A*; callers supply native grid neighbors, collision, cost, and goal. */
export function aStar({start, neighbors, blocked, cost, goal, heuristic = () => 0, maxNodes = 5000, budget = Infinity}) {
  const key = p => `${p.x},${p.y}`;
  const heap = new MinHeap(), distances = new Map([[key(start), 0]]), visited = new Set(), previous = new Map(), points = new Map([[key(start), start]]);
  heap.push({p:start, score:heuristic(start)});
  let end = start, best = heuristic(start), reached = false, count = 0;
  while (heap.size && count++ < maxNodes) {
    const {p} = heap.pop(), pk = key(p);
    if (visited.has(pk)) continue;
    visited.add(pk);
    const h = heuristic(p);
    if (h < best) { best = h; end = p; }
    if (goal(p)) { end = p; reached = true; break; }
    for (const next of neighbors(p)) {
      const nk = key(next);
      if (visited.has(nk) || blocked(p, next)) continue;
      const nc = distances.get(pk) + cost(p, next);
      if (!Number.isFinite(nc) || nc > budget || nc >= (distances.get(nk) ?? Infinity)) continue;
      previous.set(nk, pk); points.set(nk, next); distances.set(nk, nc);
      heap.push({p:next, score:nc + heuristic(next)});
    }
  }
  const path = []; let pk = key(end);
  while (pk) { path.push(points.get(pk)); pk = previous.get(pk); }
  path.reverse();
  return {path, cost:distances.get(key(end)) ?? 0, reached, visited:visited.size};
}
export function budgetPath(path, budget, segmentCost) {
  if (!path.length) return {path:[], cost:0};
  const kept = [path[0]]; let cost = 0;
  for (let i=1; i<path.length; i++) { const step = segmentCost(path[i-1], path[i]); if (!Number.isFinite(step) || cost + step > budget + 0.001) break; cost += step; kept.push(path[i]); }
  return {path:kept, cost};
}
export function turnKey(combat) { return combat?.started && combat.combatant ? `${combat.id}:${combat.round}:${combat.combatant.id}` : null; }
export function specialTurn(combatant) { return ["ahaInstantCombatant", "elationActionCombatant", "talentTurnCombatant", "temporaryUltimate"].some(k => combatant?.getFlag?.(HSR, k)); }
export function availableResources(snapshot, rule, spent = {}) {
  const resources = snapshot?.hsr ?? {};
  for (const [costKey, resourceKey] of [["energyCost","energy"],["skillCost","skillPoints"],["talentCost","talentPoints"],["punchlineCost","punchline"],["memospriteCost","memospriteResource"]]) {
    if (num(rule?.[costKey]) > num(resources[resourceKey]) - num(spent[resourceKey])) return false;
  }
  if (rule?.requiresStance === "enhanced" && !resources.enhanced) return false;
  if (rule?.requiresStance === "normal" && resources.enhanced) return false;
  return true;
}
