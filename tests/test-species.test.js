/**
 * @file tests/test-species.test.js
 * @description The `species` Item type and what it changes on a hero.
 *
 * Species used to be a string, and the only rule the system applied from it was found
 * by asking whether that string contained "weren". These tests pin the two things that
 * replaced it: the schema that holds a species' numbers, and the state method that
 * copies them onto a hero when the Item is dropped.
 *
 * The compendium's own eighteen species are checked separately, against the source
 * files, in `test-pack-source.test.js`.
 */

import { SpeciesData, speciesDefenseModifiers, SPECIES_ABILITIES } from '../src/data/SpeciesData.js';
import { AlternityCharacterState } from '../src/data/alternity-actor-data.js';

/** The Weren as the compendium builds it, trimmed to what these tests read. */
const WEREN = {
    durabilityMultiplier: 1.5,
    psionicMultiplier: 1,
    abilityRanges: {
        STR: { min: 9, max: 16 }, DEX: { min: 4, max: 12 }, CON: { min: 8, max: 16 },
        INT: { min: 4, max: 13 }, WIL: { min: 4, max: 12 }, PER: { min: 4, max: 12 },
    },
    specialAbilities: [
        {
            name: 'Weren Camouflage',
            description: 'Weren Camouflage: +1 step to ranged attacks vs. weren',
            effectTarget: 'AttacksAgainstMe', effectValue: 1, attackKind: 'Ranged',
        },
        {
            name: 'Weren Superior Durability',
            description: 'Weren Superior Durability: CON x 1.5 for durability scores',
            effectTarget: 'None', effectValue: 0, attackKind: 'Any',
        },
    ],
};

/** The Fraal: no durability bonus, energy at WIL x1.5, a much narrower Strength. */
const FRAAL = {
    durabilityMultiplier: 1,
    psionicMultiplier: 1.5,
    abilityRanges: {
        STR: { min: 4, max: 11 }, DEX: { min: 4, max: 11 }, CON: { min: 4, max: 10 },
        INT: { min: 9, max: 15 }, WIL: { min: 9, max: 16 }, PER: { min: 4, max: 15 },
    },
    specialAbilities: [],
};

describe('SpeciesData', () => {

    test('declares a field for every number a species carries', () => {
        const schema = SpeciesData.defineSchema();
        for (const key of [
            'abilityRanges', 'bonusSkillPoints', 'bonusBroadSkills', 'durabilityMultiplier',
            'psionicMultiplier', 'actionCheckStep', 'isPsionic', 'canGlide', 'canFly',
            'naturalArmor', 'freeSkills', 'specialAbilities', 'description',
        ]) {
            expect(schema[key]).toBeDefined();
        }
    });

    test('names the six abilities in the order the books print them', () => {
        expect(SPECIES_ABILITIES).toEqual(['STR', 'DEX', 'CON', 'INT', 'WIL', 'PER']);
    });

    describe('speciesDefenseModifiers', () => {

        test('reports a ranged-only ability against a shot', () => {
            expect(speciesDefenseModifiers(WEREN, 'ranged'))
                .toEqual([{ name: 'Weren Camouflage', value: 1 }]);
        });

        test('withholds it from a melee attack', () => {
            expect(speciesDefenseModifiers(WEREN, 'melee')).toEqual([]);
        });

        test('reports an Any ability against either kind', () => {
            const species = {
                specialAbilities: [{
                    name: 'Hard to see', effectTarget: 'AttacksAgainstMe',
                    effectValue: 2, attackKind: 'Any',
                }],
            };
            expect(speciesDefenseModifiers(species, 'melee')).toHaveLength(1);
            expect(speciesDefenseModifiers(species, 'ranged')).toHaveLength(1);
        });

        test('ignores prose abilities, which are most of them', () => {
            expect(speciesDefenseModifiers(FRAAL, 'ranged')).toEqual([]);
            expect(speciesDefenseModifiers({
                specialAbilities: [{ name: 'Night Vision', effectTarget: 'None', effectValue: 0 }],
            }, 'ranged')).toEqual([]);
        });

        test('survives a species with no abilities at all', () => {
            expect(speciesDefenseModifiers({}, 'ranged')).toEqual([]);
            expect(speciesDefenseModifiers(undefined, 'ranged')).toEqual([]);
        });
    });
});

