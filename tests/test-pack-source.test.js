/**
 * @file tests/test-pack-source.test.js
 * @description Guards the compendium source under `packs/_source`.
 *
 * `compilePack` writes whatever it is handed straight into the LevelDB, and Foundry only
 * complains about a bad enum value or an out-of-range number when a GM opens the item -
 * one row out of 1,300, long after the build. These tests are the check that would
 * otherwise never happen: every document is validated against the same choice lists and
 * bounds its TypeDataModel declares.
 *
 * The choice lists are restated here rather than imported, because most of them are
 * module-private to their schema file. That duplication is the point: if a schema's
 * choices change, this test fails and the converter has to be looked at.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKILL_DEFINITIONS } from '../src/data/alternity-actor-data.js';

// Jest's ESM runner does not populate `import.meta.dirname`, only `import.meta.url`.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_DIR = path.join(HERE, '..', 'packs', '_source');

/** Every document in every pack, tagged with the pack and file it came from. */
function loadAllDocuments() {
    if (!fs.existsSync(SOURCE_DIR)) return [];
    const packs = fs.readdirSync(SOURCE_DIR, { withFileTypes: true }).filter(entry => entry.isDirectory());
    return packs.flatMap(pack => fs.readdirSync(path.join(SOURCE_DIR, pack.name))
        .filter(file => file.endsWith('.json'))
        .map(file => ({
            pack: pack.name,
            file,
            doc: JSON.parse(fs.readFileSync(path.join(SOURCE_DIR, pack.name, file), 'utf8')),
        })));
}

const ALL = loadAllDocuments();
const itemsOfType = type => ALL.filter(entry => entry.doc.type === type && entry.doc._key?.startsWith('!items!'));

/** Fail with the document's name attached, so a bad row can be found without grepping. */
function expectEach(entries, assertion) {
    const failures = [];
    for (const entry of entries) {
        try {
            assertion(entry.doc.system, entry.doc);
        } catch (error) {
            failures.push(`${entry.pack}/${entry.doc.name}: ${error.message}`);
        }
    }
    expect(failures).toEqual([]);
}

describe('compendium source documents', () => {

    test('there is source data to check', () => {
        expect(ALL.length).toBeGreaterThan(0);
    });

    test('every document has a key matching its own id', () => {
        expectEach(ALL, (_system, doc) => {
            expect(doc._id).toMatch(/^[A-Za-z0-9]{16}$/);
            expect(doc._key).toMatch(new RegExp(`^!(items|actors|journal|folders)!${doc._id}$`));
        });
    });

    test('ids are unique within each pack', () => {
        const seen = new Map();
        for (const { pack, doc } of ALL) {
            const key = `${pack}!${doc._id}`;
            expect(seen.has(key)).toBe(false);
            seen.set(key, doc.name);
        }
    });

    test('every document names itself', () => {
        expectEach(ALL, (_system, doc) => {
            expect(typeof doc.name).toBe('string');
            expect(doc.name.trim().length).toBeGreaterThan(0);
        });
    });

    test('every non-folder document points at a folder that exists in its pack', () => {
        const foldersByPack = new Map();
        for (const { pack, doc } of ALL) {
            if (!doc._key?.startsWith('!folders!')) continue;
            if (!foldersByPack.has(pack)) foldersByPack.set(pack, new Set());
            foldersByPack.get(pack).add(doc._id);
        }
        for (const { pack, doc } of ALL) {
            if (doc._key?.startsWith('!folders!')) continue;
            if (doc.folder === null) continue;
            expect(foldersByPack.get(pack)?.has(doc.folder)).toBe(true);
        }
    });
});

