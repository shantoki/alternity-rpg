/**
 * @file alternity-statblock-drops.js
 * @description Turns an Item dropped on a statblock sheet into a schema row.
 *
 * ## Why these sheets can't just embed the item
 *
 * The hero sheet keeps its gear as embedded Items, so a drop there is a copy
 * (`alternity-drag-drop.js`). The statblock sheets don't: an NPC's attacks live in
 * `system.attacks`, a robot's hardware in `system.systems`, an AI's guns in
 * `system.physicalForm`, and a ship's guns in `system.weapons` — all
 * `ArrayField`s. Embedding an Item on one of those actors would create a document
 * that no template renders, so a drop has to be *translated* into a row instead.
 *
 * ## What the translation can and cannot carry
 *
 * A weapon Item knows its damage run, its damage form and its governing skill. It
 * cannot know the **score** the statblock rolls the attack at — that is the NPC's
 * own skill score, not a property of the gun — so `score` is left at 0 for the
 * Gamemaster to fill in, and the governing skill is written into the row's notes
 * so they know what to score it from. Nothing is guessed at: a field with no
 * honest source keeps the same default the sheet's own "+ Add row" button uses.
 *
 * Each row is built as `{...rowDefaults[array], ...mapped}`, where `rowDefaults`
 * is the sheet's own `*_ARRAY_FIELDS` entry. That is deliberate — it guarantees a
 * dropped row and an added row have exactly the same shape, which is what keeps
 * `ArrayField` validation happy.
 *
 * ## One write per array
 *
 * `ArrayField` **replaces** rather than merges, so an array has to be written
 * whole. Rows are grouped by target array and each array is written once, or a
 * two-weapon drop would discard the first weapon.
 */

import { AlternityMathService } from '../services/alternity-math.js';
import { SKILL_DEFINITIONS } from '../data/alternity-actor-data.js';
import { bindActorSheetDragDrop } from './alternity-drag-drop.js';
import { game, ui } from '../module-info.js';

/** LI/HI/En (personal scale) → the ship schemas' spelled-out equivalents. */
const SHIP_DAMAGE_FORMS = Object.freeze({ LI: 'lowImpact', HI: 'highImpact', En: 'energy' });

/** The damage forms a personal-scale statblock row accepts. */
const PERSONAL_DAMAGE_FORMS = Object.freeze(['LI', 'HI', 'En']);

/** Firepower tiers shared by `WeaponData` and the spaceship weapon row. */
const FIREPOWER_CLASSES = Object.freeze(['Marginal', 'Ordinary', 'Good', 'Amazing']);

/** Program/avatar quality tiers, shared by `ProgramData` and the AI's grid programs. */
const QUALITY_TIERS = Object.freeze(['Marginal', 'Ordinary', 'Good', 'Amazing']);

/** Signed, for a step modifier printed into a notes field. */
function signed(value) {
    const n = Number(value) || 0;
    return n > 0 ? `+${n}` : `${n}`;
}

/** A skill id from `SKILL_DEFINITIONS` rendered as the name a Gamemaster reads. */
function skillLabel(skillId) {
    if (!skillId) return '';
    return SKILL_DEFINITIONS.find(def => def.id === skillId)?.name ?? skillId;
}

/** The three damage columns as one printed run: "d4+1s / d6+2w / d6+3w". */
function damageRunLabel(system) {
    return [system?.damageOrdinary, system?.damageGood, system?.damageAmazing]
        .filter(Boolean).join(' / ');
}

/**
 * The weapon's range bands as the statblocks print them. All three are emitted
 * together once any is set — dropping the empty bands would turn "5/0/20" into a
 * misleading "5/20".
 */
function rangeText(system) {
    const { short = 0, medium = 0, long = 0 } = system?.range ?? {};
    return (short || medium || long) ? `${short}/${medium}/${long}` : '';
}

/**
 * What the Gamemaster needs in order to fill in the score this row is rolled at,
 * plus the accuracy modifier, which no statblock row has a field for.
 */
