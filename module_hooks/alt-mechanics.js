/**
 * @fileoverview Central hub for all Alternity system hooks within Foundry VTT.
 * This module listens to core game events and injects custom logic using services
 * defined in src/services/alternity-math.js and data models from src/data/.
 */

import { Hooks, Roll, ChatMessage, game } from "../src/module-info.js";
import { AlternityMathService } from "../src/services/alternity-math.js";
import { AlternityCharacterState, getAlternityState } from "../src/data/alternity-actor-data.js";

/**
 * Initializes all necessary event listeners for the module. This should be called early in the game load cycle (e.g., in a 'ready' hook).
 */
export function initializeAlternityHooks() {
    console.log("Alternity System Hooks: Initializing...");

    // 1. Ability Check Preparation (Sync)
    // Used for initial modifier assembly that doesn't require async state.
    Hooks.on("alternity:abilityCheck", (actor, rollOptions) => {
        rollOptions.modifiers = rollOptions.modifiers || [];
    });

    // 2. Ability Check Resolution (Async)
    // Assembles modifiers from actor state (wound, stances) and performs the math resolution.
    Hooks.on("alternity:resolveAbilityCheck", async (actor, rollOptions) => {
        const altState = await getAlternityState(actor);
        if (!altState) return;

        const modifiers = rollOptions.modifiers || [];

        // A. Wound penalties
        const woundPenalty = altState.getWoundPenalty();
        if (woundPenalty !== 0) {
            modifiers.push(AlternityMathService.buildModifier(
                game.i18n.localize("ALTERNITY.Modifier.WoundPenalty"),
                woundPenalty,
                game.i18n.localize("ALTERNITY.Modifier.WoundPenaltyReason")
            ));
        }

        // B. Active stances/passives/actions
        const activeAbilities = altState.getActiveAbilities();
        for (const ability of activeAbilities) {
            const trigger = ability.triggerCondition;
            // Basic context filtering
            if (trigger.context && trigger.context !== rollOptions.context && trigger.context !== 'Any') continue;
            
            if (typeof ability.effectPayload.step === 'number' && ability.effectPayload.step !== 0) {
                modifiers.push(AlternityMathService.buildModifier(
                    ability.name,
                    ability.effectPayload.step,
                    `Ability: ${ability.name}`
                ));
            }
        }

        // C. Triple scores and base step from state
        const scores = altState.getSkillScores(rollOptions.skillId);
        const baseStep = altState.getSkillBaseStep(rollOptions.skillId);

        // D. Resolve via Math Service
        // Note: AlternityActor.rollSkill currently only rolls 1d20 (control), 
        // so situationRoll is passed as 0. 
        const result = AlternityMathService.resolveAbilityCheck(
            scores,
            baseStep,
            modifiers,
            rollOptions.context,
            { control: rollOptions.roll, situation: 0 }
        );

        // E. Sync results back to the rollOptions object for the caller
        rollOptions.adjustedValue = result.finalValue;
        rollOptions.modifierTrace = result.modifierTrace;
        rollOptions.succeeded     = result.succeeded;
        rollOptions.degree        = result.degree;
        rollOptions.margin        = result.margin;
    });

    // 3. Initiative Management (Intercept raw d20 updates from Combat Tracker)
    Hooks.on("preUpdateCombatant", (combatant, changes, options, userId) => {
        if (changes.initiative !== undefined && !options.alternity_processed) {
            if (combatant.getFlag('alternity-v2', 'isExtraAction')) return true;

            if (typeof changes.initiative === 'number' && combatant.actor) {
                (async () => {
                    const realInit = await combatant.actor.rollInitiative({ combatant });
                    await combatant.update({ initiative: realInit }, { alternity_processed: true });
                })();
                return false; 
            }
        }
        return true;
    });

    // 2. Cleanup and Initiative Reset at the end of each round
    Hooks.on("updateCombat", async (combat, changes, options, userId) => {
        // If the round changed or combat ended
        if (changes.round || (changes.active === false)) {
            // A. Remove extra combatants
            const extras = combat.combatants.filter(c => c.getFlag('alternity-v2', 'isExtraAction'));
            if (extras.length > 0) {
                console.log(`[Alternity] Cleaning up ${extras.length} extra combatants at end of round.`);
                await combat.deleteEmbeddedDocuments("Combatant", extras.map(e => e.id));
            }

            // B. Reset initiative for all remaining combatants
            const updates = combat.combatants
                .filter(c => !c.getFlag('alternity-v2', 'isExtraAction'))
                .map(c => ({ _id: c.id, initiative: null }));
            
            if (updates.length > 0) {
                console.log(`[Alternity] Resetting initiative for ${updates.length} combatants for new round.`);
                await combat.updateEmbeddedDocuments("Combatant", updates);
                
                // C. Reset the turn marker to the top of the tracker
                await combat.update({ turn: 0 });
            }
        }
    });

    // 4. Damage Notification (Logging only)
    Hooks.on("alternity:damageApplied", (actor, data) => {
        console.log(`[Alternity] Damage applied to ${actor.name}: ${data.finalDamage} ${data.category} damage.`);
    });

    console.log("Alternity System Hooks: All core hooks successfully attached.");
}

/** Simple check to see if the options suggest a combat action. */
function alternityIsCombatRelevant(options) {
    // Check for key identifiers in the options object provided by Foundry
    return !!options.damage || !!options.attack;
}