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
 *   - abilities     : Six core ability scores (STR/DEX/CON/INT/WIL/PER)
 *   - durability    : The four damage tracks — stun, wound, mortal, fatigue
 *   - lastResort    : Last resort points (current / max / buy-back cost)
 *   - resources     : Tech Points, Psi Points (current + max)
 *   - biography     : Free-text actor description
 *   - details       : Species, career, focus, level, XP
 *   - woundLevel    : Current wound state string
 *   - bleedRate     : Mortal points lost per round when Bleeding
 */

const { fields } = foundry.data;

// ---------------------------------------------------------------------------
// AbilitiesSchema — the six core ability score modifiers
// ---------------------------------------------------------------------------

/**
 * A single raw ability score (STR/DEX/CON/INT/WIL/PER).
 *
 * This is the *score*, not a modifier: `saveAlternityState()` mirrors
 * `AlternityCharacterState.abilityScores` straight into `system.abilities.*` so
 * native Foundry features can read them. The field used to be declared as a
 * modifier clamped to −3..+6, which silently truncated every score of 7 or more
 * down to 6 — a CON 10 hero's mirror read 6, and anything deriving from it (cyber
 * tolerance, defense, weapon ability bonuses) quietly used the wrong number.
 *
 * Range is deliberately generous: humans roll 4–14, but cybertech (a cyberlimb
 * adds up to +3 STR), mutations and non-human species all push past that.
 *
 * @param {number} [initial=10] - Matches AlternityCharacterState's own default.
 */
