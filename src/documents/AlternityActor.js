/**
 * @file AlternityActor.js
 * @description Step 8 — Document Class: AlternityActor extends Foundry's native Actor.
 *
 * Registered to CONFIG.Actor.documentClass in src/index.js. This class is the
 * single authoritative document for all actor types (character, npc, vehicle).
 *
 * Responsibilities:
 *   - prepareData() pipeline: base → derived → embedded items
 *   - Initiative roll wired to the Alternity formula (d100 + DEX mod)
 *   - Convenience accessors for the hook/service layer (altState, system.*)
 *   - applyDamage() override that routes through AlternityCharacterState then
 *     persists back to actor.system so Foundry's health bar stays in sync
 *   - rollSkill() / rollAbilityCheck() that fire the custom Alternity roll hook
 *     (consumed by alt-mechanics.js onCreateAbilityCheck)
 *
 * Data flow:
 *   actor.system.*           ← TypeDataModel (CharacterData / NpcData / VehicleData)
 *   actor flag 'alternity-v2/characterState' ← AlternityCharacterState (runtime wrapper)
 *
 * The flag-based AlternityCharacterState is still the primary store for
 * abilities, stances, and special rules — the two layers are kept in sync by
 * _syncSystemFromState() / _syncStateFromSystem() helpers called on key events.
 *
 * Architecture constraint:
 *   No arithmetic lives here. All math must go through AlternityMathService.
 */

import {
    getAlternityState,
    saveAlternityState,
    WOUND_PENALTIES,
    ABILITY_TYPES,
} from '../data/alternity-actor-data.js';
import { AlternityMathService } from '../services/alternity-math.js';
import { AlternityRollService } from '../services/alternity-roll-service.js';
import { Actor, Roll, ChatMessage, Hooks, game, renderTemplate } from '../module-info.js';

// ---------------------------------------------------------------------------
// AlternityActor
// ---------------------------------------------------------------------------

export class AlternityActor extends Actor {

    constructor(...args) {
        super(...args);
        console.log(`[Alternity] Instantiated AlternityActor for ${this.name} (${this.id})`);
    }

    // -----------------------------------------------------------------------
    // Foundry document lifecycle
    // -----------------------------------------------------------------------

    /**
     * Prepare all actor data. Foundry calls this in order:
     *   1. prepareBaseData()   — raw values from the database
     *   2. prepareEmbeddedDocuments() — items, effects
     *   3. prepareDerivedData() — computed values that depend on items/effects
     * @override
     */
    prepareData() {
        super.prepareData();
    }

    /**
     * Prepare base actor data before embedded documents are processed.
     * Safe to read from this.system; do NOT read from owned items here.
     * @override
     */
    prepareBaseData() {
        super.prepareBaseData();

        // Tag the actor type for template conditionals
        this.system.isCharacter = this.type === 'character';
        this.system.isNpc       = this.type === 'npc';
        this.system.isVehicle   = this.type === 'vehicle';
        this.system.isWarship   = this.type === 'warship';
    }

    /**
     * Prepare derived data after embedded documents (items) have been prepared.
     * Used to factor equipped armor/weapons into derived stats.
     * @override
     */
    prepareDerivedData() {
        super.prepareDerivedData();

        // Dispatch to type-specific preparation
        switch (this.type) {
            case 'character': return this._prepareCharacterData();
            case 'npc':       return this._prepareNpcData();
            case 'vehicle':   return this._prepareVehicleData();
            case 'warship':   return this._prepareWarshipData();
        }
    }

    // -----------------------------------------------------------------------
    // Type-specific data preparation
    // -----------------------------------------------------------------------

