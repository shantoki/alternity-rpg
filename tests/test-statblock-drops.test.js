/**
 * @fileoverview Tests the translation of a dropped Item into a statblock row.
 *
 * The statblock sheets keep their attacks and gear in `ArrayField`s, not as
 * embedded Items, so a drop there is a *mapping* rather than a copy. Two
 * properties matter most and are pinned hardest here:
 *
 * 1. **One write per array.** An `ArrayField` update replaces the array outright,
 *    so two weapons dropped together must arrive as a single `system.attacks`
 *    write. Writing them one at a time would leave only the second.
 * 2. **Nothing is invented.** A field with no honest source on the item keeps the
 *    row default the sheet's own "+ Add row" button would have given it — most
 *    importantly `score`, which belongs to the NPC and not to the weapon.
 */

import {
    STATBLOCK_DROP_TARGETS,
    planStatblockDrop,
    applyStatblockDrop,
} from '../src/client/alternity-statblock-drops.js';

// ---------------------------------------------------------------------------
// Fixtures — the real row defaults, copied from the sheet module's *_ARRAY_FIELDS
// ---------------------------------------------------------------------------

const NPC_DEFAULTS = {
    attacks: {
        name: '', score: 0, damageOrdinary: '', damageGood: '', damageAmazing: '',
        damageType: 'LI', range: '', notes: '',
    },
};
const CREATURE_DEFAULTS = {
    attacks: {
        name: '', score: 0, damageOrdinary: '', damageGood: '', damageAmazing: '',
        damageType: 'LI', mode: 'O', notes: '',
    },
    skills: { name: '', score: 0, isSpecialty: false },
};
const ROBOT_DEFAULTS = {
    systems: {
        name: '', category: 'Miscellaneous', quantity: 1, costMode: 'points',
        chassisPoints: 0, chassisPercent: 0, powerPoints: 0, cost: '', notes: '', isOffline: false,
    },
    skills: {
        name: '', isBroad: false, rank: 0, ranksLoaded: 0, isLoaded: true,
        skillPointCost: 0, ability: '',
    },
    perksFlaws: { name: '', kind: 'Perk', skillPointChange: 0, notes: '' },
};
const AI_DEFAULTS = {
    physicalForm: { name: '', kind: 'CPU Armor', skill: '', value: '' },
    gridPrograms: { name: '', quality: 'Ordinary', slots: 0, effect: '', isLoaded: true, isAIDisabled: false },
    skills:       { name: '', isBroad: false, rank: 0, ranksLoaded: 0, isLoaded: true, ability: '' },
};
const SPACESHIP_DEFAULTS = {
    weapons: {
        name: '', compartment: 0, arc: 'Fore', range: '',
        damageOrdinary: '', damageGood: '', damageAmazing: '',
        damageType: 'lowImpact', firepower: 'Amazing', actionsPerRound: 1,
        durabilityCost: 0, powerReq: 0, isOffline: false, notes: '',
    },
};
const WARSHIP_DEFAULTS = {
    weapons: {
        name: '', fireMode: 'Single', arc: 'Fore', firepowerClass: 'Medium',
        damageFormula: '1d6', damageType: 'lowImpact', damageGrade: 'wound',
    },
};

function makeActor(type, system = {}) {
    return {
        id: 'actor-1',
        name: 'Target',
        type,
        system,
        isOwner: true,
        updates: [],
        async update(changes) { this.updates.push(changes); return this; },
    };
}

function makeWeapon(overrides = {}) {
    return {
        documentName: 'Item',
        id: 'w1',
        name: 'Charge Rifle',
        type: 'weapon',
        system: {
            weaponType: 'Ranged',
            damageType: 'En',
            damageCategory: 'wound',
            damageOrdinary: 'd6+1w',
            damageGood: 'd6+3w',
            damageAmazing: 'd8+2m',
            attackBonus: -1,
            requiredSkill: 'str-melee',
            firepower: 'Good',
            range: { short: 10, medium: 40, long: 100 },
            ...overrides,
        },
    };
}

const item = (type, name, system = {}) => ({ documentName: 'Item', id: `${type}-1`, name, type, system });

