/**
 * @file VehicleData.js
 * @description TypeDataModel: Schema for the 'vehicle' Actor type.
 *
 * Source: Player's Handbook Ch.12 "Vehicles" (p.192), and **Table P42: Vehicles**,
 * whose forty-two rows are the whole of what the core rules stat for a conveyance.
 *
 * This schema replaced a d20-flavoured one. The fields it used to carry —
 * `hullIntegrity`, `shields`, `techPoints`, a flat `speed`, a `maneuver` bonus and a
 * `defense` number — are none of them Alternity: the game has no shields, no power
 * budget for personal-scale craft, and no armour class. `migrateData` below maps what
 * can be mapped and preserves the rest as prose rather than dropping it, the same way
 * `NpcData` retired Challenge Rating.
 *
 * ## What Table P42 actually prints, column by column
 *
 *   Skill    Which Vehicle Operation specialty drives it — land, water, air or space.
 *            Three rows (bicycle, ultralight, jetpack) print `Daredevil`, which is
 *            *Acrobatics*-daredevil, not a Vehicle Operation specialty at all. Two
 *            rows (reentry capsule, escape pod) print nothing: they are not steered.
 *   Drv      A **step modifier** on the operator's Vehicle Operation checks, in this
 *            system's usual sign convention — positive is a penalty. The raft is the
 *            worst at +2 and the sports car the best at -2. The book confirms the
 *            reading by calling the skycar's negative number a "Drv bonus" (p.196).
 *   Acc /    Acceleration, cruising speed and maximum speed. Kept as printed strings
 *   Cruise / because the column mixes three unit systems — kph for everything that
 *   Max      moves in an atmosphere, Megameters per phase per phase and AU per hour
 *            for the spacecraft — and nothing in the rules does arithmetic on them.
 *            What the rules do use is the comparison: "+1 if cruising speed is
 *            exceeded, or +3 if the vehicle is pushed all the way to its maximum
 *            speed" (p.201).
 *   Type     The **toughness grade**: Ordinary, Good or Amazing. Not a vehicle "type"
 *            in the classification sense — it is why "many vehicles are targets of
 *            Good or Amazing toughness, which means that personal weapons just aren't
 *            very effective against them" (p.204).
 *   Dur      Durability, printed as stun/wound/mortal. **Three tracks, not four** — a
 *            vehicle has no fatigue rating. The eleven spacecraft rows print
 *            `Hull <size>/<compartments>` instead and are resolved by the spaceship
 *            rules; see `hull` below.
 *   Avail /  The same acquisition columns the gear tables print.
 *   Cost
 *
 * ## The three checks a vehicle is involved in
 *
 * A vehicle rolls nothing on its own initiative — it is driven, and the driver's
 * Vehicle Operation score is the driver's. But two of the three checks read numbers
 * off the vehicle, which is why they are derived here rather than on the sheet:
 *
 *   1. **Vehicle Operation** — the operator's check. The vehicle contributes `Drv`,
 *      the speed-band penalty, +1 while more than half its stun points are gone, and
 *      +1 for every point of mortal damage it has taken (p.203). `controlModifiers`.
 *   2. **Durability check** — the *vehicle's* own check, and the only roll that is
 *      genuinely its. "A vehicle's skill score for this check is equal to its original
 *      stun point total, so a mid-sized car with 10 stun points needs a 10 or less to
 *      pass its check" — and the wound total for the check that mortal damage forces.
 *      Critical Failure on the mortal-damage version blows the vehicle up.
 *   3. **Crash / ram damage** — resolved off Table P43 against the *victim*, so it
 *      belongs to whoever was hit, not here.
 *
 * ## What is deliberately absent
 *
 * No fatigue track (vehicles do not tire). No resistance modifier: Ch.12 gives a
 * vehicle none, and the only defence it has against being hit is its toughness grade
 * and the operator's manoeuvring. No prevailing-conditions field — the four
 * conditions (clear / normal / crowded / hazardous) are named on p.201 but their step
 * modifiers live in a table that is an image in every scan, so they go through the
 * Gamemaster's circumstance picker on the roll panel like any other unsourced call.
 */