describe('the acquisition columns every gear table prints', () => {
    const AVAILABILITY = ['Any', 'Common', 'Controlled', 'Military', 'Restricted'];
    const GEAR_TYPES = ['weapon', 'armor', 'personalEquipment', 'computer'];

    for (const type of GEAR_TYPES) {
        const gear = itemsOfType(type);

        test(`${type}: progress level, cost and availability are in range`, () => {
            expectEach(gear, system => {
                expect(Number.isInteger(system.progressLevel)).toBe(true);
                expect(system.progressLevel).toBeGreaterThanOrEqual(0);
                expect(system.progressLevel).toBeLessThanOrEqual(9);
                expect(Number.isInteger(system.cost)).toBe(true);
                expect(system.cost).toBeGreaterThanOrEqual(0);
                expect(AVAILABILITY).toContain(system.availability);
            });
        });

        test(`${type}: the printed price actually made it onto the item`, () => {
            // Regression guard. These schemas had no `cost` field at all, so the
            // converter read the credit price out of the source data and had nowhere
            // to put it — every one of these items shipped priceless.
            const priced = gear.filter(entry => entry.doc.system.cost > 0).length;
            expect(priced / gear.length).toBeGreaterThan(0.5);
        });

        test(`${type}: cost agrees with the price the source data carried`, () => {
            expectEach(gear, (system, doc) => {
                const printed = doc.flags['alternity'].provenance.cost;
                if (printed !== undefined) expect(system.cost).toBe(printed);
            });
        });
    }

    test('concealment is an integer or null, never a stand-in zero', () => {
        // The tables print a dash for what cannot be concealed at all, which is a
        // different statement from a modifier of 0.
        expectEach([...itemsOfType('weapon'), ...itemsOfType('armor')], system => {
            expect(system.concealment === null || Number.isInteger(system.concealment)).toBe(true);
        });
    });

    test('something unconcealable is recorded as such', () => {
        const unconcealable = [...itemsOfType('weapon'), ...itemsOfType('armor')]
            .filter(entry => entry.doc.system.concealment === null);
        expect(unconcealable.length).toBeGreaterThan(0);
    });
});

describe('weapon items', () => {
    const weapons = itemsOfType('weapon');

    test('the pack is populated', () => expect(weapons.length).toBeGreaterThan(200));

    test('classification fields stay inside WeaponData choices', () => {
        expectEach(weapons, system => {
            expect(['Melee', 'Ranged', 'Thrown', 'Heavy']).toContain(system.weaponType);
            expect(['LI', 'HI', 'En']).toContain(system.damageType);
            expect(['stun', 'wound', 'mortal']).toContain(system.damageCategory);
            expect(['Marginal', 'Ordinary', 'Good', 'Amazing']).toContain(system.firepower);
            expect(['Melee', 'Primitive', 'Pistol', 'Rifle', 'SMG']).toContain(system.rangeClass);
            expect(['str', 'dex']).toContain(system.attackAbility);
        });
    });

    test('damage runs are either complete or absent', () => {
        expectEach(weapons, system => {
            const filled = [system.damageOrdinary, system.damageGood, system.damageAmazing].filter(Boolean);
            // A partial run would let `selectDamageGrade` return an empty formula for
            // the grade the attack actually achieved.
            expect([0, 3]).toContain(filled.length);
        });
    });

    test('damage codes are formulas the math service can parse', () => {
        expectEach(weapons, system => {
            for (const code of [system.damageOrdinary, system.damageGood, system.damageAmazing].filter(Boolean)) {
                expect(code).toMatch(/^\d*d\d+([+-]\d+)?[swm]$|^\d+[swm]$/);
            }
        });
    });

    test('range bands are non-negative integers', () => {
        expectEach(weapons, system => {
            for (const band of ['short', 'medium', 'long']) {
                expect(Number.isInteger(system.range[band])).toBe(true);
                expect(system.range[band]).toBeGreaterThanOrEqual(0);
            }
        });
    });

    test('a stated required skill is one the skill tree knows', () => {
        const known = new Set(SKILL_DEFINITIONS.map(definition => definition.id));
        expectEach(weapons, system => {
            if (system.requiredSkill) expect(known.has(system.requiredSkill)).toBe(true);
        });
    });

    test('melee weapons read the Melee row of Table P22', () => {
        expectEach(weapons, system => {
            if (system.weaponType === 'Melee') expect(system.rangeClass).toBe('Melee');
        });
    });
});

describe('armor items', () => {
    const armor = itemsOfType('armor');

    test('the pack is populated', () => expect(armor.length).toBeGreaterThan(80));

    test('classification fields stay inside ArmorData choices and bounds', () => {
        expectEach(armor, system => {
            expect(['Light', 'Medium', 'Heavy', 'Powered']).toContain(system.armorType);
            expect(['Ordinary', 'Good', 'Amazing']).toContain(system.toughness);
            expect(system.skillPenalty).toBeGreaterThanOrEqual(0);
            expect(system.skillPenalty).toBeLessThanOrEqual(10);
            expect(system.speedPenalty).toBeGreaterThanOrEqual(0);
            expect(system.speedPenalty).toBeLessThanOrEqual(30);
        });
    });

    test('no armour claims a resistance modifier bonus', () => {
        // Only gear whose own entry says so adjusts a resistance modifier; deriving one
        // from how thick the armour is was the d20-shaped bug ArmorData was rewritten
        // to remove.
        expectEach(armor, system => expect(system.resistanceModifierBonus).toBe(0));
    });

    test('protection ratings are die ranges or blank', () => {
        expectEach(armor, system => {
            for (const form of ['li', 'hi', 'en']) {
                expect(system.protection[form]).toMatch(/^$|^\d*d\d+([+-]\d+)?$|^[+-]?\d+$/);
            }
        });
    });
});

