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
 * Firepower / toughness ladder used by the *core* rules, ordered weakest → strongest
 * (Player's Handbook Ch.3, GM Guide Ch.11). Damage degrades one grade for each class
 * the target's toughness exceeds the weapon's firepower.
 *
 * Not to be confused with SHIP_TOUGHNESS_CLASSES, which is the Warships supplement's
 * separate SmallCraft..SuperHeavy ladder — the two systems are mutually incompatible
 * and are modelled by different actor types (`spaceship` vs `warship`).
 */
const FIREPOWER_CLASSES = Object.freeze(['Marginal', 'Ordinary', 'Good', 'Amazing']);

/**
 * The three damage grades a core-rules target (character, vehicle or spaceship
 * compartment) can take, ordered least → most severe. Ships have no 'critical'
 * track — that belongs to the Warships model.
 */
const COMPARTMENT_DAMAGE_GRADES = Object.freeze(['stun', 'wound', 'mortal']);

/**
 * "All spaceships have Amazing toughness." (GM Guide Ch.11, "Damage")
 * A flat statement in the book, not a per-ship stat — which is why `spaceship`
 * has no toughness field, unlike `warship`.
 */
const SPACESHIP_TOUGHNESS = 'Amazing';

/**
 * Per-compartment durability ceiling (GM Guide Ch.11, "Compartments"):
 * "No compartment can contain more than 10 durability points, unless the
 * Gamemaster is designing an extraordinary alien vessel."
 */
const MAX_COMPARTMENT_DURABILITY = 10;

/**
 * Durability a single life-support or damage-control unit can cover (GM Guide Ch.11).
 */
const SUPPORT_UNIT_DURABILITY_SPAN = 20;

/** Faces on the hit-location die (GM Guide Table G50 is a d20 table). */
const DIE_FACES = 20;

/**
 * Fraction of total hull durability each armor grade costs (GM Guide Ch.11, "Armor").
 */
const SHIP_ARMOR_DURABILITY_FRACTION = Object.freeze({
    None:     0,
    Light:    0,
    Moderate: 0.1,
    Heavy:    0.2,
});

/**
 * Table G50 column widths, keyed by compartment count.
 *
 * The table itself is unreadable in the scan, but each column's output is printed
 * verbatim on the PHB Ch.12 stock ships, and those are transcribed here as band
 * *widths* (which sum to 20) rather than ranges:
 *
 *   1  escape pod    (Hull size 2)   1-20
 *   2  launch        (Hull size 8)   1-7, 8-20
 *   4  STG shuttle   (Hull size 16)  1-2, 3-5, 6-12, 13-20
 *   6  trader        (Hull size 24)  1-2, 3-4, 5-7, 8-10, 11-15, 16-20
 *   8  system liner  (Hull size 32)  1, 2, 3-4, 5-6, 7-9, 10-12, 13-16, 17-20
 *   10 transport     (Hull size 40)  1, 2, 3, 4, 5-6, 7-8, 9-10, 11-13, 14-16, 17-20
 *
 * Odd counts and counts above 10 have no printed example anywhere in the corpus.
 */
const PRINTED_COMPARTMENT_HIT_WIDTHS = Object.freeze({
    1:  Object.freeze([20]),
    2:  Object.freeze([7, 13]),
    4:  Object.freeze([2, 3, 7, 8]),
    6:  Object.freeze([2, 2, 3, 3, 5, 5]),
    8:  Object.freeze([1, 1, 2, 2, 3, 3, 4, 4]),
    10: Object.freeze([1, 1, 1, 1, 2, 2, 2, 3, 3, 4]),
});

/**
 * Compartment types a spaceship's systems can be grouped into (GM Guide Table G35).
 * Every ship must have at least one command and one engineering compartment.
 */
const COMPARTMENT_KINDS = Object.freeze([
    'Command', 'Engineering', 'Weapons', 'Auxiliary',
    'Electronics', 'Cargo', 'Crew',
]);

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
    // calculateDurabilityRatings
    // -----------------------------------------------------------------------

    /**
     * Derive the four durability ratings from a Constitution score
     * (Player's Handbook Ch.2 "Durability"; Ch.3 "Damage").
     *
     * The book states it twice, unambiguously: "A hero can withstand a number of
     * points of stun and wound damage equal to his Constitution score, and a
     * number of points of mortal and fatigue damage equal to half his
     * Constitution score, rounded up."
     *
     * **Fatigue is a full fourth damage track**, not a derived condition — the
     * PHB lists "the four types of damage" as stun, wound, mortal and fatigue,
     * and the Gamemaster Guide prints supporting-cast durability as a four-value
     * run (`9/9/5/5`). Every fatigue box marked also costs +1 step on all
     * subsequent actions (the "Dazed" rule), which is why it is tracked here
     * rather than folded into stun.
     *
     * @param {number} constitutionScore
     * @param {object}  [options]
     * @param {boolean} [options.isWeren] - Weren "Superior Durability": CON x1.5,
     *        rounded down (PHB Ch.2). Applied before the halving.
     * @returns {{
     *   stun: number, wound: number, mortal: number, fatigue: number,
     *   base: number, modifierTrace: object[]
     * }}
     */
    calculateDurabilityRatings(constitutionScore, options = {}) {
        if (typeof constitutionScore !== 'number' || !isFinite(constitutionScore) || constitutionScore < 0) {
            throw new Error(
                '[AlternityMathService.calculateDurabilityRatings] constitutionScore must be a finite number ≥ 0.'
            );
        }

        const isWeren = !!options.isWeren;
        // Weren durability is figured from an inflated Constitution, so the
        // multiplier has to land before the mortal/fatigue halving rather than
        // being applied to each of the four results.
        const base = isWeren
            ? Math.floor(Math.floor(constitutionScore) * 1.5)
            : Math.floor(constitutionScore);

        const modifierTrace = [
            this.buildModifier('Constitution', Math.floor(constitutionScore), 'Base durability'),
        ];
        if (isWeren) {
            modifierTrace.push(
                this.buildModifier('Weren', base - Math.floor(constitutionScore), 'Superior Durability (CON x1.5)')
            );
        }

        const half = Math.ceil(base / 2);

        return {
            stun:    base,
            wound:   base,
            mortal:  half,
            fatigue: half,
            base,
            modifierTrace,
        };
    },

    // -----------------------------------------------------------------------
    // calculateActiveMemory
    // -----------------------------------------------------------------------

    /**
     * Resolve a computer's active memory budget from its processor capacity and
     * the slot costs of the programs currently loaded into it
     * (Player's Handbook Ch.10 "The Computer Itself"; Dataware Ch.2 "Running
     * Programs").
     *
     * This is the software counterpart of the cyber tolerance track: a fixed
     * pool of slots that only *loaded* software draws on. Storage memory is
     * effectively unlimited, so an unloaded program costs nothing — it is the
     * act of loading it into active memory that consumes the budget.
     *
     * Two rules beyond the raw arithmetic:
     *   - A supercomputer has unlimited active memory (`options.unlimited`),
     *     in which case nothing can ever overflow.
     *   - The operating system is always resident but never charges slots
     *     (PHB Ch.10: "Though the OS is considered to be active, it doesn't use
     *     up any active memory slots"), so it simply must not appear in
     *     `loadedPrograms`.
     *
     * Automated programs are counted here like any other: automation exempts a
     * program from the operator's one-use-per-phase limit, not from memory.
     *
     * @param {number} activeMemory - Slots the processor provides.
     * @param {Array<number|{name?: string, slots?: number}>} [loadedPrograms] - Slot
     *        costs of loaded software, as raw numbers or objects with `slots`
     *        (and an optional `name` for the trace).
     * @param {object}  [options]
     * @param {boolean} [options.unlimited] - Supercomputer: no slot ceiling.
     *
     * @returns {{
     *   max:           number,
     *   used:          number,
     *   remaining:     number,
     *   isFull:        boolean,
     *   isOverloaded:  boolean,
     *   isUnlimited:   boolean,
     *   programCount:  number,
     *   modifierTrace: object[]
     * }}
     */
    calculateActiveMemory(activeMemory, loadedPrograms = [], options = {}) {
        if (typeof activeMemory !== 'number' || !isFinite(activeMemory) || activeMemory < 0) {
            throw new Error(
                '[AlternityMathService.calculateActiveMemory] activeMemory must be a finite number ≥ 0.'
            );
        }
        if (!Array.isArray(loadedPrograms)) {
            throw new Error(
                '[AlternityMathService.calculateActiveMemory] loadedPrograms must be an array.'
            );
        }

        const isUnlimited = !!options.unlimited;
        const max = Math.floor(activeMemory);

        const modifierTrace = [
            this.buildModifier('Processor', max, 'Active memory slots'),
        ];

        let used = 0;
        for (const entry of loadedPrograms) {
            const slots = typeof entry === 'number' ? entry : (entry?.slots ?? 0);
            if (typeof slots !== 'number' || !isFinite(slots) || slots < 0) {
                throw new Error(
                    '[AlternityMathService.calculateActiveMemory] every program slot count must be a finite number ≥ 0.'
                );
            }
            used += slots;
            const label = typeof entry === 'number' ? 'Program' : (entry?.name || 'Program');
            modifierTrace.push(this.buildModifier(label, slots, 'Active memory consumed'));
        }

        return {
            max,
            used,
            // A supercomputer never runs out, so `remaining` would be meaningless —
            // report Infinity rather than a number that invites a false comparison.
            remaining: isUnlimited ? Infinity : Math.max(0, max - used),
            isFull:       isUnlimited ? false : used >= max,
            isOverloaded: isUnlimited ? false : used > max,
            isUnlimited,
            programCount: loadedPrograms.length,
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
     *   4 or less: -2   5-6: -1   7-10: 0   11-12: +1
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
        if (abilityScore >= 7)  return 0;
        if (abilityScore >= 5)  return -1;
        return -2;
    },

    // -----------------------------------------------------------------------
    // calculateStrengthDamageAdjustment
    // -----------------------------------------------------------------------

    /**
     * Look up the damage adjustment a Strength score grants (Player's Handbook
     * Table P9: Strength & Damage).
     *
     *   3-6: -1   7-10: 0   11-12: +1   13-14: +2
     *   15-16: +3   17-18: +4   19+: +5
     *
     * Per the Player's Handbook (Ch.2, "Strength"), this applies to damage from an
     * unarmed attack, a melee weapon or a thrown weapon — never to ranged or heavy
     * weapons. The book caps the benefit at +5, and the table's footnote caps the -1
     * penalty "to a minimum of 1", which callers must enforce on the rolled result
     * (AlternityItem.rollDamage does).
     *
     * The table's lowest printed band starts at 3; scores below that keep the -1,
     * since the book offers nothing lower and the minimum-1 rule bounds the result
     * anyway.
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
        if (strengthScore >= 7)  return 0;
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

    // -----------------------------------------------------------------------
    // calculateCompartmentRatings
    // -----------------------------------------------------------------------

    /**
     * Derive a spaceship compartment's three damage ratings from its durability
     * (GM Guide Ch.11, "Compartment Damage"):
     *
     *   "A compartment's mortal rating is the same as its number of durability
     *    points, and its stun and wound ratings are twice that number."
     *
     * This is why every published statblock prints compartments as `8/8/4`,
     * `16/16/8`, `6/6/3` — a single durability number expanded three ways. The
     * sheet therefore stores only the durability and derives the rest, so a
     * transcription slip like the system liner's OCR'd "C8 = Cargo 4/8/2" can't
     * be entered at all.
     *
     * @param {number} durability - The compartment's durability points.
     * @returns {{
     *   durability:    number,
     *   stun:          number,
     *   wound:         number,
     *   mortal:        number,
     *   isOversized:   boolean,  // over the book's 10-point per-compartment cap
     *   modifierTrace: object[],
     * }}
     */
    calculateCompartmentRatings(durability) {
        const dur = Math.max(0, Math.floor(Number(durability) || 0));

        const modifierTrace = [
            this.buildModifier('Durability', dur, `Compartment durability: ${dur}`),
            this.buildModifier('Mortal Rating', dur, 'Mortal rating equals durability'),
            this.buildModifier('Stun/Wound Rating', dur * 2, 'Stun and wound ratings are twice durability'),
        ];

        return {
            durability:  dur,
            stun:        dur * 2,
            wound:       dur * 2,
            mortal:      dur,
            // "No compartment can contain more than 10 durability points, unless the
            // Gamemaster is designing an extraordinary alien vessel." Flagged, not blocked.
            isOversized: dur > MAX_COMPARTMENT_DURABILITY,
            modifierTrace,
        };
    },

    // -----------------------------------------------------------------------
    // calculateCompartmentStatus
    // -----------------------------------------------------------------------

    /**
     * Resolve a compartment's current condition from its durability and the damage
     * recorded against it (GM Guide Ch.11, "Compartment Damage").
     *
     * Penalties to every system housed in the compartment, all cumulative:
     *   - stun damage exceeding *half* the stun rating  -> +1
     *   - wound damage exceeding *half* the wound rating -> +1
     *   - +1 for each point of mortal damage
     *
     * Durability checks (the roll that knocks a system, or the whole compartment,
     * off-line) use different skill scores depending on which track triggered them:
     *   - stun-triggered   : original stun rating  (2 x durability)
     *   - wound-triggered  : original wound rating (2 x durability)
     *   - mortal-triggered : original wound rating (2 x durability), then apply the
     *                        full accumulated penalty on top
     *
     * @param {number} durability - The compartment's durability points.
     * @param {object} [damage]   - Damage recorded so far: { stun, wound, mortal }.
     * @param {object} [options]
     * @param {number} [options.damageControlBonus=0] - Damage-control system bonus
     *        (a *negative* step value: Ordinary -1 / Good -2 / Amazing -3).
     *
     * @returns {{
     *   ratings:              { stun: number, wound: number, mortal: number },
     *   damage:               { stun: number, wound: number, mortal: number },
     *   remaining:            { stun: number, wound: number, mortal: number },
     *   isStunImpaired:       boolean,
     *   isWoundImpaired:      boolean,
     *   isDestroyed:          boolean,
     *   systemPenalty:        number,
     *   durabilityCheckScore: number,
     *   mortalCheckStep:      number,
     *   modifierTrace:        object[],
     * }}
     */
    calculateCompartmentStatus(durability, damage = {}, options = {}) {
        const ratings = this.calculateCompartmentRatings(durability);
        const { damageControlBonus = 0 } = options;

        const taken = {
            stun:   Math.max(0, Math.floor(Number(damage.stun)   || 0)),
            wound:  Math.max(0, Math.floor(Number(damage.wound)  || 0)),
            mortal: Math.max(0, Math.floor(Number(damage.mortal) || 0)),
        };

        const modifierTrace = [];

        // "more than half" — strictly greater, so a compartment sitting exactly on
        // half its stun rating is not yet impaired.
        const isStunImpaired  = ratings.stun  > 0 && taken.stun  > ratings.stun  / 2;
        const isWoundImpaired = ratings.wound > 0 && taken.wound > ratings.wound / 2;

        let systemPenalty = 0;
        if (isStunImpaired) {
            systemPenalty += 1;
            modifierTrace.push(this.buildModifier(
                'Stun Damage', 1,
                `${taken.stun} of ${ratings.stun} stun — over half the stun rating`
            ));
        }
        if (isWoundImpaired) {
            systemPenalty += 1;
            modifierTrace.push(this.buildModifier(
                'Wound Damage', 1,
                `${taken.wound} of ${ratings.wound} wound — over half the wound rating`
            ));
        }
        if (taken.mortal > 0) {
            systemPenalty += taken.mortal;
            modifierTrace.push(this.buildModifier(
                'Mortal Damage', taken.mortal,
                `+1 per mortal point (${taken.mortal})`
            ));
        }
        if (damageControlBonus !== 0) {
            modifierTrace.push(this.buildModifier(
                'Damage Control', damageControlBonus,
                'Damage-control system bonus to durability checks'
            ));
        }

        return {
            ratings: { stun: ratings.stun, wound: ratings.wound, mortal: ratings.mortal },
            damage:  taken,
            remaining: {
                stun:   Math.max(0, ratings.stun   - taken.stun),
                wound:  Math.max(0, ratings.wound  - taken.wound),
                mortal: Math.max(0, ratings.mortal - taken.mortal),
            },
            isStunImpaired,
            isWoundImpaired,
            // "When a compartment is completely wrecked (all mortal points gone),
            // it ceases to exist on the ship record form."
            isDestroyed: ratings.mortal > 0 && taken.mortal >= ratings.mortal,
            systemPenalty,
            // Both the stun and wound durability checks use twice durability, so one
            // number covers them; the mortal check adds the accumulated penalty.
            durabilityCheckScore: ratings.stun,
            mortalCheckStep: systemPenalty + damageControlBonus,
            modifierTrace,
        };
    },

    // -----------------------------------------------------------------------
    // calculateSecondaryDamage
    // -----------------------------------------------------------------------

    /**
     * Resolve the secondary damage a compartment suffers alongside a primary hit
     * (GM Guide Ch.11, "Wound Damage" / "Mortal Damage"):
     *
     *   - every 2 points of wound  -> 1 point of secondary stun
     *   - every 2 points of mortal -> 1 point of secondary stun AND 1 of secondary wound
     *
     * "Secondary damage is calculated before armor absorbs primary damage. Armor
     * has no effect on secondary damage" — so callers must run this against the
     * *unarmored* roll and add the result on top of whatever armor lets through.
     *
     * @param {string} grade  - 'stun' | 'wound' | 'mortal'.
     * @param {number} amount - Primary damage points of that grade, before armor.
     * @returns {{ stun: number, wound: number, modifierTrace: object[] }}
     */
    calculateSecondaryDamage(grade, amount) {
        if (!COMPARTMENT_DAMAGE_GRADES.includes(grade)) {
            throw new Error(
                `[AlternityMathService.calculateSecondaryDamage] grade must be one of ` +
                `${COMPARTMENT_DAMAGE_GRADES.join(', ')}. Received "${grade}".`
            );
        }
        const points = Math.max(0, Math.floor(Number(amount) || 0));
        const half = Math.floor(points / 2);
        const modifierTrace = [];
        let stun = 0;
        let wound = 0;

        if (grade === 'wound' && half > 0) {
            stun = half;
            modifierTrace.push(this.buildModifier(
                'Secondary Stun', half, `${points} wound -> ${half} stun (1 per 2 wound)`
            ));
        } else if (grade === 'mortal' && half > 0) {
            stun = half;
            wound = half;
            modifierTrace.push(this.buildModifier(
                'Secondary Stun', half, `${points} mortal -> ${half} stun (1 per 2 mortal)`
            ));
            modifierTrace.push(this.buildModifier(
                'Secondary Wound', half, `${points} mortal -> ${half} wound (1 per 2 mortal)`
            ));
        }

        return { stun, wound, modifierTrace };
    },

    // -----------------------------------------------------------------------
    // calculateFirepowerDegrade
    // -----------------------------------------------------------------------

    /**
     * Degrade a damage grade for a firepower-versus-toughness mismatch on the
     * Marginal/Ordinary/Good/Amazing ladder (GM Guide Ch.11, "Damage").
     *
     * Distinct from `calculateFirepowerShift`, which runs the *Warships* supplement's
     * SmallCraft..SuperHeavy ladder. The two rules systems are not interchangeable:
     * this one only degrades (it never upgrades), and it is the one that applies to
     * core-rules spaceships, vehicles and personal targets.
     *
     * Every spaceship has Amazing toughness, so against a ship a Good-firepower
     * weapon degrades once (mortal -> wound -> stun, stun ignored) and an Ordinary
     * one degrades twice (mortal -> stun, wound and stun ignored).
     *
     * @param {string} damageGrade - 'stun' | 'wound' | 'mortal'.
     * @param {string} firepower   - 'Marginal' | 'Ordinary' | 'Good' | 'Amazing'.
     * @param {string} [toughness='Amazing'] - Target's toughness on the same ladder.
     * @returns {{
     *   finalGrade:    string,   // 'stun' | 'wound' | 'mortal' | 'none'
     *   steps:         number,   // how many grades the damage dropped
     *   isNegated:     boolean,
     *   modifierTrace: object[],
     * }}
     */
    calculateFirepowerDegrade(damageGrade, firepower, toughness = SPACESHIP_TOUGHNESS) {
        const gradeIndex = COMPARTMENT_DAMAGE_GRADES.indexOf(damageGrade);
        if (gradeIndex === -1) {
            throw new Error(
                `[AlternityMathService.calculateFirepowerDegrade] damageGrade must be one of ` +
                `${COMPARTMENT_DAMAGE_GRADES.join(', ')}. Received "${damageGrade}".`
            );
        }
        const firepowerRank = FIREPOWER_CLASSES.indexOf(firepower);
        if (firepowerRank === -1) {
            throw new Error(
                `[AlternityMathService.calculateFirepowerDegrade] firepower must be one of ` +
                `${FIREPOWER_CLASSES.join(', ')}. Received "${firepower}".`
            );
        }
        const toughnessRank = FIREPOWER_CLASSES.indexOf(toughness);
        if (toughnessRank === -1) {
            throw new Error(
                `[AlternityMathService.calculateFirepowerDegrade] toughness must be one of ` +
                `${FIREPOWER_CLASSES.join(', ')}. Received "${toughness}".`
            );
        }

        // Only a shortfall matters — exceeding the target's toughness confers no bonus
        // under the core rules (that upgrade behaviour belongs to the Warships system).
        const steps = Math.max(0, toughnessRank - firepowerRank);
        const finalIndex = gradeIndex - steps;
        const finalGrade = finalIndex < 0 ? 'none' : COMPARTMENT_DAMAGE_GRADES[finalIndex];

        const modifierTrace = [
            this.buildModifier('Base Grade', 0, `Starting grade: ${damageGrade}`),
            this.buildModifier(
                'Firepower vs Toughness', steps,
                steps === 0
                    ? `${firepower} firepower vs ${toughness} toughness — no degrade`
                    : `${firepower} firepower vs ${toughness} toughness — degrades ${steps} grade${steps === 1 ? '' : 's'}`
            ),
        ];

        return { finalGrade, steps, isNegated: finalGrade === 'none', modifierTrace };
    },

    // -----------------------------------------------------------------------
    // calculateCompartmentHitTable
    // -----------------------------------------------------------------------

    /**
     * Produce the d20 hit-location ranges for a ship of `count` compartments
     * (GM Guide Table G50: Compartment Hit Location).
     *
     * Table G50 itself is unrecoverable from the source scan — the whole grid
     * OCR'd into a single column of noise. What *is* recoverable is the table's
     * output: every published statblock prints its own "Random damage" line, and
     * the ranges for 1, 2, 4, 6, 8 and 10 compartments are reproduced verbatim
     * across the PHB Ch.12 stock ships. Those six columns are transcribed here.
     *
     * The ranges are deliberately asymmetrical — low-numbered compartments are
     * buried deep in the hull and are hit far less often than the outer ones,
     * which is why designers put cargo holds at the high numbers.
     *
     * For compartment counts with no printed example, a monotone-increasing
     * distribution is generated and flagged `isDerived` so the sheet can say so
     * rather than passing a guess off as the printed table.
     *
     * @param {number} count - Number of compartments (1..20).
     * @returns {{
     *   ranges:    Array<{ compartment: number, low: number, high: number }>,
     *   isDerived: boolean,
     *   source:    string,
     * }}
     */
    calculateCompartmentHitTable(count) {
        const n = Math.max(1, Math.floor(Number(count) || 1));

        const widthsToRanges = (widths) => {
            let cursor = 1;
            return widths.map((width, i) => {
                const low = cursor;
                const high = cursor + width - 1;
                cursor = high + 1;
                return { compartment: i + 1, low, high };
            });
        };

        const printed = PRINTED_COMPARTMENT_HIT_WIDTHS[n];
        if (printed) {
            return {
                ranges:    widthsToRanges(printed),
                isDerived: false,
                source:    'Table G50 (as printed in the Player\'s Handbook stock statblocks)',
            };
        }

        // No printed column for this compartment count. Approximate the table's
        // shape: weight each compartment by its position so the outermost take the
        // widest bands, then hand out the leftover pips by largest remainder.
        const totalWeight = (n * (n + 1)) / 2;
        const exact = Array.from({ length: n }, (_, i) => (DIE_FACES * (i + 1)) / totalWeight);
        const widths = exact.map((v) => Math.max(1, Math.floor(v)));
        let leftover = DIE_FACES - widths.reduce((sum, w) => sum + w, 0);

        const byRemainder = exact
            .map((v, i) => ({ i, remainder: v - Math.floor(v) }))
            .sort((a, b) => b.remainder - a.remainder || b.i - a.i);

        let cursor = 0;
        while (leftover > 0 && byRemainder.length > 0) {
            widths[byRemainder[cursor % byRemainder.length].i] += 1;
            leftover -= 1;
            cursor += 1;
        }
        // A count above 20 cannot fit one face each; the surplus compartments get
        // an empty range (low > high) rather than silently stealing another's band.
        while (leftover < 0) {
            const last = widths.findLastIndex((w) => w > 0);
            if (last === -1) break;
            widths[last] -= 1;
            leftover += 1;
        }
        widths.sort((a, b) => a - b);

        return {
            ranges:    widthsToRanges(widths),
            isDerived: true,
            source:    `Generated — Table G50 has no printed column for ${n} compartments`,
        };
    },

    // -----------------------------------------------------------------------
    // resolveCompartmentHit
    // -----------------------------------------------------------------------

    /**
     * Turn a d20 hit-location roll into the compartment that actually takes the
     * damage (GM Guide Ch.11, "Damage" and "Mortal Damage").
     *
     * Two rules combine here:
     *   1. The sensors operator may shift the roll by +1/+2/+3 on an
     *      Ordinary/Good/Amazing System Operation-sensors check.
     *   2. "When a compartment is completely wrecked ... all damage that strikes
     *      that location automatically is applied to the next lower-numbered
     *      compartment. If necessary, wrap around to the highest-numbered
     *      compartment if the lowest is destroyed."
     *
     * @param {Array<{ hitLow: number, hitHigh: number, isDestroyed?: boolean }>} compartments
     *        Compartments in ship order (index 0 = C1).
     * @param {number} roll - The raw d20 result.
     * @param {object} [options]
     * @param {number} [options.sensorShift=0] - Sensor adjustment applied to the roll.
     *
     * @returns {{
     *   roll:            number,
     *   adjustedRoll:    number,
     *   struckIndex:     number,   // index originally indicated, -1 if none matched
     *   resolvedIndex:   number,   // index after walking past destroyed compartments, -1 if all destroyed
     *   walkedPast:      number[], // indices skipped because they were already wrecked
     *   allDestroyed:    boolean,
     *   modifierTrace:   object[],
     * }}
     */
    resolveCompartmentHit(compartments, roll, options = {}) {
        const { sensorShift = 0 } = options;
        const list = Array.isArray(compartments) ? compartments : [];
        const modifierTrace = [
            this.buildModifier('Hit Location Roll', Number(roll) || 0, `d20 result: ${roll}`),
        ];

        // The sensors operator "can adjust the d20 compartment roll" — the book lets
        // the player pick any value within the shift, so clamping to the die keeps
        // the result on the table.
        const adjustedRoll = Math.min(
            DIE_FACES,
            Math.max(1, (Number(roll) || 0) + (Number(sensorShift) || 0))
        );
        if (sensorShift) {
            modifierTrace.push(this.buildModifier(
                'Sensor Targeting', sensorShift,
                `System Operation-sensors shifts the roll to ${adjustedRoll}`
            ));
        }

        const struckIndex = list.findIndex(
            (c) => adjustedRoll >= (c?.hitLow ?? 0) && adjustedRoll <= (c?.hitHigh ?? -1)
        );

        if (struckIndex === -1) {
            return {
                roll: Number(roll) || 0, adjustedRoll,
                struckIndex: -1, resolvedIndex: -1,
                walkedPast: [], allDestroyed: false, modifierTrace,
            };
        }

        // Walk down to the next lower-numbered surviving compartment, wrapping to the
        // highest. Bounded by the compartment count so an all-wrecked ship terminates.
        const walkedPast = [];
        let index = struckIndex;
        for (let steps = 0; steps < list.length; steps++) {
            if (!list[index]?.isDestroyed) {
                if (walkedPast.length) {
                    modifierTrace.push(this.buildModifier(
                        'Wrecked Compartments', walkedPast.length,
                        `Damage rolled down past ${walkedPast.map((i) => `C${i + 1}`).join(', ')}`
                    ));
                }
                return {
                    roll: Number(roll) || 0, adjustedRoll,
                    struckIndex, resolvedIndex: index,
                    walkedPast, allDestroyed: false, modifierTrace,
                };
            }
            walkedPast.push(index);
            index = index === 0 ? list.length - 1 : index - 1;
        }

        return {
            roll: Number(roll) || 0, adjustedRoll,
            struckIndex, resolvedIndex: -1,
            walkedPast, allDestroyed: true, modifierTrace,
        };
    },

    // -----------------------------------------------------------------------
    // calculateArmorDurabilityCost
    // -----------------------------------------------------------------------

    /**
     * Durability the ship gives up to carry its armor (GM Guide Ch.11, "Armor"):
     * light armor is free, moderate costs 10% of total durability and heavy 20%,
     * each rounded down. "This durability cost is subtracted from the ship's total
     * durability rather than from an individual compartment" — armor is mounted
     * over the whole hull, so it shrinks the pool the compartments are carved from.
     *
     * @param {number} totalDurability - The hull's full durability rating.
     * @param {string} grade           - 'None' | 'Light' | 'Moderate' | 'Heavy'.
     * @returns {{ cost: number, available: number, modifierTrace: object[] }}
     */
    calculateArmorDurabilityCost(totalDurability, grade) {
        const total = Math.max(0, Math.floor(Number(totalDurability) || 0));
        const fraction = SHIP_ARMOR_DURABILITY_FRACTION[grade] ?? 0;
        const cost = Math.floor(total * fraction);

        const modifierTrace = [
            this.buildModifier('Hull Durability', total, `Total durability: ${total}`),
            this.buildModifier(
                `${grade ?? 'None'} Armor`, cost,
                fraction === 0
                    ? 'No durability cost'
                    : `${Math.round(fraction * 100)}% of total durability, rounded down`
            ),
        ];

        return { cost, available: Math.max(0, total - cost), modifierTrace };
    },

    // -----------------------------------------------------------------------
    // calculateSupportUnitsRequired
    // -----------------------------------------------------------------------

    /**
     * How many life-support (or damage-control) units a set of compartments needs
     * (GM Guide Ch.11): each unit "provides life support to one or more compartments
     * whose durability totals 20 points or less", and damage-control systems cover
     * the same 20-point span.
     *
     * @param {number} durabilityCovered - Total durability that must be covered.
     * @returns {{ units: number, capacity: number, modifierTrace: object[] }}
     */
    calculateSupportUnitsRequired(durabilityCovered) {
        const dur = Math.max(0, Math.floor(Number(durabilityCovered) || 0));
        const units = Math.ceil(dur / SUPPORT_UNIT_DURABILITY_SPAN);
        return {
            units,
            capacity: units * SUPPORT_UNIT_DURABILITY_SPAN,
            modifierTrace: [
                this.buildModifier('Durability Covered', dur, `${dur} durability needs coverage`),
                this.buildModifier(
                    'Units Required', units,
                    `1 unit per ${SUPPORT_UNIT_DURABILITY_SPAN} durability, rounded up`
                ),
            ],
        };
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
    FIREPOWER_CLASSES,
    COMPARTMENT_DAMAGE_GRADES,
    COMPARTMENT_KINDS,
    SPACESHIP_TOUGHNESS,
    MAX_COMPARTMENT_DURABILITY,
    SHIP_ARMOR_DURABILITY_FRACTION,
};
