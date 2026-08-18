/**
 * @fileoverview End-to-end tests for the roll pipeline: AlternityRollService's
 * checks, damage rolls, dodge defence and damage application.
 *
 * This is the code every sheet's roll button now runs through, and before this file
 * none of it had coverage — the previous roll implementation lived inside a sheet
 * class and was untestable, which is part of why the situation die was being
 * discarded and the chat card's breakdown footer was blank.
 *
 * Dice are scripted (see tests/mocks/roll-harness.js) so an assertion can name an
 * outcome. Localization is identity, so tests assert on keys rather than prose.
 */

import {
    installRollHarness, resetHarness, queueRolls, queueDialogs, makeActor, targetActor,
    placeToken, worldActors, chatLog, renderLog, notifications, dialogLog,
} from './mocks/roll-harness.js';

installRollHarness();

const { AlternityRollService } = await import('../src/services/alternity-roll-service.js');
const { AlternityMathService, SUCCESS_DEGREES } = await import('../src/services/alternity-math.js');
const { handleChatCardAction, chatCardHookName } = await import('../module_hooks/alt-mechanics.js');
const { Hooks } = await import('../src/module-info.js');

/** A trained specialty: score 12, so Good is 6 and Amazing is 3. */
const SCORES = { ordinary: 12, good: 6, amazing: 3 };

/** The one card the pipeline posted, or undefined. */
const lastCard = () => renderLog[renderLog.length - 1];

beforeEach(() => {
    resetHarness();
    Hooks._reset();
});

