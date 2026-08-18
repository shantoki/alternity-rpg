/**
 * @file tools/convert/templates.mjs
 * @description `Hero` template files -> `character` Actors.
 *
 * These are the character generator's *career templates*, not finished heroes: every
 * ability sits at 10, there is no gear and the only attack form is Unarmed. What they
 * do carry is the skill package for a career - which skills at which rank, bought with
 * that profession's points - plus the profession and species benefits as prose notes.
 * Dragged out of the compendium, one gives a GM a ready-made starting hero to raise
 * abilities on rather than a statblock to use as-is.
 *
 * Both actor data layers are written, as `AlternityActor.saveAltState` would: the
 * `characterState` flag is built by instantiating the real `AlternityCharacterState`
 * (which imports nothing Foundry-specific, so it runs under plain Node), and the
 * `system` fields it mirrors are filled from the same numbers.
 */

import fs from 'node:fs';
import path from 'node:path';
import { makeActor, stableId, statBlock, escapeHtml, slugify } from '../lib/fvtt.mjs';
import { SOURCE_ROOT, readSource, asArray, attr, int, str, bookLabel } from '../lib/source-data.mjs';
import { AlternityCharacterState, SKILL_DEFINITIONS } from '../../src/data/alternity-actor-data.js';
import { loadSourceSkills, resolveSkillId, qualifiedName, STAT_ID_TO_ABILITY } from '../lib/skill-map.mjs';
import { speciesSystem, speciesNotes, SPECIES_IMG } from './species.mjs';

export const PACK = 'alternity-templates';

const ABILITIES = ['STR', 'DEX', 'CON', 'INT', 'WIL', 'PER'];

/**
 * The character generator numbers its professions 0-6, splitting Diplomat into two
 * variants. Rather than guess at that list, the label is taken from the record's own
 * text and only the bracketed variant note is trimmed off.
 */
function professionName(hero) {
    const raw = str(hero.Profession?.['#text']);
    return raw.replace(/\s*\(.*\)\s*$/, '').trim();
}

function templateFiles() {
    const dir = path.join(SOURCE_ROOT, 'Templates');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(file => file.endsWith('.json')).sort();
}

