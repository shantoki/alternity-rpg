/**
 * @file tools/convert/vehicles.mjs
 * @description Player's Handbook **Table P42: Vehicles** -> `vehicle` Actors.
 *
 * Like the two ship converters, this one has no input file. The character generator's
 * data set has no vehicles in it, and the only vehicle statistics the core rules print
 * are the forty-two rows of Table P42 (PHB Ch.12, p.194-195). So the table is
 * transcribed here as literal data and `NEEDS_SOURCE_DATA` is false.
 *
 * ## Where the numbers came from
 *
 * `../alternity-md/Alternity Player's Handbook.md` is useless for this one table: the
 * OCR collapsed the entire ten-column grid into a single mangled cell (search the file
 * for "Bicycle Cabin cruiser Motorcar"). The rows below were read off the page scan
 * instead. Two independent checks say the reading is right:
 *
 *   - The PHB's own worked example for a durability check says "a mid-sized car with
 *     10 stun points needs a 10 or less"; the table row here is `10/10/5`.
 *   - The STG shuttle's prose statblock says "Hull size 16, 4 compartments"; the table
 *     row here is `Hull 16/4`.
 *
 * The surviving OCR fragments corroborate the rest of the Dur column - "Hull 1/1",
 * "H ull 21" (2/1), "Hull B2" (8/2), "Hull 4010" (40/10), "Hull 24/6", "Hull 32/8".
 *
 * ## The one column that is inferred rather than transcribed
 *
 * `scale`. Table P45 (Vehicle Scales) is an image in the scan and did not survive at
 * all, so the four scales are known from the surrounding prose ("Personal vs Surface",
 * "Air vs Space") but their per-vehicle assignment is not. The scale here is therefore
 * derived mechanically from the printed Skill column - land/water to Surface, air to
 * Air, space to Space, Daredevil to Personal - and the two rows that print no skill at
 * all (reentry capsule, escape pod) are called Space, being spacecraft. That is an
 * inference, and it is the only one in this file.
 *
 * ## What is deliberately left empty
 *
 * `weapons`. Four descriptions name a mounted gun, but every one of those damage codes
 * is OCR-damaged past the point of honesty - "(244w/3d4w/ 2d4m, HIG)" and
 * "(48+1w/d8m/d12+2m, HV/A)" - and the chain gun's sentence is orphaned at a page break
 * so it cannot even be attributed to a row with certainty. The printed text is carried
 * verbatim into the description instead, and the `weapons` array is left for a human
 * with the book open. Guessing a damage code would be worse than not having one.
 */

import { makeActor, statBlock } from '../lib/fvtt.mjs';

export const PACK = 'alternity-vehicles';

/** This pack comes out of the book, not out of `external/json`. */
export const NEEDS_SOURCE_DATA = false;

const BOOK = "Alternity Player's Handbook";
const TABLE = 'Table P42: Vehicles (Ch.12, p.194)';

/** Foundry core icons, kept to ones the other converters already ship. */
const IMG = {
    'Land vehicle':  'icons/svg/cart.svg',
    'Water vehicle': 'icons/svg/water.svg',
    'Air vehicle':   'icons/svg/wing.svg',
    'Space vehicle': 'icons/svg/sun.svg',
    'Daredevil':     'icons/svg/upgrade.svg',
    'None':          'icons/svg/item-bag.svg',
};

/** The Skill column's abbreviations, expanded to the schema's choice list. */
const SKILLS = {
    Land:      'Land vehicle',
    Water:     'Water vehicle',
    Air:       'Air vehicle',
    Space:     'Space vehicle',
    Daredevil: 'Daredevil',
    '-':       'None',
};

/** The Type column: a toughness grade, not a classification. */
const TOUGHNESS = { O: 'Ordinary', G: 'Good', A: 'Amazing' };

/** The Avail column, spelled the way the gear schemas spell it. */
const AVAILABILITY = {
    Any: 'Any', Com: 'Common', Con: 'Controlled', Mil: 'Military', Res: 'Restricted',
};

