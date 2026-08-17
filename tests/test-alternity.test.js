/**
 * @fileoverview Test suite for core Alternity system mechanics, ensuring data integrity and hook reliability.
 */

import {
    AlternityMathService,
    SUCCESS_DEGREES,
    AI_PROCESSORS,
    AI_QUALITIES,
    AI_MAX_SKILL_RANK,
} from '../src/services/alternity-math.js';
import { AlternityCharacterState } from '../src/data/alternity-actor-data.js';
import { NpcData } from '../src/data/NpcData.js';

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

            // Mortal damage sets the wound level but carries NO Dazed penalty.
            // This assertion used to expect +1, matching an implementation that
            // charged Dazed against the mortal track. The PHB puts Dazed under
            // *Fatigue Damage*: "For every fatigue box marked, a character
            // receives a +1 step penalty to all subsequent actions he attempts."
            state.setWoundLevel('Healthy');
            state.applyDamage(1, 'mortal');
            expect(state.woundLevel).toBe('Bleeding'); // Mortal damage causes Bleeding
            expect(state.getDamageStepPenalty()).toBe(0); // 0 (Bleeding) + 0 (no fatigue)
            expect(state.getWoundPenalty()).toBe(0); // Just the wound level penalty
        });

        it('should apply the Dazed penalty per marked fatigue box, not per mortal box', () => {
            const state = new AlternityCharacterState({ actorId: 'test-actor-dazed', abilityScores: { CON: 10 } });

            // CON 10 -> stun/wound 10, mortal/fatigue 5 (half, rounded up).
            expect(state.durability.fatigueMax).toBe(5);
            expect(state.durability.mortalMax).toBe(5);

            state.durability.fatigue = 3;
            expect(state.getDamageStepPenalty()).toBe(3);

            // Mortal damage on its own contributes nothing to the step penalty.
            state.durability.fatigue = 0;
            state.durability.mortal  = 3;
            expect(state.getDamageStepPenalty()).toBe(0);
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

        // Both band tables transcribed from photographs of the printed tables.
        it('should apply every resistance modifier band (PHB Table P2)', () => {
            // 4 or less: -2 | 5-6: -1 | 7-10: 0 | 11-12: +1 | 13-14: +2
            // 15-16: +3 | 17-18: +4 | 19+: +5
            const bands = [[1, -2], [4, -2], [5, -1], [6, -1], [7, 0], [10, 0], [11, 1], [12, 1],
                           [13, 2], [14, 2], [15, 3], [16, 3], [17, 4], [18, 4], [19, 5], [25, 5]];
            for (const [score, expected] of bands) {
                expect(AlternityMathService.calculateResistanceModifier(score, 'DEX')).toBe(expected);
            }
        });

        it('should apply every Strength damage adjustment band (PHB Table P9)', () => {
            // 3-6: -1 | 7-10: 0 | 11-12: +1 | 13-14: +2 | 15-16: +3 | 17-18: +4 | 19+: +5
            const bands = [[3, -1], [6, -1], [7, 0], [10, 0], [11, 1], [12, 1],
                           [13, 2], [14, 2], [15, 3], [16, 3], [17, 4], [18, 4], [19, 5], [25, 5]];
            for (const [score, expected] of bands) {
                expect(AlternityMathService.calculateStrengthDamageAdjustment(score)).toBe(expected);
            }
        });

        it('should keep the two tables distinct below score 7', () => {
            // P2 has a -2 band that P9 does not; P9's single -1 band spans 3-6.
            expect(AlternityMathService.calculateResistanceModifier(4, 'STR')).toBe(-2);
            expect(AlternityMathService.calculateStrengthDamageAdjustment(4)).toBe(-1);
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

    describe('AlternityMathService — Durability Ratings', () => {
        it('should rate stun/wound at CON and mortal/fatigue at half, rounded up', () => {
            // PHB Ch.2: "stun and wound damage equal to his Constitution score,
            // and ... mortal and fatigue damage equal to half his Constitution
            // score, rounded up."
            const r = AlternityMathService.calculateDurabilityRatings(9);
            expect(r).toMatchObject({ stun: 9, wound: 9, mortal: 5, fatigue: 5 });
        });

        it('should match the printed 9/9/5/5 and 10/10/5/5 statblock runs', () => {
            // Ramos Epoupin, CON 9 -> 9/9/5/5 (StarDrive Campaign Setting).
            const con9 = AlternityMathService.calculateDurabilityRatings(9);
            expect([con9.stun, con9.wound, con9.mortal, con9.fatigue]).toEqual([9, 9, 5, 5]);
            // Cole Tipton, CON 10 -> 10/10/5/5 (Mindwalking).
            const con10 = AlternityMathService.calculateDurabilityRatings(10);
            expect([con10.stun, con10.wound, con10.mortal, con10.fatigue]).toEqual([10, 10, 5, 5]);
        });

        it('should always keep mortal and fatigue equal to each other', () => {
            for (let con = 0; con <= 30; con++) {
                const r = AlternityMathService.calculateDurabilityRatings(con);
                expect(r.mortal).toBe(r.fatigue);
                expect(r.stun).toBe(r.wound);
            }
        });

        it('should give weren CON x1.5 before halving (Superior Durability)', () => {
            // CON 16 -> base 24 -> 24/24/12/12. Halving the *inflated* score is the
            // point: halving first would give 8, not 12.
            const r = AlternityMathService.calculateDurabilityRatings(16, { isWeren: true });
            expect([r.stun, r.wound, r.mortal, r.fatigue]).toEqual([24, 24, 12, 12]);
            expect(r.modifierTrace.some(m => m.source === 'Weren')).toBe(true);
        });

        it('should reject invalid Constitution scores', () => {
            expect(() => AlternityMathService.calculateDurabilityRatings(-1)).toThrow();
            expect(() => AlternityMathService.calculateDurabilityRatings('9')).toThrow();
            expect(() => AlternityMathService.calculateDurabilityRatings(NaN)).toThrow();
        });
    });

    describe('AlternityMathService — Active Memory', () => {
        it('should match the book\'s worked example of a loaded gridpilot', () => {
            // Dataware Ch.2: "a Good processor in his computer gauntlet (7 slots of
            // active memory) … he keeps a shadow form, shadow weapon, shadow armor,
            // alarm, and break-in program all running … keeping one slot open."
            const result = AlternityMathService.calculateActiveMemory(7, [
                { name: 'Shadow form',   slots: 2 },
                { name: 'Shadow weapon', slots: 1 },
                { name: 'Shadow armor',  slots: 1 },
                { name: 'Alarm',         slots: 1 },
                { name: 'Break-in',      slots: 1 },
            ]);
            expect(result.max).toBe(7);
            expect(result.used).toBe(6);
            expect(result.remaining).toBe(1);
            expect(result.isFull).toBe(false);
            expect(result.programCount).toBe(5);
        });

        it('should report a full and an overloaded budget', () => {
            const full = AlternityMathService.calculateActiveMemory(4, [2, 2]);
            expect(full.isFull).toBe(true);
            expect(full.isOverloaded).toBe(false);
            expect(full.remaining).toBe(0);

            const over = AlternityMathService.calculateActiveMemory(4, [3, 3]);
            expect(over.isOverloaded).toBe(true);
            // Remaining never goes negative — it is a display value, not a balance.
            expect(over.remaining).toBe(0);
        });

        it('should never overload a supercomputer', () => {
            // PHB Ch.10: "a supercomputer has an unlimited amount of active memory."
            const result = AlternityMathService.calculateActiveMemory(0, [5, 5, 5], { unlimited: true });
            expect(result.used).toBe(15);
            expect(result.isUnlimited).toBe(true);
            expect(result.isFull).toBe(false);
            expect(result.isOverloaded).toBe(false);
            expect(result.remaining).toBe(Infinity);
        });

        it('should charge nothing when no programs are loaded', () => {
            // Storage memory is effectively unlimited; only loading costs slots.
            const result = AlternityMathService.calculateActiveMemory(7);
            expect(result.used).toBe(0);
            expect(result.remaining).toBe(7);
            expect(result.programCount).toBe(0);
        });

        it('should accept plain numbers as well as named program entries', () => {
            const numbers = AlternityMathService.calculateActiveMemory(10, [2, 3]);
            const named   = AlternityMathService.calculateActiveMemory(10, [
                { name: 'Fortress', slots: 2 }, { name: 'Evade', slots: 3 },
            ]);
            expect(numbers.used).toBe(5);
            expect(named.used).toBe(5);
            expect(named.modifierTrace.some(m => m.source === 'Evade')).toBe(true);
        });

        it('should reject invalid capacities and slot counts', () => {
            expect(() => AlternityMathService.calculateActiveMemory(-1)).toThrow();
            expect(() => AlternityMathService.calculateActiveMemory('7')).toThrow();
            expect(() => AlternityMathService.calculateActiveMemory(7, 'nope')).toThrow();
            expect(() => AlternityMathService.calculateActiveMemory(7, [{ name: 'Bad', slots: -2 }])).toThrow();
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Spaceship compartments (GM Guide Ch.11 / PHB Ch.12)
    // ─────────────────────────────────────────────────────────────────────────

    describe('AlternityMathService — Spaceship Compartments', () => {

        it('should expand durability into the printed stun/wound/mortal triple', () => {
            // Every published compartment is printed this way: the trader's
            // "C1 = Command 8/8/4" is durability 4 written out three ways.
            const r = AlternityMathService.calculateCompartmentRatings(4);
            expect(r.stun).toBe(8);
            expect(r.wound).toBe(8);
            expect(r.mortal).toBe(4);
        });

        it('should reproduce every compartment printed on the PHB stock ships', () => {
            // Durability -> "stun/wound/mortal" exactly as the statblocks print it.
            const printed = [
                [3, '6/6/3'], [8, '16/16/8'], [5, '10/10/5'], [2, '4/4/2'],
                [10, '20/20/10'], [7, '14/14/7'], [6, '12/12/6'], [9, '18/18/9'],
            ];
            for (const [durability, expected] of printed) {
                const r = AlternityMathService.calculateCompartmentRatings(durability);
                expect(`${r.stun}/${r.wound}/${r.mortal}`).toBe(expected);
            }
        });

        it('should flag compartments over the 10-point cap without rejecting them', () => {
            expect(AlternityMathService.calculateCompartmentRatings(10).isOversized).toBe(false);
            expect(AlternityMathService.calculateCompartmentRatings(11).isOversized).toBe(true);
        });

        it('should penalise systems only once damage exceeds half a track', () => {
            // Durability 4 -> 8/8/4. Exactly half is not "more than half".
            const half = AlternityMathService.calculateCompartmentStatus(4, { stun: 4 });
            expect(half.isStunImpaired).toBe(false);
            expect(half.systemPenalty).toBe(0);

            const over = AlternityMathService.calculateCompartmentStatus(4, { stun: 5 });
            expect(over.isStunImpaired).toBe(true);
            expect(over.systemPenalty).toBe(1);
        });

        it('should accumulate stun, wound and mortal penalties', () => {
            const s = AlternityMathService.calculateCompartmentStatus(4, { stun: 5, wound: 5, mortal: 2 });
            // +1 stun over half, +1 wound over half, +1 per mortal point.
            expect(s.systemPenalty).toBe(4);
            // Durability checks use the original stun rating — twice durability.
            expect(s.durabilityCheckScore).toBe(8);
        });

        it('should apply a damage-control bonus to the mortal check, not the penalty', () => {
            const s = AlternityMathService.calculateCompartmentStatus(
                4, { mortal: 2 }, { damageControlBonus: -2 }
            );
            expect(s.systemPenalty).toBe(2);
            expect(s.mortalCheckStep).toBe(0);
        });

        it('should mark a compartment destroyed once its mortal points are gone', () => {
            expect(AlternityMathService.calculateCompartmentStatus(4, { mortal: 3 }).isDestroyed).toBe(false);
            expect(AlternityMathService.calculateCompartmentStatus(4, { mortal: 4 }).isDestroyed).toBe(true);
        });

        it('should derive secondary damage at the book rate', () => {
            expect(AlternityMathService.calculateSecondaryDamage('stun', 9)).toMatchObject({ stun: 0, wound: 0 });
            expect(AlternityMathService.calculateSecondaryDamage('wound', 7)).toMatchObject({ stun: 3, wound: 0 });
            expect(AlternityMathService.calculateSecondaryDamage('mortal', 5)).toMatchObject({ stun: 2, wound: 2 });
        });

        it('should reject a damage grade the compartment tracks do not have', () => {
            // 'critical' belongs to the Warships model, not this one.
            expect(() => AlternityMathService.calculateSecondaryDamage('critical', 4)).toThrow();
        });
    });

    describe('AlternityMathService — Firepower vs Ship Toughness', () => {

        it('should leave Amazing firepower undegraded against a ship', () => {
            const r = AlternityMathService.calculateFirepowerDegrade('mortal', 'Amazing');
            expect(r.finalGrade).toBe('mortal');
            expect(r.steps).toBe(0);
        });

        it('should degrade Good firepower one grade against a ship', () => {
            expect(AlternityMathService.calculateFirepowerDegrade('mortal', 'Good').finalGrade).toBe('wound');
            expect(AlternityMathService.calculateFirepowerDegrade('wound', 'Good').finalGrade).toBe('stun');
            expect(AlternityMathService.calculateFirepowerDegrade('stun', 'Good').isNegated).toBe(true);
        });

        it('should degrade Ordinary firepower twice against a ship', () => {
            // The book's own example: a 9mm pistol must score an Amazing hit just to
            // inflict stun damage on a hull.
            expect(AlternityMathService.calculateFirepowerDegrade('mortal', 'Ordinary').finalGrade).toBe('stun');
            expect(AlternityMathService.calculateFirepowerDegrade('wound', 'Ordinary').isNegated).toBe(true);
            expect(AlternityMathService.calculateFirepowerDegrade('stun', 'Ordinary').isNegated).toBe(true);
        });

        it('should never upgrade damage for exceeding the target toughness', () => {
            // Upgrading is a Warships-only rule; the core ladder only degrades.
            const r = AlternityMathService.calculateFirepowerDegrade('wound', 'Amazing', 'Ordinary');
            expect(r.finalGrade).toBe('wound');
            expect(r.steps).toBe(0);
        });

        it('should reject classes outside the Marginal..Amazing ladder', () => {
            expect(() => AlternityMathService.calculateFirepowerDegrade('wound', 'Heavy')).toThrow();
            expect(() => AlternityMathService.calculateFirepowerDegrade('critical', 'Good')).toThrow();
        });
    });

    describe('AlternityMathService — Compartment Hit Table', () => {

        /** "1-2, 3-5, ..." — the shape the statblocks print. */
        const asPrinted = (table) =>
            table.ranges.map(r => (r.low === r.high ? `${r.low}` : `${r.low}-${r.high}`)).join('; ');

        it('should reproduce the Random damage lines printed on the stock ships', () => {
            // Transcribed from PHB Ch.12. These are the only columns of Table G50
            // that survive anywhere in the corpus.
            expect(asPrinted(AlternityMathService.calculateCompartmentHitTable(1)))
                .toBe('1-20');                                          // escape pod
            expect(asPrinted(AlternityMathService.calculateCompartmentHitTable(2)))
                .toBe('1-7; 8-20');                                     // launch, space fighter
            expect(asPrinted(AlternityMathService.calculateCompartmentHitTable(4)))
                .toBe('1-2; 3-5; 6-12; 13-20');                         // STG shuttle, cutter
            expect(asPrinted(AlternityMathService.calculateCompartmentHitTable(6)))
                .toBe('1-2; 3-4; 5-7; 8-10; 11-15; 16-20');             // trader, yacht
            expect(asPrinted(AlternityMathService.calculateCompartmentHitTable(8)))
                .toBe('1; 2; 3-4; 5-6; 7-9; 10-12; 13-16; 17-20');      // system liner
            expect(asPrinted(AlternityMathService.calculateCompartmentHitTable(10)))
                .toBe('1; 2; 3; 4; 5-6; 7-8; 9-10; 11-13; 14-16; 17-20'); // transport
        });

        it('should mark the printed columns as transcribed, not generated', () => {
            for (const count of [1, 2, 4, 6, 8, 10]) {
                expect(AlternityMathService.calculateCompartmentHitTable(count).isDerived).toBe(false);
            }
        });

        it('should generate — and flag — a table for counts the book never prints', () => {
            for (const count of [3, 5, 7, 9, 11, 12]) {
                const table = AlternityMathService.calculateCompartmentHitTable(count);
                expect(table.isDerived).toBe(true);
                expect(table.ranges).toHaveLength(count);
                // Whatever it generates must still tile 1-20 exactly once, or hit
                // rolls would silently fall through a gap during play.
                expect(table.ranges[0].low).toBe(1);
                expect(table.ranges[count - 1].high).toBe(20);
                for (let i = 1; i < count; i++) {
                    expect(table.ranges[i].low).toBe(table.ranges[i - 1].high + 1);
                }
            }
        });

        it('should keep the outer compartments the easiest to hit', () => {
            // The asymmetry is the point: low-numbered spaces are buried deep in the
            // hull, which is why designers put cargo holds at the high numbers.
            for (const count of [2, 3, 4, 6, 8, 10]) {
                const widths = AlternityMathService.calculateCompartmentHitTable(count)
                    .ranges.map(r => r.high - r.low + 1);
                for (let i = 1; i < widths.length; i++) {
                    expect(widths[i]).toBeGreaterThanOrEqual(widths[i - 1]);
                }
            }
        });
    });

    describe('AlternityMathService — Resolving a Compartment Hit', () => {

        /** A six-compartment trader, using the printed table. */
        const trader = (destroyed = []) =>
            AlternityMathService.calculateCompartmentHitTable(6).ranges.map((r, i) => ({
                hitLow: r.low, hitHigh: r.high, isDestroyed: destroyed.includes(i),
            }));

        it('should map a roll onto the compartment whose band contains it', () => {
            expect(AlternityMathService.resolveCompartmentHit(trader(), 9).resolvedIndex).toBe(3);
            expect(AlternityMathService.resolveCompartmentHit(trader(), 1).resolvedIndex).toBe(0);
            expect(AlternityMathService.resolveCompartmentHit(trader(), 20).resolvedIndex).toBe(5);
        });

        it('should let the sensors operator shift the roll', () => {
            // A 5 sits in C3's band; the book's example shifts a Good result by +2.
            const r = AlternityMathService.resolveCompartmentHit(trader(), 5, { sensorShift: 2 });
            expect(r.adjustedRoll).toBe(7);
            expect(r.resolvedIndex).toBe(2);
        });

        it('should clamp a shifted roll to the die rather than falling off the table', () => {
            expect(AlternityMathService.resolveCompartmentHit(trader(), 19, { sensorShift: 3 }).adjustedRoll).toBe(20);
        });

        it('should roll damage down to the next lower-numbered surviving compartment', () => {
            // The book's own example: with C2 destroyed, the next hit there lands on C1.
            const r = AlternityMathService.resolveCompartmentHit(trader([1]), 3);
            expect(r.struckIndex).toBe(1);
            expect(r.resolvedIndex).toBe(0);
            expect(r.walkedPast).toEqual([1]);
        });

        it('should wrap around to the highest-numbered compartment past C1', () => {
            // "If compartment 1 is destroyed, the next hit ... is applied to
            // compartment 6, the ship's highest-numbered compartment."
            const r = AlternityMathService.resolveCompartmentHit(trader([0, 1]), 3);
            expect(r.resolvedIndex).toBe(5);
            expect(r.walkedPast).toEqual([1, 0]);
        });

        it('should report an all-wrecked ship instead of looping forever', () => {
            const r = AlternityMathService.resolveCompartmentHit(trader([0, 1, 2, 3, 4, 5]), 9);
            expect(r.allDestroyed).toBe(true);
            expect(r.resolvedIndex).toBe(-1);
        });

        it('should report a roll that no band covers', () => {
            const gapped = [{ hitLow: 1, hitHigh: 5, isDestroyed: false }];
            expect(AlternityMathService.resolveCompartmentHit(gapped, 12).resolvedIndex).toBe(-1);
        });
    });

    describe('AlternityMathService — Ship Armor & Support', () => {

        it('should charge armor against the whole hull, rounded down', () => {
            expect(AlternityMathService.calculateArmorDurabilityCost(24, 'Light').cost).toBe(0);
            expect(AlternityMathService.calculateArmorDurabilityCost(24, 'Moderate').cost).toBe(2);
            expect(AlternityMathService.calculateArmorDurabilityCost(24, 'Heavy').cost).toBe(4);
            // 30 durability, moderate armor = 3 — the Endurance-class figure the
            // StarDrive statblocks print as "Moderate neutronite (3 dur)".
            expect(AlternityMathService.calculateArmorDurabilityCost(30, 'Moderate').cost).toBe(3);
        });

        it('should leave the rest of the hull available for compartments', () => {
            const r = AlternityMathService.calculateArmorDurabilityCost(40, 'Heavy');
            expect(r.cost).toBe(8);
            expect(r.available).toBe(32);
        });

        it('should size life support and damage control at one unit per 20 durability', () => {
            expect(AlternityMathService.calculateSupportUnitsRequired(20).units).toBe(1);
            expect(AlternityMathService.calculateSupportUnitsRequired(21).units).toBe(2);
            expect(AlternityMathService.calculateSupportUnitsRequired(0).units).toBe(0);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Robots (7Foundry)
    // ─────────────────────────────────────────────────────────────────────────

    describe('AlternityMathService — Robot Chassis Points', () => {

        it('should match the book worked examples of CP = h x (30 - CON)', () => {
            // "a 'tiny' robot with 5 CON would have: 1 x (30-5) = 25 Chassis Points,
            //  while a 'huge' robot with 15 CON would have: 30 x (30 - 15) = 450"
            expect(AlternityMathService.calculateChassisPoints('Tiny', 5).chassisPoints).toBe(25);
            expect(AlternityMathService.calculateChassisPoints('Huge', 15).chassisPoints).toBe(450);
        });

        it('should reproduce Table 3.3 including its rounded percentage factors', () => {
            // size, CON -> [CP, 10%, 5%, 1%], transcribed from the printed table.
            const rows = [
                ['Diminutive', 3, [11, 1, 1, 0]],
                ['Diminutive', 6, [10, 1, 1, 0]],
                ['Tiny',       4, [26, 3, 1, 0]],
                ['Tiny',       8, [22, 2, 1, 0]],
                ['Small',      5, [75, 8, 4, 1]],
                ['Small',      7, [69, 7, 3, 1]],
                ['Medium',     8, [110, 11, 6, 1]],
                ['Medium',     9, [105, 11, 5, 1]],
                ['Medium',    12, [90, 9, 5, 1]],
                ['Large',      9, [210, 21, 11, 2]],
                ['Large',     13, [170, 17, 9, 2]],
                ['Huge',       9, [630, 63, 32, 6]],
                ['Huge',      13, [510, 51, 26, 5]],
                ['Huge',      15, [450, 45, 23, 5]],
            ];
            for (const [size, con, [cp, ten, five, one]] of rows) {
                const r = AlternityMathService.calculateChassisPoints(size, con);
                expect([r.chassisPoints, r.factors.ten, r.factors.five, r.factors.one])
                    .toEqual([cp, ten, five, one]);
            }
        });

        it('should round half up, as every other .5 cell in Table 3.3 does', () => {
            // Table 3.3 prints 10% of a tiny CON 5 chassis (25 CP) as 2, but every
            // other half-value in the table rounds up — 5.5 to 6, 10.5 to 11,
            // 22.5 to 23, 31.5 to 32, 7.5 to 8, 4.5 to 5, 8.5 to 9. That single cell
            // is treated as a slip in the supplement rather than a second rule.
            expect(AlternityMathService.calculateChassisPoints('Tiny', 5).factors.ten).toBe(3);
        });

        it('should flag a Constitution the chassis size cannot support', () => {
            // Table 3.1: a medium chassis supports CON 6-12.
            expect(AlternityMathService.calculateChassisPoints('Medium', 8).isConOutOfRange).toBe(false);
            expect(AlternityMathService.calculateChassisPoints('Medium', 13).isConOutOfRange).toBe(true);
            expect(AlternityMathService.calculateChassisPoints('Medium', 5).isConOutOfRange).toBe(true);
        });

        it('should reject an unknown chassis size', () => {
            expect(() => AlternityMathService.calculateChassisPoints('Gigantic', 10)).toThrow();
        });
    });

    describe('AlternityMathService — Chassis Percentage Denominations', () => {

        it('should use the minimum number of factors', () => {
            // "if a system requires, for example, 16% Chassis Points ... always
            //  translate the percent using a minimum number of factors: 10%+5%+1%.
            //  8% would be calculated using 5%+1%+1%+1%."
            const sixteen = AlternityMathService.decomposeChassisPercent(16);
            expect(sixteen.counts).toEqual({ ten: 1, five: 1, one: 1 });
            expect(sixteen.factorCount).toBe(3);

            const eight = AlternityMathService.decomposeChassisPercent(8);
            expect(eight.counts).toEqual({ ten: 0, five: 1, one: 3 });
            expect(eight.factorCount).toBe(4);
        });

        it('should price six 5% wheels as three 10% factors, not six 5% ones', () => {
            // The book's own worked example: a medium chassis with CON 8 has
            // 10% = 11 CP, so six wheels totalling 30% cost 33 CP.
            const { factors } = AlternityMathService.calculateChassisPoints('Medium', 8);
            expect(factors).toEqual({ ten: 11, five: 6, one: 1 });

            const wheels = AlternityMathService.decomposeChassisPercent(6 * 5, factors);
            expect(wheels.chassisPoints).toBe(33);
            // Paying in 5% coins would have cost more — the rule is not a rounding
            // convenience, it changes the price.
            expect(6 * factors.five).toBe(36);
        });

        it('should price the CIMDR-13 two legs exactly as the statblock prints them', () => {
            // "Limbs | 2 Legs | -17/+17". Two limbs at 5% each = 10% = one factor.
            const { factors } = AlternityMathService.calculateChassisPoints('Large', 13);
            expect(AlternityMathService.decomposeChassisPercent(2 * 5, factors).chassisPoints).toBe(17);
        });

        it('should cost nothing for a zero percentage', () => {
            const r = AlternityMathService.decomposeChassisPercent(0, { ten: 11, five: 6, one: 1 });
            expect(r.chassisPoints).toBe(0);
            expect(r.factorCount).toBe(0);
        });
    });

    describe('AlternityMathService — Robot Derived Stats', () => {

        it('should weight the action check toward Intelligence', () => {
            // AC = (2 x INT + DEX) / 3 — the book's three worked examples.
            expect(AlternityMathService.calculateRobotActionCheck(4, 2).base).toBe(3);
            expect(AlternityMathService.calculateRobotActionCheck(13, 11).base).toBe(12);
            expect(AlternityMathService.calculateRobotActionCheck(16, 16).base).toBe(16);
        });

        it('should reproduce the CIMDR-13 action check line in full', () => {
            // "Action check: 8. Profession bonus is +3.
            //  Marginal: 12+, Ordinary: 11, Good: 5, Amazing: 2"
            const r = AlternityMathService.calculateRobotActionCheck(8, 7, { profession: 'Combat Spec' });
            expect(r.base).toBe(8);
            expect(r.bonus).toBe(3);
            expect([r.marginal, r.ordinary, r.good, r.amazing]).toEqual([12, 11, 5, 2]);
        });

        it('should differ from the biological formula for the same scores', () => {
            // A hero with INT 13 / DEX 11 checks at (13+11)/2 = 12; so does this
            // robot, but move the same total toward DEX and they diverge.
            expect(AlternityMathService.calculateRobotActionCheck(11, 13).base).toBe(12);
            expect(AlternityMathService.calculateRobotActionCheck(16, 4).base).toBe(12);
            // The biological score for INT 16 / DEX 4 would be 10, not 12.
        });

        it('should accept an explicit profession bonus over the derived one', () => {
            // "Robots without profession benefits ... do not gain any increase."
            const r = AlternityMathService.calculateRobotActionCheck(8, 7, {
                profession: 'Combat Spec', bonus: 0,
            });
            expect(r.ordinary).toBe(8);
        });

        it('should derive actions per round from INT + DEX, floored at 1', () => {
            expect(AlternityMathService.calculateRobotActionsPerRound(5, 1).actionsPerRound).toBe(1);
            expect(AlternityMathService.calculateRobotActionsPerRound(16, 18).actionsPerRound).toBe(4);
            expect(AlternityMathService.calculateRobotActionsPerRound(8, 7).formulaValue).toBe(2);
        });

        it('should let the cabling cap a fast brain', () => {
            // The CIMDR-13: 2 by formula, 3 from a Good PL5 processor, 2 from
            // Parallel cabling — the cabling is what actually binds.
            const r = AlternityMathService.calculateRobotActionsPerRound(8, 7, {
                processorMax: 3, cablingMax: 2,
            });
            expect(r.actionsPerRound).toBe(2);

            const wired = AlternityMathService.calculateRobotActionsPerRound(16, 18, {
                processorMax: 4, cablingMax: 1,
            });
            expect(wired.actionsPerRound).toBe(1);
            expect(wired.cappedBy).toBe('cabling');
        });

        it('should report the processor when that is the binding ceiling', () => {
            const r = AlternityMathService.calculateRobotActionsPerRound(16, 18, {
                processorMax: 2, cablingMax: 4,
            });
            expect(r.actionsPerRound).toBe(2);
            expect(r.cappedBy).toBe('processor');
        });

        it('should give robots no fatigue track', () => {
            // "Thus, a robot with constitution score of 13 would have 13 stun
            //  points, 13 wound points and 7 mortal points."
            const r = AlternityMathService.calculateRobotDurability(13);
            expect([r.stun, r.wound, r.mortal]).toEqual([13, 13, 7]);
            expect(r.fatigue).toBeNull();
        });

        it('should give a biological chassis its fatigue track back', () => {
            expect(AlternityMathService.calculateRobotDurability(13, { hasFatigueTrack: true }).fatigue).toBe(7);
        });

        it('should budget skill points as 30 + 3 x INT plus the perk/flaw balance', () => {
            // CIMDR-13: "Skill points gained: 54 + 2 (perk/flaw) = 56SP"
            expect(AlternityMathService.calculateRobotSkillPoints(8).total).toBe(54);
            expect(AlternityMathService.calculateRobotSkillPoints(8, 2).total).toBe(56);

            const overspent = AlternityMathService.calculateRobotSkillPoints(8, 2, 60);
            expect(overspent.remaining).toBe(-4);
            expect(overspent.isOverspent).toBe(true);
        });
    });

    describe('AlternityMathService — Robot Active Memory', () => {

        it('should always charge a slot for the operating system', () => {
            const r = AlternityMathService.calculateRobotMemoryLoad(5, []);
            expect(r.used).toBe(1);
            expect(r.remaining).toBe(4);
        });

        it('should charge one slot per broad skill and one per loaded rank', () => {
            // The CIMDR-13's Good PL5 processor gives 5 slots: "One slot is needed
            // for OS, one for a broad skill, and three are left for a speciality."
            const r = AlternityMathService.calculateRobotMemoryLoad(5, [
                { name: 'Heavy Weapons', isBroad: true },
                { name: 'Direct fire', isBroad: false, ranksLoaded: 3 },
            ]);
            expect(r.used).toBe(5);
            expect(r.isFull).toBe(true);
            expect(r.isOverloaded).toBe(false);
        });

        it('should allow a specialty skill to be part-loaded', () => {
            // "A robot with 8 ranks in two skills but only 10 available active slots
            //  ... could load 5 ranks from each skill."
            const r = AlternityMathService.calculateRobotMemoryLoad(12, [
                { name: 'Broad', isBroad: true },
                { name: 'First',  ranksLoaded: 5 },
                { name: 'Second', ranksLoaded: 5 },
            ]);
            expect(r.skillSlots).toBe(11);
            expect(r.used).toBe(12);
        });

        it('should ignore skills that are not loaded', () => {
            const r = AlternityMathService.calculateRobotMemoryLoad(5, [
                { name: 'Stowed', ranksLoaded: 4, isLoaded: false },
            ]);
            expect(r.used).toBe(1);
        });

        it('should reserve slots for chipsets', () => {
            // "an Amazing-quality boost chipset that managed to provide a -3 action
            //  check modifier would require 3 memory slots."
            const r = AlternityMathService.calculateRobotMemoryLoad(5, [], { reservedSlots: 3 });
            expect(r.used).toBe(4);
            expect(r.reservedSlots).toBe(3);
        });

        it('should report an overloaded processor', () => {
            const r = AlternityMathService.calculateRobotMemoryLoad(3, [
                { name: 'Broad', isBroad: true },
                { name: 'Spec', ranksLoaded: 4 },
            ]);
            expect(r.isOverloaded).toBe(true);
            expect(r.remaining).toBeLessThan(0);
        });

        it('should let an installed AI swallow every slot', () => {
            // "When an AI is loaded it fills up all the memory slots the processor
            //  had ... any hardware system that requires a memory slot can no
            //  longer be used."
            const r = AlternityMathService.calculateRobotMemoryLoad(10, [
                { name: 'Broad', isBroad: true },
            ], { hasAI: true });
            expect(r.remaining).toBe(0);
            expect(r.isFull).toBe(true);
            expect(r.isOverloaded).toBe(false);
        });

        it('should never overload a PL9 brain', () => {
            // The quantum processor has no limit on active memory slots.
            const r = AlternityMathService.calculateRobotMemoryLoad(null, [
                { name: 'Spec', ranksLoaded: 40 },
            ]);
            expect(r.isUnlimited).toBe(true);
            expect(r.isOverloaded).toBe(false);
            expect(r.remaining).toBe(Infinity);
        });

        it('should reject a non-array skill list', () => {
            expect(() => AlternityMathService.calculateRobotMemoryLoad(5, 'nope')).toThrow();
        });
    });

    // -----------------------------------------------------------------------
    // Artificial intelligences
    //
    // Dataware Ch.5 prints six complete AIs. Its own hardware table is destroyed
    // in the scan, so those six statblocks are the regression suite: everything
    // below is asserted against numbers that appear verbatim in the book.
    // -----------------------------------------------------------------------

    describe('AlternityMathService — AI Grid Avatar', () => {

        it('should build the Watchman’s avatar from a Marginal OS with no hacking', () => {
            // "Marginal Quality AI Operating System Program" — STR 6, DEX 6, CON 6,
            // Durability 6/6/3, Grid Movement Rate 12.
            const a = AlternityMathService.calculateAIGridAvatar('Marginal', 0);
            expect(a).toMatchObject({ STR: 6, DEX: 6, CON: 6, gridMovementRate: 12 });
            expect(a.durability).toEqual({ stun: 6, wound: 6, mortal: 3 });
        });

        it('should add half the hacking rank to every physical score', () => {
            // Government Data Warden: Good OS (9/9/10) with hacking 4 prints
            // STR 11, DEX 11, CON 12, Durability 12/12/6, movement 22.
            const a = AlternityMathService.calculateAIGridAvatar('Good', 4);
            expect(a).toMatchObject({ STR: 11, DEX: 11, CON: 12, hackingBonus: 2, gridMovementRate: 22 });
            expect(a.durability).toEqual({ stun: 12, wound: 12, mortal: 6 });
        });

        it('should round the hacking bonus down', () => {
            // Ship's AI: Ordinary OS (8/8/8) with hacking 2 prints 9/9/9, 9/9/5.
            const a = AlternityMathService.calculateAIGridAvatar('Ordinary', 2);
            expect(a).toMatchObject({ STR: 9, DEX: 9, CON: 9, hackingBonus: 1 });
            expect(a.durability).toEqual({ stun: 9, wound: 9, mortal: 5 });

            // 3 ranks still only buys +1.
            expect(AlternityMathService.calculateAIGridAvatar('Ordinary', 3).hackingBonus).toBe(1);
        });

        it('should reach the Grid Lord’s scores at hacking 8', () => {
            // Good OS, hacking 8 (+4): STR 13, DEX 13, CON 14, movement 26.
            const a = AlternityMathService.calculateAIGridAvatar('Good', 8);
            expect(a).toMatchObject({ STR: 13, DEX: 13, CON: 14, gridMovementRate: 26 });
            expect(a.durability.mortal).toBe(7);
        });

        it('should use the shadow form 2 table when asked', () => {
            const a = AlternityMathService.calculateAIGridAvatar('Amazing', 0, { program: 'shadowForm2' });
            expect(a).toMatchObject({ STR: 12, DEX: 12, CON: 14 });
        });

        it('should reject an unknown quality or generator program', () => {
            expect(() => AlternityMathService.calculateAIGridAvatar('Legendary', 0)).toThrow();
            expect(() => AlternityMathService.calculateAIGridAvatar('Good', 0, { program: 'nope' })).toThrow();
        });
    });

    describe('AlternityMathService — AI Action Check', () => {

        it('should reproduce the Watchman’s action check', () => {
            // Marginal program on an Ordinary processor: 13+/12/6/3, 1 action.
            const r = AlternityMathService.calculateAIActionCheck('Marginal', 'Ordinary');
            expect(r).toMatchObject({ marginal: 13, ordinary: 12, good: 6, amazing: 3, actionsPerRound: 1 });
        });

        it('should reproduce the Ship’s AI action check', () => {
            // Ordinary program on a Good processor: 16+/15/7/3, 2 actions.
            const r = AlternityMathService.calculateAIActionCheck('Ordinary', 'Good');
            expect(r).toMatchObject({ marginal: 16, ordinary: 15, good: 7, amazing: 3, actionsPerRound: 2 });
        });

        it('should reproduce the Grid Lord’s action check', () => {
            // Good program on an Amazing processor: 19+/18/9/4, 4 actions.
            const r = AlternityMathService.calculateAIActionCheck('Good', 'Amazing');
            expect(r).toMatchObject({ marginal: 19, ordinary: 18, good: 9, amazing: 4, actionsPerRound: 4 });
        });

        it('should add the achievement level bonus on top of the grid base', () => {
            // Government Data Warden, Level 16: Good on Good gives a base of 16,
            // and the statblock prints 21+/20/10/5 with 3 actions.
            const r = AlternityMathService.calculateAIActionCheck('Good', 'Good', { bonus: 4 });
            expect(r).toMatchObject({ baseScore: 16, marginal: 21, ordinary: 20, good: 10, amazing: 5, actionsPerRound: 3 });

            // Freeborn Grid Sentient: Good on Ordinary, base 14, prints 18+/17/8/4.
            const f = AlternityMathService.calculateAIActionCheck('Good', 'Ordinary', { bonus: 3 });
            expect(f).toMatchObject({ marginal: 18, ordinary: 17, good: 8, amazing: 4, actionsPerRound: 3 });
        });

        it('should not clamp a score at 20', () => {
            // "Values of 20 or greater still fail on a result of 20 on the control
            //  die, but may succeed on higher totals of the control die plus
            //  situation die." An AI with an action check of 24 is legal.
            const r = AlternityMathService.calculateAIActionCheck('Amazing', 'Amazing', { bonus: 5 });
            expect(r.ordinary).toBe(24);
            expect(r.amazing).toBe(6);
        });

        it('should reject an unknown quality on either axis', () => {
            expect(() => AlternityMathService.calculateAIActionCheck('Good', 'Legendary')).toThrow();
            expect(() => AlternityMathService.calculateAIActionCheck('Legendary', 'Good')).toThrow();
        });
    });

    describe('AlternityMathService — AI Grid Skill Score', () => {

        it('should be Intelligence plus the hacking rank, halved and quartered', () => {
            // Grid Lord: INT 18, hacking 8 — printed 26/13/6.
            expect(AlternityMathService.calculateGridSkillScore(18, 8))
                .toMatchObject({ ordinary: 26, good: 13, amazing: 6 });
            // Watchman: INT 14, no hacking — printed 14/7/3.
            expect(AlternityMathService.calculateGridSkillScore(14, 0))
                .toMatchObject({ ordinary: 14, good: 7, amazing: 3 });
            // Government Data Warden: INT 18, hacking 4 — printed 22/11/5.
            expect(AlternityMathService.calculateGridSkillScore(18, 4))
                .toMatchObject({ ordinary: 22, good: 11, amazing: 5 });
        });
    });

    describe('AlternityMathService — AI Active Memory', () => {

        it('should charge nothing for the operating system', () => {
            // The decisive difference from a robot, whose OS permanently holds a slot:
            // "The operating system does not take up any of the available slots of
            //  active memory allowed to the AI."
            const r = AlternityMathService.calculateAIMemoryLoad(7, []);
            expect(r.used).toBe(0);
            expect(r.remaining).toBe(7);
        });

        it('should charge one slot per broad skill and one per loaded rank', () => {
            const r = AlternityMathService.calculateAIMemoryLoad(7, [
                { name: 'Computer Science', isBroad: true },
                { name: 'hacking', ranksLoaded: 6 },
            ]);
            expect(r.used).toBe(7);
            expect(r.isFull).toBe(true);
            expect(r.isOverloaded).toBe(false);
        });

        it('should reserve slots for loaded Grid programs', () => {
            const r = AlternityMathService.calculateAIMemoryLoad(10, [
                { name: 'AI Functions', isBroad: true },
            ], { reservedSlots: 4 });
            expect(r.reservedSlots).toBe(4);
            expect(r.used).toBe(5);
        });

        it('should ignore skills that are not loaded', () => {
            const r = AlternityMathService.calculateAIMemoryLoad(4, [
                { name: 'Stowed', ranksLoaded: 6, isLoaded: false },
            ]);
            expect(r.used).toBe(0);
            expect(r.isOverloaded).toBe(false);
        });

        it('should report an overloaded mainframe', () => {
            const r = AlternityMathService.calculateAIMemoryLoad(4, [
                { name: 'Broad', isBroad: true },
                { name: 'Spec', ranksLoaded: 6 },
            ]);
            expect(r.isOverloaded).toBe(true);
            expect(r.remaining).toBeLessThan(0);
        });

        it('should never overload a supercomputer with a neural matrix', () => {
            // "The number of active slots these computers have is effectively
            //  unlimited."
            const r = AlternityMathService.calculateAIMemoryLoad(10, [
                { name: 'Spec', ranksLoaded: 40 },
            ], { isUnlimited: true });
            expect(r.isUnlimited).toBe(true);
            expect(r.isOverloaded).toBe(false);
            expect(r.remaining).toBe(Infinity);
        });

        it('should reject a non-array skill list', () => {
            expect(() => AlternityMathService.calculateAIMemoryLoad(7, 'nope')).toThrow();
        });
    });

    describe('AlternityMathService — AI Skill Restrictions', () => {

        it('should bar every physical skill outright', () => {
            // "all Strength, Dexterity, and Constitution skills are unavailable to AIs."
            for (const ability of ['STR', 'DEX', 'CON']) {
                const r = AlternityMathService.getAISkillRestriction('Athletics', ability);
                expect(r.isBarred).toBe(true);
            }
        });

        it('should bar the three named specialties', () => {
            // "The following Will skills can't be loaded into a program:
            //  Awareness-intuition, Resolve-mental or physical."
            expect(AlternityMathService.getAISkillRestriction('Awareness-intuition').isBarred).toBe(true);
            expect(AlternityMathService.getAISkillRestriction('Resolve-mental').isBarred).toBe(true);
            expect(AlternityMathService.getAISkillRestriction('Resolve-physical').isBarred).toBe(true);
            // Awareness-perception is fine — every printed AI has it.
            expect(AlternityMathService.getAISkillRestriction('Awareness-perception').isBarred).toBe(false);
        });

        it('should penalise the social broad skills', () => {
            // "Deception, +1; Interaction, +2; Leadership, +3" and Creativity +3.
            expect(AlternityMathService.getAISkillRestriction('Deception').penalty).toBe(1);
            expect(AlternityMathService.getAISkillRestriction('Interaction').penalty).toBe(2);
            expect(AlternityMathService.getAISkillRestriction('Leadership').penalty).toBe(3);
            expect(AlternityMathService.getAISkillRestriction('Creativity').penalty).toBe(3);
        });

        it('should apply a broad skill’s penalty to its specialties', () => {
            // The Freeborn Grid Sentient carries Interaction-bargain 3.
            const r = AlternityMathService.getAISkillRestriction('Interaction-bargain');
            expect(r).toMatchObject({ isBarred: false, penalty: 2 });
        });

        it('should leave an AI’s own ground clear', () => {
            expect(AlternityMathService.getAISkillRestriction('Knowledge-mathematics', 'INT'))
                .toMatchObject({ isBarred: false, penalty: 0, reason: null });
            expect(AlternityMathService.getAISkillRestriction('Computer Science-hacking', 'INT').penalty).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Supporting cast
    //
    // The Gamemaster Guide prints four legible supporting-character templates,
    // each at four qualities. Those sixteen columns are the regression suite:
    // every one of them must fall out of the hero action check formula, because
    // the book's whole claim about supporting cast is that they use it.
    // -----------------------------------------------------------------------

    describe('AlternityMathService — Supporting Cast Action Check', () => {

        // [name, profession, [DEX, INT, expected ordinary] per quality M/O/G/A]
        const TEMPLATES = [
            ['Administrator', 'Diplomat', [
                [9, 9, 9], [10, 10, 11], [11, 11, 12], [11, 12, 12],
            ]],
            ['Bartender', 'Diplomat', [
                [8, 8, 8], [9, 9, 10], [10, 10, 11], [11, 11, 12],
            ]],
            ['Brawler', 'Combat Spec', [
                [9, 8, 8], [10, 9, 12], [11, 10, 13], [12, 11, 14],
            ]],
            ['Corporate Executive', 'Diplomat', [
                [9, 10, 9], [10, 11, 11], [11, 12, 12], [12, 13, 13],
            ]],
        ];
        const QUALITIES = ['Marginal', 'Ordinary', 'Good', 'Amazing'];

        it.each(TEMPLATES)('should reproduce every printed column of the %s template', (name, profession, columns) => {
            columns.forEach(([dex, int, expected], i) => {
                const quality = QUALITIES[i];
                const r = AlternityMathService.calculateActionCheckScore(dex, int, {
                    profession,
                    // "Marginal characters — average members of society — are
                    // nonprofessionals", so the tier suppresses the bonus.
                    isNonprofessional: quality === 'Marginal',
                });
                expect(r.ordinary).toBe(expected);
                expect(r.marginal).toBe(expected + 1);
                expect(r.good).toBe(Math.floor(expected / 2));
                expect(r.amazing).toBe(Math.floor(expected / 4));
            });
        });

        it('should give a nonprofessional no bonus at all', () => {
            const r = AlternityMathService.calculateActionCheckScore(10, 10, { profession: 'Nonprofessional' });
            expect(r).toMatchObject({ base: 10, professionBonus: 0, ordinary: 10 });
        });

        it('should apply each profession bonus as its benefits list prints it', () => {
            const at = (profession) => AlternityMathService
                .calculateActionCheckScore(10, 10, { profession }).professionBonus;
            expect(at('Combat Spec')).toBe(3);   // PHB Ch.2
            expect(at('Free Agent')).toBe(2);    // PHB Ch.2
            expect(at('Diplomat')).toBe(1);      // PHB Ch.2
            expect(at('Tech Op')).toBe(1);       // PHB Ch.2
            expect(at('Mindwalker')).toBe(1);    // Mindwalking Ch.1
        });

        it('should give a hero the Mindwalker bonus the sheet used to miss', () => {
            // The hand-rolled copy of this formula on AlternityCharacterState matched
            // only "combat" / "free"|"agent" / "diplomat"|"tech", so a Mindwalker
            // silently scored a point low.
            const state = new AlternityCharacterState({
                actorId: 'test-mindwalker',
                abilityScores: { STR: 10, DEX: 11, CON: 10, INT: 13, WIL: 10, PER: 10 },
                profession: 'Mindwalker',
            });
            expect(state.getActionCheckData().ordinary).toBe(13);
        });

        it('should let an explicit bonus override the profession', () => {
            const r = AlternityMathService.calculateActionCheckScore(10, 10, {
                profession: 'Combat Spec', bonus: 0,
            });
            expect(r.ordinary).toBe(10);
        });

        it('should round the ability half down', () => {
            // DEX 11 + INT 12 = 23, halved to 11, not 12.
            expect(AlternityMathService.calculateActionCheckScore(11, 12).base).toBe(11);
        });
    });

    describe('AlternityMathService — Reaction Score', () => {

        it('should put the number one below the actions per round', () => {
            // Holds across all seven fully printed creature statblocks: the bear
            // and the dog at 3 actions print /2, the buffalo and horse at 2 print /1.
            expect(AlternityMathService.calculateReactionScore(3).number).toBe(2);
            expect(AlternityMathService.calculateReactionScore(2).number).toBe(1);
            expect(AlternityMathService.calculateReactionScore(1).number).toBe(0);
        });

        it('should format the label as the book prints it', () => {
            expect(AlternityMathService.calculateReactionScore(3, { degree: 'Ordinary' }).label)
                .toBe('Ordinary/2');
            expect(AlternityMathService.calculateReactionScore(2, { degree: 'Marginal' }).label)
                .toBe('Marginal/1');
        });

        it('should fall back to Ordinary for an unknown degree', () => {
            expect(AlternityMathService.calculateReactionScore(2, { degree: 'Legendary' }).degree)
                .toBe('Ordinary');
        });
    });

    describe('NpcData migration — retiring the non-canonical fields', () => {

        const migrate = (source) => NpcData.migrateData({ ...source });

        it('should map Challenge Rating onto the book’s quality tiers', () => {
            expect(migrate({ cr: 'Easy' }).quality).toBe('Marginal');
            expect(migrate({ cr: 'Average' }).quality).toBe('Ordinary');
            expect(migrate({ cr: 'Tough' }).quality).toBe('Good');
            expect(migrate({ cr: 'Overwhelming' }).quality).toBe('Amazing');
            expect(migrate({ cr: 'Easy' }).cr).toBeUndefined();
        });

        it('should carry an armor-class bonus over as a resistance step', () => {
            const out = migrate({ defenseBonus: 3 });
            expect(out.resistanceBonus).toBe(3);
            expect(out.defenseBonus).toBeUndefined();
        });

        it('should turn the elite flag into the extra action it granted', () => {
            expect(migrate({ isElite: true, actionsPerRound: 2 }).actionsPerRound).toBe(3);
            expect(migrate({ isElite: false, actionsPerRound: 2 }).actionsPerRound).toBe(2);
        });

        it('should fold a flat attack bonus and damage formula into one attack row', () => {
            const out = migrate({ attackBonus: 12, damageFormula: '2d6+3' });
            expect(out.attacks).toHaveLength(1);
            expect(out.attacks[0]).toMatchObject({ score: 12, damageOrdinary: '2d6+3' });
            expect(out.attackBonus).toBeUndefined();
            expect(out.damageFormula).toBeUndefined();
        });

        it('should not invent an attack row from untouched defaults', () => {
            expect(migrate({ attackBonus: 0, damageFormula: '1d6' }).attacks).toBeUndefined();
        });

        it('should preserve morale and reward XP as prose rather than dropping them', () => {
            const out = migrate({ morale: 75, rewardXP: 250 });
            expect(out.tactics).toContain('Morale 75');
            expect(out.tactics).toContain('Reward XP 250');
            expect(out.morale).toBeUndefined();
            expect(out.rewardXP).toBeUndefined();
        });

        it('should stay quiet when morale and XP were never changed', () => {
            expect(migrate({ morale: 50, rewardXP: 100 }).tactics).toBeUndefined();
        });
    });

    describe('AI hardware table', () => {

        it('should cap skill rank one below the slot count, and never above 12', () => {
            // "an AI may not have a skill rank higher than one less than its number
            //  of active memory slots." Every printed row obeys it except PL 6,
            //  whose single row prints a hard 4.
            for (const [key, row] of Object.entries(AI_PROCESSORS)) {
                if (key === 'PL6-Amazing') continue;
                expect(row.maxSkillRank).toBe(Math.min(AI_MAX_SKILL_RANK, row.activeSlots - 1));
            }
            expect(AI_PROCESSORS['PL6-Amazing'].maxSkillRank).toBe(4);
        });

        it('should follow one modifier law across every printed cell', () => {
            // step = 7 - progressLevel - qualityIndex, which reproduces the Player's
            // Handbook's own +d4/+d0/-d4/-d6 ladder as the PL 6 row.
            for (const row of Object.values(AI_PROCESSORS)) {
                const qualityIndex = AI_QUALITIES.indexOf(row.quality);
                expect(row.step).toBe(7 - row.progressLevel - qualityIndex);
            }
        });

        it('should match the values printed in the statblocks', () => {
            expect(AI_PROCESSORS['PL6-Amazing']).toMatchObject({ activeSlots: 9,  actionCheckModifier: '-d6' });
            expect(AI_PROCESSORS['PL7-Ordinary']).toMatchObject({ activeSlots: 7,  actionCheckModifier: '-d4' });
            expect(AI_PROCESSORS['PL7-Good']).toMatchObject({ activeSlots: 10, maxSkillRank: 9 });
            expect(AI_PROCESSORS['PL7-Amazing']).toMatchObject({ activeSlots: 13, actionCheckModifier: '-d8' });
            expect(AI_PROCESSORS['PL8-Ordinary']).toMatchObject({ activeSlots: 10, actionCheckModifier: '-d6' });
            expect(AI_PROCESSORS['PL8-Good']).toMatchObject({ activeSlots: 15, maxSkillRank: 12 });
        });
    });
});