// ---------------------------------------------------------------------------
// Personal-scale statblocks
// ---------------------------------------------------------------------------

describe('npc', () => {
    test('a weapon becomes an attack row, with the score left for the Gamemaster', () => {
        const actor = makeActor('npc', { attacks: [] });
        const { update, added, rejected } = planStatblockDrop(actor, [makeWeapon()], NPC_DEFAULTS);

        expect(rejected).toEqual([]);
        expect(added).toEqual([{ name: 'Charge Rifle', array: 'attacks' }]);
        expect(update['system.attacks']).toEqual([{
            name: 'Charge Rifle',
            // Not derivable from a weapon: it is the NPC's skill score, so the row
            // default stands and the governing skill is written into the notes.
            score: 0,
            damageOrdinary: 'd6+1w',
            damageGood: 'd6+3w',
            damageAmazing: 'd8+2m',
            damageType: 'En',
            range: '10/40/100',
            notes: 'Skill: Melee Weapons · Acc -1',
        }]);
    });

    test('appends after the attacks the NPC already has', () => {
        const actor = makeActor('npc', { attacks: [{ name: 'Claw', score: 12 }] });
        const { update } = planStatblockDrop(actor, [makeWeapon()], NPC_DEFAULTS);
        expect(update['system.attacks']).toHaveLength(2);
        expect(update['system.attacks'][0]).toEqual({ name: 'Claw', score: 12 });
    });

    test('two weapons arrive as ONE array write', () => {
        // An ArrayField update replaces the array, so writing them separately would
        // discard the first weapon.
        const actor = makeActor('npc', { attacks: [] });
        const { update } = planStatblockDrop(
            actor,
            [makeWeapon(), { ...makeWeapon(), id: 'w2', name: 'Combat Knife' }],
            NPC_DEFAULTS,
        );
        expect(Object.keys(update)).toEqual(['system.attacks']);
        expect(update['system.attacks'].map(r => r.name)).toEqual(['Charge Rifle', 'Combat Knife']);
    });

    test('omits an empty range and an accuracy of zero rather than printing them', () => {
        const weapon = makeWeapon({ range: { short: 0, medium: 0, long: 0 }, attackBonus: 0, requiredSkill: '' });
        const { update } = planStatblockDrop(makeActor('npc', { attacks: [] }), [weapon], NPC_DEFAULTS);
        expect(update['system.attacks'][0].range).toBe('');
        expect(update['system.attacks'][0].notes).toBe('');
    });

    test('falls back to LI for a damage form that is not one of the three', () => {
        // A weapon still stored with a pre-migration d20 type must not write an
        // invalid choice into a row whose StringField gates on LI/HI/En.
        const weapon = makeWeapon({ damageType: 'Ballistic' });
        const { update } = planStatblockDrop(makeActor('npc', { attacks: [] }), [weapon], NPC_DEFAULTS);
        expect(update['system.attacks'][0].damageType).toBe('LI');
    });

    test('refuses an item type the sheet has no array for', () => {
        const actor = makeActor('npc', { attacks: [] });
        const { update, added, rejected } = planStatblockDrop(
            actor, [item('mutation', 'Extra Arm')], NPC_DEFAULTS,
        );
        expect(update).toBeNull();
        expect(added).toEqual([]);
        expect(rejected.map(i => i.name)).toEqual(['Extra Arm']);
    });
});

describe('creature', () => {
    test('a weapon becomes an attack row that keeps the printed mode', () => {
        const actor = makeActor('creature', { attacks: [] });
        const { update } = planStatblockDrop(actor, [makeWeapon()], CREATURE_DEFAULTS);
        const row = update['system.attacks'][0];
        expect(row.mode).toBe('O');
        // A creature attack row has no range field at all.
        expect(row).not.toHaveProperty('range');
        expect(row.damageAmazing).toBe('d8+2m');
    });

    test('a skill item becomes a skill row, specialty flagged from the definition', () => {
        const actor = makeActor('creature', { skills: [] });
        const { update } = planStatblockDrop(actor, [
            item('skill', 'Climb', { skillId: 'str-climb', rank: 4 }),
            item('skill', 'Athletics', { skillId: 'str-athletics', rank: 2 }),
        ], CREATURE_DEFAULTS);

        expect(update['system.skills']).toEqual([
            // A creature's skills are absolute scores it cannot improve, so the
            // item's rank has nowhere to go and the score stays for the GM.
            { name: 'Climb', score: 0, isSpecialty: true },
            { name: 'Athletics', score: 0, isSpecialty: false },
        ]);
    });
});

