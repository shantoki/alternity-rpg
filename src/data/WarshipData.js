/**
 * @file WarshipData.js
 * @description TypeDataModel: Schema for the 'warship' Actor type.
 *
 * Warships are a Phase-1 PLAY/RECORD sheet for an already-designed starship
 * (per `../alternity-md/Warships.md`, the Warships rules expansion) — a static
 * transcription of a ship's stat block, damage track, systems, and hit-location
 * zones, not a construction wizard. Systems (weapons/defenses/sensors/generic
 * hull-point line items) are modeled as inline array rows rather than embedded
 * Item documents, matching how the rulebook itself presents a finished ship
 * (a flat Type/System/Hull Pts/Power Req/Cost table, e.g. "The Endurance").
 *
 * Warships do not use AlternityCharacterState (no ability scores, skills, or
 * psionics apply to a ship) — this schema is self-contained, following the
 * same lightweight pattern as VehicleData.js.
 */

const { fields } = foundry.data;

import {
    SHIP_TOUGHNESS_CLASSES,
    SHIP_FIREPOWER_CLASSES,
} from '../services/alternity-math.js';

// Re-exported rather than restated: the ladder is what `calculateFirepowerShift` ranks
// against, and a second copy here is a second thing to keep in step with Tables 1-3/1-4.
export { SHIP_TOUGHNESS_CLASSES, SHIP_FIREPOWER_CLASSES };

/**
 * What a hull *is*, which is also how the book groups its tables: Tables 5-1a and 5-1b
 * are the military and civilian hulls, and Table 6-1 is stations and bases — a station
 * being, in the book's words, "a ship without engines".
 */
export const SHIP_HULL_CATEGORIES = Object.freeze(['Military', 'Civilian', 'Installation']);

/** Named hull types, grouped by category (Warships Tables 5-1a/5-1b, Table 6-1). */
export const SHIP_HULL_TYPES = {
    Military: [
        'Fighter', 'Strike fighter', 'Cutter', 'Scout', 'Escort',
        'Corvette', 'Frigate', 'Destroyer',
        'Light cruiser', 'Heavy cruiser', 'Armored cruiser',
        'Battlecruiser', 'Battleship', 'Fleet carrier',
        'Dreadnought', 'Super-carrier', 'Super-dreadnought', 'Fortress ship',
    ],
    Civilian: [
        'Launch', 'Courier', 'Trader', 'Fast freighter', 'Fast transport',
        'Hauler', 'Industrial',
        'Medium freighter', 'Clipper', 'Medium transport',
        'Tanker', 'Liner', 'Heavy transport',
        'Super-freighter', 'Colony transport',
    ],
    Installation: [
        'Habitat Dome', 'Light Platform', 'Light Post',
        'Hab Complex', 'Medium Platform', 'Medium Bunker',
        'Heavy Platform', 'Heavy Bunker',
        'Super Platform', 'Fortress',
    ],
};

/** Ship status ladder (Warships Ch.1 "Effects of Damage") and their session-facing effects. */
export const SHIP_STATUS_EFFECTS = Object.freeze({
    Nominal: {
        label: 'Nominal',
        crewCheckPenalty: 0,
        maneuverClassPenalty: 0,
        attackerBonus: 0,
        text: 'No damage effects.',
    },
    Shaken: {
        label: 'Shaken',
        crewCheckPenalty: 1,
        maneuverClassPenalty: 0,
        attackerBonus: 0,
        text: 'All crew checks suffer a +1 step penalty.',
    },
    Disabled: {
        label: 'Disabled',
        crewCheckPenalty: 2,
        maneuverClassPenalty: 1,
        attackerBonus: -1,
        text: 'Crew checks +2 step penalty. Maneuver Class -1. Attackers gain a -1 step bonus.',
    },
    Crippled: {
        label: 'Crippled',
        crewCheckPenalty: 3,
        maneuverClassPenalty: 2,
        attackerBonus: -2,
        text: 'Crew checks +3 step penalty. Maneuver Class -2. Attackers gain a -2 step bonus.',
    },
    Destroyed: {
        label: 'Destroyed',
        crewCheckPenalty: null,
        maneuverClassPenalty: null,
        attackerBonus: null,
        text: 'The ship is a derelict or has broken up entirely.',
    },
});

