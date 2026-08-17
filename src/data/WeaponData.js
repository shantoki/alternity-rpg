/**
 * @file WeaponData.js
 * @description TypeDataModel: Schema for the 'weapon' Item type.
 *
 * An Alternity attack is not a d20-plus-bonuses roll against a defence number.
 * It is a roll-under skill check on the weapon's governing skill, and the
 * *degree* that check achieves picks which of three damage codes fires
 * (PHB Ch.11, "How to Read the Weapons Tables"):
 *
 *   Skill  → the specialty this weapon is used with, e.g. Modern Ranged Weapons-pistol
 *   Acc    → a situation-die step modifier on the wielder's check (`attackBonus`)
 *   Range  → short/medium/long, each with its own step modifier (Table P22)
 *   Type   → damage form (LI/HI/En) plus firepower (Marginal..Amazing)
 *   Damage → three codes, in Ordinary / Good / Amazing order
 *
 * That last line is why `damageOrdinary` / `damageGood` / `damageAmazing`
 * replaced the single `damageFormula` this schema used to carry: with one formula
 * there was nothing for the degree of success to select, so an attack roll could
 * not produce the right damage at all. Supporting cast, creatures and spaceships
 * already stored their attacks as three-column runs; weapons now match them.
 *
 * Each code carries its own track letter — "d4+1s" is stun, "d6+2w" is wound —
 * so a single weapon's three columns can land on three different tracks, which
 * the published tables routinely do. `damageCategory` is the fallback for a code
 * written without a letter.
 */

const { fields } = foundry.data;

const DAMAGE_TYPES = [
    'Ballistic', 'Energy', 'Laser', 'Piercing', 'Slashing',
    'Impact', 'Incendiary', 'Toxic', 'Radiation', 'Psionic',
];

/**
 * Firepower tier from the weapon table's Type column. A weapon whose firepower is
 * inferior to the toughness it is used against degrades its damage a grade.
 */
const FIREPOWER_CLASSES = ['Marginal', 'Ordinary', 'Good', 'Amazing'];

/**
 * Which row of Table P22 (Range Modifiers by Weapon Type) this weapon reads.
 *
 * Deliberately a separate axis from `weaponType`: the table keys off what kind of
 * gun a weapon is, not whether it is ranged. A rifle and a pistol are both
 * `weaponType: 'Ranged'` and degrade over distance completely differently.
 * 'Melee' means the table does not apply — a melee weapon's range is "Personal".
 */
const RANGE_CLASSES = ['Melee', 'Primitive', 'Pistol', 'Rifle', 'SMG'];

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

            // The track a damage code with no trailing letter lands on. Codes are
            // normally written with one ("d4+2w"), which wins over this.
            damageCategory: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'wound',
                choices:  ['stun', 'wound', 'mortal'],
            }),

            firepower: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'Ordinary',
                choices:  FIREPOWER_CLASSES,
            }),

            // ── Damage, in Ordinary / Good / Amazing order ────────────────
            // Free text, not a validated formula: these are Alternity damage
            // codes ("d4+1s", "d6+2w"), whose trailing grade letter is notation
            // rather than dice. AlternityMathService.parseDamageCode splits them.
            damageOrdinary: new fields.StringField({
                required: false,
                nullable: false,
                initial:  'd4w',
            }),

            damageGood: new fields.StringField({
                required: false,
                nullable: false,
                initial:  '',
            }),

            damageAmazing: new fields.StringField({
                required: false,
                nullable: false,
                initial:  '',
            }),

            // Bonus damage added after the dice roll (separate from STR/DEX mod)
            damageBonus: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  0,
            }),

            // ── Attack ───────────────────────────────────────────────────
            // The weapon table's "Acc" column: a situation-die step modifier on
            // the wielder's check, following this codebase's convention that a
            // negative step is a bonus (a precise laser rifle is -1, a flintlock
            // pistol +2). It is not a d20-style to-hit bonus.
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
            rangeClass: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'Melee',
                choices:  RANGE_CLASSES,
            }),

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

        // The three damage columns in one object, which is the shape both
        // AlternityMathService.selectDamageGrade and the sheets' roll buttons
        // expect. Blank columns are kept: selectDamageGrade walks down from the
        // achieved grade to the first one that is filled in, so a weapon with only
        // an Ordinary code still rolls damage on an Amazing hit.
        this.damageRun = {
            ordinary: this.damageOrdinary ?? '',
            good:     this.damageGood ?? '',
            amazing:  this.damageAmazing ?? '',
        };
        this.damageRunLabel = [this.damageOrdinary, this.damageGood, this.damageAmazing]
            .filter(Boolean).join(' / ') || '—';

        // Whether Table P22's range bands apply at all. A melee weapon has no
        // bands, and neither does a ranged weapon whose class was never set.
        this.usesRangeBands = this.rangeClass !== 'Melee';
    }

    /** @override */
    static migrateData(source) {
        // v0.1: damage stored as flat number, not formula
        if (typeof source.damage === 'number' && !source.damageFormula) {
            source.damageFormula = `${source.damage}`;
            delete source.damage;
        }

        // v0.3: the single `damageFormula` became the Ordinary column of a
        // three-grade run. The old field carried no grade letter — the track lived
        // separately in `damageCategory` — so the letter is appended here to keep
        // the code self-describing, which is what parseDamageCode reads.
        if (source.damageFormula !== undefined) {
            if (!source.damageOrdinary) {
                const letter = { stun: 's', wound: 'w', mortal: 'm' }[source.damageCategory] ?? '';
                source.damageOrdinary = `${source.damageFormula}${letter}`;
            }
            delete source.damageFormula;
        }

        // v0.3: `rangeClass` split off from `weaponType`. Existing weapons are
        // classed from what is known about them — anything with a long range is a
        // gun, and Rifle is the least punishing guess, so a migrated weapon is
        // never made accidentally worse than it was. Melee otherwise.
        if (source.rangeClass === undefined) {
            const hasRange = (source.range?.long ?? 0) > 0 || (source.range?.medium ?? 0) > 0;
            source.rangeClass = hasRange ? 'Rifle' : 'Melee';
        }

        return super.migrateData(source);
    }
}
