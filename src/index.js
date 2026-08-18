/**
 * @file index.js
 * @description Alternity system entry point.
 */

console.log('[Alternity] src/index.js loaded.');

// ── Document classes ────────────────────────────────────────────────────────
import { AlternityActor } from './documents/AlternityActor.js';
import { AlternityItem }  from './documents/AlternityItem.js';
import { AlternityCombatant } from './documents/AlternityCombatant.js';

// ── TypeDataModels ──────────────────────────────────────────────────────────
import {
    CharacterData,
    NpcData,
    VehicleData,
    WarshipData,
    SpaceshipData,
    RobotData,
    AIData,
    CreatureData,
    WeaponData,
    ArmorData,
    SkillData,
    EffectData,
    ComputerData,
    PerkFlawData,
    PersonalEquipmentData,
    CybertechData,
    ProgramData,
    FXData,
    MutationData,
    AchievementBenefitData,
    SpeciesData,
} from './data/index.js';

// ── Logic / hooks ───────────────────────────────────────────────────────────
import { initializeAlternityHooks } from '../module_hooks/alt-mechanics.js';
import { initializeDamageFormMigration } from './migrations/damage-forms.js';
import { initializeSystemIdMigration } from './migrations/system-id.js';

// ── Client sheet ────────────────────────────────────────────────────────────
import { registerAlternitySheet } from './client/alternity-sheet-module.js';


// ---------------------------------------------------------------------------
// Foundry lifecycle: init
// ---------------------------------------------------------------------------

Hooks.once('init', async () => {
    console.log('[Alternity] Initialising the Alternity system...');

    // ── 1. Document classes ─────────────────────────────────────────────────
    CONFIG.Actor.documentClass = AlternityActor;
    CONFIG.Item.documentClass  = AlternityItem;
    CONFIG.Combatant.documentClass = AlternityCombatant;
    console.log('[Alternity] Registered Combatant class:', CONFIG.Combatant.documentClass.name);

    // ── 2. TypeDataModels ───────────────────────────────────────────────────
    CONFIG.Actor.dataModels = CONFIG.Actor.dataModels ?? {};
    CONFIG.Actor.dataModels.character = CharacterData;
    CONFIG.Actor.dataModels.npc       = NpcData;
    CONFIG.Actor.dataModels.vehicle   = VehicleData;
    CONFIG.Actor.dataModels.warship   = WarshipData;
    CONFIG.Actor.dataModels.spaceship = SpaceshipData;
    CONFIG.Actor.dataModels.robot     = RobotData;
    CONFIG.Actor.dataModels.ai        = AIData;
    CONFIG.Actor.dataModels.creature  = CreatureData;

    CONFIG.Item.dataModels = CONFIG.Item.dataModels ?? {};
    CONFIG.Item.dataModels.weapon = WeaponData;
    CONFIG.Item.dataModels.armor  = ArmorData;
    CONFIG.Item.dataModels.skill  = SkillData;
    CONFIG.Item.dataModels.effect = EffectData;
    CONFIG.Item.dataModels.computer = ComputerData;
    CONFIG.Item.dataModels.perkFlaw = PerkFlawData;
    CONFIG.Item.dataModels.personalEquipment = PersonalEquipmentData;
    CONFIG.Item.dataModels.cybertech = CybertechData;
    CONFIG.Item.dataModels.program   = ProgramData;
    CONFIG.Item.dataModels.fx        = FXData;
    CONFIG.Item.dataModels.mutation  = MutationData;
    CONFIG.Item.dataModels.achievementBenefit = AchievementBenefitData;
    CONFIG.Item.dataModels.species = SpeciesData;

    // ── 3. Initiative formula ───────────────────────────────────────────────
    // The actual roll logic is in AlternityActor.rollInitiative.
    CONFIG.Combat.initiative = {
        formula:  '1d20',
        decimals: 2,
    };

    // ── 4. Token attribute bars ─────────────────────────────────────────────
    CONFIG.Actor.trackableAttributes = {
        // Bars point at the real damage tracks. These used to read `stamina` and
        // `vitality`, which were stun and wound under names the game doesn't use.
        character: {
            bar: ['durability.stun', 'durability.wound', 'durability.mortal', 'durability.fatigue'],
            value: ['woundLevel', 'system.initiativeModifier', 'lastResort.value'],
        },
        npc: {
            bar: ['durability.stun', 'durability.wound', 'durability.mortal', 'durability.fatigue'],
            value: ['woundLevel'],
        },
        // Three tracks, not four: Table P42 prints stun/wound/mortal and a vehicle has
        // no fatigue rating. These used to read `hullIntegrity`, `shields` and
        // `techPoints`, none of which were Alternity stats.
        vehicle: {
            bar: ['durability.stun', 'durability.wound', 'durability.mortal'],
            value: ['status', 'controlPenalty'],
        },
        warship: {
            bar: ['damage.stun', 'damage.wound', 'damage.mortal', 'damage.critical'],
            value: ['shipStatus'],
        },
        // A core-rules spaceship has no ship-wide damage track — every hit lands on
        // a named compartment — so the only bar offered is the derived hull-integrity
        // summary. The real tracks live on the sheet, one set per compartment.
        spaceship: {
            bar: ['hullIntegrity'],
            value: ['shipStatus', 'totalDurability', 'destroyedCompartments', 'maneuverRating'],
        },
        // Robot damage tracks are derived from CON rather than stored as value/max
        // pairs, so `durability.*` is rebuilt in prepareDerivedData purely so the
        // token bars have something to point at. The fatigue bar is only meaningful
        // on a biological or synthetic-tissue chassis; it reads 0/0 otherwise.
        robot: {
            bar: ['durability.stun', 'durability.wound', 'durability.mortal', 'durability.fatigue'],
            value: ['status', 'actionsPerRound', 'chassisFree', 'powerSurplus'],
        },
        // An AI's damage tracks belong to its Grid avatar and derive from that
        // shadow's Constitution, so `durability.*` is rebuilt in prepareDerivedData
        // purely so the token bars have something to point at. There is no fatigue
        // track — software does not tire.
        ai: {
            bar: ['durability.stun', 'durability.wound', 'durability.mortal'],
            value: ['status', 'actionsPerRound', 'gridMovementRate', 'gridSkillScore.ordinary'],
        },
        // A creature's damage is stored under `damage.*` and its maxima derive from
        // Constitution, so `durability.*` is rebuilt in prepareDerivedData to give the
        // token bars a value/max pair. Large creatures carry a flat multiplier on
        // every rating, which is why the maxima are not simply Constitution.
        creature: {
            bar: ['durability.stun', 'durability.wound', 'durability.mortal', 'durability.fatigue'],
            value: ['status', 'woundLevel', 'actionsPerRound', 'actionCheck.ordinary'],
        },
    };

    // ── 5. Hook listeners ───────────────────────────────────────────────────
    initializeAlternityHooks();

    // ── 5b. World migrations ────────────────────────────────────────────────
    // Each registers its own `ready` listener, and they fire in the order they are
    // registered here — which is why the flag namespace moves first. Everything the
    // other migrations read lives in a flag, and under the old namespace the flag
    // API refuses to look at it at all.
    initializeSystemIdMigration();
    // Needed because `migrateData` only fixes a document's in-memory copy: a stored
    // value that is no longer a legal `choices` entry makes every future save of that
    // document fail, so it has to be written back to the database once.
    initializeDamageFormMigration();

    // ── 6. Character sheet ──────────────────────────────────────────────────
    await registerAlternitySheet();

    console.log('[Alternity] System initialised.');
});

