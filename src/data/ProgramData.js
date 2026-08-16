/**
 * @file ProgramData.js
 * @description TypeDataModel: Schema for the 'program' Item type.
 *
 * Covers computer software from the Player's Handbook Ch.10 (Computers) and
 * the Dataware sourcebook — operator, hacking, utility, AI and robot programs.
 *
 * The book states the universal shape outright (PHB Ch.10, "Program
 * Descriptions"): "Each program description begins with two important pieces
 * of information — the Progress Level in which the program first appears, and
 * the number of slots of active memory the program takes up when in use."
 * Everything else is per-program payload.
 *
 * Two mechanics give this type its spine:
 *
 *   1. **Active memory slots.** A computer's processor provides a fixed number
 *      of slots; a program only occupies them while loaded (`isLoaded`). This
 *      is the direct analogue of cybertech's tolerance track — see
 *      AlternityMathService.calculateActiveMemory().
 *
 *   2. **Quality drives the step modifier, and which way it points depends on
 *      the category.** Operator and hacking programs give their *user* a step
 *      bonus (Marginal none, Ordinary -1, Good -2, Amazing -3); utility
 *      programs instead impose a step *penalty on an opponent* (Marginal none,
 *      Ordinary +1, Good +2, Amazing +3). That's derived here rather than
 *      stored, so the two can never drift apart.
 *
 * Programs generally do not roll their own checks — the operator rolls their
 * own Knowledge-computer operation or Computer Science-hacking skill and
 * applies the program's modifier. A handful (virus, autogunner, guardian,
 * mail bomb) act autonomously and print their own skill score, which is what
 * `skillScore` is for.
 *
 * NOTE on source fidelity: per-program slot counts and prices live in Table
 * P37 (PHB p.161) and Table D8 (Dataware p.38), both of which are destroyed in
 * this repo's OCR of the scans. The *shape* below is taken from the prose,
 * which survived; the numbers have to be filled in per item by hand.
 */

const { fields } = foundry.data;

/** The book's own taxonomy (Dataware Ch.3 "Programs" sidebar; PHB Ch.10). */
export const PROGRAM_CATEGORIES = Object.freeze([
    'Operator',   // routine tasks, applications, operator-driven defenses
    'Hacking',    // intrusion, shadow modification, shadow combat, system attack
    'Utility',    // autonomous/conditional: automated defenses, virus, shadow form
    'Artificial Intelligence', // AI-only software (artificial shadow, brainscanner, overmind)
    'Robot',      // robot operating software
]);

/** Program quality. Note this scale starts at Marginal, unlike cybertech's. */
export const PROGRAM_QUALITIES = Object.freeze(['Marginal', 'Ordinary', 'Good', 'Amazing']);

/** Availability rating (Dataware Ch.3 "New Programs"), rated as weapons are. */
export const PROGRAM_AVAILABILITIES = Object.freeze([
    'Any', 'Common', 'Controlled', 'Military', 'Restricted',
]);

/**
 * Whether the program can run without the operator spending their one
 * program-use per phase. Printed in the Dataware entry headers as nothing at
 * all, "Can be automated", or "Must be automated".
 */
export const PROGRAM_AUTOMATION = Object.freeze(['None', 'Optional', 'Required']);

/** Magnitude of the step modifier each quality grade is worth. */
const QUALITY_STEP_MAGNITUDE = Object.freeze({
    Marginal: 0,
    Ordinary: 1,
    Good:     2,
    Amazing:  3,
});

/**
 * Fallback durability by quality, for programs that print no rating of their
 * own (PHB Ch.10, the `fortress` entry gives these as the general case).
 */
const QUALITY_DEFAULT_DURABILITY = Object.freeze({
    Marginal: { stun: 2, wound: 2, mortal: 1 },
    Ordinary: { stun: 4, wound: 4, mortal: 2 },
    Good:     { stun: 6, wound: 6, mortal: 3 },
    Amazing:  { stun: 8, wound: 8, mortal: 4 },
});

export class ProgramData extends foundry.abstract.TypeDataModel {