function attackNotes(system) {
    const parts = [];
    const skill = skillLabel(system?.requiredSkill);
    if (skill) parts.push(`Skill: ${skill}`);
    if (system?.attackBonus) parts.push(`Acc ${signed(system.attackBonus)}`);
    return parts.join(' · ');
}

/** Constrain a value to a vocabulary, falling back to the row default. */
function oneOf(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
}

// ---------------------------------------------------------------------------
// Row builders
// ---------------------------------------------------------------------------

/**
 * The fields an NPC and a creature attack row share. `score` is deliberately
 * absent: it belongs to the creature, not to the weapon, so it keeps the row
 * default of 0.
 */
function attackCore(item) {
    const system = item.system ?? {};
    return {
        name:           item.name,
        damageOrdinary: system.damageOrdinary ?? '',
        damageGood:     system.damageGood ?? '',
        damageAmazing:  system.damageAmazing ?? '',
        damageType:     oneOf(system.damageType, PERSONAL_DAMAGE_FORMS, 'LI'),
        notes:          attackNotes(system),
    };
}

function buildNpcAttackRow(item) {
    return { ...attackCore(item), range: rangeText(item.system) };
}

function buildCreatureAttackRow(item) {
    // `mode` is the second half of the printed type code — the `O` in `LI/O`. A
    // manufactured weapon in a creature's hands is still rolled the same way, so
    // the row default stands rather than being invented from the weapon.
    return attackCore(item);
}

/** A creature's skills are absolute scores it cannot improve, so no rank maps. */
function buildCreatureSkillRow(item) {
    return {
        name:        item.name,
        isSpecialty: isSpecialtySkill(item),
    };
}

/**
 * A robot mounts its guns as hardware, under the chassis category the rules price
 * them in. The damage run has nowhere to live on a systems row, so it goes into
 * the notes rather than being dropped.
 */
function buildRobotWeaponRow(item) {
    const system = item.system ?? {};
    const run = damageRunLabel(system);
    const notes = [
        run ? `${run} ${oneOf(system.damageType, PERSONAL_DAMAGE_FORMS, 'LI')}` : '',
        attackNotes(system),
    ].filter(Boolean).join(' · ');
    return { name: item.name, category: 'Weapon Support', notes };
}

function buildPerkFlawRow(item) {
    const system = item.system ?? {};
    const kind = system.category === 'Flaw' ? 'Flaw' : 'Perk';
    const cost = Number(system.cost) || 0;
    return {
        name: item.name,
        kind,
        // Signed against the skill point pool: a perk spends, a flaw grants. The
        // item stores an unsigned cost, so the sign comes from the kind.
        skillPointChange: kind === 'Flaw' ? -Math.abs(cost) : Math.abs(cost),
        notes: '',
    };
}

/** True when this skill item names a specialty rather than a broad skill. */
function isSpecialtySkill(item) {
    const system = item.system ?? {};
    const definition = SKILL_DEFINITIONS.find(def => def.id === system.skillId);
    if (definition) return Boolean(definition.isSpecialty);
    // No matching definition (a home-brewed skill item): a named specialisation is
    // the only other evidence there is.
    return Boolean(system.specialisation);
}

/**
 * Robots and AIs hold skills in memory, in identical row shapes. A dropped skill
 * is assumed fully loaded — a partial load is a decision about this robot's
 * memory budget, not a property of the skill.
 */
function buildMemorySkillRow(item) {
    const system = item.system ?? {};
    const rank = Math.max(0, Number(system.rank) || 0);
    return {
        name:        item.name,
        isBroad:     !isSpecialtySkill(item),
        rank,
        ranksLoaded: rank,
        isLoaded:    true,
        ability:     system.linkedAbility ?? '',
    };
}

/** An AI's gun is part of its physical form, alongside its CPU armour. */
function buildAiWeaponRow(item) {
    const system = item.system ?? {};
    return {
        name:  item.name,
        kind:  'Weapon',
        skill: skillLabel(system.requiredSkill),
        value: damageRunLabel(system),
    };
}

