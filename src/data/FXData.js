/**
 * @file FXData.js
 * @description TypeDataModel: Schema for the 'fx' Item type — a single FX power.
 *
 * "FX" is used here as the umbrella for both of the book's parallel
 * skill-driven power subsystems, because they share one mechanical spine and
 * differ only in flavour and a few knobs:
 *
 *   - **Psionics** (Mindwalking; Player's Handbook Ch.14) — five broad skills
 *     (Biokinesis/CON, ESP/INT, Psychoportation/WIL, Telekinesis/WIL,
 *     Telepathy/PER), each with named specialty powers. Fuelled by *psionic
 *     energy points*.
 *   - **FX proper** (Gamemaster Guide Ch.16) — three broad skills (Arcane
 *     Magic, Faith, Super Power), each with categories rather than a fixed
 *     power list. Fuelled by *FX energy points*.
 *
 * NOTE on terminology: the books never call a psionic power an "FX" — FX is
 * strictly the GMG Ch.16 system. The two are merged under this one item type
 * deliberately, since a Foundry item that models "a power you buy ranks in,
 * roll a skill check for, spend energy on, and that reads out Ordinary/Good/
 * Amazing results" describes both exactly. `tradition` is the discriminator.
 *
 * What a power is *not*: it has no difficulty rating and no per-power base
 * step. A power IS a skill — the check rolls under (governing ability score +
 * ranks), with the base situation die coming from broad (+d4) vs specialty
 * (+d0) alone. Everything else here is descriptive text the book prints in
 * prose, plus the handful of genuinely mechanical knobs.
 *
 * Energy cost is likewise NOT per-power. It is a flat global table
 * (PHB Ch.14; Mindwalking p.11): 1 point for a specialty use, 2 for a broad
 * skill use, 3 on a Critical Failure — success or failure alike. Only a few
 * powers override it (Sensitivity costs 2 to activate; forced Precognition
 * costs 2/4/6), which is what `energyCostOverride` is for.
 */

const { fields } = foundry.data;

/** The two subsystems this item type spans. */
export const FX_TRADITIONS = Object.freeze(['Psionic', 'Arcane Magic', 'Faith', 'Super Power']);

/**
 * Broad skills, grouped by tradition. Psionic powers are specialties *of* one
 * of the five psionic broad skills; the three FX traditions are themselves the
 * broad skill, so their `broadSkill` simply repeats the tradition name.
 */
export const FX_BROAD_SKILLS = Object.freeze([
    // Psionic (Mindwalking Ch.1-2)
    'Biokinesis',
    'Extrasensory Perception',
    'Psychoportation',
    'Telekinesis',
    'Telepathy',
    // FX (Gamemaster Guide Ch.16)
    'Arcane Magic',
    'Faith',
    'Super Power',
]);

/**
 * The governing ability of each broad skill, so the sheet can default it
 * rather than making every power re-enter it by hand. Faith is always Will
 * (GMG Ch.16); the other two FX broad skills vary per power, so they are
 * left out and fall back to whatever the item already has.
 */
export const FX_BROAD_SKILL_ABILITIES = Object.freeze({
    'Biokinesis':              'CON',
    'Extrasensory Perception': 'INT',
    'Psychoportation':         'WIL',
    'Telekinesis':             'WIL',
    'Telepathy':               'PER',
    'Faith':                   'WIL',
});

/**
 * Categories for the FX broad skills (GMG Ch.16). Psionic powers have no
 * equivalent — the specialty name *is* the power — so this stays empty for them.
 */
export const FX_CATEGORIES = Object.freeze([
    // Arcane Magic
    'Augur', 'Conjure', 'Summon', 'Transform',
    // Faith — the quality tier is itself the specialty
    'Ordinary Miracles', 'Good Miracles', 'Amazing Miracles',
    // Super Power
    'Enchanted Relic', 'Extreme Ability', 'Overscience Gadget',
]);