/**
 * Skill -> Table P45 scale. The one inferred column in this file; see the header.
 * `None` covers the reentry capsule and the escape pod, which are spacecraft.
 */
const SCALES = {
    'Land vehicle':  'Surface',
    'Water vehicle': 'Surface',
    'Air vehicle':   'Air',
    'Space vehicle': 'Space',
    'Daredevil':     'Personal',
    'None':          'Space',
};

/** The Progress Level headers the table groups its rows under, used as folders too. */
const ERAS = {
    3: 'PL 0-3: Stone Age through Age of Reason',
    4: 'PL 4: Industrial Age',
    5: 'PL 5: Information Age',
    6: 'PL 6: Fusion Age',
    7: 'PL 7: Gravity Age',
    8: 'PL 8: Energy Age',
};

/**
 * Table P42, transcribed row for row in the table's own order.
 *
 * Columns: name, Skill, Drv, Acc, Cruise, Max, Type, Dur, Avail, Cost.
 * A dash is the table's own blank. Speeds are kept as printed strings because the
 * column mixes kph, Megameters per phase per phase (M) and AU per hour; the footnote
 * reads "K = thousands   M = Megameters per phase per phase   AU = Astronomical Units
 * per hour". Costs are kept as printed for the same reason.
 */
const VEHICLES = [
    // ── PL 0-3: Stone Age through Age of Reason ──────────────────────────────
    ['Canoe',           3, 'Water',     '+1',   '2',   '10',    '18',  'O', '3/3/2',    'Any', '75'],
    ['Raft',            3, 'Water',     '+2',   '2',    '8',    '16',  'O', '3/3/2',    'Any', '50'],
    ['Rowboat',         3, 'Water',      '-',   '2',   '10',    '22',  'O', '5/5/2',    'Any', '100'],
    ['Sail',            3, 'Water',     '+1',   '2',   '10',    '15',  'O', '4/4/2',    'Any', '2000'],

    // ── PL 4: Industrial Age ─────────────────────────────────────────────────
    ['Bicycle',         4, 'Daredevil',  '-',   '8',   '28',    '40',  'O', '1/1/1',    'Any', '300'],
    ['Cabin cruiser',   4, 'Water',     '+1',   '6',   '16',    '30',  'G', '10/10/5',  'Any', '50K'],
    ['Motorcar',        4, 'Land',      '+1',  '30',   '50',    '80',  'O', '5/5/3',    'Any', '8000'],
    ['Motor yacht',     4, 'Water',     '-1',  '10',   '20',    '40',  'G', '6/6/3',    'Any', '80K'],
    ['Prop. plane',     4, 'Air',       '+1',  '20',  '200',   '400',  'O', '4/4/2',    'Com', '20K'],
    ['Speedboat',       4, 'Water',      '-',  '20',   '60',    '80',  'G', '6/6/3',    'Any', '12K'],
    ['Tank',            4, 'Land',      '+1',  '10',   '40',    '60',  'A', '20/20/10', 'Mil', '250K'],

    // ── PL 5: Information Age ────────────────────────────────────────────────
    ['Compact car',     5, 'Land',      '-1',  '40',  '100',   '130',  'O', '7/7/3',    'Com', '8000'],
    ['Executive jet',   5, 'Air',       '-1',  '50',  '500',  '1000',  'G', '10/10/5',  'Con', '250K'],
    ['Fighter jet',     5, 'Air',       '-1', '100',  '700',  '3000',  'G', '13/13/5',  'Mil', '1.2M'],
    ['Helicopter',      5, 'Air',       '+1',  '40',  '110',   '400',  'G', '10/10/5',  'Com', '80K'],
    ['Jet ski',         5, 'Water',     '-1',  '20',   '30',    '70',  'O', '3/3/2',    'Any', '14K'],
    ['Luxury car',      5, 'Land',      '+1',  '50',  '100',   '200',  'G', '11/11/5',  'Com', '45K'],
    ['Mid-sized car',   5, 'Land',       '-',  '50',  '100',   '180',  'G', '10/10/5',  'Com', '15K'],
    ['Motorcycle',      5, 'Land',      '+1',  '60',  '110',   '220',  'O', '4/4/2',    'Com', '15K'],
    ['Pickup truck',    5, 'Land',       '-',  '40',  '100',   '180',  'G', '15/15/7',  'Com', '18K'],
    ['Private jet',     5, 'Air',        '-',  '50',  '500',  '1000',  'G', '10/10/5',  'Con', '150K'],
    ['Semi',            5, 'Land',      '+1',  '20',  '100',   '160',  'G', '20/20/11', 'Com', '50K'],
    ['Snowmobile',      5, 'Land',       '-',  '20',   '40',    '90',  'O', '5/5/2',    'Any', '12K'],
    ['Sport utility',   5, 'Land',       '-',  '40',  '110',   '190',  'G', '17/17/8',  'Com', '30K'],
    ['Sports car',      5, 'Land',      '-2',  '60',  '130',   '320',  'G', '9/9/4',    'Com', '35K'],
    ['Ultralight',      5, 'Daredevil',  '-',  '10',   '60',   '100',  'O', '3/3/2',    'Any', '3000'],
    ['Van',             5, 'Land',      '+1',  '30',  '100',   '180',  'G', '16/16/8',  'Com', '25K'],

    // ── PL 6: Fusion Age ─────────────────────────────────────────────────────
    ['Electric car',    6, 'Land',      '-1',  '30',  '100',   '180',  'G', '10/10/5',  'Com', '15K'],
    ['Jetpack',         6, 'Daredevil', '+1',  '30',  '120',   '300',  'O', '4/4/2',    'Com', '15K'],
    ['Reentry capsule', 6, '-',          '-',   '-',    '-',     '-',  'G', 'Hull 1/1', 'Any', '5000'],
    ['Skybike',         6, 'Air',       '-2', '250',  '750',  '1500',  'O', '8/8/4',    'Com', '25K'],
    ['Skycar',          6, 'Air',       '-1', '200', '1000',  '3000',  'G', '11/11/5',  'Com', '50K'],
    ['Skytank',         6, 'Air',        '-', '100',  '500',  '2000',  'A', '25/25/12', 'Mil', '400K'],
    ['STG shuttle',     6, 'Space',      '-', '500',  '50K',     '-',  'A', 'Hull 16/4','Con', '400K'],
    ['System liner',    6, 'Space',      '-', '.03M', '.15AU',   '-',  'A', 'Hull 32/8','Con', '700K'],

    // ── PL 7: Gravity Age ────────────────────────────────────────────────────
    ['Cutter',          7, 'Space',     '-1', '2M',   '1.5AU',   '-',  'A', 'Hull 20/4', 'Mil', '1000K'],
    ['Escape pod',      7, '-',          '-',  '-',      '-',    '-',  'G', 'Hull 2/1',  'Any', '50K'],
    ['Launch',          7, 'Space',     '-1', '.05M', '.15AU',   '-',  'A', 'Hull 8/2',  'Any', '250K'],
    ['Trader',          7, 'Space',      '-', '.03M', '0.1AU',   '-',  'A', 'Hull 24/6', 'Con', '750K'],
    ['Transport',       7, 'Space',      '-', '.03M', '0.1AU',   '-',  'A', 'Hull 40/10','Con', '900K'],
    ['Yacht',           7, 'Space',      '-', '2M',   '1.5AU',   '-',  'A', 'Hull 24/6', 'Con', '900K'],

    // ── PL 8: Energy Age ─────────────────────────────────────────────────────
    ['Space fighter',   8, 'Space',     '-1', '4M',   '3AU',     '-',  'A', 'Hull 10/2', 'Res', '1200K'],
];