function buildAiArmorRow(item) {
    const system = item.system ?? {};
    // Both are flat numbers and the row's `value` is free text; resistance is the
    // more specific of the two, so it wins when it is set.
    const value = Number(system.damageResistance) || Number(system.armorBonus) || 0;
    return { name: item.name, kind: 'CPU Armor', skill: '', value: `${value}` };
}

function buildGridProgramRow(item) {
    const system = item.system ?? {};
    const damage = system.damage ?? {};
    return {
        name:     item.name,
        quality:  oneOf(system.quality, QUALITY_TIERS, 'Ordinary'),
        slots:    Math.max(0, Number(system.slots) || 0),
        effect:   [damage.ordinary, damage.good, damage.amazing].filter(Boolean).join(' / '),
        isLoaded: system.isLoaded !== false,
    };
}

function buildSpaceshipWeaponRow(item) {
    const system = item.system ?? {};
    return {
        name:           item.name,
        range:          rangeText(system),
        damageOrdinary: system.damageOrdinary ?? '',
        damageGood:     system.damageGood ?? '',
        damageAmazing:  system.damageAmazing ?? '',
        damageType:     SHIP_DAMAGE_FORMS[system.damageType] ?? 'lowImpact',
        firepower:      oneOf(system.firepower, FIREPOWER_CLASSES, 'Amazing'),
        notes:          attackNotes(system),
    };
}

/**
 * A warship weapon row carries a single formula and a track rather than a
 * three-grade run, so the Ordinary code is split through the math service — the
 * trailing s/w/m is notation, and handing the raw code to a formula field would
 * store something unrollable.
 *
 * `firepowerClass` is left at the row default on purpose: on a warship that field
 * is a hull-size class (SmallCraft…SuperHeavy), which is a different axis from a
 * weapon's Marginal…Amazing firepower and cannot be derived from it.
 */
function buildWarshipWeaponRow(item) {
    const system = item.system ?? {};
    const parsed = AlternityMathService.parseDamageCode(system.damageOrdinary, {
        fallbackCategory: system.damageCategory,
    });
    const row = {
        name:       item.name,
        damageType: SHIP_DAMAGE_FORMS[system.damageType] ?? 'lowImpact',
        damageGrade: parsed.category,
    };
    // An empty or unrollable code leaves the field's own default alone rather than
    // writing '' into a formula the sheet will try to roll.
    if (parsed.isValid) row.damageFormula = parsed.formula;
    return row;
}

// ---------------------------------------------------------------------------
// The map
// ---------------------------------------------------------------------------

/**
 * Which array each item type lands in, per actor type, and how the row is built.
 *
 * An actor type absent from this map (`vehicle`) accepts nothing: `VehicleData`
 * holds no arrays at all, because a vehicle is driven by a character's own Vehicle
 * Operation check and has no attacks or gear of its own. An item type absent from
 * an actor's entry is refused out loud rather than silently swallowed.
 */
export const STATBLOCK_DROP_TARGETS = Object.freeze({
    npc: {
        weapon: { array: 'attacks', build: buildNpcAttackRow },
    },
    creature: {
        weapon: { array: 'attacks', build: buildCreatureAttackRow },
        skill:  { array: 'skills',  build: buildCreatureSkillRow },
    },
    robot: {
        weapon:   { array: 'systems',    build: buildRobotWeaponRow },
        perkFlaw: { array: 'perksFlaws', build: buildPerkFlawRow },
        skill:    { array: 'skills',     build: buildMemorySkillRow },
    },
    ai: {
        weapon:  { array: 'physicalForm', build: buildAiWeaponRow },
        armor:   { array: 'physicalForm', build: buildAiArmorRow },
        program: { array: 'gridPrograms', build: buildGridProgramRow },
        skill:   { array: 'skills',       build: buildMemorySkillRow },
    },
    spaceship: {
        weapon: { array: 'weapons', build: buildSpaceshipWeaponRow },
    },
    warship: {
        weapon: { array: 'weapons', build: buildWarshipWeaponRow },
    },
});

