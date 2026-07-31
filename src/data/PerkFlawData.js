/**
 * @file PerkFlawData.js
 * @description TypeDataModel: Schema for the 'perkFlaw' Item type.
 *
 * Perks and Flaws are the Player's Handbook advantage/disadvantage traits
 * (Chapter 5/6): Perks cost skill points to buy; Flaws grant bonus skill
 * points in exchange for a constant penalty. Some entries (e.g. Obsessed,
 * Phobia, Old Injury) are tiered — they can be purchased at 2+ escalating
 * cost levels ("2/4/6") rather than a single flat cost.
 *
 * Key fields:
 *   - category       : Perk | Flaw
 *   - linkedAbility  : Ability the trait is tied to (or Special/None)
 *   - activationType : Active (always in effect) | Conscious (requires a
 *                      perk check to invoke) — Player's Handbook "Type" column.
 *                      Meaningful for Perks; Flaws are always constant.
 *   - isTiered       : True if this trait has multiple purchase levels.
 *   - tierCosts      : Cost/bonus-point value at each purchase level.
 *   - currentTier    : Which level (1-based index into tierCosts) is active.
 *   - cost           : Flat skill-point cost (Perk) or bonus skill points
 *                       granted (Flaw) when not tiered.
 */

const { fields } = foundry.data;

export class PerkFlawData extends foundry.abstract.TypeDataModel {

    /** @override */
    static defineSchema() {
        return {
            // ── Classification ───────────────────────────────────────────
            category: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'Perk',
                choices:  ['Perk', 'Flaw'],
            }),

            linkedAbility: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'None',
                choices:  ['STR', 'DEX', 'CON', 'INT', 'WIL', 'PER', 'Special', 'None'],
            }),

            // Perks only: whether the trait is always in effect or must be
            // consciously invoked with a perk check. Ignored for Flaws.
            activationType: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'Active',
                choices:  ['Active', 'Conscious'],
            }),

            // ── Cost ─────────────────────────────────────────────────────
            cost: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  3,
                min:      0,
            }),

            isTiered: new fields.BooleanField({
                required: true,
                initial:  false,
            }),

            tierCosts: new fields.ArrayField(
                new fields.NumberField({ required: true, nullable: false, integer: true, min: 0 }),
                { required: true, initial: [] }
            ),

            // 1-based index into tierCosts identifying the purchased level.
            // 0 when isTiered is false or no level has been purchased yet.
            currentTier: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  0,
                min:      0,
            }),

            // ── Flavour / rules text ─────────────────────────────────────
            description: new fields.HTMLField({
                required: false,
                initial:  '',
            }),
        };
    }

    /** @override */
    prepareDerivedData() {
        // Derived: effective skill-point cost/bonus given the purchased tier.
        this.effectiveCost = this.isTiered
            ? (this.tierCosts[this.currentTier - 1] ?? this.tierCosts[0] ?? 0)
            : this.cost;

        // Derived: display string for the cost column ("3" or "2/4/6").
        this.costDisplay = this.isTiered ? this.tierCosts.join('/') : `${this.cost}`;

        this.isPerk = this.category === 'Perk';
        this.isFlaw = this.category === 'Flaw';

        // Derived: whether using this trait's benefit requires a perk check.
        this.requiresCheck = this.isPerk && this.activationType === 'Conscious';
    }
}
