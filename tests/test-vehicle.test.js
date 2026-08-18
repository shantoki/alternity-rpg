/**
 * @fileoverview Tests `VehicleData` — the schema that replaced the d20-shaped one.
 *
 * Two things are worth pinning here and nowhere else.
 *
 * **The migration**, because it is the one path that rewrites a Gamemaster's existing
 * vehicles. The old schema carried `hullIntegrity`, `shields`, `techPoints`, a flat
 * `speed`, a `maneuver` bonus, a d20 `size` category and an armour-class `defense`
 * number; three of those have an Alternity counterpart, and four have none at all and
 * must survive as prose rather than evaporating.
 *
 * **The derived step penalty**, because it is the whole reason a vehicle exists in this
 * system: a vehicle rolls almost nothing itself, it hands its operator a number. Four
 * separate rules feed that number (Drv, the speed band, a half-empty damage track, and
 * mortal damage) and they stack.
 *
 * `prepareDerivedData` is invoked against a plain object rather than a constructed
 * document: the Jest `foundry` mock is deliberately shallow and cannot build a real
 * DataModel, but the method only ever reads and writes `this`, so calling it directly
 * exercises exactly the code that runs in Foundry.
 */

import {
    VehicleData,
    VEHICLE_OPERATION_SKILLS,
    VEHICLE_SKILL_IDS,
    VEHICLE_SPEED_BANDS,
    VEHICLE_TRACKS,
} from '../src/data/VehicleData.js';
import { SKILL_DEFINITIONS } from '../src/data/alternity-actor-data.js';

const migrate = (source) => VehicleData.migrateData({ ...source });

/**
 * Run `prepareDerivedData` over a bare stat set, defaulting everything the method
 * reads. Returns the object it wrote onto.
 */
function derive(overrides = {}) {
    const data = {
        operationSkill: 'Land vehicle',
        drvModifier: 0,
        speedBand: 'Cruising',
        durabilityRatings: { stun: 10, wound: 10, mortal: 5 },
        damage: { stun: 0, wound: 0, mortal: 0 },
        hull: { size: 0, compartments: 0 },
        weapons: [],
        isConkedOut: false,
        ...overrides,
    };
    VehicleData.prototype.prepareDerivedData.call(data);
    return data;
}

