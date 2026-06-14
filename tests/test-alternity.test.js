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
});