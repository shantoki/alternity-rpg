/**
 * @file alternity-item-template.js
 * @description Phase 1 – Data Layer: Custom Item document type for Alternity effects.
 *
 * The `System_Effect` item type acts as a reusable template for all special
 * effects in the game (damage modifiers, buffs, conditional checks). Items of
 * this type are templates — they define *what* an effect does, not a single use.
 *
 * Key classes:
 *  - RequiredCheck     — A prerequisite check (resource cost, condition gate).
 *  - AlternityEffect   — A single effect entry (damage delta, buff, modifier).
 *  - SystemEffectItem  — The top-level item template document wrapper.
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Valid effect types. */
const EFFECT_TYPES = Object.freeze({
    DAMAGE:   'Damage',
    BUFF:     'Buff',
    MODIFIER: 'Modifier',
});

/** Valid target scopes — who / what is affected by this effect. */
const TARGET_SCOPES = Object.freeze({
    SELF:        'Self',
    SINGLE:      'Single',
    AREA:        'Area',
    ALL_ALLIES:  'AllAllies',
    ALL_ENEMIES: 'AllEnemies',
});

/** Valid damage types from the Alternity ruleset. */
const DAMAGE_TYPES = Object.freeze([
    'Ballistic', 'Energy', 'Laser', 'Piercing', 'Slashing',
    'Impact', 'Incendiary', 'Toxic', 'Radiation', 'Psionic',
]);

// ---------------------------------------------------------------------------
// RequiredCheck
// ---------------------------------------------------------------------------

/**
 * Represents a prerequisite that must be satisfied before an effect fires.
 *
 * Examples:
 *  - { resource: 'psiPoints', cost: 2 }         → must have ≥2 PP
 *  - { resource: 'techPoints', cost: 1 }         → must have ≥1 TP
 *  - { condition: 'woundLevel', value: 'Healthy' } → must be unwounded
 *  - { skill: 'Ranged Combat', minRank: 3 }      → skill rank gate
 *
 * @property {string}  checkType  - 'resource' | 'condition' | 'skill'
 * @property {object}  params     - Check-type-specific parameters (see examples above).
 * @property {string}  [failMessage] - User-facing message when this check fails.
 */
class RequiredCheck {
    static VALID_TYPES = Object.freeze(['resource', 'condition', 'skill']);

    constructor({ checkType, params = {}, failMessage = '' } = {}) {
        if (!RequiredCheck.VALID_TYPES.includes(checkType)) {
            throw new Error(
                `[RequiredCheck] Invalid checkType "${checkType}". Must be: ${RequiredCheck.VALID_TYPES.join(', ')}.`
            );
        }
        this.checkType   = checkType;
        this.params      = { ...params };
        this.failMessage = String(failMessage);
    }

    serialize() {
        return {
            checkType:   this.checkType,
            params:      { ...this.params },
            failMessage: this.failMessage,
        };
    }

    static deserialize(data) {
        if (!data || typeof data !== 'object') {
            throw new Error('[RequiredCheck] deserialize() requires a non-null object.');
        }
        return new RequiredCheck(data);
    }
}

// ---------------------------------------------------------------------------
// AlternityEffect
// ---------------------------------------------------------------------------

/**
 * A single effect entry within a SystemEffectItem.
 *
 * @property {string} effectType   - EFFECT_TYPES value.
 * @property {number} value        - Magnitude (e.g. damage delta, buff amount).
 * @property {string} [damageType] - For Damage effects: one of DAMAGE_TYPES.
 * @property {string} [stat]       - For Modifier/Buff effects: the stat being changed.
 * @property {string} [duration]   - 'instant' | 'round' | 'scene' | 'permanent'.
 * @property {string} [notes]      - GM/designer notes.
 */
class AlternityEffect {
    static VALID_DURATIONS = Object.freeze(['instant', 'round', 'scene', 'permanent']);

    constructor({
        effectType,
        value      = 0,
        damageType = null,
        stat       = null,
        duration   = 'instant',
        notes      = '',
    } = {}) {
        if (!Object.values(EFFECT_TYPES).includes(effectType)) {
            throw new Error(
                `[AlternityEffect] Invalid effectType "${effectType}". Must be: ${Object.values(EFFECT_TYPES).join(', ')}.`
            );
        }
        if (!AlternityEffect.VALID_DURATIONS.includes(duration)) {
            throw new Error(
                `[AlternityEffect] Invalid duration "${duration}". Must be: ${AlternityEffect.VALID_DURATIONS.join(', ')}.`
            );
        }
        if (effectType === EFFECT_TYPES.DAMAGE && damageType && !DAMAGE_TYPES.includes(damageType)) {
            throw new Error(
                `[AlternityEffect] Invalid damageType "${damageType}". Must be one of: ${DAMAGE_TYPES.join(', ')}.`
            );
        }

        this.effectType = effectType;
        this.value      = Number(value);
        this.damageType = damageType;
        this.stat       = stat;
        this.duration   = duration;
        this.notes      = String(notes);
    }

    serialize() {
        return {
            effectType: this.effectType,
            value:      this.value,
            damageType: this.damageType,
            stat:       this.stat,
            duration:   this.duration,
            notes:      this.notes,
        };
    }

    static deserialize(data) {
        if (!data || typeof data !== 'object') {
            throw new Error('[AlternityEffect] deserialize() requires a non-null object.');
        }
        return new AlternityEffect(data);
    }
}