describe('AlternityRollService.rollCheck', () => {
    it('should roll the control die alone at base step 0 and resolve roll-under', async () => {
        const actor = makeActor();
        queueRolls([7]);

        const result = await AlternityRollService.rollCheck({
            actor, name: 'Stealth-sneak', context: 'Stealth', scores: SCORES, baseStep: 0,
        });

        expect(result.roll.formula).toBe('1d20');
        expect(result.controlRoll).toBe(7);
        expect(result.situationRoll).toBe(0);
        expect(result.finalValue).toBe(7);
        // 7 is over Good (6) but under Ordinary (12).
        expect(result.degree).toBe(SUCCESS_DEGREES.ORDINARY);
        expect(result.succeeded).toBe(true);
    });

    it('should roll and apply the situation die a penalty calls for', async () => {
        const actor = makeActor();
        // +2 steps is +1d6: control 5, situation 4, result 9.
        queueRolls([5, 4]);

        const result = await AlternityRollService.rollCheck({
            actor, name: 'Test', context: 'Test', scores: SCORES, baseStep: 0,
            modifiers: [AlternityMathService.buildModifier('Cover', 2, 'behind a crate')],
        });

        expect(result.roll.formula).toBe('1d20+1d6');
        expect(result.controlRoll).toBe(5);
        expect(result.situationRoll).toBe(4);
        expect(result.finalValue).toBe(9);
        expect(result.degree).toBe(SUCCESS_DEGREES.ORDINARY);
    });

    it('should subtract the situation die when the net step is a bonus', async () => {
        const actor = makeActor();
        // -2 steps is -1d6: control 8, situation 5, result 3 — an Amazing success.
        queueRolls([8, 5]);

        const result = await AlternityRollService.rollCheck({
            actor, name: 'Test', context: 'Test', scores: SCORES, baseStep: 0,
            modifiers: [AlternityMathService.buildModifier('Aim', -2, 'took careful aim')],
        });

        expect(result.roll.formula).toBe('1d20-1d6');
        expect(result.finalValue).toBe(3);
        expect(result.degree).toBe(SUCCESS_DEGREES.AMAZING);
    });

    it('should make a natural 20 a critical failure however good the situation die', async () => {
        const actor = makeActor();
        // -5 steps is -1d20. Control 20, situation 19 gives a result of 1, which
        // would otherwise be a runaway Amazing.
        queueRolls([20, 19]);

        const result = await AlternityRollService.rollCheck({
            actor, name: 'Test', context: 'Test', scores: SCORES, baseStep: 0,
            modifiers: [AlternityMathService.buildModifier('Ideal', -5, '')],
        });

        expect(result.finalValue).toBe(1);
        expect(result.degree).toBe(SUCCESS_DEGREES.CRITICAL_FAILURE);
        expect(result.succeeded).toBe(false);
    });

    it('should post a card carrying the scores, the trace and the result', async () => {
        const actor = makeActor({ name: 'Kel' });
        queueRolls([4]);

        await AlternityRollService.rollCheck({
            actor, name: 'Acrobatics', context: 'Movement', scores: SCORES, baseStep: 0,
        });

        expect(chatLog).toHaveLength(1);
        const card = lastCard();
        expect(card.path).toContain('roll-card.hbs');
        expect(card.context).toMatchObject({
            actorName: 'Kel',
            oga: SCORES,
            adjustedValue: 4,
            succeeded: true,
        });
        // The breakdown footer was blank for the life of the old implementation
        // because nothing ever supplied this value.
        expect(card.context.adjustedValue).not.toBeUndefined();
        expect(card.context.modifierTrace[0]).toMatchObject({ source: 'Base Step' });
    });

    describe('actor condition', () => {
        it('should apply a statblock actor\'s wound penalty and Dazed fatigue', async () => {
            const actor = makeActor({
                system: {
                    woundPenalty: 1,
                    durability: { fatigue: { value: 2, max: 6 } },
                },
            });
            queueRolls([6, 3]);

            const result = await AlternityRollService.rollCheck({
                actor, name: 'Test', context: 'Test', scores: SCORES, baseStep: 0,
            });

            // 1 wound + 2 fatigue = +3 steps, which is +1d8.
            expect(result.roll.formula).toBe('1d20+1d8');
            expect(result.modifierTrace.map((m) => m.source)).toEqual([
                'Base Step',
                'ALTERNITY.Modifier.WoundPenalty',
                'ALTERNITY.Modifier.Dazed',
            ]);
        });

        it('should charge the check penalty from worn armour', async () => {
            const actor = makeActor({
                items: [
                    { id: 'a1', type: 'armor', name: 'Battle Dress', system: { isEquipped: true, skillPenalty: 2 } },
                    { id: 'a2', type: 'armor', name: 'Spare', system: { isEquipped: false, skillPenalty: 5 } },
                ],
            });
            queueRolls([6, 2]);

            const result = await AlternityRollService.rollCheck({
                actor, name: 'Test', context: 'Test', scores: SCORES, baseStep: 0,
            });

            // Only the equipped suit counts, so +2 steps and not +7.
            expect(result.roll.formula).toBe('1d20+1d6');
            expect(result.modifierTrace.map((m) => m.value)).toEqual([0, 2]);
        });

        it('should skip the armour penalty for a check armour cannot hinder', async () => {
            const actor = makeActor({
                items: [{ id: 'a1', type: 'armor', name: 'Suit', system: { isEquipped: true, skillPenalty: 2 } }],
            });
            queueRolls([6]);

            const result = await AlternityRollService.rollCheck({
                actor, name: 'Test', context: 'Test', scores: SCORES, baseStep: 0,
                includeArmorPenalty: false,
            });

            expect(result.roll.formula).toBe('1d20');
        });
    });

    describe('Action Checks', () => {
        it('should downgrade a failure to a Marginal success', async () => {
            const actor = makeActor();
            queueRolls([17]); // over the Ordinary score of 12

            const result = await AlternityRollService.rollCheck({
                actor, name: 'Action Check', context: 'Action Check', scores: SCORES,
                baseStep: 0, isActionCheck: true,
            });

            expect(result.degree).toBe('Marginal');
            expect(result.succeeded).toBe(true);
            expect(result.badLuck).toBe(false);
        });

        it('should flag the Bad Luck Rule on a natural 20 but still succeed', async () => {
            const actor = makeActor();
            queueRolls([20]);

            const result = await AlternityRollService.rollCheck({
                actor, name: 'Action Check', context: 'Action Check', scores: SCORES,
                baseStep: 0, isActionCheck: true,
            });

            expect(result.degree).toBe('Marginal');
            expect(result.succeeded).toBe(true);
            expect(result.badLuck).toBe(true);
            expect(lastCard().context.badLuck).toBe(true);
        });

        it('should leave a genuine success alone', async () => {
            const actor = makeActor();
            queueRolls([2]);

            const result = await AlternityRollService.rollCheck({
                actor, name: 'Action Check', context: 'Action Check', scores: SCORES,
                baseStep: 0, isActionCheck: true,
            });

            expect(result.degree).toBe(SUCCESS_DEGREES.AMAZING);
            expect(result.badLuck).toBe(false);
        });
    });

    describe('hooks', () => {
        it('should let a listener veto the check before any dice are rolled', async () => {
            const actor = makeActor();
            queueRolls([1]);
            Hooks.on('alternity:preRollCheck', () => false);

            const result = await AlternityRollService.rollCheck({
                actor, name: 'Test', context: 'Test', scores: SCORES, baseStep: 0,
            });

            expect(result).toBeNull();
            expect(chatLog).toHaveLength(0);
        });

        it('should let a listener add a modifier that changes the die rolled', async () => {
            const actor = makeActor();
            queueRolls([6, 3]);
            Hooks.on('alternity:preRollCheck', (_a, options) => {
                options.modifiers.push(AlternityMathService.buildModifier('Module', 3, 'from a module'));
            });

            const result = await AlternityRollService.rollCheck({
                actor, name: 'Test', context: 'Test', scores: SCORES, baseStep: 0,
            });

            expect(result.roll.formula).toBe('1d20+1d8');
        });

        it('should announce the finished result', async () => {
            const actor = makeActor();
            queueRolls([3]);
            const seen = [];
            Hooks.on('alternity:rollCheck', (_a, payload) => seen.push(payload.degree));

            await AlternityRollService.rollCheck({
                actor, name: 'Test', context: 'Test', scores: SCORES, baseStep: 0,
            });

            expect(seen).toEqual([SUCCESS_DEGREES.AMAZING]);
        });
    });

    describe('attack damage payloads', () => {
        const damage = {
            name: 'Charge Rifle',
            codes: { ordinary: 'd4+1s', good: 'd4w', amazing: 'd6+2w' },
            damageType: 'En',
        };

        it('should offer the grade the achieved degree unlocks', async () => {
            const actor = makeActor();
            queueRolls([5]); // ≤ Good (6), > Amazing (3)

            const result = await AlternityRollService.rollCheck({
                actor, name: 'Charge Rifle', context: 'Ranged Attack',
                scores: SCORES, baseStep: 0, damage,
            });

            expect(result.damageSelection).toMatchObject({ grade: 'good', code: 'd4w' });
            expect(lastCard().context.damage).toMatchObject({ grade: 'good', code: 'd4w' });
        });

        it('should offer no damage at all on a miss', async () => {
            const actor = makeActor();
            queueRolls([18]);

            const result = await AlternityRollService.rollCheck({
                actor, name: 'Charge Rifle', context: 'Ranged Attack',
                scores: SCORES, baseStep: 0, damage,
            });

            expect(result.damageSelection.grade).toBeNull();
            expect(lastCard().context.damage).toBeNull();
        });

        it('should stash the payload in the message flags so the card outlives the sheet', async () => {
            const actor = makeActor();
            queueRolls([2]);

            await AlternityRollService.rollCheck({
                actor, name: 'Charge Rifle', context: 'Ranged Attack',
                scores: SCORES, baseStep: 0, damage,
            });

            expect(chatLog[0].flags['alternity'].check).toMatchObject({
                actorUuid: actor.uuid,
                degree: SUCCESS_DEGREES.AMAZING,
                damage: { grade: 'amazing' },
            });
        });
    });

    it('should refuse a check with no score to roll under', async () => {
        const actor = makeActor();
        await expect(AlternityRollService.rollCheck({
            actor, name: 'Test', context: 'Test', scores: null, baseStep: 0,
        })).rejects.toThrow(/scores\.ordinary/);
    });
});

