import {HSR, ID, num, get, availableResources} from "./core.mjs";
const active = id => globalThis.game?.modules?.get(id)?.active;
export function hsrApi() { return active(HSR) ? game.modules.get(HSR).api : null; }
export function hsrConfig(actor) { return hsrApi()?.getConfig?.(actor) ?? actor?.getFlag?.(HSR, "ultimate") ?? {}; }
function setting(key, fallback) { try { return game.settings.get(HSR, key) ?? fallback; } catch { return fallback; } }
export function snapshot(token) {
  const actor = token.actor, cfg = hsrConfig(actor), tc = actor?.getFlag?.(HSR, "toughness") ?? {};
  const mode = token.document?.getFlag?.(HSR, "weaknessMode") ?? actor?.getFlag?.(HSR, "weaknessMode");
  const override = token.document?.getFlag?.(HSR, "miniWeaknessOverride");
  let weaknesses = [...new Set([...(tc.weaknesses ?? []), ...(token.document?.getFlag?.(HSR, "temporaryWeaknesses") ?? tc.temporaryWeaknesses ?? [])])];
  if (mode === "none") weaknesses = [];
  else if (mode === "all") weaknesses = setting("elements", []).map(e => e.id);
  else if (Array.isArray(override)) weaknesses = [...override];
  const api = hsrApi(), memo = actor?.getFlag?.("telys-memosprites", "config") ?? {};
  return {
    hp: num(actor?.system?.attributes?.hp?.value), maxHp: num(actor?.system?.attributes?.hp?.max),
    ac: num(actor?.system?.attributes?.ac?.value, 10), statuses: [...(actor?.statuses ?? [])],
    hsr: {
      present: !!api, energyEnabled: !!cfg.enabled, energy: num(cfg.current), maxEnergy: num(cfg.max, 100),
      element: cfg.elementId ?? "", path: cfg.pathId ?? "", enhanced: !!(cfg.enhancedStanceEnabled && cfg.enhancedStanceActive),
      break: !!cfg.breakCharacter, superBreak: !!cfg.superBreakCharacter,
      toughnessEnabled: !!(active(HSR) && (tc.enabled ?? actor?.type === "npc")),
      toughness: num(tc.current, 100), maxToughness: num(tc.max, 100), weaknesses,
      skillPoints: num(api?.getSkillPoints?.()), talentPoints: num(api?.getTalentPoints?.(actor), num(cfg.talentPointsCurrent)),
      punchline: num(api?.getPunchline?.()), isBoss: !!cfg.isBoss, phases: num(cfg.bossPhaseCount, 1),
      memospriteSummoned: !!memo.summoned, memospriteResource: num(memo.resource),
      memospriteOwner: token.document?.getFlag?.("telys-memosprites", "summonerId") ?? null,
      planar: {...(actor?._planarBonuses ?? {})}, lightCone: {...(actor?._lightConeStats ?? {})},
      lightCones: (actor?.items?.contents ?? [...(actor?.items ?? [])]).filter(i => i.getFlag?.(HSR, "lightCone")?.equipped || i.system?.attuned).map(i => i.name),
      kit: {
        skill: String(cfg.enhancedStanceActive && cfg.enhancedSkillText ? cfg.enhancedSkillText : cfg.skillText ?? ""),
        talent: String(cfg.enhancedStanceActive && cfg.enhancedTalentText ? cfg.enhancedTalentText : cfg.talentText ?? ""),
        ultimate: String(cfg.enhancedStanceActive && cfg.enhancedUltimateText ? cfg.enhancedUltimateText : cfg.ultimateText ?? "")
      }
    }
  };
}
export function hsrTacticalScore(attacker, defender, element, rule) {
  const a = attacker.hsr, d = defender.hsr;
  if (!a?.present) return {score:0, reasons:[]};
  const reasons = []; let score = 0;
  // TS RU applies Toughness using the actor's configured element, even when an
  // item's HP damage type differs. Match the planner to that exact rule.
  const e = a.element || element;
  if (d.toughnessEnabled && d.toughness > 0 && d.weaknesses.includes(e)) {
    score += 14; reasons.push(`${e} matches a weakness`);
    if (d.toughness / Math.max(1,d.maxToughness) <= 0.25) { score += 9; reasons.push("target is close to a Toughness break"); }
    if (a.break) { score += 7; reasons.push("attacker has Break specialization"); }
  }
  if (d.toughnessEnabled && d.toughness <= 0 && a.break && a.superBreak) { score += 24; reasons.push("broken target enables Super Break"); }
  if (rule.kind === "ultimate" && a.energy >= a.maxEnergy) { score += 14; reasons.push("Ultimate Energy is full"); }
  if (a.enhanced) reasons.push("enhanced stance is active");
  if (a.path === "elation" && a.punchline > 0) { score += 2; reasons.push(`${a.punchline} Punchline available`); }
  return {score, reasons};
}
export function resolvedRule(token, item, activity, cfg) {
  const stored = cfg.abilityRules?.[activity?.id ?? item.id] ?? {};
  const name = `${item.name} ${activity?.name ?? ""}`.toLowerCase();
  const rule = {kind: "normal", priority:0, energyCost:0, skillCost:0, talentCost:0, punchlineCost:0, memospriteCost:0, ...stored};
  const hc = hsrConfig(token.actor);
  // HSR resources are explicit opt-ins per ability; infer intent, never infer a charge.
  if (!stored.kind && /\b(ultimate|burst)\b/.test(name) && hc.enabled) rule.suggestedKind = "ultimate";
  rule.element ||= hc.elementId ?? "";
  if (rule.kind === "ultimate" && rule.energyCost === "full") rule.energyCost = num(hc.max,100);
  return rule;
}
/** Apply only explicitly configured costs. Midi/dnd5e consume their own item/spell resources. */
export async function debitResources(token, rule) {
  if (!availableResources(snapshot(token), rule)) throw new Error("HSR resources or stance changed. Replan this turn.");
  const api = hsrApi(), h = snapshot(token).hsr;
  const deltas = [];
  const operations = [
    ["energyCost", h.energy, "energy", value => api?.setEnergy?.(token.actor, value, {overrideLock:true})],
    ["skillCost", h.skillPoints, "skillPoints", value => api?.setSkillPoints?.(value)],
    ["talentCost", h.talentPoints, "talentPoints", value => api?.setTalentPoints?.(token.actor, value)],
    ["punchlineCost", h.punchline, "punchline", value => api?.setPunchline?.(value)],
    ["memospriteCost", h.memospriteResource, "memospriteResource", value => game.modules.get("telys-memosprites")?.api?.save?.(token.actor, {resource:value})]
  ];
  const supported = resource => resource === "memospriteResource" ? game.modules.get("telys-memosprites")?.api?.save : api?.[{energy:"setEnergy",skillPoints:"setSkillPoints",talentPoints:"setTalentPoints",punchline:"setPunchline"}[resource]];
  for(const [key,,resource] of operations)if(num(rule[key])>0&&typeof supported(resource)!=="function")throw new Error(`The ${resource} API is unavailable. Reconfigure this activity.`);
  for (const [key, value, resource, write] of operations) {
    const amount = num(rule[key]); if (!amount) continue;
    try { await write(value - amount);if(snapshot(token).hsr[resource]!==value-amount)throw new Error(`The ${resource} change was not accepted. Use the HSR authority GM and a supported resource pool.`);deltas.push({resource, before:value, after:value-amount, write, token}); }
    catch (error) { await refundResources(deltas); throw error; }
  }
  return deltas;
}
export async function refundResources(deltas) {
  for (const d of [...deltas].reverse()) {
    // Restore the charge additively so other modules' intervening gains remain intact.
    let current;
    if (d.resource === "skillPoints") current = hsrApi()?.getSkillPoints?.();
    else if (d.resource === "punchline") current = hsrApi()?.getPunchline?.();
    else current = snapshot(d.token).hsr[d.resource];
    await d.write(num(current,d.after) + d.before - d.after);
  }
}
export function integrationReport() {
  const ids = [HSR,"telys-planar-ornaments","telys-memosprites","midi-qol"];
  return ids.map(id => ({id, active:!!active(id), version:game.modules.get(id)?.version ?? "not installed"}));
}
