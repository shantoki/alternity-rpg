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
 * Ship toughness/firepower classes, ordered small → large (Warships Ch.1).
 */
const SHIP_TOUGHNESS_CLASSES = Object.freeze(['SmallCraft', 'Light', 'Medium', 'Heavy', 'SuperHeavy']);

/**
 * Ship damage grades, ordered least → most severe (Warships Ch.1).
 */
const SHIP_DAMAGE_GRADES = Object.freeze(['stun', 'wound', 'mortal', 'critical']);

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
    // calculateShipDamageMitigation
    // -----------------------------------------------------------------------

    /**
     * Apply a ship's armor negation to a raw damage roll for a given damage type.
     * Thin wrapper around calculateMitigatedDamage — armor is just a single
     * mitigation modifier keyed by damage type (Warships Ch.1: "Armor and Screens").
     *
     * @param {number} rawDamage      - The unmodified damage roll result.
     * @param {string} damageType     - 'lowImpact' | 'highImpact' | 'energy'.
     * @param {object} armorRatings   - { lowImpact, highImpact, energy } — already-rolled armor dice results.
     * @param {string} context        - Descriptive context for logging.
     *
     * @returns {{ finalDamage: number, modifierTrace: object[], totalModifier: number, mitigated: number, rawDamage: number }}
     */
    calculateShipDamageMitigation(rawDamage, damageType, armorRatings, context) {
        if (!['lowImpact', 'highImpact', 'energy'].includes(damageType)) {
            throw new Error(
                `[AlternityMathService.calculateShipDamageMitigation] damageType must be one of ` +
                `'lowImpact', 'highImpact', 'energy'. Received "${damageType}".`
            );
        }
        if (!armorRatings || typeof armorRatings[damageType] !== 'number' || !isFinite(armorRatings[damageType])) {
            throw new Error(
                `[AlternityMathService.calculateShipDamageMitigation] armorRatings.${damageType} must be a finite number.`
            );
        }

        const armorModifier = this.buildModifier(
            `Armor (${damageType})`,
            -armorRatings[damageType],
            'Ship armor negation'
        );

        return this.calculateMitigatedDamage(rawDamage, [armorModifier], context);
    },

    // -----------------------------------------------------------------------
    // calculateFirepowerShift
    // -----------------------------------------------------------------------

    /**
     * Resolve the firepower-vs-toughness grade shift for a ship-combat hit
     * (Warships Ch.1: "Firepower and Toughness" / Table 1-3 Downgrading / Table 1-4 Upgrading).
     *
     * If firepower exceeds toughness, damage upgrades one grade per excess class
     * (stun -> wound -> mortal -> critical), and further excess beyond critical
     * multiplies the critical damage (2x/3x/4x). If toughness exceeds firepower,
     * damage downgrades one grade per excess class (critical -> mortal -> wound ->
     * stun -> 'none'), floored at 'none' (no damage) rather than going negative.
     *
     * @param {string} damageGrade    - 'stun' | 'wound' | 'mortal' | 'critical'.
     * @param {string} firepowerClass - One of SHIP_TOUGHNESS_CLASSES.
     * @param {string} toughnessClass - One of SHIP_TOUGHNESS_CLASSES.
     *
     * @returns {{
     *   finalGrade:    string,   // 'stun' | 'wound' | 'mortal' | 'critical' | 'none'
     *   multiplier:    number,   // Critical-damage multiplier (1 unless upgraded past critical)
     *   modifierTrace: object[],
     *   shift:         number,   // firepower rank - toughness rank
     * }}
     */
    calculateFirepowerShift(damageGrade, firepowerClass, toughnessClass) {
        const gradeIndex = SHIP_DAMAGE_GRADES.indexOf(damageGrade);
        if (gradeIndex === -1) {
            throw new Error(
                `[AlternityMathService.calculateFirepowerShift] damageGrade must be one of ` +
                `${SHIP_DAMAGE_GRADES.join(', ')}. Received "${damageGrade}".`
            );
        }
        const firepowerRank = SHIP_TOUGHNESS_CLASSES.indexOf(firepowerClass);
        if (firepowerRank === -1) {
            throw new Error(
                `[AlternityMathService.calculateFirepowerShift] firepowerClass must be one of ` +
                `${SHIP_TOUGHNESS_CLASSES.join(', ')}. Received "${firepowerClass}".`
            );
        }
        const toughnessRank = SHIP_TOUGHNESS_CLASSES.indexOf(toughnessClass);
        if (toughnessRank === -1) {
            throw new Error(
                `[AlternityMathService.calculateFirepowerShift] toughnessClass must be one of ` +
                `${SHIP_TOUGHNESS_CLASSES.join(', ')}. Received "${toughnessClass}".`
            );
        }

        const shift = firepowerRank - toughnessRank;
        let idx = gradeIndex; // -1 = 'none', 0..3 = SHIP_DAMAGE_GRADES index
        let multiplier = 1;

        if (shift > 0) {
            for (let i = 0; i < shift; i++) {
                if (idx < SHIP_DAMAGE_GRADES.length - 1) idx++;
                else multiplier++;
            }
        } else if (shift < 0) {
            for (let i = 0; i < -shift; i++) {
                if (idx > -1) idx--;
            }
        }

        const finalGrade = idx === -1 ? 'none' : SHIP_DAMAGE_GRADES[idx];

        const modifierTrace = [
            this.buildModifier('Base Grade', 0, `Starting grade: ${damageGrade}`),
            this.buildModifier(
                'Firepower vs Toughness',
                shift,
                `${firepowerClass} firepower vs ${toughnessClass} toughness (${shift >= 0 ? '+' : ''}${shift} class${Math.abs(shift) === 1 ? '' : 'es'})`
            ),
        ];

        return { finalGrade, multiplier, modifierTrace, shift };
    },

    // -----------------------------------------------------------------------
    // calculateCyberTolerance
    // -----------------------------------------------------------------------

    /**
     * Resolve a character's cyber tolerance track from their Constitution score and
     * the sizes of the cyber gear installed in their body
     * (Player's Handbook Ch.15: "Cyber Tolerance", Table P53).
     *
     * The tolerance track is the character's Constitution score worth of boxes
     * (mechalus use CON+4), split into three sections written as "left/centre/right":
     *   left   = half the score, rounded down
     *   centre = a quarter of the score, rounded up
     *   right  = whatever is left over
     * A CON 12 hero therefore has a 6/3/3 track, matching the book's worked example.
     *
     * Installed gear fills boxes left to right. Two thresholds matter:
     *   - Once more than the left section is filled (i.e. over half the track), every
     *     further installation requires a Constitution feat check, and any *mortal*
     *     damage the hero takes is treated as damage to their cyber gear instead.
     *   - Once the right section is reached, *wound* damage is redirected too.
     *
     * @param {number} constitutionScore - The character's CON score.
     * @param {Array<number|{name?: string, size?: number}>} [installedSizes] - Sizes of installed
     *        gear, either as raw numbers or as objects with a `size` (and optional `name` for the trace).
     * @param {object}  [options]
     * @param {boolean} [options.isMechalus] - Mechalus characters use CON+4 (PHB Ch.2).
     *
     * @returns {{
     *   max:            number,
     *   used:           number,
     *   remaining:      number,
     *   isFull:         boolean,
     *   isOverloaded:   boolean,
     *   sections:       { left: number, centre: number, right: number },
     *   filled:         { left: number, centre: number, right: number },
     *   requiresFeatCheck: boolean,
     *   damageRedirect: 'none'|'mortal'|'woundAndMortal',
     *   modifierTrace:  object[]
     * }}
     */
    calculateCyberTolerance(constitutionScore, installedSizes = [], options = {}) {
        if (typeof constitutionScore !== 'number' || !isFinite(constitutionScore) || constitutionScore < 0) {
            throw new Error(
                '[AlternityMathService.calculateCyberTolerance] constitutionScore must be a finite number ≥ 0.'
            );
        }
        if (!Array.isArray(installedSizes)) {
            throw new Error(
                '[AlternityMathService.calculateCyberTolerance] installedSizes must be an array.'
            );
        }

        const isMechalus = !!options.isMechalus;
        const max = Math.floor(constitutionScore) + (isMechalus ? 4 : 0);

        // Section widths. `right` is the remainder rather than its own formula so the
        // three sections always add back up to `max` exactly, at every score.
        const left   = Math.floor(max / 2);
        const centre = Math.ceil(max / 4);
        const right  = Math.max(0, max - left - centre);

        const modifierTrace = [
            this.buildModifier('Constitution', constitutionScore, 'Base cyber tolerance'),
        ];
        if (isMechalus) {
            modifierTrace.push(this.buildModifier('Mechalus', 4, 'Integrated cybernetics (CON+4)'));
        }

        let used = 0;
        for (const entry of installedSizes) {
            const size = typeof entry === 'number' ? entry : (entry?.size ?? 0);
            if (typeof size !== 'number' || !isFinite(size) || size < 0) {
                throw new Error(
                    '[AlternityMathService.calculateCyberTolerance] every installed size must be a finite number ≥ 0.'
                );
            }
            used += size;
            const label = typeof entry === 'number' ? 'Cyber gear' : (entry?.name || 'Cyber gear');
            modifierTrace.push(this.buildModifier(label, size, 'Cyber tolerance consumed'));
        }

        // Boxes fill left to right; each section holds at most its own width.
        const filledLeft   = Math.min(used, left);
        const filledCentre = Math.min(Math.max(0, used - left), centre);
        const filledRight  = Math.min(Math.max(0, used - left - centre), right);

        const damageRedirect = filledRight  > 0 ? 'woundAndMortal'
                             : filledCentre > 0 ? 'mortal'
                             : 'none';

        return {
            max,
            used,
            remaining: Math.max(0, max - used),
            isFull:       used >= max,
            isOverloaded: used > max,
            sections: { left, centre, right },
            filled:   { left: filledLeft, centre: filledCentre, right: filledRight },
            // Past the halfway mark every further installation calls for a CON feat check.
            requiresFeatCheck: used > left,
            damageRedirect,
            modifierTrace,
        };
    },

    // -----------------------------------------------------------------------
    // calculateSkillScores
    // -----------------------------------------------------------------------

    /**
     * Compute the Ordinary/Good/Amazing triple a skill check rolls under.
     *
     * Alternity has no "target number = rank + modifier + 10" — that is a d20-shaped
     * formula this codebase carried around for a while and never used for real rolls.
     * The actual rule (alternity-core-mechanics.md, "Skills"):
     *   Broad skill     : score = ability score
     *   Specialty skill : score = ability score + skill rank
     *   Untrained       : score = half the ability score, rounded down
     * The triple is then Ordinary = score, Good = half, Amazing = a quarter (both
     * rounded down), which is the same split AlternityCharacterState.getSkillScores()
     * applies to the main skill tree.
     *
     * @param {number} abilityScore - The linked ability's score.
     * @param {number} [skillRank=0] - Ranks held in the skill (0 for broad/untrained).
     * @param {object} [options]
     * @param {boolean} [options.untrained] - Character has no ranks and is improvising.
     * @returns {{ ordinary: number, good: number, amazing: number, base: number }}
     */
    calculateSkillScores(abilityScore, skillRank = 0, options = {}) {
        if (typeof abilityScore !== 'number' || !isFinite(abilityScore) || abilityScore < 0) {
            throw new Error('[AlternityMathService.calculateSkillScores] abilityScore must be a finite number ≥ 0.');
        }
        if (typeof skillRank !== 'number' || !isFinite(skillRank) || skillRank < 0) {
            throw new Error('[AlternityMathService.calculateSkillScores] skillRank must be a finite number ≥ 0.');
        }

        const base = options.untrained
            ? Math.floor(abilityScore / 2)
            : Math.floor(abilityScore) + Math.floor(skillRank);

        return {
            base,
            ordinary: base,
            good:     Math.floor(base / 2),
            amazing:  Math.floor(base / 4),
        };
    },

    // -----------------------------------------------------------------------
    // calculateResistanceModifier
    // -----------------------------------------------------------------------

    /**
     * Look up an ability's resistance modifier — the step penalty an attacker takes
     * when this ability resists them (Player's Handbook Table P2).
     *
     *   ≤3: -2   4-5: -1   6-10: 0   11-12: +1
     *   13-14: +2   15-16: +3   17-18: +4   19+: +5
     *
     * A positive modifier is good for the defender: it penalises the opponent's
     * check. Only STR, DEX, INT and WIL have resistance modifiers — the book is
     * explicit that CON and PER are used actively instead, so they return 0.
     *
     * Alternity has no armor-class-style "defense number"; defending is this step
     * modifier applied to the attacker's check.
     *
     * The bands past +2 are reachable in play: cybertech alone can add up to +3 STR
     * from a cyberlimb and another +3 from MusclePlus.
     *
     * @param {number} abilityScore - The ability's score.
     * @param {string} [ability]    - Ability key ('STR'|'DEX'|'INT'|'WIL'|'CON'|'PER').
     *                                Omit to apply the bands unconditionally.
     * @returns {number}
     */
    calculateResistanceModifier(abilityScore, ability = null) {
        if (typeof abilityScore !== 'number' || !isFinite(abilityScore)) {
            throw new Error('[AlternityMathService.calculateResistanceModifier] abilityScore must be a finite number.');
        }
        if (ability !== null && !['STR', 'DEX', 'INT', 'WIL'].includes(String(ability).toUpperCase())) {
            return 0;
        }
        if (abilityScore >= 19) return 5;
        if (abilityScore >= 17) return 4;
        if (abilityScore >= 15) return 3;
        if (abilityScore >= 13) return 2;
        if (abilityScore >= 11) return 1;
        if (abilityScore >= 6)  return 0;
        if (abilityScore >= 4)  return -1;
        return -2;
    },

    // -----------------------------------------------------------------------
    // calculateStrengthDamageAdjustment
    // -----------------------------------------------------------------------

    /**
     * Look up the damage adjustment a Strength score grants (Player's Handbook
     * Table P9: Strength & Damage).
     *
     *   ≤5: -1   6-10: 0   11-12: +1   13-14: +2
     *   15-16: +3   17-18: +4   19+: +5
     *
     * Per the Player's Handbook (Ch.2, "Strength"), this applies to damage from an
     * unarmed attack, a melee weapon or a thrown weapon — never to ranged or heavy
     * weapons. The book caps the benefit at +5, and a negative adjustment never
     * reduces damage below 1 point, which callers must enforce on the rolled result.
     *
     * @param {number} strengthScore
     * @returns {number}
     */
    calculateStrengthDamageAdjustment(strengthScore) {
        if (typeof strengthScore !== 'number' || !isFinite(strengthScore)) {
            throw new Error('[AlternityMathService.calculateStrengthDamageAdjustment] strengthScore must be a finite number.');
        }
        if (strengthScore >= 19) return 5;
        if (strengthScore >= 17) return 4;
        if (strengthScore >= 15) return 3;
        if (strengthScore >= 13) return 2;
        if (strengthScore >= 11) return 1;
        if (strengthScore >= 6)  return 0;
        return -1;
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
    SHIP_TOUGHNESS_CLASSES,
    SHIP_DAMAGE_GRADES,
};