// ---------------------------------------------------------------------------
// Foundry lifecycle: ready
// ---------------------------------------------------------------------------

Hooks.once('ready', () => {
    console.log(`[Alternity] System ready — Foundry VTT v${game.version}`);
});

// ---------------------------------------------------------------------------
// Lifecycle hooks
// ---------------------------------------------------------------------------

/**
 * A `species` Item is the only Item in this system whose numbers reach outside
 * itself: it sets the multiplier Constitution goes through on the way to the
 * durability tracks, the one Willpower goes through on the way to psionic energy,
 * and the range each ability score may be bought within. So dropping one, or
 * removing it, has to run the derivation again.
 *
 * Guarded on ownership because these hooks fire on every connected client, and a
 * player who cannot update the actor would only produce a permission error.
 */
async function syncSpecies(item, { created = false } = {}) {
    const actor = item?.parent;
    if (item?.type !== 'species' || !actor?.isOwner || actor.documentName !== 'Actor') return;
    try {
        // On a create, the new one wins — any species already on the actor is
        // removed first, and its own delete hook then finds this one still in place
        // and re-syncs to it rather than clearing.
        if (created) await actor.removeOtherSpecies(item.id);
        await actor.syncSpeciesFromItems();
    } catch (err) {
        console.error(`[Alternity] species sync failed for actor ${actor?.id}:`, err);
    }
}

Hooks.on('createItem', (item) => syncSpecies(item, { created: true }));
Hooks.on('deleteItem', (item) => syncSpecies(item));

// An edit to the species itself — a Gamemaster raising a homebrew species'
// durability multiplier — has to reach the heroes already carrying it.
Hooks.on('updateItem', (item, changes) => {
    if (item?.type !== 'species') return;
    if (!changes?.system && changes?.name === undefined) return;
    return syncSpecies(item);
});

Hooks.on('createActor', async (actor) => {
    if (!['character', 'npc'].includes(actor.type)) return;
    const { getAlternityState } = await import('./data/alternity-actor-data.js');
    await getAlternityState(actor);
});

Hooks.on('updateActor', async (actor, changes) => {
    if (!['character', 'npc'].includes(actor.type)) return;

    // Any of the four damage tracks changing means the wound level may need
    // recomputing. This used to watch `system.stamina` / `system.vitality`.
    const touchesHealth = changes.system?.durability !== undefined;
    if (!touchesHealth) return;

    try {
        const { getAlternityState, saveAlternityState } = await import('./data/alternity-actor-data.js');
        const state = await getAlternityState(actor);
        if (!state) return;

        // Write straight onto state.durability. The previous version assigned to
        // `state.resources.stamina` / `.vitality` — but AlternityCharacterState
        // has no `resources` property at all, so this threw a TypeError on every
        // health edit and was swallowed by the catch below. Editing a token bar
        // has never actually propagated back into the durability state.
        const tracks = ['stun', 'wound', 'mortal', 'fatigue'];
        for (const track of tracks) {
            const next = changes.system.durability?.[track]?.value;
            if (next !== undefined) state.durability[track] = next;
        }

        state._recalculateWoundLevel();
        await saveAlternityState(actor, state);

        if (state.woundLevel !== actor.system.woundLevel) {
            await actor.update({ 'system.woundLevel': state.woundLevel });
        }
    } catch (err) {
        console.error('[Alternity] updateActor wound sync failed:', err);
    }
});
