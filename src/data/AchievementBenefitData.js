/**
 * @file AchievementBenefitData.js
 * @description TypeDataModel: Schema for the 'achievementBenefit' Item type.
 *
 * Covers Player's Handbook Chapter 8 "Achievements", Table P29 — the things a
 * hero can buy with skill points that aren't skills: action check bonuses,
 * ability score increases, extra actions, durability rating increases, perks,
 * flaw removal, contacts and monetary awards. Mindwalking adds one more
 * (increasing psionic energy points).
 *
 * How the currency actually flows, because the name is misleading: achievement
 * benefits are NOT bought with achievement points. The GM awards achievement
 * points at the end of an adventure; filling the current level's goal box on
 * the achievement track converts them 1:1 into *skill points* and raises the
 * hero's achievement level. Skill points are then what buys a benefit — and
 * only between adventures.
 *
 * That gives every benefit exactly three gating axes, all of which vary by
 * profession (PHB Ch.8: "'Cost' lists the purchase price in skill points for
 * the benefit in question; 'Lvl' gives the achievement level the hero must
 * reach before he can purchase the benefit."):
 *
 *   - `cost`     — skill points
 *   - `minLevel` — required achievement level
 *   - `maxPurchases` — 1, 2, 3, 8, or unlimited
 *
 * `profession` is stored on the item rather than read off the owning actor so
 * that a compendium can hold one entry per profession column of Table P29 —
 * the same benefit genuinely costs a Combat Spec and a Diplomat different
 * amounts and unlocks at different levels.
 *
 * NOTE on source fidelity: Table P29's printed numerals did not survive this
 * repo's OCR of the scans. The schema shape is taken from the surviving prose;
 * the per-profession Cost/Lvl grid has to be entered per item.
 */

const { fields } = foundry.data;

/**
 * The benefit families Table P29 prints. Kept coarse deliberately: the table's
 * ~35 line items are mostly the same handful of benefits repeated per ability
 * or per perk, and the specific one is the item's *name*.
 */
export const ACHIEVEMENT_BENEFIT_TYPES = Object.freeze([
    'Action Check Bonus',      // -1 step on action checks; once only
    'Action Check Increase',   // +1 to the action check score; up to 3 times
    'Extra Action',            // +1 action per round, to a maximum of 4
    'Ability Score Increase',  // +1 to one ability; twice per ability, at rising prices
    'Durability Increase',     // +1 to a stun / wound / mortal / fatigue rating
    'Psionic Energy Increase', // Mindwalking: +1 psionic energy point
    'Monetary Award',          // a windfall, at levels 3/6/9/12/15/18/21/24
    'New Perk',                // only if fewer than three perks were bought at creation
    'Remove Flaw',             // costs double what the flaw granted
    'Acquire Contact',         // buys a new Contact (GM Guide Ch.7)
]);

/** The five profession columns of Table P29. */
export const ACHIEVEMENT_PROFESSIONS = Object.freeze([
    'Combat Spec', 'Diplomat', 'Free Agent', 'Tech Op', 'Mindwalker',
]);

/**
 * What the benefit mechanically changes, for the ones that change a number.
 * Monetary Award, New Perk, Remove Flaw and Acquire Contact deliberately have
 * no payload — they are narrative and GM-adjudicated.
 */
export const ACHIEVEMENT_EFFECT_TARGETS = Object.freeze([
    'None',
    'ActionCheckStep',   // the situation die on action checks (a -1 step bonus)
    'ActionCheckScore',  // the action check score itself
    'ActionsPerRound',
    'AbilityScore',
    'StunRating',
    'WoundRating',
    'MortalRating',
    'FatigueRating',
    'PsionicEnergy',
]);

export class AchievementBenefitData extends foundry.abstract.TypeDataModel {

    /** @override */
    static defineSchema() {
        return {
            // ── Classification ───────────────────────────────────────────
            benefitType: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'Ability Score Increase',
                choices:  [...ACHIEVEMENT_BENEFIT_TYPES],
            }),