    /**
     * Derive character stats that depend on equipped items.
     * @private
     */
    _prepareCharacterData() {
        const sys = this.system;

        // Sum armor bonuses from equipped armor items
        const equippedArmor = this.items.filter(
            i => i.type === 'armor' && i.system.isEquipped
        );
        sys.totalArmorBonus     = equippedArmor.reduce((t, a) => t + (a.system.armorBonus ?? 0), 0);
        sys.totalSpeedPenalty   = equippedArmor.reduce((t, a) => t + (a.system.speedPenalty ?? 0), 0);
        sys.totalSkillPenalty   = equippedArmor.reduce((t, a) => t + (a.system.skillPenalty ?? 0), 0);

        // Derived defense. Alternity has no armor-class number: defending applies a
        // step penalty to the attacker's check, so this is DEX's resistance modifier
        // plus whatever the worn armor contributes. The old `10 + dex + armor` was a
        // d20-shaped formula that also read the DEX *score* as if it were a modifier.
        sys.resistanceModifier = AlternityMathService.calculateResistanceModifier(
            sys.abilities?.dex ?? 0, 'DEX'
        ) + sys.totalArmorBonus;

        // Derived speed: 30ft base − speed penalty
        sys.speed = Math.max(0, 30 - sys.totalSpeedPenalty);

        // Durability track percentages for the progress bars (stun/wound/mortal/
        // fatigue — the four types of damage the PHB defines).
        sys.stunPct    = this._resourcePct(sys.durability?.stun);
        sys.woundPct   = this._resourcePct(sys.durability?.wound);
        sys.mortalPct  = this._resourcePct(sys.durability?.mortal);
        sys.fatiguePct = this._resourcePct(sys.durability?.fatigue);
        sys.tpPct      = this._resourcePct(sys.techPoints);
        sys.ppPct      = this._resourcePct(sys.psiPoints);

        // Wound penalty (already derived by CharacterData.prepareDerivedData;
        // refresh here in case armorBonus changed woundLevel via applyDamage)
        sys.isIncapacitated = sys.woundLevel === 'Out';
    }

    /**
     * Derive NPC stats.
     * @private
     */
    _prepareNpcData() {
        const sys = this.system;
        // See _prepareCharacterData: a resistance modifier, not an armor class.
        // Supporting cast wear armour like anyone else, so equipped armour counts
        // here on top of the flat adjustment NpcData already applied. This used to
        // read `defenseBonus`, a d20 armor-class field that no longer exists.
        const equippedArmor = this.items.filter(
            i => i.type === 'armor' && i.system.isEquipped
        );
        sys.totalArmorBonus = equippedArmor.reduce((t, a) => t + (a.system.armorBonus ?? 0), 0);
        sys.resistanceModifier = AlternityMathService.calculateResistanceModifier(
            sys.abilities?.dex ?? 0, 'DEX'
        ) + (sys.resistanceBonus ?? 0) + sys.totalArmorBonus;
        sys.stunPct    = this._resourcePct(sys.durability?.stun);
        sys.woundPct   = this._resourcePct(sys.durability?.wound);
        sys.mortalPct  = this._resourcePct(sys.durability?.mortal);
        sys.fatiguePct = this._resourcePct(sys.durability?.fatigue);
        sys.isIncapacitated = sys.woundLevel === 'Out';
    }

    /**
     * Derive vehicle stats.
     * @private
     */
    _prepareVehicleData() {
        const sys = this.system;
        sys.hullPct   = this._resourcePct(sys.hullIntegrity);
        sys.shieldPct = this._resourcePct(sys.shields);
        sys.tpPct     = this._resourcePct(sys.techPoints);
        sys.isDisabled = (sys.hullIntegrity?.value ?? 0) <= 0;
    }

    /**
     * Derive warship stats. WarshipData.prepareDerivedData() already computes
     * damage percentages and shipStatus; this method exists for symmetry with
     * the other type branches and as a hook point for future cross-item
     * concerns (Phase 2 embedded-item sums, once ship systems become Items).
     * @private
     */
    _prepareWarshipData() {
        // Intentionally minimal — see WarshipData.prepareDerivedData().
    }

    /**
     * Compute percentage (0–100) for a resource object with value/max.
     * @param {{ value: number, max: number }} resource
     * @returns {number}
     * @private
     */
    _resourcePct(resource) {
        if (!resource || !resource.max) return 0;
        return Math.min(100, Math.max(0, Math.round((resource.value / resource.max) * 100)));
    }

    // -----------------------------------------------------------------------
    // Alternity state bridge
    // -----------------------------------------------------------------------

    /**
     * Retrieve the AlternityCharacterState flag-wrapper for this actor.
     * Thin proxy to getAlternityState() — use this in hooks and the sheet
     * rather than importing getAlternityState directly.
     *
     * @returns {Promise<import('../data/alternity-actor-data.js').AlternityCharacterState|null>}
     */
    async getAltState() {
        return getAlternityState(this);
    }

