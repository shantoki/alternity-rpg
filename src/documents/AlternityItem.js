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

        // Resolve ability modifier from the owning actor (if equipped)
        const abilityKey = sys.attackAbility ?? 'str';
        const abilityMod = actor?.system?.abilities?.[abilityKey] ?? 0;

        // Derived attack bonus display (attackBonus + ability modifier)
        sys.totalAttackBonus = (sys.attackBonus ?? 0) + abilityMod;
        sys.abilityModLabel  = abilityMod >= 0 ? `+${abilityMod}` : String(abilityMod);

        // Full damage formula including ability modifier
        const damageMod = abilityMod + (sys.damageBonus ?? 0);
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
        const sys      = this.system;
        const actor    = this.actor;
        const abilityKey = sys.linkedAbility?.toLowerCase();
        const abilityMod = actor?.system?.abilities?.[abilityKey] ?? 0;

        const effectiveRank = sys.isBackground
            ? Math.floor((sys.rank ?? 0) / 2)
            : (sys.rank ?? 0);

        sys.effectiveRank = effectiveRank;
        sys.targetNumber  = effectiveRank + abilityMod + 10;

        sys.rankDisplay   = sys.isBackground ? `${sys.rank} (bg)` : String(sys.rank ?? 0);
        sys.dcDisplay     = `DC ${sys.targetNumber}`;
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
        return ['weapon', 'armor'].includes(this.type);
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
