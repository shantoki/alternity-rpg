/**
 * @file tools/convert/spaceships.mjs
 * @description The published core-rules starships -> `spaceship` Actors.
 *
 * Like `warships.mjs`, this converter has no input file: the character generator's data
 * set has no ships in it, so the statblocks are transcribed here from the books and
 * `NEEDS_SOURCE_DATA` is false. Eighteen ships, from three sources:
 *
 *   Player's Handbook Ch.12         9  the stock hulls, PL 6 through PL 8
 *   StarDrive Arms & Equipment Gd.  3  the Solar X Shipyards catalogue, with prices
 *   StarDrive Campaign Setting      6  named ships from the Verge
 *
 * ## How a corrupt statblock was made to check itself
 *
 * The scans are rough - `4/4/2` prints as `4/8/2`, `13-16` as `18-16`, `C6` as `CE` - so
 * nothing here is trusted just because it is legible. Two invariants pin every number
 * down, and between them they reconstructed the cells the OCR destroyed:
 *
 * 1. **A printed triple is one number.** "A compartment's mortal rating is the same as
 *    its number of durability points, and its stun and wound ratings are twice that
 *    number", so `8/8/4` is durability 4 and nothing else. Any triple that does not obey
 *    2n/2n/n is corrupt, which is how the *Blackguard*'s "8/6/3" resolved to 6/6/3.
 *
 * 2. **The compartments sum to the hull.** Every StarDrive statblock prints its armour's
 *    durability cost ("Moderate neutronite (3 dur)"), and its compartments sum to exactly
 *    `Dur - that cost`. That identity supplied the *Stingray*'s missing engineering
 *    compartment (9, holding the induction engine the scan dropped along with it), the
 *    yacht's missing command compartment (5), the *Sirocco*'s command compartment, and
 *    both unreadable compartments on the *Lucre*-class escort.
 *
 *    The nine Player's Handbook ships sum to the hull size *without* subtracting armour -
 *    the PHB prints an armour rating but never charges durability for it. That is a
 *    difference between the two books, not a transcription slip, and it means the five
 *    PHB ships with Moderate armour read as over-budget on the sheet by exactly the
 *    armour's cost. Each of those says so in its own description.
 *
 * Where an invariant could not settle a value it is not invented. The *Blade*-class scout
 * lost its whole durability column, so each of its compartments carries the sum of the
 * durability costs of the systems printed inside it - a floor derived from the page, not
 * a guess - and the 2 points that leaves unassigned are called out on the ship.
 * `provenance.scanDamage` names every ship that needed this treatment.
 */

import { makeActor, statBlock } from '../lib/fvtt.mjs';

export const PACK = 'alternity-spaceships';

/** This pack comes out of the books, not out of `external/json`. */
export const NEEDS_SOURCE_DATA = false;

const SHIP_IMG = 'icons/svg/target.svg';

/** Compartment kinds keyed by the label the statblock prints. */
const KINDS = {
    'Command':            'Command',
    'Engineering':        'Engineering',
    'Engineering 1':      'Engineering',
    'Engineering 2':      'Engineering',
    'Weapon':             'Weapons',
    'Weapons':            'Weapons',
    'Weapons 1':          'Weapons',
    'Weapons 2':          'Weapons',
    'Auxiliary':          'Auxiliary',
    'Auxiliary 1':        'Auxiliary',
    'Auxiliary 2':        'Auxiliary',
    'Electronics':        'Electronics',
    'Cargo':              'Cargo',
    'Crew':               'Crew',
    'Crew 1':             'Crew',
    'Crew 2':             'Crew',
    'Crew quarters':      'Crew',
    'Passenger quarters': 'Crew',
    'Passenger hold':     'Crew',
};

/**
 * One compartment. `[label, durability, hitLow, hitHigh]`, with the hit band at `0, 0`
 * for a compartment the statblock shelters out of the random-damage table - several
 * StarDrive ships print a dash for their command space, so a d20 can never single it out.
 */
function compartment([label, durability, hitLow, hitHigh], extra = {}) {
    const kind = KINDS[label];
    if (!kind) throw new Error(`No compartment kind for "${label}"`);
    return {
        label,
        kind,
        durability,
        damage: { stun: 0, wound: 0, mortal: 0 },
        hitLow,
        hitHigh,
        hasLifeSupport: true,
        damageControl:  'None',
        systemsText:    '',
        ...extra,
    };
}

/** `[name, compartment, durabilityCost, powerReq, category]` -> a `systems` row. */
function system([name, comp, durabilityCost, powerReq, category], notes = '') {
    return {
        name,
        compartment: comp,
        durabilityCost,
        powerReq,
        isOffline: false,
        notes,
        category,
        range: '',
    };
}

/**
 * A weapon row. The three damage codes are transcribed exactly as printed; a launch tube
 * or rack has none of its own, because the missile loaded into it carries the damage.
 */
function weapon({
    name, comp = 0, dur = 0, power = 0, arc = 'Fore', range = '',
    ordinary = '', good = '', amazing = '', type = 'lowImpact',
    firepower = 'Amazing', notes = '',
}) {
    return {
        name,
        compartment: comp,
        durabilityCost: dur,
        powerReq: power,
        isOffline: false,
        notes,
        arc,
        range,
        damageOrdinary: ordinary,
        damageGood:     good,
        damageAmazing:  amazing,
        damageType:     type,
        firepower,
        actionsPerRound: 1,
    };
}

function defense({ name, comp = 0, dur = 0, power = 0, active = false, effect = '', notes = '' }) {
    return {
        name,
        compartment: comp,
        durabilityCost: dur,
        powerReq: power,
        isOffline: false,
        notes,
        isActive: active,
        effectText: effect,
    };
}

/** Defence effects as the books word them, so the same system reads the same on every ship. */
const DEFENSE_TEXT = {
    'Deflection inducer': '+2 step penalty to any attack against the ship.',
    'Displacer':          '+3 step penalty to any attack against the ship.',
    'Jammer':             '+2 steps to enemy missile and sensor checks.',
    'Chaff':              '+1 step to enemy missile and sensor checks.',
    'Chaff dispenser':    '+1 step to enemy missile and sensor checks.',
    'Point-defense gun':  'Destroys an incoming missile before it can detonate.',
};

/** A defence named in a statblock header but never itemised in its compartment table. */
const NOT_ITEMISED = 'Named in the statblock header; the compartment table does not itemise it.';

/**
 * Fill in everything a statblock does not print. Absent numbers stay at zero rather than
 * being inferred: a ship whose power output is not printed shows a deficit on the sheet,
 * which is the truth about the source rather than a bug.
 */
