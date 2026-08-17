/**
 * @fileoverview Tests the one-time world migration that rewrites d20-flavoured
 * damage types onto LI/HI/En.
 *
 * Why this migration has to exist at all is the point worth remembering:
 * `migrateData` fixes only a document's *in-memory* copy. The stored `_source`
 * keeps the old value, and `StringField({choices})` is a hard gate — so a weapon
 * stored as `"Impact"` had every future save rejected:
 *
 *   DataModelValidationError: damageType: Impact is not a valid choice
 *
 * which is a deadlock, because the stored value can only be corrected *by* a save.
 * These tests pin the decisions the migration makes; they read `_source`
 * deliberately, since that is the copy that is broken.
 */

import {
    convertDamageForm,
    planItemMigration,
    applyDamageFormMigration,
    DAMAGE_FORM_MIGRATION_VERSION,
} from '../src/migrations/damage-forms.js';

/**
 * An item whose stored source disagrees with its migrated in-memory view — the
 * exact state a world is in after the schema changed but before this runs.
 */
function makeItem(type, storedSystem, migratedSystem = null) {
    return {
        id: `item-${type}-${Math.abs(JSON.stringify(storedSystem).length)}`,
        name: `Test ${type}`,
        type,
        _source: { system: storedSystem },
        system: migratedSystem ?? storedSystem,
        updates: [],
        async update(changes) { this.updates.push(changes); return this; },
    };
}

describe('convertDamageForm', () => {
    it('should convert a retired name to a real form', () => {
        expect(convertDamageForm('Impact')).toBe('LI');
        expect(convertDamageForm('Slashing')).toBe('LI');
        expect(convertDamageForm('Laser')).toBe('En');
        expect(convertDamageForm('Energy')).toBe('En');
    });

    it('should leave a valid form alone by reporting nothing to do', () => {
        expect(convertDamageForm('LI')).toBeNull();
        expect(convertDamageForm('HI')).toBeNull();
        expect(convertDamageForm('En')).toBeNull();
    });

    it('should report nothing to do for an empty or non-string value', () => {
        expect(convertDamageForm('')).toBeNull();
        expect(convertDamageForm(null)).toBeNull();
        expect(convertDamageForm(undefined)).toBeNull();
        expect(convertDamageForm(7)).toBeNull();
    });

    it('should fall back to the weakest form for a name it has never seen', () => {
        expect(convertDamageForm('Sonic')).toBe('LI');
    });
});

describe('planItemMigration', () => {
    it('should read the stored source, not the already-migrated view', () => {
        // This is the crux: `system` looks fine because migrateData ran on load.
        // Planning from it would find nothing to do and leave the world broken.
        const weapon = makeItem('weapon', { damageType: 'Impact' }, { damageType: 'LI' });
        expect(planItemMigration(weapon).updates).toEqual({ 'system.damageType': 'LI' });
    });

    it('should return null for a weapon that is already correct', () => {
        expect(planItemMigration(makeItem('weapon', { damageType: 'HI' }))).toBeNull();
    });

    it('should convert a flat resistance into a per-form protection rating', () => {
        // The legacy names are mapped on the way through, deduped, and only the forms
        // the armour actually resisted get the value.
        const armor = makeItem('armor', {
            damageResistance: 4,
            resistedTypes: ['Ballistic', 'Slashing', 'Laser'],
        });
        expect(planItemMigration(armor).updates).toEqual({
            'system.protection': { li: '4', hi: '', en: '4' },
        });
    });

    it('should read an empty resisted-types list as "resists everything"', () => {
        // Empty meant "resists every type", not "resists none" — the only reading
        // under which the old field did anything for most armour.
        const armor = makeItem('armor', { damageResistance: 3, resistedTypes: [] });
        expect(planItemMigration(armor).updates['system.protection'])
            .toEqual({ li: '3', hi: '3', en: '3' });
    });

    it('should not touch armour whose protection is already entered', () => {
        // A hand-entered die range is the better data and must survive the migration.
        const armor = makeItem('armor', {
            damageResistance: 4,
            protection: { li: 'd6-1', hi: '', en: '' },
        });
        expect(planItemMigration(armor)).toBeNull();
    });

    it('should carry an armour-class bonus across as a resistance-modifier bonus', () => {
        // Capped at the range field gear actually uses; armour itself should be 0.
        expect(planItemMigration(makeItem('armor', { armorBonus: 9 })).updates)
            .toEqual({ 'system.resistanceModifierBonus': 5 });
        expect(planItemMigration(makeItem('armor', { armorBonus: 2 })).updates)
            .toEqual({ 'system.resistanceModifierBonus': 2 });
    });

    it('should return null for armour with nothing to convert', () => {
        expect(planItemMigration(makeItem('armor', { damageResistance: 0 }))).toBeNull();
    });

    it('should rewrite a whole effects array to change one entry', () => {
        // An ArrayField is replaced rather than merged, so a partial write would
        // discard every other entry.
        const effect = makeItem('effect', {
            effects: [
                { effectType: 'Damage', damageType: 'Radiation', value: 2 },
                { effectType: 'Buff', damageType: null, value: 1 },
            ],
        });
        const plan = planItemMigration(effect);
        expect(plan.updates['system.effects']).toEqual([
            { effectType: 'Damage', damageType: 'En', value: 2 },
            { effectType: 'Buff', damageType: null, value: 1 },
        ]);
    });

    it('should ignore item types that carry no damage form', () => {
        expect(planItemMigration(makeItem('computer', { activeMemory: 4 }))).toBeNull();
        expect(planItemMigration(makeItem('perkFlaw', { cost: 2 }))).toBeNull();
    });

    it('should survive an item with no system data at all', () => {
        expect(planItemMigration({ type: 'weapon' })).toBeNull();
        expect(planItemMigration(null)).toBeNull();
    });

    it('should describe what it changed, for the console log', () => {
        const plan = planItemMigration(makeItem('weapon', { damageType: 'Piercing' }));
        expect(plan.notes.join(' ')).toContain('Piercing');
        expect(plan.notes.join(' ')).toContain('LI');
    });
});

