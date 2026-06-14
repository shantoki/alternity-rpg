/**
 * @file NpcData.js
 * @description Step 7 — TypeDataModel: Schema for the 'npc' Actor type.
 *
 * NPCs share the core combat stats (abilities, resources, wounds) with characters
 * but omit career/focus/XP progression and the full 55-skill list. They instead
 * expose simplified flat combat values that a GM can set directly without knowing
 * the full derivation formula.
 *
 * Extras unique to NPCs:
 *   - cr          : Challenge Rating (descriptive, not numeric)
 *   - morale      : Threshold at which the NPC flees or surrenders (0–100)
 *   - isElite     : Elite NPCs get one additional action per round
 *   - rewardXP    : XP awarded to players on defeat
 *   - tactics     : GM-facing text describing combat behaviour
 */

const { fields } = foundry.data;

function abilityField(initial = 0) {
    return new fields.NumberField({
        required: true,
        nullable: false,
        integer:  true,
        initial:  initial,
        min:      -3,
        max:      6,
    });
}

function resourceSchema(currentDefault, maxDefault) {
    return new fields.SchemaField({
        value: new fields.NumberField({
            required: true,
            nullable: false,
            integer:  true,
            initial:  currentDefault,
            min:      0,
        }),
        max: new fields.NumberField({
            required: true,
            nullable: false,
            integer:  true,
            initial:  maxDefault,
            min:      0,
        }),
    });
}

export class NpcData extends foundry.abstract.TypeDataModel {

    /** @override */
    static defineSchema() {
        return {
            // ── Core abilities (same range as characters) ────────────────
            abilities: new fields.SchemaField({
                str: abilityField(0),
                dex: abilityField(0),
                con: abilityField(0),
                int: abilityField(0),
                wil: abilityField(0),
                per: abilityField(0),
            }),

            // ── Resource pools ───────────────────────────────────────────
            stamina:  resourceSchema(20, 20),
            vitality: resourceSchema(10, 10),

            // ── Wound state ──────────────────────────────────────────────
            woundLevel: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'Healthy',
                choices:  ['Healthy', 'Stunned', 'Wounded', 'Bleeding', 'Down', 'Out'],
            }),

            bleedRate: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  0,
                min:      0,
            }),

            // ── Flat combat values (GM can override derived formula) ──────
            // Defense = 10 + DEX modifier + armor; GMs may set this directly.
            defenseBonus: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  0,
            }),

            // Flat attack bonus added to all attack rolls.
            attackBonus: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  0,
            }),

            // Flat damage value (e.g. "2d6+3" stored as a formula string).
            damageFormula: new fields.StringField({
                required: false,
                initial:  '1d6',
            }),

            // ── NPC metadata ─────────────────────────────────────────────
            cr: new fields.StringField({
                required: false,
                initial:  'Average',
                choices:  ['Easy', 'Average', 'Tough', 'Overwhelming'],
            }),

            morale: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  50,
                min:      0,
                max:      100,
            }),

            isElite: new fields.BooleanField({
                required: true,
                initial:  false,
            }),

            rewardXP: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  100,
                min:      0,
            }),

            // ── GM notes ─────────────────────────────────────────────────
            tactics: new fields.HTMLField({
                required: false,
                initial:  '',
            }),

            biography: new fields.HTMLField({
                required: false,
                initial:  '',
            }),

            // ── Initiative and Actions ───────────────────────────────────
            actionsPerRound: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  2,
                min:      1,
            }),

            // ── Initiative modifier (cached) ─────────────────────────────
            initiativeModifier: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  0,
            }),
        };
    }

    /** @override */
    prepareDerivedData() {
        this.initiativeModifier = this.abilities.dex ?? 0;

        const WOUND_PENALTIES = {
            Healthy: 0, Stunned: 0, Wounded: 0,
            Bleeding: 0, Down: 2, Out: null,
        };
        this.woundPenalty    = WOUND_PENALTIES[this.woundLevel] ?? 0;
        this.isIncapacitated = this.woundLevel === 'Out';

        // Derived defense value (base 10 + DEX modifier + any armor bonus)
        this.defense = 10 + (this.abilities.dex ?? 0) + (this.defenseBonus ?? 0);
    }

    /** @override */
    static migrateData(source) {
        if (source.wound?.level && !source.woundLevel) {
            source.woundLevel = source.wound.level;
            delete source.wound;
        }
        return super.migrateData(source);
    }
}
