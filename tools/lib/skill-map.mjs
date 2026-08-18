/**
 * @file tools/lib/skill-map.mjs
 * @description Resolve the source data's numeric skill ids onto this system's skill tree.
 *
 * The character-generator data addresses skills by integer id (`@SkillID="31"`), and
 * `AlternityCharacterState` addresses them by slug (`dex-pistol`). Both lists describe
 * the same PHB skill tree, so the bridge is built by matching names rather than by
 * hand-maintaining 193 pairs - with an alias table for the ~30 entries where the two
 * lists abbreviate differently ('Law Enforcement' vs 'Law enforc.').
 *
 * A skill that resolves to no slug is not an error: the generator data carries skills
 * this system's tree does not model (Armor Operation's Combat/Powered specialties) and
 * placeholder rows for player-named specialties ('Knowledge / (specific)'). Those items
 * are still converted; they just carry a blank `skillId`.
 */

import { SKILL_DEFINITIONS } from '../../src/data/alternity-actor-data.js';
import { readSource, listSource, asArray, attr, str } from './source-data.mjs';

/** `@StatID` in the source data, in the order the six abilities are numbered. */
export const STAT_ID_TO_ABILITY = { 1: 'STR', 2: 'DEX', 3: 'CON', 4: 'INT', 5: 'WIL', 6: 'PER' };

/**
 * Source-data skill name -> `SKILL_DEFINITIONS` slug, for the names the two lists spell
 * differently. Keyed by "<broad skill> / <specialty>" where the specialty name alone is
 * ambiguous (four books' worth of skills contain a 'Power' and a 'Space').
 */
const ALIASES = {
    'Melee Weapons / Powered weapon': 'str-powered-melee',
    'Unarmed Attack / Power Martial Arts': 'str-power',
    'Modern Ranged Weapons': 'dex-ranged-mod',
    'Primitive Ranged Weapons': 'dex-ranged-prim',
    'Vehicle Operation / Air Vehicle': 'dex-air',
    'Vehicle Operation / Land Vehicle': 'dex-land',
    'Vehicle Operation / Space Vehicle': 'dex-space',
    'Vehicle Operation / Water Vehicle': 'dex-water',
    'Survival / Survival Training': 'con-survival-train',
    'Knowledge / Computer Operation': 'int-computer-op',
    'Knowledge / (specific language)': 'int-language',
    'Law / Court Procedures': 'int-court-proc',
    'Law / Law Enforcement': 'int-law-enforc',
    'Medical Science / Medical Knowledge': 'int-medical-know',
    'Navigation / Drivespace Astrogation': 'int-drivespace',
    'Navigation / System Astrogation': 'int-system-nav',
    'Security / Protection Protocols': 'int-protection',
    'Security / Security Devices': 'int-sec-devices',
    'Technical Science / Technical Knowledge': 'int-technical-know',
    'Resolve / Mental Resolve': 'wil-mental',
    'Resolve / Physical Resolve': 'wil-physical',
    'Street Smart / Criminal Elements': 'wil-criminal-elem',
    'Street Smart / Street Knowledge': 'wil-street-know',
    'Culture / Etiquette (specific)': 'per-etiquette',
    'Entertainment / Musical Instrument': 'per-musical-inst',
};

const normalise = text => String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** `SKILL_DEFINITIONS` indexed by normalised name and by normalised "<parent> <name>". */
const DEFINITIONS_BY_NAME = (() => {
    const index = new Map();
    for (const definition of SKILL_DEFINITIONS) {
        const parent = definition.parent
            ? SKILL_DEFINITIONS.find(candidate => candidate.id === definition.parent)
            : null;
        // Qualified key first, so a bare 'Space' (Tactics) cannot claim 'Vehicle
        // Operation / Space' just by being registered earlier.
        index.set(normalise(`${parent ? `${parent.name} ` : ''}${definition.name}`), definition);
        if (!index.has(normalise(definition.name))) index.set(normalise(definition.name), definition);
    }
    return index;
})();

