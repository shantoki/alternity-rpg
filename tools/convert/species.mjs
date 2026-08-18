/**
 * @file tools/convert/species.mjs
 * @description `Species` records -> JournalEntry pages.
 *
 * There is no `species` Item type yet, so these land as readable journal entries rather
 * than as droppable items. The full structured record is kept on each entry's
 * `provenance` flag - ability ranges, free skills, multipliers and every special-ability
 * note - so promoting them to a real Item subtype later is a matter of reading that flag
 * back out rather than re-running the conversion against the source data.
 *
 * See `PLANS_FOR_COMPENDIUM.md` for what that promotion needs.
 */

import { makeJournalEntry, escapeHtml } from '../lib/fvtt.mjs';
import { readRecords, asArray, attr, num, int, bool, str, bookLabel } from '../lib/source-data.mjs';
import { loadSourceSkills, qualifiedName } from '../lib/skill-map.mjs';

export const PACK = 'alternity-species';

const ABILITIES = ['STR', 'DEX', 'CON', 'INT', 'WIL', 'PER'];

function abilityTable(record) {
    const rows = ABILITIES.map(ability => {
        const range = record[ability] ?? {};
        return `<tr><th>${ability}</th><td>${int(attr(range, 'Min'), 4)}</td><td>${int(attr(range, 'Max'), 14)}</td></tr>`;
    });
    return `<table><thead><tr><th>Ability</th><th>Minimum</th><th>Maximum</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

function list(items) {
    if (!items.length) return '';
    return `<ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

export function convert() {
    const skills = loadSourceSkills();
    const records = readRecords('data/species.json', ['SpeciesList', 'Species']);

    return records.map((record, index) => {
        const name = str(record.Name) || 'Unnamed Species';
        const book = bookLabel(record.Source, record._sourceFile);

        const freeSkills = asArray(record.FreeSkills?.FreeSkill)
            .map(entry => qualifiedName(skills.get(int(attr(entry, 'ID'), -1)), skills))
            .filter(Boolean);

        const specialAbilities = asArray(record.SpecialItems?.SpecialItem)
            .map(entry => str(attr(entry, 'Note')) || str(entry.Note))
            .filter(Boolean);

        const abilityRanges = Object.fromEntries(ABILITIES.map(ability => [ability, {
            min: int(attr(record[ability] ?? {}, 'Min'), 4),
            max: int(attr(record[ability] ?? {}, 'Max'), 14),
        }]));

        const provenance = {
            book,
            sourceFile: record._sourceFile,
            sourceSpeciesId: int(attr(record, 'ID'), index),
            abilityRanges,
            bonusSkillPoints: int(attr(record, 'SkillPoints'), 0),
            bonusBroadSkills: int(attr(record, 'BroadSkills'), 0),
            durabilityMultiplier: num(attr(record, 'DurMult'), 1),
            psionicMultiplier: num(attr(record, 'PsiMult'), 1),
            isPsionic: bool(attr(record, 'Psionic')),
            canGlide: bool(attr(record, 'CanGlide')),
            canFly: bool(attr(record, 'CanFly')),
            actionCheckStep: int(record.ActionStep, 0),
            freeSkills,
            specialAbilities,
        };

        const traits = [
            provenance.bonusSkillPoints ? `${provenance.bonusSkillPoints} bonus skill points` : '',
            provenance.bonusBroadSkills ? `${provenance.bonusBroadSkills} extra broad skill` : '',
            provenance.durabilityMultiplier !== 1 ? `Durability scores are CON x ${provenance.durabilityMultiplier}` : '',
            provenance.psionicMultiplier !== 1 ? `Psionic energy is WIL x ${provenance.psionicMultiplier}` : '',
            provenance.actionCheckStep ? `Action check step ${provenance.actionCheckStep > 0 ? '+' : ''}${provenance.actionCheckStep}` : '',
            provenance.isPsionic ? 'Psionically active' : '',
            provenance.canFly ? 'Can fly' : '',
            provenance.canGlide ? 'Can glide' : '',
        ].filter(Boolean);

        const html = [
            `<h2>Ability Ranges</h2>${abilityTable(record)}`,
            traits.length ? `<h2>Species Traits</h2>${list(traits)}` : '',
            freeSkills.length ? `<h2>Free Skills</h2>${list(freeSkills)}` : '',
            specialAbilities.length ? `<h2>Special Abilities</h2>${list(specialAbilities)}` : '',
            `<p><em>Source: ${escapeHtml(book)}</em></p>`,
        ].filter(Boolean).join('');

        return makeJournalEntry({ pack: PACK, name, html, provenance, sort: index * 100 });
    });
}
