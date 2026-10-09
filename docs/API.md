# Module API

Available after the `ready` hook:

```js
const npcAI = game.modules.get("telys-smart-npc").api;
const token = canvas.tokens.controlled[0];
await npcAI.configureToken(token);
await npcAI.setEnabled(token, true);
await npcAI.getPlans(token);
npcAI.diagnostics();
```

| Method | Purpose |
| --- | --- |
| `open()` | Opens the director for the GM. |
| `configureToken(token)` | Opens placed-NPC configuration; defaults to the selected token. |
| `setEnabled(token, boolean)` | Enables/disables GM-approved NPC control. Protected bosses cannot be enabled. |
| `runCurrentTurn()` | Reviews/resumes the current enabled NPC on the selected GM client. |
| `stop()` | Aborts this client's executor and reaction pause. |
| `getPlans(token)` | Returns ranked proposed plans without executing them. |
| `getSnapshot(token)` | Reads prepared stats and HSR state. |
| `getState()` | Returns active NPC, turn, action/movement ledger, and pause state. |
| `diagnostics()` | Returns core/system/module versions and midi configuration issues. |
| `registerAdapter(id, adapter)` | Registers additional world-specific integration; returns an unregister function. |

An adapter can decorate plans, veto an activity before use, or process a completed native workflow. All callbacks may be asynchronous. Resource mutations in adapters should have their own matching cancellation/consumption handling; the executor only refunds costs it charged itself.

```js
const unregister = npcAI.registerAdapter("my-hsr-custom-rule", {
  decoratePlans(plans, {token, session, snapshot}) {
    for (const plan of plans) {
      if (plan.kind === "attack" && snapshot.hsr.enhanced) {
        plan.reasons.push("Enhanced-form custom rule reviewed");
      }
    }
  },
  beforeUse(step, {token, session}) {
    // Return false if your custom prerequisite is no longer satisfied.
    return true;
  },
  afterUse(workflow, {token, step, session}) {
    // Native midi/HSR hooks have already resolved this workflow.
    // Add bookkeeping here; avoid applying their damage a second time.
  }
});
```

Plans contain `id`, `label`, `score`, `reasons`, `kind`, and `steps`. A move step has `path` and `cost`; a use step has `itemId`, `activityId`, `targetIds`, `rule`, optional `slot`/`area`, and `activation`. The GM chooses the actual plan. An adapter changing scores must sort/reorder plans itself if it wants to change the recommendation order.

Token configuration is stored at `flags.telys-smart-npc.config`. Reaction effect expiry flags and scene reaction areas are also scoped to `telys-smart-npc`. The custom hook `tsnpcReactionApplied(request, context)` fires after an approved reaction, with `source`, `target`, and the current pause/session context.

Manual console diagnostics should be collected on the executing GM client; no automatic external telemetry is sent.
