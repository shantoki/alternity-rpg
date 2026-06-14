/**
 * @file alternity-math.js
 * @description Phase 2 – Logic Engine: Centralised math service for all Alternity calculations.
 *
 * ALL numeric resolution must pass through this service — no inline arithmetic in hooks or UI.
 * Every method returns a result object that includes a `modifierTrace` array so the UI layer
 * can show a full breakdown of what contributed to the final number.
 *
 * Core Alternity mechanic:
 *   Roll d20, add modifiers. Result must be ≤ target number (roll-under success).
 *   Target number = skill rank + ability modifier + 10.
 *
 * Public API:
 *   resolveAbilityCheck(baseValue, modifiers, context)  → { finalValue, modifierTrace, succeeded, degree }
 *   calculateMitigatedDamage(rawDamage, modifiers, context) → { finalDamage, modifierTrace, mitigated }
 *   buildModifier(source, value, [reason])              → ModifierEntry (for constructing modifier arrays)
 */


// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Alternity difficulty-class target numbers.
 * In the roll-under system, lower target numbers are harder.
 */
const DIFFICULTY_DCS = Object.freeze({
    Effortless:  15,
    Simple:      20,
    Average:     25,
    Demanding:   30,
    Difficult:   40,
    Challenging: 50,
    Formidable:  60,
    Heroic:      80,
    Improbable:  100,
    Absurd:      150,
});

/**
 * Alternity degree-of-success labels.
 */
const SUCCESS_DEGREES = Object.freeze({
    CRITICAL_FAILURE: 'Critical Failure',
    FAILURE:          'Failure',
    ORDINARY:         'Ordinary',
    GOOD:             'Good',
    AMAZING:          'Amazing',
});

/**
 * Situation Die Steps Scale (Fastplay Accurate).
 * Index maps total step to [sign, dieLabel, formula]
 */
const SITUATION_DIE_SCALE = Object.freeze({
    '-5': [-1, 'd20',  '-1d20'],
    '-4': [-1, 'd12',  '-1d12'],
    '-3': [-1, 'd8',   '-1d8'],
    '-2': [-1, 'd6',   '-1d6'],
    '-1': [-1, 'd4',   '-1d4'],
    '0':  [0,  'd0',   '+0'],
    '1':  [1,  'd4',   '+1d4'],
    '2':  [1,  'd6',   '+1d6'],
    '3':  [1,  'd8',   '+1d8'],
    '4':  [1,  'd12',  '+1d12'],
    '5':  [1,  'd20',  '+1d20'],
    '6':  [1,  '2d20', '+2d20'],
    '7':  [1,  '3d20', '+3d20'],
});

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a step value to its corresponding situation die info.
 * @param {number} totalStep 
 * @returns {{sign: number, die: string, formula: string}}
 */
function _resolveStepDie(totalStep) {
    const step = Math.min(7, Math.max(-5, totalStep));
    const entry = SITUATION_DIE_SCALE[String(step)];
    return {
        sign: entry[0],
        die: entry[1],
        formula: entry[2]
    };
}

/**
 * Determine degree of success from the result and triple scores.
 * @param {number} result - Final combined roll result.
 * @param {object} scores - { ordinary, good, amazing }
 * @param {number} controlRoll - The natural d20 result.
 * @returns {string} SUCCESS_DEGREES value
 */
function _calculateDegree(result, scores, controlRoll) {
    if (controlRoll === 20) return SUCCESS_DEGREES.CRITICAL_FAILURE;
    if (result <= scores.amazing) return SUCCESS_DEGREES.AMAZING;
    if (result <= scores.good) return SUCCESS_DEGREES.GOOD;
    if (result <= scores.ordinary) return SUCCESS_DEGREES.ORDINARY;
    return SUCCESS_DEGREES.FAILURE;
}

/**
 * Validate and normalise a modifier sources array.
 * Modifiers in the new system are STEP values.
 *
 * @param {any[]} modifiers
 * @returns {{ valid: boolean, normalised: object[], errors: string[] }}
 */
function _validateModifiers(modifiers) {
    if (!Array.isArray(modifiers)) {
        return { valid: false, normalised: [], errors: ['modifiers must be an array.'] };
    }

    const errors = [];
    const normalised = [];

    modifiers.forEach((m, i) => {
        if (!m || typeof m !== 'object') {
            errors.push(`modifiers[${i}]: must be an object.`);
            return;
        }
        if (typeof m.source !== 'string' || !m.source) {
            errors.push(`modifiers[${i}]: source must be a non-empty string.`);
            return;
        }
        if (typeof m.value !== 'number' || !isFinite(m.value)) {
            errors.push(`modifiers[${i}] ("${m.source}"): value must be a finite number.`);
            return;
        }
        normalised.push({
            source: m.source,
            value:  Math.round(m.value), // steps are integers
            reason: typeof m.reason === 'string' ? m.reason : '',
        });
    });

    return { valid: errors.length === 0, normalised, errors };
}

