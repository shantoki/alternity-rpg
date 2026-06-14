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
import { Actor, Roll, ChatMessage, game } from '../module-info.js';

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

        // Derived defense: 10 + DEX modifier + armor bonus
        sys.defense = 10 + (sys.abilities?.dex ?? 0) + sys.totalArmorBonus;

        // Derived speed: 30ft base − speed penalty
        sys.speed = Math.max(0, 30 - sys.totalSpeedPenalty);

        // Stamina / Vitality percent for progress bars
        sys.staminaPct  = this._resourcePct(sys.stamina);
        sys.vitalityPct = this._resourcePct(sys.vitality);
        sys.tpPct       = this._resourcePct(sys.techPoints);
        sys.ppPct       = this._resourcePct(sys.psiPoints);

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
        sys.defense    = 10 + (sys.abilities?.dex ?? 0) + (sys.defenseBonus ?? 0);
        sys.staminaPct = this._resourcePct(sys.stamina);
        sys.vitalityPct = this._resourcePct(sys.vitality);
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
        if (this.type === 'vehicle') return; // vehicles don't use AlternityCharacterState

        const updates = {
            'system.woundLevel':        state.woundLevel,
            'system.stamina.value':     state.durability.stun,
            'system.stamina.max':       state.durability.stunMax,
            'system.vitality.value':    state.durability.wound,
            'system.vitality.max':      state.durability.woundMax,
            'system.psionics.energy.value': state.psionics.energy.value,
            'system.psionics.energy.max':   state.psionics.energy.max,
        };

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
     * Roll a skill check for this actor. Assembles the roll options object and
     * fires the 'alternity:abilityCheck' custom hook, which alt-mechanics.js
     * intercepts to apply stances, wound penalties, and momentum.
     *
     * @param {string}  skillId    - Skill id from SKILL_DEFINITIONS.
     * @param {object}  [options]  - Optional overrides.
     * @param {number}  [options.baseValue]  - Override the derived target number.
     * @param {string}  [options.context]    - Override the roll context label.
     * @param {boolean} [options.whisper]    - If true, roll is whispered to GM.
     * @returns {Promise<object|null>} Roll result or null if incapacitated.
     */
    async rollSkill(skillId, options = {}) {
        const altState = await this.getAltState();
        if (!altState) return null;

        if (altState.woundLevel === 'Out') {
            ui.notifications?.warn(game.i18n.localize('ALTERNITY.Errors.Incapacitated'));
            return null;
        }

        const baseValue = options.baseValue ?? altState.getSkillDC(skillId);
        const skillDef  = (await import('../data/alternity-actor-data.js'))
            .SKILL_DEFINITIONS.find(d => d.id === skillId);
        const context   = options.context ?? skillDef?.name ?? 'Skill Check';

        const rollOptions = {
            baseValue,
            context,
            actor:   this,
            skillId,
            whisper: options.whisper ?? false,
        };

        // Fire the custom hook — intercepted by onCreateAbilityCheck in alt-mechanics.js
        Hooks.call('alternity:abilityCheck', this, rollOptions);

        // Execute the roll using Foundry's Roll API
        const roll = await new Roll('1d20').evaluate();

        rollOptions.roll   = roll.total;
        rollOptions.rollObj = roll;

        // Let the hook layer calculate the adjusted value + modifier trace
        await Hooks.callAll('alternity:resolveAbilityCheck', this, rollOptions);

        // If the hook didn't set adjustedValue (e.g. no hook fired), do it directly
        if (rollOptions.adjustedValue === undefined) {
            const scores = altState.getSkillScores(skillId);
            const baseStep = altState.getSkillBaseStep(skillId);
            const result = AlternityMathService.resolveAbilityCheck(
                scores, baseStep, [], context, { control: roll.total, situation: 0 }
            );
            rollOptions.scores        = scores;
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
     * Quick combat attack roll. Used by the sheet's quick-roll bar.
     *
     * @param {string}  [skillId='str-melee'] - Attack skill id.
     * @param {object}  [options]
     * @returns {Promise<object|null>}
     */
    async rollAttack(skillId = 'str-melee', options = {}) {
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
            type: CONST.CHAT_MESSAGE_TYPES?.ROLL ?? 0
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
            type:    CONST.CHAT_MESSAGE_TYPES?.ROLL ?? 0,
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

    /** The actor's DEX modifier — used for initiative and ranged attack/defense. */
    get dexModifier() {
        return this.system?.abilities?.dex ?? 0;
    }
}
