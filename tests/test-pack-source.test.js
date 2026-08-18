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
    // Scoped to its own pack, not to "every Actor": the ship packs are Actors too, and
    // none of them carries a character state for these assertions to read.
    const templates = ALL.filter(entry =>
        entry.pack === 'alternity-templates' && entry.doc._key?.startsWith('!actors!'));
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

/**
 * The two ship packs are built from the books rather than from the character generator
 * data set, and their statblocks came off OCR'd scans - so these are the assertions that
 * stand in for a proof-reader. The ones that matter most are the two invariants the
 * transcription was reconstructed with: a printed damage triple is one number expanded
 * three ways, and a spaceship's compartments account for its whole hull.
 */
describe('warship hulls and sample ships', () => {
    const TOUGHNESS_CLASSES = ['Good', 'SmallCraft', 'Light', 'Medium', 'Heavy', 'SuperHeavy'];
    const FIREPOWER_CLASSES = ['SmallCraft', 'Light', 'Medium', 'Heavy', 'SuperHeavy'];
    const HULL_CATEGORIES = ['Military', 'Civilian', 'Installation'];
    const FIRE_MODES = ['Single', 'Burst', 'Auto', 'Battery'];
    const ARCS = ['Fore', 'Aft', 'Port', 'Starboard', 'Turret', 'Fixed'];
    const DAMAGE_TYPES = ['lowImpact', 'highImpact', 'energy'];
    const DAMAGE_GRADES = ['stun', 'wound', 'mortal', 'critical'];
    const SYSTEM_CATEGORIES = ['Hull', 'Armor', 'Power', 'Engine', 'FTL', 'Support',
        'Command', 'Sensors', 'Hangar', 'Misc'];
    // Table 5-18 and Table 6-1 only ever divide a hull into one of these zone counts.
    const ZONE_COUNTS = [2, 4, 6, 8, 12, 20];

    const warships = ALL.filter(entry =>
        entry.pack === 'alternity-warships' && entry.doc._key?.startsWith('!actors!'));

    test('the pack is populated', () => expect(warships.length).toBe(44));

    test('the pack holds nothing but warships', () => {
        const strays = warships.filter(entry => entry.doc.type !== 'warship');
        expect(strays.map(entry => `${entry.doc.name} (${entry.doc.type})`)).toEqual([]);
    });

    test('classification fields validate against the schema choice lists', () => {
        expectEach(warships, system => {
            expect(HULL_CATEGORIES).toContain(system.hullCategory);
            expect(TOUGHNESS_CLASSES).toContain(system.toughness);
            expect(typeof system.hullType).toBe('string');
            expect(system.hullType.length).toBeGreaterThan(0);
            expect(Number.isInteger(system.maneuverClass)).toBe(true);
            expect(system.maneuverClass).toBeGreaterThanOrEqual(0);
            expect(system.maneuverClass).toBeLessThanOrEqual(4);
        });
    });

    /**
     * Table 5-1 prints stun and wound as the same number on every hull it lists, and then
     * halves down the track. A transcription slip of a whole point breaks one of these.
     */
    test('the damage track halves down the way the tables print it', () => {
        expectEach(warships, system => {
            const { stun, wound, mortal, critical } = system.damage;
            for (const track of [stun, wound, mortal, critical]) {
                expect(track.value).toBe(0);
                expect(Number.isInteger(track.max)).toBe(true);
                expect(track.max).toBeGreaterThan(0);
            }
            expect(stun.max).toBe(wound.max);
            expect(Math.abs(mortal.max - wound.max / 2)).toBeLessThanOrEqual(0.5);
            expect(Math.abs(critical.max - mortal.max / 2)).toBeLessThanOrEqual(0.5);
        });
    });

    test('every hull carries a full set of hit zones at one shared limit', () => {
        expectEach(warships, system => {
            expect(ZONE_COUNTS).toContain(system.zones.length);
            const limits = new Set(system.zones.map(zone => zone.hullPointLimit));
            expect(limits.size).toBe(1);
            expect([...limits][0]).toBeGreaterThan(0);
            for (const zone of system.zones) {
                expect(zone.label.length).toBeGreaterThan(0);
                expect(zone.hullPointsUsed).toBe(0);
                expect(zone.isKnockedOut).toBe(false);
            }
        });
    });

    test('hull point capacity is a positive base plus a non-negative bonus', () => {
        expectEach(warships, system => {
            expect(system.hullPoints.base).toBeGreaterThan(0);
            expect(system.hullPoints.bonus).toBeGreaterThanOrEqual(0);
        });
    });

    /**
     * Good toughness exists only because Table 5-1b prints `(Gd)` for exactly these three
     * civilian hulls. Pinned as data so the ladder cannot lose its bottom rung unnoticed.
     */
    test('Good toughness lands on the three hulls the civilian table prints it for', () => {
        const good = warships.filter(entry => entry.doc.system.toughness === 'Good');
        expect(good.map(entry => entry.doc.name).sort()).toEqual(['Courier', 'Launch', 'Trader']);
    });

    test('installations have no manoeuvre class, because Table 6-1 prints none', () => {
        const installations = warships.filter(entry => entry.doc.system.hullCategory === 'Installation');
        expect(installations).toHaveLength(10);
        expectEach(installations, system => expect(system.maneuverClass).toBe(0));
    });

    test('a bare hull is bare: no systems, weapons, defenses or sensors', () => {
        const hulls = warships.filter(entry => entry.doc.name !== 'Endurance');
        expectEach(hulls, system => {
            expect(system.systems).toEqual([]);
            expect(system.weapons).toEqual([]);
            expect(system.defenses).toEqual([]);
            expect(system.sensors).toEqual([]);
        });
    });

    describe('the Endurance', () => {
        const endurance = warships.find(entry => entry.doc.name === 'Endurance');

        test('is in the pack', () => expect(endurance).toBeDefined());

        /**
         * The printed table's hull point column sums to exactly the heavy cruiser's 400
         * plus its 80 bonus points, with nothing left over - which is the check that the
         * whole transcription is complete and nothing was double-counted.
         */
        test('its systems fill the hull exactly', () => {
            const { system } = endurance.doc;
            const rows = [...system.systems, ...system.weapons, ...system.defenses, ...system.sensors];
            const hullPoints = rows.reduce((sum, row) => sum + row.hullPoints, 0);
            expect(hullPoints).toBe(system.hullPoints.base + system.hullPoints.bonus);
        });

        /** And the power column's continuous draw matches what the four reactors make. */
        test('its power draw matches its generation', () => {
            const { system } = endurance.doc;
            const rows = [...system.systems, ...system.weapons, ...system.defenses, ...system.sensors];
            const powerReq = rows.reduce((sum, row) => sum + row.powerReq, 0);
            expect(powerReq).toBe(system.power.consumed);
            expect(powerReq).toBe(system.power.generated);
        });

        test('every zone in its damage diagram lists what is in it', () => {
            expect(endurance.doc.system.zones).toHaveLength(8);
            for (const zone of endurance.doc.system.zones) {
                expect(zone.systemsText.length).toBeGreaterThan(0);
            }
        });

        test('its line items validate against the schema choice lists', () => {
            const { system } = endurance.doc;
            for (const row of system.systems) expect(SYSTEM_CATEGORIES).toContain(row.category);
            for (const row of system.weapons) {
                expect(FIRE_MODES).toContain(row.fireMode);
                expect(ARCS).toContain(row.arc);
                expect(FIREPOWER_CLASSES).toContain(row.firepowerClass);
                expect(DAMAGE_TYPES).toContain(row.damageType);
                expect(DAMAGE_GRADES).toContain(row.damageGrade);
            }
        });
    });
});

