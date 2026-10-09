# Validation record and in-world checks

This release was checked with Node's test runner and mocked Foundry/D&D5e/midi-QOL documents and hooks. It was reviewed against Foundry v14 API documentation, midi-QOL's v14 source, and the HSR source versions listed in the README. No live Foundry instance was available. Runtime UI behavior, real scene routing/Regions, and combinations with all modules in a particular world still need an in-world check.

The automated checks cover bounded A* routing, wall/footprint/occupancy constraints, movement budget and prepared stats, NPC opt-in and GM authority, HSR interrupt exclusions, resources and additive refunds, item uses/spell slots, multiattack replanning, healing, area friendly-fire avoidance, pending attack/save reactions, native Shield effect ownership, temporary effect expiry, workflow hook cleanup, player request ownership, and ApplicationV2 listener cleanup. All included tests passed with `npm test` during packaging.

## Short acceptance sequence

1. In a test encounter, enable one NPC with one melee attack and add a player token. Start combat on the NPC. Confirm the GM gets alternatives, an explanation, and token/path/target highlights before anything moves or rolls.
2. Execute a move-and-attack plan. Confirm a movement checkpoint appears and the token stops until Continue. Add a reaction obstruction or difficult terrain rectangle; Continue and replan should update the route/budget. Confirm a native wall is respected too.
3. At the pending attack checkpoint, apply Shield to the target. Confirm the same rolled attack is checked against the new AC, without rerolling or prior HP damage. Try an actual Shield item; confirm its spell slot/effect is handled by the item and no second +5 is added.
4. Use a save activity. At the pending-save checkpoint, add a saving throw bonus. Confirm it changes the ensuing save and midi-QOL damage/effects.
5. Configure two attacks per action. Confirm individual pauses, no extra action gained after a replan, and the native workflow's normal hit/damage behavior.
6. Configure one explicit HSR cost. Confirm the correct resource is charged once, native Toughness/Break hooks run once, and depleted resources exclude the activity. If the item's macro already charges it, set the extra rule cost to zero.
7. Connect a player client. Submit a reaction for an owned token. Confirm it cannot change the actor before GM approval and the GM cannot Continue with an unhandled request. Check No reaction and Dismiss too.
8. Trigger an HSR special turn while a normal NPC is paused. Confirm the executor yields to that turn and resumes with already spent movement/actions preserved. Test Stop and manual control.
9. Advance to the affected token's next turn or end combat. Confirm module-owned temporary effects/areas expire according to their selected durations. Real item effects should follow their own configured expiry.

If a check fails, retain the browser console error, `game.modules.get("telys-smart-npc").api.diagnostics()`, the activity configuration, and the exact module versions. Those identify an API/configuration mismatch without requiring guesswork about what happened.