describe('AlternityRollService.rollDamage', () => {
    it('should strip the grade letter and read the track off it', async () => {
        const actor = makeActor();
        queueRolls([3]);

        const result = await AlternityRollService.rollDamage({
            actor, name: 'Knife', code: 'd4+2w', grade: 'good', damageType: 'LI',
        });

        expect(result.roll.formula).toBe('1d4+2');
        expect(result.total).toBe(5);
        expect(result.category).toBe('wound');
        expect(lastCard().path).toContain('damage-card.hbs');
    });

    it('should add the wielder\'s bonus term to the code', async () => {
        const actor = makeActor();
        queueRolls([2]);

        const result = await AlternityRollService.rollDamage({
            actor, name: 'Sword', code: 'd6w', bonus: '+2',
        });

        expect(result.roll.formula).toBe('1d6 + +2');
        expect(result.total).toBe(4);
    });

    it('should floor the total at one when a Strength penalty could take it below', async () => {
        const actor = makeActor();
        queueRolls([1]);

        // Table P9's "to a minimum of 1" footnote: 1d4-3 rolling a 1 gives -2.
        const result = await AlternityRollService.rollDamage({
            actor, name: 'Club', code: 'd4w', bonus: '-3', minimumOne: true,
        });

        expect(result.total).toBe(1);
    });

    it('should refuse a code with nothing to roll rather than posting an empty card', async () => {
        const actor = makeActor();

        const result = await AlternityRollService.rollDamage({ actor, name: 'Fists', code: '' });

        expect(result).toBeNull();
        expect(chatLog).toHaveLength(0);
        expect(notifications.warn[0]).toContain('ALTERNITY.Roll.NoDamageCode');
    });

    it('should report a firepower degrade only when the target\'s toughness is known', async () => {
        const actor = makeActor();

        queueRolls([4]);
        const guessed = await AlternityRollService.rollDamage({
            actor, name: 'Pistol', code: 'd6w', firepower: 'Ordinary',
        });
        expect(guessed.degrade).toBeNull();

        queueRolls([4]);
        const known = await AlternityRollService.rollDamage({
            actor, name: 'Pistol', code: 'd6w', firepower: 'Ordinary', targetToughness: 'Amazing',
        });
        expect(known.degrade).not.toBeNull();
        expect(known.degrade.steps).toBeGreaterThan(0);
    });

    it('should stash the total and track in the flags for the apply button', async () => {
        const actor = makeActor();
        queueRolls([6]);

        await AlternityRollService.rollDamage({ actor, name: 'Rifle', code: 'd8+1m' });

        expect(chatLog[0].flags['alternity'].damage).toMatchObject({
            name: 'Rifle', total: 7, category: 'mortal',
        });
    });
});

describe('AlternityRollService.applyDamageToTargets', () => {
    it('should route a hero or supporting cast member through applyAlternityDamage', async () => {
        const target = makeActor({ type: 'npc' });
        const calls = [];
        target.applyAlternityDamage = async (...args) => { calls.push(args); return {}; };
        targetActor(target);

        const applied = await AlternityRollService.applyDamageToTargets({
            total: 6, category: 'wound', damageType: 'LI', name: 'Rifle',
        });

        expect(applied).toBe(1);
        expect(calls[0][0]).toBe(6);
        expect(calls[0][2]).toMatchObject({ category: 'wound' });
    });

    it('should write to a creature\'s nested tracks, secondary damage included', async () => {
        const target = makeActor({
            type: 'creature',
            system: {
                damage: { stun: { value: 0 }, wound: { value: 0 }, mortal: { value: 0 } },
                durability: {
                    stun: { max: 20 }, wound: { max: 20 }, mortal: { max: 10 },
                },
            },
        });
        targetActor(target);

        await AlternityRollService.applyDamageToTargets({
            total: 6, category: 'wound', damageType: 'LI', name: 'Bite',
        });

        // 6 wound, plus 3 secondary stun (1 per 2 wound). Armour never reduces the
        // secondary damage, which is why it is added on top rather than mitigated.
        expect(target.updates[0]).toEqual({
            'system.damage.stun.value': 3,
            'system.damage.wound.value': 6,
        });
    });

    it('should write to a robot\'s flat tracks', async () => {
        const target = makeActor({
            type: 'robot',
            system: {
                damage: { stun: 1, wound: 2, mortal: 0 },
                durability: { stun: { max: 12 }, wound: { max: 12 }, mortal: { max: 6 } },
            },
        });
        targetActor(target);

        await AlternityRollService.applyDamageToTargets({
            total: 4, category: 'mortal', damageType: 'HI', name: 'Cannon',
        });

        // 4 mortal, and 2 each of secondary stun and wound, on top of what was there.
        expect(target.updates[0]).toEqual({
            'system.damage.stun': 3,
            'system.damage.wound': 4,
            'system.damage.mortal': 4,
        });
    });

    it('should clamp a track at its maximum rather than running past it', async () => {
        const target = makeActor({
            type: 'robot',
            system: {
                damage: { stun: 0, wound: 10, mortal: 0 },
                durability: { stun: { max: 12 }, wound: { max: 12 }, mortal: { max: 6 } },
            },
        });
        targetActor(target);

        await AlternityRollService.applyDamageToTargets({
            total: 20, category: 'wound', damageType: 'LI', name: 'Cannon',
        });

        expect(target.updates[0]['system.damage.wound']).toBe(12);
    });

    it('should send a warship and a spaceship to their own damage systems', async () => {
        for (const type of ['warship', 'spaceship']) {
            resetHarness();
            const target = makeActor({ type, system: {} });
            targetActor(target);

            await AlternityRollService.applyDamageToTargets({
                total: 6, category: 'wound', damageType: 'LI', name: 'Beam',
            });

            expect(target.updates).toHaveLength(0);
            expect(notifications.info.join(' ')).toMatch(/ALTERNITY\.Roll\.Use/);
        }
    });

    it('should fall back to controlled tokens when nothing is targeted', async () => {
        const target = makeActor({
            type: 'robot',
            system: {
                damage: { stun: 0, wound: 0, mortal: 0 },
                durability: { stun: { max: 9 }, wound: { max: 9 }, mortal: { max: 5 } },
            },
        });
        globalThis.canvas.tokens.controlled = [{ actor: target }];

        const applied = await AlternityRollService.applyDamageToTargets({
            total: 2, category: 'stun', damageType: 'LI', name: 'Shock',
        });

        expect(applied).toBe(1);
    });

    it('should ask for a target rather than silently doing nothing', async () => {
        const applied = await AlternityRollService.applyDamageToTargets({
            total: 5, category: 'wound', damageType: 'LI', name: 'Rifle',
        });

        expect(applied).toBe(0);
        expect(notifications.warn).toContain('ALTERNITY.Roll.NoTargets');
    });

    it('should refuse a track it does not recognise', async () => {
        const applied = await AlternityRollService.applyDamageToTargets({
            total: 5, category: 'critical', damageType: 'LI', name: 'Beam',
        });

        expect(applied).toBe(0);
        expect(notifications.warn).toContain('ALTERNITY.Roll.UnknownDamageCategory');
    });
});

/**
 * A robot-shaped target: flat damage tracks, so an assertion can name the number
 * written rather than dig through a nested {value, max}.
 */
const damageableActor = (name = 'Target') => makeActor({
    type: 'robot',
    name,
    system: {
        damage: { stun: 0, wound: 0, mortal: 0 },
        durability: { stun: { max: 12 }, wound: { max: 12 }, mortal: { max: 6 } },
    },
});

/** One rolled hit, as the damage card stashes it in its flags. */
const HIT = Object.freeze({ total: 4, category: 'wound', damageType: 'LI', name: 'Rifle' });