/**
 * Crew capacity, only where a description states one in so many words.
 *
 * Zero (the default) means the book does not say, which is a different statement from
 * "nobody" - so the rows with a range rather than a number ("three to eight
 * passengers" for the private jet, "a two-seater ... can seat six" for the skycar) are
 * left out rather than resolved to one end of the range.
 */
const CREW = {
    'Sail':            6,  // "A standard [sailboat holds] six people"
    'Cabin cruiser':   6,  // "provides bunking for up to six people"
    'Helicopter':      7,  // "holds a pilot and six passengers"
    'Jet ski':         2,  // "can carry two people over a body of water"
    'Motorcycle':      2,  // "room for the operator and one passenger"
    'Pickup truck':    3,  // "holds an operator and up to two passengers"
    'Snowmobile':      2,  // "The standard vehicle holds two people"
    'Van':             2,  // "seats for the operator and one passenger"
    'Jetpack':         1,  // "worn like a backpack on a secure harness"
    'Skybike':         1,  // "This single-person flying machine"
    'Reentry capsule': 1,  // "a personal emergency escape device"
};

/**
 * Armour, for the three vehicles whose description prints a die range per damage form.
 * Transcribed from the prose, not from the table - Table P42 has no armour column.
 */
const ARMOR = {
    // "heavy plates of cerametal armor (d8 (LI), d8 (HI), d8 (En)) are standard"
    'Skytank':     { type: 'Cerametal plate', lowImpact: 'd8', highImpact: 'd8', energy: 'd8' },
    // "Armor: light polymeric, d4-1 (LI), d4-1 (HI), d4-2 (En)"
    'STG shuttle': { type: 'Light polymeric', lowImpact: 'd4-1', highImpact: 'd4-1', energy: 'd4-2' },
    // "much thicker alloy [armor] d6+1 (HI), d6 (En)". The scan gives no LI figure for
    // the tank, so LI is left blank rather than assumed equal to HI.
    'Tank':        { type: 'Thick alloy', lowImpact: '', highImpact: 'd6+1', energy: 'd6' },
};