describe('applyDamageFormMigration', () => {
    let worldItems;
    let actors;

    beforeEach(() => {
        worldItems = [];
        actors = [];
        globalThis.game = {
            get items() { return worldItems; },
            get actors() { return actors; },
            packs: [],
        };
    });

    it('should write corrected values to world items', async () => {
        const weapon = makeItem('weapon', { damageType: 'Impact' }, { damageType: 'LI' });
        worldItems = [weapon];

        const result = await applyDamageFormMigration();

        expect(result.items).toBe(1);
        // `diff: false` matters: the in-memory value already equals the target, so a
        // diffing update would decide nothing changed and leave the database broken.
        expect(weapon.updates[0]).toEqual({ 'system.damageType': 'LI' });
    });

    it('should write embedded items through the actor, in one call per actor', async () => {
        const embedded = [
            makeItem('weapon', { damageType: 'Slashing' }, { damageType: 'LI' }),
            makeItem('weapon', { damageType: 'Laser' }, { damageType: 'En' }),
            makeItem('weapon', { damageType: 'HI' }),
        ];
        const calls = [];
        actors = [{
            name: 'Kel',
            items: embedded,
            async updateEmbeddedDocuments(type, updates) { calls.push({ type, updates }); },
        }];

        const result = await applyDamageFormMigration();

        expect(result.actors).toBe(1);
        expect(result.items).toBe(2);
        expect(calls).toHaveLength(1);
        expect(calls[0].updates).toEqual([
            { _id: embedded[0].id, 'system.damageType': 'LI' },
            { _id: embedded[1].id, 'system.damageType': 'En' },
        ]);
    });

    it('should not touch an actor whose items are all correct', async () => {
        const calls = [];
        actors = [{
            name: 'Fine',
            items: [makeItem('weapon', { damageType: 'LI' })],
            async updateEmbeddedDocuments(...args) { calls.push(args); },
        }];

        const result = await applyDamageFormMigration();

        expect(result.actors).toBe(0);
        expect(calls).toHaveLength(0);
    });

    it('should report without writing on a dry run', async () => {
        const weapon = makeItem('weapon', { damageType: 'Toxic' }, { damageType: 'LI' });
        worldItems = [weapon];

        const result = await applyDamageFormMigration({ dryRun: true });

        expect(result.items).toBe(1);
        expect(weapon.updates).toHaveLength(0);
    });

    it('should say that compendium packs were skipped rather than skipping them silently', async () => {
        globalThis.game.packs = [
            { documentName: 'Item', metadata: { label: 'Weapons' } },
            { documentName: 'Actor', metadata: { label: 'NPCs' } },
        ];

        const result = await applyDamageFormMigration();

        expect(result.notes.join(' ')).toMatch(/Skipped 1 item compendium/);
    });

    it('should cope with an empty world', async () => {
        await expect(applyDamageFormMigration()).resolves.toMatchObject({ items: 0, actors: 0 });
    });

    it('should have a version to record, so it runs once', () => {
        expect(DAMAGE_FORM_MIGRATION_VERSION).toBeGreaterThan(0);
    });
});
