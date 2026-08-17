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

// ---------------------------------------------------------------------------
// Robots (7Foundry, Ivo Elezović)
// ---------------------------------------------------------------------------
/*
 * Robot construction comes from `7Foundry.md`, a fan supplement, rather than the
 * official *Dataware*. That is a deliberate choice: Dataware's robot tables D17
 * (ability limits), D18 (hardware) and D19 (the entire point-buy parts list) are
 * destroyed in the source scan — D19 is the single biggest loss in the corpus —
 * whereas 7Foundry's tables are intact and it ships eight fully worked builds
 * that double as test fixtures.
 */

/**
 * Table 3.1 (Robot Sizes) and Table 3.2 (Robot Size Consequences), merged.
 *
 *   factor          the `h` in CP = h x (30 - CON); also scales weight and prices
 *   minCon/maxCon   Constitution range the chassis supports
 *   maxStr/maxDex   hard ability ceilings for the chassis
 *   movement        STR+DEX modifier for Table P8 combat movement rates
 *   dexResistance   size bonus/penalty to the DEX resistance modifier
 *   strResistance   size bonus/penalty to the STR resistance modifier
 *   stealth         step modifier to Stealth checks (negative = easier to hide)
 *   canUseLimbs     diminutive robots are too small for limbs
 *   needsCabling    diminutive robots' runs are too short to need cabling
 */
const ROBOT_SIZES = Object.freeze({
    Diminutive: Object.freeze({
        label: 'Diminutive', progressLevel: 7, factor: 0.4, minCon: 3, maxCon: 6,
        maxStr: 8, maxDex: 18, movement: -6, dexResistance: 3, strResistance: -2,
        stealth: -3, weight: '0.5-5 kg', weightRoll: 'd12', canUseLimbs: false, needsCabling: false,
    }),
    Tiny: Object.freeze({
        label: 'Tiny', progressLevel: 6, factor: 1, minCon: 4, maxCon: 8,
        maxStr: 10, maxDex: 17, movement: -4, dexResistance: 2, strResistance: -1,
        stealth: -2, weight: '5-25 kg', weightRoll: '2d12', canUseLimbs: true, needsCabling: true,
    }),
    Small: Object.freeze({
        label: 'Small', progressLevel: 5, factor: 3, minCon: 5, maxCon: 10,
        maxStr: 12, maxDex: 16, movement: -2, dexResistance: 1, strResistance: 0,
        stealth: -1, weight: '20-100 kg', weightRoll: '3d12', canUseLimbs: true, needsCabling: true,
    }),
    Medium: Object.freeze({
        label: 'Medium', progressLevel: 5, factor: 5, minCon: 6, maxCon: 12,
        maxStr: 14, maxDex: 14, movement: 0, dexResistance: 0, strResistance: 0,
        stealth: 0, weight: '40-200 kg', weightRoll: '4d12', canUseLimbs: true, needsCabling: true,
    }),
    Large: Object.freeze({
        label: 'Large', progressLevel: 5, factor: 10, minCon: 7, maxCon: 14,
        maxStr: 16, maxDex: 13, movement: 2, dexResistance: -1, strResistance: 0,
        stealth: 1, weight: '130-500 kg', weightRoll: '5d12', canUseLimbs: true, needsCabling: true,
    }),
    Huge: Object.freeze({
        label: 'Huge', progressLevel: 5, factor: 30, minCon: 8, maxCon: 16,
        maxStr: 18, maxDex: 12, movement: 4, dexResistance: -2, strResistance: 1,
        stealth: 2, weight: '400-10000 kg', weightRoll: '', canUseLimbs: true, needsCabling: true,
    }),
});

/**
 * Table 4.5 (Processors and Relevant Info), keyed `PL<n>-<Quality>`.
 *
 * The processor is the robot's single most constraining component: it caps
 * Intelligence, Will and Personality outright, caps usable skill ranks, sets the
 * action check modifier, and hands out the active memory slots that are the
 * robot's fourth budget.
 *
 *   mact    maximum active memory slots (null = unlimited, PL9 brains)
 *   mrnk    maximum usable ranks in any one skill
 *   mint/mwil/mper   highest ability score the processor can support
 *   maxActionsPerRound  ceiling on actions per round, whatever the formula says
 */
const ROBOT_PROCESSORS = Object.freeze({
    'PL5-Marginal': { progressLevel: 5, quality: 'Marginal', mact: 2,  mrnk: 0,  mint: 6,  mwil: 3,  mper: 1,  chassisPoints: 1, powerPoints: 1,  maxActionsPerRound: 1, actionCheckModifier: '+d12', cost: '$100' },
    'PL5-Ordinary': { progressLevel: 5, quality: 'Ordinary', mact: 3,  mrnk: 1,  mint: 7,  mwil: 4,  mper: 2,  chassisPoints: 2, powerPoints: 3,  maxActionsPerRound: 2, actionCheckModifier: '+d8',  cost: '$200' },
    'PL5-Good':     { progressLevel: 5, quality: 'Good',     mact: 5,  mrnk: 3,  mint: 8,  mwil: 5,  mper: 3,  chassisPoints: 3, powerPoints: 6,  maxActionsPerRound: 3, actionCheckModifier: '+d6',  cost: '$300' },
    'PL5-Amazing':  { progressLevel: 5, quality: 'Amazing',  mact: 7,  mrnk: 5,  mint: 9,  mwil: 6,  mper: 4,  chassisPoints: 5, powerPoints: 8,  maxActionsPerRound: 3, actionCheckModifier: '+d4',  cost: '$500' },
    'PL6-Marginal': { progressLevel: 6, quality: 'Marginal', mact: 3,  mrnk: 1,  mint: 8,  mwil: 5,  mper: 3,  chassisPoints: 1, powerPoints: 1,  maxActionsPerRound: 3, actionCheckModifier: '+d8',  cost: '$400' },
    'PL6-Ordinary': { progressLevel: 6, quality: 'Ordinary', mact: 5,  mrnk: 3,  mint: 9,  mwil: 6,  mper: 4,  chassisPoints: 2, powerPoints: 2,  maxActionsPerRound: 3, actionCheckModifier: '+d6',  cost: '$1K' },
    'PL6-Good':     { progressLevel: 6, quality: 'Good',     mact: 7,  mrnk: 5,  mint: 10, mwil: 7,  mper: 5,  chassisPoints: 3, powerPoints: 4,  maxActionsPerRound: 4, actionCheckModifier: '+d4',  cost: '$2K' },
    'PL6-Amazing':  { progressLevel: 6, quality: 'Amazing',  mact: 9,  mrnk: 7,  mint: 11, mwil: 8,  mper: 6,  chassisPoints: 4, powerPoints: 5,  maxActionsPerRound: 4, actionCheckModifier: '+d0',  cost: '$3K' },
    'PL7-Marginal': { progressLevel: 7, quality: 'Marginal', mact: 4,  mrnk: 2,  mint: 12, mwil: 7,  mper: 5,  chassisPoints: 1, powerPoints: 1,  maxActionsPerRound: 3, actionCheckModifier: '+d6',  cost: '$2K' },
    'PL7-Ordinary': { progressLevel: 7, quality: 'Ordinary', mact: 7,  mrnk: 5,  mint: 13, mwil: 8,  mper: 6,  chassisPoints: 1, powerPoints: 1,  maxActionsPerRound: 3, actionCheckModifier: '+d4',  cost: '$3K' },
    'PL7-Good':     { progressLevel: 7, quality: 'Good',     mact: 10, mrnk: 8,  mint: 14, mwil: 9,  mper: 7,  chassisPoints: 2, powerPoints: 2,  maxActionsPerRound: 4, actionCheckModifier: '+d0',  cost: '$5K' },
    'PL7-Amazing':  { progressLevel: 7, quality: 'Amazing',  mact: 13, mrnk: 11, mint: 15, mwil: 10, mper: 8,  chassisPoints: 3, powerPoints: 3,  maxActionsPerRound: 4, actionCheckModifier: '-d4',  cost: '$10K' },
    'PL8-Marginal': { progressLevel: 8, quality: 'Marginal', mact: 7,  mrnk: 5,  mint: 12, mwil: 10, mper: 8,  chassisPoints: 1, powerPoints: 1,  maxActionsPerRound: 3, actionCheckModifier: '+d4',  cost: '$2K' },
    'PL8-Ordinary': { progressLevel: 8, quality: 'Ordinary', mact: 10, mrnk: 8,  mint: 14, mwil: 11, mper: 9,  chassisPoints: 1, powerPoints: 1,  maxActionsPerRound: 3, actionCheckModifier: '+d0',  cost: '$5K' },
    'PL8-Good':     { progressLevel: 8, quality: 'Good',     mact: 15, mrnk: 12, mint: 15, mwil: 12, mper: 10, chassisPoints: 1, powerPoints: 2,  maxActionsPerRound: 4, actionCheckModifier: '-d4',  cost: '$15K' },
    'PL8-Amazing':  { progressLevel: 8, quality: 'Amazing',  mact: 18, mrnk: 12, mint: 16, mwil: 13, mper: 11, chassisPoints: 2, powerPoints: 3,  maxActionsPerRound: 4, actionCheckModifier: '-d6',  cost: '$25K' },
    // "The quantum processor has no limit on maximum active memory slots."
    'PL9-Positronic': { progressLevel: 9, quality: 'Positronic', mact: null, mrnk: 12, mint: 20, mwil: 16, mper: 14, chassisPoints: 2, powerPoints: 5, maxActionsPerRound: 4, actionCheckModifier: '-d8',  cost: '$40K' },
    'PL9-Quantum':    { progressLevel: 9, quality: 'Quantum',    mact: null, mrnk: 12, mint: 22, mwil: 17, mper: 15, chassisPoints: 3, powerPoints: 5, maxActionsPerRound: 4, actionCheckModifier: '-d12', cost: '$100K' },
});

/**
 * Table 4.8 (Cabling and Relevant Info).
 *
 * Cabling matters twice: it imposes its own ceiling on actions per round (so a
 * fast processor in a serially-wired chassis is wasted), and its `powerModifier`
 * is the step modifier on the System Operation-engineering check to Power Boost.
 *
 * `powerModifier: null` means the cabling cannot carry power at all — optic
 * cables are not wires, and nerves are cells.
 *
 * Note: the worked CIMDR-13 build in Ch.6 prints Parallel's power modifier as +2,
 * where this table prints +1. The table is followed here; the example appears to
 * have copied Serial's value.
 */