/**
 * The mounted-weapon sentences, verbatim including their OCR damage. Carried into the
 * description so nothing printed is lost, and deliberately *not* parsed into weapon
 * rows - see the file header.
 */
const WEAPON_TEXT = {
    'Skytank':     'A 120mm rail cannon (48+1w/d8m/d12+2m, HV/A) is standard. '
                 + '[Damage code as it survives in the scan; verify against the book before use.]',
    'Fighter jet': 'A 25mm chain gun (244w/3d4w/2d4m, HIG). '
                 + '[Damage code as it survives in the scan, and the sentence is orphaned at a '
                 + 'page break, so even the attribution to this row is uncertain.]',
};

/**
 * The descriptive paragraph, where the scan gives a clean one. Condensed to the
 * sentences that say something the table does not.
 */
const NOTES = {
    'Raft': 'A flat flotation device, usually logs tied together or pontoons on either side of a '
        + 'flat surface. On a shallow river the operator can pole it along.',
    'Rowboat': 'Works much like a canoe, but its size and shape make it more stable. A larger '
        + 'vessel with several rowers would have at least twice the listed durability.',
    'Sail': 'Any small boat powered by wind caught in a sail. Larger sailing vessels, up to a '
        + 'galleon, have much greater durability and can be fitted with weapons.',
    'Bicycle': 'A simple one-person multi-speed bike; two-wheeled vehicles come in many styles.',
    'Cabin cruiser': 'Bunking for up to six, and 500 kilometres between refuellings.',
    'Motorcar': 'The first automobile. Lacking aerodynamics and comfort, but cars quickly '
        + 'replaced animal power as the popular form of transport.',
    'Motor yacht': 'Combines the speedboat with the range of a cabin cruiser: days of travel at a '
        + 'respectable speed.',
    'Helicopter': 'A light utility helicopter holding a pilot and six passengers, with a range of '
        + 'about 500 kilometres per load of fuel.',
    'Jet ski': 'A recreation craft on most worlds, carrying two people over water. Range 100 '
        + 'kilometres.',
    'Luxury car': 'Any large, expensive automobile with plenty of accessories.',
    'Mid-sized car': 'A medium automobile of the type usually owned by ordinary families.',
    'Motorcycle': 'Room for the operator and one passenger.',
    'Pickup truck': 'A flatbed holding an operator and up to two passengers, plus cargo.',
    'Private jet': 'A small jet aircraft, usually with room for a pilot and three to eight '
        + 'passengers.',
    'Semi': 'A powerful cab and engine that can pull large trailers of various length and capacity.',
    'Snowmobile': 'Recreation and transport both; holds two people, and only works over snow or ice.',
    'Sport utility': 'A powerful, ruggedly styled all-wheel-drive vehicle that roves over many '
        + 'types of terrain.',
    'Sports car': 'A small, sleek automobile with a powerful engine and an aerodynamic design.',
    'Ultralight': 'A hang glider with a tiny engine. It weighs 50 kg, stows in a large '
        + 'backpack-style case, and has a range of 200 kilometres.',
    'Van': 'A panel van seats the operator and one passenger, with the open rear compartment for '
        + 'cargo. Delivery vans fall into this category.',
    'Electric car': 'Silent and easy to handle; runs 24 hours before an hour-long recharge. A '
        + 'turbo-capacitor (25K) raises acceleration to 60, at the cost of recharging every 12 hours.',
    'Jetpack': 'Low-heat, high-thrust engines give flight at up to 300 kph with a range of about '
        + '500 kilometres. It weighs 25 kg and is worn on a harness. The space-capable version is '
        + 'called a thruster: its practical maximum is 1,000 kph, which spends exactly half the '
        + 'fuel - the other half stops it again at the far end.',
    'Reentry capsule': 'A personal escape device about the size of an ejection seat, with 48 hours '
        + 'of air and rations, an emergency beacon, a survival kit, braking rockets, a parachute '
        + 'and an automatic flotation ring. It may run out of air coming down from a high orbit.',
    'Skybike': 'A single-person flyer using gravity induction. Transparent polymeric shielding, '
        + 'equivalent to attack armor, keeps the pilot from being buffeted.',
    'Skycar': 'Introduced late in PL 6 after gravity induction. A sport coupe is a two-seater with '
        + 'higher speed and better handling; a luxury sedan seats six but tops out at 2,000 kph '
        + 'with no Drv bonus.',
    'Skytank': 'Performs the functions of helicopters and jets, and serves as the backbone of '
        + 'ground assaults.',
    'STG shuttle': 'The space-to-ground shuttle moves people and cargo between a planet and orbit. '
        + 'A planetary thruster and a fusion generator let it reach orbital velocity like an '
        + 'airplane, without separate rockets. It cannot travel in deep space. Compartments: '
        + 'C1 Command 6/6/3, C2 Engineering 16/16/8, C3 Cargo 6/6/3, C4 Passenger hold 4/4/2. '
        + 'Random damage: 1-2 = C1, 3-5 = C2, 6-12 = C3, 13-20 = C4.',
    'Prop. plane': 'Makes use of the propeller; an effective range of about 100 kilometres between '
        + 'refuellings.',
    'Tank': 'Armoured and tracked, the tank replaced cavalry.',
};