describe('spaceships', () => {
    const COMPARTMENT_KINDS = ['Command', 'Engineering', 'Weapons', 'Auxiliary',
        'Electronics', 'Cargo', 'Crew'];
    const ARMOR_GRADES = ['None', 'Light', 'Moderate', 'Heavy'];
    const FTL_DRIVES = ['None', 'Stardrive', 'Drivewave'];
    const COMPUTER_QUALITIES = ['Marginal', 'Ordinary', 'Good', 'Amazing'];
    const FIREPOWER_CLASSES = ['Marginal', 'Ordinary', 'Good', 'Amazing'];
    const DAMAGE_TYPES = ['lowImpact', 'highImpact', 'energy'];
    const ARCS = ['Fore', 'Aft', 'Port', 'Starboard', 'Turret', 'Fixed'];
    const SYSTEM_CATEGORIES = ['Power Plant', 'Engine', 'FTL Drive', 'Life Support', 'Sensors',
        'Communications', 'Computer', 'Crew', 'Cargo', 'Misc'];
    const DAMAGE_CONTROL = ['None', 'Ordinary', 'Good', 'Amazing'];
    /** GM Guide Ch.11: "No compartment can contain more than 10 durability points." */
    const MAX_COMPARTMENT_DURABILITY = 10;
    /** GM Guide Ch.11, "Armor": the fraction of total durability each grade costs. */
    const ARMOR_FRACTION = { None: 0, Light: 0, Moderate: 0.1, Heavy: 0.2 };

    const ships = ALL.filter(entry =>
        entry.pack === 'alternity-spaceships' && entry.doc._key?.startsWith('!actors!'));

    const durabilityAssigned = system =>
        system.compartments.reduce((sum, c) => sum + c.durability, 0);
    const durabilityAvailable = system =>
        system.hullSize - Math.floor(system.hullSize * ARMOR_FRACTION[system.armor.grade]);
    const lineItems = system => [...system.weapons, ...system.defenses, ...system.systems];

    test('the pack is populated', () => expect(ships.length).toBe(18));

    test('the pack holds nothing but spaceships', () => {
        const strays = ships.filter(entry => entry.doc.type !== 'spaceship');
        expect(strays.map(entry => `${entry.doc.name} (${entry.doc.type})`)).toEqual([]);
    });

    test('hull and drive fields validate against the schema choice lists', () => {
        expectEach(ships, system => {
            expect(['Civilian', 'Military']).toContain(system.hullCategory);
            expect(system.hullType.length).toBeGreaterThan(0);
            expect(system.hullSize).toBeGreaterThan(0);
            expect(system.compartmentLimit).toBeGreaterThanOrEqual(system.compartments.length);
            expect(system.progressLevel).toBeGreaterThanOrEqual(0);
            expect(system.progressLevel).toBeLessThanOrEqual(9);
            expect(system.maneuverRating).toBeGreaterThanOrEqual(-3);
            expect(system.maneuverRating).toBeLessThanOrEqual(3);
            expect(ARMOR_GRADES).toContain(system.armor.grade);
            expect(FTL_DRIVES).toContain(system.ftl.driveType);
            expect(COMPUTER_QUALITIES).toContain(system.computer.coreQuality);
        });
    });

    test('every compartment is a legal kind, size and damage-control quality', () => {
        expectEach(ships, system => {
            expect(system.compartments.length).toBeGreaterThan(0);
            for (const compartment of system.compartments) {
                expect(COMPARTMENT_KINDS).toContain(compartment.kind);
                expect(compartment.label.length).toBeGreaterThan(0);
                expect(compartment.durability).toBeGreaterThan(0);
                expect(compartment.durability).toBeLessThanOrEqual(MAX_COMPARTMENT_DURABILITY);
                expect(DAMAGE_CONTROL).toContain(compartment.damageControl);
                expect(compartment.damage).toEqual({ stun: 0, wound: 0, mortal: 0 });
            }
        });
    });

    /**
     * The first of the two invariants the transcription leans on. A gap means some d20
     * results hit nothing; an overlap means one result hits two compartments. Either is
     * silent corruption discovered mid-combat, which is exactly why it is checked here.
     *
     * A band of `0, 0` is not a gap: several StarDrive ships print a dash for their
     * command space, sheltering it from random damage entirely.
     */
    test('each ship hit bands tile a d20 exactly once', () => {
        expectEach(ships, system => {
            const hits = new Map();
            for (const compartment of system.compartments) {
                if (compartment.hitLow === 0 && compartment.hitHigh === 0) continue;
                expect(compartment.hitHigh).toBeGreaterThanOrEqual(compartment.hitLow);
                for (let face = compartment.hitLow; face <= compartment.hitHigh; face++) {
                    hits.set(face, (hits.get(face) ?? 0) + 1);
                }
            }
            const missing = [];
            const duplicated = [];
            for (let face = 1; face <= 20; face++) {
                const count = hits.get(face) ?? 0;
                if (count === 0) missing.push(face);
                else if (count > 1) duplicated.push(face);
            }
            expect({ missing, duplicated }).toEqual({ missing: [], duplicated: [] });
        });
    });

    /**
     * The second invariant: the compartments never claim more of the hull than there is.
     * Assigning *less* is legal ("a ship may have fewer compartments than this number"),
     * and two ships do - the Blade-class scout, whose durability column the scan
     * destroyed, and the Gull, whose printed armour cost is a point higher than the
     * formula gives.
     */
    test('compartments never claim more durability than the hull has', () => {
        expectEach(ships, system => {
            expect(durabilityAssigned(system)).toBeLessThanOrEqual(system.hullSize);
        });
    });

    /**
     * The Player's Handbook prints an armour rating without charging durability for it, so
     * its five Moderate-armoured ships assign exactly the armour's cost more than the GM
     * Guide's budget allows. Pinned as the closed list it is, so a real transcription error
     * cannot hide behind "that's the PHB again".
     */
    test('only the PHB ships exceed the armour budget, and only by the armour cost', () => {
        const over = ships
            .filter(entry => durabilityAssigned(entry.doc.system) > durabilityAvailable(entry.doc.system))
            .map(entry => entry.doc.name)
            .sort();
        expect(over).toEqual(['Cutter', 'Space Fighter', 'Trader', 'Transport', 'Yacht']);

        for (const entry of ships) {
            const { system } = entry.doc;
            const overage = durabilityAssigned(system) - durabilityAvailable(system);
            if (overage <= 0) continue;
            const armorCost = system.hullSize - durabilityAvailable(system);
            expect(overage).toBe(armorCost);
        }
    });

    test('no compartment holds more systems than it has durability for', () => {
        expectEach(ships, system => {
            const used = new Map();
            for (const row of lineItems(system)) {
                if (!row.compartment) continue;
                used.set(row.compartment, (used.get(row.compartment) ?? 0) + row.durabilityCost);
            }
            for (const [number, cost] of used) {
                const compartment = system.compartments[number - 1];
                expect(compartment).toBeDefined();
                expect(cost).toBeLessThanOrEqual(compartment.durability);
            }
        });
    });

    test('every line item points at a compartment that exists, or at none', () => {
        expectEach(ships, system => {
            for (const row of lineItems(system)) {
                expect(Number.isInteger(row.compartment)).toBe(true);
                expect(row.compartment).toBeGreaterThanOrEqual(0);
                expect(row.compartment).toBeLessThanOrEqual(system.compartments.length);
                expect(row.isOffline).toBe(false);
            }
        });
    });

    test('weapon and system rows validate against the schema choice lists', () => {
        expectEach(ships, system => {
            for (const row of system.weapons) {
                expect(ARCS).toContain(row.arc);
                expect(DAMAGE_TYPES).toContain(row.damageType);
                expect(FIREPOWER_CLASSES).toContain(row.firepower);
                expect(row.actionsPerRound).toBe(1);
            }
            for (const row of system.systems) {
                expect(SYSTEM_CATEGORIES).toContain(row.category);
            }
        });
    });

    /**
     * A weapon states all three damage grades or none of them. None is the launch tubes
     * and racks, whose damage belongs to the missile loaded into them - and a row with
     * one or two grades filled in would be a dropped OCR line, not a rule.
     */
    test('a weapon prints all three damage grades or none', () => {
        expectEach(ships, system => {
            for (const row of system.weapons) {
                const grades = [row.damageOrdinary, row.damageGood, row.damageAmazing];
                const filled = grades.filter(grade => grade !== '').length;
                expect([0, 3]).toContain(filled);
                // A row with no damage of its own has to say why.
                if (filled === 0) expect(row.notes.length).toBeGreaterThan(0);
            }
        });
    });

    /** "A ship must have at least one command compartment." (GM Guide Table G35) */
    test('every ship has a command compartment', () => {
        expectEach(ships, system => {
            expect(system.compartments.some(c => c.kind === 'Command')).toBe(true);
        });
    });

    /**
     * And an engineering compartment, if it has an engine at all - the escape pod is the
     * one published hull with neither.
     */
    test('every ship with an engine has an engineering compartment', () => {
        const powered = ships.filter(entry => entry.doc.system.engineType !== '');
        expect(powered.length).toBe(ships.length - 1);
        expectEach(powered, system => {
            expect(system.compartments.some(c => c.kind === 'Engineering')).toBe(true);
        });
    });

    /** The ships whose statblock the scan damaged say so, rather than reading as clean. */
    test('every reconstructed ship records what was reconstructed', () => {
        const reconstructed = ships.filter(entry =>
            entry.doc.flags['alternity'].provenance.scanDamage);
        expect(reconstructed.map(entry => entry.doc.name).sort()).toEqual([
            'Alaundril Lucre-class Escort',
            'CSS Stingray',
            'Concord Blade-class Scout',
            'Nike-class Gunboat',
            'Solar X Gull',
            'The Blackguard',
            'The Sirocco',
            'Yacht',
        ]);
    });
});