function resourceSchema(currentDefault, maxDefault) {
    return new fields.SchemaField({
        value: new fields.NumberField({
            required: true,
            nullable: false,
            integer:  true,
            initial:  currentDefault,
            min:      0,
        }),
        max: new fields.NumberField({
            required: true,
            nullable: false,
            integer:  true,
            initial:  maxDefault,
            min:      0,
        }),
    });
}

/** Shared shape for the generic systems/weapons/defenses/sensors line-item tables. */
function systemLineFields(extra = {}) {
    return {
        name: new fields.StringField({ required: true, nullable: false, initial: '' }),
        hullPoints: new fields.NumberField({ required: true, nullable: false, initial: 0, min: 0 }),
        powerReq: new fields.NumberField({ required: true, nullable: false, initial: 0 }),
        cost: new fields.StringField({ required: false, initial: '' }),
        ...extra,
    };
}

export class WarshipData extends foundry.abstract.TypeDataModel {

    /** @override */
    static defineSchema() {
        return {
            // ── Identity / classification ────────────────────────────────
            hullType: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'Heavy cruiser',
            }),

            hullCategory: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'Military',
                choices:  SHIP_HULL_CATEGORIES,
            }),

            toughness: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'Medium',
                choices:  SHIP_TOUGHNESS_CLASSES,
            }),

            targetModifier: new fields.StringField({
                required: false,
                initial:  '0',
            }),

            maneuverClass: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  2,
                min:      0,
                max:      4,
            }),

            hullPoints: new fields.SchemaField({
                base:  new fields.NumberField({ required: true, nullable: false, integer: true, initial: 400, min: 0 }),
                bonus: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 80, min: 0 }),
            }),

            // ── Damage track (4-tier: stun/wound/mortal/critical) ─────────
            damage: new fields.SchemaField({
                stun:     resourceSchema(0, 50),
                wound:    resourceSchema(0, 50),
                mortal:   resourceSchema(0, 25),
                critical: resourceSchema(0, 12),
            }),

            // ── Armor ──────────────────────────────────────────────────────
            armor: new fields.SchemaField({
                lowImpact:  new fields.StringField({ required: false, initial: '' }),
                highImpact: new fields.StringField({ required: false, initial: '' }),
                energy:     new fields.StringField({ required: false, initial: '' }),
                armorType:  new fields.StringField({ required: false, initial: '' }),
            }),

            // ── Power budget ───────────────────────────────────────────────
            power: new fields.SchemaField({
                generated: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
                consumed:  new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
            }),

            // ── Movement / combat stats ────────────────────────────────────
            edge: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0 }),

            acceleration: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),

            crew: new fields.SchemaField({
                estimate: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 1, min: 0 }),
                current:  new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
            }),

            cost: new fields.StringField({ required: false, initial: '' }),

            // ── Systems table (generic Hull/Armor/Power/Engine/... rows) ───
            systems: new fields.ArrayField(new fields.SchemaField(systemLineFields({
                category: new fields.StringField({
                    required: true,
                    nullable: false,
                    initial:  'Misc',
                    choices:  ['Hull', 'Armor', 'Power', 'Engine', 'FTL', 'Support',
                        'Command', 'Sensors', 'Hangar', 'Misc'],
                }),
            })), { initial: [] }),

            // ── Weapons ─────────────────────────────────────────────────────
            weapons: new fields.ArrayField(new fields.SchemaField(systemLineFields({
                fireMode: new fields.StringField({
                    required: true,
                    nullable: false,
                    initial:  'Single',
                    choices:  ['Single', 'Burst', 'Auto', 'Battery'],
                }),
                arc: new fields.StringField({
                    required: true,
                    nullable: false,
                    initial:  'Fore',
                    choices:  ['Fore', 'Aft', 'Port', 'Starboard', 'Turret', 'Fixed'],
                }),
                firepowerClass: new fields.StringField({
                    required: true,
                    nullable: false,
                    initial:  'Medium',
                    // A weapon's half of the ladder: 'Good' is a hull toughness only.
                    choices:  SHIP_FIREPOWER_CLASSES,
                }),
                damageFormula: new fields.StringField({ required: false, initial: '1d6' }),
                damageType: new fields.StringField({
                    required: true,
                    nullable: false,
                    initial:  'lowImpact',
                    choices:  ['lowImpact', 'highImpact', 'energy'],
                }),
                damageGrade: new fields.StringField({
                    required: true,
                    nullable: false,
                    initial:  'wound',
                    choices:  ['stun', 'wound', 'mortal', 'critical'],
                }),
            })), { initial: [] }),

            // ── Defenses (screens, jammers, etc.) ────────────────────────────
            defenses: new fields.ArrayField(new fields.SchemaField(systemLineFields({
                effectText: new fields.StringField({ required: false, initial: '' }),
            })), { initial: [] }),

            // ── Sensors ────────────────────────────────────────────────────
            sensors: new fields.ArrayField(new fields.SchemaField(systemLineFields({
                trackingCapacity: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
            })), { initial: [] }),

            // ── Hit-location zones ("damage diagram", Table 5-18) ────────────
            zones: new fields.ArrayField(new fields.SchemaField({
                label:          new fields.StringField({ required: true, nullable: false, initial: '' }),
                hullPointLimit: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
                hullPointsUsed: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
                systemsText:    new fields.StringField({ required: false, initial: '' }),
                isKnockedOut:   new fields.BooleanField({ required: true, initial: false }),
            }), { initial: [] }),

            // ── GM notes ─────────────────────────────────────────────────────
            notes: new fields.HTMLField({ required: false, initial: '' }),
            description: new fields.HTMLField({ required: false, initial: '' }),
        };
    }

    /** @override */
    prepareDerivedData() {
        this.stunPct     = this._resourcePct(this.damage.stun);
        this.woundPct    = this._resourcePct(this.damage.wound);
        this.mortalPct   = this._resourcePct(this.damage.mortal);
        this.criticalPct = this._resourcePct(this.damage.critical);

        // Ordered threshold ladder — Warships Ch.1 "Effects of Damage" (lines 693-726):
        // a ship is Shaken/Disabled/Crippled/Destroyed once the *corresponding* track is full,
        // checked from most to least severe so the worst applicable status wins.
        if (this.damage.critical.max > 0 && this.damage.critical.value >= this.damage.critical.max) {
            this.shipStatus = 'Destroyed';
        } else if (this.damage.mortal.max > 0 && this.damage.mortal.value >= this.damage.mortal.max) {
            this.shipStatus = 'Crippled';
        } else if (this.damage.wound.max > 0 && this.damage.wound.value >= this.damage.wound.max) {
            this.shipStatus = 'Disabled';
        } else if (this.damage.stun.max > 0 && this.damage.stun.value >= this.damage.stun.max) {
            this.shipStatus = 'Shaken';
        } else {
            this.shipStatus = 'Nominal';
        }

        this.powerSurplus = this.power.generated - this.power.consumed;
        this.isPowerDeficit = this.powerSurplus < 0;

        this.hullPointsTotal = this.hullPoints.base + this.hullPoints.bonus;
    }

    /**
     * Compute percentage (0-100) for a resource object with value/max.
     * @param {{ value: number, max: number }} resource
     * @returns {number}
     * @private
     */
    _resourcePct(resource) {
        if (!resource || !resource.max) return 0;
        return Math.min(100, Math.max(0, Math.round((resource.value / resource.max) * 100)));
    }

    /** @override */
    static migrateData(source) {
        return super.migrateData(source);
    }
}