const ROBOT_CABLING = Object.freeze({
    Serial:     { label: 'Serial',        progressLevel: 5, chassisPercent: 5,  costPerPoint: 10,   maxActionsPerRound: 1, powerModifier: 2 },
    Parallel:   { label: 'Parallel',      progressLevel: 5, chassisPercent: 10, costPerPoint: 10,   maxActionsPerRound: 2, powerModifier: 1 },
    Optic:      { label: 'Optic',         progressLevel: 5, chassisPercent: 5,  costPerPoint: 50,   maxActionsPerRound: 4, powerModifier: null },
    UltraWide:  { label: 'Ultra-Wide',    progressLevel: 6, chassisPercent: 10, costPerPoint: 100,  maxActionsPerRound: 4, powerModifier: 0 },
    WaveBased:  { label: 'Wave-Based',    progressLevel: 6, chassisPercent: 5,  costPerPoint: 300,  maxActionsPerRound: 3, powerModifier: -1 },
    Gravitic:   { label: 'Gravitic',      progressLevel: 7, chassisPercent: 5,  costPerPoint: 500,  maxActionsPerRound: 4, powerModifier: -1 },
    Pulse:      { label: 'Pulse',         progressLevel: 8, chassisPercent: 0,  costPerPoint: 1500, maxActionsPerRound: 4, powerModifier: -2 },
    Nerves:     { label: 'Nerves',        progressLevel: 8, chassisPercent: 0,  costPerPoint: 0,    maxActionsPerRound: 3, powerModifier: null },
    None:       { label: 'None',          progressLevel: 5, chassisPercent: 0,  costPerPoint: 0,    maxActionsPerRound: null, powerModifier: null },
});

/** The chassis-percentage denominations a system's cost may be paid in. */
const CHASSIS_FACTORS = Object.freeze([10, 5, 1]);

/** Every robot runs a background OS, which permanently occupies one memory slot. */
const ROBOT_OS_MEMORY_SLOTS = 1;

/** Each limb costs 5% of the chassis and gives 5% back inside the limb. */
const ROBOT_LIMB_PERCENT = 5;

/** Base skill points before Intelligence: "30 + (3 x INT)", as for any humanoid. */
const ROBOT_BASE_SKILL_POINTS = 30;

// ---------------------------------------------------------------------------
// Artificial intelligences (Dataware Ch.5 + Player's Handbook Ch.10)
// ---------------------------------------------------------------------------
//
// Both books describe the same machine from opposite ends. The Player's Handbook
// gives the mechanics in clean prose — memory slots, situation-die modifiers, the
// program x processor grid — while Dataware gives six fully printed statblocks.
// Dataware's own Table D12 is OCR-destroyed, but almost all of it is recoverable
// by cross-checking the two, and every cell below that is marked `isPrinted`
// appears verbatim in at least one of those statblocks.
//
// The one thing that does NOT follow from either book is the action check score
// an individual AI ends up with: the grid gives a base, and the printed AIs sit
// anywhere from -4 to +4 off it, tracking their achievement level the same way a
// hero's does. So the grid supplies a base and the sheet carries a bonus.

/** Quality ladder shared by AI operating systems, processors and Grid programs. */
const AI_QUALITIES = Object.freeze(['Marginal', 'Ordinary', 'Good', 'Amazing']);

/**
 * Ability scores a shadow form program generates (Player's Handbook Ch.10).
 *
 * An AI does not roll its own physical scores: its operating system "automatically
 * creates a Grid avatar ... [with] the same Strength, Dexterity, and Constitution
 * values as are generated by the shadow form program", of the OS's own quality.
 * Every printed AI checks out against this table plus the hacking-rank bonus —
 * the Watchman is a Marginal OS with no hacking and prints STR 6/DEX 6/CON 6.
 */
const SHADOW_FORM_SCORES = Object.freeze({
    Marginal: Object.freeze({ STR: 6,  DEX: 6,  CON: 6  }),
    Ordinary: Object.freeze({ STR: 8,  DEX: 8,  CON: 8  }),
    Good:     Object.freeze({ STR: 9,  DEX: 9,  CON: 10 }),
    Amazing:  Object.freeze({ STR: 10, DEX: 10, CON: 12 }),
});

/**
 * Ability scores a shadow form 2 program generates (Player's Handbook Ch.10).
 *
 * Shadow form 2 also supplies Intelligence, Will and Personality, but those are
 * deliberately not used here: an AI's mental scores are its own, and only the
 * avatar's physical shell comes from the program.
 */
const SHADOW_FORM_2_SCORES = Object.freeze({
    Marginal: Object.freeze({ STR: 8,  DEX: 8,  CON: 8  }),
    Ordinary: Object.freeze({ STR: 10, DEX: 10, CON: 10 }),
    Good:     Object.freeze({ STR: 11, DEX: 11, CON: 12 }),
    Amazing:  Object.freeze({ STR: 12, DEX: 12, CON: 14 }),
});

/** Avatar generators an AI may run. Both are quality-keyed tables above. */
const AI_AVATAR_PROGRAMS = Object.freeze({
    shadowForm:  Object.freeze({ label: 'Shadow Form',   scores: SHADOW_FORM_SCORES }),
    shadowForm2: Object.freeze({ label: 'Shadow Form 2', scores: SHADOW_FORM_2_SCORES }),
});

/**
 * Table D12: Common AI Hardware, keyed `PL<n>-<Quality>`.
 *
 *   activeSlots           slots available to skill and Grid programs. The AI's own
 *                         operating system is free — unlike a robot's OS, which
 *                         permanently holds one slot.
 *   maxSkillRank          "an AI may not have a skill rank higher than one less
 *                         than its number of active memory slots", capped at 12.
 *   actionCheckModifier   the processor's situation die on every action.
 *   step                  the same modifier as a step count, for modifier arrays.
 *
 * PL 6 has a single row on purpose: "In every case, the core processor for any AI
 * must be at least a mainframe. At PL 6, only an Amazing quality supercomputer is
 * up to the demands of the task."
 *
 * The modifier column follows one law across every printed cell —
 * `step = 7 - progressLevel - qualityIndex` — which reproduces the Player's
 * Handbook's quality-only ladder (+d4/+d0/-d4/-d6) exactly as the PL 6 row, and
 * matches all four modifiers printed in Dataware's statblocks. Slot counts agree
 * cell-for-cell with the robot processor table at the same PL and quality, which
 * is a second independent confirmation of the unprinted rows.
 */
const AI_PROCESSORS = Object.freeze({
    'PL6-Amazing':  { progressLevel: 6, quality: 'Amazing',  activeSlots: 9,  maxSkillRank: 4,  actionCheckModifier: '-d6',  step: -2, isPrinted: true },

    'PL7-Marginal': { progressLevel: 7, quality: 'Marginal', activeSlots: 4,  maxSkillRank: 3,  actionCheckModifier: '+d0',  step:  0, isPrinted: false },
    'PL7-Ordinary': { progressLevel: 7, quality: 'Ordinary', activeSlots: 7,  maxSkillRank: 6,  actionCheckModifier: '-d4',  step: -1, isPrinted: true },
    'PL7-Good':     { progressLevel: 7, quality: 'Good',     activeSlots: 10, maxSkillRank: 9,  actionCheckModifier: '-d6',  step: -2, isPrinted: true },
    'PL7-Amazing':  { progressLevel: 7, quality: 'Amazing',  activeSlots: 13, maxSkillRank: 12, actionCheckModifier: '-d8',  step: -3, isPrinted: true },

    'PL8-Marginal': { progressLevel: 8, quality: 'Marginal', activeSlots: 7,  maxSkillRank: 6,  actionCheckModifier: '-d4',  step: -1, isPrinted: false },
    'PL8-Ordinary': { progressLevel: 8, quality: 'Ordinary', activeSlots: 10, maxSkillRank: 9,  actionCheckModifier: '-d6',  step: -2, isPrinted: true },
    'PL8-Good':     { progressLevel: 8, quality: 'Good',     activeSlots: 15, maxSkillRank: 12, actionCheckModifier: '-d8',  step: -3, isPrinted: true },
    'PL8-Amazing':  { progressLevel: 8, quality: 'Amazing',  activeSlots: 18, maxSkillRank: 12, actionCheckModifier: '-d12', step: -4, isPrinted: false },
});

/** Highest rank any Alternity skill can reach, whatever the hardware allows. */
const AI_MAX_SKILL_RANK = 12;

/**
 * Actions per round and base action check score, crossing the quality of the AI
 * *program* with the quality of the *processor* (Player's Handbook Ch.10).
 *
 * The score column is a clean `10 + 2 x processorIndex + programIndex`, which is
 * how the two half-legible cells in the scan were recovered.
 *
 * Five of the six AIs printed in Dataware Ch.5 land on this grid exactly for
 * actions per round, and on the score once their achievement level is allowed for.
 * The exception is the PL 6 Prototype, which prints 2 actions and a score of 12
 * where an Ordinary program on an Amazing processor gives 3 and 17. It is the one
 * AI the text calls out as underpowered — "it has limited abilities and its makers
 * are uncertain of its potential" — so it is treated as a deliberate one-off
 * rather than evidence of a second rule, and is entered by hand like any statblock
 * that disagrees with its own tables.
 */
const AI_ACTION_CHECK_GRID = Object.freeze({
    Marginal: Object.freeze({
        Marginal: { score: 10, actionsPerRound: 1 }, Ordinary: { score: 12, actionsPerRound: 1 },
        Good:     { score: 14, actionsPerRound: 2 }, Amazing:  { score: 16, actionsPerRound: 2 },
    }),
    Ordinary: Object.freeze({
        Marginal: { score: 11, actionsPerRound: 1 }, Ordinary: { score: 13, actionsPerRound: 2 },
        Good:     { score: 15, actionsPerRound: 2 }, Amazing:  { score: 17, actionsPerRound: 3 },
    }),
    Good: Object.freeze({
        Marginal: { score: 12, actionsPerRound: 2 }, Ordinary: { score: 14, actionsPerRound: 3 },
        Good:     { score: 16, actionsPerRound: 3 }, Amazing:  { score: 18, actionsPerRound: 4 },
    }),
    Amazing: Object.freeze({
        Marginal: { score: 13, actionsPerRound: 2 }, Ordinary: { score: 15, actionsPerRound: 3 },
        Good:     { score: 17, actionsPerRound: 4 }, Amazing:  { score: 19, actionsPerRound: 4 },
    }),
});