// ---------------------------------------------------------------------------
// SystemEffectItem
// ---------------------------------------------------------------------------

/**
 * The top-level item template for Alternity System_Effect items.
 *
 * Stored in Foundry as an Item document with `type: 'System_Effect'`.
 * Serialised to `item.getFlag('alternity-v2', 'effectTemplate')`.
 *
 * @property {string}            id             - Foundry Item id.
 * @property {string}            name           - Effect name.
 * @property {string}            targetScope    - TARGET_SCOPES value.
 * @property {AlternityEffect[]} effects        - One or more effect entries.
 * @property {RequiredCheck[]}   requiredChecks - Gates that must pass before firing.
 * @property {boolean}           isReusable     - True if template; false if single-use.
 * @property {string}            [description]  - Flavour / rules text.
 */
class SystemEffectItem {
    constructor({
        id,
        name,
        targetScope,
        effects        = [],
        requiredChecks = [],
        isReusable     = true,
        description    = '',
    } = {}) {
        if (!id)   throw new Error('[SystemEffectItem] id is required.');
        if (!name) throw new Error('[SystemEffectItem] name is required.');
        if (!Object.values(TARGET_SCOPES).includes(targetScope)) {
            throw new Error(
                `[SystemEffectItem] Invalid targetScope "${targetScope}". Must be: ${Object.values(TARGET_SCOPES).join(', ')}.`
            );
        }

        this.id    = String(id);
        this.name  = String(name);
        this.targetScope    = targetScope;
        this.isReusable     = Boolean(isReusable);
        this.description    = String(description);

        this.effects = effects.map(e =>
            e instanceof AlternityEffect ? e : AlternityEffect.deserialize(e)
        );
        this.requiredChecks = requiredChecks.map(c =>
            c instanceof RequiredCheck ? c : RequiredCheck.deserialize(c)
        );
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /**
     * Return all effects of a given type.
     * @param {string} effectType - EFFECT_TYPES value
     * @returns {AlternityEffect[]}
     */
    getEffectsByType(effectType) {
        return this.effects.filter(e => e.effectType === effectType);
    }

    /**
     * Validate that all required checks can pass given a character state snapshot.
     * Returns a detailed result rather than throwing, so the hook layer can provide
     * user-friendly feedback.
     *
     * @param {object} stateSnapshot - Minimal snapshot: { resources, woundLevel, skills }
     * @returns {{ valid: boolean, failures: string[] }}
     */
    validateRequirements(stateSnapshot) {
        const failures = [];

        for (const check of this.requiredChecks) {
            const { checkType, params, failMessage } = check;

            if (checkType === 'resource') {
                const available = stateSnapshot.resources?.[params.resource] ?? 0;
                if (available < params.cost) {
                    failures.push(failMessage || `Insufficient ${params.resource} (need ${params.cost}, have ${available}).`);
                }
            } else if (checkType === 'condition') {
                const actual = stateSnapshot[params.condition];
                if (actual !== params.value) {
                    failures.push(failMessage || `Condition not met: ${params.condition} must be "${params.value}" (is "${actual}").`);
                }
            } else if (checkType === 'skill') {
                const rank = stateSnapshot.skills?.[params.skill] ?? 0;
                if (rank < params.minRank) {
                    failures.push(failMessage || `Skill "${params.skill}" rank too low (need ${params.minRank}, have ${rank}).`);
                }
            }
        }

        return { valid: failures.length === 0, failures };
    }

    // -----------------------------------------------------------------------
    // Serialisation
    // -----------------------------------------------------------------------

    serialize() {
        return {
            id:             this.id,
            name:           this.name,
            targetScope:    this.targetScope,
            effects:        this.effects.map(e => e.serialize()),
            requiredChecks: this.requiredChecks.map(c => c.serialize()),
            isReusable:     this.isReusable,
            description:    this.description,
        };
    }

    static deserialize(data) {
        if (!data || typeof data !== 'object') {
            throw new Error('[SystemEffectItem] deserialize() requires a non-null object.');
        }
        return new SystemEffectItem(data);
    }
}

// ---------------------------------------------------------------------------
// Foundry integration helpers
// ---------------------------------------------------------------------------

/**
 * Retrieve a SystemEffectItem template from a Foundry Item document.
 * @param {object} item - Foundry Item document with type 'System_Effect'
 * @returns {SystemEffectItem|null}
 */
function getEffectTemplate(item) {
    if (!item) return null;
    try {
        const raw = item.getFlag('alternity-v2', 'effectTemplate');
        return raw ? SystemEffectItem.deserialize(raw) : null;
    } catch (err) {
        console.error(`[Alternity] getEffectTemplate() failed for item ${item?.id}:`, err);
        return null;
    }
}

/**
 * Persist a SystemEffectItem back to its Foundry Item document.
 * @param {object}           item     - Foundry Item document
 * @param {SystemEffectItem} template
 * @returns {Promise<boolean>}
 */
async function saveEffectTemplate(item, template) {
    if (!item || !(template instanceof SystemEffectItem)) return false;
    try {
        await item.setFlag('alternity-v2', 'effectTemplate', template.serialize());
        return true;
    } catch (err) {
        console.error(`[Alternity] saveEffectTemplate() failed for item ${item?.id}:`, err);
        return false;
    }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
    EFFECT_TYPES,
    TARGET_SCOPES,
    DAMAGE_TYPES,
    RequiredCheck,
    AlternityEffect,
    SystemEffectItem,
    getEffectTemplate,
    saveEffectTemplate,
};