describe('robot', () => {
    test('a weapon is mounted as hardware, damage kept in the notes', () => {
        const actor = makeActor('robot', { systems: [] });
        const { update } = planStatblockDrop(actor, [makeWeapon()], ROBOT_DEFAULTS);
        const row = update['system.systems'][0];
        expect(row.category).toBe('Weapon Support');
        expect(row.notes).toBe('d6+1w / d6+3w / d8+2m En · Skill: Melee Weapons · Acc -1');
        // Everything the row needs that a weapon cannot say keeps its default.
        expect(row).toMatchObject({ quantity: 1, costMode: 'points', isOffline: false });
    });

    test('a flaw spends against the skill point pool in the other direction', () => {
        const actor = makeActor('robot', { perksFlaws: [] });
        const { update } = planStatblockDrop(actor, [
            item('perkFlaw', 'Hardy', { category: 'Perk', cost: 3 }),
            item('perkFlaw', 'Clumsy', { category: 'Flaw', cost: 2 }),
        ], ROBOT_DEFAULTS);

        expect(update['system.perksFlaws']).toEqual([
            { name: 'Hardy',  kind: 'Perk', skillPointChange: 3,  notes: '' },
            { name: 'Clumsy', kind: 'Flaw', skillPointChange: -2, notes: '' },
        ]);
    });

    test('a skill item loads fully into memory', () => {
        const actor = makeActor('robot', { skills: [] });
        const { update } = planStatblockDrop(actor, [
            item('skill', 'Climb', { skillId: 'str-climb', rank: 5, linkedAbility: 'STR' }),
        ], ROBOT_DEFAULTS);

        expect(update['system.skills'][0]).toEqual({
            name: 'Climb', isBroad: false, rank: 5, ranksLoaded: 5,
            isLoaded: true, skillPointCost: 0, ability: 'STR',
        });
    });

    test('a home-brewed skill item with no definition falls back to its specialisation', () => {
        const actor = makeActor('robot', { skills: [] });
        const { update } = planStatblockDrop(actor, [
            item('skill', 'Xeno-Husbandry', { skillId: 'made-up', specialisation: 'grubs', rank: 1 }),
        ], ROBOT_DEFAULTS);
        expect(update['system.skills'][0].isBroad) .toBe(false);
    });
});

describe('ai', () => {
    test('a weapon and armour both land in physicalForm, in one write', () => {
        const actor = makeActor('ai', { physicalForm: [] });
        const { update, added } = planStatblockDrop(actor, [
            makeWeapon(),
            item('armor', 'CPU Shell', { protection: { li: 'd6-1', hi: 'd4', en: '' } }),
        ], AI_DEFAULTS);

        expect(Object.keys(update)).toEqual(['system.physicalForm']);
        expect(update['system.physicalForm']).toEqual([
            { name: 'Charge Rifle', kind: 'Weapon', skill: 'Melee Weapons', value: 'd6+1w / d6+3w / d8+2m' },
            // A CPU shell is printed as one value, not a per-form triple, so the first
            // rating the item states is the one that carries across.
            { name: 'CPU Shell', kind: 'CPU Armor', skill: '', value: 'd6-1' },
        ]);
        expect(added).toHaveLength(2);
    });

    test('armour with no readable rating leaves the row blank rather than inventing one', () => {
        const actor = makeActor('ai', { physicalForm: [] });
        const { update } = planStatblockDrop(actor, [
            item('armor', 'Plating', { protection: { li: '', hi: '', en: '' } }),
        ], AI_DEFAULTS);
        expect(update['system.physicalForm'][0].value).toBe('');
    });

    test('a program becomes a grid program row', () => {
        const actor = makeActor('ai', { gridPrograms: [] });
        const { update } = planStatblockDrop(actor, [
            item('program', 'Autogunner', {
                quality: 'Good', slots: 3, isLoaded: false,
                damage: { ordinary: 'd4s', good: 'd6w', amazing: '' },
            }),
        ], AI_DEFAULTS);

        expect(update['system.gridPrograms'][0]).toEqual({
            name: 'Autogunner', quality: 'Good', slots: 3,
            effect: 'd4s / d6w', isLoaded: false, isAIDisabled: false,
        });
    });

    test('an unknown program quality falls back rather than writing an invalid choice', () => {
        const actor = makeActor('ai', { gridPrograms: [] });
        const { update } = planStatblockDrop(actor, [
            item('program', 'Junk', { quality: 'Legendary', slots: 1 }),
        ], AI_DEFAULTS);
        expect(update['system.gridPrograms'][0].quality).toBe('Ordinary');
    });
});

