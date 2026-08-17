/**
 * @fileoverview Tests the sheet drag-and-drop pipeline.
 *
 * The DOM half (`bindActorSheetDragDrop`) needs a browser and is exercised in
 * Foundry, but everything it delegates to is a plain function taking plain data,
 * and that is where the decisions live: what a payload means, which items a folder
 * drop stands for, what gets stripped before an item is embedded, and where the
 * copy lands in the list. Those are pinned here.
 *
 * `foundry.utils.fromUuid` / `performIntegerSort` are installed per test rather
 * than at import time, mirroring how `module-info.js` resolves globals when they
 * are used rather than when the module loads.
 */

import {
    claimDropHandling,
    parseDropData,
    isSupportedDrop,
    resolveDroppedItems,
    toEmbeddedItemData,
    createDroppedItems,
    sortItemWithin,
    itemIdFromRow,
    markDraggableRows,
    tabForItemType,
} from '../src/client/alternity-drag-drop.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A document good enough for the drop pipeline: a uuid, a type, and toObject. */
function makeItem(id, type = 'weapon', extra = {}) {
    return {
        documentName: 'Item',
        id,
        uuid: `Item.${id}`,
        name: `Item ${id}`,
        type,
        sort: 0,
        ...extra,
        toObject() {
            return {
                _id: id,
                name: this.name,
                type: this.type,
                folder: 'some-folder',
                ownership: { default: 0 },
                system: { damageOrdinary: 'd4w' },
            };
        },
    };
}

/**
 * A folder whose `contents` are index entries rather than documents — the shape a
 * compendium folder answers with, and the reason the resolver goes through uuids.
 */
function makeFolder(id, entryUuids, children = []) {
    return {
        documentName: 'Folder',
        id,
        uuid: `Folder.${id}`,
        type: 'Item',
        contents: entryUuids.map(uuid => ({ uuid })),
        children,
    };
}

/** An actor whose `items` is an array carrying the Collection `get` the code uses. */
function makeActor(items = [], { isOwner = true } = {}) {
    const collection = items.slice();
    collection.get = (id) => collection.find(i => i.id === id) ?? undefined;
    return {
        id: 'actor-1',
        name: 'Tam',
        isOwner,
        items: collection,
        created: [],
        updated: [],
        async createEmbeddedDocuments(_type, payload) {
            this.created.push(payload);
            return payload.map((data, i) => ({ ...data, id: `new-${i}` }));
        },
        async updateEmbeddedDocuments(_type, updates) {
            this.updated.push(updates);
            return updates;
        },
    };
}

/** Register documents so `fromUuid` can answer for them. */
function installUuidRegistry(docs) {
    const byUuid = new Map(docs.map(d => [d.uuid, d]));
    globalThis.foundry.utils.fromUuid = async (uuid) => byUuid.get(uuid) ?? null;
    return byUuid;
}

function dropEvent(payload) {
    return {
        dataTransfer: {
            getData: () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
        },
    };
}

beforeEach(() => {
    globalThis.foundry.utils.fromUuid = async () => null;
    globalThis.foundry.utils.performIntegerSort = () => [];
});

// ---------------------------------------------------------------------------
// parseDropData
// ---------------------------------------------------------------------------