import {
    AlternityMathService,
    DAMAGE_TYPES,
    FIREPOWER_CLASSES,
    PERSONAL_TOUGHNESS_CLASSES,
    DEFAULT_PERSONAL_TOUGHNESS,
} from '../services/alternity-math.js';

const { fields } = foundry.data;

export { DAMAGE_TYPES, FIREPOWER_CLASSES, PERSONAL_TOUGHNESS_CLASSES };

/**
 * The Skill column of Table P42, as printed.
 *
 * `Daredevil` is Acrobatics-daredevil and `None` is the blank the two unpowered
 * capsules print — neither is a Vehicle Operation specialty, and both are here
 * because the table says so.
 */
export const VEHICLE_OPERATION_SKILLS = Object.freeze([
    'Land vehicle', 'Water vehicle', 'Air vehicle', 'Space vehicle', 'Daredevil', 'None',
]);

/** Vehicle Operation specialty → the `SKILL_DEFINITIONS` id an operator is rolled on. */
export const VEHICLE_SKILL_IDS = Object.freeze({
    'Land vehicle':  'dex-land',
    'Water vehicle': 'dex-water',
    'Air vehicle':   'dex-air',
    'Space vehicle': 'dex-space',
    'Daredevil':     'dex-daredevil',
    'None':          null,
});

/**
 * Table P45's four scales, which decide how many rounds of combat two vehicles of
 * unequal class get before the faster one speeds away, and the return time on Table
 * P46. **Table P45 itself is an image in every scan available here**, so the scale is
 * an entered field with a documented default rather than something derived from the
 * Skill column — a tank and a bicycle share a skill and are plainly not the same
 * scale.
 */
export const VEHICLE_SCALES = Object.freeze(['Personal', 'Surface', 'Air', 'Space']);

/** The acquisition column, spelled the way the gear schemas already spell it. */
export const VEHICLE_AVAILABILITY = Object.freeze([
    'Any', 'Common', 'Controlled', 'Military', 'Restricted',
]);

/**
 * Where the vehicle is being pushed, and what that costs the operator. The two
 * penalties are printed verbatim on p.201; `Cruising` is the unpenalised default.
 */
export const VEHICLE_SPEED_BANDS = Object.freeze({
    'Cruising':    0,
    'Over cruise': 1,
    'Maximum':     3,
});

/** The three tracks a vehicle has. There is no fourth — vehicles do not fatigue. */
export const VEHICLE_TRACKS = Object.freeze(['stun', 'wound', 'mortal']);

/** Statuses `prepareDerivedData` can land on, worst last. */
export const VEHICLE_STATUSES = Object.freeze([
    'Operational', 'Unstable', 'Failing', 'Stalled', 'Wrecked',
]);

function ratingField(initial) {
    return new fields.NumberField({
        required: true, nullable: false, integer: true, initial, min: 0,
    });
}

function damageField() {
    return new fields.NumberField({
        required: true, nullable: false, integer: true, initial: 0, min: 0,
    });
}

export class VehicleData extends foundry.abstract.TypeDataModel {