// ---------------------------------------------------------------------------
// Ship-scale statblocks
// ---------------------------------------------------------------------------

describe('spaceship', () => {
    test('a weapon becomes a weapon row with the damage form spelled out', () => {
        const actor = makeActor('spaceship', { weapons: [] });
        const { update } = planStatblockDrop(actor, [makeWeapon()], SPACESHIP_DEFAULTS);
        expect(update['system.weapons'][0]).toMatchObject({
            name: 'Charge Rifle',
            // The ship schemas spell the three forms out; 'En' would be an invalid choice.
            damageType: 'energy',
            firepower: 'Good',
            range: '10/40/100',
            damageOrdinary: 'd6+1w',
            // Not derivable from the weapon — which compartment it sits in is a
            // property of the ship.
            compartment: 0,
            arc: 'Fore',
            actionsPerRound: 1,
        });
    });

    test('maps each personal damage form onto its ship spelling', () => {
        const actor = makeActor('spaceship', { weapons: [] });
        for (const [form, spelled] of [['LI', 'lowImpact'], ['HI', 'highImpact'], ['En', 'energy']]) {
            const { update } = planStatblockDrop(actor, [makeWeapon({ damageType: form })], SPACESHIP_DEFAULTS);
            expect(update['system.weapons'][0].damageType).toBe(spelled);
        }
    });
});

describe('warship', () => {
    test('splits the Ordinary code into a rollable formula and a track', () => {
        const actor = makeActor('warship', { weapons: [] });
        const { update } = planStatblockDrop(actor, [makeWeapon({ damageOrdinary: 'd6+1w' })], WARSHIP_DEFAULTS);
        expect(update['system.weapons'][0]).toMatchObject({
            name: 'Charge Rifle',
            // The trailing 'w' is notation, not dice — storing it in a formula field
            // would leave the sheet with something unrollable.
            damageFormula: '1d6+1',
            damageGrade: 'wound',
            damageType: 'energy',
            // A warship's firepowerClass is a hull-size class, a different axis from
            // a weapon's firepower, so it keeps the row default.
            firepowerClass: 'Medium',
        });
    });

    test('reads the track off the code letter, not off damageCategory', () => {
        const actor = makeActor('warship', { weapons: [] });
        const { update } = planStatblockDrop(
            actor, [makeWeapon({ damageOrdinary: '2d8m', damageCategory: 'stun' })], WARSHIP_DEFAULTS,
        );
        expect(update['system.weapons'][0].damageGrade).toBe('mortal');
        expect(update['system.weapons'][0].damageFormula).toBe('2d8');
    });

    test('a suffixless code falls back to the weapon\'s own damage category', () => {
        const actor = makeActor('warship', { weapons: [] });
        const { update } = planStatblockDrop(
            actor, [makeWeapon({ damageOrdinary: '2d6', damageCategory: 'stun' })], WARSHIP_DEFAULTS,
        );
        expect(update['system.weapons'][0].damageGrade).toBe('stun');
    });

    test('leaves the formula default alone when there is no code to split', () => {
        const actor = makeActor('warship', { weapons: [] });
        const { update } = planStatblockDrop(
            actor, [makeWeapon({ damageOrdinary: '' })], WARSHIP_DEFAULTS,
        );
        expect(update['system.weapons'][0].damageFormula).toBe('1d6');
    });
});

