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
    WeaponData,
    ArmorData,
    SkillData,
    EffectData,
    ComputerData,
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

    CONFIG.Item.dataModels = CONFIG.Item.dataModels ?? {};
    CONFIG.Item.dataModels.weapon = WeaponData;
    CONFIG.Item.dataModels.armor  = ArmorData;
    CONFIG.Item.dataModels.skill  = SkillData;
    CONFIG.Item.dataModels.effect = EffectData;
    CONFIG.Item.dataModels.computer = ComputerData;

    // ── 3. Initiative formula ───────────────────────────────────────────────
    // The actual roll logic is in AlternityActor.rollInitiative.
    CONFIG.Combat.initiative = {
        formula:  '1d20',
        decimals: 2,
    };

    // ── 4. Token attribute bars ─────────────────────────────────────────────
    CONFIG.Actor.trackableAttributes = {
        character: {
            bar: ['stamina', 'vitality'],
            value: ['woundLevel', 'system.initiativeModifier'],
        },
        npc: {
            bar: ['stamina', 'vitality'],
            value: ['woundLevel'],
        },
        vehicle: {
            bar: ['hullIntegrity', 'shields', 'techPoints'],
            value: [],
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

    const touchesHealth = (
        changes.system?.stamina  !== undefined ||
        changes.system?.vitality !== undefined
    );
    if (!touchesHealth) return;

    try {
        const { getAlternityState, saveAlternityState } = await import('./data/alternity-actor-data.js');
        const state = await getAlternityState(actor);
        if (!state) return;

        if (changes.system?.stamina?.value !== undefined) {
            state.resources.stamina = changes.system.stamina.value;
        }
        if (changes.system?.vitality?.value !== undefined) {
            state.resources.vitality = changes.system.vitality.value;
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
