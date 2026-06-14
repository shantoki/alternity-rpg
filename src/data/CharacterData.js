/**
 * @file CharacterData.js
 * @description Step 7 — TypeDataModel: Schema for the 'character' Actor type.
 *
 * Foundry v14 stores all system-specific data under `actor.system.*`. This
 * TypeDataModel defines the field schema so Foundry can validate, migrate, and
 * persist that data correctly — including type coercion, default values, and
 * document preparation hooks.
 *
 * Relationship to AlternityCharacterState:
 *   AlternityCharacterState (alternity-actor-data.js) is the runtime wrapper used
 *   by the hook/service layer. CharacterData is the *Foundry schema layer* — it
 *   lives at actor.system and is what Foundry serialises to its database. The two
 *   mirror each other deliberately; CharacterData provides the persistent backing
 *   store that AlternityCharacterState reads from / writes to via actor flags.
 *
 * Field groups:
 *   - abilities     : Six core ability score modifiers (STR/DEX/CON/INT/WIL/PER)
 *   - resources     : Stamina, Vitality, Tech Points, Psi Points (current + max)
 *   - biography     : Free-text actor description
 *   - details       : Species, career, focus, level, XP
 *   - woundLevel    : Current wound state string
 *   - bleedRate     : Vitality lost per round when Bleeding
 */

const { fields } = foundry.data;

// ---------------------------------------------------------------------------
// AbilitiesSchema — the six core ability score modifiers
// ---------------------------------------------------------------------------

/**
 * A single ability score modifier, stored as an integer −3 to +6.
 * @param {number} [initial=0]
 */
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

// ---------------------------------------------------------------------------
// ResourceSchema — current / max pair for a resource pool
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// CharacterData
// ---------------------------------------------------------------------------

export class CharacterData extends foundry.abstract.TypeDataModel {

    /** @override */
    static defineSchema() {
        return {
            // ── Ability scores ───────────────────────────────────────────
            abilities: new fields.SchemaField({
                str: abilityField(0),
                dex: abilityField(0),
                con: abilityField(0),
                int: abilityField(0),
                wil: abilityField(0),
                per: abilityField(0),
            }),

            // ── Resource pools ───────────────────────────────────────────
            stamina:    resourceSchema(20, 20),
            vitality:   resourceSchema(10, 10),
            techPoints: resourceSchema(0, 0),
            psiPoints:  resourceSchema(0, 0),

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

            // ── Character details ────────────────────────────────────────
            details: new fields.SchemaField({
                species: new fields.StringField({ required: false, initial: '' }),
                career:  new fields.StringField({
                    required: true,
                    nullable: false,
                    initial:  'Soldier',
                    choices:  ['Soldier', 'Explorer', 'Expert'],
                }),
                focus:   new fields.StringField({ required: false, initial: '' }),
                level:   new fields.NumberField({
                    required: true,
                    nullable: false,
                    integer:  true,
                    initial:  1,
                    min:      1,
                    max:      10,
                }),
                xp: new fields.NumberField({
                    required: true,
                    nullable: false,
                    integer:  true,
                    initial:  0,
                    min:      0,
                }),
                xpToNextLevel: new fields.NumberField({
                    required: true,
                    nullable: false,
                    integer:  true,
                    initial:  1000,
                    min:      0,
                }),
            }),

            // ── Biography ────────────────────────────────────────────────
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
            // Derived = DEX modifier; stored here so the combat tracker can
            // read it without loading actor state. Updated by prepareData().
            initiativeModifier: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  0,
            }),

            // ── New Features (Phase 4) ───────────────────────────────────
            combatMovement: new fields.SchemaField({
                sprint: new fields.NumberField({ initial: 0 }),
                run: new fields.NumberField({ initial: 0 }),
                walk: new fields.NumberField({ initial: 0 }),
                easySwim: new fields.NumberField({ initial: 0 }),
                swim: new fields.NumberField({ initial: 0 }),
                glide: new fields.NumberField({ initial: 0 }),
                fly: new fields.NumberField({ initial: 0 }),
            }),