// ---------------------------------------------------------------------------
// Vehicles, and the actors with nowhere to put anything
// ---------------------------------------------------------------------------

const VEHICLE_DEFAULTS = {
    weapons: {
        name: '', score: 0, damageOrdinary: '', damageGood: '', damageAmazing: '',
        damageType: 'HI', firepower: 'Ordinary', notes: '',
    },
};

describe('vehicle', () => {
    test('a weapon becomes a mounted-weapon row', () => {
        const actor = makeActor('vehicle', { weapons: [] });
        const { update, added, rejected } = planStatblockDrop(actor, [makeWeapon()], VEHICLE_DEFAULTS);

        expect(rejected).toEqual([]);
        expect(added).toEqual([{ name: 'Charge Rifle', array: 'weapons' }]);
        expect(update['system.weapons']).toHaveLength(1);
        expect(update['system.weapons'][0]).toMatchObject({
            name: 'Charge Rifle',
            damageOrdinary: 'd6+1w',
            damageGood: 'd6+3w',
            damageAmazing: 'd8+2m',
            damageType: 'En',
            firepower: 'Good',
        });
    });

    /**
     * The same rule every other statblock drop follows: an attack score belongs to
     * whoever is shooting, not to the weapon. On a vehicle that is the gunner.
     */
    test('the score stays at the row default, because it is the gunner\'s', () => {
        const actor = makeActor('vehicle', { weapons: [] });
        const { update } = planStatblockDrop(actor, [makeWeapon()], VEHICLE_DEFAULTS);
        expect(update['system.weapons'][0].score).toBe(0);
    });

    test('a vehicle has no skills to drop into, because it is driven', () => {
        const actor = makeActor('vehicle', { weapons: [] });
        const { added, rejected } = planStatblockDrop(
            actor, [item('skill', 'Vehicle Operation')], VEHICLE_DEFAULTS,
        );
        expect(added).toEqual([]);
        expect(rejected.map(i => i.type)).toEqual(['skill']);
    });

    test('the hero sheet\'s type embeds items instead, so it is absent from the map', () => {
        // `character` is deliberately absent from the map: a hero's gear is embedded
        // Items, handled by alternity-drag-drop.js.
        expect(STATBLOCK_DROP_TARGETS.character).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// applyStatblockDrop
// ---------------------------------------------------------------------------

describe('applyStatblockDrop', () => {
    test('writes once and reports what landed', async () => {
        const actor = makeActor('ai', { physicalForm: [], gridPrograms: [] });
        const { added, rejected } = await applyStatblockDrop(actor, [
            makeWeapon(),
            item('program', 'Guardian', { quality: 'Amazing', slots: 2 }),
            item('mutation', 'Extra Arm'),
        ], AI_DEFAULTS);

        expect(actor.updates).toHaveLength(1);
        expect(Object.keys(actor.updates[0]).sort())
            .toEqual(['system.gridPrograms', 'system.physicalForm']);
        expect(added.map(a => a.array)).toEqual(['physicalForm', 'gridPrograms']);
        expect(rejected.map(i => i.type)).toEqual(['mutation']);
    });

    test('does not touch the actor when nothing maps', async () => {
        const actor = makeActor('spaceship', { weapons: [] });
        const { added, rejected } = await applyStatblockDrop(actor, [item('cybertech', 'Wired Reflexes')], SPACESHIP_DEFAULTS);
        expect(actor.updates).toHaveLength(0);
        expect(added).toEqual([]);
        expect(rejected).toHaveLength(1);
    });

    test('tolerates an empty drop', async () => {
        const actor = makeActor('npc', { attacks: [] });
        await expect(applyStatblockDrop(actor, [], NPC_DEFAULTS)).resolves.toEqual({ added: [], rejected: [] });
        expect(actor.updates).toHaveLength(0);
    });
});