describe('skill items', () => {
    const skills = itemsOfType('skill');
    const known = new Set(SKILL_DEFINITIONS.map(definition => definition.id));

    test('the pack is populated', () => expect(skills.length).toBeGreaterThan(150));

    test('linked abilities are one of the six', () => {
        expectEach(skills, system => {
            expect(['STR', 'DEX', 'CON', 'INT', 'WIL', 'PER']).toContain(system.linkedAbility);
        });
    });

    test('catalogue entries carry no rank', () => {
        expectEach(skills, system => expect(system.rank).toBe(0));
    });

    test('the skill point price comes across', () => {
        expectEach(skills, (system, doc) => {
            expect(system.baseCost).toBeGreaterThanOrEqual(0);
            expect(system.baseCost).toBeLessThanOrEqual(15);
            expect(system.baseCost).toBe(doc.flags['alternity'].provenance.basePrice);
        });
        expect(skills.filter(entry => entry.doc.system.baseCost > 0).length).toBeGreaterThan(150);
    });

    test('a stated skillId resolves against the skill tree', () => {
        expectEach(skills, system => {
            if (system.skillId) expect(known.has(system.skillId)).toBe(true);
        });
    });

    test('most skills do resolve', () => {
        const resolved = skills.filter(entry => entry.doc.system.skillId).length;
        expect(resolved / skills.length).toBeGreaterThan(0.6);
    });
});

describe('fx items', () => {
    const fx = itemsOfType('fx');

    test('the pack is populated', () => expect(fx.length).toBeGreaterThan(200));

    test('tradition and broad skill stay inside FXData choices', () => {
        expectEach(fx, system => {
            expect(['Psionic', 'Arcane Magic', 'Faith', 'Super Power']).toContain(system.tradition);
            expect([
                'Biokinesis', 'Extrasensory Perception', 'Psychoportation', 'Telekinesis', 'Telepathy',
                'Arcane Magic', 'Faith', 'Super Power',
            ]).toContain(system.broadSkill);
            expect(['STR', 'DEX', 'CON', 'INT', 'WIL', 'PER']).toContain(system.linkedAbility);
            expect(['None', 'LI', 'HI', 'En']).toContain(system.damageType);
            expect(['None', 'Will', 'Dexterity', 'Strength', 'Constitution']).toContain(system.resistance);
            expect(['None', 'Assault', 'Subversion', 'Trap', 'Defense']).toContain(system.mentalCombatClass);
        });
    });

    test('costs stay inside the schema bounds', () => {
        expectEach(fx, system => {
            expect(system.baseCost).toBeGreaterThanOrEqual(0);
            expect(system.baseCost).toBeLessThanOrEqual(15);
            expect(system.rank).toBe(0);
        });
    });

    test('psionic powers name a psionic broad skill', () => {
        expectEach(fx, system => {
            if (system.tradition !== 'Psionic') return;
            expect([
                'Biokinesis', 'Extrasensory Perception', 'Psychoportation', 'Telekinesis', 'Telepathy',
            ]).toContain(system.broadSkill);
        });
    });
});

describe('cybertech items', () => {
    const cybertech = itemsOfType('cybertech');

    test('the pack is populated', () => expect(cybertech.length).toBeGreaterThan(50));

    test('category and quality stay inside CybertechData choices', () => {
        expectEach(cybertech, system => {
            expect(['Weapon', 'Protection', 'Enhancement', 'Sensory', 'Interface', 'Utility', 'Cosmetic'])
                .toContain(system.category);
            expect(['Ordinary', 'Good', 'Amazing']).toContain(system.quality);
            expect(system.progressLevel).toBeGreaterThanOrEqual(0);
            expect(system.progressLevel).toBeLessThanOrEqual(9);
        });
    });

    test('durability bonuses come across from the SpecialItems block', () => {
        // Six records state their effect mechanically rather than in prose; the
        // converter used to skip the block they state it in, so `durabilityBonus` was
        // zero on all 57 pieces of cyberware.
        const withBonus = cybertech.filter(entry => {
            const bonus = entry.doc.system.durabilityBonus ?? {};
            return (bonus.stun || 0) + (bonus.wound || 0) + (bonus.mortal || 0) > 0;
        });
        expect(withBonus.length).toBe(6);
    });

    test('the Amazing CF Skinweave protects all three tracks', () => {
        const skinweave = cybertech.find(entry => entry.doc.name === 'CF Skinweave, Amazing');
        expect(skinweave).toBeDefined();
        expect(skinweave.doc.system.durabilityBonus).toEqual({ stun: 2, wound: 1, mortal: 1 });
    });

    test('bonuses stay non-negative', () => {
        expectEach(cybertech, system => {
            for (const track of ['stun', 'wound', 'mortal']) {
                expect(system.durabilityBonus[track]).toBeGreaterThanOrEqual(0);
            }
        });
    });
});

