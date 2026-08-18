/**
 * @file tools/convert/armor.mjs
 * @description `ArmorItem` records -> `armor` Items.
 *
 * The source data's `@AP` column is the suit's **Action Penalty**, not armour piercing
 * and not an armour class: the Star Drive Arms & Equipment Guide prints "Action
 * Penalty: +2" for the Tiger Mod 6, whose record carries `@AP="2"`. So it lands on
 * `skillPenalty`, the step penalty the wearer takes on checks.
 *
 * `resistanceModifierBonus` is deliberately left at 0 for everything. It is not a
 * property of how thick the armour is - only field gear that says so in its own entry
 * (the deflection harness, the displacer softsuit) adjusts a resistance modifier, and
 * the source data has no column for it.
 */

import { makeItem, statBlock } from '../lib/fvtt.mjs';
import {
    readRecordsAcross, attr, num, int, str, bookLabel, availabilityLabel, disambiguateNames,
} from '../lib/source-data.mjs';

export const PACK = 'alternity-armor';

/** `@Toughness` is an index into the personal toughness ladder (GM Guide Ch.11). */
const TOUGHNESS = { 1: 'Ordinary', 2: 'Good', 3: 'Amazing' };

/**
 * `armorType` derived from the skill the suit requires, which is the only signal the
 * source data carries about how heavy it is: -1 means it needs no training at all,
 * 0 is the Armor Operation broad skill, 1 is its combat-armor specialty and 2 its
 * powered-armor specialty. The books agree - the Tiger Mod 6 prints "Skill: Armor
 * Operation-powered armor" and carries `@SkillID="2"`.
 */
const ARMOR_TYPE_BY_SKILL = { '-1': 'Light', 0: 'Medium', 1: 'Heavy', 2: 'Powered' };

/** The Armor Operation specialty a suit is worn with, for the description. */
const SKILL_LABEL = {
    '-1': '',
    0: 'Armor Operation',
    1: 'Armor Operation - combat armor',
    2: 'Armor Operation - powered armor',
};

export function convert() {
    const records = readRecordsAcross('data', 'armor_', ['ArmorList', 'ArmorItem']);

    const entries = records.map(record => ({
        name: str(attr(record, 'Name')) || 'Unnamed Armor',
        book: bookLabel(attr(record, 'Source'), record._sourceFile),
        record,
    }));
    disambiguateNames(entries);

    return entries.map(({ name, book, record }) => {
        const skillId = String(attr(record, 'SkillID') ?? '-1');
        const armorType = ARMOR_TYPE_BY_SKILL[skillId] ?? 'Light';
        const protection = {
            li: str(attr(record, 'LI')),
            hi: str(attr(record, 'HI')),
            en: str(attr(record, 'En')),
        };
        const actionPenalty = int(attr(record, 'AP'), 0);
        const availability = availabilityLabel(attr(record, 'Availability'));

        const provenance = {
            book,
            sourceFile: record._sourceFile,
            progressLevel: int(attr(record, 'PL'), 0),
            cost: int(attr(record, 'Cost'), 0),
            availability,
            mass: num(attr(record, 'Mass'), 0),
            concealment: int(attr(record, 'Hide'), 0),
            actionPenalty,
            requiredSkill: SKILL_LABEL[skillId] ?? '',
        };

        const description = statBlock([
            ['Protection', [
                protection.li && `${protection.li} (LI)`,
                protection.hi && `${protection.hi} (HI)`,
                protection.en && `${protection.en} (En)`,
            ].filter(Boolean).join(', ')],
            ['Toughness', TOUGHNESS[Number(attr(record, 'Toughness'))] ?? 'Ordinary'],
            ['Action penalty', actionPenalty ? `+${actionPenalty}` : '0'],
            ['Hide', str(record.Hide)],
            ['Mass', provenance.mass ? `${provenance.mass} kg` : ''],
            ['Skill', provenance.requiredSkill],
            ['Progress level', provenance.progressLevel || ''],
            ['Cost', provenance.cost ? `${provenance.cost} cr` : ''],
            ['Availability', availability],
            ['Source', book],
        ]);

        return makeItem({
            pack: PACK,
            name,
            type: 'armor',
            img: 'icons/svg/shield.svg',
            provenance,
            system: {
                armorType,
                protection,
                toughness: TOUGHNESS[Number(attr(record, 'Toughness'))] ?? 'Ordinary',
                speedPenalty: 0,
                // Clamped to the schema's ceiling; nothing in the data comes near it.
                skillPenalty: Math.min(10, Math.max(0, actionPenalty)),
                resistanceModifierBonus: 0,
                techPointCost: 0,
                isEquipped: false,
                weight: num(attr(record, 'Mass'), 0),
                description,
            },
        });
    });
}