function ship(spec) {
    const {
        name, hullType, hullCategory, hullSize, progressLevel,
        maneuverRating = 0, acceleration = 0, cruisingSpeed = 0, engineType = '',
        ftl = { driveType: 'None', drivespace: 0 },
        power = { generated: 0, plantText: '' },
        berthing = 0, cost = '',
        armor = { grade: 'None', material: '', lowImpact: '', highImpact: '', energy: '' },
        computer = { coreQuality: 'Marginal', dedicatedText: '' },
        compartments, weapons = [], defenses = [], systems = [],
        notes = '', description, provenance,
    } = spec;

    return makeActor({
        pack: PACK,
        name,
        type: 'spaceship',
        img: SHIP_IMG,
        system: {
            hullType,
            hullCategory,
            hullSize,
            // Table G34's Comp column is unreadable in the scan for all but six hulls, and
            // for each of those six the printed design uses its full allowance - so a
            // finished ship's own compartment count is the best available reading of it.
            compartmentLimit: compartments.length,
            progressLevel,
            cost,
            maneuverRating,
            acceleration,
            cruisingSpeed,
            engineType,
            movementPoints: 0,
            ftl,
            power: { generated: power.generated, allocated: 0, plantText: power.plantText },
            berthing,
            crewAboard: 0,
            armor,
            computer,
            compartments,
            weapons,
            defenses,
            systems,
            stations: [],
            notes,
            description,
        },
        flags: { 'alternity': { provenance } },
    });
}

/** The stat lines every ship prints, rendered the same way for all eighteen. */
function shipStatBlock(spec, extraRows = []) {
    const { armor, ftl, power, computer } = spec;
    const armourText = armor && armor.grade !== 'None'
        ? `${armor.grade}${armor.material ? ` ${armor.material}` : ''}: `
          + `${armor.lowImpact} (LI), ${armor.highImpact} (HI), ${armor.energy} (En)`
        : 'None';

    return statBlock([
        ['Source', `${spec.provenance.book}, ${spec.provenance.reference}`],
        ['Hull', `${spec.hullType} (${spec.hullCategory}), hull size ${spec.hullSize}`],
        ['Progress Level', spec.progressLevel],
        ['Compartments', spec.compartments.length],
        ['Toughness', 'Amazing - as every spaceship is (GM Guide Ch.11)'],
        ['Manoeuvre rating', spec.maneuverRating ?? 0],
        ['Acceleration', spec.acceleration ? `${spec.acceleration} Mm per phase` : ''],
        ['Cruising speed', spec.cruisingSpeed ? `${spec.cruisingSpeed} AU per hour` : ''],
        ['Engine', spec.engineType],
        ['Power plant', power?.plantText],
        ['FTL', ftl?.driveType === 'None'
            ? 'None'
            : `${ftl.driveType}, ${ftl.drivespace} light-years per starfall`],
        ['Armor', armourText],
        ['Computer', computer?.coreQuality
            + (computer?.dedicatedText ? ` core; ${computer.dedicatedText}` : ' core')],
        ['Berthing', spec.berthing || ''],
        ['Cost', spec.cost],
        ...extraRows,
    ]);
}

// ---------------------------------------------------------------------------
// Player's Handbook Ch.12 - the stock hulls
// ---------------------------------------------------------------------------
/*
 * These nine are the ships the core rules ship with, printed as one paragraph of prose
 * and four stat lines each (Hull size / Weapon, Armor, Defenses / Drivespace /
 * Compartments / Random damage). They itemise no systems at all, which is why their
 * `systems` arrays are empty and the engine and power plant named in the prose go into
 * `engineType` and `power.plantText` instead of becoming invented line items.
 *
 * Several print a drivespace rating while their prose says the drive is an extra-cost
 * option. Those are set up drive-equipped, because that is the version a table wants, and
 * the price of the option is in the ship's notes.
 */
const PHB = 'Player\'s Handbook';

