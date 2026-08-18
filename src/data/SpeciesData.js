/**
 * @file SpeciesData.js
 * @description TypeDataModel: Schema for the 'species' Item type.
 *
 * A hero's species is the one part of character creation that keeps changing numbers
 * after creation is over. It sets the ability score range each score may be bought
 * within, multiplies Constitution on the way to the durability tracks, multiplies
 * Willpower on the way to psionic energy, and shifts the action check die. Holding
 * that as a *string* on the actor - which is what `details.species` and
 * `AlternityCharacterState.species` were - meant none of it could be read back, so the
 * only species rule the system actually applied was found by asking whether the name
 * contained the word "weren".
 *
 * That test was wrong twice over: it missed the Sasquatch, which carries the same
 * `DurMult` of 1.5, and it would have fired on a hero named "Weren-touched". Every
 * species in the data set carries the same fields; there was simply nowhere to put
 * them. This is that place.
 *
 * Species is an Item rather than a field on the actor so that a Gamemaster can add one
 * - homebrew or from a supplement this system does not ship - without a code change,
 * and so the eighteen the compendium carries are droppable like anything else. An
 * actor is expected to hold at most one; `src/index.js` enforces that on create.
 */

const { fields } = foundry.data;

/** The six abilities, in the order the books print them. */
export const SPECIES_ABILITIES = Object.freeze(['STR', 'DEX', 'CON', 'INT', 'WIL', 'PER']);

/**
 * What a special ability does mechanically, for the ones that do anything.
 *
 * Deliberately short: it lists only what something in this system actually reads. Most
 * species abilities are prose a Gamemaster adjudicates ("do not suffer impact damage if
 * conscious and can use wings"), and inventing enum members for those would produce a
 * schema that promises mechanics no code delivers.
 *
 * `AttacksAgainstMe` is read by `AlternityRollService.collectTargetModifiers`, which is
 * where a defender's properties already enter an attacker's check - Alternity has no
 * armour class, so "harder to hit" is always a step penalty on the attacker.
 */
export const SPECIES_EFFECT_TARGETS = Object.freeze([
    'None',
    'AttacksAgainstMe',
]);

/** Which attacks an `AttacksAgainstMe` modifier applies to. */
export const SPECIES_ATTACK_KINDS = Object.freeze(['Any', 'Melee', 'Ranged']);

/**
 * Pull the step modifiers a species imposes on attacks aimed at its owner.
 *
 * Exported as a function over raw system data rather than as a method so the roll
 * service can call it against a target actor's item without caring whether the
 * TypeDataModel was instantiated - `collectTargetModifiers` runs against whatever
 * `game.user.targets` holds, which on an unlinked token is not always a prepared
 * document.
 *
 * @param {object} system - A species item's `system` data.
 * @param {string} [attackKind='ranged'] - 'melee' | 'ranged'.
 * @returns {Array<{name: string, value: number}>}
 */
export function speciesDefenseModifiers(system, attackKind = 'ranged') {
    const kind = String(attackKind).toLowerCase();
    return (system?.specialAbilities ?? [])
        .filter(ability => ability?.effectTarget === 'AttacksAgainstMe' && ability?.effectValue)
        .filter(ability => {
            const applies = String(ability.attackKind ?? 'Any').toLowerCase();
            return applies === 'any' || applies === kind;
        })
        .map(ability => ({ name: ability.name, value: Number(ability.effectValue) }));
}

export class SpeciesData extends foundry.abstract.TypeDataModel {

