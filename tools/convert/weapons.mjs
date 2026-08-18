/**
 * @file tools/convert/weapons.mjs
 * @description `AttackForm` records -> `weapon` Items.
 *
 * The weapon table's columns map onto `WeaponData` almost one for one, because that
 * schema was written from the same table (see its file header): Type is damage form
 * plus firepower, Damage is the Ordinary/Good/Amazing run, Acc is a situation-die step
 * modifier, and Range is the three bands of Table P22.
 *
 * The columns with no home in the schema - progress level, cost, availability,
 * concealment, firing modes, actions to ready, clip size and cost - are kept on the
 * item's `provenance` flag and rendered into the description, so nothing printed is
 * lost while those fields have no schema field to live in.
 */

import { makeItem, statBlock } from '../lib/fvtt.mjs';
import {
    readRecordsAcross, attr, num, int, bool, str, bookLabel, availabilityLabel, disambiguateNames,
} from '../lib/source-data.mjs';
import { loadSourceSkills, resolveSkillId, qualifiedName, rangeClassForSkill } from '../lib/skill-map.mjs';

export const PACK = 'alternity-weapons';

/** The letter after the slash in the Type column ('HI/O') is the firepower tier. */
const FIREPOWER = { M: 'Marginal', O: 'Ordinary', G: 'Good', A: 'Amazing' };

/** Damage forms, as the source data spells them, mapped onto `DAMAGE_TYPES`. */
const DAMAGE_FORMS = { li: 'LI', hi: 'HI', en: 'En' };

/** The letter a damage code ends in names the track the damage lands on. */
const DAMAGE_TRACKS = { s: 'stun', w: 'wound', m: 'mortal' };

/** Firing modes, from the Mode column's letters. */
const FIRING_MODES = { F: 'Full', B: 'Burst', A: 'Autofire', G: 'Semi-automatic' };

/**
 * Split the Type column into its two axes.
 * @returns {{damageType: string, firepower: string}}
 */
function parseTypeColumn(raw) {
    const [form = '', tier = ''] = String(raw ?? '').split('/');
    return {
        damageType: DAMAGE_FORMS[form.trim().toLowerCase()] ?? 'LI',
        firepower: FIREPOWER[tier.trim().toUpperCase()] ?? 'Ordinary',
    };
}

/**
 * Split the Damage column into its three grades.
 *
 * Ten weapons print 'As Load' or 'Special' instead of a run - grenade and rocket
 * launchers, whose damage comes from the round, and a handful of effect weapons. They
 * get no damage codes at all rather than a guessed one, so `selectDamageGrade` cannot
 * roll damage the book does not define; the printed word is kept in the description.
 */
function parseDamageRun(raw) {
    const parts = String(raw ?? '').split('/').map(part => part.trim()).filter(Boolean);
    if (parts.length !== 3) return { ordinary: '', good: '', amazing: '', note: str(raw) };
    return { ordinary: parts[0], good: parts[1], amazing: parts[2], note: '' };
}

/** The track the Ordinary grade lands on, read off its trailing letter. */
function parseDamageCategory(code) {
    const letter = String(code ?? '').trim().slice(-1).toLowerCase();
    return DAMAGE_TRACKS[letter] ?? 'wound';
}

/**
 * Split the Range column into the three bands.
 * Melee and thrown weapons print 'Personal' or 'Per STR' rather than distances.
 */
function parseRange(raw) {
    const parts = String(raw ?? '').split('/').map(part => int(part, 0));
    if (parts.length !== 3) return { short: 0, medium: 0, long: 0 };
    return { short: parts[0], medium: parts[1], long: parts[2] };
}

/** Expand the Mode column's letters into readable firing modes. */
function parseModes(raw) {
    return String(raw ?? '').trim().split('').map(letter => FIRING_MODES[letter]).filter(Boolean).join(', ');
}

/**
 * Which `weaponType` a record belongs to.
 *
 * Read off the record's own flags rather than off its `@Type` code, because the code
 * conflates thrown weapons with the class they were thrown from: grenades are `@Type=2`
 * (heavy) with `@Throw=True`, and a thrown knife is `@Type=0` (melee) with the same flag.
 */