describe('VehicleData migration from the d20-shaped schema', () => {

    it('should turn hull integrity into the three damage tracks', () => {
        // "Equivalent to Vitality — structural damage track", and Vitality was this
        // system's old misnomer for wounds.
        const out = migrate({ hullIntegrity: { value: 30, max: 50 } });
        expect(out.durabilityRatings).toEqual({ stun: 50, wound: 50, mortal: 25 });
        expect(out.damage).toEqual({ stun: 0, wound: 20, mortal: 0 });
        expect(out.hullIntegrity).toBeUndefined();
    });

    it('should accept the even older shape where hull integrity was a bare number', () => {
        const out = migrate({ hullIntegrity: 12 });
        expect(out.durabilityRatings).toEqual({ stun: 12, wound: 12, mortal: 6 });
        expect(out.damage.wound).toBe(0);
    });

    it('should not overwrite ratings that have already been migrated', () => {
        const out = migrate({
            hullIntegrity: { value: 5, max: 50 },
            durabilityRatings: { stun: 7, wound: 7, mortal: 3 },
        });
        expect(out.durabilityRatings).toEqual({ stun: 7, wound: 7, mortal: 3 });
        expect(out.hullIntegrity).toBeUndefined();
    });

    /**
     * The old field's own comment read "flat bonus/penalty to piloting checks", which is
     * the d20 convention where positive helps. Drv is a step modifier, where positive
     * hurts — so a vehicle that used to be described as easy to fly has to stay easy.
     */
    it('should flip the sign of the old manoeuvre bonus', () => {
        expect(migrate({ maneuver: 2 }).drvModifier).toBe(-2);
        expect(migrate({ maneuver: -1 }).drvModifier).toBe(1);
        expect(migrate({ maneuver: 0 }).drvModifier).toBe(-0);
        expect(migrate({ maneuver: 2 }).maneuver).toBeUndefined();
    });

    it('should map the old vehicle type onto a skill and a scale', () => {
        expect(migrate({ vehicleType: 'Ground' }).operationSkill).toBe('Land vehicle');
        expect(migrate({ vehicleType: 'Water' }).operationSkill).toBe('Water vehicle');
        expect(migrate({ vehicleType: 'Air' })).toMatchObject({
            operationSkill: 'Air vehicle', scale: 'Air',
        });
        expect(migrate({ vehicleType: 'Space' })).toMatchObject({
            operationSkill: 'Space vehicle', scale: 'Space',
        });
        expect(migrate({ vehicleType: 'Ground' }).scale).toBe('Surface');
        expect(migrate({ vehicleType: 'Ground' }).vehicleType).toBeUndefined();
    });

    it('should carry the flat speed over as a cruising speed', () => {
        const out = migrate({ speed: 30 });
        expect(out.cruiseSpeed).toBe('30');
        expect(out.speed).toBeUndefined();
    });

    it('should fold the two crew fields into one', () => {
        expect(migrate({ crewCapacity: 6, currentCrew: 2 }).crew)
            .toEqual({ capacity: 6, current: 2 });
    });

    /**
     * Alternity has no shields, no tech points, no d20 size category and no armour
     * class. None of them can be mapped, so none of them may be silently dropped
     * either — a reader deserves to know what the old sheet claimed.
     */
    it('should preserve the fields with no Alternity counterpart as prose', () => {
        const out = migrate({
            shields: { value: 4, max: 10 },
            techPoints: { value: 3, max: 10 },
            size: 'Huge',
            defense: 14,
        });
        expect(out.notes).toContain('Shields 4/10');
        expect(out.notes).toContain('Tech Points 3/10');
        expect(out.notes).toContain('Huge');
        expect(out.notes).toContain('Defense 14');
        expect(out.shields).toBeUndefined();
        expect(out.techPoints).toBeUndefined();
        expect(out.size).toBeUndefined();
        expect(out.defense).toBeUndefined();
    });

    it('should not note a shield or power track that was never used', () => {
        const out = migrate({ shields: { value: 0, max: 0 }, techPoints: { value: 0, max: 0 } });
        expect(out.notes ?? '').not.toContain('Shields');
        expect(out.notes ?? '').not.toContain('Tech Points');
    });

    /**
     * `migrateData` fixes only the in-memory copy, so it runs on every load until the
     * document is next saved. Appending unconditionally would grow the notes without
     * bound over a long session.
     */
    it('should not stack the salvage note when it runs twice', () => {
        const once = migrate({ defense: 12 });
        const twice = VehicleData.migrateData({ ...once, defense: 12 });
        const occurrences = twice.notes.split('Retired from the pre-Alternity').length - 1;
        expect(occurrences).toBe(1);
    });

    it('should drop the disabled flag, which is derived now', () => {
        expect(migrate({ isDisabled: true }).isDisabled).toBeUndefined();
    });

    it('should leave an already-current document alone', () => {
        const current = {
            operationSkill: 'Air vehicle', scale: 'Air', drvModifier: -1,
            durabilityRatings: { stun: 10, wound: 10, mortal: 5 },
        };
        expect(migrate(current)).toEqual(current);
    });
});

