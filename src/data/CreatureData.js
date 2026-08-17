/**
 * @file CreatureData.js
 * @description TypeDataModel: Schema for the 'creature' Actor type.
 *
 * Source: Gamemaster Guide Ch.19 (Animal & Alien Statistics) and the Animal
 * Compendium that follows it.
 *
 * This is the one chassis in the whole corpus that genuinely is not a hero, which
 * is why it is its own actor type rather than a mode of the supporting cast. The
 * book is explicit that it does not obey its own derivations:
 *
 *   "However, they don't always 'play by the rules' in terms of statistics that are
 *    derived from other statistics. ... some numbers are purposely modified to yield
 *    a clearer picture of what a certain type of creature is."
 *
 * So this model is a transcription surface first and a calculator second. What it
 * derives is only what the printed statblocks actually agree on.
 *
 * Five things set a creature apart from a supporting cast member:
 *
 *   1. **Ability scores come with a range.** Every score is printed as a typical
 *      value plus a die expression — `STR 16 (d6+12)` — so a Gamemaster can roll an
 *      individual off the species average. The formula is stored as text beside the
 *      score, not parsed.
 *   2. **Intelligence and Personality run on two scales at once.** `INT 3 (Animal 11
 *      or d4+9)` means a real Intelligence of 3, and an *Animal* Intelligence of 11
 *      used for anything a creature of its kind could plausibly attempt. "No dog is
 *      as intelligent as a human", but a dog negotiates a maze better than the score
 *      3 suggests.
 *   3. **Resistance is flat, not per-ability.** A creature prints one modifier
 *      against melee and one against ranged attacks, and either may be absent —
 *      "no resistance modifier vs. ranged attacks" is a printed value, distinct
 *      from a modifier of 0 in the sense that nothing is being resisted at all.
 *   4. **Natural armour** is quoted as a die expression per damage type:
 *      `Armor: d6 (LI), d4-1 (HI), d6-1 (En)`.
 *   5. **Skills are absolute scores, not ranks.** `Athletics [16]-climb [18]` is a
 *      score of 16 and 18, and creatures "can't learn new skills or improve their
 *      scores in existing skills" — so there is no rank, no cost and no budget.
 *
 * Deliberately absent, because a creature has none of them: profession, quality
 * tier, achievement level, last resort points, perks and flaws, and carried gear.
 */

import {
    AlternityMathService,
    CREATURE_CATEGORIES,
    DAMAGE_TYPES,
    REACTION_DEGREES,
    PERSONAL_TOUGHNESS_CLASSES,
    DEFAULT_PERSONAL_TOUGHNESS,
} from '../services/alternity-math.js';

const { fields } = foundry.data;

export { CREATURE_CATEGORIES, DAMAGE_TYPES, REACTION_DEGREES };

/** The six abilities, lowercased to match CharacterData and NpcData. */
export const CREATURE_ABILITIES = Object.freeze(['str', 'dex', 'con', 'int', 'wil', 'per']);

/** Abilities that carry a second, species-relative scale. */
export const ANIMAL_SCALE_ABILITIES = Object.freeze(['int', 'per']);

function abilityField(initial = 10) {
    return new fields.NumberField({
        required: true, nullable: false, integer: true, initial, min: 0, max: 40,
    });
}

function resourceSchema(currentDefault, maxDefault) {
    return new fields.SchemaField({
        value: new fields.NumberField({ required: true, nullable: false, integer: true, initial: currentDefault, min: 0 }),
        max:   new fields.NumberField({ required: true, nullable: false, integer: true, initial: maxDefault, min: 0 }),
    });
}

function moveField() {
    return new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 });
}

export class CreatureData extends foundry.abstract.TypeDataModel {

