/**
 * @file damage-forms.js
 * @description One-time world migration: d20-flavoured damage types -> LI/HI/En.
 *
 * ## Why a world migration is required, and `migrateData` was not enough
 *
 * `WeaponData.migrateData` rewrites the *in-memory* copy of a document every time
 * it loads. It does not touch what is stored. So after the damage forms changed,
 * an existing weapon looked correct on the sheet while its `_source.damageType`
 * was still `"Impact"` — and `StringField({choices})` is a hard gate:
 *
 *   DataModelValidationError: AlternityItem [...] validation errors:
 *     system: SchemaField#_updateDiff
 *       damageType: Impact is not a valid choice
 *
 * That is a deadlock. The stored value is illegal, so every save of the item is
 * rejected; and because no save succeeds, the stored value stays illegal. The
 * damage type could not be changed at all — including to a valid one.
 *
 * The only way out is to write the corrected values back to the database once,
 * which is what this does.
 *
 * ## Scope
 *
 * World items, and items embedded on every actor. Compendium packs are
 * deliberately left alone: they are often locked, may belong to another module,
 * and a pack a Gamemaster never opens costs nothing to leave — whereas unlocking
 * and rewriting someone else's pack without asking is not this migration's call.
 * What was skipped is logged so it is not a silent omission.
 */

import { DAMAGE_TYPES, LEGACY_DAMAGE_TYPE_MAP } from '../services/alternity-math.js';
import { game, Hooks } from '../module-info.js';

const NAMESPACE = 'alternity-v2';

/** Bumped only when this migration's behaviour changes. */
export const DAMAGE_FORM_MIGRATION_VERSION = 1;

const SETTING_KEY = 'damageFormMigration';

// ---------------------------------------------------------------------------
// The pure part
// ---------------------------------------------------------------------------

/**
 * Convert one legacy damage type, or return null if there is nothing to convert.
 *
 * @param {*} value
 * @returns {string|null} The replacement form, or null when `value` is already
 *          valid, empty, or not a string at all.
 */
export function convertDamageForm(value) {
    if (typeof value !== 'string' || !value) return null;
    if (DAMAGE_TYPES.includes(value)) return null;
    return LEGACY_DAMAGE_TYPE_MAP[value] ?? 'LI';
}

/**
 * Work out what needs changing on one item, reading its *stored* source rather
 * than the migrated in-memory copy — the stored value is the whole problem.
 *
 * Returns a flat update object, or null when the item is already correct. Kept
 * pure and separate from the database walk so the decisions are testable without
 * a Foundry world.
 *
 * @param {object} item - Anything with `{ type, _source?: {system}, system }`.
 * @returns {{updates: object, notes: string[]}|null}
 */
export function planItemMigration(item) {
    // `_source` is what is actually stored; `system` has already been through
    // migrateData and so looks fine even when the stored data does not.
    const source = item?._source?.system ?? item?.system;
    if (!source) return null;

    const updates = {};
    const notes = [];

    if (item.type === 'weapon') {
        const converted = convertDamageForm(source.damageType);
        if (converted) {
            updates['system.damageType'] = converted;
            notes.push(`damageType ${source.damageType} -> ${converted}`);
        }
    }

    if (item.type === 'armor' && Array.isArray(source.resistedTypes)) {
        const mapped = [...new Set(
            source.resistedTypes
                .map((type) => (DAMAGE_TYPES.includes(type) ? type : LEGACY_DAMAGE_TYPE_MAP[type] ?? null))
                .filter(Boolean)
        )];
        const changed = mapped.length !== source.resistedTypes.length
            || mapped.some((type, i) => type !== source.resistedTypes[i]);
        if (changed) {
            updates['system.resistedTypes'] = mapped;
            notes.push(`resistedTypes [${source.resistedTypes.join(', ')}] -> [${mapped.join(', ')}]`);
        }
    }

    if (item.type === 'effect' && Array.isArray(source.effects)) {
        // An ArrayField is replaced wholesale rather than merged, so the entire
        // array has to be rewritten even to change one entry.
        let touched = false;
        const effects = source.effects.map((entry) => {
            const converted = convertDamageForm(entry?.damageType);
            if (!converted) return entry;
            touched = true;
            notes.push(`effect damageType ${entry.damageType} -> ${converted}`);
            return { ...entry, damageType: converted };
        });
        if (touched) updates['system.effects'] = effects;
    }

    return Object.keys(updates).length ? { updates, notes } : null;
}