describe('VehicleData derived data', () => {

    it('should print the damage run the table prints', () => {
        expect(derive().durabilityRun).toBe('10/10/5');
        expect(derive().isHullRated).toBe(false);
    });

    it('should print a hull instead for the spacecraft rows', () => {
        const out = derive({
            durabilityRatings: { stun: 0, wound: 0, mortal: 0 },
            hull: { size: 16, compartments: 4 },
        });
        expect(out.isHullRated).toBe(true);
        expect(out.durabilityRun).toBe('Hull 16/4');
    });

    it('should expose one value/max pair per track, and only three of them', () => {
        const out = derive({ damage: { stun: 3, wound: 1, mortal: 0 } });
        expect(Object.keys(out.durability)).toEqual([...VEHICLE_TRACKS]);
        expect(out.durability.stun).toEqual({ value: 3, max: 10 });
        expect(out.durability.wound).toEqual({ value: 1, max: 10 });
        // Vehicles do not fatigue.
        expect(out.durability.fatigue).toBeUndefined();
    });

    describe('the step penalty handed to the operator', () => {

        it('should be nothing at all for an undamaged vehicle at cruising speed', () => {
            const out = derive();
            expect(out.controlModifiers).toEqual([]);
            expect(out.controlPenalty).toBe(0);
        });

        it('should carry Drv through unchanged, bonus or penalty', () => {
            expect(derive({ drvModifier: 2 }).controlPenalty).toBe(2);
            // A sports car's printed -2 is a bonus, and stays one.
            expect(derive({ drvModifier: -2 }).controlPenalty).toBe(-2);
        });

        /** "+1 if cruising speed is exceeded, or +3 if the vehicle is pushed all the way." */
        it('should price the speed band the way p.201 prices it', () => {
            expect(derive({ speedBand: 'Cruising' }).speedPenalty).toBe(0);
            expect(derive({ speedBand: 'Over cruise' }).speedPenalty).toBe(1);
            expect(derive({ speedBand: 'Maximum' }).speedPenalty).toBe(3);
            expect(Object.values(VEHICLE_SPEED_BANDS)).toEqual([0, 1, 3]);
        });

        /**
         * "When a vehicle loses more than half of its stun points ... the operator must
         * take a +1 penalty on all Vehicle Operation checks." More than half — exactly
         * half is not enough.
         */
        it('should add one step once more than half a track is gone', () => {
            expect(derive({ damage: { stun: 5, wound: 0, mortal: 0 } }).isStunStrained).toBe(false);
            expect(derive({ damage: { stun: 6, wound: 0, mortal: 0 } }).isStunStrained).toBe(true);
            expect(derive({ damage: { stun: 6, wound: 0, mortal: 0 } }).controlPenalty).toBe(1);
            // The wound track carries the same rule, and the two do not double up.
            expect(derive({ damage: { stun: 6, wound: 6, mortal: 0 } }).controlPenalty).toBe(1);
        });

        /** "For each point of mortal damage ... its operator receives a +1 penalty." */
        it('should add one step per point of mortal damage', () => {
            expect(derive({ damage: { stun: 0, wound: 0, mortal: 3 } }).controlPenalty).toBe(3);
        });

        it('should stack all four contributions', () => {
            const out = derive({
                drvModifier: 1,
                speedBand: 'Maximum',
                damage: { stun: 8, wound: 0, mortal: 2 },
            });
            // Drv +1, maximum speed +3, strained +1, two points of mortal +2.
            expect(out.controlPenalty).toBe(7);
            expect(out.controlModifiers.map(m => m.source)).toEqual([
                'vehicle-drv', 'vehicle-speed', 'vehicle-strained', 'vehicle-mortal',
            ]);
            // Every entry says why, because the roll card renders the reason.
            for (const mod of out.controlModifiers) expect(mod.reason.length).toBeGreaterThan(0);
        });
    });

    describe('the vehicle’s own durability check', () => {

        /**
         * "A vehicle's skill score for this check is equal to its original stun point
         * total, so a mid-sized car with 10 stun points needs a 10 or less to pass its
         * check." The *original* total — not what is left of it.
         */
        it('should roll against the original rating, not the remaining points', () => {
            const out = derive({ damage: { stun: 9, wound: 0, mortal: 0 } });
            expect(out.durabilityChecks.stun.ordinary).toBe(10);
            expect(out.durabilityChecks.stun.label).toBe('10/5/2');
        });

        it('should offer the wound total as well, for the check mortal damage forces', () => {
            const out = derive({ durabilityRatings: { stun: 20, wound: 20, mortal: 10 } });
            expect(out.durabilityChecks.wound.ordinary).toBe(20);
        });

        it('should apply the mortal penalty, and nothing else, to that check', () => {
            expect(derive().durabilityCheckModifiers).toEqual([]);
            const damaged = derive({
                drvModifier: 2, speedBand: 'Maximum',
                damage: { stun: 0, wound: 0, mortal: 2 },
            });
            // Drv and the speed band belong to the operator's check, not this one.
            expect(damaged.durabilityCheckModifiers).toHaveLength(1);
            expect(damaged.durabilityCheckModifiers[0].value).toBe(2);
        });
    });

    describe('status', () => {
        it('should climb the ladder as the vehicle comes apart', () => {
            expect(derive().status).toBe('Operational');
            expect(derive({ damage: { stun: 6, wound: 0, mortal: 0 } }).status).toBe('Unstable');
            expect(derive({ damage: { stun: 10, wound: 0, mortal: 0 } }).status).toBe('Failing');
            expect(derive({ damage: { stun: 0, wound: 0, mortal: 5 } }).status).toBe('Wrecked');
        });

        /**
         * Running a track out only *forces* a durability check; the check decides
         * whether the vehicle conks out. So this one state is entered by hand and the
         * system never infers it.
         */
        it('should only report a stopped vehicle when a human said so', () => {
            expect(derive({ damage: { stun: 10, wound: 0, mortal: 0 } }).status).toBe('Failing');
            expect(derive({ damage: { stun: 10, wound: 0, mortal: 0 }, isConkedOut: true }).status)
                .toBe('Stalled');
        });

        it('should have no status name with a space in it, because CSS and lang keys use it', () => {
            const statuses = [
                derive().status,
                derive({ damage: { stun: 6, wound: 0, mortal: 0 } }).status,
                derive({ damage: { stun: 10, wound: 0, mortal: 0 } }).status,
                derive({ isConkedOut: true }).status,
                derive({ damage: { stun: 0, wound: 0, mortal: 5 } }).status,
            ];
            for (const status of statuses) expect(status).toMatch(/^\w+$/);
        });
    });

    it('should give every weapon row the score triple the sheet displays', () => {
        const out = derive({ weapons: [{ name: 'Chain gun', score: 13 }, { name: 'Unmanned', score: 0 }] });
        expect(out.attackRows[0]).toMatchObject({ index: 0, scoreRun: '13/6/3' });
        // A row nobody has been assigned to shows nothing rather than "0/0/0".
        expect(out.attackRows[1].scoreRun).toBe('');
    });
});

describe('the Vehicle Operation skills a vehicle can name', () => {

    /**
     * The sheet looks an operator's score up by these ids. A rename in
     * `SKILL_DEFINITIONS` would otherwise silently turn every control check into "no
     * score in Land vehicle".
     */
    it('should every one resolve to a real skill, or to nothing on purpose', () => {
        const ids = new Set(SKILL_DEFINITIONS.map(def => def.id));
        for (const skill of VEHICLE_OPERATION_SKILLS) {
            const id = VEHICLE_SKILL_IDS[skill];
            if (skill === 'None') expect(id).toBeNull();
            else expect(ids.has(id)).toBe(true);
        }
    });

    it('should route the three Daredevil rows to Acrobatics, not Vehicle Operation', () => {
        // Table P42 prints "Daredevil" for the bicycle, the ultralight and the jetpack,
        // and that is Acrobatics-daredevil — a different broad skill entirely.
        const daredevil = SKILL_DEFINITIONS.find(def => def.id === VEHICLE_SKILL_IDS.Daredevil);
        expect(daredevil.parent).toBe('dex-acrobatics');
    });
});