    /** @override */
    static defineSchema() {
        return {
            // ── Identity ─────────────────────────────────────────────────────
            category: new fields.StringField({
                required: true, nullable: false, initial: 'Animal', choices: CREATURE_CATEGORIES,
            }),

            /** Free text: "a large brown bear, or possibly a small grizzly". */
            species: new fields.StringField({ required: false, initial: '' }),

            /** Creatures are not built to a Progress Level, but aliens may be found at one. */
            progressLevel: new fields.NumberField({
                required: false, nullable: true, integer: true, initial: null, min: 0, max: 9,
            }),

            // ── Abilities ────────────────────────────────────────────────────
            abilities: new fields.SchemaField(Object.fromEntries(
                CREATURE_ABILITIES.map((key) => [key, abilityField()])
            )),

            /**
             * The die expression printed beside each score, e.g. `d6+12`. Kept as
             * text and never parsed: it exists so a Gamemaster can roll an individual
             * off the species average, and the compendium prints forms as varied as
             * `2d4+17` and `Animal 10 or d4+8`.
             */
            abilityRanges: new fields.SchemaField(Object.fromEntries(
                CREATURE_ABILITIES.map((key) => [key, new fields.StringField({ required: false, initial: '' })])
            )),

            /**
             * The Animal-scale Intelligence and Personality. Zero means "not on the
             * animal scale" — a sentient alien uses its real scores for everything.
             */
            animalScale: new fields.SchemaField({
                int: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0, max: 40 }),
                per: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0, max: 40 }),
            }),

            // ── Durability ───────────────────────────────────────────────────
            /**
             * Large creatures carry a flat multiplier on every rating. 1.5 reproduces
             * the bear, buffalo and elephant exactly; everything else in the
             * compendium sits at 1.
             */
            durabilityMultiplier: new fields.NumberField({
                required: true, nullable: false, integer: false, initial: 1, min: 0.1,
            }),

            damage: new fields.SchemaField({
                stun:    resourceSchema(0, 10),
                wound:   resourceSchema(0, 10),
                mortal:  resourceSchema(0, 5),
                fatigue: resourceSchema(0, 5),
            }),

            woundLevel: new fields.StringField({
                required: true, nullable: false, initial: 'Healthy',
                choices: ['Healthy', 'Stunned', 'Wounded', 'Bleeding', 'Down', 'Out'],
            }),

            // ── Action economy (entered, not derived) ────────────────────────
            /**
             * The Ordinary action check value. Entered rather than derived, because
             * the book says outright that creature statistics are "purposely
             * modified" — the dog's DEX 11 and INT 3 would give 7, and it prints 13.
             * The Good and Amazing thresholds do follow the normal halve-and-quarter
             * rule in every printed entry, so those are derived from this.
             */
            actionCheckScore: new fields.NumberField({
                required: true, nullable: false, integer: true, initial: 8, min: 0,
            }),

            actionsPerRound: new fields.NumberField({
                required: true, nullable: false, integer: true, initial: 2, min: 1,
            }),

            reactionDegree: new fields.StringField({
                required: true, nullable: false, initial: 'Ordinary', choices: REACTION_DEGREES,
            }),

            /**
             * Some creatures print a second reaction score for a specific manoeuvre —
             * the buffalo's "Reaction score: Marginal/1 (Charge: Good/1)".
             */
            reactionNote: new fields.StringField({ required: false, initial: '' }),

            // ── Movement ─────────────────────────────────────────────────────
            movement: new fields.SchemaField({
                sprint:   moveField(),
                run:      moveField(),
                walk:     moveField(),
                crawl:    moveField(),
                easySwim: moveField(),
                swim:     moveField(),
                glide:    moveField(),
                fly:      moveField(),
            }),

            // ── Defenses ─────────────────────────────────────────────────────
            /**
             * Flat resistance modifiers, replacing the per-ability ones a hero uses.
             * Nullable on purpose: the compendium distinguishes "+1 resistance
             * modifier vs. ranged attacks" from "no resistance modifier vs. ranged
             * attacks", and null renders as the latter.
             */
            resistance: new fields.SchemaField({
                melee:  new fields.NumberField({ required: false, nullable: true, integer: true, initial: null }),
                ranged: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null }),
            }),

            /**
             * The toughness the statblock prints — "Good toughness" appears on its
             * own line above the resistance modifiers on the larger creatures. A
             * weapon whose firepower falls short of it has its damage degraded a
             * grade before natural armour is even rolled (GM Guide Ch.11, which
             * extends the rule to creatures explicitly: "an alien might have Good
             * toughness, downgrading Ordinary firepower used against it").
             */
            toughness: new fields.StringField({
                required: true,
                nullable: false,
                initial:  DEFAULT_PERSONAL_TOUGHNESS,
                choices:  PERSONAL_TOUGHNESS_CLASSES,
            }),

            /**
             * Natural armour, one die expression per damage type. Free text because
             * the printed values include forms like `d4-2` and `none` that are not
             * dice formulas Foundry could roll unaided.
             */
            naturalArmor: new fields.SchemaField({
                li: new fields.StringField({ required: false, initial: '' }),
                hi: new fields.StringField({ required: false, initial: '' }),
                en: new fields.StringField({ required: false, initial: '' }),
            }),

            // ── Attacks ──────────────────────────────────────────────────────
            // `Bite 16/8/4 d4w/d6+1w/d6+3w LI/O` — one score, three damage entries.
            attacks: new fields.ArrayField(new fields.SchemaField({
                name:  new fields.StringField({ required: true, nullable: false, initial: '' }),
                score: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
                damageOrdinary: new fields.StringField({ required: false, initial: '' }),
                damageGood:     new fields.StringField({ required: false, initial: '' }),
                damageAmazing:  new fields.StringField({ required: false, initial: '' }),
                damageType: new fields.StringField({
                    required: true, nullable: false, initial: 'LI', choices: DAMAGE_TYPES,
                }),
                /**
                 * The second half of the printed type code — the `O` in `LI/O`. Every
                 * creature attack in the compendium prints `O`; the code is carried
                 * through verbatim rather than guessed at.
                 */
                mode:  new fields.StringField({ required: false, initial: 'O' }),
                notes: new fields.StringField({ required: false, initial: '' }),
            }), { initial: [] }),

            // ── Skills ───────────────────────────────────────────────────────
            /**
             * Absolute scores, not ranks: `Athletics [16]-climb [18]`. A creature
             * "can't learn new skills or improve their scores in existing skills", so
             * there is no rank, no point cost and no budget to check. Specialties are
             * flagged rather than nested, and render indented under the broad skill
             * they follow.
             */
            skills: new fields.ArrayField(new fields.SchemaField({
                name:  new fields.StringField({ required: true, nullable: false, initial: '' }),
                score: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
                isSpecialty: new fields.BooleanField({ required: true, initial: false }),
            }), { initial: [] }),

            // ── Free text ────────────────────────────────────────────────────
            /** "Few animals fight to the death" — how this one actually behaves. */
            behaviour:   new fields.HTMLField({ required: false, initial: '' }),
            description: new fields.HTMLField({ required: false, initial: '' }),
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

        // ── Durability ──────────────────────────────────────────────────────
        const ratings = AlternityMathService.calculateCreatureDurability(con, {
            multiplier: this.durabilityMultiplier,
        });
        this.durability = {
            stun:    { value: this.damage?.stun?.value ?? 0,    max: ratings.stun },
            wound:   { value: this.damage?.wound?.value ?? 0,   max: ratings.wound },
            mortal:  { value: this.damage?.mortal?.value ?? 0,  max: ratings.mortal },
            fatigue: { value: this.damage?.fatigue?.value ?? 0, max: ratings.fatigue },
        };
        this.durabilityRun = ratings.run;
        this.hasDurabilityMultiplier = ratings.multiplier !== 1;

        // ── Action check and reaction ───────────────────────────────────────
        const run = AlternityMathService.calculateScoreRun(this.actionCheckScore);
        this.actionCheck = {
            marginal: run.ordinary + 1,
            ordinary: run.ordinary,
            good:     run.good,
            amazing:  run.amazing,
        };
        // What the hero formula would have said, purely so the sheet can show how
        // far this creature has been hand-tuned away from it. Never used as a value.
        this.derivedActionCheck = AlternityMathService.calculateActionCheckScore(
            abilities.dex ?? 0, abilities.int ?? 0, { isNonprofessional: true }
        ).ordinary;
        this.actionCheckIsTuned = this.derivedActionCheck !== run.ordinary;

        this.reactionScore = AlternityMathService.calculateReactionScore(
            this.actionsPerRound, { degree: this.reactionDegree }
        );

        // ── Animal scale ────────────────────────────────────────────────────
        // A score of 0 means this creature is not on the animal scale at all, which
        // is the normal case for a sentient alien.
        this.isAnimalScaled = ANIMAL_SCALE_ABILITIES
            .some((key) => (this.animalScale?.[key] ?? 0) > 0);

        // ── Attacks ─────────────────────────────────────────────────────────
        this.attackRows = (this.attacks ?? []).map((row, index) => ({
            ...row,
            index,
            scoreRun: AlternityMathService.calculateScoreRun(row.score).label,
            damageRun: [row.damageOrdinary, row.damageGood, row.damageAmazing]
                .filter(Boolean).join('/'),
            typeCode: row.mode ? `${row.damageType}/${row.mode}` : row.damageType,
        }));

        // ── Skills ──────────────────────────────────────────────────────────
        // `scoreRun` is added so a skill row reads the same way an attack row does:
        // the sheet displays the triple, and its roll button parses it back.
        this.skillRows = (this.skills ?? []).map((row, index) => ({
            ...row,
            index,
            scoreRun: AlternityMathService.calculateScoreRun(row.score ?? 0).label,
        }));

        // Only the rates a statblock would actually print.
        this.movementRates = Object.entries(this.movement ?? {})
            .filter(([, value]) => value > 0)
            .map(([key, value]) => ({ key, value }));

        // ── Status ──────────────────────────────────────────────────────────
        if (ratings.mortal > 0 && (this.damage?.mortal?.value ?? 0) >= ratings.mortal) {
            this.status = 'Dead';
        } else if ((this.damage?.wound?.value ?? 0) >= ratings.wound) {
            this.status = 'Disabled';
        } else if ((this.damage?.stun?.value ?? 0) >= ratings.stun) {
            this.status = 'Unconscious';
        } else if ((this.damage?.wound?.value ?? 0) > 0) {
            // "Once an animal suffers substantial wound damage ... it's likely to
            // break off the fight and move away."
            this.status = 'Wounded';
        } else {
            this.status = 'Unharmed';
        }
    }

    /** @override */
    static migrateData(source) {
        return super.migrateData(source);
    }
}
