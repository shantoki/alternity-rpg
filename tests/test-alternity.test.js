/**
 * @fileoverview Test suite for core Alternity system mechanics, ensuring data integrity and hook reliability.
 */

import { AlternityMathService, SUCCESS_DEGREES } from '../src/services/alternity-math.js';
import { AlternityCharacterState } from '../src/data/alternity-actor-data.js';

describe('Alternity System Unit Tests', () => {

    // Test Suite for Core Data Structures
    describe('Data Persistence and State Management', () => {
        it('should correctly serialize and deserialize complex state components', async () => {
            const initialState = new AlternityCharacterState({ actorId: "test-actor-1" });

            // Populate initial data
            initialState.addAbility({
                id: "test-ability",
                name: "Test Ability", 
                type: "Action", 
                isActive: true, 
                triggerCondition: {}, 
                effectPayload: { step: 1 }
            });
            initialState.specialRules.push({ id: 'momentum', name: 'Momentum', isEnabled: true });

            const serialized = initialState.serialize();
            expect(typeof serialized).toBe('object');

            // Simulate loading from storage
            const loadedState = AlternityCharacterState.deserialize(serialized);
            expect(loadedState).toBeInstanceOf(AlternityCharacterState);
            expect(loadedState.actorId).toBe("test-actor-1");
            expect(loadedState.abilitySets[0].name).toBe("Test Ability");
        });

        it('should correctly calculate triple skill scores', () => {
            const state = new AlternityCharacterState({ actorId: "test-actor-1", abilityScores: { STR: 12 } });
            state.setSkillRank('str-melee', 2); // 12 + 2 = 14
            
            const scores = state.getSkillScores('str-melee');
            expect(scores).toEqual({ ordinary: 14, good: 7, amazing: 3 });
        });

        it('should correctly calculate wound and damage penalties', () => {
            const state = new AlternityCharacterState({ actorId: "test-actor-1", abilityScores: { CON: 10 } });
            
            // Initial state: Healthy (0 penalty)
            expect(state.woundLevel).toBe('Healthy');
            expect(state.getDamageStepPenalty()).toBe(0);

            // Set to Down: +2 penalty
            state.setWoundLevel('Down');
            expect(state.getDamageStepPenalty()).toBe(2);
            expect(state.getWoundPenalty()).toBe(2);

            // Set to Healthy but add 1 Mortal box: +1 penalty (Dazed)
            state.setWoundLevel('Healthy');
            state.applyDamage(1, 'mortal');
            expect(state.woundLevel).toBe('Bleeding'); // Mortal damage causes Bleeding
            expect(state.getDamageStepPenalty()).toBe(1); // 0 (Bleeding) + 1 (Mortal box)
            expect(state.getWoundPenalty()).toBe(0); // Just the wound level penalty
        });

        it('should correctly calculate resistance modifiers', () => {
            const state = new AlternityCharacterState({ actorId: "test-actor-1" });
            
            // Score 10: Mod 0
            state.setAbilityScore('STR', 10);
            expect(state.getAbilityData('STR').resMod).toBe(0);

            // Score 11: Mod +1
            state.setAbilityScore('STR', 11);
            expect(state.getAbilityData('STR').resMod).toBe(1);

            // Score 12: Mod +1
            state.setAbilityScore('STR', 12);
            expect(state.getAbilityData('STR').resMod).toBe(1);

            // Score 13: Mod +2
            state.setAbilityScore('STR', 13);
            expect(state.getAbilityData('STR').resMod).toBe(2);

            // Score 14: Mod +2
            state.setAbilityScore('STR', 14);
            expect(state.getAbilityData('STR').resMod).toBe(2);

            // CON and PER should have 0 mod regardless of score in Fastplay
            state.setAbilityScore('CON', 14);
            expect(state.getAbilityData('CON').resMod).toBe(0);
        });

        it('should calculate secondary damage from raw damage before armor reduction', () => {
            const state = new AlternityCharacterState({ actorId: "test-actor-1", abilityScores: { CON: 10 } });
            
            // Healthy state
            expect(state.durability.wound).toBe(0);
            expect(state.durability.stun).toBe(0);

            // Apply 4 wounds (final) but based on 8 wounds (raw)
            // Rule: 8 raw wounds -> 4 secondary stuns.
            // Primary: 4 wounds.
            state.applyDamage(4, 'wound', 8);

            expect(state.durability.wound).toBe(4);
            expect(state.durability.stun).toBe(4);
        });

        it('should correctly calculate Action Check scores with profession bonuses', () => {
            // Soldier (Combat Spec): (11+9)/2 = 10. Bonus +3 = 13 (Ordinary). Marginal = 14.
            const soldier = new AlternityCharacterState({ 
                actorId: "soldier", 
                abilityScores: { DEX: 11, INT: 9 },
                profession: "Combat Spec"
            });
            const acSoldier = soldier.getActionCheckData();
            expect(acSoldier.marginal).toBe(14);
            expect(acSoldier.ordinary).toBe(13);
            expect(acSoldier.good).toBe(6);
            expect(acSoldier.amazing).toBe(3);

            // Doctor (Tech Op): (13+13)/2 = 13. Bonus +1 = 14 (Ordinary). Marginal = 15.
            const doctor = new AlternityCharacterState({ 
                actorId: "doctor", 
                abilityScores: { DEX: 13, INT: 13 },
                profession: "Tech Op"
            });
            const acDoctor = doctor.getActionCheckData();
            expect(acDoctor.marginal).toBe(15);
            expect(acDoctor.ordinary).toBe(14);
            expect(acDoctor.good).toBe(7);
            expect(acDoctor.amazing).toBe(3);
        });

        it('should correctly store and retrieve actions per round', () => {
            const state = new AlternityCharacterState({ 
                actorId: "test-actor",
                actionsPerRound: 3
            });
            expect(state.getActionsPerRound()).toBe(3);

            const serialized = state.serialize();
            expect(serialized.actionsPerRound).toBe(3);

            const deserialized = AlternityCharacterState.deserialize(serialized);
            expect(deserialized.getActionsPerRound()).toBe(3);
        });

        it('should automate psionic energy max based on Willpower', () => {
            const state = new AlternityCharacterState({ 
                actorId: "test-actor",
                abilityScores: { WIL: 12 }
            });
            
            // Initial max should be equal to WIL
            expect(state.psionics.energy.max).toBe(12);

            // Changing WIL should update psionic energy max
            state.setAbilityScore('WIL', 14);
            expect(state.psionics.energy.max).toBe(14);
        });

        it('should handle untrained skill restrictions and specialty step fallback', () => {
            const state = new AlternityCharacterState({ 
                actorId: "test-actor",
                abilityScores: { STR: 10, DEX: 10 }
            });

            // 1. Restricted skill at rank 0 should have score 0
            // 'str-martial-arts' is restricted
            const restrictedScores = state.getSkillScores('str-martial-arts');
            expect(restrictedScores.ordinary).toBe(0);

            // 2. Specialty with rank 0 should use Broad skill rank for score if Broad is trained
            // 'str-combat' is broad, 'str-powered-combat' is specialty (restricted)
            state.setSkillRank('str-combat', 2);
            // Even if broad is trained, if specialty is restricted and rank 0, it should be 0
            const restrictedSpecScores = state.getSkillScores('str-powered-combat');
            expect(restrictedSpecScores.ordinary).toBe(0);

            // 3. Specialty NOT restricted, with rank 0, should use Broad skill rank
            // 'str-climb' is specialty of 'str-athletics'
            state.setSkillRank('str-athletics', 3);
            const nonRestrictedSpecScores = state.getSkillScores('str-climb');
            expect(nonRestrictedSpecScores.ordinary).toBe(13); // 10 + 3

            // 4. Specialty with rank 0 should use Broad skill base step (+1)
            expect(state.getSkillBaseStep('str-climb')).toBe(1);
            
            // 5. Specialty with rank > 0 should use specialty base step (0)
            state.setSkillRank('str-climb', 1);
            expect(state.getSkillBaseStep('str-climb')).toBe(0);
        });
    });

    // Test Suite for Mathematics Service (alternity-math.js)
    describe('AlternityMathService Calculations', () => {
        it('should correctly determine degree of success', () => {
            const scores = { ordinary: 14, good: 7, amazing: 3 };
            
            // controlRoll 20 is always Critical Failure
            expect(AlternityMathService.resolveAbilityCheck(scores, 0, [], 'General', {control: 20, situation: 0}).degree)
                .toBe(SUCCESS_DEGREES.CRITICAL_FAILURE);
                
            expect(AlternityMathService.resolveAbilityCheck(scores, 0, [], 'General', {control: 3, situation: 0}).degree)
                .toBe(SUCCESS_DEGREES.AMAZING);
            expect(AlternityMathService.resolveAbilityCheck(scores, 0, [], 'General', {control: 7, situation: 0}).degree)
                .toBe(SUCCESS_DEGREES.GOOD);
            expect(AlternityMathService.resolveAbilityCheck(scores, 0, [], 'General', {control: 14, situation: 0}).degree)
                .toBe(SUCCESS_DEGREES.ORDINARY);
            expect(AlternityMathService.resolveAbilityCheck(scores, 0, [], 'General', {control: 15, situation: 0}).degree)
                .toBe(SUCCESS_DEGREES.FAILURE);
        });

        it('should correctly calculate ability check steps with multiple sources', () => {
            const scores = { ordinary: 14, good: 7, amazing: 3 };
            const modifiers = [
                { source: 'Cover', value: 2 },
                { source: 'Aiming', value: -1 }
            ];
            
            // baseStep 0 (Specialty) + 2 - 1 = +1 step
            const result = AlternityMathService.resolveAbilityCheck(scores, 0, modifiers, 'Combat');

            expect(result.totalStep).toBe(1);
            expect(result.stepDie.die).toBe("d4");
        });

        it('should treat positive modifiers as penalties and negative as bonuses', () => {
            const scores = { ordinary: 14, good: 7, amazing: 3 };
            
            // Penalty: +1 step (d4)
            // Roll: control 10, situation 4 -> 10 + 4 = 14 (Ordinary)
            // If it were a bonus, it would be 10 - 4 = 6 (Good)
            const penaltyResult = AlternityMathService.resolveAbilityCheck(scores, 0, [{ source: 'Test', value: 1 }], 'Test', { control: 10, situation: 4 });
            expect(penaltyResult.result).toBe(14);
            expect(penaltyResult.degree).toBe(SUCCESS_DEGREES.ORDINARY);

            // Bonus: -1 step (d4)
            // Roll: control 10, situation 4 -> 10 - 4 = 6 (Good)
            const bonusResult = AlternityMathService.resolveAbilityCheck(scores, 0, [{ source: 'Test', value: -1 }], 'Test', { control: 10, situation: 4 });
            expect(bonusResult.result).toBe(6);
            expect(bonusResult.degree).toBe(SUCCESS_DEGREES.GOOD);
        });
    });

    // Test Suite for Warship Combat Math (Warships Ch.1: Firepower and Toughness)
    describe('AlternityMathService — Ship Combat', () => {
        it('should apply no shift when firepower equals toughness', () => {
            const result = AlternityMathService.calculateFirepowerShift('wound', 'Heavy', 'Heavy');
            expect(result.finalGrade).toBe('wound');
            expect(result.multiplier).toBe(1);
            expect(result.shift).toBe(0);
        });

        it('should downgrade damage when toughness exceeds firepower (Table 1-3)', () => {
            // Medium firepower vs Heavy toughness (1 class short) -> wound becomes stun
            expect(AlternityMathService.calculateFirepowerShift('wound', 'Medium', 'Heavy').finalGrade).toBe('stun');
            // 2 classes short -> wound floors at 'none'
            expect(AlternityMathService.calculateFirepowerShift('wound', 'SmallCraft', 'Heavy').finalGrade).toBe('none');
            // Stun downgraded by any amount floors at 'none', never goes negative
            expect(AlternityMathService.calculateFirepowerShift('stun', 'SmallCraft', 'SuperHeavy').finalGrade).toBe('none');
        });

        it('should upgrade damage when firepower exceeds toughness (Table 1-4)', () => {
            // Heavy firepower vs Light toughness (2 classes over) -> mortal becomes 2x critical
            const twoOver = AlternityMathService.calculateFirepowerShift('mortal', 'Heavy', 'Light');
            expect(twoOver.finalGrade).toBe('critical');
            expect(twoOver.multiplier).toBe(2);

            // SuperHeavy firepower vs Heavy toughness (1 class over), critical damage doubles
            const oneOverCritical = AlternityMathService.calculateFirepowerShift('critical', 'SuperHeavy', 'Heavy');
            expect(oneOverCritical.finalGrade).toBe('critical');
            expect(oneOverCritical.multiplier).toBe(2);

            // Table 1-4, Stun row, three classes of excess firepower -> Critical (no multiplier yet)
            const threeOver = AlternityMathService.calculateFirepowerShift('stun', 'Heavy', 'SmallCraft');
            expect(threeOver.finalGrade).toBe('critical');
            expect(threeOver.multiplier).toBe(1);
        });

        it('should throw on an invalid toughness/firepower class', () => {
            expect(() => AlternityMathService.calculateFirepowerShift('wound', 'Massive', 'Heavy')).toThrow();
        });

        it('should negate ship damage using the armor rating for the matching damage type', () => {
            const armorRatings = { lowImpact: 4, highImpact: 7, energy: 2 };
            const result = AlternityMathService.calculateShipDamageMitigation(10, 'highImpact', armorRatings, 'Ship Combat');
            expect(result.finalDamage).toBe(3); // 10 - 7
            expect(result.mitigated).toBe(7);
        });

        it('should clamp ship damage mitigation at zero', () => {
            const armorRatings = { lowImpact: 20, highImpact: 0, energy: 0 };
            const result = AlternityMathService.calculateShipDamageMitigation(5, 'lowImpact', armorRatings, 'Ship Combat');
            expect(result.finalDamage).toBe(0);
        });

        it('should reject an unknown damage type', () => {
            expect(() => AlternityMathService.calculateShipDamageMitigation(5, 'ballistic', { lowImpact: 0 }, 'Ship Combat')).toThrow();
        });
    });

    describe('AlternityMathService — Skill Scores & Resistance', () => {
        it('should score a specialty skill as ability score + rank, with the O/G/A triple', () => {
            // alternity-core-mechanics.md: specialty score = ability score + rank.
            const scores = AlternityMathService.calculateSkillScores(12, 3);
            expect(scores.base).toBe(15);
            expect(scores.ordinary).toBe(15);
            expect(scores.good).toBe(7);   // half, rounded down
            expect(scores.amazing).toBe(3); // quarter, rounded down
        });

        it('should score a broad skill as the bare ability score', () => {
            expect(AlternityMathService.calculateSkillScores(12).ordinary).toBe(12);
        });

        it('should halve the ability score when untrained', () => {
            const scores = AlternityMathService.calculateSkillScores(13, 0, { untrained: true });
            expect(scores.ordinary).toBe(6);
            expect(scores.good).toBe(3);
        });

        it('should reject nonsensical skill score inputs', () => {
            expect(() => AlternityMathService.calculateSkillScores(-1)).toThrow();
            expect(() => AlternityMathService.calculateSkillScores(12, -2)).toThrow();
            expect(() => AlternityMathService.calculateSkillScores('12')).toThrow();
        });

        it('should apply the resistance modifier bands', () => {
            expect(AlternityMathService.calculateResistanceModifier(10, 'DEX')).toBe(0);
            expect(AlternityMathService.calculateResistanceModifier(11, 'DEX')).toBe(1);
            expect(AlternityMathService.calculateResistanceModifier(12, 'DEX')).toBe(1);
            expect(AlternityMathService.calculateResistanceModifier(13, 'DEX')).toBe(2);
            expect(AlternityMathService.calculateResistanceModifier(14, 'DEX')).toBe(2);
        });

        it('should give CON and PER no resistance modifier', () => {
            expect(AlternityMathService.calculateResistanceModifier(14, 'CON')).toBe(0);
            expect(AlternityMathService.calculateResistanceModifier(14, 'PER')).toBe(0);
            // Omitting the ability applies the bands unconditionally.
            expect(AlternityMathService.calculateResistanceModifier(14)).toBe(2);
        });
    });

    describe('AlternityMathService — Cyber Tolerance', () => {
        it('should split the tolerance track the way the book\'s worked example does', () => {
            // PHB Ch.15: "Taylor Windsor has a cyber tolerance score of 12 (6/3/3)".
            const result = AlternityMathService.calculateCyberTolerance(12);
            expect(result.max).toBe(12);
            expect(result.sections).toEqual({ left: 6, centre: 3, right: 3 });
            expect(result.used).toBe(0);
            expect(result.remaining).toBe(12);
        });

        it('should always have the three sections add back up to the maximum', () => {
            for (let con = 1; con <= 20; con++) {
                const { max, sections } = AlternityMathService.calculateCyberTolerance(con);
                expect(sections.left + sections.centre + sections.right).toBe(max);
            }
        });

        it('should give mechalus characters CON+4 tolerance', () => {
            const result = AlternityMathService.calculateCyberTolerance(12, [], { isMechalus: true });
            expect(result.max).toBe(16);
            expect(result.modifierTrace.some(m => m.source === 'Mechalus')).toBe(true);
        });

        it('should fill boxes left to right across the three sections', () => {
            // CON 12 -> 6/3/3. Seven points of gear fills the left section and one centre box.
            const result = AlternityMathService.calculateCyberTolerance(12, [
                { name: 'Reflex', size: 2 },
                { name: 'Body Plating', size: 3 },
                { name: 'MusclePlus', size: 2 },
            ]);
            expect(result.used).toBe(7);
            expect(result.filled).toEqual({ left: 6, centre: 1, right: 0 });
            expect(result.remaining).toBe(5);
        });

        it('should require a Constitution feat check once past half the track', () => {
            // 6 of 12 is exactly half — still no check.
            expect(AlternityMathService.calculateCyberTolerance(12, [6]).requiresFeatCheck).toBe(false);
            // The seventh point crosses the line.
            expect(AlternityMathService.calculateCyberTolerance(12, [7]).requiresFeatCheck).toBe(true);
        });

        it('should redirect damage to cyber gear as the later sections fill', () => {
            expect(AlternityMathService.calculateCyberTolerance(12, [6]).damageRedirect).toBe('none');
            // Into the centre section: mortal damage hits the gear.
            expect(AlternityMathService.calculateCyberTolerance(12, [7]).damageRedirect).toBe('mortal');
            // Into the right section: wound damage does too.
            expect(AlternityMathService.calculateCyberTolerance(12, [10]).damageRedirect).toBe('woundAndMortal');
        });

        it('should report a full and an overloaded track', () => {
            const full = AlternityMathService.calculateCyberTolerance(12, [12]);
            expect(full.isFull).toBe(true);
            expect(full.isOverloaded).toBe(false);
            expect(full.remaining).toBe(0);

            const over = AlternityMathService.calculateCyberTolerance(12, [13]);
            expect(over.isOverloaded).toBe(true);
            expect(over.remaining).toBe(0);
            // Boxes can't overflow past the width of the track.
            expect(over.filled).toEqual({ left: 6, centre: 3, right: 3 });
        });

        it('should accept plain numbers as well as named gear entries', () => {
            const numbers = AlternityMathService.calculateCyberTolerance(14, [2, 3]);
            const named   = AlternityMathService.calculateCyberTolerance(14, [{ name: 'A', size: 2 }, { name: 'B', size: 3 }]);
            expect(numbers.used).toBe(5);
            expect(named.used).toBe(5);
            expect(named.modifierTrace.some(m => m.source === 'B')).toBe(true);
        });

        it('should reject invalid Constitution scores and gear sizes', () => {
            expect(() => AlternityMathService.calculateCyberTolerance(-1)).toThrow();
            expect(() => AlternityMathService.calculateCyberTolerance('12')).toThrow();
            expect(() => AlternityMathService.calculateCyberTolerance(12, 'nope')).toThrow();
            expect(() => AlternityMathService.calculateCyberTolerance(12, [{ name: 'Bad', size: -2 }])).toThrow();
        });
    });
});