describe('vehicles', () => {
    const OPERATION_SKILLS = ['Land vehicle', 'Water vehicle', 'Air vehicle',
        'Space vehicle', 'Daredevil', 'None'];
    const SCALES = ['Personal', 'Surface', 'Air', 'Space'];
    const TOUGHNESS = ['Ordinary', 'Good', 'Amazing'];
    const AVAILABILITY = ['Any', 'Common', 'Controlled', 'Military', 'Restricted'];
    /** Skill -> scale, the one column the converter infers rather than transcribes. */
    const SCALE_FOR_SKILL = {
        'Land vehicle': 'Surface', 'Water vehicle': 'Surface', 'Air vehicle': 'Air',
        'Space vehicle': 'Space', 'Daredevil': 'Personal', 'None': 'Space',
    };

    const vehicles = ALL.filter(entry =>
        entry.pack === 'alternity-vehicles' && entry.doc._key?.startsWith('!actors!'));

    test('the pack is populated', () => expect(vehicles.length).toBe(42));

    test('the pack holds nothing but vehicles', () => {
        const strays = vehicles.filter(entry => entry.doc.type !== 'vehicle');
        expect(strays.map(entry => `${entry.doc.name} (${entry.doc.type})`)).toEqual([]);
    });

    test('classification fields validate against the schema choice lists', () => {
        expectEach(vehicles, system => {
            expect(OPERATION_SKILLS).toContain(system.operationSkill);
            expect(SCALES).toContain(system.scale);
            expect(TOUGHNESS).toContain(system.toughness);
            expect(AVAILABILITY).toContain(system.availability);
            expect(Number.isInteger(system.progressLevel)).toBe(true);
            expect(system.progressLevel).toBeGreaterThanOrEqual(0);
            expect(system.progressLevel).toBeLessThanOrEqual(9);
            expect(Number.isInteger(system.drvModifier)).toBe(true);
            expect(Math.abs(system.drvModifier)).toBeLessThanOrEqual(5);
        });
    });

    /**
     * The scale is the only column here that is not read off the page - Table P45 did
     * not survive the scan - so it is a pure function of the printed Skill column, and
     * this is the check that it stayed one.
     */
    test('scale is exactly the documented function of the skill', () => {
        expectEach(vehicles, system => {
            expect(system.scale).toBe(SCALE_FOR_SKILL[system.operationSkill]);
        });
    });

    /** Every row prints either a stun/wound/mortal run or a hull, and never both. */
    test('a row is damage-rated or hull-rated, not both and not neither', () => {
        expectEach(vehicles, system => {
            const hasRun = system.durabilityRatings.stun > 0;
            const hasHull = system.hull.size > 0;
            expect(hasRun !== hasHull).toBe(true);
            if (hasHull) expect(system.hull.compartments).toBeGreaterThan(0);
        });
    });

    /**
     * Table P42 prints stun and wound as the same number on every row that has them.
     * That is exact across all thirty-two damage-rated rows, so a transcription slip of
     * a single digit in either column breaks this.
     */
    test('stun and wound are the same number, the way the table prints them', () => {
        const rated = vehicles.filter(entry => entry.doc.system.durabilityRatings.stun > 0);
        expect(rated).toHaveLength(32);
        expectEach(rated, system => {
            expect(system.durabilityRatings.stun).toBe(system.durabilityRatings.wound);
            expect(system.durabilityRatings.mortal).toBeGreaterThan(0);
            expect(system.durabilityRatings.mortal).toBeLessThanOrEqual(system.durabilityRatings.wound);
        });
    });

    /**
     * Mortal is otherwise half the wound rating, rounded either way - the book does
     * both, so this only checks it is within a point. **Rows printed outside even that
     * are pinned here rather than quietly corrected**: if a later pass over the page
     * scan finds the fighter jet is really 13/13/6, this test failing is the intended
     * signal to change it on purpose.
     */
    test('mortal is half the wound rating, bar the row the table prints otherwise', () => {
        const outliers = vehicles
            .filter(entry => {
                const { wound, mortal } = entry.doc.system.durabilityRatings;
                return wound > 0 && Math.abs(mortal - wound / 2) > 1;
            })
            .map(entry => {
                const { stun, wound, mortal } = entry.doc.system.durabilityRatings;
                return `${entry.doc.name} ${stun}/${wound}/${mortal}`;
            });
        expect(outliers.sort()).toEqual(['Fighter jet 13/13/5']);
    });

    test('nothing in the compendium arrives pre-damaged or pre-armed', () => {
        expectEach(vehicles, system => {
            expect(system.damage).toEqual({ stun: 0, wound: 0, mortal: 0 });
            expect(system.isConkedOut).toBe(false);
            expect(system.speedBand).toBe('Cruising');
            // Every printed weapon code in Ch.12 is OCR-damaged past the point of
            // honesty, so the rows are left for a human with the book open.
            expect(system.weapons).toEqual([]);
        });
    });

    /**
     * The printed cells are kept verbatim on the provenance flag, so the parsed fields
     * can be checked back against them without going to the scan. This is the whole
     * transcription, round-tripped.
     */
    test('every parsed field still agrees with the cell it was read from', () => {
        expectEach(vehicles, (system, doc) => {
            const printed = doc.flags['alternity'].provenance.printed;
            const { stun, wound, mortal } = system.durabilityRatings;
            const dur = system.hull.size > 0
                ? `Hull ${system.hull.size}/${system.hull.compartments}`
                : `${stun}/${wound}/${mortal}`;
            expect(dur).toBe(printed.dur);
            expect(system.drvModifier).toBe(printed.drv === '-' ? 0 : Number(printed.drv));
            expect(system.acceleration).toBe(printed.acc === '-' ? '' : printed.acc);
            expect(system.cruiseSpeed).toBe(printed.cruise === '-' ? '' : printed.cruise);
            expect(system.maxSpeed).toBe(printed.max === '-' ? '' : printed.max);
            expect(system.cost).toBe(printed.cost);
        });
    });

    /**
     * The two rows the rest of the book independently states a number for. These are
     * what says the page was read correctly at all, so they are pinned as data.
     */
    test('the two rows the prose corroborates match the prose', () => {
        const car = vehicles.find(entry => entry.doc.name === 'Mid-sized car');
        // "a mid-sized car with 10 stun points needs a 10 or less to pass its check"
        expect(car.doc.system.durabilityRatings).toEqual({ stun: 10, wound: 10, mortal: 5 });

        const shuttle = vehicles.find(entry => entry.doc.name === 'STG shuttle');
        // "Statistics: Hull size 16, 4 compartments."
        expect(shuttle.doc.system.hull).toEqual({ size: 16, compartments: 4 });
    });

    /** Armour is transcribed from prose, not from the table, so only three rows have it. */
    test('armour is a die range per damage form, on the three rows that print one', () => {
        const armoured = vehicles.filter(entry => entry.doc.system.armor.type !== '');
        expect(armoured.map(entry => entry.doc.name).sort())
            .toEqual(['STG shuttle', 'Skytank', 'Tank']);
        expectEach(armoured, system => {
            for (const form of ['lowImpact', 'highImpact', 'energy']) {
                const code = system.armor[form];
                if (code) expect(code).toMatch(/^d\d+([+-]\d+)?$/);
            }
        });
    });

    test('every row records the table it came from', () => {
        expectEach(vehicles, (_system, doc) => {
            const provenance = doc.flags['alternity'].provenance;
            expect(provenance.table).toMatch(/^Table P42/);
            expect(provenance.folder).toMatch(/^PL /);
        });
    });
});