const PHB_SHIPS = [
    {
        name: 'STG Shuttle', hullType: 'STG shuttle', hullCategory: 'Civilian',
        hullSize: 16, progressLevel: 6,
        engineType: 'Planetary thruster',
        power: { generated: 0, plantText: 'Fusion generator' },
        ftl: { driveType: 'None', drivespace: 0 },
        armor: { grade: 'Light', material: 'polymeric', lowImpact: 'd4-1', highImpact: 'd4-1', energy: 'd4-2' },
        compartments: [
            compartment(['Command', 3, 1, 2]),
            compartment(['Engineering', 8, 3, 5]),
            compartment(['Cargo', 3, 6, 12]),
            compartment(['Passenger hold', 2, 13, 20]),
        ],
        notes: '<p>Space-to-ground only: fast and cheap for moving people and cargo between '
            + 'a planet and orbit, and incapable of deep space travel. It needs no separate '
            + 'rockets to make orbit, working much like an airplane.</p>',
        provenance: { book: PHB, reference: 'Ch.12 "Vehicles", PL 6', folder: "Player's Handbook" },
    },
    {
        name: 'System Liner', hullType: 'System liner', hullCategory: 'Civilian',
        hullSize: 32, progressLevel: 6,
        engineType: 'Fusion torch',
        power: { generated: 0, plantText: 'Fusion generator' },
        ftl: { driveType: 'Stardrive', drivespace: 5 },
        armor: { grade: 'Light', material: 'alloy', lowImpact: 'd6-1', highImpact: 'd6-1', energy: 'd4-1' },
        compartments: [
            compartment(['Command', 5, 1, 1]),
            compartment(['Engineering', 7, 2, 2]),
            compartment(['Engineering 2', 6, 3, 4]),
            compartment(['Auxiliary', 5, 5, 6]),
            compartment(['Cargo', 2, 7, 9]),
            compartment(['Cargo', 3, 10, 12]),
            compartment(['Cargo', 2, 13, 16]),
            compartment(['Cargo', 2, 17, 20]),
        ],
        weapons: [weapon({
            name: 'CHE missile rack', range: '', ordinary: 'd8s', good: 'd6+1w', amazing: 'd4m',
            type: 'lowImpact', notes: 'The compartment table does not say which space it is mounted in.',
        })],
        notes: '<p>Cannot enter atmosphere; meets shuttles in orbit and carries cargo or '
            + 'passengers to other places in the star system. Drivespace fitting is a PL 7 '
            + 'refit costing $1,000,000.</p>',
        provenance: { book: PHB, reference: 'Ch.12 "Vehicles", PL 6', folder: "Player's Handbook" },
    },
    {
        name: 'Cutter', hullType: 'Cutter', hullCategory: 'Military',
        hullSize: 20, progressLevel: 7,
        engineType: 'Induction engine',
        power: { generated: 0, plantText: 'Mass reactor' },
        ftl: { driveType: 'Stardrive', drivespace: 10 },
        armor: { grade: 'Moderate', material: 'neutronite', lowImpact: 'd6+1', highImpact: 'd6+1', energy: 'd6' },
        compartments: [
            compartment(['Command', 4, 1, 2]),
            compartment(['Engineering', 10, 3, 5]),
            compartment(['Weapon', 3, 6, 12]),
            compartment(['Auxiliary', 3, 13, 20]),
        ],
        weapons: [weapon({
            name: 'Plasma cannon', comp: 3, arc: 'Fore',
            ordinary: 'd6+2w', good: 'd8+2w', amazing: 'd6+1m', type: 'energy',
        })],
        defenses: [defense({
            name: 'Deflection inducer', effect: DEFENSE_TEXT['Deflection inducer'], notes: NOT_ITEMISED,
        })],
        notes: '<p>A small warship built for high speed and long endurance. A stabilizer gives '
            + 'the helmsman a -1 step bonus on Vehicle Operation-space vehicle checks. '
            + 'Stardrive-capable cutters ("drive cutters") cost $500,000 more.</p>',
        provenance: { book: PHB, reference: 'Ch.12 "Vehicles", PL 7', folder: "Player's Handbook" },
    },
    {
        name: 'Escape Pod', hullType: 'Escape pod', hullCategory: 'Civilian',
        hullSize: 2, progressLevel: 7,
        ftl: { driveType: 'None', drivespace: 0 },
        armor: { grade: 'Light', material: 'polymeric', lowImpact: 'd4-1', highImpact: 'd4-1', energy: 'd4-2' },
        berthing: 8,
        compartments: [compartment(['Command', 2, 1, 20])],
        notes: '<p>A small sphere for up to eight people, with four weeks of food, water and '
            + 'environment supplies. No engine, but a continuous-broadcast beacon that can be '
            + 'traced.</p>',
        provenance: { book: PHB, reference: 'Ch.12 "Vehicles", PL 7', folder: "Player's Handbook" },
    },
    {
        name: 'Launch', hullType: 'Launch', hullCategory: 'Civilian',
        hullSize: 8, progressLevel: 7,
        engineType: 'Ion engine (PL 6)',
        power: { generated: 0, plantText: 'Mass reactor' },
        // "Drivespace (if applicable): 5" - launches are not usually fitted with stardrives,
        // so the rating is recorded while the drive itself is not fitted.
        ftl: { driveType: 'None', drivespace: 5 },
        armor: { grade: 'Light', material: 'polymeric', lowImpact: 'd4-1', highImpact: 'd4-1', energy: 'd4-2' },
        berthing: 12,
        compartments: [
            compartment(['Command', 3, 1, 7]),
            compartment(['Engineering', 5, 8, 20]),
        ],
        notes: '<p>A lifeboat: light, space-only, good for interplanetary runs of 100 million '
            + 'kilometres or so, and carried in one compartment of a larger ship. Launches are '
            + 'not usually fitted with stardrives, but rate 5 light-years per starfall if one '
            + 'is installed.</p>',
        provenance: { book: PHB, reference: 'Ch.12 "Vehicles", PL 7', folder: "Player's Handbook" },
    },
    {
        name: 'Trader', hullType: 'Trader', hullCategory: 'Civilian',
        hullSize: 24, progressLevel: 7,
        engineType: 'Ion engine (PL 6)',
        power: { generated: 0, plantText: 'Mass reactor' },
        ftl: { driveType: 'Stardrive', drivespace: 5 },
        armor: { grade: 'Moderate', material: 'cerametal', lowImpact: 'd4+1', highImpact: 'd4+1', energy: 'd4+1' },
        berthing: 12,
        compartments: [
            compartment(['Command', 4, 1, 2]),
            compartment(['Engineering', 8, 3, 4]),
            compartment(['Auxiliary', 4, 5, 7]),
            compartment(['Weapons', 3, 8, 10]),
            compartment(['Cargo', 3, 11, 15]),
            compartment(['Cargo', 2, 16, 20]),
        ],
        weapons: [weapon({
            name: 'Mass cannon', comp: 4, arc: 'Fore',
            ordinary: 'd6+2s', good: 'd6+1w', amazing: 'd6+3w', type: 'lowImpact',
        })],
        defenses: [defense({
            name: 'Point-defense gun', effect: DEFENSE_TEXT['Point-defense gun'], notes: NOT_ITEMISED,
        })],
        notes: '<p>The tramp freighter, and usually the ship of choice for spacefaring heroes: '
            + 'smaller and faster than a transport, handled by one or two experienced space '
            + 'hands, and able to carry ten more. A drive trader costs $750,000 more.</p>',
        provenance: { book: PHB, reference: 'Ch.12 "Vehicles", PL 7', folder: "Player's Handbook" },
    },
    {
        name: 'Transport', hullType: 'Transport', hullCategory: 'Civilian',
        hullSize: 40, progressLevel: 7,
        engineType: 'Ion engine (PL 6)',
        power: { generated: 0, plantText: 'Mass reactor' },
        ftl: { driveType: 'Stardrive', drivespace: 5 },
        armor: { grade: 'Moderate', material: 'alloy', lowImpact: 'd4+1', highImpact: 'd4+1', energy: 'd4' },
        berthing: 16,
        compartments: [
            compartment(['Command', 3, 1, 1]),
            compartment(['Engineering', 9, 2, 2]),
            compartment(['Auxiliary', 8, 3, 3]),
            compartment(['Weapons', 3, 4, 4]),
            compartment(['Passenger quarters', 3, 5, 6]),
            compartment(['Crew quarters', 2, 7, 8]),
            compartment(['Cargo', 3, 9, 10]),
            compartment(['Cargo', 3, 11, 13]),
            compartment(['Cargo', 3, 14, 16]),
            compartment(['Cargo', 3, 17, 20]),
        ],
        weapons: [weapon({
            name: 'IR laser', comp: 4, arc: 'Fore',
            ordinary: 'd4+1s', good: 'd4+1w', amazing: 'd6+1w', type: 'energy',
        })],
        notes: '<p>One of the most common spacecraft anywhere: a two- to four-person crew, a '
            + 'dozen passengers, and high-density or high-value cargo. A stardrive is a '
            + '$1,000,000 option.</p>',
        provenance: { book: PHB, reference: 'Ch.12 "Vehicles", PL 7', folder: "Player's Handbook" },
    },
    {
        name: 'Yacht', hullType: 'Yacht', hullCategory: 'Civilian',
        hullSize: 24, progressLevel: 7,
        engineType: 'Induction engine',
        power: { generated: 0, plantText: 'Grav-fusion cell' },
        ftl: { driveType: 'Stardrive', drivespace: 10 },
        armor: { grade: 'Moderate', material: 'cerametal', lowImpact: 'd4+1', highImpact: 'd4+1', energy: 'd4+1' },
        berthing: 12,
        compartments: [
            // The command compartment's rating was destroyed in the scan; the other five
            // leave exactly 5 of the hull's 24 points, so 10/10/5 is forced, not chosen.
            compartment(['Command', 5, 1, 2]),
            compartment(['Engineering', 5, 3, 4]),
            compartment(['Auxiliary', 5, 5, 7]),
            compartment(['Passenger quarters', 3, 8, 10]),
            compartment(['Passenger quarters', 3, 11, 15]),
            compartment(['Cargo', 3, 16, 20]),
        ],
        weapons: [weapon({
            name: 'X-ray laser', arc: 'Fore',
            ordinary: 'd6+1s', good: 'd4+2w', amazing: 'd4m', type: 'energy',
            notes: 'The compartment table does not say which space it is mounted in.',
        })],
        notes: '<p>A small spacefaring palace: minimally armed, often fitted with the finest '
            + 'engines available, with quarters for a small crew of space hands, cooks and '
            + 'valets and four to eight passengers in private cabins. A drive yacht costs '
            + '$750,000 more.</p>',
        provenance: {
            book: PHB, reference: 'Ch.12 "Vehicles", PL 7', folder: "Player's Handbook",
            scanDamage: 'The command compartment\'s durability rating was unreadable and is '
                + 'recovered from the hull-size sum.',
        },
    },
    {
        name: 'Space Fighter', hullType: 'Space fighter', hullCategory: 'Military',
        hullSize: 10, progressLevel: 8,
        engineType: 'Anomaly inducer',
        power: { generated: 0, plantText: 'Matter converter' },
        ftl: { driveType: 'Drivewave', drivespace: 25 },
        armor: { grade: 'Moderate', material: 'nanofluidic', lowImpact: '2d4', highImpact: '2d4', energy: '2d4' },
        berthing: 2,
        compartments: [
            compartment(['Command', 4, 1, 7]),
            compartment(['Engineering', 6, 8, 20]),
        ],
        weapons: [weapon({
            name: 'Kinetic lance', comp: 1, arc: 'Fore',
            ordinary: 'd4+1w', good: '2d4w', amazing: 'd4+3m', type: 'highImpact',
        })],
        defenses: [defense({ name: 'Displacer', effect: DEFENSE_TEXT.Displacer, notes: NOT_ITEMISED })],
        notes: '<p>A one- or two-seat fighter. Drivewave units and anomaly inducers let a craft '
            + 'this small both cross the stars and fight. The drive version costs $1,000,000 '
            + 'more.</p>',
        provenance: { book: PHB, reference: 'Ch.12 "Vehicles", PL 8', folder: "Player's Handbook" },
    },
];

