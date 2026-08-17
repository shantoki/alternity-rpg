/**
 * @file AlternityItem.js
 * @description Step 8 — Document Class: AlternityItem extends Foundry's native Item.
 *
 * Registered to CONFIG.Item.documentClass in src/index.js. Covers all item
 * types: weapon, armor, skill, effect.
 *
 * Responsibilities:
 *   - prepareData() pipeline for each item type
 *   - rollAttack() / rollDamage() for weapon items — routed through
 *     AlternityRollService, which owns the dice and the chat cards
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
import { AlternityRollService }                   from '../services/alternity-roll-service.js';

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
            case 'program':   return this._prepareProgramData();
            case 'fx':        return this._prepareFXData();
            case 'mutation':  return this._prepareMutationData();
            case 'achievementBenefit': return this._prepareAchievementBenefitData();
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

        // The flat term added to whichever damage code the attack's degree
        // selects. Kept as a formula fragment rather than folded into the codes:
        // there are three of them, and each carries its own grade letter that
        // would have to be stripped and reattached to splice a number in.
        const damageMod = (sys.damageBonus ?? 0) + sys.strengthDamageAdjustment;
        sys.damageBonusFormula = damageMod === 0 ? ''
            : damageMod > 0 ? `+${damageMod}`
            : String(damageMod);
        sys.damageBonusLabel = sys.damageBonusFormula || '—';

        // A negative Strength damage adjustment never takes a hit below one point
        // (Table P9's "* To a minimum of 1" footnote).
        sys.damageMinimumOne = sys.strengthDamageAdjustment < 0;

        // Range display (ranged/thrown only). Metres, not feet: the weapon tables
        // print "short/medium/long in meters" (PHB Ch.11).
        const r = sys.range;
        sys.rangeDisplay = (r?.long ?? 0) > 0
            ? `${r.short}/${r.medium}/${r.long} m`
            : '—';

        // The band choices the roll panel offers, each already carrying its Table
        // P22 step modifier and the distance it covers, so the wielder picks
        // "medium (21-80 m)" rather than remembering a number.
        sys.rangeBands = sys.usesRangeBands
            ? ['short', 'medium', 'long'].map((band) => ({
                band,
                steps: AlternityMathService.getRangeStepModifier(sys.rangeClass, band).steps,
                distance: r?.[band] ?? 0,
            })).filter((b) => b.distance > 0)
            : [];

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

        // The protection labels, the toughness flag and the two penalty labels are
        // all derived by ArmorData.prepareDerivedData, which runs first and has the
        // parsed die ranges to hand. Only the item-level ones are added here.
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

    /**
     * Compute display labels for the Program sheet
     * (Player's Handbook Ch.10; Dataware).
     * @private
     */
    _prepareProgramData() {
        const sys = this.system;

        // Everything mechanical is actor-independent and already derived in
        // ProgramData.prepareDerivedData(); only the localized status label needs
        // game.i18n, which the data model has no business reaching for.
        //
        // Note there is no "slots consumed by this actor" roll-up here: whether a
        // program fits is a property of the computer it is loaded into, not of the
        // program, and that belongs to AlternityActor.getActiveMemory().
        sys.statusLabel = sys.isLoaded
            ? game.i18n.localize('ALTERNITY.Program.Loaded')
            : game.i18n.localize('ALTERNITY.Program.Stored');
    }

    /**
     * Resolve an FX power's roll-under scores from the owning actor's ability
     * score and the power's rank (Mindwalking; Gamemaster Guide Ch.16).
     *
     * A power is a skill, so this is the ordinary skill-score calculation: a
     * specialty adds its rank to the linked ability, a broad skill does not.
     * @private
     */
    _prepareFXData() {
        const sys        = this.system;
        const actor      = this.actor;
        const abilityKey = sys.linkedAbility?.toLowerCase();
        const abilityScore = actor?.system?.abilities?.[abilityKey] ?? 0;

        // Broad skills roll against the bare ability; specialties add their rank.
        const effectiveRank = sys.isBroadSkill ? 0 : (sys.rank ?? 0);
        const scores = AlternityMathService.calculateSkillScores(abilityScore, effectiveRank);

        sys.scores       = scores;
        sys.scoreDisplay = `${scores.ordinary} / ${scores.good} / ${scores.amazing}`;

        // A power with no ranks that can't be used untrained is simply unusable —
        // the sheet greys the roll button off this rather than off rank alone,
        // since a broad skill legitimately sits at rank 0.
        sys.isUsable = !(sys.cannotBeUsedUntrained && (sys.rank ?? 0) === 0);

        // Whether the owner can currently pay for it. Psionic and FX energy are
        // tracked in the same pool on the actor.
        const energy = actor?.system?.psiPoints?.value ?? 0;
        sys.canAffordEnergy = !actor || energy >= (sys.energyCost ?? 0);
    }

    /**
     * Resolve a mutation's check scores from the owning actor
     * (Player's Handbook Ch.13 "Mutants").
     *
     * A mutation resolves against its linked ability's skill if the hero has
     * one; failing that it is an untrained check at half the ability score.
     * Only the untrained fallback is derived here — if the hero does have the
     * relevant skill, the sheet rolls that skill from the main skill tree
     * instead, and this item has no say in it.
     * @private
     */
    _prepareMutationData() {
        const sys        = this.system;
        const actor      = this.actor;
        // 'Varies' has no single ability to read (Psionic Power), so there is
        // nothing to derive and the sheet falls back to a manual roll.
        const abilityKey = sys.linkedAbility === 'Varies' ? null : sys.linkedAbility?.toLowerCase();
        const abilityScore = abilityKey ? (actor?.system?.abilities?.[abilityKey] ?? 0) : 0;

        const scores = AlternityMathService.calculateSkillScores(abilityScore, 0, { untrained: true });

        sys.untrainedScores = scores;
        sys.scoreDisplay    = abilityKey
            ? `${scores.ordinary} / ${scores.good} / ${scores.amazing}`
            : '—';

        // The untrained fallback carries a +4 base situation die, not the usual
        // +1 of a feat check — this is the single largest penalty in the system
        // and the reason a mutant wants the matching skill.
        sys.untrainedBaseStep = 4;

        sys.tierLabel = game.i18n.localize(
            sys.isAdvantage ? 'ALTERNITY.Mutation.Advantage' : 'ALTERNITY.Mutation.Drawback'
        );
    }

    /**
     * Compute display labels for the Achievement Benefit sheet
     * (Player's Handbook Ch.8, Table P29).
     * @private
     */
    _prepareAchievementBenefitData() {
        const sys = this.system;

        sys.statusLabel = sys.isMaxed
            ? game.i18n.localize('ALTERNITY.AchievementBenefit.Maxed')
            : sys.isPurchased
                ? game.i18n.localize('ALTERNITY.AchievementBenefit.Purchased')
                : game.i18n.localize('ALTERNITY.AchievementBenefit.Available');
    }

    // -----------------------------------------------------------------------
    // Weapon: attack roll
    // -----------------------------------------------------------------------

    /**
     * The damage payload this weapon hands to a check, so the resulting chat card
     * can offer the right grade's damage once the degree is known.
     *
     * Shaped for AlternityRollService.rollCheck's `damage` option. Built here
     * rather than in the sheet because everything in it belongs to the weapon.
     *
     * @returns {object|null} Null for non-weapons.
     */
    getDamagePayload() {
        if (this.type !== 'weapon') return null;
        const sys = this.system;
        return {
            name: this.name,
            codes: sys.damageRun ?? {},
            damageType: sys.damageType,
            firepower: sys.firepower,
            bonus: sys.damageBonusFormula || '',
            fallbackCategory: sys.damageCategory,
            minimumOne: !!sys.damageMinimumOne,
            actorUuid: this.actor?.uuid ?? null,
            itemId: this.id,
        };
    }

    /**
     * Roll an attack with this weapon.
     *
     * The check is a roll-under on the weapon's governing specialty — not a d20
     * plus bonuses — and the weapon's accuracy, the chosen range band, and the
     * target's resistance and dodge all enter it as situation-die steps. The
     * damage is not rolled here: the degree this check achieves decides which of
     * the three damage codes fires, so the resulting card offers that button.
     *
     * @param {object}  [options]
     * @param {string}  [options.rangeBand]  - 'short' | 'medium' | 'long' (Table P22).
     * @param {number}  [options.situationStep=0] - The Gamemaster's circumstance modifier.
     * @param {boolean} [options.whisper]
     * @returns {Promise<object|null>}
     */
    async rollAttack(options = {}) {
        if (this.type !== 'weapon') {
            console.warn(`[AlternityItem] rollAttack() called on non-weapon item "${this.name}".`);
            return null;
        }
        const actor = this.actor;
        if (!actor) {
            ui.notifications?.warn(game.i18n.localize('ALTERNITY.Errors.WeaponUnowned'));
            return null;
        }

        const sys = this.system;
        const skillId = sys.requiredSkill
            || (sys.weaponType === 'Melee' ? 'str-melee' : 'dex-ranged-mod');
        const isMelee = ['Melee', 'Thrown'].includes(sys.weaponType);

        const modifiers = [];

        // The weapon's own accuracy (the table's "Acc" column).
        if (sys.attackBonus) {
            modifiers.push(AlternityMathService.buildModifier(
                game.i18n.localize('ALTERNITY.Weapon.Accuracy'),
                sys.attackBonus,
                `${this.name} accuracy`,
            ));
        }

        // Range band, when one was picked and the weapon's class is rated for bands.
        if (options.rangeBand) {
            modifiers.push(...AlternityMathService
                .getRangeStepModifier(sys.rangeClass, options.rangeBand).modifierTrace);
        }

        if (options.situationStep) {
            modifiers.push(AlternityMathService.buildModifier(
                game.i18n.localize('ALTERNITY.Roll.Circumstance'),
                options.situationStep,
                game.i18n.localize('ALTERNITY.Roll.CircumstanceReason'),
            ));
        }

        // Whoever is targeted contributes their resistance modifier and any dodge
        // they rolled — Alternity's substitute for an armour class.
        const { modifiers: targetModifiers, toughness } = await AlternityRollService.collectTargetModifiers({
            attackKind: isMelee ? 'melee' : 'ranged',
        });
        modifiers.push(...targetModifiers);

        const state = await actor.getAltState?.();
        const scores = state?.getSkillScores(skillId)
            ?? AlternityMathService.calculateSkillScores(actor.system?.abilities?.[sys.attackAbility] ?? 0);
        const baseStep = state?.getSkillBaseStep(skillId) ?? 1;

        return AlternityRollService.rollCheck({
            actor,
            name: this.name,
            context: isMelee
                ? game.i18n.localize('ALTERNITY.Roll.MeleeAttack')
                : game.i18n.localize('ALTERNITY.Roll.RangedAttack'),
            scores,
            baseStep,
            modifiers,
            whisper: options.whisper ?? false,
            // The target's toughness travels with the damage payload so the card can
            // report a firepower shortfall; null when nothing is targeted, because the
            // degrade rule needs both halves and will not guess at one.
            damage: { ...this.getDamagePayload(), targetToughness: toughness ?? null },
        });
    }

    /**
     * Roll one damage grade for this weapon and post it with an apply button.
     *
     * Normally reached from the attack card, which knows which grade the check
     * earned. Called directly it needs to be told, because rolling the Amazing
     * column off an Ordinary hit is exactly the mistake this signature prevents.
     *
     * @param {object} [options]
     * @param {string} [options.grade='ordinary'] - 'ordinary' | 'good' | 'amazing'.
     * @param {boolean} [options.whisper]
     * @returns {Promise<object|null>}
     */
    async rollDamage(options = {}) {
        if (this.type !== 'weapon') return null;

        const grade = options.grade ?? 'ordinary';
        const payload = this.getDamagePayload();
        const code = payload.codes[grade];

        if (!code) {
            ui.notifications?.warn(game.i18n.format('ALTERNITY.Roll.NoDamageCode', {
                name: this.name, grade,
            }));
            return null;
        }

        return AlternityRollService.rollDamage({
            actor: this.actor,
            name: this.name,
            code,
            grade,
            damageType: payload.damageType,
            firepower: payload.firepower,
            bonus: payload.bonus,
            fallbackCategory: payload.fallbackCategory,
            minimumOne: payload.minimumOne,
            whisper: options.whisper ?? false,
        });
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

            // `resources` is what SystemEffectItem's `resource` prerequisite reads
            // (see alternity-item-template.js). It used to spread
            // `altState.resources`, a property AlternityCharacterState has never
            // had, so the snapshot was always empty and every resource
            // prerequisite silently saw 0 and failed.
            //
            // Remaining points are reported, not damage taken: a prerequisite asks
            // "does this character have N left?", and the durability tracks count
            // upward as damage accumulates.
            const dur = altState.durability ?? {};
            const remaining = (v, max) => Math.max(0, (max ?? 0) - (v ?? 0));
            const snapshot = {
                resources: {
                    stun:       remaining(dur.stun,    dur.stunMax),
                    wound:      remaining(dur.wound,   dur.woundMax),
                    mortal:     remaining(dur.mortal,  dur.mortalMax),
                    fatigue:    remaining(dur.fatigue, dur.fatigueMax),
                    psionicEnergy: altState.psionics?.energy?.value ?? 0,
                    lastResort:    altState.lastResort?.value ?? 0,
                    techPoints:    actor.system?.techPoints?.value ?? 0,
                },
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
