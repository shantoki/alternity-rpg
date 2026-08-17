/**
 * @fileoverview Central hub for all Alternity system hooks within Foundry VTT.
 * This module listens to core game events and injects custom logic using services
 * defined in src/services/alternity-math.js and data models from src/data/.
 */

import { Hooks, game, fromUuid } from "../src/module-info.js";
import { AlternityMathService } from "../src/services/alternity-math.js";
import { AlternityRollService } from "../src/services/alternity-roll-service.js";
import { getAlternityState } from "../src/data/alternity-actor-data.js";

/** Flag scope shared with the roll service and the sheets. */
const NAMESPACE = 'alternity-v2';

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
    //
    // Resolution only. This listener used to *assemble* the actor's wound penalty
    // and active stances as well — but it fires after the dice have been rolled, so
    // those modifiers were traced onto the card and then had no effect on the
    // outcome, because the situation die they should have chosen was already cast.
    // Collecting them is now AlternityRollService.collectActorModifiers' job, called
    // by rollSkill before the formula is built. Re-adding them here would double
    // every wound penalty in the game.
    Hooks.on("alternity:resolveAbilityCheck", async (actor, rollOptions) => {
        const altState = await getAlternityState(actor);
        if (!altState) return;

        // The caller supplies the scores and base step; fall back to the state for a
        // caller that only knows the skill id.
        const scores = rollOptions.scores ?? altState.getSkillScores(rollOptions.skillId);
        const baseStep = rollOptions.baseStep ?? altState.getSkillBaseStep(rollOptions.skillId);

        // Both dice come from the caller. This used to hard-code `situation: 0`,
        // which threw away the situation die on every roll made through this path.
        const result = AlternityMathService.resolveAbilityCheck(
            scores,
            baseStep,
            rollOptions.modifiers ?? [],
            rollOptions.context,
            { control: rollOptions.roll, situation: rollOptions.situationRoll ?? 0 }
        );

        rollOptions.scores        = scores;
        rollOptions.baseStep      = baseStep;
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

    // 5. Chat card buttons
    //
    // Chat message content is rendered outside any ApplicationV2, so Foundry's
    // own `data-action` dispatcher never reaches it. The cards therefore mark
    // their buttons `data-alt-action` and are wired here.
    //
    // Exactly one hook is registered, chosen by Foundry generation — see
    // chatCardHookName for why registering both is not an option.
    const bindCardButtons = (message, element) => {
        // v12 hands over a jQuery object, v13+ a bare HTMLElement.
        const root = element?.[0] ?? element;
        if (!(root instanceof HTMLElement)) return;
        root.querySelectorAll('[data-alt-action]').forEach((button) => {
            button.addEventListener('click', (event) => onChatCardAction(event, message));
        });
    };
    Hooks.on(chatCardHookName(game.release?.generation), bindCardButtons);

    console.log("Alternity System Hooks: All core hooks successfully attached.");
}

/**
 * Which chat-render hook to listen on for this Foundry generation.
 *
 * Registering both is tempting and wrong. `renderChatMessage` is deprecated from
 * v13, and Foundry warns the moment it finds a *listener* on it — it does not wait
 * for the hook to matter:
 *
 *   The renderChatMessage hook is deprecated. Please use renderChatMessageHTML
 *   instead, which now passes an HTMLElement argument instead of jQuery.
 *   Deprecated since Version 13. Support will be removed in Version 15.
 *
 * On v13+ that warning fires for every chat message ever rendered, and the
 * callback would run twice per message, binding two click listeners to each
 * button. So the generation picks one.
 *
 * `system.json` declares a minimum of 12, which is why the v12 name is still here
 * at all; it can go once that floor rises to 13.
 *
 * @param {number} [generation] - `game.release.generation`. An unknown generation
 *        is assumed modern: guessing v12 on a future release would register a hook
 *        that no longer exists and silently kill every card button.
 * @returns {string}
 */
export function chatCardHookName(generation) {
    return (generation ?? 13) >= 13 ? 'renderChatMessageHTML' : 'renderChatMessage';
}

/**
 * Handle a click on one of the Alternity chat cards.
 *
 * Everything the buttons need was stashed in the message's own flags when the
 * card was posted — including the *resolved* damage grade and code, not the
 * three-column run — so a card stays usable after the sheet that produced it has
 * been closed, and after a reload.
 *
 * Exported so it can be tested without a live chat log; the DOM listener in
 * `initializeAlternityHooks` is a thin wrapper over it.
 *
 * @param {string} action - The button's `data-alt-action`.
 * @param {ChatMessage} message
 * @returns {Promise<object|null>} Whatever the underlying roll returned.
 */
export async function handleChatCardAction(action, message) {
    const flags = message?.flags?.[NAMESPACE] ?? {};

    if (action === 'rollDamage') {
        const damage = flags.check?.damage;
        if (!damage?.code) return null;

        // A token uuid resolves to a TokenDocument, whose `.actor` is what the roll
        // service wants; an Actor uuid resolves to the Actor itself.
        const resolved = damage.actorUuid ? await fromUuid(damage.actorUuid) : null;

        return AlternityRollService.rollDamage({
            actor: resolved?.actor ?? resolved,
            name: damage.name,
            code: damage.code,
            grade: damage.grade,
            damageType: damage.damageType,
            firepower: damage.firepower,
            targetToughness: damage.targetToughness,
            bonus: damage.bonus,
            fallbackCategory: damage.fallbackCategory,
            minimumOne: damage.minimumOne,
            whisper: damage.whisper,
        });
    }

    if (action === 'applyDamage') {
        if (!flags.damage) return null;
        return AlternityRollService.applyDamageToTargets(flags.damage);
    }

    return null;
}

/**
 * DOM wrapper around `handleChatCardAction`. Disables the button for the duration
 * so a double-click cannot roll damage twice, then re-enables it — a Gamemaster
 * legitimately rolls the same grade again for a second target rather than redoing
 * the attack check.
 *
 * @param {PointerEvent} event
 * @param {ChatMessage}  message
 */
async function onChatCardAction(event, message) {
    const button = event.currentTarget;
    button.disabled = true;
    try {
        await handleChatCardAction(button.dataset?.altAction, message);
    } finally {
        button.disabled = false;
    }
}
