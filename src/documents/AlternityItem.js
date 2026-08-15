/**
 * @file AlternityItem.js
 * @description Step 8 — Document Class: AlternityItem extends Foundry's native Item.
 *
 * Registered to CONFIG.Item.documentClass in src/index.js. Covers all item
 * types: weapon, armor, skill, effect.
 *
 * Responsibilities:
 *   - prepareData() pipeline for each item type
 *   - rollAttack() for weapon items — fires through AlternityActor.rollSkill()
 *   - rollSkill() for skill items — delegates to the owning actor
 *   - use() for effect items — validates prerequisites via SystemEffectItem,
 *     deducts resource costs, then fires the alternity:effectUsed hook
 *   - Convenience getters used by the sheet and Handlebars templates
 *
 * Architecture constraint:
 *   No arithmetic lives here. All math goes through AlternityMathService
 *   (accessed via the owning actor's rollSkill / applyAlternityDamage methods).
 */

import { getEffectTemplate, saveEffectTemplate } from '../data/alternity-item-template.js';
import { getAlternityState, saveAlternityState }  from '../data/alternity-actor-data.js';
import { AlternityMathService }                   from '../services/alternity-math.js';

// ---------------------------------------------------------------------------
// AlternityItem
// ---------------------------------------------------------------------------

export class AlternityItem extends Item {

    // -----------------------------------------------------------------------
    // Foundry document lifecycle
    // -----------------------------------------------------------------------

    /** @override */
    prepareData() {
        super.prepareData();
    }

    /** @override */
    prepareDerivedData() {
        super.prepareDerivedData();

        switch (this.type) {
            case 'weapon': return this._prepareWeaponData();
            case 'armor':  return this._prepareArmorData();
            case 'skill':  return this._prepareSkillData();
            case 'effect': return this._prepareEffectData();
            case 'perkFlaw': return this._preparePerkFlawData();
            case 'personalEquipment': return this._preparePersonalEquipmentData();
            case 'cybertech': return this._prepareCybertechData();
        }
    }

    // -----------------------------------------------------------------------
    // Type-specific preparation
    // -----------------------------------------------------------------------

    /**
     * Compute derived attack / damage labels for the weapon sheet and chat card.
     * @private
     */
    _prepareWeaponData() {
        const sys   = this.system;
        const actor = this.actor;

        // No ability term here. An Alternity attack is a skill check rolled under
        // (ability score + rank) — the ability is already the basis of the score the
        // sheet rolls against, so folding it in counted it twice. `attackBonus` is the
        // weapon's own situation-die step modifier (negative is a bonus, per the
        // convention used throughout this codebase).
        sys.totalAttackBonus = sys.attackBonus ?? 0;

        // Damage is the weapon's die, its own flat bonus, and — for melee and thrown
        // weapons only — the wielder's Strength damage adjustment (PHB Table P9; Ch.2
        // "Strength" limits it to unarmed, melee and thrown attacks). This used to add
        // the raw ability *score* for every weapon type, so a STR 12 hero's d4+1w knife
        // rolled d4+13, and their rifle got the bonus too.
        // Unowned (compendium/sidebar) weapons get no adjustment at all rather than the
        // -1 a STR of 0 would imply — there is no wielder to draw a Strength from.
        const usesStrengthDamage = actor && ['Melee', 'Thrown'].includes(sys.weaponType);
        sys.strengthDamageAdjustment = usesStrengthDamage
            ? AlternityMathService.calculateStrengthDamageAdjustment(actor.system?.abilities?.str ?? 0)
            : 0;

        const damageMod = (sys.damageBonus ?? 0) + sys.strengthDamageAdjustment;
        sys.fullDamageFormula = damageMod === 0
            ? sys.damageFormula
            : damageMod > 0
                ? `${sys.damageFormula}+${damageMod}`
                : `${sys.damageFormula}${damageMod}`;

        // Range display (ranged/thrown only)
        const r = sys.range;
        sys.rangeDisplay = (r?.long ?? 0) > 0
            ? `${r.short}/${r.medium}/${r.long} ft`
            : '—';

        // Status labels
        sys.equippedLabel   = sys.isEquipped ? game.i18n.localize('ALTERNITY.Equipped') : game.i18n.localize('ALTERNITY.Stowed');
        sys.techCostDisplay = sys.techPointCost > 0 ? `${sys.techPointCost} TP` : '—';
    }

