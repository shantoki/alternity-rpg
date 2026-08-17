/**
 * @file NpcData.js
 * @description TypeDataModel: Schema for the 'npc' Actor type — the supporting cast.
 *
 * Source: Gamemaster Guide Ch.7 (Creating Supporting Characters) and its
 * Supporting Character Templates.
 *
 * "Supporting cast" is the book's umbrella term for every Gamemaster-run character:
 * villains, allies, sidekicks, employees, followers, experts and extras. The
 * decisive thing about them — and what this rework is for — is that they are
 * **not a simplified chassis**. The Gamemaster Guide is explicit:
 *
 *   "These supporting cast members receive the same number of stun, wound, fatigue,
 *    and mortal points as a hero with the same Constitution score, and they
 *    determine their action check score and actions per round normally."
 *
 * So an NPC is a hero the Gamemaster runs. Their skills live in
 * `AlternityCharacterState` exactly as a hero's do, which is why there is no skill
 * array here — adding one would fork the skill layer. What this model holds is the
 * statblock the Gamemaster Guide actually prints:
 *
 *   Durability: 9/9/5/5          <- stun/wound/mortal/fatigue, all from CON
 *   Action check: 12/6/3         <- Ordinary/Good/Amazing
 *   Move: sprint 22, run 16, walk 4
 *   #Actions: 2   Reaction score: Ordinary/2   Last resorts: 0
 *
 * The one genuinely different chassis in the book is the animal/alien creature
 * block — flat melee/ranged resistance instead of per-ability, natural armour, an
 * Animal Intelligence scale, no profession or gear. That is its own actor type.
 *
 * **What this rework removed.** Six fields were d20/generic scaffolding that appear
 * nowhere in the Alternity corpus: `cr` ("Challenge Rating"), `rewardXP`, `morale`,
 * `defenseBonus` (whose own comment read `10 + DEX modifier + armor`, an armor-class
 * formula — Alternity has no armor class), `isElite` and `attackBonus`. Searching
 * the whole corpus found zero occurrences of challenge rating, experience points or
 * morale as mechanics. `migrateData` below carries every one of them somewhere
 * meaningful rather than dropping them.
 */

import {
    AlternityMathService,
    PROFESSIONS,
    NPC_QUALITY_TIERS,
    SUPPORTING_CAST_ROLES,
    REACTION_DEGREES,
} from '../services/alternity-math.js';

const { fields } = foundry.data;

export { PROFESSIONS, NPC_QUALITY_TIERS, SUPPORTING_CAST_ROLES, REACTION_DEGREES };

/** Damage types, as printed in the third column of a statblock attack line. */
export const NPC_DAMAGE_TYPES = Object.freeze(['LI', 'HI', 'En']);

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