/** The most recent render of a given template. */
const renderOf = (suffix) => renderLog.filter((r) => r.path.endsWith(suffix)).pop();

describe('Which actors a damage application lands on', () => {
    it('should read only the crosshairs when the scope is targets', async () => {
        const shot = damageableActor('Shot at');
        const mine = damageableActor('My own token');
        placeToken(shot, { targeted: true });
        placeToken(mine, { controlled: true });

        const applied = await AlternityRollService.applyDamageToTargets(HIT, { scope: 'targets' });

        expect(applied).toBe(1);
        expect(shot.updates[0]['system.damage.wound']).toBe(4);
        expect(mine.updates).toHaveLength(0);
    });

    it('should read only the selection when the scope is selected', async () => {
        const shot = damageableActor('Shot at');
        const picked = damageableActor('Picked by hand');
        placeToken(shot, { targeted: true });
        placeToken(picked, { controlled: true });

        const applied = await AlternityRollService.applyDamageToTargets(HIT, { scope: 'selected' });

        expect(applied).toBe(1);
        expect(picked.updates[0]['system.damage.wound']).toBe(4);
        // The point of a separate button: a live target must not soak the hit the
        // Gamemaster deliberately aimed at their selection.
        expect(shot.updates).toHaveLength(0);
    });

    it('should say which gesture it was looking for when it finds nothing', async () => {
        placeToken(damageableActor(), { controlled: true });
        expect(await AlternityRollService.applyDamageToTargets(HIT, { scope: 'targets' })).toBe(0);
        expect(notifications.warn).toContain('ALTERNITY.Roll.NoTargeted');

        resetHarness();
        placeToken(damageableActor(), { targeted: true });
        expect(await AlternityRollService.applyDamageToTargets(HIT, { scope: 'selected' })).toBe(0);
        expect(notifications.warn).toContain('ALTERNITY.Roll.NoSelection');
    });

    it('should damage an actor once even with two of its tokens selected', async () => {
        const target = damageableActor();
        placeToken(target, { controlled: true });
        placeToken(target, { controlled: true });

        const applied = await AlternityRollService.applyDamageToTargets(HIT, { scope: 'selected' });

        expect(applied).toBe(1);
        expect(target.updates).toHaveLength(1);
    });
});

describe('AlternityRollService.promptApplyDamage', () => {
    it('should offer placed tokens by token uuid and world actors by actor uuid', async () => {
        const placed = damageableActor('On the map');
        const token = placeToken(placed);
        const offstage = damageableActor('Never got a token');
        worldActors(placed, offstage);

        queueDialogs({ uuid: token.document.uuid });
        await AlternityRollService.promptApplyDamage(HIT);

        const { groups } = renderOf('apply-damage-dialog.hbs').context;
        expect(groups[0].label).toBe('ALTERNITY.Roll.SceneTokens');
        // A token is offered as itself, so an unlinked one takes the damage on its
        // own delta rather than on the world actor it was stamped from.
        expect(groups[0].options).toEqual([{ uuid: token.document.uuid, label: 'On the map' }]);
        expect(groups[1].options.map((o) => o.label)).toEqual(['Never got a token', 'On the map']);
    });

    it('should apply to an actor that has no token at all', async () => {
        const offstage = damageableActor('Offstage');
        worldActors(offstage);

        queueDialogs({ uuid: offstage.uuid });
        const applied = await AlternityRollService.promptApplyDamage(HIT);

        expect(applied).toBe(1);
        expect(offstage.updates[0]['system.damage.wound']).toBe(4);
    });

    it('should apply nothing when the prompt is dismissed', async () => {
        const offstage = damageableActor('Offstage');
        worldActors(offstage);

        queueDialogs(null);
        expect(await AlternityRollService.promptApplyDamage(HIT)).toBe(0);
        expect(offstage.updates).toHaveLength(0);
    });

    it('should leave out actors the user does not own', async () => {
        const mine = damageableActor('Mine');
        const theirs = damageableActor('Not mine');
        theirs.isOwner = false;
        placeToken(theirs);
        worldActors(mine, theirs);

        queueDialogs({ uuid: mine.uuid });
        await AlternityRollService.promptApplyDamage(HIT);

        const { groups } = renderOf('apply-damage-dialog.hbs').context;
        // Its token goes too: a picker is an invitation, and offering a choice the
        // update then refuses is worse than not offering it.
        expect(groups.map((g) => g.label)).toEqual(['ALTERNITY.Roll.WorldActors']);
        expect(groups[0].options).toEqual([{ uuid: mine.uuid, label: 'Mine' }]);
    });

    it('should not open a picker with nothing in it', async () => {
        expect(await AlternityRollService.promptApplyDamage(HIT)).toBe(0);
        expect(dialogLog).toHaveLength(0);
        expect(notifications.warn).toContain('ALTERNITY.Roll.NoActorsToDamage');
    });
});

