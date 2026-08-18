/**
 * @file system-id.js
 * @description One-time world migration: the `alternity-v2` flag namespace -> `alternity`.
 *
 * ## Why this is needed
 *
 * The system's id changed from `alternity-v2` to `alternity`, and a Foundry flag
 * namespace *is* a package id. Everything this system stores outside the schema lives
 * under one — `AlternityCharacterState`, a pending dodge, a chat card's payload, an
 * extra-action combatant's marker, a compendium item's provenance. Under the old id
 * they are all still sitting in the database under a key nothing reads any more.
 *
 * Worse than unread: `getFlag`/`setFlag` validate the scope against the installed
 * package list, so `actor.getFlag('alternity-v2', …)` now *throws* rather than
 * returning undefined. That is why everything below reaches into `document.flags`
 * directly instead of going through the flag API — the old namespace is no longer a
 * legal argument to it.
 *
 * ## What a Gamemaster still has to do by hand
 *
 * Foundry binds a world to its system in `worlds/<world>/world.json`, and no system can
 * rewrite that from inside — by the time this code runs, Foundry has already refused to
 * launch a world whose `system` does not match. So moving an existing world across is:
 *
 *   1. Install the renamed system (it appears as a *separate* entry; the old one stays).
 *   2. Edit `worlds/<world>/world.json` and change `"system": "alternity-v2"` to
 *      `"system": "alternity"`.
 *   3. Launch the world. This migration then runs and moves the flags.
 *
 * Step 3 is what this file is for. Without it the world launches with every hero's
 * abilities, skills and durability apparently blank, because the state flag is still
 * filed under the old name.
 */

import { game, Hooks } from '../module-info.js';

const OLD_NAMESPACE = 'alternity-v2';
const NAMESPACE = 'alternity';

const SETTING_KEY = 'systemIdMigration';
export const SYSTEM_ID_MIGRATION_VERSION = 1;

// ---------------------------------------------------------------------------
// The pure part
// ---------------------------------------------------------------------------

/**
 * Work out what moving one document's flags would take.
 *
 * Returns a flat update object, or null when there is nothing under the old
 * namespace. Kept pure so the merge rules are testable without a Foundry world.
 *
 * The new namespace wins on a key collision. That case only arises if someone ran
 * the renamed system against the world before migrating — in which case the newer
 * data is the one they have been playing with, and silently overwriting it with a
 * stale copy would be the worse failure.
 *
 * @param {object} document - Anything with a `flags` object.
 * @returns {{updates: object, keys: string[]}|null}
 */
export function planFlagMigration(document) {
    const flags = document?.flags;
    const legacy = flags?.[OLD_NAMESPACE];
    if (!legacy || typeof legacy !== 'object') return null;

    const keys = Object.keys(legacy);
    if (!keys.length) {
        // An empty leftover object is still worth deleting, so the world does not
        // keep a dead namespace forever, but there is nothing to merge.
        return { updates: { [`flags.-=${OLD_NAMESPACE}`]: null }, keys: [] };
    }

    const current = flags?.[NAMESPACE] ?? {};
    const merged = { ...legacy, ...current };

    return {
        updates: {
            [`flags.${NAMESPACE}`]: merged,
            // Foundry's `-=` prefix deletes the key rather than writing null into it.
            [`flags.-=${OLD_NAMESPACE}`]: null,
        },
        keys: keys.filter((key) => !(key in current)),
    };
}

// ---------------------------------------------------------------------------
// The Foundry part
// ---------------------------------------------------------------------------

/**
 * Move every world document's flags out of the old namespace.
 *
 * Actors and their embedded items, world items, scene tokens' unlinked actor data,
 * combatants, journal entries and chat messages — everywhere this system has ever
 * written a flag. Compendium packs are left alone for the same reason the damage-form
 * migration leaves them: they are often locked and may not be ours to rewrite. The
 * packs this system ships are rebuilt under the new namespace anyway.
 *
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false] - Report without writing.
 * @returns {Promise<{documents: number, notes: string[]}>}
 */
export async function applySystemIdMigration(options = {}) {
    const { dryRun = false } = options;
    const notes = [];
    let count = 0;

    /** Apply one document's plan, if it has one. */
    const move = async (document, label) => {
        const plan = planFlagMigration(document);
        if (!plan) return;
        count += 1;
        notes.push(`${label}: ${plan.keys.length ? plan.keys.join(', ') : 'empty namespace removed'}`);
        if (!dryRun) await document.update(plan.updates, { diff: false, recursive: false });
    };

    for (const actor of game.actors ?? []) {
        await move(actor, `Actor "${actor.name}"`);
        for (const item of actor.items ?? []) {
            await move(item, `Actor "${actor.name}" / item "${item.name}"`);
        }
    }

    for (const item of game.items ?? []) {
        await move(item, `Item "${item.name}"`);
    }

    for (const scene of game.scenes ?? []) {
        await move(scene, `Scene "${scene.name}"`);
        for (const token of scene.tokens ?? []) {
            // An unlinked token carries its own copy of the actor, flags and all.
            if (token.actorLink) continue;
            await move(token.actor, `Scene "${scene.name}" / token "${token.name}"`);
        }
    }

    for (const combat of game.combats ?? []) {
        for (const combatant of combat.combatants ?? []) {
            await move(combatant, `Combatant "${combatant.name}"`);
        }
    }

    for (const entry of game.journal ?? []) {
        await move(entry, `Journal "${entry.name}"`);
    }

    // Chat cards store everything their buttons need in a flag, so an old card whose
    // namespace moved keeps working rather than throwing when someone clicks it.
    for (const message of game.messages ?? []) {
        await move(message, `Chat message ${message.id}`);
    }

    const packs = (game.packs ?? []).filter?.((pack) => pack.metadata?.system === NAMESPACE) ?? [];
    if (packs.length) {
        notes.push(`Left ${packs.length} compendium pack(s) alone — the shipped packs are rebuilt under the new id.`);
    }

    return { documents: count, notes };
}

/**
 * Register the version setting and run the migration once, on ready.
 *
 * Gamemaster only: a player cannot rewrite world documents, and every client running
 * it would race the others.
 *
 * Note that the *setting* is namespaced too, so a migrated world starts with this at
 * its default of 0 — which is correct, because it has never run under the new id.
 */
export function initializeSystemIdMigration() {
    Hooks.once('ready', async () => {
        game.settings.register(NAMESPACE, SETTING_KEY, {
            name: 'System id migration version',
            scope: 'world',
            config: false,
            type: Number,
            default: 0,
        });

        if (!game.user?.isGM) return;

        const done = game.settings.get(NAMESPACE, SETTING_KEY);
        if (done >= SYSTEM_ID_MIGRATION_VERSION) return;

        try {
            const result = await applySystemIdMigration();
            if (result.documents) {
                console.log(`[Alternity] Moving ${result.documents} document(s) off the alternity-v2 flag namespace…`);
                result.notes.forEach((note) => console.log(`[Alternity]   ${note}`));
                ui.notifications?.info(game.i18n.format('ALTERNITY.Migration.SystemId', {
                    documents: result.documents,
                }));
            }
            await game.settings.set(NAMESPACE, SETTING_KEY, SYSTEM_ID_MIGRATION_VERSION);
        } catch (err) {
            // Deliberately not marked done: it should retry on the next load rather
            // than leaving half the world unreadable.
            console.error('[Alternity] System id migration failed:', err);
            ui.notifications?.error(game.i18n.localize('ALTERNITY.Migration.SystemIdFailed'));
        }
    });
}
