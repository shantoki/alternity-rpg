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

import { AlternityMathService } from '../services/alternity-math.js';

const { fields } = foundry.data;

/**
 * A single raw ability score, same shape and range as CharacterData's — NPCs are
 * synced from AlternityCharacterState by the same code path. See the note there:
 * this used to be clamped to −3..+6 as if it held a modifier, which truncated
 * every score of 7 or more down to 6.
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
                str: abilityField(),
                dex: abilityField(),
                con: abilityField(),
                int: abilityField(),
                wil: abilityField(),
                per: abilityField(),
            }, { initial: { str: 10, dex: 10, con: 10, int: 10, wil: 10, per: 10 } }),

            /**
             * ── Durability ───────────────────────────────────────────────
             * Identical to a hero's. The Gamemaster Guide is explicit that
             * supporting cast are not simplified here: "These supporting cast
             * members receive the same number of stun, wound, fatigue, and mortal
             * points as a hero with the same Constitution score." Printed in
             * statblocks as a four-value run, e.g. `Durability: 9/9/5/5`.
             *
             * Replaces the former stamina/vitality pools — see the note in
             * CharacterData for why those were never Alternity mechanics.
             */
            durability: new fields.SchemaField({
                stun:    resourceSchema(0, 10),
                wound:   resourceSchema(0, 10),
                mortal:  resourceSchema(0, 5),
                fatigue: resourceSchema(0, 5),
            }),

            // Supporting cast can hold last resort points too (PHB Ch.3:
            // "Heroes and members of the supporting cast can have last resort
            // points"). Statblocks print it as `Last resorts: N`.
            lastResort: new fields.SchemaField({
                value: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0, max: 5 }),
                max:   new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0, max: 5 }),
            }, { initial: { value: 0, max: 0 } }),

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

        // Derived defense. Alternity has no armor-class number — defending applies a
        // step penalty to the attacker's check — so this is DEX's resistance modifier
        // plus any flat bonus the GM has given this NPC. AlternityActor._prepareNpcData()
        // recomputes the same value once the document layer runs.
        this.resistanceModifier = AlternityMathService.calculateResistanceModifier(
            this.abilities.dex ?? 0, 'DEX'
        ) + (this.defenseBonus ?? 0);
    }

    /** @override */
    static migrateData(source) {
        if (source.wound?.level && !source.woundLevel) {
            source.woundLevel = source.wound.level;
            delete source.wound;
        }

        // stamina/vitality → durability.stun/.wound. A rename, not a conversion —
        // see the fuller note in CharacterData.migrateData().
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