/**
 * Rows whose Dur column prints a hull rather than a damage run. Those craft are
 * resolved by the spaceship rules in the back half of Ch.12, and several of them also
 * appear - at full statblock length - in `alternity-spaceships` and
 * `alternity-warships`. They are kept here anyway because Table P42 prints them, and
 * the note says where the fuller version lives.
 */
const HULL_NOTE = 'Hull-rated: the Dur column prints hull size and compartments rather than a '
    + 'stun/wound/mortal run, because this craft is resolved with the spaceship rules in the '
    + 'second half of Chapter 12. See the Spaceships and Warships compendia for full statblocks.';

/** `"10/10/5"` or `"Hull 16/4"` -> the two fields that hold it. */
function parseDurability(text) {
    const hull = /^Hull\s+(\d+)\/(\d+)$/.exec(text);
    if (hull) {
        return {
            durabilityRatings: { stun: 0, wound: 0, mortal: 0 },
            hull: { size: Number(hull[1]), compartments: Number(hull[2]) },
        };
    }
    const [stun, wound, mortal] = text.split('/').map(Number);
    return {
        durabilityRatings: { stun, wound, mortal },
        hull: { size: 0, compartments: 0 },
    };
}

/** The Drv column as printed -> a step modifier. A dash is no modifier. */
function parseDrv(text) {
    return text === '-' ? 0 : Number(text);
}