    /** @override */
    static defineSchema() {
        return {
            // ── Classification ───────────────────────────────────────────────
            operationSkill: new fields.StringField({
                required: true, nullable: false,
                initial: 'Land vehicle', choices: VEHICLE_OPERATION_SKILLS,
            }),

            scale: new fields.StringField({
                required: true, nullable: false, initial: 'Surface', choices: VEHICLE_SCALES,
            }),

            progressLevel: new fields.NumberField({
                required: true, nullable: false, integer: true, initial: 5, min: 0, max: 9,
            }),

            // ── Handling ─────────────────────────────────────────────────────
            /**
             * The Drv column. **Positive is a penalty**, as everywhere else in this
             * codebase — the printed -2 on a sports car is the bonus.
             */
            drvModifier: new fields.NumberField({
                required: true, nullable: false, integer: true, initial: 0, min: -5, max: 5,
            }),

            // Printed strings, not numbers: the column mixes kph, Megameters per phase
            // per phase and AU per hour, and the rules only ever compare against them
            // rather than compute with them.
            acceleration: new fields.StringField({ required: false, initial: '' }),
            cruiseSpeed:  new fields.StringField({ required: false, initial: '' }),
            maxSpeed:     new fields.StringField({ required: false, initial: '' }),

            /** How hard the operator is currently pushing it. See VEHICLE_SPEED_BANDS. */
            speedBand: new fields.StringField({
                required: true, nullable: false,
                initial: 'Cruising', choices: Object.keys(VEHICLE_SPEED_BANDS),
            }),

            // ── Toughness and durability ─────────────────────────────────────
            toughness: new fields.StringField({
                required: true, nullable: false,
                initial: DEFAULT_PERSONAL_TOUGHNESS, choices: PERSONAL_TOUGHNESS_CLASSES,
            }),

            /** The printed Dur run. Transcribed, never derived — see the header. */
            durabilityRatings: new fields.SchemaField({
                stun:   ratingField(10),
                wound:  ratingField(10),
                mortal: ratingField(5),
            }),

            /** Damage taken on each track. */
            damage: new fields.SchemaField({
                stun:   damageField(),
                wound:  damageField(),
                mortal: damageField(),
            }),

            /**
             * The eleven spacecraft rows print `Hull <size>/<compartments>` in the Dur
             * column instead of a damage run, because they are resolved by the
             * spaceship rules in the back half of Ch.12 rather than the vehicle ones.
             * Zero means this is not a hull-rated craft, which is the usual case.
             */
            hull: new fields.SchemaField({
                size:         ratingField(0),
                compartments: ratingField(0),
            }),

            /**
             * Set by hand when a failed durability check stops the vehicle. The system
             * cannot infer it: running a track out only *forces* the check, it does
             * not decide it.
             */
            isConkedOut: new fields.BooleanField({ required: true, initial: false }),

            // ── Armour ───────────────────────────────────────────────────────
            // Only the armoured rows print this, and they print it as a die range per
            // damage form the same way personal armour does.
            armor: new fields.SchemaField({
                type:       new fields.StringField({ required: false, initial: '' }),
                lowImpact:  new fields.StringField({ required: false, initial: '' }),
                highImpact: new fields.StringField({ required: false, initial: '' }),
                energy:     new fields.StringField({ required: false, initial: '' }),
            }),

            // ── Crew ─────────────────────────────────────────────────────────
            // Table P42 has no crew column; the descriptions state a capacity for some
            // vehicles and not others. Zero means "not stated", not "nobody".
            crew: new fields.SchemaField({
                capacity: ratingField(0),
                current:  ratingField(0),
            }),

            // ── Mounted weapons ──────────────────────────────────────────────
            /**
             * The armed rows carry their weapons in the description text ("a 25mm
             * chain gun (2d4w/3d4w/2d4m, HI/G)"), so this is a row shape matching the
             * NPC and creature attack tables — and for the same reason: **the score is
             * the gunner's, not the vehicle's**, so it starts at 0 for a human to fill
             * in rather than being guessed at.
             */
            weapons: new fields.ArrayField(new fields.SchemaField({
                name:  new fields.StringField({ required: true, nullable: false, initial: '' }),
                score: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
                damageOrdinary: new fields.StringField({ required: false, initial: '' }),
                damageGood:     new fields.StringField({ required: false, initial: '' }),
                damageAmazing:  new fields.StringField({ required: false, initial: '' }),
                damageType: new fields.StringField({
                    required: true, nullable: false, initial: 'HI', choices: DAMAGE_TYPES,
                }),
                firepower: new fields.StringField({
                    required: true, nullable: false, initial: 'Ordinary', choices: FIREPOWER_CLASSES,
                }),
                notes: new fields.StringField({ required: false, initial: '' }),
            }), { initial: [] }),

            // ── Acquisition ──────────────────────────────────────────────────
            availability: new fields.StringField({
                required: true, nullable: false, initial: 'Any', choices: VEHICLE_AVAILABILITY,
            }),

            // A printed string ("50K", "1.2M"), the way WarshipData carries a cost.
            cost: new fields.StringField({ required: false, initial: '' }),

            // ── Free text ────────────────────────────────────────────────────
            notes:       new fields.HTMLField({ required: false, initial: '' }),
            description: new fields.HTMLField({ required: false, initial: '' }),
        };
    }

