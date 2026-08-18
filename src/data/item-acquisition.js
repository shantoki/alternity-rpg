/**
 * @file item-acquisition.js
 * @description The columns every Alternity gear table prints, shared by the item schemas.
 *
 * Progress Level, Cost and Availability appear on the weapon, armour, equipment,
 * computer and cybertech tables alike, and they are what a Gamemaster consults to decide
 * whether a hero can find a thing, afford it, and be allowed to carry it. They are
 * declared once here rather than five times, because five copies is how the availability
 * list ends up meaning one thing on a rifle and another on a program.
 *
 * These are catalogue facts, not mechanics - nothing in `AlternityMathService` reads
 * them. They exist so the compendium can carry what the books print.
 */

/**
 * Availability classes, as the tables abbreviate them: Com, Con, Mil, Res.
 *
 * Matches `ProgramData`'s list exactly, and the character generator's numeric codes
 * decode onto it (1 Com, 2 Con, 3 Mil, 4 Res, anything else Any) - see
 * `walter_weapons.xsl`, which is where those numbers were confirmed.
 */
export const AVAILABILITY_CLASSES = Object.freeze([
    'Any', 'Common', 'Controlled', 'Military', 'Restricted',
]);

/**
 * Progress Level, the tech era a thing belongs to (PHB Ch.7).
 *
 * 0 is the "unspecified" the gear tables print for anything that is not tech - most of
 * the clothing and survival entries - rather than a claim about the Stone Age, which is
 * PL G in the book's own numbering.
 */
export function progressLevelField(initial = 0) {
    return new foundry.data.fields.NumberField({
        required: true, nullable: false, integer: true, initial, min: 0, max: 9,
    });
}

/** Purchase price in credits. */
export function costField() {
    return new foundry.data.fields.NumberField({
        required: true, nullable: false, integer: true, initial: 0, min: 0,
    });
}

/** How hard the thing is to come by legally. */
export function availabilityField() {
    return new foundry.data.fields.StringField({
        required: true, nullable: false, initial: 'Any', choices: [...AVAILABILITY_CLASSES],
    });
}

/**
 * The Hide column: a step modifier on checks to spot the thing on its owner.
 *
 * Nullable because the tables print a dash for what cannot be concealed at all - a
 * suit of powered armour is not "concealment 0", it is unconcealable, and the two would
 * otherwise be the same number. The character generator writes -1000 for that case.
 */
export function concealmentField() {
    return new foundry.data.fields.NumberField({
        required: true, nullable: true, integer: true, initial: 0,
    });
}