function moveField() {
    return new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 });
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

            // ── Who this is ──────────────────────────────────────────────
            /**
             * The four template tiers the Gamemaster Guide prints every supporting
             * character at. Marginal is not merely "weaker": the book defines
             * Marginal characters as nonprofessionals, so the tier suppresses the
             * profession action check bonus on its own.
             */
            quality: new fields.StringField({
                required: true, nullable: false, initial: 'Ordinary',
                choices: Object.keys(NPC_QUALITY_TIERS),
            }),

            profession: new fields.StringField({
                required: true, nullable: false, initial: 'Nonprofessional', choices: PROFESSIONS,
            }),

            /** Which of the book's five categories of supporting character this is. */
            role: new fields.StringField({
                required: true, nullable: false, initial: 'Extra', choices: SUPPORTING_CAST_ROLES,
            }),

            level: new fields.NumberField({
                required: true, nullable: false, integer: true, initial: 1, min: 0,
            }),

            /**
             * ── Durability ───────────────────────────────────────────────
             * Identical to a hero's, and derived from Constitution in
             * prepareDerivedData rather than typed in — the maxima below exist so
             * that token bars and the character-state sync have somewhere to live.
             * Printed in statblocks as a four-value run, e.g. `Durability: 9/9/5/5`.
             */
            durability: new fields.SchemaField({
                stun:    resourceSchema(0, 10),
                wound:   resourceSchema(0, 10),
                mortal:  resourceSchema(0, 5),
                fatigue: resourceSchema(0, 5),
            }),

            /**
             * Weren "Superior Durability" multiplies Constitution by 1.5 before the
             * halving, and several large creatures do the same. Kept here rather
             * than as a species flag so a Gamemaster can build an unusually tough
             * supporting cast member without inventing a species.
             */
            isSuperiorDurability: new fields.BooleanField({ required: true, initial: false }),

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

            // ── Action economy ───────────────────────────────────────────
            actionsPerRound: new fields.NumberField({
                required: true, nullable: false, integer: true, initial: 2, min: 1,
            }),

            /**
             * Overrides the profession bonus in the action check derivation when set.
             * The templates in the book mostly agree with the formula, but the book
             * also invites the Gamemaster to hand-tune them, so the escape hatch is
             * explicit rather than achieved by mangling an ability score.
             */
            actionCheckBonusOverride: new fields.NumberField({
                required: false, nullable: true, integer: true, initial: null,
            }),

            /**
             * The degree half of the reaction score. The number half derives from
             * actions per round; see `calculateReactionScore` for why only half of
             * this stat is recoverable from the scans.
             */
            reactionDegree: new fields.StringField({
                required: true, nullable: false, initial: 'Ordinary', choices: REACTION_DEGREES,
            }),

            // ── Movement ─────────────────────────────────────────────────
            // Same shape as CharacterData.combatMovement, because a supporting cast
            // member moves exactly as a hero does. Statblocks print only the rates
            // that apply, so zeroes are hidden on the sheet rather than shown.
            movement: new fields.SchemaField({
                sprint:   moveField(),
                run:      moveField(),
                walk:     moveField(),
                easySwim: moveField(),
                swim:     moveField(),
                glide:    moveField(),
                fly:      moveField(),
            }),

            /**
             * A flat step adjustment on top of the derived resistance modifier.
             * Replaces the old `defenseBonus`, which was an armor-class number.
             * Alternity has no armor class: defending applies a step penalty to the
             * attacker's check, so this adds to that penalty.
             */
            resistanceBonus: new fields.NumberField({
                required: true, nullable: false, integer: true, initial: 0,
            }),

            // ── Attacks ──────────────────────────────────────────────────
            // The statblock's attack table: `Bite 16/8/4 d4w/d6+1w/d6+3w LI/O`.
            // The score run is derived from its Ordinary value the same way every
            // other score run in the game is; the three damage entries are not
            // derivable from one another and are stored as printed.
            attacks: new fields.ArrayField(new fields.SchemaField({
                name:  new fields.StringField({ required: true, nullable: false, initial: '' }),
                score: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
                damageOrdinary: new fields.StringField({ required: false, initial: '' }),
                damageGood:     new fields.StringField({ required: false, initial: '' }),
                damageAmazing:  new fields.StringField({ required: false, initial: '' }),
                damageType: new fields.StringField({
                    required: true, nullable: false, initial: 'LI', choices: NPC_DAMAGE_TYPES,
                }),
                range: new fields.StringField({ required: false, initial: '' }),
                notes: new fields.StringField({ required: false, initial: '' }),
            }), { initial: [] }),

            // ── Gamemaster notes ─────────────────────────────────────────
            motivation: new fields.StringField({ required: false, initial: '' }),
            tactics:    new fields.HTMLField({ required: false, initial: '' }),
            biography:  new fields.HTMLField({ required: false, initial: '' }),

            // ── Initiative modifier (cached) ─────────────────────────────
            initiativeModifier: new fields.NumberField({
                required: true, nullable: false, integer: true, initial: 0,
            }),
        };
    }

    /** @override */
    prepareDerivedData() {
        const abilities = this.abilities ?? {};
        const con = abilities.con ?? 0;

        this.initiativeModifier = abilities.dex ?? 0;

        const WOUND_PENALTIES = {
            Healthy: 0, Stunned: 0, Wounded: 0,
            Bleeding: 0, Down: 2, Out: null,
        };
        this.woundPenalty    = WOUND_PENALTIES[this.woundLevel] ?? 0;
        this.isIncapacitated = this.woundLevel === 'Out';

        // ── Quality tier ────────────────────────────────────────────────
        const tier = NPC_QUALITY_TIERS[this.quality] ?? NPC_QUALITY_TIERS.Ordinary;
        this.qualityInfo = tier;

        // ── Durability, straight off Constitution ───────────────────────
        // "the same number of stun, wound, fatigue, and mortal points as a hero
        // with the same Constitution score."
        const ratings = AlternityMathService.calculateDurabilityRatings(con, {
            isWeren: this.isSuperiorDurability,
        });
        for (const track of ['stun', 'wound', 'mortal', 'fatigue']) {
            this.durability[track].max = ratings[track];
        }
        this.durabilityRun = `${ratings.stun}/${ratings.wound}/${ratings.mortal}/${ratings.fatigue}`;

        // ── Action check ────────────────────────────────────────────────
        this.actionCheck = AlternityMathService.calculateActionCheckScore(
            abilities.dex ?? 0, abilities.int ?? 0,
            {
                profession: this.profession,
                // A Marginal supporting cast member is a nonprofessional by
                // definition, whatever profession label the template carries.
                isNonprofessional: tier.isNonprofessional,
                bonus: this.actionCheckBonusOverride,
            }
        );

        this.reactionScore = AlternityMathService.calculateReactionScore(
            this.actionsPerRound, { degree: this.reactionDegree }
        );

        // ── Resistance ──────────────────────────────────────────────────
        // Alternity has no armor-class number — defending applies a step penalty to
        // the attacker's check — so this is DEX's resistance modifier plus any flat
        // adjustment. AlternityActor._prepareNpcData() recomputes it once the
        // document layer runs and armour items are visible.
        this.resistanceModifier = AlternityMathService.calculateResistanceModifier(
            abilities.dex ?? 0, 'DEX'
        ) + (this.resistanceBonus ?? 0);

        // ── Attacks ─────────────────────────────────────────────────────
        this.attackRows = (this.attacks ?? []).map((row, index) => {
            const score = row.score ?? 0;
            return {
                ...row,
                index,
                scoreRun: `${score}/${Math.floor(score / 2)}/${Math.floor(score / 4)}`,
                damageRun: [row.damageOrdinary, row.damageGood, row.damageAmazing]
                    .filter(Boolean).join('/'),
            };
        });

        // Only the rates the statblock would actually print.
        this.movementRates = Object.entries(this.movement ?? {})
            .filter(([, value]) => value > 0)
            .map(([key, value]) => ({ key, value }));
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

        // ── Retiring the six non-canonical fields ────────────────────────
        // Every one of these carries somewhere meaningful rather than being
        // dropped, because a Gamemaster may have real numbers typed into them.

        // Challenge Rating mapped onto the book's own quality tiers, which is what
        // it was standing in for.
        if (source.cr && !source.quality) {
            source.quality = {
                Easy: 'Marginal', Average: 'Ordinary',
                Tough: 'Good', Overwhelming: 'Amazing',
            }[source.cr] ?? 'Ordinary';
        }
        delete source.cr;

        // An armor-class bonus becomes a step adjustment to the resistance modifier.
        if (source.defenseBonus !== undefined && source.resistanceBonus === undefined) {
            source.resistanceBonus = source.defenseBonus;
        }
        delete source.defenseBonus;

        // Elite granted one extra action per round; that is a real effect, so keep it.
        if (source.isElite) {
            source.actionsPerRound = (source.actionsPerRound ?? 2) + 1;
        }
        delete source.isElite;

        // A flat attack bonus and damage formula are exactly one row of the
        // statblock's attack table, so they become one.
        const hasAttack = source.attackBonus || (source.damageFormula && source.damageFormula !== '1d6');
        if (hasAttack && !source.attacks?.length) {
            source.attacks = [{
                name: 'Attack',
                score: source.attackBonus ?? 0,
                damageOrdinary: source.damageFormula ?? '',
                damageGood: '', damageAmazing: '',
                damageType: 'LI', range: '',
                notes: 'Migrated from the previous attack bonus and damage formula.',
            }];
        }
        delete source.attackBonus;
        delete source.damageFormula;

        // Morale and reward XP have no Alternity equivalent at all, so they are
        // preserved as prose in the tactics notes instead of being invented into
        // some other stat.
        const orphans = [];
        if (source.morale !== undefined && source.morale !== 50) orphans.push(`Morale ${source.morale}`);
        if (source.rewardXP !== undefined && source.rewardXP !== 100) orphans.push(`Reward XP ${source.rewardXP}`);
        if (orphans.length) {
            source.tactics = `${source.tactics ?? ''}<p><em>Retired fields: ${orphans.join(', ')}.</em></p>`;
        }
        delete source.morale;
        delete source.rewardXP;

        return super.migrateData(source);
    }
}
