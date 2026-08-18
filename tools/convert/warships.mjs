/**
 * @file tools/convert/warships.mjs
 * @description The *Warships* supplement's hulls and worked ship -> `warship` Actors.
 *
 * This converter has no input file. Every other converter in this directory reads the
 * character generator's data set out of `external/json`, but the generator knows nothing
 * about starships - the ship rules only ever existed in the books. So the tables are
 * transcribed here as literal data, checked against `../alternity-md/Warships.md`, and
 * the converter's job is to turn them into documents with stable ids and folders like
 * every other pack. That is why `NEEDS_SOURCE_DATA` is false.
 *
 * Three tables and one ship:
 *
 *   Table 5-1a  18 military hulls      hull points, toughness, target modifier, manoeuvre
 *   Table 5-1b  15 civilian hulls      class, the s/w/m/c damage tracks, crew and cost
 *   Table 6-1   10 stations and bases  the same columns, minus manoeuvre (they don't move)
 *   Ch.5        the *Endurance*        the book's own fully worked heavy cruiser
 *
 * The hull records are deliberately *bare*: a hull is what you start a design from, so
 * only the numbers Table 5-1 prints are filled in, and the systems/weapons/defenses/
 * sensors tables are left empty for whoever builds the ship. What is pre-filled is the
 * hit-location zone list, because zone count and per-zone hull point limit are a pure
 * function of the hull (Table 5-18) and Step A of the damage diagram names every zone.
 *
 * Two things the tables print that `WarshipData` has no field for - the 5%/10% hull point
 * shortcut columns - land on `provenance` and are rendered into the description, per the
 * rule that nothing printed gets thrown away.
 */

import { makeActor, statBlock } from '../lib/fvtt.mjs';

export const PACK = 'alternity-warships';

/** This pack comes out of the books, not out of `external/json`. */
export const NEEDS_SOURCE_DATA = false;

const BOOK = 'Warships';

/** Foundry core icons, kept to ones the other converters already ship. */
const SHIP_IMG = 'icons/svg/target.svg';
const STATION_IMG = 'icons/svg/shield.svg';

/**
 * The abbreviations the tables use for a toughness class, mapped onto
 * `SHIP_TOUGHNESS_CLASSES`. `(Gd)` is the civilian table's Good toughness - the note
 * under Table 5-1b spells it out: "some ships have Good toughness, one step less than
 * Small Craft" - and it is the reason that class exists in the ladder at all.
 */
const TOUGHNESS = {
    '(Gd)':  'Good',
    'Sm':    'SmallCraft',
    'Small': 'SmallCraft',
    'Lt':    'Light',
    'Light': 'Light',
    'Md':    'Medium',
    'Med':   'Medium',
    'Hv':    'Heavy',
    'Hvy':   'Heavy',
    'SHv':   'SuperHeavy',
    'S-Hvy': 'SuperHeavy',
};

/**
 * Zone names by zone count, from Ch.5 "Step A: Define Zones", in the order the book
 * lists them. `P`/`S` are the port and starboard *sides* on a six-zone ship and
 * *midships* port and starboard from twelve zones up, which is why this is a layout
 * per count rather than one name table.
 */
