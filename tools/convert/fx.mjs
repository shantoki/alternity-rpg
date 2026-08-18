/**
 * @file tools/convert/fx.mjs
 * @description Psionic and FX `Skill` records -> `fx` Items.
 *
 * The two families share the `Skills/Skill` shape and are told apart by the list's
 * `@PsiType`: 1 is psionics (Mindwalking), 2 is the Beyond Science FX system from Dark
 * Matter. Within FX, `@FXSource` names the tradition - 0 Arcane Magic, 1 Faith,
 * 2 Super Power - which is confirmed by what the broad skills under each value are:
 * Hemomancy/Illusion/Necromancy/Pyromancy under 0, Alienism/Druidism/Taoism/Monotheism/
 * Voodoo under 1, Brick/Chi/Energy/Metaconscious under 2.
 *
 * `FXData.broadSkill` only admits the eight canonical broad skills, so an FX skill's
 * real broad skill (Necromancy, Voodoo) goes to the free-text `category` field and
 * `broadSkill` carries the tradition. Psionic skills fill `broadSkill` properly.
 *
 * Everything the schema models but the source data does not carry - range, duration,
 * area, resistance, per-degree outcomes, rank benefits - is left at its default. Those
 * are printed as prose in Mindwalking and Dark Matter and belong to the prose pass.
 */

import { makeItem, statBlock } from '../lib/fvtt.mjs';
import { readSource, listSource, asArray, attr, int, str, bookLabel, disambiguateNames } from '../lib/source-data.mjs';
import { loadSourceSkills, STAT_ID_TO_ABILITY } from '../lib/skill-map.mjs';

export const PACK = 'alternity-fx';

/** `@FXSource` -> the tradition it names. */
const FX_TRADITIONS = { 0: 'Arcane Magic', 1: 'Faith', 2: 'Super Power' };

/**
 * Psionic broad skill names as the source data spells them, mapped onto the schema's
 * list. Only ESP differs - the data abbreviates what `FX_BROAD_SKILLS` spells out.
 */
const PSIONIC_BROAD_SKILLS = {
    Biokinesis: 'Biokinesis',
    ESP: 'Extrasensory Perception',
    Psychoportation: 'Psychoportation',
    Telekinesis: 'Telekinesis',
    Telepathy: 'Telepathy',
};

export function convert() {
    const allSkills = loadSourceSkills();

    const records = [...listSource('data', 'psiskills_'), ...listSource('data', 'fxskills_')]
        .flatMap(file => {
            const block = readSource(file).Skills;
            return asArray(block?.Skill).map(record => ({
                ...record,
                _sourceFile: file,
                _psiType: String(block['@PsiType'] ?? '1'),
                _listName: str(block['@Name']),
            }));
        });

    const entries = records.map(record => ({
        name: str(attr(record, 'Name')) || 'Unnamed Power',
        book: bookLabel(attr(record, 'Source'), record._sourceFile),
        record,
    }));
    disambiguateNames(entries);

    return entries.map(({ name, book, record }) => {
        const isPsionic = record._psiType === '1';
        const isBroad = String(attr(record, 'Type')) === '0';
        const parent = isBroad ? null : allSkills.get(Number(attr(record, 'BroadID')));
        const parentName = isBroad ? str(attr(record, 'Name')) : (parent?.name ?? '');
        const tradition = isPsionic
            ? 'Psionic'
            : (FX_TRADITIONS[Number(attr(record, 'FXSource'))] ?? 'Arcane Magic');

        // The FX lists file every broad skill under STR, which is a placeholder rather
        // than a reading - their specialties carry real abilities (mostly WIL). Only
        // the broad rows are corrected, so a genuinely STR-based specialty survives.
        const statId = Number(attr(record, 'StatID'));
        const linkedAbility = (!isPsionic && isBroad && statId === 1)
            ? 'WIL'
            : (STAT_ID_TO_ABILITY[statId] ?? 'WIL');

        const energy = str(attr(record, 'Energy'));
        const basePrice = int(attr(record, 'BasePrice'), 0);

        const provenance = {
            book,
            sourceFile: record._sourceFile,
            sourceSkillId: Number(attr(record, 'ID')),
            list: record._listName,
            tradition,
            broadSkill: parentName,
            isBroad,
            basePrice,
            energy,
        };

        const description = statBlock([
            ['Tradition', tradition],
            ['Broad skill', parentName],
            ['Skill type', isBroad ? 'Broad skill' : 'Specialty skill'],
            ['Ability', linkedAbility],
            ['Cost', basePrice ? `${basePrice} skill points` : ''],
            ['Energy', energy],
            ['Untrained', String(attr(record, 'Untrained')).toLowerCase() === 'true'
                ? 'Can be used untrained' : 'Cannot be used untrained'],
            ['Source', book],
        ]);

        return makeItem({
            pack: PACK,
            name,
            type: 'fx',
            img: 'icons/svg/aura.svg',
            provenance,
            system: {
                tradition,
                broadSkill: isPsionic
                    ? (PSIONIC_BROAD_SKILLS[parentName] ?? 'Telepathy')
                    : tradition,
                // The FX traditions' real broad skills (Necromancy, Voodoo, Chi) have
                // no place in the schema's fixed list, so they are kept here.
                category: isPsionic ? '' : parentName,
                linkedAbility,
                isBroadSkill: isBroad,
                cannotBeUsedUntrained: String(attr(record, 'Untrained')).toLowerCase() !== 'true',
                rank: 0,
                baseCost: Math.min(15, Math.max(0, basePrice)),
                // Only a bare number is a usable energy cost; 'A,1' and '1,2,3' are
                // notation the books explain, so they stay in the description.
                energyCostOverride: /^\d+$/.test(energy) ? Number(energy) : 0,
                maintenanceCost: '',
                hasExtendedDuration: false,
                requiresVisualRange: false,
                range: { short: 0, medium: 0, long: 0 },
                area: '',
                target: '',
                duration: '',
                resistance: 'None',
                damage: { ordinary: '', good: '', amazing: '' },
                damageType: 'None',
                outcomes: { ordinary: '', good: '', amazing: '' },
                criticalFailure: '',
                mentalCombatClass: 'None',
                rankBenefits: [],
                trappings: {},
                limitations: '',
                description,
            },
        });
    });
}