/**
 * Load every skill record in the source data, keyed by its numeric id.
 *
 * Ordinary, psionic and FX skills all use the same `Skills/Skill` shape and share one id
 * space (mundane skills below 500, psionic from 500, FX above), so they are read into a
 * single index - a weapon's `@SkillID` is resolved against all of them.
 *
 * @returns {Map<number, object>} id -> `{ id, name, ability, isBroad, broadId, source, ... }`
 */
export function loadSourceSkills() {
    const files = [
        ...listSource('data', 'skills_'),
        ...listSource('data', 'psiskills_'),
        ...listSource('data', 'fxskills_'),
    ];

    const byId = new Map();
    for (const file of files) {
        const block = readSource(file).Skills;
        if (!block) continue;
        for (const record of asArray(block.Skill)) {
            const id = Number(attr(record, 'ID'));
            if (!Number.isFinite(id)) continue;
            // Later books re-state core skills; the first definition wins so that a
            // supplement cannot silently redefine a core skill's ability or cost.
            if (byId.has(id)) continue;
            byId.set(id, {
                id,
                name: str(attr(record, 'Name')),
                ability: STAT_ID_TO_ABILITY[Number(attr(record, 'StatID'))] ?? 'INT',
                isBroad: String(attr(record, 'Type')) === '0',
                broadId: Number(attr(record, 'BroadID')),
                basePrice: Number(attr(record, 'BasePrice')) || 0,
                untrained: String(attr(record, 'Untrained')).toLowerCase() === 'true',
                professions: str(attr(record, 'Professions')),
                energy: str(attr(record, 'Energy')),
                psiType: String(block['@PsiType'] ?? '0'),
                listName: str(block['@Name']),
                source: str(attr(record, 'Source')),
                file,
            });
        }
    }
    return byId;
}

/** The "<broad skill> / <specialty>" label a source skill is known by. */
export function qualifiedName(skill, allSkills) {
    if (!skill) return '';
    if (skill.isBroad) return skill.name;
    const parent = allSkills.get(skill.broadId);
    return parent && parent.id !== skill.id ? `${parent.name} / ${skill.name}` : skill.name;
}

/**
 * Resolve one source skill onto a `SKILL_DEFINITIONS` slug.
 * @returns {string} The slug, or '' when this system's tree has no entry for it.
 */
export function resolveSkillId(skill, allSkills) {
    if (!skill) return '';
    const qualified = qualifiedName(skill, allSkills);
    if (ALIASES[qualified]) return ALIASES[qualified];
    if (ALIASES[skill.name]) return ALIASES[skill.name];

    const parent = skill.isBroad ? null : allSkills.get(skill.broadId);
    const candidates = [
        normalise(`${parent ? `${parent.name} ` : ''}${skill.name}`),
        normalise(skill.name),
    ];
    for (const candidate of candidates) {
        const hit = DEFINITIONS_BY_NAME.get(candidate);
        if (hit) return hit.id;
    }
    return '';
}

/**
 * Which row of Table P22 a weapon governed by this skill reads for its range bands.
 *
 * `RANGE_STEP_MODIFIERS` has one row per weapon class rather than per skill, so heavy
 * weapons and thrown weapons - which have no row of their own - borrow the closest fit:
 * a direct-fire heavy weapon behaves like a rifle, everything hand-thrown like a
 * primitive ranged weapon.
 */
export function rangeClassForSkill(skillId) {
    switch (skillId) {
        case 'dex-pistol': return 'Pistol';
        case 'dex-rifle': return 'Rifle';
        case 'dex-smg': return 'SMG';
        case 'dex-bow':
        case 'dex-crossbow':
        case 'dex-flintlock':
        case 'dex-sling':
        case 'str-throw': return 'Primitive';
        case 'str-direct-fire':
        case 'str-indirect-fire': return 'Rifle';
        default: return 'Melee';
    }
}
