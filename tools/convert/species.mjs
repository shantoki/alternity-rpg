/**
 * @file tools/convert/species.mjs
 * @description `Species` records -> `species` Items.
 *
 * These were JournalEntries until the `species` Item type existed, because the numbers a
 * species carries - the multiplier Constitution goes through on the way to the durability
 * tracks, the one Willpower goes through on the way to psionic energy, the range each
 * ability may be bought within - had nowhere to be stored where the system could read
 * them back. `SpeciesData` is that place, so they are droppable items now.
 *
 * **The document ids changed with the type, and that is unavoidable.** A compendium UUID
 * names the document type (`Compendium.alternity.alternity-species.JournalEntry.<id>`),
 * so a link into the old pack breaks whatever id the new document is given. Hashing
 * `(pack, 'species', name)` like every other item keeps them stable from here on.
 */

import { makeItem, statBlock, escapeHtml } from '../lib/fvtt.mjs';
import { readRecords, asArray, attr, num, int, bool, str, bookLabel } from '../lib/source-data.mjs';
import { loadSourceSkills, qualifiedName } from '../lib/skill-map.mjs';

export const PACK = 'alternity-species';

/** Foundry ships no species artwork; the generic figure is closer than a loot bag. */
export const SPECIES_IMG = 'icons/svg/mystery-man.svg';

const ABILITIES = ['STR', 'DEX', 'CON', 'INT', 'WIL', 'PER'];

/**
 * A special ability whose printed note states a step modifier on attacks aimed at its
 * owner - "Weren Camouflage: +1 step to ranged attacks vs. weren".
 *
 * Narrow on purpose. Most species notes are prose a Gamemaster adjudicates ("do not
 * suffer impact damage if conscious and can use wings"), and a looser pattern would turn
 * a sentence that merely mentions steps into a modifier the system applies behind the
 * player's back. Anything this does not match keeps `effectTarget: 'None'` and is carried
 * as description text, which is what the note is.
 */
const DEFENSE_NOTE = /([+-]?\d+)\s*steps?\s+to\s+(ranged|melee)?\s*attacks?\s+(?:vs\.?|against)\b/i;

/** Natural armour as the books print it: `d4+1 (LI), d4 (HI), d4-1 (En)`. */
const NATURAL_ARMOR_NOTE = /natural armou?r of\s+(.+)$/i;
const ARMOR_RATING = /([\w+-]+)\s*\((LI|HI|En)\)/gi;

/**
 * Split a printed note into the name before the colon and the note itself.
 *
 * Every note in the data set is written "Weren Superior Durability: CON x 1.5 for
 * durability scores", so the part before the colon is already a usable label. The few
 * without one ("Sesheyan Flight Ability") become their own name with no description,
 * rather than a nameless row.
 */
function splitNote(note) {
    const colon = note.indexOf(':');
    if (colon === -1) return { name: note.trim(), description: '' };
    return { name: note.slice(0, colon).trim(), description: note.trim() };
}

/** Read the mechanical payload out of a note, where it states one. */
function abilityEffect(note) {
    const match = DEFENSE_NOTE.exec(note);
    if (!match) return { effectTarget: 'None', effectValue: 0, attackKind: 'Any' };

    const [, steps, kind] = match;
    return {
        effectTarget: 'AttacksAgainstMe',
        // Positive is a penalty on whoever the effect lands on - the attacker, here -
        // which is the convention the printed note already uses.
        effectValue: Number(steps),
        attackKind: kind ? `${kind[0].toUpperCase()}${kind.slice(1).toLowerCase()}` : 'Any',
    };
}

/**
 * Pull natural armour ratings out of whichever note states them.
 *
 * One species in the data set has any (the T'sa), so this returns blanks for everyone
 * else rather than inventing a rating of zero - "no natural armour" and "armour that
 * stops nothing" are different statements, and these are read as printed die
 * expressions rather than as numbers.
 */
function naturalArmor(notes) {
    const armor = { li: '', hi: '', en: '' };
    for (const note of notes) {
        const match = NATURAL_ARMOR_NOTE.exec(note);
        if (!match) continue;
        for (const [, value, form] of match[1].matchAll(ARMOR_RATING)) {
            armor[form.toLowerCase()] = value;
        }
    }
    return armor;
}

