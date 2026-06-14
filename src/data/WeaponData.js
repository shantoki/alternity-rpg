/**
 * @file WeaponData.js
 * @description Step 7 — TypeDataModel: Schema for the 'weapon' Item type.
 *
 * Weapons are Item documents carried by actors. The attack roll is:
 *   d20 + combatSkillRank + abilityModifier + attackBonus vs target's Defense
 *
 * Damage is:
 *   damageFormula + strengthOrDex modifier (melee uses STR, ranged uses DEX)
 *
 * Key fields:
 *   - weaponType     : Ranged | Melee | Thrown | Heavy
 *   - damageFormula  : Dice formula string, e.g. "2d6+3"
 *   - damageType     : Ballistic | Energy | Laser | etc.
 *   - attackBonus    : Flat bonus to the attack roll
 *   - range          : Short/Medium/Long range values (ranged weapons only)
 *   - techPointCost  : TP consumed per use (energy/tech weapons)
 *   - requiredSkill  : Skill id from SKILL_DEFINITIONS that governs this weapon
 *   - isEquipped     : Whether currently worn/held
 *   - quantity       : Ammo, charges, or item count
 */

const { fields } = foundry.data;

const DAMAGE_TYPES = [
    'Ballistic', 'Energy', 'Laser', 'Piercing', 'Slashing',
    'Impact', 'Incendiary', 'Toxic', 'Radiation', 'Psionic',
];

export class WeaponData extends foundry.abstract.TypeDataModel {

    /** @override */
    static defineSchema() {
        return {
            // ── Classification ───────────────────────────────────────────
            weaponType: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'Melee',
                choices:  ['Melee', 'Ranged', 'Thrown', 'Heavy'],
            }),

            damageType: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'Ballistic',
                choices:  DAMAGE_TYPES,
            }),

            damageCategory: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'wound',
                choices:  ['stun', 'wound', 'mortal'],
            }),

            // ── Damage ───────────────────────────────────────────────────
            damageFormula: new fields.StringField({
                required: true,
                nullable: false,
                initial:  '1d6',
            }),

            // Bonus damage added after the dice roll (separate from STR/DEX mod)
            damageBonus: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  0,
            }),

            // ── Attack ───────────────────────────────────────────────────
            attackBonus: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  0,
            }),

            // Which ability score's modifier is added to attack + damage.
            // Melee weapons typically use STR; ranged use DEX.
            attackAbility: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'str',
                choices:  ['str', 'dex'],
            }),

            // Skill id (from SKILL_DEFINITIONS) that governs attack rolls.
            requiredSkill: new fields.StringField({
                required: false,
                initial:  'str-melee',
            }),

            // ── Range (ranged/thrown weapons only) ───────────────────────
            range: new fields.SchemaField({
                short:  new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0,  min: 0 }),
                medium: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0,  min: 0 }),
                long:   new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0,  min: 0 }),
            }),

            // ── Resource cost ────────────────────────────────────────────
            techPointCost: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  0,
                min:      0,
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

            // Weight in kilograms (for encumbrance)
            weight: new fields.NumberField({
                required: true,
                nullable: false,
                initial:  1.0,
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
        // Derived: whether this weapon requires ammo tracking
        this.hasAmmo      = this.quantity > 0 && ['Ranged', 'Thrown', 'Heavy'].includes(this.weaponType);
        // Derived: whether the weapon has a tech-point cost
        this.usesTechPoints = this.techPointCost > 0;
        // Derived: display label for attack ability
        this.attackAbilityLabel = this.attackAbility === 'str' ? 'STR' : 'DEX';
    }

    /** @override */
    static migrateData(source) {
        // v0.1: damage stored as flat number, not formula
        if (typeof source.damage === 'number' && !source.damageFormula) {
            source.damageFormula = `${source.damage}`;
            delete source.damage;
        }
        return super.migrateData(source);
    }
}
