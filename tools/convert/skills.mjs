/**
 * @file tools/convert/skills.mjs
 * @description `Skill` records from the mundane skill lists -> `skill` Items.
 *
 * These are catalogue entries, not a hero's skills: every one is converted at rank 0,
 * so dragging one onto a sheet gives an untrained entry to raise rather than a
 * pre-bought rank.
 *
 * `system.skillId` is the bridge back to `SKILL_DEFINITIONS`, so an item dropped on a
 * hero sheet can be matched against the skill tree the sheet already draws. It is blank
 * for the skills this system's tree does not model - the Armor Operation specialties,
 * and the placeholder rows for player-named specialties such as "Knowledge (specific)".
 */

import { makeItem, statBlock } from '../lib/fvtt.mjs';
import { readSource, listSource, asArray, attr, int, str, bookLabel, disambiguateNames } from '../lib/source-data.mjs';
import { loadSourceSkills, resolveSkillId, qualifiedName, STAT_ID_TO_ABILITY } from '../lib/skill-map.mjs';

export const PACK = 'alternity-skills';

/** The `@Professions` column's letters (PHB Ch.3). */
const PROFESSIONS = {
    C: 'Combat Spec',
    D: 'Diplomat',
    F: 'Free Agent',
    T: 'Tech Op',
    M: 'Mindwalker',
};

function professionLabel(raw) {
    return String(raw ?? '').split('').map(letter => PROFESSIONS[letter]).filter(Boolean).join(', ');
}

export function convert() {
    const allSkills = loadSourceSkills();

    const records = listSource('data', 'skills_').flatMap(file => {
        const block = readSource(file).Skills;
        return asArray(block?.Skill).map(record => ({ ...record, _sourceFile: file, _listName: str(block['@Name']) }));
    });

    const entries = records.map(record => {
        const id = Number(attr(record, 'ID'));
        const skill = allSkills.get(id);
        return {
            name: qualifiedName(skill, allSkills).replace(' / ', ' - ') || str(attr(record, 'Name')),
            book: bookLabel(attr(record, 'Source'), record._sourceFile),
            record,
            skill,
        };
    });
    disambiguateNames(entries);

    return entries.map(({ name, book, record, skill }) => {
        const isBroad = String(attr(record, 'Type')) === '0';
        const basePrice = int(attr(record, 'BasePrice'), 0);
        const untrained = String(attr(record, 'Untrained')).toLowerCase() === 'true';
        const professions = professionLabel(attr(record, 'Professions'));

        const provenance = {
            book,
            sourceFile: record._sourceFile,
            sourceSkillId: Number(attr(record, 'ID')),
            broadSkill: isBroad ? '' : (allSkills.get(Number(attr(record, 'BroadID')))?.name ?? ''),
            isBroad,
            basePrice,
            usableUntrained: untrained,
            professions,
        };

        const description = statBlock([
            ['Skill type', isBroad ? 'Broad skill' : 'Specialty skill'],
            ['Broad skill', provenance.broadSkill],
            ['Ability', STAT_ID_TO_ABILITY[Number(attr(record, 'StatID'))] ?? 'INT'],
            ['Cost', basePrice ? `${basePrice} skill points` : ''],
            ['Untrained', untrained ? 'Can be used untrained' : 'Cannot be used untrained'],
            ['Professions', professions],
            ['Source', book],
        ]);

        return makeItem({
            pack: PACK,
            name,
            type: 'skill',
            img: 'icons/svg/book.svg',
            provenance,
            system: {
                skillId: resolveSkillId(skill, allSkills),
                linkedAbility: STAT_ID_TO_ABILITY[Number(attr(record, 'StatID'))] ?? 'INT',
                rank: 0,
                isBackground: false,
                specialisation: '',
                specialisationBonus: 2,
                effectiveRank: 0,
                targetNumber: 10,
                description,
            },
        });
    });
}