    /**
     * Persist an AlternityCharacterState back to this actor's flags, then
     * synchronise key values into actor.system so Foundry's native UI stays current.
     *
     * @param {import('../data/alternity-actor-data.js').AlternityCharacterState} state
     * @returns {Promise<boolean>}
     */
    async saveAltState(state) {
        const ok = await saveAlternityState(this, state);
        if (ok) await this._syncSystemFromState(state);
        return ok;
    }

    /**
     * Write wound level and resource values from AlternityCharacterState back into
     * actor.system so Foundry's built-in bars and token attributes reflect the
     * current state without requiring a flag read.
     *
     * @param {import('../data/alternity-actor-data.js').AlternityCharacterState} state
     * @private
     */
    async _syncSystemFromState(state) {
        // Only heroes and supporting cast keep an AlternityCharacterState; every
        // other actor type owns its numbers entirely in its own TypeDataModel.
        // This used to deny-list vehicle and warship, which meant each new actor
        // type added since (spaceship, robot, ai) would have fallen through and
        // tried to write durability and psionics fields it does not have.
        if (!['character', 'npc'].includes(this.type)) return;

        // All four damage tracks now mirror across, not just the two that used to
        // hide behind the `stamina`/`vitality` names. Mortal previously had no
        // system-side home at all, so token bars could never show it.
        const updates = {
            'system.woundLevel':                 state.woundLevel,
            'system.durability.stun.value':      state.durability.stun,
            'system.durability.stun.max':        state.durability.stunMax,
            'system.durability.wound.value':     state.durability.wound,
            'system.durability.wound.max':       state.durability.woundMax,
            'system.durability.mortal.value':    state.durability.mortal,
            'system.durability.mortal.max':      state.durability.mortalMax,
            'system.durability.fatigue.value':   state.durability.fatigue,
            'system.durability.fatigue.max':     state.durability.fatigueMax,
            'system.psionics.energy.value': state.psionics.energy.value,
            'system.psionics.energy.max':   state.psionics.energy.max,
        };

        // Last resort points live on both layers for the same reason durability
        // does: the state owns them, system mirrors them for native display.
        if (state.lastResort) {
            updates['system.lastResort.value'] = state.lastResort.value;
            updates['system.lastResort.max']   = state.lastResort.max;
        }

        // Sync ability scores if present on this actor type
        if (this.type === 'character' || this.type === 'npc') {
            for (const [key, val] of Object.entries(state.abilityScores)) {
                updates[`system.abilities.${key.toLowerCase()}`] = val;
            }
        }

        try {
            await this.update(updates);
        } catch (err) {
            console.error(`[Alternity] _syncSystemFromState failed for actor ${this.id}:`, err);
        }
    }

    // -----------------------------------------------------------------------
    // Roll API
    // -----------------------------------------------------------------------