describe('personal equipment and computer items', () => {
    const equipment = itemsOfType('personalEquipment');
    const computers = itemsOfType('computer');

    test('both packs are populated', () => {
        expect(equipment.length).toBeGreaterThan(150);
        expect(computers.length).toBeGreaterThan(20);
    });

    test('categories stay inside PersonalEquipmentData choices', () => {
        expectEach(equipment, system => {
            expect(['Communications', 'Medical', 'Professional', 'Sensors', 'Survival', 'Clothing', 'Miscellaneous'])
                .toContain(system.category);
            expect(system.progressLevel).toBeGreaterThanOrEqual(0);
            expect(system.progressLevel).toBeLessThanOrEqual(8);
            expect(system.cost).toBeGreaterThanOrEqual(0);
        });
    });
});

describe('achievement benefit items', () => {
    const achievements = itemsOfType('achievementBenefit');

    test('the pack is populated', () => expect(achievements.length).toBeGreaterThan(150));

    test('benefit, profession and effect target stay inside the schema choices', () => {
        expectEach(achievements, system => {
            expect([
                'Action Check Bonus', 'Action Check Increase', 'Extra Action', 'Ability Score Increase',
                'Durability Increase', 'Psionic Energy Increase', 'Monetary Award', 'New Perk',
                'Remove Flaw', 'Acquire Contact',
            ]).toContain(system.benefitType);
            expect(['Combat Spec', 'Diplomat', 'Free Agent', 'Tech Op', 'Mindwalker']).toContain(system.profession);
            expect([
                'None', 'ActionCheckStep', 'ActionCheckScore', 'ActionsPerRound', 'AbilityScore',
                'StunRating', 'WoundRating', 'MortalRating', 'FatigueRating', 'PsionicEnergy',
            ]).toContain(system.effectTarget);
            expect(['STR', 'DEX', 'CON', 'INT', 'WIL', 'PER', 'None']).toContain(system.effectAbility);
            expect(system.minLevel).toBeGreaterThanOrEqual(1);
        });
    });

    test('an ability score increase names the ability it raises', () => {
        expectEach(achievements, system => {
            if (system.benefitType !== 'Ability Score Increase') return;
            expect(system.effectAbility).not.toBe('None');
        });
    });
});

describe('character templates', () => {
    const templates = ALL.filter(entry => entry.doc._key?.startsWith('!actors!'));
    const known = new Set(SKILL_DEFINITIONS.map(definition => definition.id));

    test('the pack is populated', () => expect(templates.length).toBeGreaterThan(50));

    test('each template carries a character state keyed to its own id', () => {
        expectEach(templates, (_system, doc) => {
            const state = doc.flags['alternity'].characterState;
            expect(state.actorId).toBe(doc._id);
            expect(Object.keys(state.abilityScores).sort())
                .toEqual(['CON', 'DEX', 'INT', 'PER', 'STR', 'WIL']);
        });
    });

    test('every skill in a package is either a known slug or an explicit custom skill', () => {
        expectEach(templates, (_system, doc) => {
            const state = doc.flags['alternity'].characterState;
            for (const id of Object.keys(state.skills)) expect(known.has(id)).toBe(true);
            for (const custom of state.customSkills) {
                expect(custom.id).toMatch(/^src-\d+$/);
                expect(['STR', 'DEX', 'CON', 'INT', 'WIL', 'PER']).toContain(custom.ability);
            }
        });
    });

    test('the system mirror agrees with the state it was derived from', () => {
        expectEach(templates, (system, doc) => {
            const state = doc.flags['alternity'].characterState;
            expect(system.durability.stun.max).toBe(state.durability.stunMax);
            expect(system.durability.wound.max).toBe(state.durability.woundMax);
            expect(system.durability.mortal.max).toBe(state.durability.mortalMax);
            expect(system.durability.fatigue.max).toBe(state.durability.fatigueMax);
            expect(system.abilities.str).toBe(state.abilityScores.STR);
            expect(system.actionsPerRound).toBe(state.actionsPerRound);
        });
    });

    test('special rules have unique ids within a template', () => {
        expectEach(templates, (_system, doc) => {
            const ids = doc.flags['alternity'].characterState.specialRules.map(rule => rule.id);
            expect(new Set(ids).size).toBe(ids.length);
        });
    });
});

