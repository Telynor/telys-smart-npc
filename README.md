# Tely's Smart NPC Combat

Version 1.0.0 · module ID `telys-smart-npc`

NPC combat automation for Foundry v14 and D&D5e, with a GM review before each turn, automatic movement and midi-QOL activity resolution, and explicit player reaction checkpoints. The planner explains its recommendations and offers alternatives. It uses local tactical rules; no AI account, API key, or external service is required.

This is an independent implementation of the requested Smart Combat NPC style of play, extended for Tely's HSR modules. It does not include Smart Combat NPC's source or require that module.

## Install and start

In Foundry Setup, choose **Add-on Modules → Install Module** and paste this Manifest URL:

```text
https://raw.githubusercontent.com/Telynor/telys-smart-npc/main/module.json
```

Install the module, then enable it in your world. For a manual installation:

1. Create **Data/modules/telys-smart-npc** in your Foundry user data directory and extract/copy the module files into it. `module.json` must be directly inside that folder, alongside `scripts` and `styles`. If using a hosted Foundry server, upload that folder to the server's custom modules directory.
2. Restart Foundry. In your D&D5e world, enable **midi-QOL**, its required dependencies, your HSR modules, and **Tely's Smart NPC Combat**.
3. Open the **robot button** under Token Controls, or **Configure Settings → Tely's Smart NPC Combat → NPC combat director**.
4. If the director reports midi-QOL configuration problems, use **Configure midi-QOL**. Its confirmation describes the world settings it changes: automatic hit checking, automatic saves, and automatic damage with a damage card. Player saves then roll automatically.
5. Select a placed NPC, click **Configure selected NPC**, check **Controllable by AI**, and save. Configure its attacks, movement, and HSR costs as described below. Each token starts with AI disabled.
6. Add both NPCs and players to combat, set their token dispositions, and start initiative. On an enabled NPC's normal turn, its token and proposed route/targets are highlighted. Pick a recommendation and click **Execute selected plan**.

Target versions: Foundry **14.368 or later within v14**, D&D5e **5.3.3 within v5**, and midi-QOL **14.0.13 or later with its v14 activity API**. The code was checked against those APIs. A live Foundry world was not available for end-to-end validation; see `docs/VALIDATION.md` for the checks performed and a short in-world acceptance sequence.

Avoid having another combat automation module execute the same NPC at the same time. The director offers **Stop automation** and **Take manual control** throughout play.

## How a turn works

The GM sees the acting NPC, current HP/AC/statuses, HSR resources, and ranked choices with reasons such as hit chance, weakness match, healing need, distance, and resource cost. Selecting another choice redraws its route and targets. You can recalculate, take manual control, or end the turn.

The selected plan moves the token using Foundry's movement API and uses actual D&D5e item activities through midi-QOL. midi-QOL rolls attacks, saves, healing, damage, and its normal effects/macros. The module does not directly subtract attack damage from HP.

Every movement segment pauses by default. You can change that to one pause at the end of movement in world settings. Each attack in a multiattack also pauses separately. Attacks pause **after the attack roll but before checking AC and applying damage**; save activities pause **before rolling saves**. After resolution, another checkpoint allows changes that affect the next action. Continue never happens automatically while a reaction window is open.

Players can click **No reaction** or **Yes — react**. The GM reviews each submitted request before any document changes occur. The GM can also record a reaction directly when playing in person. Unhandled requests must be reviewed or dismissed before Continue. A reaction can change the pending hit/save, invalidate the attack, or cause the remaining turn to be replanned. Spent movement/actions and completed multiattack steps remain spent.

HSR Aha, Elation, Talent, and temporary Ultimate turns remain controlled by their HSR module. If initiative interrupts a normal NPC turn, the executor stops and can resume the remaining plan when that combatant returns in the same round.

## NPC tactics

| Setting | Behavior |
| --- | --- |
| Target priority | Smart, nearest, lowest HP, lowest AC, most damaged percentage, or random. |
| Movement | Close in, hold a preferred range, hold position, or flee. Low HP can make retreat the recommendation. |
| Detection range | Limits eligible opponents; hidden tokens and unseen invisible tokens are excluded. |
| Healing threshold | Enables actual healing activities against sufficiently injured allies, including downed allies. |
| Area attacks | Place the activity's area template and reject friendly fire by default. |
| Repeated attacks | Set attacks per action when an NPC repeats the same attack. Default is one. |
| Explicit multiattack | Choose up to four attack rows, with a total of at most eight attacks. Each resolves individually. |
| Spell use | Checks available slots and limited uses. Optional upcasting uses the highest allowed available slot. |
| Ability rules | Disable activities, set role/stance/costs, change priority or range, and explicitly opt in utility/custom activities. |
| Protected boss | Disables AI control for a main story boss. |

Settings belong to the placed token. **Save + apply to selected NPCs** copies them to other selected NPCs and maps activities by matching item and activity names. Duplicating a configured token also copies its flags.

Pathfinding tries Foundry v14's native pathfinder first, then bounded A*. It checks walls, occupied living-token spaces, token footprints, elevation, the prepared walking speed, native terrain cost, and reaction areas. Prone NPCs use crawling costs; prepared exhaustion and equipment adjustments are not applied twice. It stays on the current level and does not invent flight, climbing, teleportation, or door interactions.

## HSR setup

The bridge was written from these supplied module sources:

| Module | Source version reviewed | Integration |
| --- | --- | --- |
| Tely's Star Rail Ultimates | 3.14.0-preview.5 | Energy, SP, Talent Points, Punchline, normal/enhanced stance, actor element/path, Toughness/weakness overrides, Break/Super Break, and special-turn flags. |
| Tely's Planar Ornaments | 1.0.15 | Reads the actor's prepared stats and available derived bonuses; its own activity/workflow hooks continue to apply. |
| Tely's Memosprites | 1.0.0 | Reads summoner/resource flags and can explicitly spend the memosprite resource through its API. |

Changes in later HSR versions need in-world verification. Unknown modules can supply an adapter through the documented API in `docs/API.md`.

Create a **real item activity** for each NPC Basic, Skill, Talent, or Ultimate you want executed. HSR description text is displayed as kit notes for GM review, but prose alone does not define a roll, target, effect, or resource consumption. The planner cannot infer every custom scripted rule from those descriptions.

In that activity's NPC ability rule, select its role, required stance, and any **extra** HSR costs. For a full-energy Ultimate, use `full` as the Energy cost. The module checks those costs before proposing/using the ability and spends them through the HSR APIs. If the item or its macro already spends a resource, leave that extra cost at zero to avoid charging it twice. Successful native workflows retain the HSR module's normal Energy, Toughness, Break, light cone, and ornament hooks.

The reviewed HSR Talent Point writer supports character combat pools, not NPC pools. For NPC talent mechanics, use the activity's own limited uses/attribute consumption or a custom adapter. Native HSR button actions that queue a special turn or run a bespoke Ultimate script are separate from an item activity; attach the required mechanics to the item or retain manual control for that action. The module does not assume an Ultimate-named item also implements HSR's button-specific Energy locks or turn insertion.

With multiple GMs, leave **Automation GM user ID** blank to use Foundry's active GM, or choose the same authority GM used by the HSR modules. Rejected resource writes stop the action visibly.

## Reaction choices

| Choice | Effect |
| --- | --- |
| Shield | Use an actual Shield reaction activity, or apply a manual AC bonus (default +5). A real item owns its effect; the module does not add a second Shield bonus. |
| Change AC | Adds a temporary AC bonus; negative values can reduce AC. |
| Change saving throw | Adds a bonus to one ability or all saves before a pending save roll. |
| Status effect | Dropdown from the world's configured status effects; apply or remove the selected status. |
| Difficult terrain | Creates a visible rectangular reaction area; its multiplier changes this module's NPC routing budget. |
| Obstruction / cover | Creates a visible blocked rectangle for this module's NPC routing, optionally blocking its targeting line of sight. Use an AC reaction for numeric cover bonuses. |
| Movement / temporary HP | Adds a walking-speed modifier, or sets temporary HP to the higher of current/new. |
| HSR Energy / Toughness | Changes the selected resource through the native API/flag, then replans. |
| Reaction item / spell | Executes a real reaction activity through midi-QOL with its configured consumption. |
| Other / manual change | Keeps combat paused so the GM can edit a sheet, wall, Region, or other mechanic before Continue and replan. |

Choose an affected token or area center, amount, duration, and optional reaction activity. Manual reactions can mark the source's midi-QOL reaction as used; uncheck consumption for environment changes. The default duration is until the affected token's next turn. You can also expire after the current/next NPC action, at combat end, or remove manually. Native item effects retain their own configured duration.

Reaction area rectangles affect this executor's pathfinding/targeting; they do **not** create native Foundry walls or Regions and do not constrain player movement or unrelated item rolls. For a world-wide obstruction or terrain feature, add native walls/Regions while paused, use **Other / manual change**, and click **Continue and replan**. **Clear reaction areas** removes the module's rectangles.

## Current boundaries

Tactics use explicit activity data and prepared actor stats, with approximate hit/save/damage scores. Execution uses the real system and midi-QOL results. Special formulas, custom visibility/range rules, movement modes, linked activity choices, counterspell-specific workflows, and custom script conditions may need ability overrides, an adapter, or manual control. Area planning checks token centers; review edge cases involving very large creatures or complicated three-dimensional templates. Stunned, paralyzed, unconscious, petrified, and dead NPCs hold rather than act; blinded/poisoned and other roll modifiers stay with the native workflow.

The GM's reaction window is the authority to Continue. Player timeouts are intentionally absent. Closing it stops automation. If a custom macro stalls its native workflow, stop the director and resolve/abort that workflow in midi-QOL before resuming. A browser/world reload preserves token settings and effects, but loses the in-memory turn ledger: finish a partly executed turn manually after a reload to avoid repeated actions.

## Developer checks and references

Run `npm test` (Node 22+; no dependency install required). Runtime files are ES modules without a build step. See `docs/VALIDATION.md` and `docs/API.md`.

API/source references used while implementing:

- [Foundry v14 Token API](https://foundryvtt.com/api/v14/classes/foundry.canvas.placeables.Token.html)
- [Foundry v14 TokenDocument API](https://foundryvtt.com/api/v14/classes/foundry.documents.TokenDocument.html)
- [Foundry v14 movement path job](https://foundryvtt.com/api/v14/interfaces/foundry.types.TokenFindMovementPathJob.html)
- [midi-QOL source, v14 branch](https://gitlab.com/tposney/midi-qol/-/tree/v14)
- [D&D5e 5.3.3 prepared movement rules](https://github.com/foundryvtt/dnd5e/blob/release-5.3.3/module/data/actor/templates/attributes.mjs)
- [Smart Combat NPC feature reference](https://foundryvtt.com/packages/smart-combat-npc)

License: MIT. The ZIP contains this module's source and tests, not the referenced modules.