    /** @override */
    prepareDerivedData() {
        const ratings = this.durabilityRatings ?? { stun: 0, wound: 0, mortal: 0 };
        const taken = this.damage ?? { stun: 0, wound: 0, mortal: 0 };

        // ── Damage tracks ────────────────────────────────────────────────────
        this.durability = Object.fromEntries(VEHICLE_TRACKS.map((track) => [track, {
            value: taken[track] ?? 0,
            max:   ratings[track] ?? 0,
        }]));

        this.isHullRated = (this.hull?.size ?? 0) > 0;
        this.durabilityRun = this.isHullRated
            ? `Hull ${this.hull.size}/${this.hull.compartments}`
            : `${ratings.stun}/${ratings.wound}/${ratings.mortal}`;

        // "When a vehicle loses more than half of its stun points, its operator must
        // immediately make a successful Vehicle Operation check to avoid losing
        // control ... the operator must take a +1 penalty on all Vehicle Operation
        // checks" — and the same paragraph is applied again to the wound track.
        this.isStunStrained  = ratings.stun  > 0 && (taken.stun  ?? 0) > ratings.stun  / 2;
        this.isWoundStrained = ratings.wound > 0 && (taken.wound ?? 0) > ratings.wound / 2;

        // A track running out forces a durability check; it does not by itself stop
        // the vehicle, which is why `isConkedOut` is entered rather than inferred.
        this.isStunOut  = ratings.stun   > 0 && (taken.stun   ?? 0) >= ratings.stun;
        this.isWoundOut = ratings.wound  > 0 && (taken.wound  ?? 0) >= ratings.wound;
        this.isWrecked  = ratings.mortal > 0 && (taken.mortal ?? 0) >= ratings.mortal;

        // ── The operator's Vehicle Operation modifiers ───────────────────────
        const speedPenalty = VEHICLE_SPEED_BANDS[this.speedBand] ?? 0;
        this.speedPenalty = speedPenalty;

        const controlModifiers = [];
        if (this.drvModifier) {
            controlModifiers.push(AlternityMathService.buildModifier(
                'vehicle-drv', this.drvModifier, 'Drv, the handling the vehicle itself imposes (Table P42)',
            ));
        }
        if (speedPenalty) {
            controlModifiers.push(AlternityMathService.buildModifier(
                'vehicle-speed', speedPenalty, 'Pushed past cruising speed (PHB p.201)',
            ));
        }
        if (this.isStunStrained || this.isWoundStrained) {
            controlModifiers.push(AlternityMathService.buildModifier(
                'vehicle-strained', 1, 'More than half a damage track gone - the vehicle is hard to hold (PHB p.203)',
            ));
        }
        // "For each point of mortal damage a vehicle suffers, its operator receives a
        // +1 penalty to all Vehicle Operation checks."
        if ((taken.mortal ?? 0) > 0) {
            controlModifiers.push(AlternityMathService.buildModifier(
                'vehicle-mortal', taken.mortal, 'Mortal damage, +1 per point (PHB p.203)',
            ));
        }
        this.controlModifiers = controlModifiers;
        this.controlPenalty = controlModifiers.reduce((sum, mod) => sum + mod.value, 0);

        // ── The vehicle's own durability checks ──────────────────────────────
        // Skill score = the *original* rating, not what is left of it. The mortal
        // penalty is stated for the mortal-damage check; the stun-out check inherits
        // it through "don't forget to include the modifiers for excessive stun or
        // wound damage", which the Gamemaster's circumstance picker also covers.
        this.durabilityCheckModifiers = (taken.mortal ?? 0) > 0
            ? [AlternityMathService.buildModifier('vehicle-mortal', taken.mortal, 'Mortal damage, +1 per point (PHB p.203)')]
            : [];
        this.durabilityChecks = {
            stun:  AlternityMathService.calculateScoreRun(ratings.stun),
            wound: AlternityMathService.calculateScoreRun(ratings.wound),
        };

        // ── Mounted weapons ──────────────────────────────────────────────────
        // `scoreRun` is added the way the creature sheet adds it, so the row displays
        // the triple and its roll button can parse the same string back.
        this.attackRows = (this.weapons ?? []).map((row, index) => ({
            ...row,
            index,
            scoreRun: row.score > 0 ? AlternityMathService.calculateScoreRun(row.score).label : '',
        }));

        // ── Status ───────────────────────────────────────────────────────────
        if (this.isWrecked)                                   this.status = 'Wrecked';
        else if (this.isConkedOut)                            this.status = 'Stalled';
        else if (this.isStunOut || this.isWoundOut)           this.status = 'Failing';
        else if (this.isStunStrained || this.isWoundStrained) this.status = 'Unstable';
        else                                                  this.status = 'Operational';
    }