/** Quality tiers, derived from base cost for FX powers (GMG Ch.16). */
export const FX_QUALITIES = Object.freeze(['Ordinary', 'Good', 'Amazing']);

/**
 * Mental combat classification (Mindwalking Ch.6). Only meaningful for
 * psionic powers used against another mind; drives which defense points a
 * target's psychic armor / mind shield can spend against it.
 */
export const FX_MENTAL_COMBAT_CLASSES = Object.freeze(['None', 'Assault', 'Subversion', 'Trap', 'Defense']);

/**
 * Which resistance modifier a target applies as a penalty to the power's
 * check. Psionics almost always uses Will; direct-attack FX uses Strength or
 * Dexterity (GMG Ch.16).
 */
export const FX_RESISTANCES = Object.freeze(['None', 'Will', 'Dexterity', 'Strength', 'Constitution']);

/** Damage types a power can inflict, matching the armor rating columns. */
export const FX_DAMAGE_TYPES = Object.freeze(['None', 'LI', 'HI', 'En']);

export class FXData extends foundry.abstract.TypeDataModel {

    /** @override */
    static defineSchema() {
        return {
            // ── Classification ───────────────────────────────────────────
            tradition: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'Psionic',
                choices:  [...FX_TRADITIONS],
            }),

            broadSkill: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'Telepathy',
                choices:  [...FX_BROAD_SKILLS],
            }),

            // GMG Ch.16 only; blank for psionic powers.
            category: new fields.StringField({
                required: false,
                nullable: false,
                initial:  '',
                blank:    true,
            }),

            linkedAbility: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'WIL',
                choices:  ['STR', 'DEX', 'CON', 'INT', 'WIL', 'PER'],
            }),

            // A broad-skill use rolls +d4 and costs 2 energy; a specialty rolls
            // +d0 and costs 1. Nearly every catalogued power is a specialty.
            isBroadSkill: new fields.BooleanField({
                required: true,
                initial:  false,
            }),

            // Printed in italics in the skill tables and as an explicit line in
            // the power text. True for the overwhelming majority of psionic powers.
            cannotBeUsedUntrained: new fields.BooleanField({
                required: true,
                initial:  true,
            }),

            // ── Rank ─────────────────────────────────────────────────────
            // The owner's rank in this power. Rank benefits unlock off it, and
            // it feeds the roll-under score together with the linked ability.
            rank: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  0,
                min:      0,
                max:      12,
            }),

            // ── Cost / quality (GMG Ch.16 FX powers) ─────────────────────
            // Base cost in skill points caps at 15; quality is derived from it
            // (<=5 Ordinary, 6-10 Good, 11-15 Amazing) rather than stored, so the
            // two can never disagree.
            baseCost: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  0,
                min:      0,
                max:      15,
            }),

            // ── Energy ───────────────────────────────────────────────────
            // 0 means "use the standard flat cost" (2 broad / 1 specialty).
            // Only the handful of powers that print their own cost set this.
            energyCostOverride: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  0,
                min:      0,
            }),

            // Free text: "1 point per round", "2 to activate, 1 per minute after".
            maintenanceCost: new fields.StringField({
                required: false,
                initial:  '',
            }),

            // Mindwalking Ch.3 "Extended Duration": the effect runs the rest of
            // the current round plus all of the next automatically, then costs
            // 1 point per round to sustain.
            hasExtendedDuration: new fields.BooleanField({
                required: true,
                initial:  false,
            }),

            // ── Targeting ────────────────────────────────────────────────
            // Line of sight required; an Awareness-perception check is needed if
            // the target is not clearly visible (Mindwalking Ch.3).
            requiresVisualRange: new fields.BooleanField({
                required: true,
                initial:  false,
            }),

            // Metres, as printed: "range 6/12/24". Medium and long carry the
            // usual +1 / +2 step penalties.
            range: new fields.SchemaField({
                short:  new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
                medium: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
                long:   new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
            }, { initial: { short: 0, medium: 0, long: 0 } }),

            // Free text — the book describes these in prose, not numbers
            // ("all materials within a 2 meter diameter").
            area: new fields.StringField({ required: false, initial: '' }),

            target: new fields.StringField({ required: false, initial: '' }),

            duration: new fields.StringField({ required: false, initial: '' }),

            resistance: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'None',
                choices:  [...FX_RESISTANCES],
            }),

            // ── Damage ───────────────────────────────────────────────────
            // Printed as an Ordinary/Good/Amazing triple with s/w/m suffixes,
            // e.g. "d4s / d4+2s / d4w". Kept as free text for the same reason
            // the armor ratings are: these are die expressions, not numbers.
            damage: new fields.SchemaField({
                ordinary: new fields.StringField({ required: false, initial: '' }),
                good:     new fields.StringField({ required: false, initial: '' }),
                amazing:  new fields.StringField({ required: false, initial: '' }),
            }, { initial: { ordinary: '', good: '', amazing: '' } }),

            damageType: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'None',
                choices:  [...FX_DAMAGE_TYPES],
            }),

            // ── Outcome tiers ────────────────────────────────────────────
            // Every catalogued power spells out what each degree of success
            // does — this is the single most important text on the card.
            outcomes: new fields.SchemaField({
                ordinary: new fields.StringField({ required: false, initial: '' }),
                good:     new fields.StringField({ required: false, initial: '' }),
                amazing:  new fields.StringField({ required: false, initial: '' }),
            }, { initial: { ordinary: '', good: '', amazing: '' } }),

            // Several powers print an explicit disaster case (Teleportation's
            // catastrophic rematerialization, Precognition handing the enemy a
            // last resort point).
            criticalFailure: new fields.StringField({ required: false, initial: '' }),

            // ── Mental combat (Mindwalking Ch.6) ─────────────────────────
            mentalCombatClass: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'None',
                choices:  [...FX_MENTAL_COMBAT_CLASSES],
            }),

            // ── Rank benefits ────────────────────────────────────────────
            // "At rank 5, damage becomes …". These cannot be pre-purchased —
            // they unlock automatically as rank rises, which is why the sheet
            // derives locked/unlocked from `rank` rather than storing a flag.
            rankBenefits: new fields.ArrayField(
                new fields.SchemaField({
                    rank:        new fields.NumberField({ required: true, nullable: false, integer: true, initial: 3, min: 0, max: 12 }),
                    name:        new fields.StringField({ required: false, initial: '' }),
                    description: new fields.StringField({ required: false, initial: '' }),
                }),
                { required: false, initial: [] }
            ),

            // ── FX trappings (GMG Ch.16) ─────────────────────────────────
            // Descriptive requirements that also buy the cost down: a component
            // or focus is -1 skill point each, complexity -2.
            trappings: new fields.SchemaField({
                ritual:     new fields.BooleanField({ required: true, initial: false }),
                word:       new fields.BooleanField({ required: true, initial: false }),
                will:       new fields.BooleanField({ required: true, initial: false }),
                component:  new fields.BooleanField({ required: true, initial: false }),
                focus:      new fields.BooleanField({ required: true, initial: false }),
                complexity: new fields.BooleanField({ required: true, initial: false }),
            }, { initial: { ritual: false, word: false, will: false, component: false, focus: false, complexity: false } }),

            limitations: new fields.StringField({ required: false, initial: '' }),

            // ── Flavour / rules text ─────────────────────────────────────
            description: new fields.HTMLField({ required: false, initial: '' }),
        };
    }

    /** @override */
    prepareDerivedData() {
        // ── Tradition ────────────────────────────────────────────────────
        this.isPsionic = this.tradition === 'Psionic';
        this.energyLabel = this.isPsionic ? 'Psionic Energy' : 'FX Energy';

        // ── Skill shape ──────────────────────────────────────────────────
        // Broad skills roll +d4, specialties +d0 (Mindwalking Ch.2; GMG Ch.16
        // gives FX specialties +d0 as well). This is the item's contribution to
        // the roll — the actual step total is assembled by AlternityMathService.
        this.baseStep      = this.isBroadSkill ? 1 : 0;
        this.baseStepLabel = this.isBroadSkill ? '+d4' : '+d0';
        this.skillTypeLabel = this.isBroadSkill ? 'Broad' : 'Specialty';

        // ── Energy cost ──────────────────────────────────────────────────
        // The flat table, unless the power prints its own.
        this.standardEnergyCost = this.isBroadSkill ? 2 : 1;
        this.energyCost = this.energyCostOverride > 0
            ? this.energyCostOverride
            : this.standardEnergyCost;
        this.hasEnergyOverride = this.energyCostOverride > 0;
        this.energyCostDisplay = `${this.energyCost} pt${this.energyCost === 1 ? '' : 's'}`;

        // ── Quality (FX only) ────────────────────────────────────────────
        // Derived, never stored: GMG Ch.16 keys quality straight off base cost.
        this.quality = this.baseCost >= 11 ? 'Amazing'
            : this.baseCost >= 6 ? 'Good'
            : 'Ordinary';
        this.hasBaseCost   = this.baseCost > 0;
        this.baseCostDisplay = this.hasBaseCost ? `${this.baseCost} SP (${this.quality})` : '—';

        // ── Range ────────────────────────────────────────────────────────
        this.hasRange = this.range.long > 0;
        this.rangeDisplay = this.hasRange
            ? `${this.range.short}/${this.range.medium}/${this.range.long} m`
            : '—';

        // ── Damage ───────────────────────────────────────────────────────
        this.hasDamage = !!(this.damage.ordinary || this.damage.good || this.damage.amazing);
        this.damageDisplay = this.hasDamage
            ? [this.damage.ordinary, this.damage.good, this.damage.amazing]
                .map(d => d || '—').join(' / ')
            : '—';

        // ── Outcomes ─────────────────────────────────────────────────────
        this.hasOutcomes = !!(this.outcomes.ordinary || this.outcomes.good || this.outcomes.amazing);

        // ── Rank benefits ────────────────────────────────────────────────
        // Sorted so the card reads in unlock order, and flagged against the
        // owner's current rank so the sheet can grey out what isn't earned yet.
        //
        // `index` carries each row's position in the *stored* array through the
        // sort. The sheet edits these rows in place via `system.rankBenefits.N.…`,
        // so binding to the sorted position would write the edit onto whichever
        // benefit happens to sit at that slot instead.
        this.sortedRankBenefits = (this.rankBenefits ?? [])
            .map((b, index) => ({ ...b, index, isUnlocked: this.rank >= (b.rank ?? 0) }))
            .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
        this.hasRankBenefits = this.sortedRankBenefits.length > 0;
        this.unlockedRankBenefitCount = this.sortedRankBenefits.filter(b => b.isUnlocked).length;

        // ── Trappings ────────────────────────────────────────────────────
        const trappingParts = [];
        if (this.trappings.ritual)     trappingParts.push('Ritual');
        if (this.trappings.word)       trappingParts.push('Word');
        if (this.trappings.will)       trappingParts.push('Will');
        if (this.trappings.component)  trappingParts.push('Component');
        if (this.trappings.focus)      trappingParts.push('Focus');
        if (this.trappings.complexity) trappingParts.push('Complexity');
        this.hasTrappings     = trappingParts.length > 0;
        this.trappingsDisplay = trappingParts.length ? trappingParts.join(', ') : '—';

        // ── Misc flags ───────────────────────────────────────────────────
        this.hasResistance        = this.resistance !== 'None';
        this.isMentalCombatPower  = this.mentalCombatClass !== 'None';
        this.hasMaintenance       = !!this.maintenanceCost;
    }
}
