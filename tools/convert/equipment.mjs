/**
 * @file tools/convert/equipment.mjs
 * @description `EquipmentItem` records -> `personalEquipment` and `computer` Items.
 *
 * Two item types come out of one source list. The `Computers` category is everything
 * `ComputerData` exists for - mainframes, microcomputers, data slates, gauntlets - and
 * its records name their processor quality in the item name ("Microcomputer, Good"), so
 * they are routed to `computer` rather than flattened into generic gear.
 *
 * Categories are read off `@Class` in preference to `@Category`, because the Star Drive
 * Arms & Equipment Guide files its gear under *brand lines* ("Terra X", "TrailTech
 * EcoTour Gear") rather than under what the gear is. `@Class` says "Camping" and
 * "Survival Gear" for the same records, which is what the schema's category list wants.
 */

import { makeItem, statBlock } from '../lib/fvtt.mjs';
import {
    readRecordsAcross, attr, num, int, str, bookLabel, availabilityLabel, disambiguateNames,
} from '../lib/source-data.mjs';

export const PACK = 'alternity-equipment';

/** `@Class` -> the `PersonalEquipmentData` category it belongs to. */
const CLASS_TO_CATEGORY = {
    'Accessories': 'Clothing',
    'Alien Collection': 'Miscellaneous',
    'Boots': 'Clothing',
    'Business Dress': 'Clothing',
    'Camping': 'Survival',
    'Cassock': 'Clothing',
    'Casual Dress': 'Clothing',
    'Chaps': 'Clothing',
    'Cloak (Cape, Poncho, Serape)': 'Clothing',
    'Clothing': 'Clothing',
    'Coats': 'Clothing',
    'Communications': 'Communications',
    'Detector': 'Sensors',
    'Fatigues': 'Clothing',
    'Formal Dress': 'Clothing',
    'Gauntlet': 'Professional',
    'Goggles': 'Sensors',
    'Jumpsuit': 'Clothing',
    'Medical Gear': 'Medical',
    'Miscellaneous Gear': 'Miscellaneous',
    'Nav Gear': 'Sensors',
    'Professional Equipment': 'Professional',
    'Professional Gauntlet': 'Professional',
    'Pyjamas': 'Clothing',
    'Robes': 'Clothing',
    'Scanner': 'Sensors',
    'Sensors': 'Sensors',
    'Shoes': 'Clothing',
    'Socks': 'Clothing',
    'Surveillance Gear': 'Sensors',
    'Survival Gear': 'Survival',
    'Tracker': 'Sensors',
    'Underclothes': 'Clothing',
    'Uniform': 'Clothing',
    'Vidcam': 'Sensors',
};

/** `@Category` -> category, for records whose `@Class` is not in the table above. */
const CATEGORY_FALLBACK = {
    'Accessories and Clothing': 'Clothing',
    'Communications': 'Communications',
    'Medical Gear': 'Medical',
    'Miscellaneous Gear': 'Miscellaneous',
    'Professional Equipment': 'Professional',
    'Sensors': 'Sensors',
    'Survival Gear': 'Survival',
};

/** The gear classes that are computers rather than personal equipment. */
const COMPUTER_CLASSES = new Set([
    'AI Systems', 'Business Systems', 'Gridware', 'Hardware', 'Personal Systems',
]);

const QUALITIES = ['Marginal', 'Ordinary', 'Good', 'Amazing'];

/** A computer's processor quality, which its records carry as a name suffix. */
function parseQuality(name) {
    const match = String(name).match(/,\s*(Marginal|Ordinary|Good|Amazing)\s*$/i);
    if (!match) return '';
    return QUALITIES.find(quality => quality.toLowerCase() === match[1].toLowerCase()) ?? '';
}

function isComputer(record) {
    return str(attr(record, 'Category')) === 'Computers'
        || COMPUTER_CLASSES.has(str(attr(record, 'Class')));
}

export function convert() {
    const records = readRecordsAcross('data', 'equip_', ['Equipment', 'EquipmentList', 'EquipmentItem']);

    const entries = records.map(record => ({
        name: str(attr(record, 'Name')) || 'Unnamed Equipment',
        book: bookLabel(attr(record, 'Source'), record._sourceFile),
        record,
    }));
    disambiguateNames(entries);

    return entries.map(({ name, book, record }) => {
        const availability = availabilityLabel(attr(record, 'Availability'));
        const provenance = {
            book,
            sourceFile: record._sourceFile,
            category: str(attr(record, 'Category')),
            class: str(attr(record, 'Class')),
            progressLevel: int(attr(record, 'PL'), 0),
            cost: int(attr(record, 'Cost'), 0),
            availability,
            mass: num(attr(record, 'Mass'), 0),
        };

        const description = statBlock([
            ['Class', provenance.class],
            ['Category', provenance.category],
            ['Mass', provenance.mass ? `${provenance.mass} kg` : ''],
            ['Progress level', provenance.progressLevel || ''],
            ['Cost', provenance.cost ? `${provenance.cost} cr` : ''],
            ['Availability', availability],
            ['Source', book],
        ]);

        if (isComputer(record)) {
            return makeItem({
                pack: PACK,
                name,
                type: 'computer',
                img: 'icons/svg/book.svg',
                provenance,
                system: {
                    mass: provenance.mass,
                    processorQuality: parseQuality(name),
                    // The source data has no memory or storage columns - those are
                    // printed in Dataware and the Arms & Equipment Guide, so they stay
                    // at zero until the prose pass fills them in.
                    activeMemory: 0,
                    activeStorage: 0,
                    programs: '',
                    description,
                },
            });
        }

        return makeItem({
            pack: PACK,
            name,
            type: 'personalEquipment',
            img: 'icons/svg/item-bag.svg',
            provenance,
            system: {
                category: CLASS_TO_CATEGORY[provenance.class]
                    ?? CATEGORY_FALLBACK[provenance.category]
                    ?? 'Miscellaneous',
                // The schema caps progress level at 8; the data tops out at 7.
                progressLevel: Math.min(8, Math.max(0, provenance.progressLevel)),
                cost: provenance.cost,
                mass: provenance.mass,
                bonusSkill: '',
                bonusValue: 0,
                maxCharges: 0,
                currentCharges: 0,
                powerNotes: '',
                isEquipped: false,
                quantity: 1,
                description,
            },
        });
    });
}