export function convert() {
    const allSkills = loadSourceSkills();

    return templateFiles().map((file, index) => {
        const hero = readSource(`Templates/${file}`).Hero;
        const career = str(attr(hero, 'Career')) || path.basename(file, '.json');
        const setting = str(attr(hero, 'Setting'));
        const name = setting ? `${career} (${setting})` : career;

        const speciesName = str(hero.Species?.Name) || 'Human';
        const profession = professionName(hero);

        // Each template file repeats the whole Species record inline, so the template
        // gets a real `species` Item rather than only the name - which is the one thing
        // that makes the durability multiplier, the psionic multiplier and the ability
        // buy ranges readable once the actor is imported. All 54 are Human today; the
        // record is read rather than assumed so a non-human template would work.
        const speciesRecord = hero.Species ?? {};
        // Embedded documents are their own LevelDB rows, keyed by the sublevel and the
        // parent id joined to the child's - the same rule journal pages follow. Without
        // `_key` the batch write fails on an undefined key rather than dropping the item.
        // `makeActor` derives the same id from the same parts, so the two agree.
        const actorId = stableId(PACK, 'character', name);
        const speciesItemId = stableId(PACK, 'species', name);
        const speciesItem = {
            _id: speciesItemId,
            _key: `!actors.items!${actorId}.${speciesItemId}`,
            name: speciesName,
            type: 'species',
            img: SPECIES_IMG,
            system: speciesSystem(speciesRecord, allSkills, bookLabel(speciesRecord.Source, '')),
            effects: [],
            folder: null,
            sort: 0,
            ownership: { default: 0 },
            flags: {
                'alternity': {
                    provenance: {
                        book: bookLabel(speciesRecord.Source, ''),
                        sourceFile: path.posix.join('Templates', file),
                        sourceSpeciesId: int(attr(speciesRecord, 'ID'), 0),
                        specialNotes: speciesNotes(speciesRecord),
                    },
                },
            },
        };

        const abilityScores = Object.fromEntries(ABILITIES.map(ability => [
            ability, int(attr(hero.Abilities?.[ability] ?? {}, 'Score'), 10),
        ]));

        // Skills that this system's tree knows go in by slug; the rest - the source
        // data's Armor Operation specialties and its player-named placeholder rows -
        // become custom skills, so a template never silently loses part of its package.
        const skills = {};
        const customSkills = [];
        const packageLines = [];
        for (const entry of asArray(hero.Skills?.Skill)) {
            const sourceSkill = allSkills.get(int(attr(entry, 'ID'), -1));
            const rank = int(attr(entry, 'Level'), 0);
            const label = qualifiedName(sourceSkill, allSkills) || str(attr(entry, 'Name'));
            packageLines.push(rank > 1 ? `${label} ${rank}` : label);

            const slug = resolveSkillId(sourceSkill, allSkills);
            if (slug && SKILL_DEFINITIONS.some(definition => definition.id === slug)) {
                skills[slug] = { rank };
                continue;
            }
            customSkills.push({
                id: `src-${int(attr(entry, 'ID'), 0)}`,
                name: label,
                ability: str(entry.Ability) || STAT_ID_TO_ABILITY[Number(sourceSkill?.ability)] || 'INT',
                isSpecialty: !(sourceSkill?.isBroad ?? false),
                rank,
            });
        }

        // The profession and species benefits arrive as prose notes rather than as
        // anything mechanical, so they become special rules a GM can read and toggle.
        // `SpecialNotes` is the same list flattened to bare strings, so the two are
        // merged and deduplicated rather than rendered twice.
        const notes = [...new Set([
            ...asArray(hero.SpecialItems?.SpecialItem).map(entry => str(attr(entry, 'Note')) || str(entry.Note)),
            ...asArray(hero.SpecialNotes?.Note).map(note => str(note)),
        ].filter(Boolean))];
        const specialRules = notes.map((note, ruleIndex) => ({
            id: `${slugify(note).slice(0, 40)}-${ruleIndex}`,
            name: note.split(':')[0].trim() || `Special rule ${ruleIndex + 1}`,
            description: note,
            isEnabled: true,
        }));

        const lastResort = {
            value: int(hero.LastResorts?.Base, 0),
            max: int(hero.LastResorts?.Max, 0),
            cost: int(hero.LastResorts?.Cost, 0),
        };
        const actionsPerRound = Math.max(1, int(attr(hero.ActionCheck ?? {}, 'Actions'), 2));

        const movement = hero.Movement ?? {};
        const combatMovement = {
            sprint: int(attr(movement, 'Sprint'), 0),
            run: int(attr(movement, 'Run'), 0),
            walk: int(attr(movement, 'Walk'), 0),
            easySwim: int(attr(movement, 'EasySwim'), 0),
            swim: int(attr(movement, 'Swim'), 0),
            glide: int(attr(movement, 'Glide'), 0),
            fly: int(attr(movement, 'Fly'), 0),
        };

        const biography = [
            statBlock([
                ['Career', career],
                ['Profession', profession],
                ['Species', speciesName],
                ['Setting', setting],
                ['Skill points', int(attr(hero.Skills ?? {}, 'StartingPoints'), 0) || ''],
            ]),
            packageLines.length
                ? `<h2>Skill Package</h2><p>${escapeHtml(packageLines.join('; '))}</p>`
                : '',
            notes.length
                ? `<h2>Profession &amp; Species Benefits</h2><ul>${notes.map(note => `<li>${escapeHtml(note)}</li>`).join('')}</ul>`
                : '',
        ].filter(Boolean).join('');

        const actor = makeActor({
            pack: PACK,
            name,
            type: 'character',
            sort: index * 100,
            items: [speciesItem],
            system: {
                abilities: Object.fromEntries(
                    ABILITIES.map(ability => [ability.toLowerCase(), abilityScores[ability]]),
                ),
                lastResort,
                woundLevel: 'Healthy',
                // `details.career` still admits only the legacy Soldier/Explorer/Expert
                // list, which no Alternity career fits, so the real career is left to
                // the character state and the biography. See PLANS_FOR_COMPENDIUM.md.
                details: {
                    species: speciesName,
                    level: Math.max(1, int(attr(hero.Advancement ?? {}, 'Level'), 1)),
                },
                actionsPerRound,
                combatMovement,
                achievementTrack: {
                    level: Math.max(1, int(attr(hero.Advancement ?? {}, 'Level'), 1)),
                    pointsSpent: int(attr(hero.Advancement ?? {}, 'Used'), 0),
                    pointsStored: int(attr(hero.Advancement ?? {}, 'Available'), 0),
                },
                biography,
            },
        });

        const state = new AlternityCharacterState({
            actorId: actor._id,
            species: speciesName,
            abilityScores,
            skills,
            customSkills,
            specialRules,
            lastResort,
            profession,
            career,
            actionsPerRound,
            woundLevel: 'Healthy',
        });

        // Same call the `createItem` hook makes when a species is dropped on a hero, so
        // the state a template ships with is the state it would have had if a Gamemaster
        // had dragged the species on themselves.
        state.applySpecies(speciesName, speciesItem.system);

        actor.flags['alternity'] = {
            characterState: state.serialize(),
            provenance: {
                book: setting || 'Core',
                sourceFile: path.posix.join('Templates', file),
                career,
                profession,
                species: speciesName,
                folder: profession || 'Unassigned',
                skillPoints: int(attr(hero.Skills ?? {}, 'StartingPoints'), 0),
            },
        };

        // The durability maxes are derived by the state (CON, through the species'
        // multiplier); mirror them onto `system` the way `_syncSystemFromState` does,
        // so token bars are right before the sheet is ever opened.
        actor.system.durability = {
            stun: { value: 0, max: state.durability.stunMax },
            wound: { value: 0, max: state.durability.woundMax },
            mortal: { value: 0, max: state.durability.mortalMax },
            fatigue: { value: 0, max: state.durability.fatigueMax },
        };
        actor.system.psionics = {
            energy: { value: state.psionics.energy.value, max: state.psionics.energy.max },
            powers: [],
        };

        return actor;
    });
}