describe('AlternityRollService.promptManualDamage', () => {
    /** The form as the dialog hands it back, all fields present. */
    const manualForm = (overrides = {}) => ({
        name: 'Bulkhead', total: 6, category: 'wound', damageType: 'LI',
        firepower: '', toughness: 'Ordinary', armor: '', ...overrides,
    });

    it('should resolve the whole sequence against typed-in numbers and write nothing', async () => {
        const bystander = damageableActor('Selected and targeted');
        placeToken(bystander, { controlled: true, targeted: true });

        queueDialogs(manualForm({ armor: 'd6-1' }));
        queueRolls([4]);                       // d6-1 -> 3 points of protection

        await AlternityRollService.promptManualDamage({ ...HIT, total: 6 });

        const { context } = renderOf('armor-card.hbs');
        expect(context).toMatchObject({
            targetName:    'Bulkhead',
            notApplied:    true,
            rawDamage:     6,
            armorAbsorbed: 3,
            primary:       3,          // 6 wound less 3 armour
        });
        // Armour never touches secondary damage: 6 wound still carries 3 stun.
        expect(context.secondaryLabel).toBe('3 ALTERNITY.Stun');
        // Nothing on the canvas is involved, however tempting the selection looks.
        expect(bystander.updates).toHaveLength(0);
    });

    it('should degrade the grade when the entered firepower falls short', async () => {
        queueDialogs(manualForm({ firepower: 'Ordinary', toughness: 'Good' }));

        await AlternityRollService.promptManualDamage(HIT);

        // Ordinary firepower against Good toughness: 6 wounds become 6 stuns, and a
        // stun grade carries no secondary damage.
        expect(renderOf('armor-card.hbs').context).toMatchObject({
            grade: 'stun', primary: 6, degradeSteps: 1, secondaryLabel: '',
        });
    });

    it('should post the card even when nothing was mitigated', async () => {
        queueDialogs(manualForm());

        await AlternityRollService.promptManualDamage(HIT);

        // The applied path suppresses an unmitigated card as noise; here the card is
        // the only output the click has, so it is forced.
        expect(renderOf('armor-card.hbs').context)
            .toMatchObject({ armorAbsorbed: 0, primary: 6, notApplied: true });
    });

    it('should refuse a protection rating it cannot read rather than assume zero', async () => {
        queueDialogs(manualForm({ armor: 'a good coat' }));

        expect(await AlternityRollService.promptManualDamage(HIT)).toBeNull();
        expect(notifications.warn).toContain('ALTERNITY.Armor.UnreadableRating');
        expect(chatLog).toHaveLength(0);
    });

    it('should treat a blank, a dash and a 0 as no armour, not as unreadable', async () => {
        for (const armor of ['', '-', '0', 'none']) {
            resetHarness();
            queueDialogs(manualForm({ armor }));

            await AlternityRollService.promptManualDamage(HIT);

            expect(notifications.warn).toHaveLength(0);
            expect(renderOf('armor-card.hbs').context.armorAbsorbed).toBe(0);
        }
    });

    it('should name the defender itself when the field is left empty', async () => {
        queueDialogs(manualForm({ name: '  ' }));

        await AlternityRollService.promptManualDamage(HIT);

        expect(renderOf('armor-card.hbs').context.targetName)
            .toBe('ALTERNITY.Roll.ManualDefender');
    });

    it('should post nothing when the prompt is dismissed', async () => {
        queueDialogs(null);
        expect(await AlternityRollService.promptManualDamage(HIT)).toBeNull();
        expect(chatLog).toHaveLength(0);
    });
});