const ZONE_LAYOUTS = {
    2: [['F', 'Fore'], ['A', 'Aft']],
    4: [['F', 'Fore'], ['FC', 'Forward center'], ['AC', 'Aft center'], ['A', 'Aft']],
    6: [
        ['F', 'Fore'], ['FC', 'Forward center'], ['P', 'Port side'],
        ['S', 'Starboard side'], ['AC', 'Aft center'], ['A', 'Aft'],
    ],
    8: [
        ['F', 'Fore'], ['FP', 'Forward port side'], ['FC', 'Forward center'],
        ['FS', 'Forward starboard side'], ['AP', 'Aft port side'], ['AC', 'Aft center'],
        ['AS', 'Aft starboard side'], ['A', 'Aft'],
    ],
    12: [
        ['F', 'Fore'], ['FC', 'Forward center'], ['FP', 'Forward port side'],
        ['FS', 'Forward starboard side'], ['P', 'Midships port'], ['CF', 'Center forward'],
        ['S', 'Midships starboard'], ['AP', 'Aft port'], ['CA', 'Center aft'],
        ['AS', 'Aft starboard'], ['AC', 'Aft center'], ['A', 'Aft'],
    ],
    20: [
        ['F', 'Fore'], ['FFP', 'Forward-forward port'], ['FFC', 'Forward-forward center'],
        ['FFS', 'Forward-forward starboard'], ['FP', 'Forward port'], ['FC', 'Forward center'],
        ['FS', 'Forward starboard'], ['P', 'Midships port'], ['PC', 'Port center'],
        ['CF', 'Center forward'], ['SC', 'Starboard center'], ['S', 'Midships starboard'],
        ['AP', 'Aft port'], ['CA', 'Center aft'], ['AS', 'Aft starboard'],
        ['AAP', 'After-after port'], ['AC', 'Aft center'], ['AAS', 'After-after starboard'],
        ['AAC', 'After-after center'], ['A', 'Aft'],
    ],
};

/**
 * Table 5-1a (military) and 5-1b (civilian), joined with Table 5-18's Zones and Zone
 * Limit columns - the two tables list the same hulls in the same order, and a hull is
 * not usable without both halves.
 *
 * Columns: name, base hull points, bonus hull points, 5%, 10%, toughness, target
 * modifier, manoeuvre class, stun, wound, mortal, critical, crew, cost, zones, zone limit.
 */
const MILITARY_HULLS = [
    ['Fighter',             10,     0,   0.5,    1, 'Sm',    '+3 steps', 4,   5,   5,   3,  2,     1, '$350 K',    2,    7],
    ['Strike fighter',      15,     0,     1,  1.5, 'Sm',    '+3 steps', 4,   8,   8,   4,  2,     2, '$500 K',    2,   10],
    ['Cutter',              20,     0,     1,    2, 'Sm',    '+2 steps', 4,  10,  10,   5,  3,     4, '$600 K',    2,   14],
    ['Scout',               30,     0,   1.5,    3, 'Sm',    '+2 steps', 4,  15,  15,   8,  4,     6, '$800 K',    4,   10],
    ['Escort',              40,     0,     2,    4, 'Sm',    '+2 steps', 4,  20,  20,  10,  5,    10, '$1 M',      4,   14],
    ['Corvette',            80,     8,     4,    8, 'Lt',    '+1 step',  3,  20,  20,  10,  5,    20, '$5 M',      6,   22],
    ['Frigate',            120,    12,     6,   12, 'Lt',    '+1 step',  3,  30,  30,  15,  8,    60, '$15 M',     6,   33],
    ['Destroyer',          160,    16,     8,   16, 'Lt',    '+1 step',  3,  40,  40,  20, 10,    80, '$30 M',     6,   44],
    ['Light cruiser',      320,    64,    16,   32, 'Md',    '0',        2,  40,  40,  20, 10,   240, '$50 M',     8,   75],
    ['Heavy cruiser',      400,    80,    20,   40, 'Md',    '0',        2,  45,  45,  23, 12,   300, '$100 M',    8,   96],
    ['Armored cruiser',    480,    96,    24,   48, 'Md',    '-1 step',  2,  60,  60,  30, 15,   360, '$200 M',    8,  115],
    ['Battlecruiser',      960,   288,    48,   96, 'Hv',    '-2 steps', 1,  60,  60,  30, 15,   960, '$500 M',   12,  156],
    ['Battleship',        1200,   360,    60,  120, 'Hv',    '-2 steps', 1,  75,  75,  38, 19,  1200, '$1000 M',  12,  195],
    ['Fleet carrier',     1600,   480,    80,  160, 'Hv',    '-3 steps', 1, 100, 100,  50, 25,  1600, '$1500 M',  12,  260],
    ['Dreadnought',       3200,  1600,   160,  320, 'SHv',   '-3 steps', 1, 100, 100,  50, 25,  3200, '$2000 M',  20,  480],
    ['Super-carrier',     4000,  2000,   200,  400, 'SHv',   '-4 steps', 1, 125, 125,  63, 32,  4000, '$4000 M',  20,  600],
    // Printed "Super-dread." in both tables; named in full here to match SHIP_HULL_TYPES.
    ['Super-dreadnought', 6400,  3200,   320,  640, 'SHv',   '-5 steps', 1, 200, 200, 100, 50,  6400, '$10000 M', 20,  960],
    ['Fortress ship',    12000,  6000,   600, 1200, 'SHv',   '-5 steps', 1, 375, 375, 188, 94, 12000, '$50000 M', 20, 1800],
];