    /**
     * Roll a skill check for this actor.
     *
     * This is the *programmatic* entry point — macros, modules, and anything that
     * wants the custom hooks to fire. The sheets go through AlternityRollService
     * instead, which is what gives the player a panel to pick a circumstance
     * modifier in; this path takes its modifiers from the caller and the hooks.
     *
     * The full control-plus-situation formula is rolled here, and both dice are
     * handed to the hook layer. It used to roll a bare `1d20` and pass
     * `situation: 0`, so the situation die was assembled by the hooks and then
     * never rolled — meaning modifiers had no effect whatsoever on any check made
     * through this method.
     *
     * @param {string}  skillId    - Skill id from SKILL_DEFINITIONS.
     * @param {object}  [options]  - Optional overrides.
     * @param {string}  [options.context]      - Override the roll context label.
     * @param {object[]}[options.modifiers]    - Step modifiers to apply.
     * @param {boolean} [options.whisper]      - If true, roll is whispered to GM.
     * @returns {Promise<object|null>} Roll result or null if incapacitated.
     */
    async rollSkill(skillId, options = {}) {
        const altState = await this.getAltState();
        if (!altState) return null;

        if (altState.woundLevel === 'Out') {
            ui.notifications?.warn(game.i18n.localize('ALTERNITY.Errors.Incapacitated'));
            return null;
        }

        const skillDef  = (await import('../data/alternity-actor-data.js'))
            .SKILL_DEFINITIONS.find(d => d.id === skillId);
        const context   = options.context ?? skillDef?.name ?? 'Skill Check';

        const scores   = altState.getSkillScores(skillId);
        const baseStep = altState.getSkillBaseStep(skillId);

        const rollOptions = {
            context,
            actor:   this,
            skillId,
            scores,
            baseStep,
            baseValue: scores.ordinary,
            // The actor's standing modifiers — wound level, the Dazed fatigue
            // penalty, active stances, worn armour — are collected *before* the
            // dice are rolled, because they decide which situation die is rolled.
            //
            // They used to be assembled by the `alternity:resolveAbilityCheck`
            // listener, which fires after the roll: the modifiers were computed,
            // printed in the trace, and then had no effect on the outcome, because
            // the die they should have selected had already been rolled as a bare
            // d20. That listener no longer adds them, so this is not a double count.
            modifiers: [
                ...(options.modifiers ?? []),
                ...await AlternityRollService.collectActorModifiers(this, { context }),
            ],
            whisper: options.whisper ?? false,
        };

        // Fire the custom hook — intercepted by onCreateAbilityCheck in
        // alt-mechanics.js. Listeners may push further modifiers, so this has to run
        // before the formula is built.
        Hooks.call('alternity:abilityCheck', this, rollOptions);

        const totalStep = baseStep + rollOptions.modifiers.reduce((sum, m) => sum + m.value, 0);
        const situation = AlternityMathService.buildSituationFormula(totalStep);

        const roll = await new Roll(situation.formula).evaluate();

        rollOptions.roll    = roll.terms[situation.controlIndex]?.total ?? roll.total;
        rollOptions.situationRoll = situation.hasSituation
            ? (roll.terms[situation.situationIndex]?.total ?? 0)
            : 0;
        rollOptions.rollObj = roll;

        // Let the hook layer calculate the result + modifier trace.
        await Hooks.callAll('alternity:resolveAbilityCheck', this, rollOptions);

        // If the hook didn't resolve it (e.g. no listener), do it directly.
        if (rollOptions.adjustedValue === undefined) {
            const result = AlternityMathService.resolveAbilityCheck(
                scores, baseStep, rollOptions.modifiers, context,
                { control: rollOptions.roll, situation: rollOptions.situationRoll }
            );
            rollOptions.adjustedValue = result.finalValue;
            rollOptions.modifierTrace = result.modifierTrace;
            rollOptions.succeeded     = result.succeeded;
            rollOptions.degree        = result.degree;
            rollOptions.margin        = result.margin;
        }

        // Post to chat log
        await this._createRollChatMessage(roll, rollOptions);

        return rollOptions;
    }

    /**
     * Attack roll for a skill id, without a weapon item.
     *
     * For an unarmed or improvised attack, or a macro that only knows the skill.
     * A weapon's attack goes through `AlternityItem.rollAttack`, which also brings
     * the accuracy, the range band and the three damage grades with it.
     *
     * @param {string}  [skillId='str-unarmed'] - Attack skill id.
     * @param {object}  [options]
     * @returns {Promise<object|null>}
     */
    async rollAttack(skillId = 'str-unarmed', options = {}) {
        return this.rollSkill(skillId, { context: 'Combat', ...options });
    }