/**
 * Skills no AI can hold, whatever its hardware.
 *
 * Everything hung off Strength, Dexterity or Constitution is out — those scores
 * belong to a Grid avatar, not to the AI — and the Player's Handbook names three
 * further specialties that "can't be loaded into a program".
 */
const AI_BARRED_ABILITIES = Object.freeze(['STR', 'DEX', 'CON']);
const AI_BARRED_SKILLS = Object.freeze(['awareness-intuition', 'resolve-mental', 'resolve-physical']);

/**
 * Broad skills an AI can hold but is bad at, and the step penalty each carries.
 *
 * "The greater the emotional or cultural value of a skill, the less the AI
 * understands the subject." Keyed by lowercased broad-skill name.
 */
const AI_SKILL_PENALTIES = Object.freeze({
    creativity:  3,
    deception:   1,
    interaction: 2,
    leadership:  3,
});

/** The four broad skills every AI is built with (Dataware, "Acquiring Skills"). */
const AI_FREE_BROAD_SKILLS = Object.freeze(['AI Functions', 'Computer Science', 'Knowledge']);

/** Specialties of the AI Functions broad skill, available to every AI. */
const AI_FUNCTION_SPECIALTIES = Object.freeze(['multitask', 'prediction', 'remote']);

/** "as many as 10 duplicate shadows", each at a penalty of one less than the count. */
const AI_MAX_MIRROR_SHADOWS = 10;

// ---------------------------------------------------------------------------
// Supporting cast (Gamemaster Guide Ch.7)
// ---------------------------------------------------------------------------
//
// "Supporting cast" is the book's umbrella term for every Gamemaster-run
// character, and the decisive point is that they are **not** a simplified chassis:
// "These supporting cast members receive the same number of stun, wound, fatigue,
// and mortal points as a hero with the same Constitution score, and they determine
// their action check score and actions per round normally."
//
// So they use the hero stat model outright. The only genuinely different chassis in
// the book is the animal/alien creature block, which is a separate actor type.

/** The four heroic professions, plus the nonprofessional default. */
const PROFESSIONS = Object.freeze([
    'Nonprofessional', 'Combat Spec', 'Free Agent', 'Diplomat', 'Tech Op', 'Mindwalker',
]);

/**
 * Action check score increase granted by profession.
 *
 * Every value here is printed verbatim in a profession's benefits list:
 *   Combat Spec +3, Free Agent +2, Diplomat +1, Tech Op +1 (Player's Handbook
 *   Ch.2), and Mindwalker +1 (Mindwalking Ch.1, "A Mindwalker's action check score
 *   is increased by 1 point").
 *
 * A nonprofessional gets nothing: "A nonprofessional's base situation die for
 * action checks is +d0. He receives no action check bonus because he doesn't
 * belong to one of the heroic professions."
 *
 * Note that Mindwalker is a genuine fifth profession, not a variant — "Mindwalker
 * is a profession, just as Combat Spec, Diplomat, Free Agent, and Tech Op are."
 * The hero sheet's own copy of this formula omitted it, so every Mindwalker hero
 * was silently scoring one point low until this table replaced it.
 */
const PROFESSION_ACTION_CHECK_BONUS = Object.freeze({
    Nonprofessional: 0,
    'Combat Spec':   3,
    'Free Agent':    2,
    Diplomat:        1,
    'Tech Op':       1,
    Mindwalker:      1,
});

/**
 * The four supporting-cast quality tiers (Gamemaster Guide, "Supporting Character
 * Templates"). Each template in the book prints one column per tier.
 *
 *   heroLevel      the achievement level this tier is "equivalent in power" to
 *   averageAbility the tier's stated average Ability Score
 *
 * Marginal is the odd one out and it matters mechanically: "Marginal characters —
 * average members of society — are nonprofessionals", so a Marginal supporting cast
 * member takes no profession action check bonus however they are labelled.
 */
const NPC_QUALITY_TIERS = Object.freeze({
    Marginal: { label: 'Marginal', heroLevel: null, averageAbility: 9,  isNonprofessional: true },
    Ordinary: { label: 'Ordinary', heroLevel: 1,    averageAbility: 10, isNonprofessional: false },
    Good:     { label: 'Good',     heroLevel: 6,    averageAbility: 11, isNonprofessional: false },
    Amazing:  { label: 'Amazing',  heroLevel: 12,   averageAbility: 12, isNonprofessional: false },
});

/** The five categories the book sorts supporting characters into. */
const SUPPORTING_CAST_ROLES = Object.freeze([
    'Villain', 'Ally', 'Sidekick', 'Employee', 'Follower', 'Expert', 'Extra',
]);

/** Degrees a reaction score can be pitched at, worst to best. */
const REACTION_DEGREES = Object.freeze(['Marginal', 'Ordinary', 'Good', 'Amazing']);

// ---------------------------------------------------------------------------
// Creatures (Gamemaster Guide Ch.19: Animal & Alien Statistics)
// ---------------------------------------------------------------------------
//
// The one chassis in the corpus that genuinely is not a hero. The book opens by
// warning that it does not obey its own derivations:
//
//   "However, they don't always 'play by the rules' in terms of statistics that are
//    derived from other statistics. ... Don't be [surprised] when you see apparent
//    inaccuracies such as these in the descriptions that follow — some numbers are
//    purposely modified to yield a clearer picture of what a certain type of
//    creature is."
//
// So creature action checks and attack scores are entered as printed, not derived.
// The dog is the clearest case: DEX 11 and INT 3 would give an action check of 7,
// and it prints 13. Durability is the one stat that does hold, across all seven
// fully printed compendium entries.

/** What kind of thing this is. The chapter covers animals and nonhumanoid aliens. */
const CREATURE_CATEGORIES = Object.freeze(['Animal', 'Alien', 'Construct', 'Other']);

/**
 * The three damage forms Alternity actually has: Low Impact, High Impact, Energy
 * (PHB Ch.11, the weapon table's "Type" column — see alternity-core-mechanics.md).
 *
 * This is the *only* damage-type axis in the game. Armour is rated separately
 * against each of the three, which is why a hero's armour block is `{li, hi, en}`,
 * why creature natural armour is, and why every attack has to name one of these to
 * be armourable at all.
 */
const DAMAGE_TYPES = Object.freeze(['LI', 'HI', 'En']);

/** Long labels, for a select that has room for them. */
const DAMAGE_TYPE_LABELS = Object.freeze({
    LI: 'LI — Low Impact',
    HI: 'HI — High Impact',
    En: 'En — Energy',
});

/**
 * Maps the d20-flavoured damage list that `WeaponData`, `ArmorData` and
 * `EffectData` used to carry — Ballistic, Slashing, Piercing, Laser and so on —
 * onto the three forms the rules recognise.
 *
 * That list was a leftover, and an actively harmful one: `applyAlternityDamage`
 * compares a weapon's damage type against an armour's resisted types, so those two
 * agreed with each other while neither could ever match the LI/HI/En ratings the
 * sheets display and the rules use. Armour mitigation was quietly inert.
 *
 * Nothing in the old list corresponds to High Impact — HI is what armour-piercing
 * and heavy weapons do, and the d20 names carry no such distinction — so no value
 * maps to it. Anything not clearly an energy weapon becomes Low Impact, which is
 * both the commonest form in the weapon tables and the *weakest*: guessing LI can
 * never leave a migrated weapon hitting harder than it did, whereas guessing HI or
 * En would. A Gamemaster who has an armour-piercing weapon has to say so, and the
 * migration logs each conversion so they know where to look.
 */
const LEGACY_DAMAGE_TYPE_MAP = Object.freeze({
    Ballistic:  'LI',
    Piercing:   'LI',
    Slashing:   'LI',
    Impact:     'LI',
    Toxic:      'LI',
    Psionic:    'LI',
    Energy:     'En',
    Laser:      'En',
    Incendiary: 'En',
    Radiation:  'En',
});

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

/** The lowest and highest step the scale above can express. */
const MIN_STEP = -5;
const MAX_STEP = 7;

/**
 * The three damage grades a personal-scale attack can inflict, least → most
 * severe, and the single letters the books suffix onto a damage code to mark
 * them ("d4+1s" is one stun grade, "d6+2w" one wound grade).
 */
const PERSONAL_DAMAGE_GRADES = Object.freeze(['stun', 'wound', 'mortal']);
const DAMAGE_CODE_SUFFIXES = Object.freeze({ s: 'stun', w: 'wound', m: 'mortal' });

/**
 * Table P16 / Table P17 "Conditions" — the ladder a Gamemaster names a
 * circumstance on, rather than computing steps directly. Table P17 adds the
 * "Critical" tier beyond Extreme; both are offered so one picker covers both
 * tables (see alternity-core-mechanics.md).
 */
const CONDITION_STEP_MODIFIERS = Object.freeze({
    Amazing:  -3,
    Good:     -2,
    Ordinary: -1,
    Marginal:  0,
    Slight:    1,
    Moderate:  2,
    Extreme:   3,
    Critical:  4,
});

/**
 * Table P22 — Range Modifiers by Weapon Type. A weapon's range *class* is a
 * different axis from its `weaponType` (Melee/Ranged/Thrown/Heavy): the table
 * keys off what kind of gun it is, because a rifle degrades over distance far
 * more gently than a pistol does.
 *
 * `Melee` carries no band modifiers at all — a melee weapon's range is
 * "Personal", which the table does not rate — and is present so a weapon can
 * say "this column does not apply to me" rather than defaulting to a gun.
 * Flintlocks use the Pistol or Rifle row as appropriate (PHB Ch.11).
 */
const RANGE_BANDS = Object.freeze(['short', 'medium', 'long']);

const RANGE_STEP_MODIFIERS = Object.freeze({
    Melee:     null,
    Primitive: Object.freeze({ short: -1, medium: 1, long: 2 }),
    Pistol:    Object.freeze({ short: -1, medium: 1, long: 3 }),
    Rifle:     Object.freeze({ short: -1, medium: 0, long: 1 }),
    SMG:       Object.freeze({ short: -1, medium: 1, long: 3 }),
});