// ---------------------------------------------------------------------------
// AlternityMathService
// ---------------------------------------------------------------------------

const AlternityMathService = {

    // -----------------------------------------------------------------------
    // resolveAbilityCheck
    // -----------------------------------------------------------------------

    /**
     * Resolve a skill/ability check using the Control + Situation die mechanic.
     *
     * @param {object}   scores     - { ordinary, good, amazing } target numbers.
     * @param {number}   baseStep   - Base situation step (0 for specialty, 1 for broad/feat).
     * @param {object[]} modifiers  - Array of { source, value, reason? } step modifiers.
     * @param {string}   context    - Descriptive context for logging.
     * @param {object}   [rolls]    - { control, situation } actual rolls if already made.
     *
     * @returns {{
     *   scores:        object,       // The triple scores used
     *   modifierTrace: object[],     // Every contributor
     *   totalStep:     number,       // Net step value
     *   stepDie:       object,       // {sign, die, formula}
     *   succeeded:     boolean|null, 
     *   degree:        string|null,  
     *   result:        number|null,  // Combined roll result
     *   controlRoll:   number|null,
     *   situationRoll: number|null,
     * }}
     */
    resolveAbilityCheck(scores, baseStep, modifiers, context, rolls = null) {
        if (!scores || typeof scores.ordinary !== 'number') {
            throw new Error('[AlternityMathService.resolveAbilityCheck] scores.ordinary must be a finite number.');
        }
        if (typeof context !== 'string' || !context) {
            throw new Error('[AlternityMathService.resolveAbilityCheck] context must be a non-empty string.');
        }

        const { valid, normalised, errors } = _validateModifiers(modifiers);
        if (!valid) {
            throw new Error(`[AlternityMathService.resolveAbilityCheck] Invalid modifiers:\n  ${errors.join('\n  ')}`);
        }

        const totalModifier = normalised.reduce((sum, m) => sum + m.value, 0);
        const totalStep     = baseStep + totalModifier;
        const stepDie       = _resolveStepDie(totalStep);

        // Include base step in the trace for transparency
        const modifierTrace = [
            { source: 'Base Step', value: baseStep, reason: baseStep === 1 ? 'Broad Skill / Ability Check' : 'Specialty Skill' },
            ...normalised
        ];

        let succeeded = null;
        let degree    = null;
        let result    = null;
        let controlRoll = null;
        let situationRoll = null;

        if (rolls !== null) {
            controlRoll = rolls.control;
            situationRoll = rolls.situation || 0;
            
            result = controlRoll + (stepDie.sign * situationRoll);
            degree = _calculateDegree(result, scores, controlRoll);
            succeeded = degree !== SUCCESS_DEGREES.FAILURE && degree !== SUCCESS_DEGREES.CRITICAL_FAILURE;
        }

        console.log(
            `[Alternity|${context}] Skill check — scores: ${scores.ordinary}/${scores.good}/${scores.amazing}, ` +
            `step: ${totalStep} (${stepDie.formula})` +
            (rolls !== null ? `, result: ${result} (control: ${controlRoll}, sit: ${situationRoll}), succeeded: ${succeeded}, degree: ${degree}` : '')
        );

        return { 
            scores, 
            modifierTrace, 
            totalStep, 
            stepDie, 
            succeeded, 
            degree, 
            result, 
            controlRoll, 
            situationRoll 
        };
    },


    // -----------------------------------------------------------------------
    // calculateMitigatedDamage
    // -----------------------------------------------------------------------

    /**
     * Apply damage mitigation (resistance, armor, stance effects) to a raw damage roll.
     * Returns the final damage and a full trace of what reduced it.
     *
     * Mitigation modifiers should have *negative* values (they reduce damage).
     * Vulnerability modifiers should have *positive* values (they increase damage).
     *
     * @param {number}   rawDamage  - The unmodified damage roll result.
     * @param {object[]} modifiers  - Array of { source, value, reason? } mitigation entries.
     * @param {string}   context    - Descriptive context for logging.
     *
     * @returns {{
     *   finalDamage:   number,    // Damage to apply (always ≥ 0)
     *   modifierTrace: object[],  // Every mitigation/vulnerability source
     *   totalModifier: number,    // Net modifier (negative = mitigation)
     *   mitigated:     number,    // How much damage was reduced
     *   rawDamage:     number,    // Original damage before mitigation
     * }}
     */
    calculateMitigatedDamage(rawDamage, modifiers, context) {
        if (typeof rawDamage !== 'number' || !isFinite(rawDamage) || rawDamage < 0) {
            throw new Error('[AlternityMathService.calculateMitigatedDamage] rawDamage must be a non-negative finite number.');
        }
        if (typeof context !== 'string' || !context) {
            throw new Error('[AlternityMathService.calculateMitigatedDamage] context must be a non-empty string.');
        }

        const { valid, normalised, errors } = _validateModifiers(modifiers);
        if (!valid) {
            throw new Error(`[AlternityMathService.calculateMitigatedDamage] Invalid modifiers:\n  ${errors.join('\n  ')}`);
        }

        const totalModifier = normalised.reduce((sum, m) => sum + m.value, 0);
        const rawFinal      = rawDamage + totalModifier;
        const finalDamage   = Math.max(0, Math.round(rawFinal)); // damage can't go below 0
        const mitigated     = rawDamage - finalDamage;

        console.log(
            `[Alternity|${context}] Damage mitigation — raw: ${rawDamage}, modifier: ${totalModifier}, ` +
            `final: ${finalDamage}, mitigated: ${mitigated}`
        );

        return { finalDamage, modifierTrace: normalised, totalModifier, mitigated, rawDamage };
    },

    // -----------------------------------------------------------------------
    // calculateSkillTarget
    // -----------------------------------------------------------------------

    /**
     * Compute the base target number for a skill check from its component parts,
     * before any situational modifiers are applied.
     *
     * Formula: skillRank + abilityModifier + 10
     *
     * @param {number} skillRank       - The character's rank in the skill (0–10).
     * @param {number} abilityModifier - The relevant ability score modifier (-3 to +6).
     * @returns {number}
     */
    calculateSkillTarget(skillRank, abilityModifier) {
        if (typeof skillRank !== 'number' || skillRank < 0 || skillRank > 10) {
            throw new Error('[AlternityMathService.calculateSkillTarget] skillRank must be 0–10.');
        }
        if (typeof abilityModifier !== 'number' || abilityModifier < -3 || abilityModifier > 6) {
            throw new Error('[AlternityMathService.calculateSkillTarget] abilityModifier must be -3 to +6.');
        }
        return skillRank + abilityModifier + 10;
    },

    // -----------------------------------------------------------------------
    // buildModifier
    // -----------------------------------------------------------------------

    /**
     * Convenience factory for building a well-formed modifier entry.
     * Use this in hooks and the UI layer to ensure consistent structure.
     *
     * @param {string} source - Where this modifier comes from (e.g. 'Defensive Stance').
     * @param {number} value  - The modifier amount (positive = penalty, negative = bonus).
     * @param {string} [reason] - Optional human-readable explanation.
     * @returns {{ source: string, value: number, reason: string }}
     */
    buildModifier(source, value, reason = '') {
        if (typeof source !== 'string' || !source) {
            throw new Error('[AlternityMathService.buildModifier] source must be a non-empty string.');
        }
        if (typeof value !== 'number' || !isFinite(value)) {
            throw new Error('[AlternityMathService.buildModifier] value must be a finite number.');
        }
        return { source, value, reason: String(reason) };
    },

    // -----------------------------------------------------------------------
    // getDifficultyDC
    // -----------------------------------------------------------------------

    /**
     * Look up the target number for a named difficulty tier.
     * @param {string} difficultyName - e.g. 'Average', 'Heroic'
     * @returns {number}
     */
    getDifficultyDC(difficultyName) {
        const dc = DIFFICULTY_DCS[difficultyName];
        if (dc === undefined) {
            throw new Error(
                `[AlternityMathService.getDifficultyDC] Unknown difficulty "${difficultyName}". ` +
                `Valid values: ${Object.keys(DIFFICULTY_DCS).join(', ')}.`
            );
        }
        return dc;
    },

    // -----------------------------------------------------------------------
    // buildWoundPenaltyModifier
    // -----------------------------------------------------------------------

    /**
     * Build a modifier entry from a character's current wound penalty.
     * Returns null if there is no penalty (Healthy or wound penalty is 0).
     *
     * @param {string} woundLevel    - Current wound level string.
     * @param {object} WOUND_PENALTIES - The penalty map from alternity-actor-data.js
     * @returns {{ source: string, value: number, reason: string }|null}
     */
    buildWoundPenaltyModifier(woundLevel, WOUND_PENALTIES) {
        const penalty = WOUND_PENALTIES[woundLevel];
        if (penalty === null) {
            // 'Out' — character is incapacitated; caller must handle this separately
            return { source: 'Wound (Out)', value: 999, reason: 'Character is incapacitated.' };
        }
        if (!penalty || penalty === 0) return null;
        return this.buildModifier(
            `Wound (${woundLevel})`,
            penalty,
            `${woundLevel} wound state penalty`
        );
    },

};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
    AlternityMathService,
    DIFFICULTY_DCS,
    SUCCESS_DEGREES,
    SITUATION_DIE_SCALE,
};
