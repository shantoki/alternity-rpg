/**
 * @file tests/test-system-id-migration.test.js
 * @description The flag-namespace move behind the `alternity-v2` -> `alternity` rename.
 *
 * A Foundry flag namespace is a package id, so renaming the system orphaned every flag
 * this system has ever written — and the flag API will not even read the old namespace
 * back, because it validates the scope against the installed packages. The planning
 * half is pure, which is what these tests exercise; the database walk around it needs a
 * live world.
 */

import { planFlagMigration } from '../src/migrations/system-id.js';

describe('planFlagMigration', () => {

    test('leaves a document with no legacy flags alone', () => {
        expect(planFlagMigration({ flags: {} })).toBeNull();
        expect(planFlagMigration({ flags: { alternity: { characterState: {} } } })).toBeNull();
        expect(planFlagMigration({})).toBeNull();
        expect(planFlagMigration(null)).toBeNull();
    });

    test('moves the whole namespace across and deletes the old one', () => {
        const plan = planFlagMigration({
            flags: { 'alternity-v2': { characterState: { actorId: 'x' }, pendingDodge: { steps: -2 } } },
        });
        expect(plan.updates['flags.alternity']).toEqual({
            characterState: { actorId: 'x' },
            pendingDodge: { steps: -2 },
        });
        // Foundry's `-=` prefix deletes the key rather than writing null into it.
        expect(plan.updates['flags.-=alternity-v2']).toBeNull();
        expect(plan.keys.sort()).toEqual(['characterState', 'pendingDodge']);
    });

    test('merges alongside flags already under the new namespace', () => {
        const plan = planFlagMigration({
            flags: {
                'alternity-v2': { characterState: { actorId: 'old' }, provenance: { book: 'Core' } },
                alternity: { pendingDodge: { steps: -1 } },
            },
        });
        expect(plan.updates['flags.alternity']).toEqual({
            characterState: { actorId: 'old' },
            provenance: { book: 'Core' },
            pendingDodge: { steps: -1 },
        });
    });

    /**
     * Only reachable if the renamed system was run against the world before the world
     * was migrated. The newer copy is the one that has been played with, so a stale
     * copy must not silently overwrite it.
     */
    test('the new namespace wins a key collision', () => {
        const plan = planFlagMigration({
            flags: {
                'alternity-v2': { characterState: { actorId: 'stale' } },
                alternity: { characterState: { actorId: 'current' } },
            },
        });
        expect(plan.updates['flags.alternity'].characterState).toEqual({ actorId: 'current' });
        expect(plan.keys).toEqual([]);
    });

    test('still clears an empty leftover namespace', () => {
        const plan = planFlagMigration({ flags: { 'alternity-v2': {} } });
        expect(plan.updates).toEqual({ 'flags.-=alternity-v2': null });
        expect(plan.keys).toEqual([]);
    });

    test('ignores a legacy flag key that is not an object', () => {
        expect(planFlagMigration({ flags: { 'alternity-v2': 'nonsense' } })).toBeNull();
    });
});
