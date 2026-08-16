/**
 * @file MutationData.js
 * @description TypeDataModel: Schema for the 'mutation' Item type.
 *
 * Covers Player's Handbook Chapter 13 "Mutants" — the 60 advantageous
 * mutations (20 Ordinary / 20 Good / 20 Amazing) and 24 drawbacks
 * (8 Slight / 8 Moderate / 8 Extreme).
 *
 * This deliberately is NOT a reskin of `perkFlaw`, despite the surface
 * similarity (a category, a linked ability, a tiered cost). The subsystems
 * diverge on every mechanical axis:
 *
 *   - **Two currencies, not one.** A mutant hero rolls separate *mutation
 *     points* and *drawback points* budgets from their origin, and drawback
 *     points MUST be spent — every mutant carries at least one drawback.
 *     Perks and flaws share the single skill-point pool instead.
 *   - **Cost is fixed by tier**, universally: Ordinary/Slight 1, Good/Moderate
 *     2, Amazing/Extreme 4. Perks and flaws price per entry.
 *   - **Tier caps the character**, not the entry: at most 3 Ordinary, 2 Good
 *     and 1 Amazing advantageous mutations.
 *   - **Resolution differs.** A mutation resolves against its linked ability's
 *     skill if the hero has one, otherwise as an untrained check at *half* the
 *     ability score with a +4 base situation die — and many mutations then read
 *     out a full Critical Failure → Amazing result ladder, which no perk does.
 *
 * The mechanical payload shapes below are the ones Ch.13 actually reuses
 * across entries (following the same "model the shapes the book uses, not a
 * field per entry" approach as CybertechData): ability modifiers, durability
 * track bonuses, armor triples, an attack profile, a result ladder, and the
 * fatigue/duration/cooldown economy that gates the activated ones.
 *
 * Mutants are human-only (PHB Ch.1) and use the alien starting-skill row,
 * forfeiting the human skill bonus — that's an actor-level concern, not
 * modelled here.
 */

const { fields } = foundry.data;

/** Advantageous mutation, or the drawback that helps pay for it. */
export const MUTATION_CATEGORIES = Object.freeze(['Advantage', 'Drawback']);

/**
 * Power class. The two ladders are parallel and cost identically — the book
 * uses different words for advantages and drawbacks, so both are offered and
 * the sheet filters by category.
 */
export const MUTATION_TIERS = Object.freeze([
    'Ordinary', 'Good', 'Amazing',      // advantages
    'Slight', 'Moderate', 'Extreme',    // drawbacks
]);

/** Tier → point cost. Identical for advantages and drawbacks (PHB Ch.13). */
const TIER_COST = Object.freeze({
    Ordinary: 1, Slight:   1,
    Good:     2, Moderate: 2,
    Amazing:  4, Extreme:  4,
});

/** How many advantageous mutations of each tier one character may carry. */
const TIER_MAX_PER_CHARACTER = Object.freeze({
    Ordinary: 3,
    Good:     2,
    Amazing:  1,
});

/** Which ladder each tier belongs to, so the sheet can flag mismatches. */
const ADVANTAGE_TIERS = Object.freeze(['Ordinary', 'Good', 'Amazing']);

/**
 * How the mutation is brought to bear.
 *   - Passive   : always on (ability boosts, dermal armor, night vision)
 *   - Free      : switched on without spending an action (acid touch, electric aura)
 *   - Conscious : takes a full round to activate (the healing mutations, chameleon flesh)
 *   - Wild      : fires uncontrolled unless a Will feat check is made — this is
 *                 the state the Wild Mutation drawback forces onto a mutation
 *
 * The StarDrive Arms & Equipment Guide's biodamper keys specifically off
 * "consciously activated mutant powers", which is why Conscious is its own
 * value rather than being folded into Free.
 */
export const MUTATION_ACTIVATION_TYPES = Object.freeze(['Passive', 'Free', 'Conscious', 'Wild']);

/** Mutant origin (PHB Table P48 / P48A / P48B) — sets the point budgets. */
export const MUTATION_ORIGINS = Object.freeze([
    'Unspecified', 'Engineered (community)', 'Engineered (individual)',
    'Natural (community)', 'Natural (individual)',
]);