            profession: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'Combat Spec',
                choices:  [...ACHIEVEMENT_PROFESSIONS],
            }),

            // ── Purchase gates ───────────────────────────────────────────
            cost: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  0,
                min:      0,
            }),

            // Remove Flaw prints no price: it costs double the skill points the
            // flaw granted, so the number depends on which flaw is being removed.
            costIsDoubleFlawValue: new fields.BooleanField({
                required: true,
                initial:  false,
            }),

            minLevel: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  3,
                min:      1,
            }),

            // 0 means "no printed limit" (Acquire Contact).
            maxPurchases: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  1,
                min:      0,
            }),

            timesPurchased: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  0,
                min:      0,
            }),

            /**
             * Monetary Award is the only benefit keyed to a *set* of achievement
             * levels (3, 6, 9, 12, 15, 18, 21, 24) rather than a floor. Empty
             * means the usual "minLevel or higher" rule applies.
             */
            allowedLevels: new fields.ArrayField(
                new fields.NumberField({ required: true, nullable: false, integer: true, min: 1 }),
                { required: false, initial: [] }
            ),

            /**
             * Mindwalking's psionic energy benefit adds the one constraint no
             * Table P29 entry has: at most one purchase per achievement level,
             * regardless of how many are still affordable.
             */
            onePerLevel: new fields.BooleanField({
                required: true,
                initial:  false,
            }),

            // ── Effect payload ───────────────────────────────────────────
            effectTarget: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'None',
                choices:  [...ACHIEVEMENT_EFFECT_TARGETS],
            }),

            // Only meaningful when effectTarget is 'AbilityScore'.
            effectAbility: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'None',
                choices:  ['STR', 'DEX', 'CON', 'INT', 'WIL', 'PER', 'None'],
            }),

            // Per purchase. Negative is a bonus for step-based targets, matching
            // the convention used throughout this codebase.
            effectValue: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  1,
            }),

            // ── Prerequisites ────────────────────────────────────────────
            // Prose, because the book's are prose: "not above the species
            // maximum", "only if fewer than three perks were purchased at
            // creation", "the flaw's removal must logically fit into the story".
            prerequisites: new fields.StringField({ required: false, initial: '' }),

            // ── Flavour / rules text ─────────────────────────────────────
            description: new fields.HTMLField({ required: false, initial: '' }),
        };
    }

    /** @override */
    prepareDerivedData() {
        // ── Cost ─────────────────────────────────────────────────────────
        this.costDisplay = this.costIsDoubleFlawValue
            ? '2× flaw value'
            : (this.cost > 0 ? `${this.cost} SP` : '—');

        // ── Level gate ───────────────────────────────────────────────────
        this.hasAllowedLevels = (this.allowedLevels?.length ?? 0) > 0;
        this.levelDisplay = this.hasAllowedLevels
            ? `Levels ${this.allowedLevels.join(', ')}`
            : `Level ${this.minLevel}+`;

        // ── Purchase tracking ────────────────────────────────────────────
        this.isUnlimited = this.maxPurchases === 0;
        this.isPurchased = this.timesPurchased > 0;
        this.isMaxed     = !this.isUnlimited && this.timesPurchased >= this.maxPurchases;
        this.purchasesDisplay = this.isUnlimited
            ? `${this.timesPurchased} / ∞`
            : `${this.timesPurchased} / ${this.maxPurchases}`;

        // ── Effect ───────────────────────────────────────────────────────
        this.hasEffect = this.effectTarget !== 'None' && this.effectValue !== 0;

        // Total delta granted so far, so an owning actor can apply the benefit
        // once per purchase rather than once per item.
        this.totalEffectValue = this.hasEffect ? this.effectValue * this.timesPurchased : 0;

        const signed = (v) => `${v > 0 ? '+' : ''}${v}`;
        const targetLabels = {
            ActionCheckStep:  'action check (step)',
            ActionCheckScore: 'action check score',
            ActionsPerRound:  'actions per round',
            AbilityScore:     this.effectAbility !== 'None' ? this.effectAbility : 'ability score',
            StunRating:       'stun rating',
            WoundRating:      'wound rating',
            MortalRating:     'mortal rating',
            FatigueRating:    'fatigue rating',
            PsionicEnergy:    'psionic energy',
        };
        this.effectDisplay = this.hasEffect
            ? `${signed(this.effectValue)} ${targetLabels[this.effectTarget] ?? this.effectTarget}`
            : '—';

        this.hasPrerequisites = !!this.prerequisites || this.onePerLevel;
    }

    /**
     * Whether a hero at `achievementLevel` with `availableSkillPoints` could buy
     * this benefit right now.
     *
     * Returns a structured verdict rather than a bare boolean so the sheet can
     * say *why* something is greyed out — the book's three gates fail for very
     * different reasons and a hero will hit all of them at different times.
     *
     * `flawValue` supplies the skill points the flaw granted, for Remove Flaw.
     *
     * @param {object} options
     * @param {number} [options.achievementLevel]
     * @param {number} [options.availableSkillPoints]
     * @param {number} [options.flawValue]
     * @param {number} [options.lastPurchaseLevel] - level at which this was last
     *   bought, for the one-per-level rule.
     * @returns {{ canPurchase: boolean, price: number, reasons: string[] }}
     */
    getPurchaseVerdict({
        achievementLevel     = 0,
        availableSkillPoints = 0,
        flawValue            = 0,
        lastPurchaseLevel    = null,
    } = {}) {
        const reasons = [];

        const price = this.costIsDoubleFlawValue ? flawValue * 2 : this.cost;

        if (this.isMaxed) {
            reasons.push(`Already purchased the maximum of ${this.maxPurchases}.`);
        }

        if (this.hasAllowedLevels) {
            if (!this.allowedLevels.includes(achievementLevel)) {
                reasons.push(`Only available at achievement levels ${this.allowedLevels.join(', ')}.`);
            }
        } else if (achievementLevel < this.minLevel) {
            reasons.push(`Requires achievement level ${this.minLevel}.`);
        }

        if (this.onePerLevel && lastPurchaseLevel !== null && lastPurchaseLevel >= achievementLevel) {
            reasons.push('Only one purchase per achievement level.');
        }

        if (availableSkillPoints < price) {
            reasons.push(`Costs ${price} skill points; ${availableSkillPoints} available.`);
        }

        return { canPurchase: reasons.length === 0, price, reasons };
    }
}