    /**
     * Compute derived defense contribution and penalty display labels.
     * @private
     */
    _prepareArmorData() {
        const sys = this.system;

        sys.defenseBonusLabel  = sys.armorBonus > 0 ? `+${sys.armorBonus}` : '0';
        sys.speedPenaltyLabel  = sys.speedPenalty  > 0 ? `-${sys.speedPenalty} ft` : '—';
        sys.skillPenaltyLabel  = sys.skillPenalty  > 0 ? `-${sys.skillPenalty}` : '—';
        sys.resistanceLabel    = sys.damageResistance > 0
            ? `${sys.damageResistance} DR${sys.resistedTypes.length ? ' (' + sys.resistedTypes.join(', ') + ')' : ''}`
            : '—';
        sys.equippedLabel      = sys.isEquipped ? game.i18n.localize('ALTERNITY.Equipped') : game.i18n.localize('ALTERNITY.Stowed');
        sys.techCostDisplay    = sys.techPointCost > 0 ? `${sys.techPointCost} TP/scene` : '—';
    }

    /**
     * Refresh the cached targetNumber using the owning actor's current ability scores.
     * SkillData.prepareDerivedData() already handles this if the actor is available;
     * this ensures it runs during item-level preparation too.
     * @private
     */
    _prepareSkillData() {
        const sys        = this.system;
        const actor      = this.actor;
        const abilityKey = sys.linkedAbility?.toLowerCase();
        const abilityScore = actor?.system?.abilities?.[abilityKey] ?? 0;

        const effectiveRank = sys.isBackground
            ? Math.floor((sys.rank ?? 0) / 2)
            : (sys.rank ?? 0);

        // Roll-under against ability score + rank, not a d20-style "DC = rank + mod + 10".
        const scores = AlternityMathService.calculateSkillScores(abilityScore, effectiveRank);

        sys.effectiveRank = effectiveRank;
        sys.scores        = scores;
        sys.targetNumber  = scores.ordinary;

        sys.rankDisplay   = sys.isBackground ? `${sys.rank} (bg)` : String(sys.rank ?? 0);
        sys.scoreDisplay  = `${scores.ordinary} / ${scores.good} / ${scores.amazing}`;
    }

    /**
     * Prepare effect display labels and derive whether costs can be met.
     * @private
     */
    _prepareEffectData() {
        const sys   = this.system;
        const actor = this.actor;

        // Derive whether the owning actor can afford the resource costs
        if (actor) {
            const tp = actor.system.techPoints?.value ?? 0;
            const pp = actor.system.psiPoints?.value  ?? 0;
            sys.canAffordTP = tp >= (sys.techPointCost ?? 0);
            sys.canAffordPP = pp >= (sys.psiPointCost  ?? 0);
            sys.canUse      = sys.canAffordTP && sys.canAffordPP;
        } else {
            sys.canAffordTP = true;
            sys.canAffordPP = true;
            sys.canUse      = true;
        }

        // Activation label
        const activationLabels = {
            free:     game.i18n.localize('ALTERNITY.Activation.Free'),
            minor:    game.i18n.localize('ALTERNITY.Activation.Minor'),
            action:   game.i18n.localize('ALTERNITY.Activation.Action'),
            reaction: game.i18n.localize('ALTERNITY.Activation.Reaction'),
            passive:  game.i18n.localize('ALTERNITY.Activation.Passive'),
        };
        sys.activationLabel = activationLabels[sys.activation] ?? sys.activation;

        // Cost display
        const costs = [];
        if (sys.techPointCost > 0) costs.push(`${sys.techPointCost} TP`);
        if (sys.psiPointCost  > 0) costs.push(`${sys.psiPointCost} PP`);
        sys.costDisplay = costs.length ? costs.join(', ') : game.i18n.localize('ALTERNITY.Free');

        // Pre-serialise each prerequisite's free-form params object so the sheet
        // can edit it as plain JSON text (ObjectField accepts a JSON string on submit).
        for (const check of sys.requiredChecks ?? []) {
            check.paramsJson = JSON.stringify(check.params ?? {});
        }
    }

    /**
     * Compute display labels for the Perk/Flaw sheet (Player's Handbook Ch. 5/6).
     * @private
     */
    _preparePerkFlawData() {
        const sys = this.system;

        sys.costLabel = sys.isFlaw
            ? `+${sys.costDisplay} SP`
            : `${sys.costDisplay} SP`;

        sys.activationLabel = sys.isPerk ? sys.activationType : '—';
    }

    /**
     * Compute display labels for the Personal Equipment sheet
     * (Player's Handbook Ch. 9 comms/medical/professional/sensor/survival gear).
     * @private
     */
    _preparePersonalEquipmentData() {
        const sys = this.system;
        sys.equippedLabel = sys.isEquipped ? game.i18n.localize('ALTERNITY.Equipped') : game.i18n.localize('ALTERNITY.Stowed');
    }