    /**
     * Roll initiative for this actor using the Alternity Action Check system:
     *   1d20 compared against Action Check scores (Amazing, Good, Ordinary, Marginal).
     *   Higher phase acts earlier.
     *
     * @param {object} [options]
     * @param {Combatant} [options.combatant] - The combatant that triggered the roll.
     * @returns {Promise<number>} The calculated initiative value.
     */
    async rollInitiative(options = {}) {
        console.log('[Alternity] rollInitiative called in src/documents/AlternityActor.js');
        const altState = await this.getAltState();
        if (!altState) return super.rollInitiative(options);

        // 1. Roll 1d20 (Action Check)
        const roll = await new Roll('1d20').evaluate();
        const result = roll.total;

        // 2. Get AC scores and Actions
        const ac = altState.getActionCheckData();
        const totalActions = altState.getActionsPerRound();
        
        // 3. Determine acting Phase
        let phase = 1; // Marginal (default if roll > Ordinary)
        let phaseLabel = 'Marginal';

        if (result <= ac.amazing) {
            phase = 4;
            phaseLabel = 'Amazing';
        } else if (result <= ac.good) {
            phase = 3;
            phaseLabel = 'Good';
        } else if (result <= ac.ordinary) {
            phase = 2;
            phaseLabel = 'Ordinary';
        }

        // 4. Calculate Initiative: (Phase * 10) + (ac.ordinary / 100)
        // This sorts by Phase (4 first), then by Ordinary Score for tie-breaking.
        const baseInit = (phase * 10) + (ac.ordinary / 100);
        console.log(`[Alternity] Roll: ${result}, Phase: ${phaseLabel}, Score: ${ac.ordinary}, Calculated Init: ${baseInit}`);

        // Post the action check result to chat using the template
        const content = await renderTemplate("systems/alternity-v2/templates/roll/action-check-card.hbs", {
            actorName: this.name,
            phaseLabel,
            result,
            ac,
            rollHtml: await roll.render()
        });

        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: this }),
            content,
            rolls: [roll],
            style: CONST.CHAT_MESSAGE_STYLES?.ROLL ?? CONST.CHAT_MESSAGE_STYLES?.OTHER ?? 0
        });

        // 5. Handle Multiple Actions (Extra Combatants)
        const combatant = options.combatant || (game.combat ? game.combat.combatants.find(c => c.actorId === this.id) : null);
        const combat = combatant?.combat || game.combat;
        
        console.log(`[Alternity] Combatant detected: ${!!combatant}, Combat detected: ${!!combat}, Actions: ${totalActions}`);

        if (combat && combatant && totalActions > 1) {
            console.log(`[Alternity] Handling ${totalActions} actions for ${this.name} in Combat ${combat.id}`);
            
            const extraCombatants = [];
            for (let i = 1; i < totalActions; i++) {
                const nextPhase = phase - i;
                if (nextPhase >= 1) {
                    const extraData = {
                        name: `${this.name} (Action ${i + 1})`,
                        tokenId: combatant.tokenId,
                        actorId: combatant.actorId,
                        sceneId: combatant.sceneId,
                        initiative: (nextPhase * 10) + (ac.ordinary / 100),
                        'flags.alternity-v2.isExtraAction': true,
                        'flags.alternity-v2.actionNumber': i + 1,
                        'flags.alternity-v2.parentCombatantId': combatant.id
                    };
                    console.log(`[Alternity] Preparing extra turn data:`, extraData);
                    extraCombatants.push(extraData);
                } else {
                    console.log(`[Alternity] Phase ${nextPhase} is invalid, skipping extra turn.`);
                }
            }
            if (extraCombatants.length > 0) {
                const created = await combat.createEmbeddedDocuments('Combatant', extraCombatants);
                console.log(`[Alternity] Created ${created.length} extra combatants:`, created);
            }
        }

        return baseInit;
    }

    // -----------------------------------------------------------------------
    // Damage application
    // -----------------------------------------------------------------------

    /**
     * Apply mitigated damage to this actor.
     *
     * Routing:
     *   1. Load AlternityCharacterState from flags.
     *   2. Run damage through AlternityMathService.calculateMitigatedDamage()
     *      using resistance modifiers from active passives / stances.
     *   3. Apply final damage via AlternityCharacterState.applyDamage().
     *      Fastplay Rule: Secondary damage is calculated from rawDamage BEFORE armor reduction.
     *   4. Persist state back to flags AND sync actor.system.
     *
     * @param {number} rawDamage   - Unmitigated damage amount.
     * @param {string} damageType  - The weapon's damage type (e.g. 'Ballistic', 'HI').
     * @param {object} [options]
     * @param {string} [options.context='Combat'] - Log context.
     * @param {string} [options.category='wound'] - Damage category ('stun', 'wound', 'mortal').
     * @returns {Promise<{ finalDamage: number, woundLevelChanged: boolean, newWoundLevel: string }|null>}
     */
    async applyAlternityDamage(rawDamage, damageType = 'Ballistic', options = {}) {
        const context  = options.context ?? 'Combat';
        const altState = await this.getAltState();
        if (!altState) return null;

        // Determine damage category from options or damageType string (fallback)
        let category = options.category;
        if (!category) {
            const lowerType = damageType.toLowerCase();
            if (lowerType.includes('stun') || lowerType.includes('s')) category = 'stun';
            else if (lowerType.includes('mortal') || lowerType.includes('m')) category = 'mortal';
            else category = 'wound'; // Default to wound
        }

        // Collect mitigation modifiers from active passive traits and stances
        const modifiers = [];

        const passives = altState.getActiveAbilitiesByType(ABILITY_TYPES.PASSIVE);
        for (const passive of passives) {
            const payload = passive.effectPayload;
            if (typeof payload.damageResistance !== 'number') continue;
            if (payload.resistsDamageType && payload.resistsDamageType !== damageType) continue;
            modifiers.push(AlternityMathService.buildModifier(
                passive.name,
                -payload.damageResistance,
                `Resistance: ${passive.name}`,
            ));
        }

        const stances = altState.getActiveAbilitiesByType(ABILITY_TYPES.STANCE);
        for (const stance of stances) {
            const payload = stance.effectPayload;
            if (typeof payload.damageReduction !== 'number') continue;
            modifiers.push(AlternityMathService.buildModifier(
                stance.name,
                -payload.damageReduction,
                `Stance mitigation: ${stance.name}`,
            ));
        }

        // Also factor in equipped armor's damage resistance
        const armor = this.items.find(i => i.type === 'armor' && i.system.isEquipped);
        if (armor && armor.system.damageResistance > 0) {
            const resists = armor.system.resistedTypes;
            const applies = !resists.length || resists.includes(damageType);
            if (applies) {
                modifiers.push(AlternityMathService.buildModifier(
                    armor.name,
                    -armor.system.damageResistance,
                    `Armor: ${armor.name}`,
                ));
            }
        }

        const { finalDamage, modifierTrace, mitigated } =
            AlternityMathService.calculateMitigatedDamage(rawDamage, modifiers, context);

        // Apply damage. Pass rawDamage as the basis for secondary damage calculation.
        const { woundLevelChanged, newWoundLevel } = altState.applyDamage(finalDamage, category, rawDamage);

        await this.saveAltState(altState);

        console.log(
            `[Alternity] ${this.name} took ${finalDamage} ${category} damage (${damageType}) ` +
            `(${rawDamage} raw, ${mitigated} mitigated). Wound: ${newWoundLevel}.`
        );

        // Notify other modules
        Hooks.callAll('alternity:damageApplied', this, {
            rawDamage, finalDamage, mitigated, damageType, category,
            modifierTrace, woundLevelChanged, newWoundLevel,
        });

        return { finalDamage, mitigated, modifierTrace, woundLevelChanged, newWoundLevel };
    }

    /**
     * Apply ship-combat damage to this warship actor (Warships Ch.1: "Firepower
     * and Toughness" / "Effects of Damage"). Resolves the firepower-vs-toughness
     * grade shift, negates damage with the ship's rolled armor value for the
     * given damage type, applies the rulebook's 2-for-1 overflow cascade
     * (excess stun -> wound, excess wound -> mortal, excess mortal -> critical),
     * and persists the updated damage track.
     *
     * Armor dice must already be rolled by the caller (this method stays pure
     * of dice-rolling, matching the "no dice logic outside the roll pipeline"
     * constraint) — pass the rolled result via options.armorRoll.
     *
     * @param {number} rawDamage       - Unmitigated damage roll result.
     * @param {string} damageType      - 'lowImpact' | 'highImpact' | 'energy'.
     * @param {string} firepowerClass  - Attacking weapon's firepower class (SHIP_TOUGHNESS_CLASSES).
     * @param {object} [options]
     * @param {string} [options.damageGrade='wound'] - Base damage grade before any shift.
     * @param {number} [options.armorRoll=0]         - Already-rolled armor die result for damageType.
     * @param {string} [options.context='Ship Combat'] - Log context.
     * @returns {Promise<{ finalDamage: number, finalGrade: string, multiplier: number, newShipStatus: string, modifierTrace: object[] }|null>}
     */
    async applyWarshipDamage(rawDamage, damageType, firepowerClass, options = {}) {
        if (this.type !== 'warship') return null;

        const context     = options.context ?? 'Ship Combat';
        const damageGrade  = options.damageGrade ?? 'wound';
        const armorRoll    = options.armorRoll ?? 0;
        const sys          = this.system;

        const shiftResult = AlternityMathService.calculateFirepowerShift(
            damageGrade, firepowerClass, sys.toughness
        );

        if (shiftResult.finalGrade === 'none') {
            return {
                finalDamage: 0, finalGrade: 'none', multiplier: shiftResult.multiplier,
                newShipStatus: sys.shipStatus, modifierTrace: shiftResult.modifierTrace,
            };
        }

        const gradedRawDamage = rawDamage * shiftResult.multiplier;

        const armorRatings = {
            lowImpact:  Number(sys.armor.lowImpact)  || 0,
            highImpact: Number(sys.armor.highImpact) || 0,
            energy:     Number(sys.armor.energy)     || 0,
        };
        armorRatings[damageType] = armorRoll;

        const { finalDamage, modifierTrace, mitigated } = AlternityMathService.calculateShipDamageMitigation(
            gradedRawDamage, damageType, armorRatings, context
        );

        // Apply to the graded track, cascading overflow 2-for-1 into the next-worse track
        // (Warships Ch.1: Shaken/Disabled/Crippled overflow rules).
        const TRACK_ORDER = ['stun', 'wound', 'mortal', 'critical'];
        let remaining = finalDamage;
        let idx = TRACK_ORDER.indexOf(shiftResult.finalGrade);
        const updates = {};

        while (remaining > 0 && idx < TRACK_ORDER.length) {
            const track = TRACK_ORDER[idx];
            const current = sys.damage[track];
            const room = Math.max(0, current.max - current.value);
            const applied = Math.min(room, remaining);
            updates[`system.damage.${track}.value`] = current.value + applied;
            remaining -= applied;

            if (remaining > 0) {
                // Track is full — excess bleeds 2-for-1 into the next-worse track.
                remaining = Math.floor(remaining / 2);
                idx += 1;
            }
        }

        await this.update(updates);

        console.log(
            `[Alternity] ${this.name} took ${finalDamage} ${shiftResult.finalGrade} damage ` +
            `(${damageType}, ${firepowerClass} vs ${sys.toughness}) (${gradedRawDamage} graded, ${mitigated} mitigated). ` +
            `Status: ${this.system.shipStatus}.`
        );

        Hooks.callAll('alternity:shipDamageApplied', this, {
            rawDamage, gradedRawDamage, finalDamage, mitigated, damageType, firepowerClass,
            finalGrade: shiftResult.finalGrade, multiplier: shiftResult.multiplier,
            modifierTrace: [...shiftResult.modifierTrace, ...modifierTrace],
            newShipStatus: this.system.shipStatus,
        });

        return {
            finalDamage,
            finalGrade: shiftResult.finalGrade,
            multiplier: shiftResult.multiplier,
            newShipStatus: this.system.shipStatus,
            modifierTrace: [...shiftResult.modifierTrace, ...modifierTrace],
        };
    }

    /**
     * True when this warship's damage track has crossed into Disabled, Crippled,
     * or Destroyed (Warships Ch.1 "Effects of Damage").
     * @returns {boolean}
     */
    get isWarshipDisabled() {
        if (this.type !== 'warship') return false;
        return ['Disabled', 'Crippled', 'Destroyed'].includes(this.system?.shipStatus);
    }

    // -----------------------------------------------------------------------
    // Cybertech
    // -----------------------------------------------------------------------

    /**
     * Resolve this actor's cyber tolerance track from their Constitution score and
     * the cyber gear currently installed in their body (PHB Ch.15 "Cyber Tolerance").
     *
     * Only installed gear counts — an owned-but-uninstalled cybertech item is cargo.
     * Mechalus heroes get CON+4; species is free text on the sheet, so it is matched
     * by name rather than by a dedicated flag.
     *
     * @param {object} [options]
     * @param {string|string[]} [options.alsoInstall] - Item id(s) to count as installed even if
     *        they are not yet, so a caller can ask "what would the track look like if I fitted this?"
     * @param {number} [options.constitution] - CON score to use instead of the `system.abilities.con`
     *        mirror. Callers that already hold an AlternityCharacterState should pass
     *        `state.abilityScores.CON`: the state is the source of truth for gameplay logic, while
     *        `system.abilities.*` is a mirror that is only refreshed when the state is saved.
     * @returns {object|null} The result of AlternityMathService.calculateCyberTolerance,
     *                        or null for actor types that have no tolerance track.
     */
    getCyberTolerance(options = {}) {
        if (!['character', 'npc'].includes(this.type)) return null;

        const alsoInstall = options.alsoInstall === undefined ? []
            : Array.isArray(options.alsoInstall) ? options.alsoInstall
            : [options.alsoInstall];

        const con = options.constitution ?? this.system?.abilities?.con ?? 0;
        const installed = this.items
            .filter(i => i.type === 'cybertech' && (i.system?.isInstalled || alsoInstall.includes(i.id)))
            .map(i => ({ name: i.name, size: i.system?.size ?? 0 }));

        const species = String(this.system?.details?.species ?? '').toLowerCase();

        return AlternityMathService.calculateCyberTolerance(con, installed, {
            isMechalus: species.includes('mechalus'),
        });
    }

    /**
     * Roll up this actor's computer active memory budget and what the programs
     * they have loaded are consuming (Player's Handbook Ch.10; Dataware Ch.2).
     *
     * Capacity is the sum of every owned computer's active memory. That is a
     * deliberate simplification of the book, which tracks memory per machine:
     * modelling it per-computer would mean each program storing which computer
     * it lives in, and nothing in the sheet asks that question yet. Revisit if
     * a hero ever needs to run two machines with separate program loadouts.
     *
     * A supercomputer has unlimited active memory, so any owned computer marked
     * as one lifts the ceiling entirely.
     *
     * @param {object} [options]
     * @param {string} [options.alsoLoad] - Id of a program to count as loaded, for
     *        testing whether it would fit before committing the change.
     * @returns {object|null} The result of AlternityMathService.calculateActiveMemory.
     */
    getActiveMemory(options = {}) {
        if (!['character', 'npc'].includes(this.type)) return null;

        const alsoLoad = options.alsoLoad === undefined ? []
            : Array.isArray(options.alsoLoad) ? options.alsoLoad
            : [options.alsoLoad];

        const computers = this.items.filter(i => i.type === 'computer');
        const capacity  = computers.reduce((sum, c) => sum + (c.system?.activeMemory ?? 0), 0);

        // "Supercomputer" is recorded in the processor quality free-text field —
        // there is no dedicated flag for it on ComputerData.
        const unlimited = computers.some(
            c => String(c.system?.processorQuality ?? '').toLowerCase().includes('supercomputer')
        );

        const loaded = this.items
            .filter(i => i.type === 'program' && (i.system?.isLoaded || alsoLoad.includes(i.id)))
            .map(i => ({ name: i.name, slots: i.system?.slots ?? 0 }));

        return AlternityMathService.calculateActiveMemory(capacity, loaded, { unlimited });
    }

    // -----------------------------------------------------------------------
    // Chat message creation
    // -----------------------------------------------------------------------

    /**
     * Create a Foundry ChatMessage for a completed ability check roll.
     * The message body contains the modifier breakdown table so all players
     * see the same result and trace.
     *
     * @param {Roll}   roll        - The evaluated Foundry Roll object.
     * @param {object} rollOptions - Options object mutated by the hook layer.
     * @private
     */
    async _createRollChatMessage(roll, rollOptions) {
        const {
            context,
            scores,
            baseValue,
            adjustedValue,
            succeeded,
            degree,
            margin,
            modifierTrace = [],
            whisper,
        } = rollOptions;

        const content = await renderTemplate("systems/alternity-v2/templates/roll/roll-card.hbs", {
            context,
            actorName: this.name,
            succeeded,
            degree,
            oga: scores,
            rollHtml: await roll.render(),
            modifierTrace,
            adjustedValue
        });

        const messageData = {
            speaker: ChatMessage.getSpeaker({ actor: this }),
            content,
            style:   CONST.CHAT_MESSAGE_STYLES?.ROLL ?? CONST.CHAT_MESSAGE_STYLES?.OTHER ?? 0,
            rolls:   [roll],
            sound:   CONFIG.sounds?.dice,
        };

        if (whisper) {
            messageData.whisper = ChatMessage.getWhisperRecipients('GM');
        }

        await ChatMessage.create(messageData);
    }

    // -----------------------------------------------------------------------
    // Convenience getters
    // -----------------------------------------------------------------------

    /** True if this actor is incapacitated (wound level 'Out'). */
    get isIncapacitated() {
        return this.system?.woundLevel === 'Out';
    }

    /** Current wound penalty modifier (0, -5, -10, or null if Out). */
    get woundPenalty() {
        return WOUND_PENALTIES[this.system?.woundLevel] ?? 0;
    }

    /**
     * DEX's resistance modifier — the step penalty an attacker takes against this
     * actor. Replaces the old `dexModifier` getter, which returned the raw DEX score
     * under a name that invited callers to treat it as a modifier.
     */
    get dexResistanceModifier() {
        return AlternityMathService.calculateResistanceModifier(this.system?.abilities?.dex ?? 0, 'DEX');
    }
}