function abilityTable(ranges) {
    const rows = ABILITIES.map(ability =>
        `<tr><th>${ability}</th><td>${ranges[ability].min}</td><td>${ranges[ability].max}</td></tr>`);
    return `<table><thead><tr><th>Ability</th><th>Minimum</th><th>Maximum</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

function list(items) {
    if (!items.length) return '';
    return `<ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

/**
 * Build a `species` Item's `system` data from one source record.
 *
 * Exported because the career templates carry their species inline - every one of the
 * 54 is Human, and each template file repeats the whole Species record - so
 * `templates.mjs` can embed a real species Item on each template actor instead of
 * leaving them with a species name and none of its numbers.
 *
 * @param {object} record  A `Species` record from the source data.
 * @param {Map}    skills  The source skill table, for resolving free-skill ids.
 * @param {string} [book]  Source book label, rendered into the description.
 */
export function speciesSystem(record, skills, book = '') {
    const freeSkills = asArray(record.FreeSkills?.FreeSkill)
        .map(entry => qualifiedName(skills.get(int(attr(entry, 'ID'), -1)), skills))
        .filter(Boolean);

    const notes = asArray(record.SpecialItems?.SpecialItem)
        .map(entry => str(attr(entry, 'Note')) || str(entry.Note))
        .filter(Boolean);

    const specialAbilities = notes.map(note => ({
        ...splitNote(note),
        ...abilityEffect(note),
    }));

    const abilityRanges = Object.fromEntries(ABILITIES.map(ability => [ability, {
        min: int(attr(record[ability] ?? {}, 'Min'), 4),
        max: int(attr(record[ability] ?? {}, 'Max'), 14),
    }]));

    const system = {
        abilityRanges,
        bonusSkillPoints: int(attr(record, 'SkillPoints'), 0),
        bonusBroadSkills: int(attr(record, 'BroadSkills'), 0),
        durabilityMultiplier: num(attr(record, 'DurMult'), 1),
        psionicMultiplier: num(attr(record, 'PsiMult'), 1),
        actionCheckStep: int(record.ActionStep, 0),
        isPsionic: bool(attr(record, 'Psionic')),
        canGlide: bool(attr(record, 'CanGlide')),
        canFly: bool(attr(record, 'CanFly')),
        naturalArmor: naturalArmor(notes),
        freeSkills,
        specialAbilities,
        description: '',
    };

    // Everything the schema holds, rendered so the entry reads as a page rather than
    // as a form. The prose pass prepends the book's own text above this.
    const traits = [
        system.bonusSkillPoints ? `${system.bonusSkillPoints} bonus skill points` : '',
        system.bonusBroadSkills ? `${system.bonusBroadSkills} extra broad skill` : '',
        system.durabilityMultiplier !== 1 ? `Durability scores are CON x ${system.durabilityMultiplier}` : '',
        system.psionicMultiplier !== 1 ? `Psionic energy is WIL x ${system.psionicMultiplier}` : '',
        system.actionCheckStep ? `Action check step ${system.actionCheckStep > 0 ? '+' : ''}${system.actionCheckStep}` : '',
        system.isPsionic ? 'Psionically active' : '',
        system.canFly ? 'Can fly' : '',
        system.canGlide && !system.canFly ? 'Can glide' : '',
    ].filter(Boolean);

    const armorLine = [
        system.naturalArmor.li ? `${system.naturalArmor.li} (LI)` : '',
        system.naturalArmor.hi ? `${system.naturalArmor.hi} (HI)` : '',
        system.naturalArmor.en ? `${system.naturalArmor.en} (En)` : '',
    ].filter(Boolean).join(', ');

    system.description = [
        statBlock([
            ['Source', book],
            ['Natural armour', armorLine],
        ]),
        `<h2>Ability Ranges</h2>${abilityTable(abilityRanges)}`,
        traits.length ? `<h2>Species Traits</h2>${list(traits)}` : '',
        freeSkills.length ? `<h2>Free Skills</h2>${list(freeSkills)}` : '',
        specialAbilities.length
            ? `<h2>Special Abilities</h2>${list(specialAbilities.map(ability => ability.description || ability.name))}`
            : '',
    ].filter(Boolean).join('');

    return system;
}

/** The printed notes behind a record's `specialAbilities`, kept for provenance. */
export function speciesNotes(record) {
    return asArray(record.SpecialItems?.SpecialItem)
        .map(entry => str(attr(entry, 'Note')) || str(entry.Note))
        .filter(Boolean);
}

export function convert() {
    const skills = loadSourceSkills();
    const records = readRecords('data/species.json', ['SpeciesList', 'Species']);

    return records.map((record, index) => {
        const name = str(record.Name) || 'Unnamed Species';
        const book = bookLabel(record.Source, record._sourceFile);

        return makeItem({
            pack: PACK,
            name,
            type: 'species',
            system: speciesSystem(record, skills, book),
            img: SPECIES_IMG,
            sort: index * 100,
            provenance: {
                book,
                sourceFile: record._sourceFile,
                sourceSpeciesId: int(attr(record, 'ID'), index),
                // The printed notes, unsplit and unparsed. `specialAbilities` is derived
                // from these, so keeping them lets a later pass re-derive without the
                // source data set in hand.
                specialNotes: speciesNotes(record),
            },
        });
    });
}