describe('AlternityCharacterState species integration', () => {

    const heroWith = (overrides = {}) => new AlternityCharacterState({
        actorId: 'species-test', abilityScores: { CON: 10, WIL: 12 }, ...overrides,
    });

    test('a hero with no species derives durability straight off Constitution', () => {
        const state = heroWith();
        expect(state.durabilityMultiplier).toBe(1);
        expect([state.durability.stunMax, state.durability.mortalMax]).toEqual([10, 5]);
    });

    test('applying a species multiplies Constitution before the halving', () => {
        const state = heroWith().applySpecies('Weren', WEREN);
        // CON 10 -> 15 -> 15/15/8/8. Halving first would give 8 from a base of 10.
        expect([
            state.durability.stunMax, state.durability.woundMax,
            state.durability.mortalMax, state.durability.fatigueMax,
        ]).toEqual([15, 15, 8, 8]);
    });

    test('applying a species multiplies Willpower for psionic energy', () => {
        const state = heroWith().applySpecies('Fraal', FRAAL);
        expect(state.psionics.energy.max).toBe(18); // WIL 12 x 1.5
        expect(state.durability.stunMax).toBe(10);  // and leaves durability alone
    });

    /**
     * The bug the name test could not have caught. The Sasquatch prints the same CON
     * x1.5 as the Weren and has never had it applied, because its name does not
     * contain the word the derivation was looking for.
     */
    test('applies the multiplier to a species whose name says nothing about it', () => {
        const state = heroWith().applySpecies('Sasquatch', { ...WEREN, specialAbilities: [] });
        expect(state.durability.stunMax).toBe(15);
    });

    test('re-clamps ability scores the new species cannot admit', () => {
        const state = heroWith({ abilityScores: { STR: 16, CON: 10, WIL: 12 } });
        expect(state.applySpecies('Weren', WEREN).abilityScores.STR).toBe(16);
        // A Fraal buys Strength no higher than 11.
        expect(state.applySpecies('Fraal', FRAAL).abilityScores.STR).toBe(11);
        // ...and Willpower no lower than 9, so a score under the floor is raised.
        expect(state.applySpecies('Fraal', FRAAL).abilityScores.WIL).toBe(12);
    });

    test('clamps an edited score to the species range, not to a flat 4-14', () => {
        const state = heroWith().applySpecies('Weren', WEREN);
        // 16 used to be unreachable: everything above 14 was silently rewritten.
        expect(state.setAbilityScore('STR', 16).abilityScores.STR).toBe(16);
        expect(state.setAbilityScore('STR', 20).abilityScores.STR).toBe(16);
        // The species floor holds too — a Weren does not have Strength 4.
        expect(state.setAbilityScore('STR', 4).abilityScores.STR).toBe(9);
    });

    test('recomputes both maxima when the ability that feeds them changes', () => {
        const state = heroWith().applySpecies('Weren', WEREN);
        state.setAbilityScore('CON', 12);
        expect(state.durability.stunMax).toBe(18); // 12 x 1.5
        state.setAbilityScore('WIL', 10);
        expect(state.psionics.energy.max).toBe(10); // x1 for a Weren
    });

    test('removing the species drops back to the unmultiplied derivation', () => {
        const state = heroWith().applySpecies('Weren', WEREN);
        state.clearSpecies();
        expect(state.durabilityMultiplier).toBe(1);
        expect(state.durability.stunMax).toBe(10);
        // The name stays: deleting the Item is not a claim the hero stopped being one.
        expect(state.species).toBe('Weren');
    });

    test('round-trips the species numbers through serialize', () => {
        const state = heroWith().applySpecies('Weren', WEREN);
        const restored = AlternityCharacterState.deserialize(state.serialize());
        expect(restored.durabilityMultiplier).toBe(1.5);
        expect(restored.psionicMultiplier).toBe(1);
        expect(restored.abilityRange('STR')).toEqual({ min: 9, max: 16 });
        expect(restored.durability.stunMax).toBe(15);
    });

    describe('states saved before the species Item type existed', () => {

        test('still give a hero named Weren their multiplier', () => {
            const legacy = heroWith({ species: 'Weren' });
            expect(legacy.durabilityMultiplier).toBe(1.5);
            expect(legacy.durability.stunMax).toBe(15);
        });

        test('write the guess out, so it is never guessed twice', () => {
            const serialized = heroWith({ species: 'Weren' }).serialize();
            expect(serialized.durabilityMultiplier).toBe(1.5);

            // Rename the hero's species without touching the stored number: the
            // multiplier must survive, because it is no longer read off the name.
            const renamed = AlternityCharacterState.deserialize({ ...serialized, species: 'Human' });
            expect(renamed.durabilityMultiplier).toBe(1.5);
        });

        test('leave everyone else on a multiplier of 1', () => {
            expect(heroWith({ species: 'Sasquatch' }).durabilityMultiplier).toBe(1);
            expect(heroWith({ species: '' }).durabilityMultiplier).toBe(1);
        });

        test('default to the human buy range', () => {
            const legacy = heroWith({ species: 'Human' });
            for (const ability of SPECIES_ABILITIES) {
                expect(legacy.abilityRange(ability)).toEqual({ min: 4, max: 14 });
            }
        });
    });
});