describe('Armour mitigation', () => {
    /** An armour item as the item sheet stores one. */
    const armorItem = (name, protection, extra = {}) => ({
        id: `armor-${name}`, name, type: 'armor',
        system: { isEquipped: true, protection, toughness: 'Ordinary', ...extra },
    });

    describe('collectArmorRatings', () => {
        it('should collect worn armour, implants and natural armour into one list', async () => {
            const target = makeActor({
                type: 'creature',
                system: { naturalArmor: { li: 'd4', hi: '', en: 'd4-1' } },
                items: [
                    armorItem('Battle Vest', { li: 'd6-3', hi: 'd4', en: '' }),
                    { id: 'cyb', name: 'Dermal Plating', type: 'cybertech',
                        system: { isInstalled: true, armorProtection: { li: 'd6+2', hi: 'd6+1', en: 'd6+1' } } },
                    // Not worn and not installed: neither should be collected.
                    armorItem('Spare Suit', { li: 'd8', hi: 'd8', en: 'd8' }, { isEquipped: false }),
                    { id: 'cyb2', name: 'Uninstalled Plating', type: 'cybertech',
                        system: { isInstalled: false, armorProtection: { li: 'd8', hi: '', en: '' } } },
                ],
            });

            const ratings = await AlternityRollService.collectArmorRatings(target);
            expect(ratings.map((r) => r.source))
                .toEqual(['Battle Vest', 'Dermal Plating', 'ALTERNITY.Armor.Natural']);
        });

        it('should read an AI\'s CPU armour out of its physical form table', async () => {
            const target = makeActor({
                type: 'ai',
                system: { physicalForm: [
                    { name: 'Shell', kind: 'CPU Armor', value: 'd6+1' },
                    { name: 'Turret', kind: 'Weapon', value: 'd6w' },
                ] },
            });

            const ratings = await AlternityRollService.collectArmorRatings(target);
            // One printed value covers every form — the box is armoured, not rated
            // per damage type the way a suit is.
            expect(ratings).toEqual([
                { source: 'Shell', li: 'd6+1', hi: 'd6+1', en: 'd6+1', toughness: null },
            ]);
        });
    });

    describe('rollArmorProtection', () => {
        it('should roll the rating for the form that hit, and no other', async () => {
            const target = makeActor({
                type: 'creature',
                items: [armorItem('Battle Vest', { li: 'd6-3', hi: '2d4+1', en: '' })],
            });
            // One value is consumed, so only one rating can have been rolled.
            queueRolls([4]);

            const result = await AlternityRollService.rollArmorProtection({ actor: target, damageForm: 'LI' });
            expect(result.rolls).toHaveLength(1);
            expect(result.rolls[0].roll.formula).toBe('1d6-3');
            expect(result.value).toBe(1);
            expect(result.source).toBe('Battle Vest');
        });

        it('should stop nothing for a form the armour does not cover', async () => {
            const target = makeActor({
                type: 'creature',
                items: [armorItem('Battle Vest', { li: 'd6-1', hi: '', en: '' })],
            });

            const result = await AlternityRollService.rollArmorProtection({ actor: target, damageForm: 'En' });
            expect(result).toMatchObject({ value: 0, source: '' });
            expect(result.rolls).toHaveLength(0);
        });

        it('should keep only the best roll when protection is layered', async () => {
            const target = makeActor({
                type: 'creature',
                system: { naturalArmor: { li: 'd4', hi: '', en: '' } },
                items: [armorItem('Battle Vest', { li: 'd6', hi: '', en: '' })],
            });
            // Vest rolls 2, hide rolls 4 — the hide wins, and 6 would be the sum.
            queueRolls([2, 4]);

            const result = await AlternityRollService.rollArmorProtection({ actor: target, damageForm: 'LI' });
            expect(result.value).toBe(4);
            expect(result.source).toBe('ALTERNITY.Armor.Natural');
            expect(result.considered).toHaveLength(2);
        });

        it('should roll every layer, not just the one that ends up counting', async () => {
            const target = makeActor({
                type: 'creature',
                system: { naturalArmor: { li: 'd4', hi: '', en: '' } },
                items: [
                    armorItem('Battle Vest', { li: 'd6', hi: '', en: '' }),
                    { id: 'cyb', name: 'Dermal Plating', type: 'cybertech',
                        system: { isInstalled: true, armorProtection: { li: 'd8', hi: '', en: '' } } },
                ],
            });
            queueRolls([2, 7, 4]);

            const result = await AlternityRollService.rollArmorProtection({ actor: target, damageForm: 'LI' });
            // Three protections, three dice — and each one names the protection that
            // rolled it, because two anonymous dice cannot answer "did mine roll?".
            expect(result.rolls).toHaveLength(3);
            expect(result.rolls.map((r) => `${r.source} ${r.roll.formula}=${r.roll.total}`)).toEqual([
                'Battle Vest 1d6=2',
                'Dermal Plating 1d8=7',
                'ALTERNITY.Armor.Natural 1d4=4',
            ]);
            expect(result.source).toBe('Dermal Plating');
            expect(result.value).toBe(7);
        });

        it('should not roll a rating printed as a flat number', async () => {
            const target = makeActor({
                type: 'creature',
                system: { naturalArmor: { li: '3', hi: '', en: '' } },
                items: [armorItem('Battle Vest', { li: 'd6', hi: '', en: '' })],
            });
            queueRolls([2]);

            const result = await AlternityRollService.rollArmorProtection({ actor: target, damageForm: 'LI' });
            // One die for the vest; the flat 3 needs no roll but still competes — and
            // wins here, which is why a card with fewer dice than layers is correct.
            expect(result.rolls).toHaveLength(1);
            expect(result.considered).toHaveLength(2);
            expect(result.value).toBe(3);
        });

        it('should report the target\'s toughness, raised by what it wears', async () => {
            const target = makeActor({
                type: 'npc',
                system: { toughness: 'Ordinary' },
                items: [armorItem('Body Tank', { li: '2d4+1', hi: '2d4+1', en: '2d4+1' }, { toughness: 'Good' })],
            });
            queueRolls([6]);

            const result = await AlternityRollService.rollArmorProtection({ actor: target, damageForm: 'LI' });
            expect(result.toughness).toBe('Good');
        });

        it('should not roll a rating it cannot read, and should say so', async () => {
            // console.warn is captured by hand rather than with jest.spyOn: under ESM
            // the `jest` object is not a global, and the rest of the suite does it
            // this way too.
            const warnings = [];
            const realWarn = console.warn;
            console.warn = (...args) => warnings.push(args.join(' '));

            try {
                const target = makeActor({
                    type: 'creature',
                    items: [armorItem('Mystery Suit', { li: 'quite good', hi: '', en: '' })],
                });

                const result = await AlternityRollService.rollArmorProtection({ actor: target, damageForm: 'LI' });
                expect(result.value).toBe(0);
                expect(warnings.join(' | ')).toMatch(/could not read/);
            } finally {
                console.warn = realWarn;
            }
        });
    });

    describe('applied end to end', () => {
        it('should subtract the armour roll from a creature\'s primary damage only', async () => {
            const target = makeActor({
                type: 'creature',
                system: {
                    naturalArmor: { li: 'd6-4', hi: '', en: '' },
                    damage: { stun: { value: 0 }, wound: { value: 0 }, mortal: { value: 0 } },
                    durability: { stun: { max: 20 }, wound: { max: 20 }, mortal: { max: 10 } },
                },
            });
            targetActor(target);
            queueRolls([6]); // d6-4 rolls 6 -> stops 2

            await AlternityRollService.applyDamageToTargets({
                total: 6, category: 'wound', damageType: 'LI', name: 'Sword',
            });

            // The Gamemaster Guide's battle-vest example, run through the real pipeline:
            // 4 wounds get through, and all 3 secondary stuns do.
            expect(target.updates[0]).toEqual({
                'system.damage.stun.value': 3,
                'system.damage.wound.value': 4,
            });
        });

        it('should degrade before rolling armour when firepower falls short', async () => {
            const target = makeActor({
                type: 'creature',
                system: {
                    toughness: 'Good',
                    naturalArmor: { li: '1', hi: '', en: '' },
                    damage: { stun: { value: 0 }, wound: { value: 0 }, mortal: { value: 0 } },
                    durability: { stun: { max: 20 }, wound: { max: 20 }, mortal: { max: 10 } },
                },
            });
            targetActor(target);

            await AlternityRollService.applyDamageToTargets({
                total: 6, category: 'wound', damageType: 'LI', firepower: 'Ordinary', name: 'Sword',
            });

            // 6 wounds become 6 stuns, armour stops 1 -> 5 stun, and a stun hit has no
            // secondary damage, so the wound track is untouched.
            expect(target.updates[0]).toEqual({ 'system.damage.stun.value': 5 });
        });

        it('should hand the roll to a hero through applyAlternityDamage', async () => {
            const target = makeActor({
                type: 'npc',
                system: { toughness: 'Ordinary' },
                items: [armorItem('Battle Vest', { li: 'd6-3', hi: '', en: '' })],
            });
            const calls = [];
            target.applyAlternityDamage = async (...args) => { calls.push(args); return { armorAbsorbed: 2 }; };
            targetActor(target);
            queueRolls([5]); // d6-3 -> 2

            await AlternityRollService.applyDamageToTargets({
                total: 6, category: 'wound', damageType: 'LI', firepower: 'Ordinary', name: 'Sword',
            });

            expect(calls[0][1]).toBe('LI');
            expect(calls[0][2]).toMatchObject({
                category: 'wound', armorRoll: 2, armorSource: 'Battle Vest',
                firepower: 'Ordinary', toughness: 'Ordinary',
            });
        });

        it('should post a mitigation card so the armour roll is not hidden', async () => {
            const target = makeActor({
                type: 'creature',
                system: {
                    naturalArmor: { li: 'd6-4', hi: '', en: '' },
                    damage: { stun: { value: 0 }, wound: { value: 0 }, mortal: { value: 0 } },
                    durability: { stun: { max: 20 }, wound: { max: 20 }, mortal: { max: 10 } },
                },
            });
            targetActor(target);
            queueRolls([6]);

            await AlternityRollService.applyDamageToTargets({
                total: 6, category: 'wound', damageType: 'LI', name: 'Sword',
            });

            const card = renderLog.find((r) => r.path.endsWith('armor-card.hbs'));
            expect(card).toBeDefined();
            expect(card.context).toMatchObject({
                targetName: target.name, rawDamage: 6, primary: 4, armorAbsorbed: 2,
                armorSource: 'ALTERNITY.Armor.Natural', damageForm: 'LI',
            });
            // The armour die itself is attached to the message, not just described.
            expect(chatLog[chatLog.length - 1].rolls).toHaveLength(1);
        });

        it('should account for every layer on the card, not only the winner', async () => {
            // The bug this pins: the discarded rolls live in the armour roll's trace,
            // not in the damage resolution, so a path that forgets to carry them across
            // shows several dice and explains one — which reads as the other layers
            // never having rolled at all.
            const target = makeActor({
                type: 'creature',
                system: {
                    naturalArmor: { li: 'd4', hi: '', en: '' },
                    damage: { stun: { value: 0 }, wound: { value: 0 }, mortal: { value: 0 } },
                    durability: { stun: { max: 30 }, wound: { max: 30 }, mortal: { max: 15 } },
                },
                items: [armorItem('Battle Vest', { li: 'd6', hi: '', en: '' })],
            });
            targetActor(target);
            queueRolls([2, 4]); // vest 2, hide 4

            await AlternityRollService.applyDamageToTargets({
                total: 8, category: 'wound', damageType: 'LI', name: 'Sword',
            });

            const card = renderLog.find((r) => r.path.endsWith('armor-card.hbs'));
            expect(card.context.armorRolls.map((r) => [r.source, r.isWinner])).toEqual([
                ['Battle Vest', false],
                ['ALTERNITY.Armor.Natural', true],
            ]);
            // Both layers appear in the breakdown: the winner at its value, the
            // discarded one at 0 with the reason it did not count.
            const trace = card.context.trace;
            expect(trace.find((l) => l.source === 'Battle Vest')).toMatchObject({ value: 0 });
            expect(trace.find((l) => l.source === 'ALTERNITY.Armor.Natural')).toMatchObject({ value: -4 });
            // 8 wound, hide stops 4, and the 4 secondary stuns are untouched.
            expect(target.updates[0]).toEqual({
                'system.damage.stun.value': 4,
                'system.damage.wound.value': 4,
            });
        });

        it('should explain a layered hit the same way on both apply paths', async () => {
            // The statblock path and the hero path assemble the trace separately, so
            // they are asserted against each other rather than each on its own.
            const discarded = { source: 'Battle Vest', value: 0, reason: 'lost the layering roll' };
            const winner = { source: 'Dermal Plating', value: -5, reason: 'won' };

            const statblock = makeActor({
                type: 'creature',
                system: {
                    damage: { stun: { value: 0 }, wound: { value: 0 }, mortal: { value: 0 } },
                    durability: { stun: { max: 30 }, wound: { max: 30 }, mortal: { max: 15 } },
                },
            });
            const outcome = await AlternityRollService._applyTrackDamage(statblock, 8, 'LI', {
                category: 'wound', context: 'Test', armorRoll: 5,
                armorSource: 'Dermal Plating', armorTrace: [winner, discarded],
            });

            // The discarded layer is carried across; the winner is not duplicated,
            // because the resolution already traces the value it was handed.
            expect(outcome.modifierTrace.filter((l) => l.source === 'Battle Vest')).toHaveLength(1);
            expect(outcome.modifierTrace.filter((l) => l.source === 'Dermal Plating')).toHaveLength(1);
            expect(outcome.modifierTrace.find((l) => l.source === 'Dermal Plating').value).toBe(-5);
        });

        it('should stay quiet when nothing reduced the damage', async () => {
            const target = makeActor({
                type: 'creature',
                system: {
                    damage: { stun: { value: 0 }, wound: { value: 0 }, mortal: { value: 0 } },
                    durability: { stun: { max: 20 }, wound: { max: 20 }, mortal: { max: 10 } },
                },
            });
            targetActor(target);

            await AlternityRollService.applyDamageToTargets({
                total: 6, category: 'wound', damageType: 'LI', name: 'Sword',
            });

            // An unmitigated hit is already fully described by the damage card.
            expect(renderLog.some((r) => r.path.endsWith('armor-card.hbs'))).toBe(false);
        });
    });
});