// ---------------------------------------------------------------------------
// StarDrive Arms & Equipment Guide - the Solar X Shipyards catalogue
// ---------------------------------------------------------------------------
const AEG = 'StarDrive Arms & Equipment Guide';
const AEG_FOLDER = 'Solar X Shipyards';

const AEG_SHIPS = [
    {
        name: 'Hermes-class Courier', hullType: 'Courier', hullCategory: 'Civilian',
        hullSize: 16, progressLevel: 7, cost: '$2,395,000',
        maneuverRating: 1, acceleration: 3, cruisingSpeed: 2, berthing: 14,
        engineType: 'Induction engine',
        power: { generated: 25, plantText: 'Mass reactor rated at 25 power factors' },
        ftl: { driveType: 'None', drivespace: 0 },
        armor: { grade: 'Light', material: 'cerametal', lowImpact: 'd6-1', highImpact: 'd6-1', energy: 'd6-1' },
        computer: { coreQuality: 'Ordinary', dedicatedText: 'Ordinary navigation dedicated computer' },
        compartments: [
            compartment(['Command', 5, 1, 4]),
            compartment(['Engineering', 4, 5, 7]),
            compartment(['Auxiliary', 4, 8, 12]),
            compartment(['Crew', 3, 13, 20]),
        ],
        weapons: [weapon({
            name: 'Plasma cannon', comp: 1, dur: 3, power: 3, arc: 'Fore', range: '4/8/16 Mm',
            ordinary: 'd6+2w', good: 'd8+2w', amazing: 'd6+1m', type: 'energy',
        })],
        defenses: [
            defense({ name: 'Chaff', comp: 1, dur: 1, active: true, effect: DEFENSE_TEXT.Chaff }),
            defense({ name: 'Jammer', effect: DEFENSE_TEXT.Jammer, notes: NOT_ITEMISED }),
        ],
        systems: [
            system(['Laser transceiver', 1, 0, 1, 'Communications']),
            system(['Radio transceiver', 1, 0, 1, 'Communications']),
            system(['Airlock', 1, 0, 0, 'Misc']),
            system(['Ordinary computer core', 1, 1, 0, 'Computer']),
            system(['Induction engine', 2, 4, 4, 'Engine']),
            system(['Autosupport', 2, 0, 1, 'Life Support']),
            system(['Reentry capsule', 2, 0, 0, 'Misc']),
            system(['Mass reactor', 3, 4, 0, 'Power Plant']),
            system(['Crew quarters', 4, 1, 0, 'Crew'], 'Six hands.'),
            system(['Passenger suite', 4, 2, 0, 'Crew'], 'Staterooms for two passengers.'),
        ],
        notes: '<p>Small and fast, built for high-speed interplanetary passenger and mail runs, '
            + 'and carried by larger warships as a captain\'s gig or crew shuttle. Too small to '
            + 'carry an interstellar drive, but small enough to hitch a ride with any driveship. '
            + 'A new hull takes 6d4 weeks to build and outfit.</p>',
        provenance: { book: AEG, reference: 'Solar X Shipyards', folder: AEG_FOLDER },
    },
    {
        name: 'Nike-class Gunboat', hullType: 'Gunboat', hullCategory: 'Military',
        hullSize: 40, progressLevel: 7, cost: '$10,435,000',
        maneuverRating: 0, acceleration: 2, cruisingSpeed: 1.5, berthing: 12,
        engineType: 'Induction engine',
        power: { generated: 25, plantText: '3 mass reactors rated at 25 power factors' },
        ftl: { driveType: 'None', drivespace: 0 },
        armor: { grade: 'Moderate', material: 'neutronite', lowImpact: 'd6+1', highImpact: 'd6+1', energy: 'd6' },
        computer: {
            coreQuality: 'Good',
            dedicatedText: 'Good battle and sensor; Ordinary engineering and navigation',
        },
        compartments: [
            compartment(['Command', 4, 0, 0]),
            compartment(['Engineering 1', 8, 1, 2]),
            compartment(['Auxiliary', 4, 3, 4]),
            compartment(['Weapons 1', 5, 5, 6]),
            compartment(['Electronics', 4, 7, 9]),
            compartment(['Auxiliary 2', 4, 10, 12]),
            compartment(['Weapons 2', 5, 13, 16]),
            compartment(['Cargo', 2, 17, 20]),
        ],
        weapons: [
            weapon({
                name: 'Mass cannon', comp: 4, dur: 2, power: 3, arc: 'Fore', range: '5/10/15 Mm',
                ordinary: 'd6+2s', good: 'd6+1w', amazing: 'd6+3w', type: 'lowImpact',
            }),
            weapon({
                name: 'Mass cannon', comp: 7, dur: 2, power: 3, arc: 'Fore', range: '5/10/15 Mm',
                ordinary: 'd6+2s', good: 'd6+1w', amazing: 'd6+3w', type: 'lowImpact',
            }),
            weapon({
                name: 'Launch tube', comp: 3, dur: 3, power: 1, arc: 'Fore',
                notes: 'Ten of the ship\'s twenty missiles (8 CHE, 8 ARN, 4 SMP across both tubes). '
                    + 'Damage is the missile\'s, not the tube\'s.',
            }),
            weapon({
                name: 'Launch tube', comp: 7, dur: 3, power: 1, arc: 'Fore',
                notes: 'The other ten missiles. Damage is the missile\'s, not the tube\'s.',
            }),
        ],
        defenses: [
            defense({
                name: 'Deflection inducer', comp: 4, dur: 2, power: 4,
                effect: DEFENSE_TEXT['Deflection inducer'],
            }),
            defense({ name: 'Jammer', comp: 5, dur: 0, power: 1, effect: DEFENSE_TEXT.Jammer }),
        ],
        systems: [
            system(['Multiband radar', 1, 0, 0, 'Sensors']),
            system(['Airlock', 1, 0, 0, 'Misc']),
            system(['Good computer core', 1, 2, 0, 'Computer']),
            system(['Crew quarters', 1, 2, 0, 'Crew']),
            system(['Reentry capsule', 1, 0, 0, 'Misc']),
            system(['Induction engine', 2, 4, 4, 'Engine']),
            system(['Mass reactor', 2, 4, 0, 'Power Plant']),
            system(['Autosupport', 3, 0, 2, 'Life Support']),
            system(['EM detector', 5, 0, 0, 'Sensors']),
            system(['Mass reactor', 5, 2, 0, 'Power Plant']),
            system(['Mass transceiver', 5, 1, 1, 'Communications']),
            system(['Mass reactor', 6, 4, 0, 'Power Plant']),
            system(['Cargo space', 8, 2, 0, 'Cargo']),
        ],
        notes: '<p>The largest and most powerful patrol craft built by a private shipyard '
            + 'outside the Tendril system, and a common sight defending corporate outposts in '
            + 'lawless systems. With twenty missiles and two mass cannons the Nike can outslug '
            + 'almost any noncapital ship, but it is not fast and it is short-ranged. No '
            + 'stardrive: this is a system defence ship.</p>',
        provenance: {
            book: AEG, reference: 'Solar X Shipyards', folder: AEG_FOLDER,
            scanDamage: 'The compartment table was scrambled, losing one compartment\'s name and '
                + 'band and detaching several system rows. Band 10-12 and the durability values '
                + 'are recovered from the hull-size sum; the systems are placed in the only '
                + 'compartments large enough to hold them.',
        },
    },
    {
        name: 'Solar X Gull', hullType: 'Launch', hullCategory: 'Civilian',
        hullSize: 8, progressLevel: 7, cost: '$1,425,000',
        maneuverRating: -1, acceleration: 3, cruisingSpeed: 2, berthing: 0,
        engineType: 'Induction engine',
        power: { generated: 5, plantText: 'Mass reactor rated at 5 power factors' },
        ftl: { driveType: 'None', drivespace: 0 },
        armor: { grade: 'Moderate', material: 'cerametal', lowImpact: 'd4+1', highImpact: 'd4+1', energy: 'd4+1' },
        computer: { coreQuality: 'Marginal', dedicatedText: '' },
        compartments: [
            compartment(['Command', 3, 1, 6]),
            compartment(['Engineering', 4, 7, 20]),
        ],
        weapons: [weapon({
            name: 'Mass cannon', comp: 1, dur: 2, power: 3, arc: 'Fore', range: '5/10/15 Mm',
            ordinary: 'd6+2s', good: 'd6+1w', amazing: 'd6+3w', type: 'lowImpact',
        })],
        defenses: [defense({ name: 'Jammer', comp: 1, dur: 0, power: 1, effect: DEFENSE_TEXT.Jammer })],
        systems: [
            system(['Multiband radar', 1, 0, 0, 'Sensors']),
            system(['Configurable section', 1, 1, 0, 'Crew'],
                'One point of crew quarters (6 hands), passenger section (4 passengers) or cargo '
                + 'hold (~30 cubic metres). Four hours to re-partition.'),
            system(['Induction engine', 2, 2, 2, 'Engine']),
            system(['Autosupport', 2, 0, 1, 'Life Support']),
        ],
        notes: '<p>One of the smallest interplanetary craft built anywhere, usually carried as a '
            + 'ship\'s boat. Quick and responsive, and capable of supporting its crew for weeks, '
            + 'but notoriously underpowered - its installed systems draw 7 power factors against '
            + 'a plant rated for 5, so the crew cannot run everything at once.</p>',
        provenance: {
            book: AEG, reference: 'Solar X Shipyards', folder: AEG_FOLDER,
            scanDamage: 'The second hit band printed as "7-12", which leaves faces 13-20 hitting '
                + 'nothing; read as 7-20 so the d20 table is complete. The engineering '
                + 'compartment\'s rating is recovered from the hull-size sum.',
            printedArmorDurabilityCost: 1,
        },
    },
];