    /**
     * Migrate the d20-shaped schema this type used to carry.
     *
     * Nothing is dropped. `hullIntegrity` was documented as "equivalent to Vitality —
     * structural damage track", and Vitality was this system's old misnomer for the
     * wound track, so it becomes the wound rating; Table P42 prints stun and wound as
     * the same number on every row that has them, so stun takes the same value and
     * mortal takes half, which is the shape most of the printed runs follow. The
     * fields with no Alternity counterpart at all — shields, tech points, the size
     * category and the flat defence number — are written into the notes as prose,
     * because a reader deserves to know what the old sheet claimed.
     *
     * `maneuver` is **negated**. Its own comment read "flat bonus/penalty to piloting
     * checks", d20 sign convention, where positive helps; Drv is a step modifier where
     * positive hurts.
     *
     * @override
     */
    static migrateData(source) {
        const salvage = [];

        if (source.hullIntegrity !== undefined && source.durabilityRatings === undefined) {
            const integrity = typeof source.hullIntegrity === 'number'
                ? { value: source.hullIntegrity, max: source.hullIntegrity }
                : (source.hullIntegrity ?? {});
            const max = Number(integrity.max) || 0;
            const remaining = Number(integrity.value ?? max) || 0;
            source.durabilityRatings = { stun: max, wound: max, mortal: Math.floor(max / 2) };
            source.damage = {
                stun:   0,
                wound:  Math.max(0, Math.min(max, max - remaining)),
                mortal: 0,
            };
        }
        delete source.hullIntegrity;

        if (Number(source.shields?.max) > 0) {
            salvage.push(`Shields ${source.shields.value ?? 0}/${source.shields.max}`);
        }
        delete source.shields;

        if (Number(source.techPoints?.max) > 0) {
            salvage.push(`Tech Points ${source.techPoints.value ?? 0}/${source.techPoints.max}`);
        }
        delete source.techPoints;

        if (source.speed !== undefined) {
            if (source.cruiseSpeed === undefined) source.cruiseSpeed = String(source.speed);
            delete source.speed;
        }

        if (source.maneuver !== undefined) {
            if (source.drvModifier === undefined) source.drvModifier = -Number(source.maneuver || 0);
            delete source.maneuver;
        }

        if (source.vehicleType !== undefined) {
            if (source.operationSkill === undefined) {
                source.operationSkill = {
                    Ground: 'Land vehicle', Air:   'Air vehicle',
                    Space:  'Space vehicle', Water: 'Water vehicle',
                }[source.vehicleType] ?? 'Land vehicle';
            }
            if (source.scale === undefined) {
                source.scale = { Air: 'Air', Space: 'Space' }[source.vehicleType] ?? 'Surface';
            }
            delete source.vehicleType;
        }

        // No canon counterpart: Alternity sizes a vehicle by its scale on Table P45,
        // which is a different axis, and has no armour class at all.
        if (source.size !== undefined) {
            salvage.push(`Size category "${source.size}"`);
            delete source.size;
        }
        if (source.defense !== undefined) {
            salvage.push(`Defense ${source.defense}`);
            delete source.defense;
        }

        if (source.crewCapacity !== undefined || source.currentCrew !== undefined) {
            source.crew = source.crew ?? {
                capacity: Number(source.crewCapacity) || 0,
                current:  Number(source.currentCrew) || 0,
            };
            delete source.crewCapacity;
            delete source.currentCrew;
        }

        // Derived now, so a stored value would only go stale.
        delete source.isDisabled;

        // Guarded so re-reading an unsaved document does not stack the note.
        const marker = 'Retired from the pre-Alternity vehicle schema';
        if (salvage.length && !String(source.notes ?? '').includes(marker)) {
            source.notes = `${source.notes ?? ''}<p><em>${marker}: ${salvage.join('; ')}.</em></p>`;
        }

        return super.migrateData(source);
    }
}