    /**
     * Compute display labels for the Cybertech sheet
     * (Player's Handbook Ch. 15 cyber gear).
     * @private
     */
    _prepareCybertechData() {
        const sys = this.system;

        // Everything else this type derives is actor-independent and lives in
        // CybertechData.prepareDerivedData(). Only the localized status label needs
        // game.i18n, which the data model has no business reaching for.
        //
        // Note there is deliberately no "tolerance cost" field here: size only counts
        // against the owner once the gear is actually in the body, and that roll-up is
        // AlternityActor.getCyberTolerance()'s job, not this item's.
        sys.statusLabel = sys.isInstalled
            ? game.i18n.localize('ALTERNITY.Cybertech.Installed')
            : game.i18n.localize('ALTERNITY.Cybertech.NotInstalled');
    }

    // -----------------------------------------------------------------------
    // Weapon: attack roll
    // -----------------------------------------------------------------------

    /**
     * Roll an attack with this weapon. Delegates to the owning actor's rollSkill()
     * using the weapon's requiredSkill id and applies the weapon's attack bonus.
     *
     * @param {object} [options]
     * @param {boolean} [options.whisper] - Whisper to GM.
     * @returns {Promise<object|null>}
     */
    async rollAttack(options = {}) {
        if (this.type !== 'weapon') {
            console.warn(`[AlternityItem] rollAttack() called on non-weapon item "${this.name}".`);
            return null;
        }
        const actor = this.actor;
        if (!actor) {
            ui.notifications?.warn('[Alternity] Weapon must be owned by an actor to roll.');
            return null;
        }

        const skillId   = this.system.requiredSkill ?? 'str-melee';
        const extraBonus = this.system.attackBonus ?? 0;

        return actor.rollSkill(skillId, {
            context:     `${this.name} Attack`,
            extraBonus,  // picked up by the hook layer
            itemId:      this.id,
            ...options,
        });
    }

