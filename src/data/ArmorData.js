/**
 * @file ArmorData.js
 * @description Step 7 — TypeDataModel: Schema for the 'armor' Item type.
 *
 * Armor grants a defense bonus and may impose a speed penalty and skill
 * check penalties. Characters can only have one set of armor equipped at a time.
 *
 * Defense formula: 10 + DEX modifier + armorBonus + other bonuses
 *
 * Key fields:
 *   - armorType      : Light | Medium | Heavy
 *   - armorBonus     : Defense bonus granted (+1 to +9)
 *   - speedPenalty   : Feet of movement lost per round (0, 10, or 20)
 *   - skillPenalty   : Flat penalty to DEX-based skill checks while worn
 *   - damageResistance: Flat damage reduction (applied before wound calc)
 *   - resistedTypes  : Which damage types this armor resists (empty = all)
 *   - isEquipped     : Whether currently worn
 *   - techPointCost  : TP to activate powered armor per scene
 */

const { fields } = foundry.data;

const DAMAGE_TYPES = [
    'Ballistic', 'Energy', 'Laser', 'Piercing', 'Slashing',
    'Impact', 'Incendiary', 'Toxic', 'Radiation', 'Psionic',
];

export class ArmorData extends foundry.abstract.TypeDataModel {

    /** @override */
    static defineSchema() {
        return {
            // ── Classification ───────────────────────────────────────────
            armorType: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'Light',
                choices:  ['Light', 'Medium', 'Heavy', 'Powered'],
            }),

            // ── Defense ──────────────────────────────────────────────────
            armorBonus: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  1,
                min:      0,
                max:      15,  // powered armor can exceed Heavy's +9
            }),

            // ── Penalties ────────────────────────────────────────────────
            speedPenalty: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  0,
                min:      0,
                max:      30,
            }),

            // Penalty applied to DEX-linked skill checks (Stealth, Acrobatics, etc.)
            skillPenalty: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  0,
                min:      0,
                max:      10,
            }),

            // ── Damage resistance ────────────────────────────────────────
            // Flat damage reduction before wound level recalculation.
            damageResistance: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  0,
                min:      0,
            }),

            // If non-empty, resistance only applies to these damage types.
            // Empty array = resists all damage types.
            resistedTypes: new fields.ArrayField(
                new fields.StringField({ choices: DAMAGE_TYPES }),
                { required: true, initial: [] }
            ),

            // ── Power (powered armor only) ───────────────────────────────
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

            weight: new fields.NumberField({
                required: true,
                nullable: false,
                initial:  5.0,
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
        // Derived: whether this armor requires ongoing tech point expenditure
        this.isPowered      = this.armorType === 'Powered';
        this.usesTechPoints = this.techPointCost > 0;

        // Derived: human-readable defense bonus label for the sheet
        this.defenseBonusLabel = `+${this.armorBonus}`;

        // Derived: whether selective resistance is active
        this.hasResistance  = this.damageResistance > 0;
        this.isSelective     = this.resistedTypes.length > 0;
    }

    /** @override */
    static migrateData(source) {
        // v0.1: single resistedType string → resistedTypes array
        if (typeof source.resistedType === 'string' && !source.resistedTypes) {
            source.resistedTypes = source.resistedType ? [source.resistedType] : [];
            delete source.resistedType;
        }
        return super.migrateData(source);
    }
}