// ---------------------------------------------------------------------------
// StarDrive Campaign Setting - named ships of the Verge
// ---------------------------------------------------------------------------
const SCS = 'StarDrive Campaign Setting';
const SCS_FOLDER = 'Ships of the Verge';

const SCS_SHIPS = [
    {
        name: 'The Blackguard', hullType: 'Vashon-class raider', hullCategory: 'Military',
        hullSize: 32, progressLevel: 7,
        maneuverRating: 0, acceleration: 2, cruisingSpeed: 1.5, berthing: 18,
        engineType: 'Induction engine',
        power: { generated: 0, plantText: 'Mass reactor' },
        ftl: { driveType: 'Stardrive', drivespace: 0 },
        compartments: [
            compartment(['Command', 4, 0, 0]),
            compartment(['Engineering 1', 6, 1, 2]),
            compartment(['Engineering 2', 3, 3, 4]),
            compartment(['Auxiliary', 6, 5, 6]),
            compartment(['Crew', 3, 7, 9]),
            compartment(['Weapons 1', 4, 10, 12]),
            compartment(['Weapons 2', 3, 13, 16]),
            compartment(['Cargo', 3, 17, 20]),
        ],
        weapons: [
            weapon({
                name: 'Launch tube', comp: 6, arc: 'Fore',
                notes: 'Fifteen MBB missiles. Damage is the missile\'s, not the tube\'s. The '
                    + 'statblock prints no durability or power cost for the tube.',
            }),
            weapon({
                name: 'Mass cannon in turret', comp: 7, dur: 3, power: 3, arc: 'Turret',
                range: '5/10/15 Mm',
                ordinary: 'd6+2s', good: 'd6+1w', amazing: 'd6+3w', type: 'lowImpact',
            }),
        ],
        systems: [
            system(['Mass detector', 1, 1, 0, 'Sensors']),
            system(['Multiband radar', 1, 0, 0, 'Sensors']),
            system(['Crew quarters', 1, 2, 0, 'Crew']),
            system(['3x Induction engine', 2, 6, 6, 'Engine']),
            system(['Stardrive', 3, 3, 0, 'FTL Drive']),
            system(['Mass reactor', 4, 6, 0, 'Power Plant']),
            system(['Airlock', 5, 0, 0, 'Misc']),
            system(['Boarding pod', 5, 2, 0, 'Misc']),
            system(['Cargo hold', 8, 3, 0, 'Cargo']),
        ],
        notes: '<p>The personal ship of Devriele Shanassin, corsair lord of the Lucullus system, '
            + 'flown out of the hidden mobile base Icewalk. A boarding pod and a fifteen-missile '
            + 'launch tube say what it is for.</p><p>The statblock prints no armour, no defences '
            + 'and no power rating, so the ship shows an unpowered plant on the sheet - that is '
            + 'the source, not a conversion loss. Its compartments sum to the full 32 durability '
            + 'points, which agrees with carrying no armour.</p>',
        provenance: {
            book: SCS, reference: 'Lucullus system', folder: SCS_FOLDER,
            scanDamage: 'The engineering-2 compartment printed as "8/6/3", which is not a legal '
                + '2n/2n/n triple; read as 6/6/3, which the hull-size sum confirms.',
        },
    },
    {
        name: 'The Sirocco', hullType: 'Trader', hullCategory: 'Civilian',
        hullSize: 24, progressLevel: 7,
        maneuverRating: -1, acceleration: 3, cruisingSpeed: 2, berthing: 6,
        engineType: 'Induction engine',
        power: { generated: 15, plantText: 'Mass reactor rated at 15 power factors' },
        ftl: { driveType: 'None', drivespace: 0 },
        armor: { grade: 'Moderate', material: 'neutronite', lowImpact: 'd6+1', highImpact: 'd6+1', energy: 'd6' },
        compartments: [
            compartment(['Command', 3, 1, 3]),
            compartment(['Electronics', 3, 4, 6]),
            compartment(['Auxiliary', 6, 7, 9]),
            compartment(['Engineering', 6, 10, 14]),
            compartment(['Weapons', 4, 15, 20]),
        ],
        weapons: [weapon({
            name: '2x mass cannon', comp: 5, dur: 4, power: 6, arc: 'Fore', range: '5/10/15 Mm',
            ordinary: 'd6+2s', good: 'd6+1w', amazing: 'd6+3w', type: 'lowImpact',
        })],
        defenses: [
            defense({ name: 'Jammer', effect: DEFENSE_TEXT.Jammer, notes: NOT_ITEMISED }),
            defense({ name: 'Point-defense gun', effect: DEFENSE_TEXT['Point-defense gun'], notes: NOT_ITEMISED }),
        ],
        systems: [
            system(['Sick bay', 1, 2, 0, 'Misc']),
            system(['Crew quarters', 1, 1, 0, 'Crew']),
            system(['EM detector', 2, 0, 0, 'Sensors']),
            system(['Radio transceiver', 2, 0, 1, 'Communications']),
            system(['Computer core', 2, 1, 0, 'Computer']),
            system(['Mass reactor', 3, 6, 0, 'Power Plant']),
            system(['Autosupport', 3, 0, 1, 'Life Support']),
            system(['3x Induction engine', 4, 6, 6, 'Engine']),
        ],
        notes: '<p>A refitted Buckley-class trader: two mass cannons, a jammer and a '
            + 'point-defence gun on a hull built for cargo. No stardrive.</p>',
        provenance: {
            book: SCS, reference: 'Lucullus system', folder: SCS_FOLDER,
            scanDamage: 'The compartment table lost its band labels and the command '
                + 'compartment\'s rating. The bands and ratings are recovered from the hull-size '
                + 'sum, and the split of systems between the command and electronics spaces is '
                + 'confirmed by the installed power draw coming to 14 of the plant\'s 15 factors.',
        },
    },
    {
        name: 'Concord Blade-class Scout', hullType: 'Scout', hullCategory: 'Military',
        hullSize: 30, progressLevel: 7,
        maneuverRating: -1, acceleration: 3, cruisingSpeed: 2, berthing: 12,
        engineType: 'Induction engine',
        power: { generated: 15, plantText: '2 mass reactors rated for a total of 15 power factors' },
        ftl: { driveType: 'Stardrive', drivespace: 5 },
        armor: { grade: 'Moderate', material: 'neutronite', lowImpact: 'd6+1', highImpact: 'd6+1', energy: 'd6' },
        computer: { coreQuality: 'Good', dedicatedText: 'Good navigation and sensors dedicated computers' },
        compartments: [
            // The whole durability column was destroyed. Each compartment carries the sum of
            // the durability costs of the systems printed inside it - a floor read off the
            // page - which leaves 2 of the hull's 27 available points unassigned.
            compartment(['Command', 3, 1, 2]),
            compartment(['Engineering', 9, 3, 4]),
            compartment(['Auxiliary', 4, 5, 7]),
            compartment(['Auxiliary 2', 3, 8, 10]),
            compartment(['Weapons', 4, 11, 14]),
            compartment(['Crew', 2, 15, 20]),
        ],
        weapons: [
            weapon({
                name: 'Mass cannon', comp: 5, dur: 2, power: 3, arc: 'Fore', range: '5/10/15 Mm',
                ordinary: 'd6+2s', good: 'd6+1w', amazing: 'd6+3w', type: 'lowImpact',
            }),
            weapon({
                name: 'Mass cannon', comp: 5, dur: 2, power: 3, arc: 'Fore', range: '5/10/15 Mm',
                ordinary: 'd6+2s', good: 'd6+1w', amazing: 'd6+3w', type: 'lowImpact',
            }),
        ],
        defenses: [defense({
            name: 'Point-defense gun', comp: 1, dur: 1, power: 1,
            effect: DEFENSE_TEXT['Point-defense gun'],
        })],
        systems: [
            system(['Good computer core', 1, 2, 0, 'Computer']),
            system(['Multiband radar', 1, 0, 0, 'Sensors']),
            system(['EM detector', 1, 0, 0, 'Sensors']),
            system(['Radio transceiver', 1, 0, 1, 'Communications']),
            system(['Reentry capsule', 1, 0, 0, 'Misc']),
            system(['Induction engine', 2, 6, 6, 'Engine']),
            system(['Stardrive', 2, 3, 0, 'FTL Drive']),
            system(['Airlock', 2, 0, 0, 'Misc']),
            system(['Mass reactor', 3, 4, 0, 'Power Plant']),
            system(['Autosupport', 3, 0, 2, 'Life Support']),
            system(['Mass reactor', 4, 2, 0, 'Power Plant']),
            system(['Airlock', 4, 1, 0, 'Misc']),
            system(['Crew quarters', 6, 2, 0, 'Crew']),
        ],
        notes: '<p>45.5 metres, 1,120 metric tons, 12 enlisted and 3 officers. The Concord\'s '
            + 'standard scout: a Good computer core with dedicated navigation and sensor '
            + 'computers, a stardrive, and two mass cannons for when looking is not enough.</p>'
            + '<p>The source table\'s durability column is unreadable. Each compartment here holds '
            + 'exactly the durability its printed systems cost, which leaves 2 points of the hull '
            + 'unassigned - the sheet will say so.</p>',
        provenance: {
            book: SCS, reference: "Oberon system", folder: SCS_FOLDER,
            scanDamage: 'The durability column was lost entirely. Compartment ratings are the '
                + 'sums of the printed system costs, not the printed ratings.',
        },
    },
    {
        name: 'Alaundril Lucre-class Escort', hullType: 'Escort', hullCategory: 'Military',
        hullSize: 50, progressLevel: 7, cost: '$11.3 M',
        maneuverRating: 1, acceleration: 1, cruisingSpeed: 1, berthing: 36,
        engineType: 'Induction engine',
        power: { generated: 20, plantText: '2 mass reactors rated for 20 power factors total' },
        ftl: { driveType: 'Stardrive', drivespace: 5 },
        armor: { grade: 'Moderate', material: 'neutronite', lowImpact: 'd6+1', highImpact: 'd6+1', energy: 'd6' },
        computer: { coreQuality: 'Ordinary', dedicatedText: 'Ordinary engineering and battle dedicated computers' },
        compartments: [
            compartment(['Command', 3, 0, 0]),
            compartment(['Engineering 1', 6, 0, 0]),
            compartment(['Engineering 2', 5, 1, 1]),
            compartment(['Auxiliary', 6, 2, 3]),
            compartment(['Weapons 1', 4, 4, 5]),
            compartment(['Weapons 2', 5, 6, 7]),
            compartment(['Electronics', 5, 8, 10]),
            compartment(['Crew 1', 4, 11, 13]),
            compartment(['Crew 2', 4, 14, 16]),
            compartment(['Cargo', 3, 17, 20]),
        ],
        weapons: [
            weapon({
                name: 'Turret: mass cannon', comp: 1, dur: 3, power: 3, arc: 'Turret',
                range: '5/10/15 Mm',
                ordinary: 'd6+2s', good: 'd6+1w', amazing: 'd6+3w', type: 'lowImpact',
                notes: 'The header lists two mass cannons; the compartment table itemises one mount.',
            }),
            weapon({
                name: 'Launch rack', comp: 5, dur: 2, power: 1, arc: 'Fore',
                notes: 'Half of the ship\'s 16 missiles (6 ARN, 8 CHE, 2 MAB across both racks). '
                    + 'Damage is the missile\'s, not the rack\'s.',
            }),
            weapon({
                name: 'Launch rack', comp: 6, dur: 2, power: 1, arc: 'Fore',
                notes: 'The other half of the missile load.',
            }),
        ],
        defenses: [
            defense({ name: 'Deflection inducer', effect: DEFENSE_TEXT['Deflection inducer'], notes: NOT_ITEMISED }),
            defense({ name: 'Jammer', effect: DEFENSE_TEXT.Jammer, notes: NOT_ITEMISED }),
            defense({ name: 'Chaff', active: true, effect: DEFENSE_TEXT.Chaff, notes: NOT_ITEMISED }),
        ],
        systems: [
            system(['Multiband radar', 1, 0, 0, 'Sensors']),
            system(['Induction engine', 2, 6, 6, 'Engine']),
            system(['Airlock', 2, 0, 0, 'Misc']),
            system(['Mass reactor', 3, 2, 0, 'Power Plant']),
            system(['Stardrive', 3, 3, 0, 'FTL Drive']),
            system(['Mass reactor', 4, 6, 0, 'Power Plant']),
            system(['Tractor beam', 5, 2, 0, 'Misc']),
            system(['Laser transceiver', 7, 0, 1, 'Communications']),
            system(['EM detector', 7, 0, 0, 'Sensors']),
            system(['Crew quarters', 8, 4, 0, 'Crew']),
            system(['Crew quarters', 9, 2, 0, 'Crew']),
            system(['Autocargo', 10, 3, 3, 'Cargo']),
        ],
        notes: '<p>The mainstay of Alaundril\'s defensive force, and for many years the only '
            + 'warship for sale to any system in the Verge. Forty-six have been built at the Ion '
            + 'Production shipyards at an average of $11.3 million each, with seven more on '
            + 'order. A few have fallen into pirate hands.</p><p>The command and first '
            + 'engineering spaces have no random-damage band, so a d20 can never single them '
            + 'out.</p>',
        provenance: {
            book: SCS, reference: 'Tendril system', folder: SCS_FOLDER,
            scanDamage: 'Two compartments lost their durability ratings; both are forced to 5 by '
                + 'the hull-size sum. Several system rows drifted between compartments and are '
                + 'placed in the spaces large enough to hold them.',
        },
    },
    {
        name: 'CSS Stingray', hullType: 'Cutter', hullCategory: 'Military',
        hullSize: 40, progressLevel: 7,
        maneuverRating: 0, acceleration: 2, cruisingSpeed: 1.5, berthing: 12,
        engineType: 'Induction engine',
        power: { generated: 20, plantText: '2 mass reactors rated at 10 power factors each' },
        ftl: { driveType: 'Stardrive', drivespace: 5 },
        armor: { grade: 'Moderate', material: 'cerametal', lowImpact: 'd4+1', highImpact: 'd4+1', energy: 'd4+1' },
        computer: { coreQuality: 'Ordinary', dedicatedText: 'Ordinary battle and navigation computers' },
        compartments: [
            compartment(['Command', 4, 0, 0]),
            compartment(['Engineering', 9, 1, 2]),
            compartment(['Auxiliary 1', 4, 3, 4]),
            compartment(['Auxiliary 2', 4, 5, 6]),
            compartment(['Electronics', 3, 7, 9]),
            compartment(['Cargo', 4, 10, 12]),
            compartment(['Weapons 1', 4, 13, 16]),
            compartment(['Weapons 2', 4, 17, 20]),
        ],
        weapons: [
            weapon({
                name: 'Plasma cannon in turret', comp: 7, dur: 4, power: 3, arc: 'Turret',
                range: '4/8/16 Mm',
                ordinary: 'd6+2w', good: 'd8+2w', amazing: 'd6+1m', type: 'energy',
            }),
            weapon({
                name: 'Plasma cannon in turret', comp: 8, dur: 4, power: 3, arc: 'Turret',
                range: '4/8/16 Mm',
                ordinary: 'd6+2w', good: 'd8+2w', amazing: 'd6+1m', type: 'energy',
            }),
        ],
        defenses: [
            defense({ name: 'Deflection inducer', effect: DEFENSE_TEXT['Deflection inducer'], notes: NOT_ITEMISED }),
            defense({ name: 'Jammer', effect: DEFENSE_TEXT.Jammer, notes: NOT_ITEMISED }),
        ],
        systems: [
            system(['Airlock', 1, 0, 0, 'Misc']),
            system(['Induction engine', 2, 6, 6, 'Engine'],
                'The scan dropped this row; the compartment\'s 9 durability points are 6 for the '
                + 'engine and 3 for the stardrive.'),
            system(['Stardrive', 2, 3, 0, 'FTL Drive']),
            system(['Autosupport', 3, 0, 1, 'Life Support']),
            system(['Mass reactor', 3, 4, 0, 'Power Plant']),
            system(['Autosupport', 4, 0, 1, 'Life Support']),
            system(['Mass reactor', 4, 4, 0, 'Power Plant']),
            system(['Mass detector', 5, 1, 0, 'Sensors']),
            system(['Airlock', 6, 1, 0, 'Misc']),
            system(['Cargo bay', 6, 3, 0, 'Cargo']),
        ],
        notes: '<p>Captain N\'drochi\'s ship: a battle-scarred Concord Manta-class cutter built at '
            + 'the Hale Memorial shipyards in the 2470s, blooded in the Rigunmor-Borealin '
            + 'skirmishes of 2481. Its twelve-person crew runs under communications silence and '
            + 'practices asteroid emulation - tumbling like a rock until a corsair\'s radio '
            + 'traffic gives the game away, then closing fast.</p>',
        provenance: {
            book: SCS, reference: 'Corrivale system', folder: SCS_FOLDER,
            scanDamage: 'The engineering compartment\'s rating and its induction engine row were '
                + 'both lost; the hull-size sum gives 9, which is exactly the engine plus the '
                + 'stardrive.',
        },
    },
    {
        name: 'Klick Attack Ship', hullType: 'Klick attack ship', hullCategory: 'Military',
        hullSize: 40, progressLevel: 7,
        maneuverRating: 0, acceleration: 2, cruisingSpeed: 2, berthing: 24,
        engineType: 'Induction engine',
        power: { generated: 20, plantText: '2 grav-fusion cells rated at 20 power factors' },
        ftl: { driveType: 'None', drivespace: 0 },
        armor: { grade: 'Moderate', material: '[unknown]', lowImpact: 'd6+1', highImpact: 'd6+1', energy: 'd6+2' },
        computer: { coreQuality: 'Marginal', dedicatedText: '' },
        compartments: [
            compartment(['Engineering 1', 5, 0, 0]),
            compartment(['Command', 4, 1, 2], { damageControl: 'Good' }),
            compartment(['Engineering 2', 6, 3, 4]),
            compartment(['Auxiliary', 5, 5, 6]),
            compartment(['Cargo', 2, 7, 9]),
            compartment(['Crew', 4, 10, 12]),
            compartment(['Weapons 1', 5, 13, 16]),
            compartment(['Weapons 2', 5, 17, 20]),
        ],
        weapons: [
            weapon({
                name: 'Turret: particle beam', comp: 7, dur: 5, power: 5, arc: 'Turret',
                range: '6/12/18 Mm',
                ordinary: 'd6+3s', good: 'd4+1m', amazing: 'd4+3m', type: 'energy',
            }),
            weapon({
                name: 'Turret: particle beam', comp: 8, dur: 5, power: 5, arc: 'Turret',
                range: '6/12/18 Mm',
                ordinary: 'd6+3s', good: 'd4+1m', amazing: 'd4+3m', type: 'energy',
            }),
        ],
        defenses: [
            defense({ name: 'Jammer', effect: DEFENSE_TEXT.Jammer, notes: NOT_ITEMISED }),
            defense({
                name: 'Damage control (Good)', comp: 2, dur: 2, power: 2,
                effect: 'A -2 step bonus to the command compartment\'s durability checks.',
            }),
        ],
        systems: [
            system(['Grav-fusion cell', 1, 5, 0, 'Power Plant']),
            system(['Mass detector', 2, 1, 1, 'Sensors']),
            system(['Airlock', 2, 0, 0, 'Misc']),
            system(['Induction engine', 3, 6, 6, 'Engine']),
            system(['Grav-fusion cell', 4, 5, 0, 'Power Plant']),
            system(['Fuel tank', 5, 2, 0, 'Cargo']),
            system(['Crew quarters', 6, 4, 0, 'Crew']),
        ],
        notes: '<p>The starship of the klicks - the pincered aliens the Concord Marines named for '
            + 'the sounds they make - encountered in the Hammer\'s Star system. Concord scientists '
            + 'cannot identify its armour, have not deciphered the crew\'s language, and have '
            + 'classified the species as external to every charted system.</p><p>The first '
            + 'engineering space carries no random-damage band, so a d20 cannot single it '
            + 'out.</p>',
        provenance: { book: SCS, reference: "Hammer's Star system", folder: SCS_FOLDER },
    },
];