describe('Dodge defence', () => {
    it('should store the step adjustment on the defender for the next attack', async () => {
        const actor = makeActor();
        queueRolls([5]); // ≤ Good (6): a 2-step adjustment

        const result = await AlternityRollService.rollDodge({ actor, scores: SCORES, baseStep: 0 });

        expect(result.degree).toBe(SUCCESS_DEGREES.GOOD);
        expect(result.dodge.steps).toBe(2);
        expect(actor.flags['alternity'].pendingDodge).toMatchObject({ steps: 2 });
    });

    it('should hand the stored adjustment to the attacker, then spend it', async () => {
        const defender = makeActor();
        queueRolls([2]); // Amazing: 3 steps
        await AlternityRollService.rollDodge({ actor: defender, scores: SCORES, baseStep: 0 });

        const first = await AlternityRollService.readPendingDodge(defender);
        expect(first).toHaveLength(1);
        expect(first[0].value).toBe(3);

        // The rule spends it on one attack, so the second attack gets nothing.
        expect(await AlternityRollService.readPendingDodge(defender)).toHaveLength(0);
    });

    it('should discard a dodge left over from an earlier round', async () => {
        const defender = makeActor();
        globalThis.game.combat = { round: 3 };
        queueRolls([2]);
        await AlternityRollService.rollDodge({ actor: defender, scores: SCORES, baseStep: 0 });

        globalThis.game.combat = { round: 4 };
        expect(await AlternityRollService.readPendingDodge(defender)).toHaveLength(0);
    });

    it('should make a fumbled dodge help the attacker instead', async () => {
        const actor = makeActor();
        queueRolls([20]);

        const result = await AlternityRollService.rollDodge({ actor, scores: SCORES, baseStep: 0 });

        expect(result.degree).toBe(SUCCESS_DEGREES.CRITICAL_FAILURE);
        expect(result.dodge.steps).toBe(-2);
    });
});

