/**
 * @file SpaceshipData.js
 * @description TypeDataModel: Schema for the 'spaceship' Actor type.
 *
 * This is the **core rules** starship — GM Guide Ch.11 ("Spaceships") and Player's
 * Handbook Ch.12 ("Vehicles"). It is deliberately a different actor type from
 * `warship`, because the two books model ships in mutually incompatible ways:
 *
 *   core rules (here)   : total hull durability carved into **compartments**, each
 *                         with its own stun/wound/mortal track; a d20 hit-location
 *                         table picks which compartment eats a hit; every ship has
 *                         Amazing toughness and there is no ship-wide damage track.
 *   Warships supplement : one whole-ship hull-point pool, a ship-level
 *                         stun/wound/mortal/critical track, a per-ship toughness
 *                         class, and hit *zones* rather than compartments.
 *
 * Every published statblock — the PHB Ch.12 stock ships and every vessel in the
 * StarDrive Campaign Setting — is printed in the compartment format, so this is the
 * type that can hold a ship exactly as the book prints it.
 *
 * Like VehicleData and WarshipData, spaceships do not use AlternityCharacterState:
 * a ship has no ability scores, skills or psionics. Crew are separate Actors, linked
 * here only by name through the `stations` table.
 *
 * Data-entry design: compartment stun/wound/mortal ratings are **derived**, never
 * stored. The book prints them as `8/8/4`, but that is one number expanded three
 * ways ("a compartment's mortal rating is the same as its number of durability
 * points, and its stun and wound ratings are twice that number"), so the sheet asks
 * only for durability. What *is* stored is each compartment's d20 hit range, because
 * that comes from Table G50 — a table the source scan destroyed, and which every
 * statblock prints out longhand as its "Random damage" line.
 */

const { fields } = foundry.data;

import {
    AlternityMathService,
    COMPARTMENT_KINDS,
    FIREPOWER_CLASSES,
    SPACESHIP_TOUGHNESS,
} from '../services/alternity-math.js';

export { COMPARTMENT_KINDS, FIREPOWER_CLASSES, SPACESHIP_TOUGHNESS };

/** Hull classes named in Table G34, grouped as the book groups them. */
export const SPACESHIP_HULL_TYPES = Object.freeze({
    Civilian: Object.freeze([
        'Escape pod', 'Launch', 'Courier', 'Trader', 'Light freighter',
        'STG shuttle', 'System liner', 'Yacht', 'Transport',
    ]),
    Military: Object.freeze([
        'Fighter', 'Space fighter', 'Cutter', 'Scout',
        'Attack', 'Escort', 'Corvette',
    ]),
});

/** Armor grades and their durability cost (GM Guide Table G42). */
export const SPACESHIP_ARMOR_GRADES = Object.freeze(['None', 'Light', 'Moderate', 'Heavy']);

/** Damage-control system qualities and the bonus each gives to durability checks. */
export const DAMAGE_CONTROL_BONUS = Object.freeze({
    None:     0,
    Ordinary: -1,
    Good:     -2,
    Amazing:  -3,
});

/** FTL fittings and how long a starfall takes with each (GM Guide Ch.11). */
export const FTL_DRIVE_TYPES = Object.freeze({
    None:      { label: 'None',      starfall: '' },
    Stardrive: { label: 'Stardrive', starfall: '5 days' },
    Drivewave: { label: 'Drivewave', starfall: '11 hours' },
});

/** Crew stations named on the Ship Status Record Form. */
export const SHIP_STATIONS = Object.freeze([
    'Command', 'Helm', 'Copilot', 'Weapons', 'Defenses',
    'Sensors', 'Communications', 'Engineering', 'Damage Control',
]);

/** Categories for the generic ship-systems table (GM Guide Table G36). */
export const SHIP_SYSTEM_CATEGORIES = Object.freeze([
    'Power Plant', 'Engine', 'FTL Drive', 'Life Support', 'Sensors',
    'Communications', 'Computer', 'Crew', 'Cargo', 'Misc',
]);