    /**
     * Roll damage for this weapon.
     * Returns a Roll object and creates a chat message.
     *
     * @param {object} [options]
     * @returns {Promise<Roll>}
     */
    async rollDamage(options = {}) {
        if (this.type !== 'weapon') return null;

        const formula = this.system.fullDamageFormula ?? this.system.damageFormula ?? '1d6';
        const roll    = await new Roll(formula).evaluate();

        await roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor: this.actor }),
            flavor:  `${this.name} — ${this.system.damageType} Damage`,
            rollMode: options.whisper ? 'gmroll' : 'roll',
        });

        // Optionally apply the damage to a target (if one is selected)
        if (options.applyToTarget && game.user.targets.size > 0) {
            for (const token of game.user.targets) {
                await token.actor?.applyAlternityDamage?.(roll.total, this.system.damageType, {
                    category: this.system.damageCategory,
                    context:  `${this.name} Damage`,
                });
            }
        }

        return roll;
    }

    // -----------------------------------------------------------------------
    // Skill: roll check
    // -----------------------------------------------------------------------

    /**
     * Roll a skill check using this skill item. Delegates to the owning actor.
     *
     * @param {object} [options]
     * @returns {Promise<object|null>}
     */
    async rollSkill(options = {}) {
        if (this.type !== 'skill') {
            console.warn(`[AlternityItem] rollSkill() called on non-skill item "${this.name}".`);
            return null;
        }
        const actor = this.actor;
        if (!actor) {
            ui.notifications?.warn('[Alternity] Skill must be owned by an actor to roll.');
            return null;
        }
        return actor.rollSkill(this.system.skillId, {
            context: this.name,
            ...options,
        });
    }

    // -----------------------------------------------------------------------
    // Effect: use / validate / deduct
    // -----------------------------------------------------------------------

    /**
     * Attempt to use this effect item.
     *
     * Flow:
     *   1. Load the SystemEffectItem template from the item's flags.
     *   2. Build a state snapshot from the owning actor.
     *   3. Validate prerequisites via SystemEffectItem.validateRequirements().
     *   4. If valid: deduct resource costs and fire alternity:effectUsed hook.
     *   5. If invalid: notify the user and return null.
     *
     * @param {object} [options]
     * @param {boolean} [options.silent] - Suppress chat notification.
     * @returns {Promise<{ succeeded: boolean, failures?: string[] }|null>}
     */
    async use(options = {}) {
        if (this.type !== 'effect') {
            console.warn(`[AlternityItem] use() called on non-effect item "${this.name}".`);
            return null;
        }

        const actor = this.actor;
        if (!actor) {
            ui.notifications?.warn('[Alternity] Effect must be owned by an actor to use.');
            return null;
        }

        if (actor.isIncapacitated) {
            ui.notifications?.warn(game.i18n.localize('ALTERNITY.Errors.Incapacitated'));
            return { succeeded: false, failures: ['Character is incapacitated.'] };
        }

        // Load the hook-layer template (for validateRequirements)
        const template = getEffectTemplate(this);

        if (template) {
            const altState = await actor.getAltState?.() ?? await getAlternityState(actor);
            if (!altState) return null;

            const snapshot = {
                resources:  { ...altState.resources },
                woundLevel: altState.woundLevel,
                skills:     {}, // populated below
            };
            // Populate skills snapshot from owned skill items
            for (const skillItem of actor.items.filter(i => i.type === 'skill')) {
                snapshot.skills[skillItem.system.skillId] = skillItem.system.rank ?? 0;
            }

            const { valid, failures } = template.validateRequirements(snapshot);

            if (!valid) {
                const message = failures.join('\n');
                ui.notifications?.warn(`${this.name}: ${failures[0]}`);
                console.warn(`[AlternityItem] Prerequisites failed for "${this.name}":\n${message}`);
                return { succeeded: false, failures };
            }
        }

        // Deduct resource costs from actor.system
        const costs = {};
        if ((this.system.techPointCost ?? 0) > 0) {
            costs['system.techPoints.value'] =
                Math.max(0, (actor.system.techPoints?.value ?? 0) - this.system.techPointCost);
        }
        if ((this.system.psiPointCost ?? 0) > 0) {
            costs['system.psiPoints.value'] =
                Math.max(0, (actor.system.psiPoints?.value ?? 0) - this.system.psiPointCost);
        }
        if (Object.keys(costs).length) {
            await actor.update(costs);
        }

        // Mark single-use items as expended
        if (!this.system.isReusable) {
            const newQty = Math.max(0, (this.system.quantity ?? 1) - 1);
            await this.update({ 'system.quantity': newQty });
            if (newQty === 0) {
                console.log(`[Alternity] Single-use effect "${this.name}" expended.`);
            }
        }

        // Notify via hook so the sheet, other modules, and the chat log can respond
        Hooks.callAll('alternity:effectUsed', actor, this, {
            techPointsSpent: this.system.techPointCost ?? 0,
            psiPointsSpent:  this.system.psiPointCost  ?? 0,
        });

        // Post to chat (unless silent)
        if (!options.silent) {
            await this._createUseChatMessage();
        }

        return { succeeded: true };
    }

    /**
     * Create a chat message announcing this effect was used.
     * @private
     */
    async _createUseChatMessage() {
        const costs = [];
        if ((this.system.techPointCost ?? 0) > 0) costs.push(`${this.system.techPointCost} TP`);
        if ((this.system.psiPointCost  ?? 0) > 0) costs.push(`${this.system.psiPointCost} PP`);

        const content = `
        <div class="alt-use-card">
            <strong>${this.actor?.name ?? 'Unknown'}</strong> uses
            <em>${this.name}</em>
            ${costs.length ? `<span class="alt-use-cost">(${costs.join(', ')})</span>` : ''}
            ${this.system.description ? `<p class="alt-use-desc">${this.system.description}</p>` : ''}
        </div>`;

        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: this.actor }),
            content,
        });
    }

    // -----------------------------------------------------------------------
    // Convenience getters
    // -----------------------------------------------------------------------

    /** True if this item type supports equipping. */
    get isEquippable() {
        return ['weapon', 'armor', 'personalEquipment'].includes(this.type);
    }

    /** True if this item is currently equipped (weapons or armor only). */
    get isEquipped() {
        return this.isEquippable && (this.system.isEquipped ?? false);
    }

    /**
     * Toggle the equipped state of a weapon or armor item.
     * Enforces single-armor-at-a-time rule for armor.
     * @returns {Promise<AlternityItem>}
     */
    async toggleEquipped() {
        if (!this.isEquippable) return this;

        const newState = !this.system.isEquipped;

        // If equipping armor, unequip any other currently-equipped armor first
        if (this.type === 'armor' && newState && this.actor) {
            const otherArmor = this.actor.items.filter(
                i => i.type === 'armor' && i.id !== this.id && i.system.isEquipped
            );
            for (const other of otherArmor) {
                await other.update({ 'system.isEquipped': false });
            }
        }

        return this.update({ 'system.isEquipped': newState });
    }
}