describe('parseDropData', () => {
    test('reads Foundry\'s JSON payload off the event', () => {
        const data = parseDropData(dropEvent({ type: 'Item', uuid: 'Item.abc' }));
        expect(data).toEqual({ type: 'Item', uuid: 'Item.abc' });
    });

    test('returns null for anything that is not a JSON object', () => {
        // A drag from outside Foundry — a file, a link, a text selection — is a
        // normal thing to receive, so none of these may throw.
        expect(parseDropData(dropEvent(''))).toBeNull();
        expect(parseDropData(dropEvent('not json'))).toBeNull();
        expect(parseDropData(dropEvent('[1,2]'))).toBeNull();
        expect(parseDropData(dropEvent('"a string"'))).toBeNull();
        expect(parseDropData({})).toBeNull();
        expect(parseDropData(undefined)).toBeNull();
    });

    test('returns null when getData throws outside a drag context', () => {
        expect(parseDropData({ dataTransfer: { getData() { throw new Error('nope'); } } })).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// isSupportedDrop
// ---------------------------------------------------------------------------

describe('isSupportedDrop', () => {
    test('accepts items and folders of items', () => {
        expect(isSupportedDrop({ type: 'Item', uuid: 'Item.a' })).toBe(true);
        expect(isSupportedDrop({ type: 'Folder', uuid: 'Folder.a', documentName: 'Item' })).toBe(true);
        // Not every Foundry version puts `documentName` on a folder payload, so an
        // unlabelled folder is accepted here and discarded once resolved.
        expect(isSupportedDrop({ type: 'Folder', uuid: 'Folder.a' })).toBe(true);
    });

    test('rejects other documents, and anything without a uuid', () => {
        expect(isSupportedDrop({ type: 'Actor', uuid: 'Actor.a' })).toBe(false);
        expect(isSupportedDrop({ type: 'Macro', uuid: 'Macro.a' })).toBe(false);
        expect(isSupportedDrop({ type: 'Folder', uuid: 'Folder.a', documentName: 'Actor' })).toBe(false);
        expect(isSupportedDrop({ type: 'Item' })).toBe(false);
        expect(isSupportedDrop(null)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// resolveDroppedItems
// ---------------------------------------------------------------------------

describe('resolveDroppedItems', () => {
    test('resolves a single item by uuid', async () => {
        const item = makeItem('a');
        installUuidRegistry([item]);
        await expect(resolveDroppedItems({ type: 'Item', uuid: 'Item.a' })).resolves.toEqual([item]);
    });

    test('resolves to nothing when the uuid is dead or points elsewhere', async () => {
        installUuidRegistry([{ documentName: 'Actor', uuid: 'Actor.a' }]);
        await expect(resolveDroppedItems({ type: 'Item', uuid: 'Item.gone' })).resolves.toEqual([]);
        await expect(resolveDroppedItems({ type: 'Item', uuid: 'Actor.a' })).resolves.toEqual([]);
    });

    test('resolves a folder to its contents, subfolders included', async () => {
        const a = makeItem('a');
        const b = makeItem('b', 'armor');
        const c = makeItem('c', 'perkFlaw');
        const sub = makeFolder('sub', ['Item.c']);
        // v11+ hands children over as `{folder, children}` wrappers.
        const root = makeFolder('root', ['Item.a', 'Item.b'], [{ folder: sub, children: [] }]);
        installUuidRegistry([a, b, c, sub, root]);

        const items = await resolveDroppedItems({ type: 'Folder', uuid: 'Folder.root', documentName: 'Item' });
        expect(items).toEqual([a, b, c]);
    });

    test('accepts a bare Folder document as a child, as older versions stored it', async () => {
        const c = makeItem('c');
        const sub = makeFolder('sub', ['Item.c']);
        const root = makeFolder('root', [], [sub]);
        installUuidRegistry([c, sub, root]);
        await expect(resolveDroppedItems({ type: 'Folder', uuid: 'Folder.root' })).resolves.toEqual([c]);
    });

    test('ignores a folder that holds something other than items', async () => {
        const folder = { ...makeFolder('actors', []), type: 'Actor' };
        installUuidRegistry([folder]);
        await expect(resolveDroppedItems({ type: 'Folder', uuid: 'Folder.actors' })).resolves.toEqual([]);
    });

    test('terminates on a cyclic folder tree', async () => {
        const item = makeItem('a');
        const root = makeFolder('root', ['Item.a']);
        root.children = [{ folder: root, children: [] }];
        installUuidRegistry([item, root]);
        await expect(resolveDroppedItems({ type: 'Folder', uuid: 'Folder.root' })).resolves.toEqual([item]);
    });

    test('skips resolution entirely for an unsupported payload', async () => {
        let called = false;
        globalThis.foundry.utils.fromUuid = async () => { called = true; return null; };
        await expect(resolveDroppedItems({ type: 'Macro', uuid: 'Macro.a' })).resolves.toEqual([]);
        expect(called).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// toEmbeddedItemData
// ---------------------------------------------------------------------------

describe('toEmbeddedItemData', () => {
    test('drops the fields that belong to where the item came from', () => {
        const data = toEmbeddedItemData(makeItem('a'));
        expect(data._id).toBeUndefined();
        expect(data.folder).toBeUndefined();
        expect(data.ownership).toBeUndefined();
        expect(data).toMatchObject({ name: 'Item a', type: 'weapon', system: { damageOrdinary: 'd4w' } });
    });

    test('handles a plain object with no toObject', () => {
        expect(toEmbeddedItemData({ _id: 'x', name: 'Raw', type: 'armor' }))
            .toEqual({ name: 'Raw', type: 'armor' });
    });
});

// ---------------------------------------------------------------------------
// createDroppedItems
// ---------------------------------------------------------------------------

describe('createDroppedItems', () => {
    test('appends each copy below the items of its own type', async () => {
        const actor = makeActor([
            { id: 'w1', type: 'weapon', sort: 200000 },
            { id: 'a1', type: 'armor',  sort: 900000 },
        ]);
        await createDroppedItems(actor, [makeItem('new-w', 'weapon'), makeItem('new-a', 'armor')]);

        const [payload] = actor.created;
        expect(payload).toHaveLength(2);
        expect(payload[0].sort).toBe(300000);
        expect(payload[1].sort).toBe(1000000);
    });

    test('spaces out several copies of the same type', async () => {
        const actor = makeActor([{ id: 'w1', type: 'weapon', sort: 0 }]);
        await createDroppedItems(actor, [
            makeItem('x', 'weapon'), makeItem('y', 'weapon'), makeItem('z', 'weapon'),
        ]);
        expect(actor.created[0].map(p => p.sort)).toEqual([100000, 200000, 300000]);
    });

    test('starts from zero when the actor owns nothing of that type', async () => {
        const actor = makeActor([{ id: 'a1', type: 'armor', sort: 5000000 }]);
        await createDroppedItems(actor, [makeItem('w', 'weapon')]);
        expect(actor.created[0][0].sort).toBe(100000);
    });

    test('creates in one call, and does nothing when handed no items', async () => {
        const actor = makeActor();
        await expect(createDroppedItems(actor, [])).resolves.toEqual([]);
        await expect(createDroppedItems(null, [makeItem('a')])).resolves.toEqual([]);
        expect(actor.created).toHaveLength(0);

        await createDroppedItems(actor, [makeItem('a'), makeItem('b')]);
        expect(actor.created).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// sortItemWithin
// ---------------------------------------------------------------------------

describe('sortItemWithin', () => {
    test('re-orders an item against a sibling of the same type', async () => {
        const actor = makeActor([
            { id: 'w1', type: 'weapon', sort: 100000 },
            { id: 'w2', type: 'weapon', sort: 200000 },
            { id: 'w3', type: 'weapon', sort: 300000 },
        ]);
        let seen = null;
        globalThis.foundry.utils.performIntegerSort = (source, options) => {
            seen = { source, options };
            return [{ target: source, update: { sort: 250000 } }];
        };

        await expect(sortItemWithin(actor, 'w1', 'w3')).resolves.toBe(true);
        expect(actor.updated[0]).toEqual([{ _id: 'w1', sort: 250000 }]);
        // The dragged item must not be handed to the solver as its own sibling.
        expect(seen.options.siblings.map(s => s.id)).toEqual(['w2', 'w3']);
        expect(seen.options.target.id).toBe('w3');
    });

    test('refuses a cross-list drop, a self drop, and unknown ids', async () => {
        const actor = makeActor([
            { id: 'w1', type: 'weapon', sort: 0 },
            { id: 'm1', type: 'mutation', sort: 0 },
        ]);
        globalThis.foundry.utils.performIntegerSort = () => {
            throw new Error('should not be reached');
        };

        await expect(sortItemWithin(actor, 'w1', 'm1')).resolves.toBe(false);
        await expect(sortItemWithin(actor, 'w1', 'w1')).resolves.toBe(false);
        await expect(sortItemWithin(actor, 'w1', 'nope')).resolves.toBe(false);
        await expect(sortItemWithin(actor, 'nope', 'w1')).resolves.toBe(false);
        expect(actor.updated).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Row helpers
// ---------------------------------------------------------------------------

/** Minimal stand-in for a card element: a dataset and one queryable descendant. */
function makeRow(itemId, descendantId = null, images = 0) {
    const imgs = Array.from({ length: images }, () => ({ draggable: true }));
    return {
        dataset: itemId ? { itemId } : {},
        draggable: false,
        querySelector: (sel) => (descendantId && sel === '[data-item-id]'
            ? { dataset: { itemId: descendantId } }
            : null),
        querySelectorAll: (sel) => (sel === 'img' ? imgs : []),
        _imgs: imgs,
    };
}

describe('itemIdFromRow', () => {
    test('reads the id off the row', () => {
        expect(itemIdFromRow(makeRow('abc'))).toBe('abc');
    });

    test('falls back to a descendant, as the computer card needs', () => {
        // `.alt-computer-card` carries no id of its own — it sits on the card's
        // delete button — so a card-only lookup would make computers undraggable.
        expect(itemIdFromRow(makeRow(null, 'xyz'))).toBe('xyz');
    });

    test('is null when there is no id anywhere', () => {
        expect(itemIdFromRow(makeRow(null))).toBeNull();
        expect(itemIdFromRow(null)).toBeNull();
    });
});

describe('markDraggableRows', () => {
    test('makes rows draggable and their icons not', () => {
        const rows = [makeRow('a', null, 2), makeRow('b', null, 1)];
        markDraggableRows({ querySelectorAll: () => rows });
        expect(rows.every(r => r.draggable === true)).toBe(true);
        // Left draggable, the item icon starts an image drag instead of an item one.
        expect(rows.flatMap(r => r._imgs).every(i => i.draggable === false)).toBe(true);
    });

    test('tolerates a root that is not there yet', () => {
        expect(() => markDraggableRows(null)).not.toThrow();
    });
});

describe('claimDropHandling', () => {
    test('shuts off core\'s drop path on the prototype, not the instance', () => {
        // Core captures `this._canDragDrop` / `this._onDrop` once, when its lazy
        // `_dragDrop` getter first runs. An instance property assigned later would
        // arrive too late, so the shut-off has to live on the prototype.
        class CoreSheet {
            _canDragDrop() { return true; }
            async _onDrop() { return 'core created the item'; }
        }
        class AltSheet extends CoreSheet {}
        claimDropHandling(AltSheet);

        expect(Object.hasOwn(AltSheet.prototype, '_canDragDrop')).toBe(true);
        const sheet = new AltSheet();
        expect(sheet._canDragDrop('.draggable')).toBe(false);
        expect(sheet._onDrop({})).toBeNull();
        // The base class is left alone — this must not leak onto every ActorSheetV2.
        expect(new CoreSheet()._canDragDrop()).toBe(true);
    });

    test('is safe on a v12-shaped base class that has no such methods', () => {
        class Bare {}
        expect(() => claimDropHandling(Bare)).not.toThrow();
        expect(new Bare()._canDragDrop()).toBe(false);
        expect(() => claimDropHandling(undefined)).not.toThrow();
    });
});

describe('tabForItemType', () => {
    test('maps each displayed type to the tab that renders it', () => {
        expect(tabForItemType('weapon')).toBe('combat');
        expect(tabForItemType('program')).toBe('special');
        expect(tabForItemType('achievementBenefit')).toBe('character');
    });

    test('has no tab for types the sheet does not list', () => {
        // `skill` and `effect` items are read by AlternityItem, never displayed;
        // a drop of one must not switch to a tab that would not show it.
        expect(tabForItemType('skill')).toBeNull();
        expect(tabForItemType('effect')).toBeNull();
        expect(tabForItemType(undefined)).toBeNull();
    });
});
