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
    installRollHarness, resetHarness, queueRolls, makeActor, targetActor,
    chatLog, renderLog, notifications,
} from './mocks/roll-harness.js';

installRollHarness();

const { AlternityRollService } = await import('../src/services/alternity-roll-service.js');
const { AlternityMathService, SUCCESS_DEGREES } = await import('../src/services/alternity-math.js');
const { handleChatCardAction } = await import('../module_hooks/alt-mechanics.js');
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

            expect(chatLog[0].flags['alternity-v2'].check).toMatchObject({
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

        expect(chatLog[0].flags['alternity-v2'].damage).toMatchObject({
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

describe('Dodge defence', () => {
    it('should store the step adjustment on the defender for the next attack', async () => {
        const actor = makeActor();
        queueRolls([5]); // ≤ Good (6): a 2-step adjustment

        const result = await AlternityRollService.rollDodge({ actor, scores: SCORES, baseStep: 0 });

        expect(result.degree).toBe(SUCCESS_DEGREES.GOOD);
        expect(result.dodge.steps).toBe(2);
        expect(actor.flags['alternity-v2'].pendingDodge).toMatchObject({ steps: 2 });
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

    it('should ignore an action it does not know', async () => {
        expect(await handleChatCardAction('somethingElse', { flags: {} })).toBeNull();
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