const CIVILIAN_HULLS = [
    ['Launch',               8,     0,   0.5,    1, '(Gd)',  '+3 steps', 4,   4,   4,   2,  1,     2, '$300 K',    2,    5],
    ['Courier',             16,     0,     1,  1.5, '(Gd)',  '+2 steps', 4,   8,   8,   4,  2,     4, '$400 K',    2,   10],
    ['Trader',              24,     0,     1,    2, '(Gd)',  '+2 steps', 4,  12,  12,   6,  3,     6, '$500 K',    4,    8],
    ['Fast freighter',      32,     0,   1.5,    3, 'Sm',    '+2 steps', 4,  16,  16,   8,  4,     8, '$600 K',    4,   11],
    ['Fast transport',      40,     0,     2,    4, 'Sm',    '+2 steps', 4,  20,  20,  10,  5,    10, '$800 K',    4,   14],
    ['Hauler',              72,     7,     3,    7, 'Sm',    '+1 step',  3,  18,  18,   9,  5,    18, '$1 M',      6,   20],
    ['Industrial',          96,    10,     5,   10, 'Sm',    '+1 step',  3,  24,  24,  12,  6,    24, '$2 M',      6,   27],
    ['Medium freighter',   240,    48,    12,   24, 'Lt',    '0',        2,  30,  30,  15,  8,    30, '$20 M',     8,   58],
    ['Clipper',            360,    72,    18,   36, 'Lt',    '0',        2,  45,  45,  23, 12,   360, '$40 M',     8,   87],
    ['Medium transport',   480,    96,    24,   48, 'Lt',    '-1 step',  2,  60,  60,  30, 15,    60, '$60 M',     8,  115],
    ['Tanker',             720,   216,    36,   72, 'Md',    '-1 step',  1,  45,  45,  23, 12,    90, '$100 M',   12,  117],
    ['Liner',              840,   252,    42,   84, 'Md',    '-1 step',  1,  53,  53,  27, 14,   840, '$150 M',   12,  137],
    ['Heavy transport',   1280,   384,    64,  128, 'Md',    '-2 steps', 1,  80,  80,  40, 20,   160, '$200 M',   12,  208],
    ['Super-freighter',   2400,  1200,   120,  240, 'Hv',    '-3 steps', 0,  75,  75,  38, 19,   300, '$400 M',   20,  360],
    ['Colony transport',  3600,  1800,   180,  360, 'Hv',    '-4 steps', 0, 113, 113,  57, 29,  3600, '$1000 M',  20,  540],
];

/**
 * Table 6-1, the last chapter's stations and bases. Same columns as Table 5-1 except
 * that this table carries its own Zones and Limit columns and prints no manoeuvre class -
 * a station is, in the book's words, "a ship without engines".
 *
 * Ch.6 was never finished before the line was cancelled; the table is complete and is
 * published as "a good starting point", which is the whole of what exists.
 */