    /** @override */
    static defineSchema() {
        return {
            // ── Classification ───────────────────────────────────────────
            category: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'Operator',
                choices:  [...PROGRAM_CATEGORIES],
            }),

            quality: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'Ordinary',
                choices:  [...PROGRAM_QUALITIES],
            }),

            // A string, not a number: the book prints dual values ("PL 6/8")
            // and "varies" as often as it prints a plain integer.
            progressLevel: new fields.StringField({
                required: false,
                nullable: false,
                initial:  '5',
                blank:    true,
            }),

            availability: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'Any',
                choices:  [...PROGRAM_AVAILABILITIES],
            }),

            // The one-line italic function summary each entry opens with,
            // e.g. "Tags and removes an intruder from a domain."
            tagline: new fields.StringField({ required: false, initial: '' }),

            // ── Memory / cost ────────────────────────────────────────────
            // Slots of active memory consumed while loaded.
            slots: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  1,
                min:      0,
            }),

            cost: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  0,
                min:      0,
            }),

            // ── Runtime state ────────────────────────────────────────────
            // Slots are only consumed while the program is in active memory;
            // an unloaded program sits in storage, which is effectively
            // unlimited (Dataware Ch.2 "Running Programs").
            isLoaded: new fields.BooleanField({
                required: true,
                initial:  false,
            }),

            automation: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'None',
                choices:  [...PROGRAM_AUTOMATION],
            }),

            // Dataware Ch.3 "Buggy Code": a +1 step penalty on every check made
            // with it, and it locks the computer on a Critical Failure.
            isBuggy: new fields.BooleanField({
                required: true,
                initial:  false,
            }),

            // ── Tailoring (Dataware Ch.3 "Tailored Software") ────────────
            // A program cut for one specific target gains a bonus against it and
            // an equal penalty against everything else.
            tailoring: new fields.SchemaField({
                target:      new fields.StringField({ required: false, initial: '' }),
                bonusSteps:  new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
            }, { initial: { target: '', bonusSteps: 0 } }),

            // ── Payload ──────────────────────────────────────────────────
            // Attack programs print an Ordinary/Good/Amazing damage triple.
            // Free text for the same reason weapons' damage is: these are die
            // expressions with s/w/m suffixes, not numbers.
            damage: new fields.SchemaField({
                ordinary: new fields.StringField({ required: false, initial: '' }),
                good:     new fields.StringField({ required: false, initial: '' }),
                amazing:  new fields.StringField({ required: false, initial: '' }),
            }, { initial: { ordinary: '', good: '', amazing: '' } }),

            // 0 = "use the quality default" (see QUALITY_DEFAULT_DURABILITY).
            durability: new fields.SchemaField({
                stun:   new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
                wound:  new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
                mortal: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
            }, { initial: { stun: 0, wound: 0, mortal: 0 } }),

            // Autonomous programs only (virus, autogunner, guardian, mail bomb).
            // 0 means "this program has no skill score of its own" — the operator
            // rolls instead, which is the normal case.
            skillScore: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  0,
                min:      0,
            }),

            // Complex-check programs (fortress, evade) change how many successes
            // are needed rather than dealing damage.
            extraSuccesses: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  0,
                min:      0,
            }),

            // ── Prerequisites ────────────────────────────────────────────
            // e.g. "requires at least Knowledge-computer operation 8".
            requiredSkill: new fields.StringField({ required: false, initial: '' }),
            requiredRank:  new fields.NumberField({
                required: true, nullable: false, integer: true, initial: 0, min: 0,
            }),

            // e.g. "requires at least a mainframe", "needs a neural synthesizer".
            requiredHardware: new fields.StringField({ required: false, initial: '' }),

            // ── Flavour / rules text ─────────────────────────────────────
            description: new fields.HTMLField({ required: false, initial: '' }),
        };
    }

    /** @override */
    prepareDerivedData() {
        const magnitude = QUALITY_STEP_MAGNITUDE[this.quality] ?? 0;

        // ── Step modifier ────────────────────────────────────────────────
        // Utility programs are the odd ones out: their quality becomes a penalty
        // imposed on an *opposing* character rather than a bonus for their user
        // (PHB Ch.10 "Utility Programs"; Dataware repeats it verbatim).
        this.isUtility = this.category === 'Utility';

        if (this.isUtility) {
            this.userStepModifier     = 0;
            this.opponentStepPenalty  = magnitude;
        } else {
            // Negative is a bonus, per the convention used throughout this codebase.
            this.userStepModifier     = -magnitude;
            this.opponentStepPenalty  = 0;
        }

        // Buggy code costs its user a step regardless of category.
        this.effectiveUserStepModifier = this.userStepModifier + (this.isBuggy ? 1 : 0);

        const fmt = (v) => `${v > 0 ? '+' : ''}${v} step${Math.abs(v) === 1 ? '' : 's'}`;
        this.stepModifierDisplay = this.isUtility
            ? (magnitude > 0 ? `${fmt(magnitude)} to opponent` : '—')
            : (this.effectiveUserStepModifier !== 0 ? fmt(this.effectiveUserStepModifier) : '—');

        // ── Memory ───────────────────────────────────────────────────────
        this.slotsDisplay  = `${this.slots} slot${this.slots === 1 ? '' : 's'}`;
        // Only loaded programs draw on the computer's active memory.
        this.slotsInUse    = this.isLoaded ? this.slots : 0;
        this.statusLabel   = this.isLoaded ? 'Loaded' : 'Stored';

        // ── Automation ───────────────────────────────────────────────────
        this.isAutomated       = this.automation !== 'None';
        this.mustBeAutomated   = this.automation === 'Required';
        // An automated program does not consume the operator's one-program-per-phase
        // action (PHB Ch.10; Dataware Ch.2).
        this.usesOperatorAction = !this.isAutomated;

        // ── Cost / PL ────────────────────────────────────────────────────
        this.costDisplay = this.cost > 0 ? `$${this.cost}` : '—';
        this.plLabel     = this.progressLevel ? `PL ${this.progressLevel}` : '—';

        // ── Durability ───────────────────────────────────────────────────
        // Fall back to the quality default when the program prints no rating.
        const fallback = QUALITY_DEFAULT_DURABILITY[this.quality] ?? { stun: 0, wound: 0, mortal: 0 };
        this.effectiveDurability = {
            stun:   this.durability.stun   || fallback.stun,
            wound:  this.durability.wound  || fallback.wound,
            mortal: this.durability.mortal || fallback.mortal,
        };
        this.usesDefaultDurability = !(this.durability.stun || this.durability.wound || this.durability.mortal);
        this.durabilityDisplay = `${this.effectiveDurability.stun}/${this.effectiveDurability.wound}/${this.effectiveDurability.mortal}`;

        // ── Payload flags ────────────────────────────────────────────────
        this.hasDamage = !!(this.damage.ordinary || this.damage.good || this.damage.amazing);
        this.damageDisplay = this.hasDamage
            ? [this.damage.ordinary, this.damage.good, this.damage.amazing].map(d => d || '—').join(' / ')
            : '—';

        this.isAutonomous       = this.skillScore > 0;
        this.hasExtraSuccesses  = this.extraSuccesses > 0;
        this.isTailored         = !!this.tailoring.target && this.tailoring.bonusSteps > 0;
        this.tailoringDisplay   = this.isTailored
            ? `-${this.tailoring.bonusSteps} vs ${this.tailoring.target}, +${this.tailoring.bonusSteps} otherwise`
            : '—';

        // ── Prerequisites ────────────────────────────────────────────────
        const requirements = [];
        if (this.requiredSkill) {
            requirements.push(this.requiredRank > 0
                ? `${this.requiredSkill} ${this.requiredRank}`
                : this.requiredSkill);
        }
        if (this.requiredHardware) requirements.push(this.requiredHardware);
        this.hasRequirements     = requirements.length > 0;
        this.requirementsDisplay = requirements.length ? requirements.join(', ') : '—';
    }
}
