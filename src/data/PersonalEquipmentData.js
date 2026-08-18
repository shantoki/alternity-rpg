/**
 * @file PersonalEquipmentData.js
 * @description TypeDataModel: Schema for the 'personalEquipment' Item type.
 *
 * Covers the Player's Handbook Chapter 9 "Personal Equipment" catalog —
 * communications gear, medical gear, professional equipment, sensors,
 * survival gear, and miscellaneous items. Unlike Weapon/Armor/Cybertech,
 * these items don't share one mechanical formula; most just grant a
 * single situational skill bonus/penalty and optionally have limited uses
 * (e.g. a first aid kit's "three attempts to heal wounds"). This schema
 * models that common shape rather than bespoke per-item mechanics.
 *
 * Key fields:
 *   - category      : Communications | Medical | Professional | Sensors |
 *                      Survival | Clothing | Miscellaneous
 *   - progressLevel : PL at which the item becomes available
 *   - cost          : Price in credits/dollars
 *   - bonusSkill    : Free-text skill/specialty the item modifies (if any)
 *   - bonusValue    : Situation die step modifier (negative = bonus, per
 *                      the Alternity convention used throughout this codebase)
 *   - maxCharges    : Limited uses before the item is exhausted (0 = unlimited)
 *   - currentCharges: Uses remaining
 *   - powerNotes    : Free-text battery/power-source duration
 */

import { availabilityField } from './item-acquisition.js';

const { fields } = foundry.data;

export class PersonalEquipmentData extends foundry.abstract.TypeDataModel {

    /** @override */
    static defineSchema() {
        return {
            // ── Classification ───────────────────────────────────────────
            category: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'Miscellaneous',
                choices:  ['Communications', 'Medical', 'Professional', 'Sensors', 'Survival', 'Clothing', 'Miscellaneous'],
            }),

            progressLevel: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  4,
                min:      0,
                max:      8,
            }),

            // ── Cost / mass ──────────────────────────────────────────────
            cost: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  0,
                min:      0,
            }),

            mass: new fields.NumberField({
                required: true,
                nullable: false,
                initial:  0,
                min:      0,
            }),

            /** How hard the gear is to come by legally (the tables' Com/Con/Mil/Res). */
            availability: availabilityField(),

            // ── Situational skill modifier ───────────────────────────────
            // Free text since the source material names specialty skills
            // (e.g. "Knowledge-first aid"), not SKILL_DEFINITIONS ids.
            bonusSkill: new fields.StringField({
                required: false,
                initial:  '',
            }),

            bonusValue: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  0,
            }),

            // ── Limited uses (0 = unlimited) ─────────────────────────────
            maxCharges: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  0,
                min:      0,
            }),

            currentCharges: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  0,
                min:      0,
            }),

            // ── Power source (free text: battery life, recharge time, etc.) ─
            powerNotes: new fields.StringField({
                required: false,
                initial:  '',
            }),

            // ── Inventory state ──────────────────────────────────────────
            isEquipped: new fields.BooleanField({
                required: true,
                initial:  false,
            }),

            quantity: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  1,
                min:      0,
            }),

            // ── Flavour ──────────────────────────────────────────────────
            description: new fields.HTMLField({
                required: false,
                initial:  '',
            }),
        };
    }

    /** @override */
    prepareDerivedData() {
        this.isLimitedUse = this.maxCharges > 0;
        this.hasBonus      = !!this.bonusSkill && this.bonusValue !== 0;

        this.plLabel = `PL ${this.progressLevel}`;
        this.costDisplay = this.cost > 0 ? `$${this.cost}` : '—';

        this.bonusDisplay = this.hasBonus
            ? `${this.bonusValue > 0 ? '+' : ''}${this.bonusValue} to ${this.bonusSkill}`
            : '—';

        this.chargesDisplay = this.isLimitedUse
            ? `${this.currentCharges}/${this.maxCharges}`
            : '—';
    }
}