export function convert() {
    return [...PHB_SHIPS, ...AEG_SHIPS, ...SCS_SHIPS].map(spec => {
        const assigned = spec.compartments.reduce((sum, c) => sum + c.durability, 0);
        const overBudget = assigned - armorAvailable(spec);

        const extraRows = [
            ['Compartment durability assigned', `${assigned} of ${spec.hullSize}`],
        ];
        if (spec.provenance.scanDamage) extraRows.push(['Scan damage', spec.provenance.scanDamage]);

        return ship({
            ...spec,
            description: shipStatBlock(spec, extraRows),
            notes: (spec.notes ?? '') + overBudgetNote(spec, overBudget),
        });
    });
}

/** Durability left for compartments once armour is mounted (GM Guide Ch.11, "Armor"). */
function armorAvailable(spec) {
    const fraction = { None: 0, Light: 0, Moderate: 0.1, Heavy: 0.2 }[spec.armor?.grade ?? 'None'];
    return spec.hullSize - Math.floor(spec.hullSize * fraction);
}

/**
 * The Player's Handbook prints an armour rating but never charges durability for it, so
 * its Moderate-armoured ships assign more durability than the GM Guide's budget allows.
 * Rather than silently trim a printed rating, the ship says why its sheet reads over.
 */
function overBudgetNote(spec, over) {
    if (over <= 0) return '';
    return `<p><em>Budget note:</em> the compartments assign ${over} durability point`
        + `${over === 1 ? '' : 's'} more than the GM Guide leaves after ${spec.armor.grade} armour `
        + 'is mounted. The Player\'s Handbook statblocks print an armour rating without charging '
        + 'durability for it, so this is the source as printed, not a transcription error.</p>';
}