// ---------------------------------------------------------------------------
// The Foundry part
// ---------------------------------------------------------------------------

/**
 * Walk the world's items and every actor's embedded items, writing corrected
 * damage forms back to the database.
 *
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false] - Report without writing.
 * @returns {Promise<{items: number, actors: number, notes: string[]}>}
 */
export async function applyDamageFormMigration(options = {}) {
    const { dryRun = false } = options;
    const notes = [];
    let itemCount = 0;
    let actorCount = 0;

    // ── World items ─────────────────────────────────────────────────────────
    for (const item of game.items ?? []) {
        const plan = planItemMigration(item);
        if (!plan) continue;
        notes.push(`Item "${item.name}": ${plan.notes.join('; ')}`);
        itemCount += 1;
        // `diff: false` because the in-memory value already equals the target (it
        // was migrated on load), so a diffing update would decide there is nothing
        // to write and leave the bad value in the database.
        if (!dryRun) await item.update(plan.updates, { diff: false });
    }

    // ── Embedded items ──────────────────────────────────────────────────────
    for (const actor of game.actors ?? []) {
        const embedded = [];
        for (const item of actor.items ?? []) {
            const plan = planItemMigration(item);
            if (!plan) continue;
            notes.push(`${actor.name} / "${item.name}": ${plan.notes.join('; ')}`);
            embedded.push({ _id: item.id, ...plan.updates });
        }
        if (!embedded.length) continue;
        actorCount += 1;
        itemCount += embedded.length;
        if (!dryRun) {
            await actor.updateEmbeddedDocuments('Item', embedded, { diff: false });
        }
    }

    const packCount = (game.packs ?? []).filter?.((p) => p.documentName === 'Item').length ?? 0;
    if (packCount) {
        notes.push(
            `Skipped ${packCount} item compendium(s) — unlock and re-import if you use `
            + `weapons from them.`
        );
    }

    return { items: itemCount, actors: actorCount, notes };
}

/**
 * Register the version setting and run the migration once, on ready.
 *
 * Gamemaster only: a player has no permission to rewrite world items, and every
 * client running it would race the others.
 */
export function initializeDamageFormMigration() {
    Hooks.once('ready', async () => {
        game.settings.register(NAMESPACE, SETTING_KEY, {
            name: 'Damage form migration version',
            scope: 'world',
            config: false,
            type: Number,
            default: 0,
        });

        if (!game.user?.isGM) return;

        const done = game.settings.get(NAMESPACE, SETTING_KEY);
        if (done >= DAMAGE_FORM_MIGRATION_VERSION) return;

        console.log('[Alternity] Migrating damage types to LI/HI/En…');
        try {
            const result = await applyDamageFormMigration();
            result.notes.forEach((note) => console.log(`[Alternity]   ${note}`));
            await game.settings.set(NAMESPACE, SETTING_KEY, DAMAGE_FORM_MIGRATION_VERSION);

            if (result.items) {
                ui.notifications?.info(game.i18n.format('ALTERNITY.Migration.DamageForms', {
                    items: result.items,
                }));
            }
            console.log(`[Alternity] Damage form migration complete (${result.items} item(s)).`);
        } catch (err) {
            // Deliberately not marking the migration done: it should retry next load
            // rather than leaving half the world on the old forms.
            console.error('[Alternity] Damage form migration failed:', err);
            ui.notifications?.error(game.i18n.localize('ALTERNITY.Migration.DamageFormsFailed'));
        }
    });
}