function abilityField(initial = 10) {
    return new fields.NumberField({
        required: true,
        nullable: false,
        integer:  true,
        initial:  initial,
        min:      0,
        max:      30,
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
                str: abilityField(),
                dex: abilityField(),
                con: abilityField(),
                int: abilityField(),
                wil: abilityField(),
                per: abilityField(),
            }),

            /**
             * ── Durability ───────────────────────────────────────────────
             * The four damage tracks the Player's Handbook actually defines:
             * "The four types of damage are stun damage, wound damage, mortal
             * damage, and fatigue damage." Stun and wound rate at the CON score,
             * mortal and fatigue at half of it (rounded up) — all four are
             * derived by AlternityMathService.calculateDurabilityRatings().
             *
             * This replaces the former `stamina` / `vitality` pools, which were
             * not Alternity mechanics at all: "vitality" appears once in the
             * whole PHB (as prose), and "Stamina" is a *skill*
             * (Stamina-endurance), not a resource. They were in fact stun and
             * wound under the wrong names — AlternityActor._syncSystemFromState()
             * has always written `state.durability.stun` into `system.stamina` —
             * so migrateData() below can carry the values across losslessly.
             */
            durability: new fields.SchemaField({
                stun:    resourceSchema(0, 10),
                wound:   resourceSchema(0, 10),
                mortal:  resourceSchema(0, 5),
                fatigue: resourceSchema(0, 5),
            }),

            /**
             * Last resort points (PHB Ch.2 "Last Resorts", Table P6).
             * `max` is keyed to Personality, but Table P6 is an image in the
             * available scans and its numerals did not survive OCR, so it is
             * stored rather than derived. A Free Agent's maximum is 1 higher than
             * the table shows, and 5 is the hard ceiling. `cost` is the skill
             * points needed to buy a spent point back between adventures.
             */
            lastResort: new fields.SchemaField({
                value: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0, max: 5 }),
                max:   new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0, max: 5 }),
                cost:  new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
            }, { initial: { value: 0, max: 0, cost: 0 } }),

            // ── Resource pools ───────────────────────────────────────────
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

            combatMovement: new fields.SchemaField({
                sprint: new fields.NumberField({ initial: 0 }),
                run: new fields.NumberField({ initial: 0 }),
                walk: new fields.NumberField({ initial: 0 }),
                easySwim: new fields.NumberField({ initial: 0 }),
                swim: new fields.NumberField({ initial: 0 }),
                glide: new fields.NumberField({ initial: 0 }),
                fly: new fields.NumberField({ initial: 0 }),
            }, { initial: { sprint: 0, run: 0, walk: 0, easySwim: 0, swim: 0, glide: 0, fly: 0 } }),

            personalData: new fields.SchemaField({
                age: new fields.StringField({ initial: '' }),
                height: new fields.StringField({ initial: '' }),
                weight: new fields.StringField({ initial: '' }),
                appearance: new fields.StringField({ initial: '' }),
                allegiance: new fields.StringField({ initial: '' }),
                socialStatus: new fields.StringField({ initial: '' }),
                contacts: new fields.HTMLField({ initial: '' }),
                enemies: new fields.HTMLField({ initial: '' }),
            }, { initial: { age: '', height: '', weight: '', appearance: '', allegiance: '', socialStatus: '', contacts: '', enemies: '' } }),

            achievementTrack: new fields.SchemaField({
                level: new fields.NumberField({ initial: 1, min: 1 }),
                pointsSpent: new fields.NumberField({ initial: 0 }),
                pointsStored: new fields.NumberField({ initial: 0 }),
            }, { initial: { level: 1, pointsSpent: 0, pointsStored: 0 } }),

            features: new fields.SchemaField({
                usePsionics: new fields.BooleanField({ initial: false }),
                useMutations: new fields.BooleanField({ initial: false }),
                useCybertech: new fields.BooleanField({ initial: false }),
            }, { initial: { usePsionics: false, useMutations: false, useCybertech: false } }),

            psionics: new fields.SchemaField({
                energy: resourceSchema(0, 0),
                powers: new fields.ArrayField(new fields.SchemaField({
                    name: new fields.StringField({ initial: '' }),
                    rank: new fields.NumberField({ initial: 0 }),
                })),
            }, { initial: { energy: { value: 0, max: 0 }, powers: [] } }),

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
            }, { initial: { origin: '', uniqueness: '', points: 0, drawbackPoints: 0, ordinary: '', good: '', amazing: '', slightDrawbacks: '', moderateDrawbacks: '', extremeDrawback: '' } }),

            cybertech: new fields.SchemaField({
                tolerance: resourceSchema(0, 0),
                cykosis: new fields.NumberField({ initial: 0 }),
                gearInstalled: new fields.HTMLField({ initial: '' }),
            }, { initial: { tolerance: { value: 0, max: 0 }, cykosis: 0, gearInstalled: '' } }),

            computers: new fields.ArrayField(new fields.SchemaField({
                model: new fields.StringField({ initial: '' }),
                processorQuality: new fields.StringField({ initial: '' }),
                activeMemory: new fields.NumberField({ initial: 0 }),
                activeStorage: new fields.NumberField({ initial: 0 }),
                programs: new fields.HTMLField({ initial: '' }),
            }), { initial: [] }),
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

        // v1.0 → v1.1: stamina/vitality → durability.stun/durability.wound.
        //
        // These were never separate mechanics: _syncSystemFromState() wrote
        // state.durability.stun into system.stamina and .wound into
        // system.vitality, so this is a rename, not a conversion, and the values
        // carry over exactly. Mortal and fatigue had no home in the old schema —
        // mortal is restored from AlternityCharacterState on the next sync, and
        // fatigue starts empty because it was never tracked anywhere.
        //
        // Guarded on the target being absent so re-running this can't clobber
        // newer data with stale legacy keys.
        if (source.stamina && !source.durability?.stun) {
            source.durability = source.durability ?? {};
            source.durability.stun = { ...source.stamina };
        }
        if (source.vitality && !source.durability?.wound) {
            source.durability = source.durability ?? {};
            source.durability.wound = { ...source.vitality };
        }
        delete source.stamina;
        delete source.vitality;

        return super.migrateData(source);
    }
}