function weaponType(record) {
    if (bool(attr(record, 'Throw'))) return 'Thrown';
    if (bool(attr(record, 'Melee'))) return 'Melee';
    return String(attr(record, 'Type')) === '2' ? 'Heavy' : 'Ranged';
}

export function convert() {
    const skills = loadSourceSkills();
    const records = readRecordsAcross('data', 'weapon_', ['AttackForms', 'AttackForm']);

    const entries = records.map(record => ({
        name: str(attr(record, 'Name')) || str(record.Name) || 'Unnamed Weapon',
        book: bookLabel(attr(record, 'Source'), record._sourceFile),
        record,
    }));
    disambiguateNames(entries);

    return entries.map(({ name, book, record }) => {
        const skill = skills.get(Number(attr(record, 'SkillID')));
        const requiredSkill = resolveSkillId(skill, skills);
        const type = weaponType(record);
        const isMelee = type === 'Melee' || type === 'Thrown';

        const { damageType, firepower } = parseTypeColumn(attr(record, 'DamageType') ?? record.Type);
        const damage = parseDamageRun(record.Damage);
        const range = parseRange(attr(record, 'Range') ?? record.Range);
        const modes = parseModes(attr(record, 'Mode'));
        const availability = availabilityLabel(attr(record, 'Availability'));
        const concealment = int(attr(record, 'Hide'), 0);

        const provenance = {
            book,
            sourceFile: record._sourceFile,
            progressLevel: int(attr(record, 'PL'), 0),
            cost: int(attr(record, 'Cost'), 0),
            availability,
            mass: num(attr(record, 'Mass'), 0),
            // -1000 is the source data's "cannot be concealed" sentinel.
            concealment: concealment <= -1000 ? null : concealment,
            firingModes: modes,
            actionsToReady: int(attr(record, 'Actions'), 0),
            clipSize: int(attr(record, 'ClipSize'), 0),
            clipCost: int(attr(record, 'ClipCost'), 0),
            skillId: int(attr(record, 'SkillID'), -1),
            skillName: qualifiedName(skill, skills),
            printedDamage: str(record.Damage),
            printedRange: str(attr(record, 'Range') ?? record.Range),
        };

        const description = statBlock([
            ['Skill', provenance.skillName],
            ['Damage', provenance.printedDamage],
            ['Type', `${damageType}/${firepower.charAt(0)}`],
            ['Accuracy', int(attr(record, 'Accuracy'), 0)],
            ['Range', provenance.printedRange],
            ['Firing modes', modes],
            ['Actions to ready', provenance.actionsToReady || ''],
            ['Clip', provenance.clipSize ? `${provenance.clipSize} rounds` : ''],
            ['Clip cost', provenance.clipCost ? `${provenance.clipCost} cr` : ''],
            ['Mass', provenance.mass ? `${provenance.mass} kg` : ''],
            ['Concealment', provenance.concealment ?? 'Cannot be concealed'],
            ['Progress level', provenance.progressLevel || ''],
            ['Cost', provenance.cost ? `${provenance.cost} cr` : ''],
            ['Availability', availability],
            ['Source', book],
        ]);

        return makeItem({
            pack: PACK,
            name,
            type: 'weapon',
            img: isMelee ? 'icons/svg/sword.svg' : 'icons/svg/target.svg',
            provenance,
            system: {
                weaponType: type,
                damageType,
                damageCategory: parseDamageCategory(damage.ordinary),
                firepower,
                damageOrdinary: damage.ordinary,
                damageGood: damage.good,
                damageAmazing: damage.amazing,
                damageBonus: 0,
                // Alternity accuracy and this codebase's modifiers share a sign
                // convention - positive is a penalty - so the printed value carries
                // across unflipped.
                attackBonus: int(attr(record, 'Accuracy'), 0),
                attackAbility: isMelee || bool(attr(record, 'STRBased')) ? 'str' : 'dex',
                requiredSkill,
                rangeClass: isMelee ? 'Melee' : rangeClassForSkill(requiredSkill),
                range,
                techPointCost: 0,
                isEquipped: false,
                quantity: 1,
                weight: num(attr(record, 'Mass'), 0),
                description,
            },
        });
    });
}