describe('Chat card buttons', () => {
    const damage = {
        name: 'Charge Rifle',
        codes: { ordinary: 'd4+1s', good: 'd4w', amazing: 'd6+2w' },
        damageType: 'En',
        bonus: '+1',
        minimumOne: false,
    };

    it('should roll the grade the attack card offered, from the flags alone', async () => {
        const actor = makeActor({ name: 'Kel' });
        damage.actorUuid = actor.uuid;

        queueRolls([5]); // ≤ Good (6): the Good column
        await AlternityRollService.rollCheck({
            actor, name: 'Charge Rifle', context: 'Ranged Attack',
            scores: SCORES, baseStep: 0, damage,
        });
        const attackCard = chatLog[0];

        // Nothing but the message is passed in — this is the path a card takes after
        // the sheet has closed, or after a reload.
        queueRolls([3]);
        const result = await handleChatCardAction('rollDamage', attackCard);

        expect(result).not.toBeNull();
        expect(result.roll.formula).toBe('1d4 + +1');
        expect(result.total).toBe(4);
        expect(result.category).toBe('wound');
        expect(chatLog).toHaveLength(2);
    });

    it('should do nothing when the check offered no damage', async () => {
        const actor = makeActor();
        damage.actorUuid = actor.uuid;

        queueRolls([19]); // a miss
        await AlternityRollService.rollCheck({
            actor, name: 'Charge Rifle', context: 'Ranged Attack',
            scores: SCORES, baseStep: 0, damage,
        });

        expect(await handleChatCardAction('rollDamage', chatLog[0])).toBeNull();
        expect(chatLog).toHaveLength(1);
    });

    it('should apply a damage card to the target it is pointed at', async () => {
        const attacker = makeActor();
        queueRolls([5]);
        await AlternityRollService.rollDamage({ actor: attacker, name: 'Rifle', code: 'd8w' });

        const target = makeActor({
            type: 'robot',
            system: {
                damage: { stun: 0, wound: 0, mortal: 0 },
                durability: { stun: { max: 12 }, wound: { max: 12 }, mortal: { max: 6 } },
            },
        });
        targetActor(target);

        const applied = await handleChatCardAction('applyDamage', chatLog[0]);

        expect(applied).toBe(1);
        expect(target.updates[0]['system.damage.wound']).toBe(5);
    });

    it('should send the selected-token button to the selection, not the crosshairs', async () => {
        const attacker = makeActor();
        queueRolls([5]);
        await AlternityRollService.rollDamage({ actor: attacker, name: 'Rifle', code: 'd8w' });

        const aimed  = damageableActor('Aimed at');
        const picked = damageableActor('Picked');
        placeToken(aimed, { targeted: true });
        placeToken(picked, { controlled: true });

        expect(await handleChatCardAction('applyDamageSelected', chatLog[0])).toBe(1);
        expect(picked.updates[0]['system.damage.wound']).toBe(5);
        expect(aimed.updates).toHaveLength(0);
    });

    it('should send the choose-actor button through the picker', async () => {
        const attacker = makeActor();
        queueRolls([5]);
        await AlternityRollService.rollDamage({ actor: attacker, name: 'Rifle', code: 'd8w' });

        const offstage = damageableActor('Offstage');
        worldActors(offstage);
        queueDialogs({ uuid: offstage.uuid });

        expect(await handleChatCardAction('applyDamageActor', chatLog[0])).toBe(1);
        expect(offstage.updates[0]['system.damage.wound']).toBe(5);
    });

    it('should send the manual button to a resolution that changes no document', async () => {
        const attacker = makeActor();
        queueRolls([5]);
        await AlternityRollService.rollDamage({ actor: attacker, name: 'Rifle', code: 'd8w' });

        const bystander = damageableActor('Bystander');
        placeToken(bystander, { controlled: true, targeted: true });
        queueDialogs({
            name: 'A wall', total: 5, category: 'wound', damageType: 'LI',
            firepower: '', toughness: 'Ordinary', armor: '',
        });

        expect(await handleChatCardAction('applyDamageManual', chatLog[0])).not.toBeNull();
        expect(bystander.updates).toHaveLength(0);
        expect(renderLog.some((r) => r.path.endsWith('armor-card.hbs'))).toBe(true);
    });

    it('should do nothing for any apply button on a card with no damage in its flags', async () => {
        for (const action of ['applyDamage', 'applyDamageSelected', 'applyDamageActor', 'applyDamageManual']) {
            expect(await handleChatCardAction(action, { flags: {} })).toBeNull();
        }
        expect(dialogLog).toHaveLength(0);
    });

    it('should ignore an action it does not know', async () => {
        expect(await handleChatCardAction('somethingElse', { flags: {} })).toBeNull();
    });

    describe('which render hook the buttons are bound on', () => {
        // Registering both names is tempting and wrong: `renderChatMessage` is
        // deprecated from v13, and Foundry warns as soon as it finds a *listener* on
        // it — for every chat message rendered, not just when the hook matters. It
        // would also run the callback twice per message, binding two click listeners
        // to every button.
        it('should use the HTMLElement hook on v13 and later', () => {
            expect(chatCardHookName(13)).toBe('renderChatMessageHTML');
            expect(chatCardHookName(14)).toBe('renderChatMessageHTML');
            expect(chatCardHookName(15)).toBe('renderChatMessageHTML');
        });

        it('should use the jQuery hook on v12, which system.json still declares support for', () => {
            expect(chatCardHookName(12)).toBe('renderChatMessage');
        });

        it('should assume a modern Foundry when the generation is unreadable', () => {
            // Guessing v12 on a future release would register a hook that no longer
            // exists, silently killing every card button — so the default leans new.
            expect(chatCardHookName(undefined)).toBe('renderChatMessageHTML');
            expect(chatCardHookName(null)).toBe('renderChatMessageHTML');
        });
    });
});

describe('Target-derived attack modifiers', () => {
    it('should turn the target\'s resistance modifier into a step penalty', async () => {
        const target = makeActor({ system: { resistanceModifier: 2 } });
        targetActor(target);

        const { modifiers, target: resolved } = await AlternityRollService.collectTargetModifiers();

        expect(resolved).toBe(target);
        expect(modifiers[0]).toMatchObject({ value: 2 });
    });

    it('should use the melee or ranged resistance a creature prints separately', async () => {
        const target = makeActor({ system: { resistance: { melee: 1, ranged: 3 } } });
        targetActor(target);

        expect((await AlternityRollService.collectTargetModifiers({ attackKind: 'melee' }))
            .modifiers[0].value).toBe(1);
        expect((await AlternityRollService.collectTargetModifiers({ attackKind: 'ranged' }))
            .modifiers[0].value).toBe(3);
    });

    it('should treat a null resistance as "no modifier", not as zero', async () => {
        // The compendium prints "no resistance modifier vs. ranged attacks", which is
        // a different statement from +0 — so nothing is pushed at all.
        const target = makeActor({ system: { resistance: { melee: 2, ranged: null } } });
        targetActor(target);

        const { modifiers } = await AlternityRollService.collectTargetModifiers({ attackKind: 'ranged' });
        expect(modifiers).toHaveLength(0);
    });

    it('should stay out of it when there is no single defender', async () => {
        expect((await AlternityRollService.collectTargetModifiers()).target).toBeNull();

        globalThis.game.user.targets = new Set([
            { actor: makeActor() }, { actor: makeActor() },
        ]);
        expect((await AlternityRollService.collectTargetModifiers()).target).toBeNull();
    });

    it('should bring a targeted defender\'s pending dodge along with their resistance', async () => {
        const target = makeActor({ system: { resistanceModifier: 1 } });
        queueRolls([2]); // Amazing dodge: 3 steps
        await AlternityRollService.rollDodge({ actor: target, scores: SCORES, baseStep: 0 });
        targetActor(target);

        const { modifiers } = await AlternityRollService.collectTargetModifiers();

        expect(modifiers.map((m) => m.value)).toEqual([1, 3]);
    });
});