const INSTALLATIONS = [
    // Same column order as Table 5-1 so one row shape serves both, with a manoeuvre class
    // of 0 standing in for the column Table 6-1 does not print.
    ['Habitat Dome',      100,   10,    5,   10, 'Small', '0 steps',  0,  25,  25,  13,   7,   10, '$5 M',       6,   28],
    ['Light Platform',    150,   15,    8,   15, 'Light', '0 steps',  0,  38,  38,  19,  10,   15, '$10 M',      6,   41],
    ['Light Post',        200,   20,   10,   20, 'Light', '-1 step',  0,  50,  50,  25,  13,   20, '$20 M',      6,   55],
    ['Hab Complex',       300,   60,   15,   30, 'Light', '-1 step',  0,  38,  38,  19,  10,  150, '$30 M',      8,   72],
    ['Medium Platform',   400,   80,   20,   40, 'Med',   '-1 step',  0,  50,  50,  25,  13,  200, '$60 M',      8,   96],
    ['Medium Bunker',     600,  120,   30,   60, 'Med',   '-2 steps', 0,  75,  75,  38,  19,  300, '$100 M',     8,  144],
    ['Heavy Platform',   1000,  300,   50,  100, 'Hvy',   '-3 steps', 0,  63,  63,  32,  16,  500, '$250 M',    12,  163],
    ['Heavy Bunker',     2000,  600,  100,  200, 'Hvy',   '-4 steps', 0, 125, 125,  63,  32, 1000, '$500 M',    12,  325],
    ['Super Platform',  10000, 5000,  500, 1000, 'S-Hvy', '-4 steps', 0, 313, 313, 157,  78, 2500, '$5000 M',   20, 1500],
    ['Fortress',        20000,10000, 1000, 2000, 'S-Hvy', '-5 steps', 0, 625, 625, 313, 157, 5000, '$20000 M',  20, 3000],
];

/** One `zones` row per zone the hull is divided into, all at the hull's zone limit. */
function buildZones(zoneCount, zoneLimit) {
    const layout = ZONE_LAYOUTS[zoneCount];
    if (!layout) throw new Error(`No zone layout for a ${zoneCount}-zone hull`);
    return layout.map(([abbreviation, name]) => ({
        label:          `${abbreviation} (${name})`,
        hullPointLimit: zoneLimit,
        hullPointsUsed: 0,
        systemsText:    '',
        isKnockedOut:   false,
    }));
}

function damageTrack(stun, wound, mortal, critical) {
    return {
        stun:     { value: 0, max: stun },
        wound:    { value: 0, max: wound },
        mortal:   { value: 0, max: mortal },
        critical: { value: 0, max: critical },
    };
}

/**
 * A bare hull: everything Table 5-1/5-18 prints, and nothing else. The systems,
 * weapons, defenses and sensors tables stay empty on purpose - this is the starting
 * point of a design, not a finished ship.
 */
function hullActor(row, category, { table }) {
    const [
        name, base, bonus, pct5, pct10, toughness, targetModifier,
        maneuverClass, stun, wound, mortal, critical, crew, cost, zoneCount, zoneLimit,
    ] = row;

    const provenance = {
        book:   BOOK,
        folder: category === 'Installation' ? 'Stations & Bases' : `${category} Hulls`,
        table,
        hullPointsFivePercent: pct5,
        hullPointsTenPercent:  pct10,
        printedToughness:      toughness,
        zoneLimitTable:        category === 'Installation' ? 'Table 6-1' : 'Table 5-18',
    };

    const description = statBlock([
        ['Source', `${BOOK}, ${table}`],
        ['Class', category === 'Installation' ? 'Station or base' : `${category} hull`],
        ['Hull points', bonus ? `${base} (+${bonus})` : `${base}`],
        ['Toughness', `${TOUGHNESS[toughness]} (printed "${toughness}")`],
        ['Target modifier', targetModifier],
        ['Manoeuvre class', category === 'Installation' ? 'None - installations do not move' : maneuverClass],
        ['Damage track (s/w/m/c)', `${stun}/${wound}/${mortal}/${critical}`],
        ['Hit zones', `${zoneCount}, up to ${zoneLimit} hull points each`],
        ['5% of hull', pct5],
        ['10% of hull', pct10],
        ['Typical crew', crew],
        ['Cost', cost],
    ]);

    return makeActor({
        pack: PACK,
        name,
        type: 'warship',
        img:  category === 'Installation' ? STATION_IMG : SHIP_IMG,
        system: {
            hullType:       name,
            hullCategory:   category,
            toughness:      TOUGHNESS[toughness],
            targetModifier,
            // Table 6-1 prints no manoeuvre class; a station cannot manoeuvre at all.
            maneuverClass:  category === 'Installation' ? 0 : maneuverClass,
            hullPoints:     { base, bonus },
            damage:         damageTrack(stun, wound, mortal, critical),
            armor:          { lowImpact: '', highImpact: '', energy: '', armorType: '' },
            power:          { generated: 0, consumed: 0 },
            edge:           0,
            acceleration:   0,
            crew:           { estimate: crew, current: 0 },
            cost,
            systems:        [],
            weapons:        [],
            defenses:       [],
            sensors:        [],
            zones:          buildZones(zoneCount, zoneLimit),
            notes:          '',
            description,
        },
        flags: { 'alternity': { provenance } },
    });
}