/** Computer core qualities (GM Guide Ch.11, "Computer Systems"). */
export const SHIP_COMPUTER_QUALITIES = Object.freeze(['Marginal', 'Ordinary', 'Good', 'Amazing']);

/** Weapon firing arcs, matching the crosshair diagram on the Ship Design Record Form. */
export const WEAPON_ARCS = Object.freeze(['Fore', 'Aft', 'Port', 'Starboard', 'Turret', 'Fixed']);

/** Damage types shared with personal and vehicle combat. */
export const SHIP_DAMAGE_TYPES = Object.freeze(['lowImpact', 'highImpact', 'energy']);

/**
 * Fields every system line-item shares. Each records the compartment it lives in,
 * because the compartment is what takes the damage that knocks the system out.
 */
function systemLineFields(extra = {}) {
    return {
        name: new fields.StringField({ required: true, nullable: false, initial: '' }),
        // 1-based compartment number as printed ("C3"); 0 means "not yet assigned".
        compartment: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
        durabilityCost: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
        powerReq: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
        isOffline: new fields.BooleanField({ required: true, initial: false }),
        notes: new fields.StringField({ required: false, initial: '' }),
        ...extra,
    };
}

export class SpaceshipData extends foundry.abstract.TypeDataModel {

    /** @override */
    static defineSchema() {
        return {
            // ── Identity ─────────────────────────────────────────────────────
            hullType: new fields.StringField({ required: true, nullable: false, initial: 'Trader' }),

            hullCategory: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'Civilian',
                choices:  ['Civilian', 'Military'],
            }),

            // "Hull size 24" on the PHB statblocks, "Dur: 24" on the StarDrive ones —
            // the same number, and the pool the compartments are carved out of.
            hullSize: new fields.NumberField({
                required: true, nullable: false, integer: true, initial: 24, min: 0,
            }),

            // Table G34's "Comp" column: the *maximum* number of compartments this
            // hull may be divided among. "A ship may have fewer compartments than
            // this number, but not more."
            compartmentLimit: new fields.NumberField({
                required: true, nullable: false, integer: true, initial: 6, min: 1,
            }),

            progressLevel: new fields.NumberField({
                required: true, nullable: false, integer: true, initial: 7, min: 0, max: 9,
            }),

            cost: new fields.StringField({ required: false, initial: '' }),

            // ── Movement ─────────────────────────────────────────────────────
            // Maneuver rating, acceleration and cruising speed all come off Tables
            // G38 and G39, both of which OCR'd into unusable noise. They are entered
            // as printed rather than derived — which is also how every statblock
            // presents them, so nothing is lost in practice.
            maneuverRating: new fields.NumberField({
                required: true, nullable: false, integer: true, initial: 0, min: -3, max: 3,
            }),

            // Megameters per phase. Values as small as 0.001 are printed, so this
            // cannot be an integer field.
            acceleration: new fields.NumberField({
                required: true, nullable: false, integer: false, initial: 0, min: 0,
            }),

            // AU per hour.
            cruisingSpeed: new fields.NumberField({
                required: true, nullable: false, integer: false, initial: 0, min: 0,
            }),

            engineType: new fields.StringField({ required: false, initial: '' }),

            // Movement points the engines generate — the input to Table G38.
            movementPoints: new fields.NumberField({
                required: true, nullable: false, integer: true, initial: 0, min: 0,
            }),

            // ── FTL ──────────────────────────────────────────────────────────
            ftl: new fields.SchemaField({
                driveType: new fields.StringField({
                    required: true, nullable: false, initial: 'None',
                    choices: Object.keys(FTL_DRIVE_TYPES),
                }),
                // Light-years per starfall — the "Drivespace: 5" line.
                drivespace: new fields.NumberField({
                    required: true, nullable: false, integer: false, initial: 0, min: 0,
                }),
            }),

            // ── Power budget ─────────────────────────────────────────────────
            power: new fields.SchemaField({
                generated: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
                allocated: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
                plantText: new fields.StringField({ required: false, initial: '' }),
            }),