export class MutationData extends foundry.abstract.TypeDataModel {

    /** @override */
    static defineSchema() {
        return {
            // ── Classification ───────────────────────────────────────────
            category: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'Advantage',
                choices:  [...MUTATION_CATEGORIES],
            }),

            tier: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'Ordinary',
                choices:  [...MUTATION_TIERS],
            }),

            // 'Varies' covers Psionic Power, whose ability depends on which
            // psionic specialty was taken.
            linkedAbility: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'CON',
                choices:  ['STR', 'DEX', 'CON', 'INT', 'WIL', 'PER', 'Varies'],
            }),

            activationType: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'Passive',
                choices:  [...MUTATION_ACTIVATION_TYPES],
            }),

            origin: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'Unspecified',
                choices:  [...MUTATION_ORIGINS],
            }),

            // ── Availability rules ───────────────────────────────────────
            // Environment adaptation (once per environment), Susceptible to
            // Damage and Psionic Power (twice) are the repeatable ones.
            isRepeatable: new fields.BooleanField({ required: true, initial: false }),

            // Psi Sensitivity, Psionic Power and Psi Resistance are only legal
            // when the psionics rules are in play.
            requiresPsionics: new fields.BooleanField({ required: true, initial: false }),

            // Free text — the book's prerequisites are enumerated but prose-y
            // ("insinuative delivery requires the Natural Attack mutation").
            prerequisites:   new fields.StringField({ required: false, initial: '' }),
            incompatibleWith: new fields.StringField({ required: false, initial: '' }),

            // ── Mechanical payload ───────────────────────────────────────
            // Permanent boosts (Improved/Enhanced/Hyper X, +1/+2/+3) and the
            // permanent penalties that ride along with some Amazing mutations
            // (Dermal Plating -1 DEX; Flight -1 STR/-2 CON/+1 DEX). Temporary,
            // conditional shifts (gravity adaptation) are described in prose
            // instead — `isPermanent` marks which kind this is.
            abilityModifier: new fields.SchemaField({
                ability: new fields.StringField({
                    required: true,
                    nullable: false,
                    initial:  'None',
                    choices:  ['STR', 'DEX', 'CON', 'INT', 'WIL', 'PER', 'None'],
                }),
                value:       new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0 }),
                isPermanent: new fields.BooleanField({ required: true, initial: true }),
            }, { initial: { ability: 'None', value: 0, isPermanent: true } }),

            // Improved/Enhanced/Hyper Durability each hit a *different* track
            // (+3 stun / +3 wound / +3 mortal respectively).
            durabilityBonus: new fields.SchemaField({
                stun:    new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0 }),
                wound:   new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0 }),
                mortal:  new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0 }),
                fatigue: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0 }),
            }, { initial: { stun: 0, wound: 0, mortal: 0, fatigue: 0 } }),

            // Dermal reinforcement / dermal armor / dermal plating. Free text
            // die ranges, matching the character sheet's own armor ratings.
            // These layer with worn armor — take whichever roll is better.
            armorProtection: new fields.SchemaField({
                li: new fields.StringField({ required: false, initial: '' }),
                hi: new fields.StringField({ required: false, initial: '' }),
                en: new fields.StringField({ required: false, initial: '' }),
            }, { initial: { li: '', hi: '', en: '' } }),

            // Improved/Enhanced/Hyper Reflexes (-1/-2/-3) and the Slow Reflexes
            // drawback (+1). Negative is a bonus.
            actionCheckModifier: new fields.NumberField({
                required: true, nullable: false, integer: true, initial: 0,
            }),

            // Recurring bundles: "Athletics, Melee Weapons, Unarmed Attack,
            // Acrobatics, Movement" or "Awareness-perception, Investigate".
            // Stored as prose plus one step value, which is how they're printed.
            skillModifier: new fields.SchemaField({
                skills: new fields.StringField({ required: false, initial: '' }),
                value:  new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0 }),
            }, { initial: { skills: '', value: 0 } }),

            // ── Attack profile (natural attack, acid touch, electric aura) ─
            attack: new fields.SchemaField({
                skill:        new fields.StringField({ required: false, initial: '' }),
                attackBonus:  new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0 }),
                damage: new fields.SchemaField({
                    ordinary: new fields.StringField({ required: false, initial: '' }),
                    good:     new fields.StringField({ required: false, initial: '' }),
                    amazing:  new fields.StringField({ required: false, initial: '' }),
                }, { initial: { ordinary: '', good: '', amazing: '' } }),
                damageType: new fields.StringField({
                    required: true,
                    nullable: false,
                    initial:  'None',
                    choices:  ['None', 'LI', 'HI', 'En'],
                }),
                // The retractable variant of a natural attack trades 2 points of
                // damage for concealability.
                isRetractable: new fields.BooleanField({ required: true, initial: false }),
            }, {
                initial: {
                    skill: '', attackBonus: 0,
                    damage: { ordinary: '', good: '', amazing: '' },
                    damageType: 'None', isRetractable: false,
                },
            }),

            // ── Result ladder ────────────────────────────────────────────
            // Acid touch, electric aura, every tier of the healing mutations,
            // the poisons and deadly immunity all read out per-degree effects.
            // Has no analogue in perkFlaw.
            outcomes: new fields.SchemaField({
                criticalFailure: new fields.StringField({ required: false, initial: '' }),
                marginal:        new fields.StringField({ required: false, initial: '' }),
                ordinary:        new fields.StringField({ required: false, initial: '' }),
                good:            new fields.StringField({ required: false, initial: '' }),
                amazing:         new fields.StringField({ required: false, initial: '' }),
            }, { initial: { criticalFailure: '', marginal: '', ordinary: '', good: '', amazing: '' } }),

            // ── Use economy ──────────────────────────────────────────────
            // All free text / small integers, exactly as printed: "d4+1 rounds",
            // "2d4+2" fatigue, "3d8 hours" cooldown.
            duration:    new fields.StringField({ required: false, initial: '' }),
            fatigueCost: new fields.StringField({ required: false, initial: '' }),
            cooldown:    new fields.StringField({ required: false, initial: '' }),
            // 0 = no printed limit.
            usesPerDay: new fields.NumberField({
                required: true, nullable: false, integer: true, initial: 0, min: 0,
            }),

            // ── Granted skill (Psionic Power only) ───────────────────────
            // One psionic specialty at a rank that can never be improved.
            grantedSkill: new fields.SchemaField({
                skill: new fields.StringField({ required: false, initial: '' }),
                rank:  new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
            }, { initial: { skill: '', rank: 0 } }),

            // ── Flavour / rules text ─────────────────────────────────────
            description: new fields.HTMLField({ required: false, initial: '' }),
        };
    }

    /** @override */
    prepareDerivedData() {
        // ── Category / tier ──────────────────────────────────────────────
        this.isAdvantage = this.category === 'Advantage';
        this.isDrawback  = this.category === 'Drawback';

        // Cost is never stored — it is wholly determined by tier.
        this.cost = TIER_COST[this.tier] ?? 0;
        // Advantages spend mutation points; drawbacks *grant* drawback points
        // that must themselves be spent. Two separate pools, so the label
        // matters as much as the number.
        this.pointPool     = this.isAdvantage ? 'Mutation Points' : 'Drawback Points';
        this.costDisplay   = `${this.cost} ${this.isAdvantage ? 'MP' : 'DP'}`;
        this.tierCostLabel = `${this.tier} (${this.cost})`;

        // The two tier ladders are parallel but not interchangeable — an
        // advantage rated "Extreme" is a data-entry error, and silently
        // costing it as Amazing would hide that.
        const tierIsAdvantageLadder = ADVANTAGE_TIERS.includes(this.tier);
        this.hasTierMismatch = this.isAdvantage !== tierIsAdvantageLadder;

        this.maxPerCharacter = this.isAdvantage
            ? (TIER_MAX_PER_CHARACTER[this.tier] ?? 0)
            : 0;

        // ── Activation ───────────────────────────────────────────────────
        this.isPassive   = this.activationType === 'Passive';
        this.isActivated = !this.isPassive;
        // The biodamper (+3 step penalty) bites only on consciously activated powers.
        this.isConsciouslyActivated = this.activationType === 'Conscious';
        this.isWild = this.activationType === 'Wild';

        // ── Payload summaries ────────────────────────────────────────────
        this.hasAbilityModifier = this.abilityModifier.ability !== 'None' && this.abilityModifier.value !== 0;
        this.abilityModifierDisplay = this.hasAbilityModifier
            ? `${this.abilityModifier.value > 0 ? '+' : ''}${this.abilityModifier.value} ${this.abilityModifier.ability}`
                + (this.abilityModifier.isPermanent ? '' : ' (temporary)')
            : '—';

        const durabilityParts = [];
        const durLabels = { stun: 'stun', wound: 'wound', mortal: 'mortal', fatigue: 'fatigue' };
        for (const [key, label] of Object.entries(durLabels)) {
            const v = this.durabilityBonus[key];
            if (v) durabilityParts.push(`${v > 0 ? '+' : ''}${v} ${label}`);
        }
        this.hasDurabilityBonus = durabilityParts.length > 0;
        this.durabilityDisplay  = durabilityParts.length ? durabilityParts.join(', ') : '—';

        const armorParts = [];
        if (this.armorProtection.li) armorParts.push(`LI ${this.armorProtection.li}`);
        if (this.armorProtection.hi) armorParts.push(`HI ${this.armorProtection.hi}`);
        if (this.armorProtection.en) armorParts.push(`En ${this.armorProtection.en}`);
        this.hasArmorProtection = armorParts.length > 0;
        this.armorDisplay       = armorParts.length ? armorParts.join(' / ') : '—';

        this.hasActionCheckModifier = this.actionCheckModifier !== 0;
        this.actionCheckDisplay = this.hasActionCheckModifier
            ? `${this.actionCheckModifier > 0 ? '+' : ''}${this.actionCheckModifier} step${Math.abs(this.actionCheckModifier) === 1 ? '' : 's'}`
            : '—';

        this.hasSkillModifier = !!this.skillModifier.skills && this.skillModifier.value !== 0;
        this.skillModifierDisplay = this.hasSkillModifier
            ? `${this.skillModifier.value > 0 ? '+' : ''}${this.skillModifier.value} to ${this.skillModifier.skills}`
            : '—';

        // ── Attack ───────────────────────────────────────────────────────
        const dmg = this.attack.damage;
        this.hasAttack = !!(dmg.ordinary || dmg.good || dmg.amazing);
        this.attackDamageDisplay = this.hasAttack
            ? [dmg.ordinary, dmg.good, dmg.amazing].map(d => d || '—').join(' / ')
                + (this.attack.damageType !== 'None' ? ` ${this.attack.damageType}` : '')
            : '—';

        // ── Result ladder ────────────────────────────────────────────────
        this.hasOutcomes = !!(
            this.outcomes.criticalFailure || this.outcomes.marginal ||
            this.outcomes.ordinary || this.outcomes.good || this.outcomes.amazing
        );

        // ── Use economy ──────────────────────────────────────────────────
        this.isLimitedUse  = this.usesPerDay > 0;
        this.hasUseCost    = !!(this.duration || this.fatigueCost || this.cooldown || this.isLimitedUse);
        const costParts = [];
        if (this.duration)    costParts.push(`lasts ${this.duration}`);
        if (this.fatigueCost) costParts.push(`${this.fatigueCost} fatigue`);
        if (this.cooldown)    costParts.push(`${this.cooldown} cooldown`);
        if (this.isLimitedUse) costParts.push(`${this.usesPerDay}/day`);
        this.useCostDisplay = costParts.length ? costParts.join(', ') : '—';

        // ── Granted skill ────────────────────────────────────────────────
        this.hasGrantedSkill = !!this.grantedSkill.skill;
        this.grantedSkillDisplay = this.hasGrantedSkill
            ? `${this.grantedSkill.skill} rank ${this.grantedSkill.rank}`
            : '—';

        // ── Prerequisites ────────────────────────────────────────────────
        this.hasRestrictions = !!(this.prerequisites || this.incompatibleWith || this.requiresPsionics);
    }
}