            personalData: new fields.SchemaField({
                age: new fields.StringField({ initial: '' }),
                height: new fields.StringField({ initial: '' }),
                weight: new fields.StringField({ initial: '' }),
                appearance: new fields.StringField({ initial: '' }),
                allegiance: new fields.StringField({ initial: '' }),
                socialStatus: new fields.StringField({ initial: '' }),
                contacts: new fields.HTMLField({ initial: '' }),
                enemies: new fields.HTMLField({ initial: '' }),
            }),

            achievementTrack: new fields.SchemaField({
                level: new fields.NumberField({ initial: 1, min: 1 }),
                pointsSpent: new fields.NumberField({ initial: 0 }),
                pointsStored: new fields.NumberField({ initial: 0 }),
            }),

            features: new fields.SchemaField({
                usePsionics: new fields.BooleanField({ initial: false }),
                useMutations: new fields.BooleanField({ initial: false }),
                useCybertech: new fields.BooleanField({ initial: false }),
            }),

            psionics: new fields.SchemaField({
                energy: resourceSchema(0, 0),
                powers: new fields.ArrayField(new fields.SchemaField({
                    name: new fields.StringField({ initial: '' }),
                    rank: new fields.NumberField({ initial: 0 }),
                })),
            }),

            mutations: new fields.SchemaField({
                origin: new fields.StringField({ initial: '' }),
                uniqueness: new fields.StringField({ initial: '' }),
                points: new fields.NumberField({ initial: 0 }),
                drawbackPoints: new fields.NumberField({ initial: 0 }),
                ordinary: new fields.HTMLField({ initial: '' }),
                good: new fields.HTMLField({ initial: '' }),
                amazing: new fields.HTMLField({ initial: '' }),
                slightDrawbacks: new fields.HTMLField({ initial: '' }),
                moderateDrawbacks: new fields.HTMLField({ initial: '' }),
                extremeDrawback: new fields.HTMLField({ initial: '' }),
            }),

            cybertech: new fields.SchemaField({
                tolerance: resourceSchema(0, 0),
                cykosis: new fields.NumberField({ initial: 0 }),
                gearInstalled: new fields.HTMLField({ initial: '' }),
            }),

            computers: new fields.ArrayField(new fields.SchemaField({
                model: new fields.StringField({ initial: '' }),
                processorQuality: new fields.StringField({ initial: '' }),
                activeMemory: new fields.NumberField({ initial: 0 }),
                activeStorage: new fields.NumberField({ initial: 0 }),
                programs: new fields.HTMLField({ initial: '' }),
            })),
        };
    }

    // -----------------------------------------------------------------------
    // Derived / prepared data
    // -----------------------------------------------------------------------

    /**
     * Called by Foundry after the base data is set. Use to compute values
     * that are derived from other fields rather than stored directly.
     * @override
     */
    prepareDerivedData() {
        // Cache DEX modifier as initiative modifier for the combat tracker.
        this.initiativeModifier = this.abilities.dex ?? 0;

        // Compute wound penalty for sheet display. The hook layer reads the
        // real penalty from AlternityCharacterState; this is a read-only hint
        // for templates that only have access to actor.system.
        const WOUND_PENALTIES = {
            Healthy:  0,
            Stunned:  0,
            Wounded:  0,
            Bleeding: 0,
            Down:     2,
            Out:      null,
        };
        this.woundPenalty = WOUND_PENALTIES[this.woundLevel] ?? 0;

        // Derived: is the character incapacitated?
        this.isIncapacitated = this.woundLevel === 'Out';
    }

    // -----------------------------------------------------------------------
    // Migration
    // -----------------------------------------------------------------------

    /**
     * Called by Foundry when loading a document whose data version is older
     * than the current schema. Add migration rules here as the schema evolves.
     * @param {object} source — The raw source data from the database.
     * @override
     */
    static migrateData(source) {
        // v0.1 → v0.2: flatten wound level from legacy 'wound.level' path
        if (source.wound?.level && !source.woundLevel) {
            source.woundLevel = source.wound.level;
            delete source.wound;
        }
        return super.migrateData(source);
    }
}