    /** @override */
    static defineSchema() {
        /**
         * One ability's buy range. 4-14 is the human span, and the default here
         * because a hand-made species with nothing entered should behave like a human
         * rather than pin every score to the same number.
         *
         * The bounds are 1 and 20 rather than 4 and 14 because the printed ranges
         * already leave that span in both directions: the Weren buys Strength up to
         * 16, and the Sandman's Willpower starts at 2.
         */
        const abilityRange = () => new fields.SchemaField({
            min: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 4, min: 1, max: 20 }),
            max: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 14, min: 1, max: 20 }),
        });

        return {
            // ── Ability score ranges ─────────────────────────────────────
            abilityRanges: new fields.SchemaField(
                Object.fromEntries(SPECIES_ABILITIES.map(ability => [ability, abilityRange()]))
            ),

            // ── Character creation bonuses ───────────────────────────────
            // Humans, and only humans, get both of these: 5 extra skill points and
            // one extra broad skill.
            bonusSkillPoints: new fields.NumberField({
                required: true, nullable: false, integer: true, initial: 0, min: 0,
            }),
            bonusBroadSkills: new fields.NumberField({
                required: true, nullable: false, integer: true, initial: 0, min: 0,
            }),

            // ── Derivation multipliers ───────────────────────────────────
            /**
             * Constitution is multiplied by this before the durability tracks are
             * figured (Weren "Superior Durability": CON x 1.5, rounded down). It has
             * to land *before* the mortal/fatigue halving, not on each of the four
             * results, which is why the multiplier travels rather than the ratings.
             */
            durabilityMultiplier: new fields.NumberField({
                required: true, nullable: false, initial: 1, min: 0.25, max: 4,
            }),

            /** Willpower is multiplied by this for psionic energy points (Fraal, Grey: x1.5). */
            psionicMultiplier: new fields.NumberField({
                required: true, nullable: false, initial: 1, min: 0.25, max: 4,
            }),

            /**
             * A shift on the action check die, in this codebase's usual convention:
             * negative is a bonus. The T'sa's "base die is -d4" is -1.
             */
            actionCheckStep: new fields.NumberField({
                required: true, nullable: false, integer: true, initial: 0, min: -4, max: 4,
            }),

            // ── Traits ───────────────────────────────────────────────────
            /** Whether members may learn psionic skills without the Psionic Talent perk. */
            isPsionic: new fields.BooleanField({ required: true, initial: false }),
            canGlide:  new fields.BooleanField({ required: true, initial: false }),
            canFly:    new fields.BooleanField({ required: true, initial: false }),

            /**
             * Natural armour, as the books print it - a die expression per damage
             * form, such as the T'sa's "d4+1 (LI), d4 (HI), d4-1 (En)". Free text for
             * the same reason `CreatureData.naturalArmor` is: those are not dice
             * Foundry could roll unaided, and the damage pipeline reads them with
             * `AlternityMathService.parseArmorValue`.
             */
            naturalArmor: new fields.SchemaField({
                li: new fields.StringField({ required: false, initial: '' }),
                hi: new fields.StringField({ required: false, initial: '' }),
                en: new fields.StringField({ required: false, initial: '' }),
            }),

            /**
             * Skills every member has for free at rank 0, by printed name.
             *
             * Names, not slugs: the compendium's species come from a data set whose
             * skill ids are its own, and several of its skills have no counterpart in
             * `SKILL_DEFINITIONS`. A name a Gamemaster can read beats a slug that
             * resolves to nothing.
             */
            freeSkills: new fields.ArrayField(
                new fields.StringField({ required: true, nullable: false }),
                { required: false, initial: [] }
            ),

            /**
             * The species' special abilities, one entry each.
             *
             * `description` is the whole printed note and is always populated;
             * `effectTarget` is filled in only where the note states something this
             * system can apply on its own.
             */
            specialAbilities: new fields.ArrayField(new fields.SchemaField({
                name:        new fields.StringField({ required: true, nullable: false, initial: '' }),
                description: new fields.StringField({ required: false, initial: '' }),
                effectTarget: new fields.StringField({
                    required: true, nullable: false, initial: 'None', choices: [...SPECIES_EFFECT_TARGETS],
                }),
                // Positive is a penalty on whoever the effect lands on, matching every
                // other step modifier in this codebase.
                effectValue: new fields.NumberField({
                    required: true, nullable: false, integer: true, initial: 0,
                }),
                attackKind: new fields.StringField({
                    required: true, nullable: false, initial: 'Any', choices: [...SPECIES_ATTACK_KINDS],
                }),
            }), { required: false, initial: [] }),

            // ── Flavour / rules text ─────────────────────────────────────
            description: new fields.HTMLField({ required: false, initial: '' }),
        };
    }

    /** @override */
    prepareDerivedData() {
        // ── Ability ranges ───────────────────────────────────────────────
        this.abilityRangeDisplay = Object.fromEntries(SPECIES_ABILITIES.map(ability => {
            const range = this.abilityRanges?.[ability] ?? {};
            return [ability, `${range.min ?? 4}–${range.max ?? 14}`];
        }));

        // ── Multipliers ──────────────────────────────────────────────────
        this.hasDurabilityBonus = this.durabilityMultiplier !== 1;
        this.hasPsionicBonus    = this.psionicMultiplier !== 1;
        this.hasFlight          = this.canFly || this.canGlide;

        this.hasNaturalArmor = !!(this.naturalArmor?.li || this.naturalArmor?.hi || this.naturalArmor?.en);
        this.naturalArmorDisplay = this.hasNaturalArmor
            ? [
                this.naturalArmor.li ? `${this.naturalArmor.li} (LI)` : '',
                this.naturalArmor.hi ? `${this.naturalArmor.hi} (HI)` : '',
                this.naturalArmor.en ? `${this.naturalArmor.en} (En)` : '',
            ].filter(Boolean).join(', ')
            : '';

        // ── Summary line ─────────────────────────────────────────────────
        // What the sheet shows above the fold, and the same set the compendium
        // renders into each entry's description.
        const signed = (value) => `${value > 0 ? '+' : ''}${value}`;
        this.traits = [
            this.bonusSkillPoints ? `${this.bonusSkillPoints} bonus skill points` : '',
            this.bonusBroadSkills ? `${this.bonusBroadSkills} extra broad skill` : '',
            this.hasDurabilityBonus ? `Durability from CON × ${this.durabilityMultiplier}` : '',
            this.hasPsionicBonus ? `Psionic energy from WIL × ${this.psionicMultiplier}` : '',
            this.actionCheckStep ? `Action check ${signed(this.actionCheckStep)} step` : '',
            this.isPsionic ? 'Psionically active' : '',
            this.canFly ? 'Can fly' : '',
            this.canGlide && !this.canFly ? 'Can glide' : '',
            this.hasNaturalArmor ? `Natural armour ${this.naturalArmorDisplay}` : '',
        ].filter(Boolean);

        // ── Mechanical special abilities ─────────────────────────────────
        this.mechanicalAbilities = (this.specialAbilities ?? [])
            .filter(ability => ability.effectTarget !== 'None' && ability.effectValue);
        this.hasMechanicalAbilities = this.mechanicalAbilities.length > 0;
    }

    /**
     * Clamp an ability score into this species' printed buy range.
     *
     * The state used to clamp every score to 4-14 regardless of species, which put
     * the Weren's Strength maximum of 16 and the Sandman's Willpower minimum of 2 out
     * of reach and silently rewrote them on the way in.
     *
     * @param {string} ability - One of SPECIES_ABILITIES.
     * @param {number} score
     * @returns {number}
     */
    clampAbility(ability, score) {
        const range = this.abilityRanges?.[ability];
        const min = range?.min ?? 4;
        const max = range?.max ?? 14;
        return Math.min(max, Math.max(min, Math.round(Number(score))));
    }

    /**
     * Step modifiers this species imposes on attacks aimed at its owner.
     * @param {string} [attackKind='ranged'] - 'melee' | 'ranged'.
     */
    defenseModifiers(attackKind = 'ranged') {
        return speciesDefenseModifiers(this, attackKind);
    }
}