describe('species items', () => {
    const species = itemsOfType('species');
    const ABILITIES = ['CON', 'DEX', 'INT', 'PER', 'STR', 'WIL'];

    test('the pack is populated', () => expect(species.length).toBeGreaterThan(15));

    test('the pack holds nothing but species', () => {
        const strays = ALL
            .filter(entry => entry.pack === 'alternity-species' && entry.doc._key?.startsWith('!items!'))
            .filter(entry => entry.doc.type !== 'species');
        expect(strays.map(entry => `${entry.doc.name} (${entry.doc.type})`)).toEqual([]);
    });

    test('every ability carries a range, and the maximum is not below the minimum', () => {
        expectEach(species, (system) => {
            expect(Object.keys(system.abilityRanges).sort()).toEqual(ABILITIES);
            for (const range of Object.values(system.abilityRanges)) {
                expect(Number.isInteger(range.min)).toBe(true);
                expect(Number.isInteger(range.max)).toBe(true);
                expect(range.min).toBeGreaterThanOrEqual(1);
                expect(range.max).toBeLessThanOrEqual(20);
                expect(range.max).toBeGreaterThanOrEqual(range.min);
            }
        });
    });

    test('the multipliers are inside the schema bounds', () => {
        expectEach(species, (system) => {
            for (const key of ['durabilityMultiplier', 'psionicMultiplier']) {
                expect(system[key]).toBeGreaterThanOrEqual(0.25);
                expect(system[key]).toBeLessThanOrEqual(4);
            }
            expect(Number.isInteger(system.actionCheckStep)).toBe(true);
            expect(Math.abs(system.actionCheckStep)).toBeLessThanOrEqual(4);
        });
    });

    test('special abilities validate against the schema choice lists', () => {
        expectEach(species, (system) => {
            for (const ability of system.specialAbilities) {
                expect(ability.name.length).toBeGreaterThan(0);
                expect(['None', 'AttacksAgainstMe']).toContain(ability.effectTarget);
                expect(['Any', 'Melee', 'Ranged']).toContain(ability.attackKind);
                expect(Number.isInteger(ability.effectValue)).toBe(true);
                // A row that claims no target must not carry a step with it, or the
                // sheet would print a modifier nothing applies.
                if (ability.effectTarget === 'None') expect(ability.effectValue).toBe(0);
            }
        });
    });

    /**
     * The two species the retired name-sniff got wrong, pinned as data rather than as
     * prose: it fired on the Weren by name and silently missed the Sasquatch, which
     * carries exactly the same multiplier.
     */
    test('both CON x1.5 species carry the multiplier, not just the one named Weren', () => {
        const tough = species.filter(entry => entry.doc.system.durabilityMultiplier === 1.5);
        expect(tough.map(entry => entry.doc.name).sort()).toEqual(['Sasquatch', 'Weren']);
    });

    test('the Weren camouflage note became a real step modifier', () => {
        const weren = species.find(entry => entry.doc.name === 'Weren');
        expect(weren).toBeDefined();
        const camouflage = weren.doc.system.specialAbilities
            .find(ability => ability.effectTarget === 'AttacksAgainstMe');
        expect(camouflage).toMatchObject({ effectValue: 1, attackKind: 'Ranged' });
    });

    test("the T'sa natural armour survived as three printed die expressions", () => {
        const tsa = species.find(entry => entry.doc.name === "T'sa");
        expect(tsa).toBeDefined();
        expect(tsa.doc.system.naturalArmor).toEqual({ li: 'd4+1', hi: 'd4', en: 'd4-1' });
        // Everyone else prints a dash, which is a blank here rather than a rating of 0.
        const armoured = species.filter(entry => entry.doc.system.naturalArmor.li !== '');
        expect(armoured).toHaveLength(1);
    });

    test('the printed notes are kept alongside the parsed abilities', () => {
        expectEach(species, (system, doc) => {
            const notes = doc.flags['alternity'].provenance.specialNotes;
            expect(notes).toHaveLength(system.specialAbilities.length);
        });
    });
});
