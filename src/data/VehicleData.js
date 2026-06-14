/**
 * @file VehicleData.js
 * @description Step 7 — TypeDataModel: Schema for the 'vehicle' Actor type.
 *
 * Vehicles (and starships) are Actor documents that can be crewed by player
 * characters. They do not use the standard ability-score system; instead they
 * have vehicle-specific stats: hull integrity, speed, maneuverability, and
 * crew capacity. Tech Points are the primary resource.
 *
 * Fields:
 *   - hullIntegrity   : Equivalent to Vitality — structural damage track
 *   - shields         : Additional damage absorption (energy-type only)
 *   - speed           : Base movement in map units per round
 *   - maneuver        : Flat bonus/penalty to piloting checks made with this vehicle
 *   - techPoints      : Power budget for shipboard systems and equipment
 *   - crewCapacity    : Maximum number of crew/passengers
 *   - currentCrew     : Number of crew currently aboard
 *   - vehicleType     : Ground / Air / Space / Water
 *   - size            : Vehicle size category (affects combat mechanics)
 *   - isDisabled      : True when hullIntegrity reaches 0
 *   - description     : GM/flavour notes
 */

const { fields } = foundry.data;

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

export class VehicleData extends foundry.abstract.TypeDataModel {

    /** @override */
    static defineSchema() {
        return {
            // ── Structural integrity ─────────────────────────────────────
            hullIntegrity: resourceSchema(50, 50),
            shields:       resourceSchema(0,  0),

            // ── Movement ─────────────────────────────────────────────────
            speed: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  30,
                min:      0,
            }),

            // Flat piloting modifier granted (or imposed) by the vehicle itself.
            maneuver: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  0,
                min:      -10,
                max:      10,
            }),

            // ── Power (Tech Points) ──────────────────────────────────────
            techPoints: resourceSchema(10, 10),

            // ── Crew ─────────────────────────────────────────────────────
            crewCapacity: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  1,
                min:      1,
            }),

            currentCrew: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  0,
                min:      0,
            }),

            // ── Classification ───────────────────────────────────────────
            vehicleType: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'Ground',
                choices:  ['Ground', 'Air', 'Space', 'Water'],
            }),

            size: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'Medium',
                choices:  ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'],
            }),

            // ── Defense ──────────────────────────────────────────────────
            // Vehicles have a flat defense value rather than a DEX-derived one.
            defense: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  10,
                min:      0,
            }),

            // ── Status ───────────────────────────────────────────────────
            isDisabled: new fields.BooleanField({
                required: true,
                initial:  false,
            }),

            // ── Flavour ──────────────────────────────────────────────────
            description: new fields.HTMLField({
                required: false,
                initial:  '',
            }),
        };
    }

    /** @override */
    prepareDerivedData() {
        // Mark as disabled when hull integrity reaches 0
        this.isDisabled = this.hullIntegrity.value <= 0;

        // Hull ratio for UI progress bars
        this.hullPercent = this.hullIntegrity.max > 0
            ? Math.round((this.hullIntegrity.value / this.hullIntegrity.max) * 100)
            : 0;

        // Shield ratio
        this.shieldPercent = this.shields.max > 0
            ? Math.round((this.shields.value / this.shields.max) * 100)
            : 0;
    }

    /** @override */
    static migrateData(source) {
        // v0.1: hull was stored as flat number, not resource schema
        if (typeof source.hullIntegrity === 'number') {
            source.hullIntegrity = { value: source.hullIntegrity, max: source.hullIntegrity };
        }
        return super.migrateData(source);
    }
}