/**
 * The *Endurance*, the survey cruiser Ch.5 builds step by step and then prints as a
 * finished record on page 106. It is the only complete warship in the corpus, and it is
 * what the `warship` sheet was modelled on.
 *
 * Two figures are worth knowing before editing this: the hull point column sums to
 * exactly 480 - the heavy cruiser's 400 plus its 80 bonus points, with nothing left over -
 * and the power column's continuous draw sums to exactly 294, which is what the four mass
 * reactors generate. The stardrive's 60 points are parenthetical in the printed table
 * because a starfall is not made while the engines and weapons are drawing power.
 */
function endurance() {
    const systems = [
        ['Hull',    'Heavy cruiser hull',                     0,   0, '$100 M'],
        ['Armor',   'Medium neutronite armor',               20,   0, '$10 M'],
        ['Power',   '4x 21-pt mass reactor (generates +294)', 84,  0, '$29 M'],
        ['Engine',  '2x 30-pt induction drive',              60,  60, '$32 M'],
        ['FTL',     'Stardrive (60 power to make a starfall)', 20, 0, '$22 M'],
        ['Support', '10x autosupport',                       10,  10, '$2 M'],
        ['Support', '12x crew bunkroom',                     36,   0, '$0.48 M'],
        ['Support', '8x crew quarters',                      16,   0, '$0.16 M'],
        ['Support', '6x staterooms',                         12,   0, '$0.3 M'],
        ['Support', '15x recyclers',                         15,  15, '$4.5 M'],
        ['Command', 'Command deck',                           6,   0, '$1.8 M'],
        ['Command', '2x mass transceivers',                   2,   2, '$0.2 M'],
        ['Command', '4x radio transceivers',                  2,   4, '$0.1 M'],
        ['Command', 'Computer core, Good',                    2,   2, '$2 M'],
        ['Command', '3x Fire control, Good',                  3,   0, '$38.7 M'],
        ['Command', 'Tactical control, Good',                 1,   0, '$0.2 M'],
        ['Command', 'Nav control, Good',                      1,   0, '$0.75 M'],
        ['Command', '3x Sensor control, Good',                3,   0, '$3.3 M'],
        ['Hangar',  'Hangar (2 launches)',                   16,   0, '$0.5 M'],
        ['Misc',    'Evacuation system (300 crew)',          17,   0, '$0.9 M'],
        ['Misc',    'Brig',                                   2,   0, '$0.02 M'],
        ['Misc',    'Lab section',                            2,   0, '$0.1 M'],
        ['Misc',    'Sick bay',                               2,   0, '$0.15 M'],
        ['Misc',    'Fabrication facility',                   4,   2, '$0.2 M'],
        ['Misc',    'Cargo hold',                             3,   0, '$0.05 M'],
        ['Misc',    'Security suite (covers 40 hull points)',  1,   1, '$0.2 M'],
    ].map(([category, name, hullPoints, powerReq, cost]) => ({
        category, name, hullPoints, powerReq, cost,
    }));

    /*
     * Weapon stats come from Tables 5-8 (beam weapons), 5-9 (projectile weapons) and the
     * torpedo table, keyed by the names the ship's own table uses. `damageFormula` and
     * `damageGrade` hold the *Ordinary* code, because a warship weapon row has room for
     * one: the full printed run is in the row's cost-adjacent notes and in the ship's
     * description. See PLANS_FOR_WARSHIP_SHEET.md - carrying all three grades is a
     * schema change, not a conversion decision.
     */
    const weapons = [
        {
            name: '2x3 matter beam turret (2d6+1w/2d8+1w/2d8m)',
            hullPoints: 56, powerReq: 66, cost: '$100 M',
            fireMode: 'Battery', arc: 'Turret', firepowerClass: 'Medium',
            damageFormula: '2d6+1', damageType: 'energy', damageGrade: 'wound',
        },
        {
            name: '1 fixed plasma torpedo (3d6s/3d6w/d8+3m)',
            hullPoints: 8, powerReq: 15, cost: '$7.5 M',
            fireMode: 'Single', arc: 'Fixed', firepowerClass: 'Heavy',
            damageFormula: '3d6', damageType: 'energy', damageGrade: 'stun',
        },
        {
            name: '6x3 mass cannon turret (d6+2s/d6+1w/d6+3w)',
            hullPoints: 36, powerReq: 54, cost: '$4.5 M',
            fireMode: 'Battery', arc: 'Turret', firepowerClass: 'SmallCraft',
            damageFormula: 'd6+2', damageType: 'lowImpact', damageGrade: 'stun',
        },
    ];

    const defenses = [
        {
            name: '20x deflection inducers', hullPoints: 20, powerReq: 40, cost: '$10 M',
            effectText: '+2 step penalty to attacks against the ship. A whole-ship '
                + 'installation: knocking out any one inducer fails the whole system.',
        },
        {
            name: '4x jammer', hullPoints: 4, powerReq: 4, cost: '$0.4 M',
            effectText: '+2 steps to enemy missile and sensor checks.',
        },
    ];

    const sensors = [
        ['Multiband radar #1', 4, 8, '$0.4 M',  200],
        ['Multiband radar #2', 3, 6, '$0.3 M',  120],
        ['Mass detector',      4, 4, '$0.4 M',  120],
        ['EM detector',        2, 0, '$0.08 M', 120],
        ['Hi-res video',       2, 0, '$0.04 M',   0],
        ['Spectroanalyzer',    1, 1, '$0.1 M',    0],
    ].map(([name, hullPoints, powerReq, cost, trackingCapacity]) => ({
        name, hullPoints, powerReq, cost, trackingCapacity,
    }));

    /*
     * The damage diagram on page 106, one zone per entry, in the book's own order. The
     * text is transcribed as printed; `hullPointsUsed` stays at 0 because the diagram
     * names systems rather than totalling them - the two figures the book does state are
     * FC at 91 of 96 and AC at 95 of 96, and those are in the notes.
     */
    const diagram = {
        'F':  'Plasma torpedo, hi-res video, mass transceiver, cargo hold, evac system (4 pods), '
            + 'bunkroom, bunkroom, crew quarters, lab section, recycler (6 pts), autosupport (4 pts), power plant #1',
        'FP': 'Mass cannon turret #2, mass cannon turret #4, radio transceiver, evac system (4 pods), '
            + 'bunkroom, bunkroom, crew quarters, stateroom, stateroom, recycler (3 pts)',
        'FC': 'Matter beam turret A, jammer, multiband radar #1, mass detector, spectroanalyzer, '
            + 'evac system (main - 4 pods), crew quarters, recycler (3 pts), power plant #2, stardrive',
        'FS': 'Mass cannon turret #1, mass cannon turret #3, radio transceiver, evac system (4 pods), '
            + 'bunkroom, bunkroom, crew quarters, stateroom, stateroom, recycler (3 pts)',
        'AP': 'Mass cannon turret #6, radio transceiver, evac system (4 pods), bunkroom, bunkroom, '
            + 'crew quarters, stateroom, autosupport (3 pts), induction engine #2',
        'AC': 'Matter beam turret X, deflection inducer, multiband radar #2, EM detector, '
            + 'evac system (4 pods), sick bay, power plant #3, command deck, security suite, '
            + 'computer core and control computers',
        'AS': 'Mass cannon turret #5, radio transceiver, evac system (4 pods), bunkroom, bunkroom, '
            + 'crew quarters, stateroom, autosupport (3 pts), induction engine #1',
        'A':  'Mass transceiver, hangar, evac system (2 pods), bunkroom, bunkroom, crew quarters, '
            + 'crew quarters, brig, fabrication facility, power plant #4',
    };

    const zones = buildZones(8, 96).map(zone => ({
        ...zone,
        systemsText: diagram[zone.label.split(' ')[0]] ?? '',
    }));

    const description = statBlock([
        ['Source', `${BOOK}, Ch.5 "An Example of Ship Construction" (p.106)`],
        ['Hull', 'Heavy cruiser, 400 (+80) hull points, Medium toughness'],
        ['Progress Level', '7 - no matter coding, teleportation or energy transformation'],
        ['Target modifier', '0'],
        ['Manoeuvre class', '2, acceleration 3'],
        ['Damage track (s/w/m/c)', '45/45/23/12'],
        ['Armor', 'Medium neutronite: d6+1 (LI), d6+1 (HI), d6 (En)'],
        ['Power', '294 generated, 294 drawn - the stardrive’s 60 points are not simultaneous'],
        ['FTL', 'Stardrive: 20 light-years per starfall on 60 power, up to 39 if the whole plant is fed to it'],
        ['Crew', '300 recommended, berthing for 306'],
        ['Hit zones', '8, up to 96 hull points each; FC is filled to 91 and AC to 95'],
        ['Cost', '$372 M'],
    ]);

    return makeActor({
        pack: PACK,
        name: 'Endurance',
        type: 'warship',
        img:  SHIP_IMG,
        system: {
            hullType:       'Heavy cruiser',
            hullCategory:   'Military',
            toughness:      'Medium',
            targetModifier: '0',
            maneuverClass:  2,
            hullPoints:     { base: 400, bonus: 80 },
            damage:         damageTrack(45, 45, 23, 12),
            armor: {
                lowImpact:  'd6+1',
                highImpact: 'd6+1',
                energy:     'd6',
                armorType:  'Medium neutronite',
            },
            power:        { generated: 294, consumed: 294 },
            edge:         0,
            acceleration: 3,
            crew:         { estimate: 300, current: 300 },
            cost:         '$372 M',
            systems,
            weapons,
            defenses,
            sensors,
            zones,
            notes: '<p>A PL 7 survey cruiser: fast, fully life-supported and provisioned for '
                + 'nearly three years, with combat as a secondary role. The printed hull point '
                + 'column sums to exactly 480, so nothing can be added without taking something '
                + 'out.</p><p>Zone fill as designed: FC holds 91 of its 96 hull points and AC 95 '
                + 'of 96. The other six zones are not totalled in the book.</p>',
            description,
        },
        flags: {
            'alternity': {
                provenance: {
                    book:   BOOK,
                    folder: 'Sample Ships',
                    table:  'Ch.5, p.106',
                    progressLevel: 7,
                    ftl: 'Stardrive, 20 ly per starfall (39 ly at full power)',
                },
            },
        },
    });
}

export function convert() {
    return [
        ...MILITARY_HULLS.map(row => hullActor(row, 'Military', { table: 'Tables 5-1a / 5-18' })),
        ...CIVILIAN_HULLS.map(row => hullActor(row, 'Civilian', { table: 'Tables 5-1b / 5-18' })),
        ...INSTALLATIONS.map(row => hullActor(row, 'Installation', { table: 'Table 6-1' })),
        endurance(),
    ];
}