/** A dash is the table's blank, not a value. */
function printed(text) {
    return text === '-' ? '' : text;
}

function vehicleActor(row) {
    const [name, progressLevel, skillCode, drv, acc, cruise, max, type, dur, avail, cost] = row;

    const operationSkill = SKILLS[skillCode];
    const toughness = TOUGHNESS[type];
    const availability = AVAILABILITY[avail];
    const { durabilityRatings, hull } = parseDurability(dur);
    const isHullRated = hull.size > 0;

    const notes = [
        NOTES[name],
        WEAPON_TEXT[name],
        isHullRated ? HULL_NOTE : null,
    ].filter(Boolean).map(text => `<p>${text}</p>`).join('');

    const description = statBlock([
        ['Source', `${BOOK}, ${TABLE}`],
        ['Progress Level', `${progressLevel} - ${ERAS[progressLevel]}`],
        ['Skill', operationSkill === 'None' ? 'None - not steered' : operationSkill],
        ['Drv', drv === '-' ? 'None' : drv],
        ['Acceleration', printed(acc)],
        ['Cruising speed', printed(cruise)],
        ['Maximum speed', printed(max)],
        ['Toughness', toughness],
        ['Durability', dur],
        ['Availability', availability],
        ['Cost', cost],
        ['Armor', ARMOR[name]
            ? [
                ARMOR[name].lowImpact  ? `${ARMOR[name].lowImpact} (LI)`  : null,
                ARMOR[name].highImpact ? `${ARMOR[name].highImpact} (HI)` : null,
                ARMOR[name].energy     ? `${ARMOR[name].energy} (En)`     : null,
            ].filter(Boolean).join(', ')
            : ''],
        ['Crew', CREW[name] ? String(CREW[name]) : ''],
    ]);

    return makeActor({
        pack: PACK,
        name,
        type: 'vehicle',
        img: IMG[operationSkill],
        system: {
            operationSkill,
            scale: SCALES[operationSkill],
            progressLevel,
            drvModifier: parseDrv(drv),
            acceleration: printed(acc),
            cruiseSpeed:  printed(cruise),
            maxSpeed:     printed(max),
            speedBand: 'Cruising',
            toughness,
            durabilityRatings,
            damage: { stun: 0, wound: 0, mortal: 0 },
            hull,
            isConkedOut: false,
            armor: ARMOR[name] ?? { type: '', lowImpact: '', highImpact: '', energy: '' },
            crew: { capacity: CREW[name] ?? 0, current: 0 },
            weapons: [],
            availability,
            cost,
            notes,
            description,
        },
        flags: {
            'alternity': {
                provenance: {
                    book: BOOK,
                    folder: ERAS[progressLevel],
                    table: TABLE,
                    progressLevel,
                    // The printed cells, kept verbatim so a transcription slip is
                    // visible without going back to the scan.
                    printed: {
                        skill: skillCode, drv, acc, cruise, max, type, dur, avail, cost,
                    },
                },
            },
        },
    });
}

export function convert() {
    return VEHICLES.map(vehicleActor);
}
