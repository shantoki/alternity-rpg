/**
 * @file tools/convert/cybertech.mjs
 * @description `CyberItem` records -> `cybertech` Items.
 *
 * Each piece of cyberware is printed once per quality grade, so the 23 distinct devices
 * arrive as 57 records. They stay 57 items - an Ordinary BattleKlaw and an Amazing one
 * differ in cost, mass and effect - with the grade in the item name so the compendium
 * list is readable.
 *
 * The category assignment follows the list `CybertechData` already carries in the
 * comments beside `CYBERTECH_CATEGORIES`, which names these exact devices.
 */

import { makeItem, statBlock } from '../lib/fvtt.mjs';
import { readRecords, asArray, attr, num, int, bool, str, bookLabel, disambiguateNames } from '../lib/source-data.mjs';

export const PACK = 'alternity-cybertech';

/** `@Quality` is an index into the Ordinary/Good/Amazing ladder. */
const QUALITY = { 1: 'Ordinary', 2: 'Good', 3: 'Amazing' };

/**
 * A `SpecialItem` with `@Context="6"` is a durability bonus, and its `@Op` names the
 * track: 1 stun, 2 wound, 3 mortal. The same encoding appears on the achievement
 * records, where `Stun Rating Increase` carries `Context=6 Op=1`.
 *
 * Six records use it - CF Skinweave and the Exoskeleton, at each quality grade - and
 * they are the only cyberware in the data set whose effect is stated mechanically
 * rather than left to the Dataware text.
 */
const DURABILITY_TRACKS = { 1: 'stun', 2: 'wound', 3: 'mortal' };

/** Read the durability bonuses off a record's `SpecialItems` block. */
function parseDurabilityBonus(record) {
    const bonus = { stun: 0, wound: 0, mortal: 0 };
    for (const special of asArray(record.SpecialItems?.SpecialItem)) {
        if (String(attr(special, 'Context')) !== '6') continue;
        const track = DURABILITY_TRACKS[Number(attr(special, 'Op'))];
        if (!track) continue;
        bonus[track] += int(attr(special, 'Sub2'), 0);
    }
    return bonus;
}

/** Device -> `CYBERTECH_CATEGORIES` entry, following that constant's own commentary. */
const CATEGORIES = {
    'BattleKlaw': 'Weapon',
    'Subdermal Weapon Mount': 'Weapon',
    'Body Plating': 'Protection',
    'CF Skinweave': 'Protection',
    'Exoskeleton': 'Protection',
    'Cyberlimb': 'Enhancement',
    'Muscle Plus': 'Enhancement',
    'Fast Chip': 'Enhancement',
    'Reflex': 'Enhancement',
    'Cyberoptics': 'Sensory',
    'Optic Screen': 'Sensory',
    'Nanocomputer': 'Interface',
    'NIJack': 'Interface',
    'Subdermal NIJack': 'Interface',
    'Wireless NIJack': 'Interface',
    'Neural 3D Data Slot (external)': 'Interface',
    'Data Slot (passive)': 'Interface',
    'Subdermal Comm': 'Interface',
    'Self-Repair Unit': 'Utility',
    'ER Slot': 'Utility',
    'ER Slot (passive)': 'Utility',
    'BioWatch': 'Utility',
    'BioArt': 'Cosmetic',
};

export function convert() {
    const records = readRecords('data/cyberware.json', ['CyberwareList', 'CyberItem']);

    const entries = records.map(record => {
        const device = str(attr(record, 'Name')) || 'Unnamed Cyberware';
        const quality = QUALITY[Number(attr(record, 'Quality'))] ?? 'Ordinary';
        return {
            name: `${device}, ${quality}`,
            book: bookLabel(attr(record, 'Source'), record._sourceFile),
            device,
            quality,
            record,
        };
    });
    disambiguateNames(entries);

    return entries.map(({ name, book, device, quality, record }) => {
        const durabilityBonus = parseDurabilityBonus(record);
        const provenance = {
            book,
            sourceFile: record._sourceFile,
            device,
            quality,
            progressLevel: int(attr(record, 'PL'), 0),
            cost: int(attr(record, 'Cost'), 0),
            mass: num(attr(record, 'Mass'), 0),
            size: int(attr(record, 'Size'), 0),
            multipleAllowed: bool(attr(record, 'Multi')),
            requiresNanocomputer: bool(attr(record, 'NanoComp')),
            requiresSkillPoints: bool(attr(record, 'NeedSkill')),
            durabilityBonus,
        };

        const description = statBlock([
            ['Quality', quality],
            ['Size', provenance.size],
            ['Mass', provenance.mass ? `${provenance.mass} kg` : ''],
            ['Progress level', provenance.progressLevel || ''],
            ['Cost', provenance.cost ? `${provenance.cost} cr` : ''],
            ['Multiple allowed', provenance.multipleAllowed ? 'Yes' : 'No'],
            ['Durability bonus', [
                durabilityBonus.stun && `+${durabilityBonus.stun} stun`,
                durabilityBonus.wound && `+${durabilityBonus.wound} wound`,
                durabilityBonus.mortal && `+${durabilityBonus.mortal} mortal`,
            ].filter(Boolean).join(', ')],
            ['Requires nanocomputer', provenance.requiresNanocomputer ? 'Yes' : 'No'],
            ['Costs skill points', provenance.requiresSkillPoints ? 'Yes' : 'No'],
            ['Source', book],
        ]);

        return makeItem({
            pack: PACK,
            name,
            type: 'cybertech',
            img: 'icons/svg/upgrade.svg',
            provenance,
            system: {
                category: CATEGORIES[device] ?? 'Enhancement',
                quality,
                progressLevel: Math.min(9, Math.max(0, provenance.progressLevel)),
                cost: provenance.cost,
                mass: provenance.mass,
                size: provenance.size,
                requiresNanocomputer: provenance.requiresNanocomputer,
                // The source data has no column for either prerequisite; both are
                // stated in the Dataware entries themselves, so they wait for the
                // prose pass rather than being guessed from the device name.
                requiresExoskeleton: false,
                requiresCyberlimb: false,
                requiresSkillPoints: provenance.requiresSkillPoints,
                isInstalled: false,
                isDamaged: false,
                durabilityBonus,
                actionCheckModifier: 0,
                damageFormula: '',
                isActivated: false,
                activationCost: '',
                description,
            },
        });
    });
}