            // ── Crew ─────────────────────────────────────────────────────────
            berthing: new fields.NumberField({
                required: true, nullable: false, integer: true, initial: 0, min: 0,
            }),
            crewAboard: new fields.NumberField({
                required: true, nullable: false, integer: true, initial: 0, min: 0,
            }),

            // ── Armor (mounted over the whole ship, never per compartment) ────
            armor: new fields.SchemaField({
                grade: new fields.StringField({
                    required: true, nullable: false, initial: 'None', choices: SPACESHIP_ARMOR_GRADES,
                }),
                material:   new fields.StringField({ required: false, initial: '' }),
                lowImpact:  new fields.StringField({ required: false, initial: '' }),
                highImpact: new fields.StringField({ required: false, initial: '' }),
                energy:     new fields.StringField({ required: false, initial: '' }),
            }),

            // ── Computer ─────────────────────────────────────────────────────
            // "All spaceships automatically include a Marginal computer core in the
            // ship's command compartment, at no durability cost."
            computer: new fields.SchemaField({
                coreQuality: new fields.StringField({
                    required: true, nullable: false, initial: 'Marginal', choices: SHIP_COMPUTER_QUALITIES,
                }),
                dedicatedText: new fields.StringField({ required: false, initial: '' }),
            }),

            // ── Compartments — the heart of the model ────────────────────────
            compartments: new fields.ArrayField(new fields.SchemaField({
                label: new fields.StringField({ required: true, nullable: false, initial: '' }),
                kind: new fields.StringField({
                    required: true, nullable: false, initial: 'Cargo', choices: COMPARTMENT_KINDS,
                }),
                // The one number that drives all three ratings.
                durability: new fields.NumberField({
                    required: true, nullable: false, integer: true, initial: 4, min: 0, max: 40,
                }),
                // Damage counts *up* from zero, matching the record sheet's boxes.
                damage: new fields.SchemaField({
                    stun:   new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
                    wound:  new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
                    mortal: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
                }),
                // The statblock's "Random damage" line, one band per compartment.
                hitLow:  new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0, max: 20 }),
                hitHigh: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0, max: 20 }),

                hasLifeSupport: new fields.BooleanField({ required: true, initial: true }),
                damageControl: new fields.StringField({
                    required: true, nullable: false, initial: 'None',
                    choices: Object.keys(DAMAGE_CONTROL_BONUS),
                }),
                systemsText: new fields.StringField({ required: false, initial: '' }),
            }), { initial: [] }),

            // ── Weapons ──────────────────────────────────────────────────────
            weapons: new fields.ArrayField(new fields.SchemaField(systemLineFields({
                arc: new fields.StringField({
                    required: true, nullable: false, initial: 'Fore', choices: WEAPON_ARCS,
                }),
                // Printed as "Range 5/10/15 Mm" — kept as one string because the
                // statblocks vary the unit (Mm, km) and sometimes omit a band.
                range: new fields.StringField({ required: false, initial: '' }),
                // "d6+2s/d6+1w/d6+3w" — Ordinary / Good / Amazing damage.
                damageOrdinary: new fields.StringField({ required: false, initial: '' }),
                damageGood:     new fields.StringField({ required: false, initial: '' }),
                damageAmazing:  new fields.StringField({ required: false, initial: '' }),
                damageType: new fields.StringField({
                    required: true, nullable: false, initial: 'lowImpact', choices: SHIP_DAMAGE_TYPES,
                }),
                // The "/A" in "LI/A". Drives how much the damage degrades against a
                // target's toughness — and every spaceship is Amazing toughness.
                firepower: new fields.StringField({
                    required: true, nullable: false, initial: 'Amazing', choices: FIREPOWER_CLASSES,
                }),
                actionsPerRound: new fields.NumberField({
                    required: true, nullable: false, integer: true, initial: 1, min: 0,
                }),
            })), { initial: [] }),

            // ── Defenses ─────────────────────────────────────────────────────
            defenses: new fields.ArrayField(new fields.SchemaField(systemLineFields({
                // Active defenses need an operator to spend an action; passive ones don't.
                isActive: new fields.BooleanField({ required: true, initial: false }),
                effectText: new fields.StringField({ required: false, initial: '' }),
            })), { initial: [] }),

            // ── Everything else that occupies durability ─────────────────────
            systems: new fields.ArrayField(new fields.SchemaField(systemLineFields({
                category: new fields.StringField({
                    required: true, nullable: false, initial: 'Misc', choices: SHIP_SYSTEM_CATEGORIES,
                }),
                range: new fields.StringField({ required: false, initial: '' }),
            })), { initial: [] }),

            // ── Command crew (top half of the Ship Status Record Form) ────────
            stations: new fields.ArrayField(new fields.SchemaField({
                role: new fields.StringField({
                    required: true, nullable: false, initial: 'Helm', choices: SHIP_STATIONS,
                }),
                compartment: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
                crewName:  new fields.StringField({ required: false, initial: '' }),
                skillName: new fields.StringField({ required: false, initial: '' }),
                // The Ordinary/Good/Amazing triple, transcribed as printed ("9/4/2").
                skillScore: new fields.StringField({ required: false, initial: '' }),
            }), { initial: [] }),

            // ── Notes ────────────────────────────────────────────────────────
            notes: new fields.HTMLField({ required: false, initial: '' }),
            description: new fields.HTMLField({ required: false, initial: '' }),
        };
    }

    /** @override */
    prepareDerivedData() {
        // Toughness is not a field: the GM Guide states flatly that "all spaceships
        // have Amazing toughness". Exposed so the sheet can show it and explain why
        // a pistol can't scratch the hull.
        this.toughness = SPACESHIP_TOUGHNESS;

        const compartments = this.compartments ?? [];

        // ── Per-compartment condition ────────────────────────────────────────
        let totalDurability = 0;
        let lifeSupportedDurability = 0;
        let destroyedCount = 0;
        let totalMortalDamage = 0;

        this.compartmentDetails = compartments.map((c, index) => {
            const status = AlternityMathService.calculateCompartmentStatus(
                c.durability,
                c.damage,
                { damageControlBonus: DAMAGE_CONTROL_BONUS[c.damageControl] ?? 0 }
            );

            totalDurability += status.ratings.mortal;
            totalMortalDamage += Math.min(status.damage.mortal, status.ratings.mortal);
            if (c.hasLifeSupport) lifeSupportedDurability += status.ratings.mortal;
            if (status.isDestroyed) destroyedCount += 1;

            return {
                ...c,
                index,
                number: index + 1,
                ratings:  status.ratings,
                remaining: status.remaining,
                isStunImpaired:  status.isStunImpaired,
                isWoundImpaired: status.isWoundImpaired,
                isDestroyed:     status.isDestroyed,
                systemPenalty:   status.systemPenalty,
                durabilityCheckScore: status.durabilityCheckScore,
                mortalCheckStep: status.mortalCheckStep,
                isOversized: c.durability > 10,
                hasHitRange: c.hitHigh >= c.hitLow && c.hitLow > 0,
                stunPct:   this._damagePct(c.damage?.stun,   status.ratings.stun),
                woundPct:  this._damagePct(c.damage?.wound,  status.ratings.wound),
                mortalPct: this._damagePct(c.damage?.mortal, status.ratings.mortal),
            };
        });

        this.compartmentCount = compartments.length;
        this.totalDurability  = totalDurability;
        this.destroyedCompartments = destroyedCount;

        // Display-only aggregate. There is no ship-wide damage track in this rules
        // set — damage always lands on a named compartment — but Foundry's token
        // bars need a single value/max pair, and "how much of the hull is still
        // intact" is a fair one-glance summary. No rule reads this; combat must go
        // through the individual compartments.
        this.hullIntegrity = {
            value: Math.max(0, totalDurability - totalMortalDamage),
            max:   totalDurability,
        };

        // ── Hull budget checks ───────────────────────────────────────────────
        const armorCost = AlternityMathService.calculateArmorDurabilityCost(
            this.hullSize, this.armor?.grade
        );
        this.armorDurabilityCost = armorCost.cost;
        this.durabilityAvailable = armorCost.available;
        // Compartments are carved from what's left after armor is mounted.
        this.durabilityUnassigned = this.durabilityAvailable - totalDurability;
        this.isOverDurability = this.durabilityUnassigned < 0;
        this.isOverCompartmentLimit = this.compartmentCount > this.compartmentLimit;

        // ── Power ────────────────────────────────────────────────────────────
        // The engineer reallocates power between systems as an action, so the
        // meaningful number is what's *installed* versus what the plant can feed.
        this.powerRequired = [...(this.weapons ?? []), ...(this.defenses ?? []), ...(this.systems ?? [])]
            .reduce((sum, line) => sum + (line.powerReq ?? 0), 0);
        this.powerSurplus = (this.power?.generated ?? 0) - this.powerRequired;
        this.isPowerDeficit = this.powerSurplus < 0;

        // ── Support systems ──────────────────────────────────────────────────
        const lifeSupport = AlternityMathService.calculateSupportUnitsRequired(lifeSupportedDurability);
        this.lifeSupportUnitsRequired = lifeSupport.units;
        this.lifeSupportedDurability  = lifeSupportedDurability;

        // ── Ship-wide status summary ─────────────────────────────────────────
        // There is no ship-level damage track in this rules set, so "status" is a
        // read of the compartments: a ship dies when its command or engineering
        // spaces are gone, not when some pool empties.
        const surviving = this.compartmentDetails.filter((c) => !c.isDestroyed);
        const hasCommand     = surviving.some((c) => c.kind === 'Command');
        const hasEngineering = surviving.some((c) => c.kind === 'Engineering');

        if (this.compartmentCount === 0) {
            this.shipStatus = 'Unbuilt';
        } else if (surviving.length === 0) {
            this.shipStatus = 'Destroyed';
        } else if (!hasCommand || !hasEngineering) {
            this.shipStatus = 'Derelict';
        } else if (this.compartmentDetails.some((c) => c.systemPenalty > 0)) {
            this.shipStatus = 'Damaged';
        } else {
            this.shipStatus = 'Operational';
        }

        this.hasCommandCompartment     = hasCommand;
        this.hasEngineeringCompartment = hasEngineering;

        // ── Hit table coverage ───────────────────────────────────────────────
        // A gap or overlap in the d20 bands means some rolls hit nothing (or two
        // things), which is silent corruption during play — so it is checked here
        // and surfaced on the sheet rather than discovered mid-combat.
        this.hitTableCoverage = this._checkHitTableCoverage(compartments);
    }

    /**
     * Percentage of a compartment track that has been *filled with damage*
     * (so the bar grows as the ship is chewed up), clamped to 0-100.
     * @param {number} damage
     * @param {number} rating
     * @returns {number}
     * @private
     */
    _damagePct(damage, rating) {
        if (!rating) return 0;
        return Math.min(100, Math.max(0, Math.round(((damage ?? 0) / rating) * 100)));
    }

    /**
     * Verify that the compartments' d20 hit bands tile 1-20 exactly once.
     * @param {object[]} compartments
     * @returns {{ isComplete: boolean, missing: number[], duplicated: number[] }}
     * @private
     */
    _checkHitTableCoverage(compartments) {
        // A ship with no compartments yet isn't a broken hit table — the empty state
        // already says what to do, and flagging all 20 faces as missing would bury it.
        if (!compartments.length) return { isComplete: true, missing: [], duplicated: [] };

        const hits = new Map();
        for (const c of compartments) {
            for (let face = c.hitLow; face <= c.hitHigh; face++) {
                if (face < 1 || face > 20) continue;
                hits.set(face, (hits.get(face) ?? 0) + 1);
            }
        }
        const missing = [];
        const duplicated = [];
        for (let face = 1; face <= 20; face++) {
            const count = hits.get(face) ?? 0;
            if (count === 0) missing.push(face);
            else if (count > 1) duplicated.push(face);
        }
        return {
            isComplete: missing.length === 0 && duplicated.length === 0,
            missing,
            duplicated,
        };
    }

    /** @override */
    static migrateData(source) {
        return super.migrateData(source);
    }
}
