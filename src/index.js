/**
 * @file index.js
 * @description Alternity Fastplay Core system entry point.
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
} from './data/index.js';

// ── Logic / hooks ───────────────────────────────────────────────────────────
import { initializeAlternityHooks } from '../module_hooks/alt-mechanics.js';

// ── Client sheet ────────────────────────────────────────────────────────────
import { registerAlternitySheet } from './client/alternity-sheet-module.js';


// ---------------------------------------------------------------------------
// Foundry lifecycle: init
// ---------------------------------------------------------------------------

Hooks.once('init', async () => {
    console.log('[Alternity] Initialising Alternity Fastplay Core system...');

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
        vehicle: {
            bar: ['hullIntegrity', 'shields', 'techPoints'],
            value: [],
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
    };

    // ── 5. Hook listeners ───────────────────────────────────────────────────
    initializeAlternityHooks();

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