/**
 * Work out the single `actor.update` a drop turns into.
 *
 * @param {Actor} actor
 * @param {Item[]} items
 * @param {Record<string, object>} rowDefaults - The sheet's own `*_ARRAY_FIELDS`.
 * @returns {{update: object|null, added: Array<{name: string, array: string}>, rejected: Item[]}}
 */
export function planStatblockDrop(actor, items, rowDefaults = {}) {
    const targets = STATBLOCK_DROP_TARGETS[actor?.type];
    const added = [];
    const rejected = [];
    if (!targets) return { update: null, added, rejected: [...(items ?? [])] };

    // Grouped per array, because an ArrayField write replaces the whole array: two
    // weapons written one at a time would leave only the second.
    const byArray = new Map();
    for (const item of items ?? []) {
        const target = targets[item.type];
        if (!target) {
            rejected.push(item);
            continue;
        }
        if (!byArray.has(target.array)) {
            byArray.set(target.array, [...(actor.system?.[target.array] ?? [])]);
        }
        byArray.get(target.array).push({
            ...(rowDefaults[target.array] ?? {}),
            ...target.build(item),
        });
        added.push({ name: item.name, array: target.array });
    }

    if (!byArray.size) return { update: null, added, rejected };
    const update = {};
    for (const [key, rows] of byArray) update[`system.${key}`] = rows;
    return { update, added, rejected };
}

/**
 * Apply a drop to a statblock actor.
 *
 * @param {Actor} actor
 * @param {Item[]} items
 * @param {Record<string, object>} rowDefaults
 * @returns {Promise<{added: Array<{name: string, array: string}>, rejected: Item[]}>}
 */
export async function applyStatblockDrop(actor, items, rowDefaults = {}) {
    const { update, added, rejected } = planStatblockDrop(actor, items, rowDefaults);
    if (update) await actor.update(update);
    return { added, rejected };
}

/** Localize with a literal fallback, so a missing lang key never blanks a toast. */
function label(key, fallback, data) {
    const i18n = game?.i18n;
    if (!i18n) return fallback;
    const text = data ? i18n.format?.(key, data) : i18n.localize?.(key);
    return (!text || text === key) ? fallback : text;
}

/** "Weapon", from an item type — the same label the item sheet header shows. */
function typeLabel(type) {
    return label(`TYPES.Item.${type}`, type);
}

/**
 * Report a drop. Refusals are said out loud: dropping a mutation on a spaceship
 * has to read as "there is nowhere for this" rather than as a drop that silently
 * did nothing.
 */
function report(actor, { added, rejected }) {
    if (added.length === 1) {
        ui.notifications?.info?.(label(
            'ALTERNITY.DragDrop.RowAdded',
            `${added[0].name} added to ${actor.name}.`,
            { name: added[0].name, actor: actor.name },
        ));
    } else if (added.length > 1) {
        ui.notifications?.info?.(label(
            'ALTERNITY.DragDrop.RowsAdded',
            `${added.length} rows added to ${actor.name}.`,
            { count: added.length, actor: actor.name },
        ));
    }
    for (const item of rejected) {
        ui.notifications?.warn?.(label(
            'ALTERNITY.DragDrop.NoRoom',
            `A ${typeLabel(item.type)} has nowhere to go on a ${label(`TYPES.Actor.${actor.type}`, actor.type)} sheet.`,
            {
                type:  typeLabel(item.type),
                actor: label(`TYPES.Actor.${actor.type}`, actor.type),
            },
        ));
    }
}

/**
 * Wire item drops on a statblock sheet. Call from `_onRender`.
 *
 * Nothing on these sheets is draggable *out* — a schema row is not a document, so
 * there is nothing to hand to another sheet — hence `rowSelector: null`.
 *
 * @param {ActorSheetV2} sheet
 * @param {HTMLElement} root
 * @param {Record<string, object>} rowDefaults - The sheet's own `*_ARRAY_FIELDS`.
 */
export function bindStatblockDragDrop(sheet, root, rowDefaults = {}) {
    bindActorSheetDragDrop(sheet, root, {
        rowSelector: null,
        receive: async (items, { actor }) => {
            report(actor, await applyStatblockDrop(actor, items, rowDefaults));
        },
    });
}