const RANGE_CLASSES = Object.freeze(Object.keys(RANGE_STEP_MODIFIERS));

/**
 * Dodge Defense (PHB; see alternity-core-mechanics.md "Dodge Defense"). A
 * successful Acrobatics-dodge check adjusts the defender's STR/DEX resistance
 * modifier against the next attack — i.e. it is a step *penalty* handed to the
 * attacker, which is why the successful degrees are positive here.
 *
 * A Critical Failure is the one entry that runs the other way: the dodge goes
 * so wrong it makes the defender easier to hit.
 */
const DODGE_STEP_ADJUSTMENTS = Object.freeze({
    [SUCCESS_DEGREES.CRITICAL_FAILURE]: -2,
    [SUCCESS_DEGREES.FAILURE]:           0,
    [SUCCESS_DEGREES.ORDINARY]:          1,
    [SUCCESS_DEGREES.GOOD]:              2,
    [SUCCESS_DEGREES.AMAZING]:           3,
});

/**
 * How many successes each degree contributes to a complex skill check
 * (Table P17, bottom half), and how many the task's complexity demands.
 */
const COMPLEX_CHECK_SUCCESS_VALUES = Object.freeze({
    [SUCCESS_DEGREES.ORDINARY]: 1,
    [SUCCESS_DEGREES.GOOD]:     2,
    [SUCCESS_DEGREES.AMAZING]:  3,
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
    const step = Math.min(MAX_STEP, Math.max(MIN_STEP, totalStep));
    const entry = SITUATION_DIE_SCALE[String(step)];
    return {
        sign: entry[0],
        die: entry[1],
        formula: entry[2],
        // The step actually used, which is not the caller's step once the scale's
        // ends are reached: a +9 total still rolls +3d20. Callers that build a
        // Foundry formula need this rather than the unclamped total.
        step,
        isClamped: step !== totalStep,
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
     *   stepDie:       object,       // {sign, die, formula, step, isClamped}
     *   succeeded:     boolean|null,
     *   degree:        string|null,
     *   result:        number|null,  // Combined roll result
     *   finalValue:    number|null,  // Alias of `result` — see note below
     *   margin:        number|null,  // Ordinary score minus result; negative on a miss
     *   controlRoll:   number|null,
     *   situationRoll: number|null,
     * }}
     *
     * `finalValue` and `margin` exist because callers (the hook layer, the roll
     * component, the chat card) have always read them and this method has never
     * returned them, so every roll card's breakdown footer rendered blank.
     *
     * In a roll-under system there is no "adjusted target": the target is the
     * score triple and it never moves. What the modifiers adjust is the *roll*.
     * So `finalValue` is the combined result the scores are compared against —
     * the number that actually decides the outcome — not a shifted DC.
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
        let margin    = null;
        let controlRoll = null;
        let situationRoll = null;

        if (rolls !== null) {
            controlRoll = rolls.control;
            situationRoll = rolls.situation || 0;

            result = controlRoll + (stepDie.sign * situationRoll);
            degree = _calculateDegree(result, scores, controlRoll);
            succeeded = degree !== SUCCESS_DEGREES.FAILURE && degree !== SUCCESS_DEGREES.CRITICAL_FAILURE;
            margin = scores.ordinary - result;
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
            finalValue: result,
            margin,
            controlRoll,
            situationRoll
        };
    },


    // -----------------------------------------------------------------------
    // buildSituationFormula
    // -----------------------------------------------------------------------

    /**
     * Build the dice formula for a check at a given total step.
     *
     * The control die is always a d20 and the situation die is added or
     * subtracted from it, so the whole check is one Foundry Roll — which matters
     * because it keeps both dice in a single rendered roll on the chat card
     * rather than two unrelated ones.
     *
     * Returned alongside the formula are the term indices the control and
     * situation dice occupy, so a caller reading the evaluated roll back apart
     * does not have to guess at `roll.terms[2]`.
     *
     * @param {number} totalStep - Net step, clamped to the scale by the callee.
     * @returns {{
     *   formula:      string,
     *   step:         number,
     *   stepDie:      object,
     *   hasSituation: boolean,
     *   controlIndex: number,
     *   situationIndex: number|null,
     * }}
     */
    buildSituationFormula(totalStep) {
        const stepDie = _resolveStepDie(Math.round(Number(totalStep) || 0));
        // Step 0 is "+d0" — no situation die at all, not a zero-sided die.
        const hasSituation = stepDie.step !== 0;

        return {
            formula: hasSituation ? `1d20${stepDie.formula}` : '1d20',
            step: stepDie.step,
            stepDie,
            hasSituation,
            controlIndex: 0,
            // 1d20 + 1d4 parses to [Die, OperatorTerm, Die].
            situationIndex: hasSituation ? 2 : null,
        };
    },

    // -----------------------------------------------------------------------
    // getConditionStepModifier / getRangeStepModifier
    // -----------------------------------------------------------------------

    /**
     * Steps for a named circumstance on the Table P16 / P17 condition ladder.
     * @param {string} condition
     * @returns {number} 0 for an unknown name — an unrated circumstance is no modifier.
     */
    getConditionStepModifier(condition) {
        return CONDITION_STEP_MODIFIERS[condition] ?? 0;
    },

    /**
     * Steps for firing at a given range band (Table P22).
     *
     * @param {string} rangeClass - A RANGE_CLASSES key.
     * @param {string} band       - 'short' | 'medium' | 'long'.
     * @returns {{ steps: number, applies: boolean, modifierTrace: object[] }}
     *          `applies` is false for melee weapons and unknown classes, which
     *          have no band modifiers rather than a modifier of zero.
     */
    getRangeStepModifier(rangeClass, band) {
        const table = RANGE_STEP_MODIFIERS[rangeClass];
        if (!table || !RANGE_BANDS.includes(band)) {
            return { steps: 0, applies: false, modifierTrace: [] };
        }
        const steps = table[band];
        return {
            steps,
            applies: true,
            modifierTrace: steps === 0 ? [] : [this.buildModifier(
                'Range', steps, `${band} range for a ${rangeClass}-class weapon (Table P22)`
            )],
        };
    },

    // -----------------------------------------------------------------------
    // parseDamageCode
    // -----------------------------------------------------------------------

    /**
     * Split an Alternity damage code such as "d4+2w" into a dice formula and the
     * track the damage lands on.
     *
     * The trailing letter is notation, not dice: `s`/`w`/`m` name the grade
     * (stun / wound / mortal). Handing the raw string to Foundry's Roll would
     * either throw or — worse — silently reinterpret it, so every damage roll in
     * the system goes through here first.
     *
     * A bare die code with no suffix is read as wound damage, which is what the
     * weapon tables mean when they omit the letter on a middle column.
     *
     * @param {string} code       - e.g. "d4+2w", "2d6", "d6+1s".
     * @param {object} [options]
     * @param {string} [options.fallbackCategory='wound'] - Grade for a suffixless code.
     * @returns {{
     *   formula:  string,   // Roll-safe formula ('' when the code is empty)
     *   category: string,   // 'stun' | 'wound' | 'mortal'
     *   isValid:  boolean,  // false when there is nothing to roll
     *   hadSuffix: boolean,
     *   raw:      string,
     * }}
     */
    parseDamageCode(code, options = {}) {
        const fallbackCategory = PERSONAL_DAMAGE_GRADES.includes(options.fallbackCategory)
            ? options.fallbackCategory
            : 'wound';
        const raw = String(code ?? '').trim();

        if (!raw) {
            return { formula: '', category: fallbackCategory, isValid: false, hadSuffix: false, raw };
        }

        const suffixMatch = /([swm])\s*$/i.exec(raw);
        const hadSuffix = suffixMatch !== null;
        const category = hadSuffix
            ? DAMAGE_CODE_SUFFIXES[suffixMatch[1].toLowerCase()]
            : fallbackCategory;

        // Strip the grade letter, then normalise the bare-die shorthand the books
        // use: "d4+2" means one d4, and Foundry needs the count spelled out.
        const body = (hadSuffix ? raw.slice(0, suffixMatch.index) : raw).trim();
        const formula = body.replace(/(^|[^\d\w])d(\d)/gi, '$11d$2');

        return {
            formula,
            category,
            isValid: /\d/.test(formula),
            hadSuffix,
            raw,
        };
    },

    // -----------------------------------------------------------------------
    // parseScoreRun
    // -----------------------------------------------------------------------

    /**
     * Read a score run as the compendia print it — "16/8/4" — or expand a single
     * Ordinary value into the full triple.
     *
     * Statblock actors (supporting cast, creatures, ship stations) store scores
     * as text precisely because the books sometimes print a run that does not
     * obey the halve-and-quarter rule, so a printed run is honoured verbatim and
     * only a lone number is derived via `calculateScoreRun`.
     *
     * @param {string|number} text
     * @returns {{ ordinary: number, good: number, amazing: number, isValid: boolean, wasDerived: boolean }}
     */
    parseScoreRun(text) {
        const raw = String(text ?? '').trim();
        if (!raw) return { ordinary: 0, good: 0, amazing: 0, isValid: false, wasDerived: false };

        const parts = raw.split(/[/\\|,\s]+/).filter(Boolean).map((p) => parseInt(p, 10));
        if (!parts.length || !isFinite(parts[0])) {
            return { ordinary: 0, good: 0, amazing: 0, isValid: false, wasDerived: false };
        }

        const derived = this.calculateScoreRun(parts[0]);

        if (parts.length === 1 || !isFinite(parts[1])) {
            return {
                ordinary: derived.ordinary,
                good:     derived.good,
                amazing:  derived.amazing,
                isValid: true,
                wasDerived: true,
            };
        }

        return {
            ordinary: derived.ordinary,
            good:     Math.max(0, parts[1]),
            // A two-part run ("16/8") leaves Amazing to the standard quartering.
            amazing:  isFinite(parts[2]) ? Math.max(0, parts[2]) : derived.amazing,
            isValid: true,
            wasDerived: false,
        };
    },

    // -----------------------------------------------------------------------
    // selectDamageGrade
    // -----------------------------------------------------------------------

    /**
     * Pick which of a weapon's three damage codes fires, given the degree the
     * attack check achieved (PHB Ch.11: "Damage: given in Ordinary/Good/Amazing
     * order, applied depending on the wielder's skill check result").
     *
     * A missed attack selects nothing rather than falling back to the Ordinary
     * column, so a caller cannot accidentally roll damage for a failed attack.
     *
     * @param {string} degree - A SUCCESS_DEGREES value.
     * @param {{ordinary?: string, good?: string, amazing?: string}} damageRun
     * @returns {{ grade: string|null, code: string, usedFallback: boolean }}
     *          `grade` is 'ordinary' | 'good' | 'amazing', or null on a miss.
     *          `usedFallback` is true when the achieved column was left blank on
     *          the sheet and a lower one had to stand in.
     */
    selectDamageGrade(degree, damageRun = {}) {
        const ladder = ['ordinary', 'good', 'amazing'];
        const achieved = degree === SUCCESS_DEGREES.AMAZING ? 2
            : degree === SUCCESS_DEGREES.GOOD ? 1
            : degree === SUCCESS_DEGREES.ORDINARY ? 0
            : -1;

        if (achieved < 0) return { grade: null, code: '', usedFallback: false };

        // Walk down from the achieved column to the first one that has a code in
        // it. Statblocks routinely print a single damage figure for all three.
        for (let i = achieved; i >= 0; i -= 1) {
            const code = String(damageRun[ladder[i]] ?? '').trim();
            if (code) return { grade: ladder[i], code, usedFallback: i !== achieved };
        }

        return { grade: ladder[achieved], code: '', usedFallback: false };
    },

    // -----------------------------------------------------------------------
    // calculateDodgeAdjustment
    // -----------------------------------------------------------------------

    /**
     * Convert an Acrobatics-dodge check result into the step penalty the
     * defender's next attacker suffers (see alternity-core-mechanics.md,
     * "Dodge Defense").
     *
     * The value is expressed from the *attacker's* point of view — positive is a
     * penalty on their check — because that is the direction every other
     * modifier in this codebase runs, and because the dodge is ultimately handed
     * to the attacker's roll as an ordinary modifier.
     *
     * @param {string} degree - A SUCCESS_DEGREES value.
     * @returns {{ steps: number, degree: string, modifierTrace: object[] }}
     */
    calculateDodgeAdjustment(degree) {
        const steps = DODGE_STEP_ADJUSTMENTS[degree] ?? 0;
        return {
            steps,
            degree,
            modifierTrace: steps === 0 ? [] : [this.buildModifier(
                'Dodge', steps, `${degree} Acrobatics-dodge adjusts the defender's resistance modifier`
            )],
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

    // -----------------------------------------------------------------------
    // calculateChassisPoints
    // -----------------------------------------------------------------------

    /**
     * Resolve a robot's Chassis Point budget and its percentage denominations
     * (7Foundry Ch.3.5, Table 3.3).
     *
     *   CP = h x (30 - CON)
     *
     * Note the sign: Chassis Points run *inverse* to Constitution. A tougher robot
     * is more densely packed and has less room inside it, so durability is bought
     * directly at the cost of installable space. That trade is the central design
     * tension of the whole system.
     *
     * The three factors are what the statblocks actually quote ("170 Chassis
     * Points, 10%=17CP, 5%=9CP, 1%=2CP"), because system costs are paid in those
     * denominations rather than computed per system — see decomposeChassisPercent.
     *
     * @param {string} sizeKey       - A key of ROBOT_SIZES.
     * @param {number} constitution  - The robot's CON score.
     * @returns {{
     *   chassisPoints: number,
     *   sizeFactor:    number,
     *   factors:       { ten: number, five: number, one: number },
     *   isConOutOfRange: boolean,
     *   size:          object,
     *   modifierTrace: object[],
     * }}
     */
    calculateChassisPoints(sizeKey, constitution) {
        const size = ROBOT_SIZES[sizeKey];
        if (!size) {
            throw new Error(
                `[AlternityMathService.calculateChassisPoints] sizeKey must be one of ` +
                `${Object.keys(ROBOT_SIZES).join(', ')}. Received "${sizeKey}".`
            );
        }
        const con = Math.max(0, Math.floor(Number(constitution) || 0));
        const chassisPoints = Math.max(0, Math.round(size.factor * (30 - con)));

        // Percentages are rounded half up. Computed as (cp * pct) / 100 rather than
        // cp * 0.05 so the halves land exactly instead of drifting in binary float.
        const factorOf = (pct) => Math.round((chassisPoints * pct) / 100);

        return {
            chassisPoints,
            sizeFactor: size.factor,
            factors: { ten: factorOf(10), five: factorOf(5), one: factorOf(1) },
            isConOutOfRange: con < size.minCon || con > size.maxCon,
            size,
            modifierTrace: [
                this.buildModifier('Size Factor', size.factor, `${size.label} chassis, h = ${size.factor}`),
                this.buildModifier('Constitution', -con, `CP = h x (30 - ${con}) — durability costs space`),
                this.buildModifier('Chassis Points', chassisPoints, `${size.factor} x ${30 - con} = ${chassisPoints}`),
            ],
        };
    },

    // -----------------------------------------------------------------------
    // decomposeChassisPercent
    // -----------------------------------------------------------------------

    /**
     * Break a chassis-space percentage into the **minimum number** of 10/5/1%
     * factors, and price it (7Foundry Ch.3.5).
     *
     * This is the rule that makes robot construction non-arithmetic. Space is paid
     * in denominations, and because each denomination is separately rounded, buying
     * six 5% systems is not the same as buying 30% of the chassis:
     *
     *   medium chassis, CON 8 -> 110 CP, so 10% = 11, 5% = 6, 1% = 1
     *   six wheels at 5% each = 30% = three 10% factors = 33 CP, not 6 x 6 = 36
     *
     * Greedy resolution is provably minimal here because each denomination divides
     * the next (10 = 2x5, 5 = 5x1).
     *
     * @param {number} percent - Total chassis percentage to pay for.
     * @param {{ ten: number, five: number, one: number }} factors - From calculateChassisPoints.
     * @returns {{
     *   percent:       number,
     *   counts:        { ten: number, five: number, one: number },
     *   factorCount:   number,
     *   chassisPoints: number,
     *   modifierTrace: object[],
     * }}
     */
    decomposeChassisPercent(percent, factors = { ten: 0, five: 0, one: 0 }) {
        const pct = Math.max(0, Math.round(Number(percent) || 0));

        const ten  = Math.floor(pct / 10);
        const five = Math.floor((pct % 10) / 5);
        const one  = pct % 5;

        const chassisPoints =
            ten * (factors.ten ?? 0) + five * (factors.five ?? 0) + one * (factors.one ?? 0);

        const modifierTrace = [];
        if (ten)  modifierTrace.push(this.buildModifier('10% factors', ten * (factors.ten ?? 0), `${ten} x ${factors.ten ?? 0} CP`));
        if (five) modifierTrace.push(this.buildModifier('5% factors',  five * (factors.five ?? 0), `${five} x ${factors.five ?? 0} CP`));
        if (one)  modifierTrace.push(this.buildModifier('1% factors',  one * (factors.one ?? 0),  `${one} x ${factors.one ?? 0} CP`));

        return {
            percent: pct,
            counts: { ten, five, one },
            factorCount: ten + five + one,
            chassisPoints,
            modifierTrace,
        };
    },

    // -----------------------------------------------------------------------
    // calculateRobotActionCheck
    // -----------------------------------------------------------------------

    /**
     * Resolve a robot's action check scores (7Foundry Ch.5.5).
     *
     * A robot's action check leans on Intelligence rather than splitting evenly
     * with Dexterity, because what governs its reaction time is how fast it
     * processes what it sees:
     *
     *   AC = (2 x INT + DEX) / 3, rounded to the nearest value
     *
     * versus the biological hero's `(INT + DEX) / 2`. Everything after that — the
     * profession bonus and the split into phases — is identical to any other hero,
     * so it is derived here the same way AlternityCharacterState does it.
     *
     * @param {number} intelligence
     * @param {number} dexterity
     * @param {object} [options]
     * @param {string} [options.profession=''] - Profession name; supplies the bonus.
     * @param {number} [options.bonus=null]    - Explicit bonus, overriding profession.
     * @returns {{
     *   base: number, bonus: number,
     *   marginal: number, ordinary: number, good: number, amazing: number,
     *   modifierTrace: object[],
     * }}
     */
    calculateRobotActionCheck(intelligence, dexterity, options = {}) {
        const { profession = '', bonus = null } = options;
        const int = Math.max(0, Math.floor(Number(intelligence) || 0));
        const dex = Math.max(0, Math.floor(Number(dexterity) || 0));

        const base = Math.round((2 * int + dex) / 3);

        let professionBonus = bonus;
        if (professionBonus === null) {
            const prof = String(profession).toLowerCase();
            if (prof.includes('combat')) professionBonus = 3;
            else if (prof.includes('free') || prof.includes('agent')) professionBonus = 2;
            else if (prof.includes('diplomat') || prof.includes('tech')) professionBonus = 1;
            else professionBonus = 0;
        }

        const ordinary = base + professionBonus;

        return {
            base,
            bonus: professionBonus,
            marginal: ordinary + 1,
            ordinary,
            good:    Math.floor(ordinary / 2),
            amazing: Math.floor(ordinary / 4),
            modifierTrace: [
                this.buildModifier('Intelligence', 2 * int, `2 x INT ${int}`),
                this.buildModifier('Dexterity', dex, `DEX ${dex}`),
                this.buildModifier('Base', base, `(2 x ${int} + ${dex}) / 3, rounded`),
                this.buildModifier('Profession', professionBonus, professionBonus
                    ? `${profession || 'Profession'} bonus`
                    : 'No profession bonus'),
            ],
        };
    },

    // -----------------------------------------------------------------------
    // calculateRobotActionsPerRound
    // -----------------------------------------------------------------------

    /**
     * Resolve how many actions a robot gets per round (7Foundry Ch.5.5).
     *
     *   A/R = (INT + DEX) / 8, minimum 1
     *
     * Nothing like the biological hero's WIL/CON derivation — for a robot it is
     * processor speed and actuator response, not stamina and nerve.
     *
     * Two hardware ceilings then apply, and both are easy to trip: the processor's
     * own MA/R, and the cabling's, so a fast brain in a serially-wired chassis
     * still only acts once. The worked CIMDR-13 build lands on 2 as
     * min(2 by formula, 3 from a Good PL5 processor, 2 from Parallel cabling).
     *
     * @param {number} intelligence
     * @param {number} dexterity
     * @param {object} [options]
     * @param {number|null} [options.processorMax=null] - Processor MA/R ceiling.
     * @param {number|null} [options.cablingMax=null]   - Cabling MA/R ceiling.
     * @returns {{
     *   actionsPerRound: number, formulaValue: number,
     *   cappedBy: string|null, modifierTrace: object[],
     * }}
     */
    calculateRobotActionsPerRound(intelligence, dexterity, options = {}) {
        const { processorMax = null, cablingMax = null } = options;
        const int = Math.max(0, Math.floor(Number(intelligence) || 0));
        const dex = Math.max(0, Math.floor(Number(dexterity) || 0));

        const formulaValue = Math.max(1, Math.round((int + dex) / 8));
        const modifierTrace = [
            this.buildModifier('Formula', formulaValue, `(INT ${int} + DEX ${dex}) / 8, minimum 1`),
        ];

        let actionsPerRound = formulaValue;
        let cappedBy = null;

        if (processorMax !== null && processorMax < actionsPerRound) {
            actionsPerRound = processorMax;
            cappedBy = 'processor';
            modifierTrace.push(this.buildModifier('Processor', processorMax, 'Processor MA/R ceiling'));
        }
        if (cablingMax !== null && cablingMax < actionsPerRound) {
            actionsPerRound = cablingMax;
            cappedBy = 'cabling';
            modifierTrace.push(this.buildModifier('Cabling', cablingMax, 'Cabling MA/R ceiling'));
        }

        return { actionsPerRound: Math.max(1, actionsPerRound), formulaValue, cappedBy, modifierTrace };
    },

    // -----------------------------------------------------------------------
    // calculateRobotDurability
    // -----------------------------------------------------------------------

    /**
     * Resolve a robot's damage tracks (7Foundry Ch.3.5).
     *
     *   stun = wound = CON,  mortal = ceil(CON / 2)
     *
     * "Robots do not have a fatigue rating, except when specifically stated" — a
     * machine does not get tired — so unlike `calculateDurabilityRatings` for
     * biological heroes this returns no fatigue track. Biological and
     * synthetic-tissue actuators are the stated exception.
     *
     * @param {number} constitution
     * @param {object}  [options]
     * @param {boolean} [options.hasFatigueTrack=false] - Biological/synthetic tissue.
     * @returns {{ stun: number, wound: number, mortal: number, fatigue: number|null, modifierTrace: object[] }}
     */
    calculateRobotDurability(constitution, options = {}) {
        const { hasFatigueTrack = false } = options;
        const con = Math.max(0, Math.floor(Number(constitution) || 0));
        const mortal = Math.ceil(con / 2);

        return {
            stun: con,
            wound: con,
            mortal,
            fatigue: hasFatigueTrack ? mortal : null,
            modifierTrace: [
                this.buildModifier('Constitution', con, `Stun and wound both equal CON ${con}`),
                this.buildModifier('Mortal', mortal, `Half of CON ${con}, rounded up`),
                this.buildModifier('Fatigue', 0, hasFatigueTrack
                    ? 'Biological or synthetic tissue — this chassis does fatigue'
                    : 'Robots have no fatigue track'),
            ],
        };
    },

    // -----------------------------------------------------------------------
    // calculateRobotSkillPoints
    // -----------------------------------------------------------------------

    /**
     * Resolve a robot's skill point budget (7Foundry Ch.5.3).
     *
     *   SP = 30 + (3 x INT), then the net of any perks bought and flaws taken
     *
     * Identical to a standard humanoid. Verified against the CIMDR-13 build:
     * INT 8 gives 54, and a +2 perk/flaw balance brings it to 56.
     *
     * @param {number} intelligence
     * @param {number} [perkFlawBalance=0] - Net SP from perks (negative) and flaws (positive).
     * @param {number} [spent=0]           - Skill points already committed.
     * @returns {{
     *   total: number, spent: number, remaining: number,
     *   isOverspent: boolean, modifierTrace: object[],
     * }}
     */
    calculateRobotSkillPoints(intelligence, perkFlawBalance = 0, spent = 0) {
        const int = Math.max(0, Math.floor(Number(intelligence) || 0));
        const balance = Math.round(Number(perkFlawBalance) || 0);
        const used = Math.max(0, Math.round(Number(spent) || 0));
        const total = ROBOT_BASE_SKILL_POINTS + 3 * int + balance;

        return {
            total,
            spent: used,
            remaining: total - used,
            isOverspent: used > total,
            modifierTrace: [
                this.buildModifier('Base', ROBOT_BASE_SKILL_POINTS, 'Every hero starts with 30'),
                this.buildModifier('Intelligence', 3 * int, `3 x INT ${int}`),
                this.buildModifier('Perks & Flaws', balance, 'Net of perks bought and flaws taken'),
            ],
        };
    },

    // -----------------------------------------------------------------------
    // calculateRobotMemoryLoad
    // -----------------------------------------------------------------------

    /**
     * Resolve a robot's active memory usage (7Foundry Ch.4.3).
     *
     * A robot's skills *are* programs, and the processor's active memory is what
     * decides how many it can hold at once:
     *   - the background OS permanently occupies one slot
     *   - every broad skill costs one slot
     *   - every specialty skill costs one slot **per rank loaded**
     *
     * Partial loads are legal — a robot with 8 ranks in two skills and 10 free
     * slots can hold 5 ranks of each — which is why entries carry `ranksLoaded`
     * separately from the ranks they own. Hardware such as boost, accelerator and
     * targeting chipsets reserves further slots while active.
     *
     * A robot that cannot hold everything at once is not misbuilt; it just has to
     * spend actions swapping skills in and out mid-scene, which the CIMDR-13's
     * designer notes is "very, very slow".
     *
     * @param {number|null} maxSlots - Processor Mact; null means unlimited (PL9).
     * @param {Array<{name?: string, isBroad?: boolean, ranksLoaded?: number, isLoaded?: boolean}>} [entries]
     * @param {object} [options]
     * @param {number} [options.reservedSlots=0] - Slots held by chipsets and coprocessors.
     * @param {boolean} [options.hasAI=false]    - An installed AI fills every slot.
     * @returns {{
     *   max: number, used: number, remaining: number,
     *   isFull: boolean, isOverloaded: boolean, isUnlimited: boolean,
     *   osSlots: number, skillSlots: number, reservedSlots: number,
     *   modifierTrace: object[],
     * }}
     */
    calculateRobotMemoryLoad(maxSlots, entries = [], options = {}) {
        const { reservedSlots = 0, hasAI = false } = options;
        if (!Array.isArray(entries)) {
            throw new Error('[AlternityMathService.calculateRobotMemoryLoad] entries must be an array.');
        }

        const isUnlimited = maxSlots === null || maxSlots === undefined;
        const max = isUnlimited ? Infinity : Math.max(0, Math.floor(Number(maxSlots) || 0));

        const modifierTrace = [
            this.buildModifier('Operating System', ROBOT_OS_MEMORY_SLOTS, 'The background OS always holds one slot'),
        ];

        let skillSlots = 0;
        for (const entry of entries) {
            if (entry?.isLoaded === false) continue;
            // A broad skill is one slot flat; a specialty costs a slot per loaded rank.
            const slots = entry?.isBroad
                ? 1
                : Math.max(0, Math.floor(Number(entry?.ranksLoaded) || 0));
            if (slots <= 0) continue;
            skillSlots += slots;
            modifierTrace.push(this.buildModifier(
                entry?.name || 'Skill', slots,
                entry?.isBroad ? 'Broad skill — one slot' : `${slots} rank${slots === 1 ? '' : 's'} loaded`
            ));
        }

        const reserved = Math.max(0, Math.floor(Number(reservedSlots) || 0));
        if (reserved) {
            modifierTrace.push(this.buildModifier('Hardware', reserved, 'Chipsets and coprocessors holding slots'));
        }

        // "When an AI is loaded it fills up all the memory slots the processor had."
        // Nothing else can be held, and slot-hungry hardware stops working entirely.
        if (hasAI) {
            modifierTrace.push(this.buildModifier('Installed AI', 0, 'An AI occupies every slot the processor has'));
            return {
                max: isUnlimited ? Infinity : max,
                used: isUnlimited ? Infinity : max,
                remaining: 0,
                isFull: true,
                isOverloaded: false,
                isUnlimited,
                osSlots: ROBOT_OS_MEMORY_SLOTS,
                skillSlots,
                reservedSlots: reserved,
                modifierTrace,
            };
        }

        const used = ROBOT_OS_MEMORY_SLOTS + skillSlots + reserved;

        return {
            max: isUnlimited ? Infinity : max,
            used,
            remaining: isUnlimited ? Infinity : max - used,
            isFull: !isUnlimited && used === max,
            isOverloaded: !isUnlimited && used > max,
            isUnlimited,
            osSlots: ROBOT_OS_MEMORY_SLOTS,
            skillSlots,
            reservedSlots: reserved,
            modifierTrace,
        };
    },

    // -----------------------------------------------------------------------
    // calculateActionCheckScore
    // -----------------------------------------------------------------------

    /**
     * Resolve an action check score and its Marginal/Ordinary/Good/Amazing run.
     *
     *   Ordinary = floor((DEX + INT) / 2) + profession bonus
     *   Good     = half of that, Amazing = a quarter, both rounded down
     *   Marginal = one above Ordinary
     *
     * This is the hero formula, and the Gamemaster Guide is explicit that supporting
     * cast "determine their action check score and actions per round normally" — so
     * one function serves both. Verified against all sixteen columns of the four
     * legible supporting-character templates in the Gamemaster Guide (Administrator,
     * Bartender, Brawler and Corporate Executive, each printed at four qualities):
     * every one reproduces exactly, including the Brawler's Combat Spec +3.
     *
     * Statblocks print supporting cast as a three-value run (`12/6/3`, omitting the
     * Marginal threshold) and creatures as a four-value one (`14+/13/6/3`). Both are
     * the same numbers.
     *
     * @param {number} dexterity
     * @param {number} intelligence
     * @param {object}  [options]
     * @param {string}  [options.profession='Nonprofessional'] - Key of PROFESSION_ACTION_CHECK_BONUS.
     * @param {boolean} [options.isNonprofessional=false] - Force the bonus to zero,
     *        which is what the Marginal quality tier does regardless of label.
     * @param {number|null} [options.bonus=null] - Explicit override for the bonus.
     * @returns {{
     *   marginal: number, ordinary: number, good: number, amazing: number,
     *   base: number, professionBonus: number, modifierTrace: object[],
     * }}
     */
    calculateActionCheckScore(dexterity, intelligence, options = {}) {
        const { profession = 'Nonprofessional', isNonprofessional = false, bonus = null } = options;

        const dex = Math.max(0, Math.floor(Number(dexterity) || 0));
        const int = Math.max(0, Math.floor(Number(intelligence) || 0));
        const base = Math.floor((dex + int) / 2);

        let professionBonus;
        let reason;
        if (bonus !== null) {
            professionBonus = Math.round(Number(bonus) || 0);
            reason = 'Set directly';
        } else if (isNonprofessional) {
            professionBonus = 0;
            reason = 'Nonprofessionals receive no action check bonus';
        } else {
            professionBonus = PROFESSION_ACTION_CHECK_BONUS[profession] ?? 0;
            reason = `${profession} profession`;
        }

        const ordinary = base + professionBonus;

        return {
            marginal: ordinary + 1,
            ordinary,
            good:    Math.floor(ordinary / 2),
            amazing: Math.floor(ordinary / 4),
            base,
            professionBonus,
            modifierTrace: [
                this.buildModifier('Abilities', base, `Half of DEX ${dex} + INT ${int}, rounded down`),
                this.buildModifier('Profession', professionBonus, reason),
            ],
        };
    },

    // -----------------------------------------------------------------------
    // calculateScoreRun
    // -----------------------------------------------------------------------

    /**
     * Expand any single score into the Ordinary/Good/Amazing run the books print.
     *
     * The same halve-and-quarter rule drives every score run in Alternity — skill
     * scores, action checks, attack scores, Grid skill scores — so attack lines like
     * `Bite 16/8/4` and `Charge 13/6/3` need only their Ordinary value stored.
     *
     * @param {number} score
     * @returns {{ ordinary: number, good: number, amazing: number, label: string }}
     */
    calculateScoreRun(score) {
        const ordinary = Math.max(0, Math.floor(Number(score) || 0));
        const good = Math.floor(ordinary / 2);
        const amazing = Math.floor(ordinary / 4);
        return { ordinary, good, amazing, label: `${ordinary}/${good}/${amazing}` };
    },

    // -----------------------------------------------------------------------
    // calculateCreatureDurability
    // -----------------------------------------------------------------------

    /**
     * Resolve a creature's four durability ratings.
     *
     * Creatures start from the hero rule — stun and wound equal Constitution, mortal
     * and fatigue are half of it rounded up — and large ones then carry a flat
     * multiplier. Verified against all seven fully printed compendium entries: the
     * bear (CON 16, x1.5) gives 24/24/12/12, the buffalo (CON 14, x1.5) 21/21/10/10,
     * the elephant (CON 18, x1.5) 27/27/13/13, and the great cat, crocodile, dog and
     * horse all sit at x1.
     *
     * **This is not the weren rule, and the difference is real.** Weren "Superior
     * Durability" says to "use the character's Constitution score x 1.5" — the
     * multiplier lands on Constitution, and the halving happens afterwards. Here the
     * multiplier lands on each finished rating instead. On an odd Constitution the
     * two disagree: a weren with CON 14 gets mortal 11 (half of 21, rounded up),
     * while the buffalo at the same Constitution prints 10. Both are followed as
     * written rather than unified, because each reproduces its own source exactly.
     *
     * @param {number} constitution
     * @param {object} [options]
     * @param {number} [options.multiplier=1] - Flat multiplier on each rating.
     * @returns {{
     *   stun: number, wound: number, mortal: number, fatigue: number,
     *   base: object, multiplier: number, run: string, modifierTrace: object[],
     * }}
     */
    calculateCreatureDurability(constitution, options = {}) {
        const { multiplier = 1 } = options;
        // Deliberately not `Number(multiplier) || 1`: zero is falsy, so that idiom
        // would silently turn a multiplier of 0 into 1 instead of rejecting it.
        const mult = multiplier === null || multiplier === undefined ? 1 : Number(multiplier);
        if (!Number.isFinite(mult) || mult <= 0) {
            throw new Error(
                '[AlternityMathService.calculateCreatureDurability] multiplier must be a finite number > 0. ' +
                `Received ${JSON.stringify(multiplier)}.`
            );
        }

        // The hero ratings first, unmultiplied.
        const base = this.calculateDurabilityRatings(
            Math.max(0, Math.floor(Number(constitution) || 0))
        );

        const scale = (value) => Math.floor(value * mult);
        const stun = scale(base.stun);
        const wound = scale(base.wound);
        const mortal = scale(base.mortal);
        const fatigue = scale(base.fatigue);

        return {
            stun, wound, mortal, fatigue,
            base: { stun: base.stun, wound: base.wound, mortal: base.mortal, fatigue: base.fatigue },
            multiplier: mult,
            run: `${stun}/${wound}/${mortal}/${fatigue}`,
            modifierTrace: [
                this.buildModifier('Constitution', base.stun, 'Stun and wound both equal CON'),
                this.buildModifier('Multiplier', mult, mult === 1
                    ? 'No size multiplier'
                    : `Each rating multiplied by ${mult}, rounded down`),
            ],
        };
    },

    // -----------------------------------------------------------------------
    // calculateReactionScore
    // -----------------------------------------------------------------------

    /**
     * Resolve the reaction score printed on Gamemaster-side statblocks (`Ordinary/2`).
     *
     * This stat appears only in the Gamemaster Guide — there is not one occurrence
     * in the Player's Handbook — and **the rule that defines it did not survive the
     * scan**: the "Reaction Scores" sidebar is a floating heading whose body text
     * belongs to a different section.
     *
     * What is recoverable is the number. Across all seven fully printed creature
     * statblocks it is exactly one less than the actions per round, without
     * exception, so it is derived here. The degree is *not* derived: it broadly
     * tracks the action check score (Marginal at 8-9, Ordinary at 11-13, Good at 13)
     * but the dog and the great cat both print 13 and disagree, so it stays entered.
     *
     * @param {number} actionsPerRound
     * @param {object} [options]
     * @param {string} [options.degree='Ordinary'] - One of REACTION_DEGREES.
     * @returns {{ degree: string, number: number, label: string, modifierTrace: object[] }}
     */
    calculateReactionScore(actionsPerRound, options = {}) {
        const { degree = 'Ordinary' } = options;
        const actions = Math.max(1, Math.floor(Number(actionsPerRound) || 1));
        const number = Math.max(0, actions - 1);
        const resolved = REACTION_DEGREES.includes(degree) ? degree : 'Ordinary';

        return {
            degree: resolved,
            number,
            label: `${resolved}/${number}`,
            modifierTrace: [
                this.buildModifier('Actions', number, `One less than ${actions} action${actions === 1 ? '' : 's'} per round`),
            ],
        };
    },

    // -----------------------------------------------------------------------
    // calculateAIGridAvatar
    // -----------------------------------------------------------------------

    /**
     * Resolve the Grid avatar an artificial intelligence projects into the Grid.
     *
     * An AI has only three real Ability Scores — Intelligence, Will and
     * Personality. Its Strength, Dexterity and Constitution belong to the shadow
     * its operating system generates, and so are a function of the OS quality plus
     * half the AI's ranks in Computer Science-hacking, rounded down.
     *
     * That shadow is also what takes damage: "A shadow's durability is stun = CON,
     * wound = CON, and mortal = 1/2 CON."
     *
     * Verified against every printed AI in Dataware Ch.5. The Government Data
     * Warden is the clearest: a Good operating system (9/9/10) with hacking 4
     * (+2) prints STR 11, DEX 11, CON 12, durability 12/12/6.
     *
     * @param {string} osQuality       - One of AI_QUALITIES.
     * @param {number} [hackingRanks=0] - Ranks in Computer Science-hacking.
     * @param {object} [options]
     * @param {string} [options.program='shadowForm'] - Key of AI_AVATAR_PROGRAMS.
     * @returns {{
     *   STR: number, DEX: number, CON: number,
     *   hackingBonus: number, gridMovementRate: number,
     *   durability: { stun: number, wound: number, mortal: number },
     *   modifierTrace: object[],
     * }}
     */
    calculateAIGridAvatar(osQuality, hackingRanks = 0, options = {}) {
        const { program = 'shadowForm' } = options;

        const generator = AI_AVATAR_PROGRAMS[program];
        if (!generator) {
            throw new Error(
                `[AlternityMathService.calculateAIGridAvatar] program must be one of: ` +
                `${Object.keys(AI_AVATAR_PROGRAMS).join(', ')}. Received "${program}".`
            );
        }
        const base = generator.scores[osQuality];
        if (!base) {
            throw new Error(
                `[AlternityMathService.calculateAIGridAvatar] osQuality must be one of: ` +
                `${AI_QUALITIES.join(', ')}. Received "${osQuality}".`
            );
        }

        const ranks = Math.max(0, Math.floor(Number(hackingRanks) || 0));
        const hackingBonus = Math.floor(ranks / 2);

        const STR = base.STR + hackingBonus;
        const DEX = base.DEX + hackingBonus;
        const CON = base.CON + hackingBonus;

        return {
            STR, DEX, CON,
            hackingBonus,
            // Every printed AI's Grid movement rate is exactly twice its avatar's
            // Dexterity — 6 great DEX to 12, 13 to 26, with no exceptions.
            gridMovementRate: DEX * 2,
            durability: { stun: CON, wound: CON, mortal: Math.ceil(CON / 2) },
            modifierTrace: [
                this.buildModifier(generator.label, 0, `${osQuality} quality: STR ${base.STR}, DEX ${base.DEX}, CON ${base.CON}`),
                this.buildModifier('Hacking', hackingBonus, `Half of ${ranks} rank${ranks === 1 ? '' : 's'}, rounded down`),
            ],
        };
    },

    // -----------------------------------------------------------------------
    // calculateAIActionCheck
    // -----------------------------------------------------------------------

    /**
     * Resolve an AI's action check score and actions per round.
     *
     * The base comes from crossing the quality of the AI program with the quality
     * of the processor it runs on (AI_ACTION_CHECK_GRID). The Ordinary/Good/Amazing
     * triple then falls out of that score the same way it does for a hero — half
     * and quarter, rounded down — and the Marginal threshold sits one above it.
     *
     * `bonus` carries the AI's achievement level, which is why the printed AIs sit
     * off the grid base: the Level 16 Government Data Warden runs a Good program on
     * a Good processor for a base of 16, and prints 21+/20/10/5.
     *
     * "Values of 20 or greater still fail on a result of 20 on the control die, but
     * may succeed on higher totals" — a score can legitimately exceed 20, so it is
     * not clamped here.
     *
     * @param {string} programQuality   - Quality of the AI operating system program.
     * @param {string} processorQuality - Quality of the processor it runs on.
     * @param {object} [options]
     * @param {number} [options.bonus=0] - Achievement-level action check bonus.
     * @returns {{
     *   marginal: number, ordinary: number, good: number, amazing: number,
     *   actionsPerRound: number, baseScore: number, modifierTrace: object[],
     * }}
     */
    calculateAIActionCheck(programQuality, processorQuality, options = {}) {
        const { bonus = 0 } = options;

        const row = AI_ACTION_CHECK_GRID[programQuality];
        const cell = row?.[processorQuality];
        if (!cell) {
            throw new Error(
                `[AlternityMathService.calculateAIActionCheck] programQuality and processorQuality ` +
                `must each be one of: ${AI_QUALITIES.join(', ')}. ` +
                `Received "${programQuality}" / "${processorQuality}".`
            );
        }

        const levelBonus = Math.round(Number(bonus) || 0);
        const ordinary = cell.score + levelBonus;

        return {
            marginal: ordinary + 1,
            ordinary,
            good:    Math.floor(ordinary / 2),
            amazing: Math.floor(ordinary / 4),
            actionsPerRound: cell.actionsPerRound,
            baseScore: cell.score,
            modifierTrace: [
                this.buildModifier('Program & Processor', cell.score, `${programQuality} program on a ${processorQuality} processor`),
                this.buildModifier('Achievement Level', levelBonus, 'Action check bonuses earned with level'),
            ],
        };
    },

    // -----------------------------------------------------------------------
    // calculateGridSkillScore
    // -----------------------------------------------------------------------

    /**
     * Resolve the base Grid skill score an AI acts on inside the Grid.
     *
     * Everything an AI does in the Grid runs off Computer Science-hacking, so the
     * score is simply Intelligence plus the hacking rank, halved and quartered for
     * the Good and Amazing thresholds. All six printed AIs agree: the Grid Lord's
     * INT 18 and hacking 8 give the 26/13/6 on its sheet.
     *
     * @param {number} intelligence
     * @param {number} [hackingRank=0]
     * @returns {{ ordinary: number, good: number, amazing: number, modifierTrace: object[] }}
     */
    calculateGridSkillScore(intelligence, hackingRank = 0) {
        const int = Math.max(0, Math.floor(Number(intelligence) || 0));
        const rank = Math.max(0, Math.floor(Number(hackingRank) || 0));
        const ordinary = int + rank;

        return {
            ordinary,
            good:    Math.floor(ordinary / 2),
            amazing: Math.floor(ordinary / 4),
            modifierTrace: [
                this.buildModifier('Intelligence', int, 'Grid action runs on the AI\'s own Intelligence'),
                this.buildModifier('Hacking', rank, 'Ranks in Computer Science-hacking'),
            ],
        };
    },

    // -----------------------------------------------------------------------
    // calculateAIMemoryLoad
    // -----------------------------------------------------------------------

    /**
     * Resolve an AI's active memory usage.
     *
     * Slot accounting is the same shape as a robot's, with one decisive difference:
     * "The operating system does not take up any of the available slots of active
     * memory allowed to the AI." A robot pays a slot for its OS; an AI does not.
     *
     * A broad skill program fills one slot; a specialty costs one slot per rank, on
     * top of the slot its broad skill already holds. Partial loads are normal — a
     * mainframe AI is expected to swap programs out of storage memory mid-scene,
     * "much like a human gridpilot".
     *
     * An AI on a supercomputer core with a dedicated neural matrix has "effectively
     * no limit"; pass `isUnlimited` (or a null `maxSlots`) for that case.
     *
     * @param {number|null} maxSlots - Processor active slots; null means unlimited.
     * @param {Array<{name?: string, isBroad?: boolean, ranksLoaded?: number, isLoaded?: boolean}>} [entries]
     * @param {object} [options]
     * @param {number}  [options.reservedSlots=0] - Slots held by Grid programs and remotes.
     * @param {boolean} [options.isUnlimited=false]
     * @returns {{
     *   max: number, used: number, remaining: number,
     *   isFull: boolean, isOverloaded: boolean, isUnlimited: boolean,
     *   skillSlots: number, reservedSlots: number, modifierTrace: object[],
     * }}
     */
    calculateAIMemoryLoad(maxSlots, entries = [], options = {}) {
        const { reservedSlots = 0, isUnlimited: forceUnlimited = false } = options;
        if (!Array.isArray(entries)) {
            throw new Error('[AlternityMathService.calculateAIMemoryLoad] entries must be an array.');
        }

        const isUnlimited = forceUnlimited || maxSlots === null || maxSlots === undefined;
        const max = isUnlimited ? Infinity : Math.max(0, Math.floor(Number(maxSlots) || 0));

        const modifierTrace = [
            this.buildModifier('Operating System', 0, 'An AI\'s own OS is free — unlike a robot\'s'),
        ];

        let skillSlots = 0;
        for (const entry of entries) {
            if (entry?.isLoaded === false) continue;
            const slots = entry?.isBroad
                ? 1
                : Math.max(0, Math.floor(Number(entry?.ranksLoaded) || 0));
            if (slots <= 0) continue;
            skillSlots += slots;
            modifierTrace.push(this.buildModifier(
                entry?.name || 'Skill', slots,
                entry?.isBroad ? 'Broad skill — one slot' : `${slots} rank${slots === 1 ? '' : 's'} loaded`
            ));
        }

        const reserved = Math.max(0, Math.floor(Number(reservedSlots) || 0));
        if (reserved) {
            modifierTrace.push(this.buildModifier('Grid Programs', reserved, 'Slots held by loaded Grid programs'));
        }

        const used = skillSlots + reserved;

        return {
            max,
            used,
            remaining: isUnlimited ? Infinity : max - used,
            isFull: !isUnlimited && used === max,
            isOverloaded: !isUnlimited && used > max,
            isUnlimited,
            skillSlots,
            reservedSlots: reserved,
            modifierTrace,
        };
    },

    // -----------------------------------------------------------------------
    // getAISkillRestriction
    // -----------------------------------------------------------------------

    /**
     * Report whether an AI may hold a given skill, and what it costs it to try.
     *
     * Three separate rules collapse into one answer here:
     *   - Every Strength, Dexterity and Constitution skill is unavailable outright.
     *     Those scores belong to a Grid avatar, not to the AI.
     *   - Awareness-intuition and both Resolve specialties "can't be loaded into a
     *     program" even though Will skills are otherwise fine.
     *   - Four Personality and Will broad skills are permitted but penalised, since
     *     an AI has "few frames of reference in subtleties of culture, language,
     *     and social interaction".
     *
     * Matching is on the broad-skill name before any hyphen, so both "Interaction"
     * and "Interaction-bargain" resolve to the same +2.
     *
     * @param {string} skillName - Broad skill, or "Broad-specialty".
     * @param {string} [linkedAbility] - Ability the skill hangs off, if known.
     * @returns {{ isBarred: boolean, penalty: number, reason: string|null }}
     */
    getAISkillRestriction(skillName, linkedAbility = null) {
        const name = String(skillName ?? '').trim().toLowerCase();
        const ability = linkedAbility ? String(linkedAbility).toUpperCase() : null;

        if (ability && AI_BARRED_ABILITIES.includes(ability)) {
            return {
                isBarred: true, penalty: 0,
                reason: `All ${ability} skills are unavailable to an AI — that score belongs to its Grid avatar`,
            };
        }
        if (AI_BARRED_SKILLS.includes(name)) {
            return { isBarred: true, penalty: 0, reason: 'This specialty cannot be loaded into a program' };
        }

        const broad = name.split('-')[0].trim();
        const penalty = AI_SKILL_PENALTIES[broad] ?? 0;

        return {
            isBarred: false,
            penalty,
            reason: penalty ? `An AI applies a +${penalty} step penalty to ${broad} checks` : null,
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
    MIN_STEP,
    MAX_STEP,
    PERSONAL_DAMAGE_GRADES,
    CONDITION_STEP_MODIFIERS,
    RANGE_CLASSES,
    RANGE_BANDS,
    RANGE_STEP_MODIFIERS,
    DODGE_STEP_ADJUSTMENTS,
    COMPLEX_CHECK_SUCCESS_VALUES,
    SHIP_TOUGHNESS_CLASSES,
    SHIP_DAMAGE_GRADES,
    FIREPOWER_CLASSES,
    COMPARTMENT_DAMAGE_GRADES,
    COMPARTMENT_KINDS,
    SPACESHIP_TOUGHNESS,
    MAX_COMPARTMENT_DURABILITY,
    SHIP_ARMOR_DURABILITY_FRACTION,
    ROBOT_SIZES,
    ROBOT_PROCESSORS,
    ROBOT_CABLING,
    CHASSIS_FACTORS,
    ROBOT_OS_MEMORY_SLOTS,
    ROBOT_LIMB_PERCENT,
    ROBOT_BASE_SKILL_POINTS,
    AI_QUALITIES,
    AI_PROCESSORS,
    AI_ACTION_CHECK_GRID,
    AI_AVATAR_PROGRAMS,
    SHADOW_FORM_SCORES,
    SHADOW_FORM_2_SCORES,
    AI_BARRED_ABILITIES,
    AI_BARRED_SKILLS,
    AI_SKILL_PENALTIES,
    AI_FREE_BROAD_SKILLS,
    AI_FUNCTION_SPECIALTIES,
    AI_MAX_MIRROR_SHADOWS,
    AI_MAX_SKILL_RANK,
    PROFESSIONS,
    PROFESSION_ACTION_CHECK_BONUS,
    NPC_QUALITY_TIERS,
    SUPPORTING_CAST_ROLES,
    REACTION_DEGREES,
    CREATURE_CATEGORIES,
    DAMAGE_TYPES,
    DAMAGE_TYPE_LABELS,
    LEGACY_DAMAGE_TYPE_MAP,
};
