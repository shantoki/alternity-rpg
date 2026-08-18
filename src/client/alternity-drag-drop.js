/**
 * @file alternity-drag-drop.js
 * @description Drag-and-drop of Items onto — and within — Alternity actor sheets.
 *
 * ## Why this is hand-rolled
 *
 * Because the plumbing to lean on does not exist across the whole range this
 * system supports (`compatibility.minimum: "12"`). Foundry **v14**'s
 * `ActorSheetV2` does have it — a `_dragDrop` instance bound in `_onRender`,
 * with `_onDrop` → `_onDropItem`/`_onDropFolder`/`_onSortItem` and a
 * `_canDragDrop` permission gate — but that arrived after v12, and the
 * `DragDrop` class it is built on moved namespace on the way
 * (`globalThis.DragDrop` in v12, `foundry.applications.ux.DragDrop` in v13+).
 * Native HTML5 drag events behave identically on every supported version, so
 * that is what this uses.
 *
 * **This module and core's own drop path must never both be live**, or every drop
 * creates the item twice. None of this system's sheets call `super._onRender`, so
 * core's `_dragDrop.bind(this.element)` never runs today — but that is a fragile
 * thing to depend on, so {@link claimDropHandling} shuts core's path off at the
 * prototype, where the result does not depend on which `_onRender` ran first.
 *
 * ## The payload
 *
 * Every Foundry drag — sidebar, compendium, another actor's sheet — writes a
 * JSON payload to `dataTransfer` under `text/plain`, of the shape
 * `{ type: "Item", uuid: "Compendium.pack.Item.abc" }`. That is all
 * `TextEditor.getDragEventData` does, and reading it directly avoids a fourth
 * namespace that moved between v12 and v13.
 *
 * Note that `dataTransfer.getData` is deliberately blocked by the browser during
 * `dragover` — the payload is only readable on `drop`. That is why the hover
 * highlight cannot filter on what is being dragged and keys off
 * `dataTransfer.types` instead.
 *
 * ## What a drop means
 *
 * - An Item from anywhere else (compendium, sidebar, another actor) is **copied**
 *   onto this actor, appended to the bottom of its list.
 * - A Folder of Items copies the whole folder, subfolders included — the point of
 *   building a compendium is dragging a kit across in one go.
 * - An Item that already belongs to this actor is a **re-order**, not a second
 *   copy: it is sorted relative to whichever row it was dropped on.
 *
 * All three of those assume the sheet keeps its gear as embedded Items, which only
 * the hero sheet does. A sheet that stores its gear some other way passes a
 * `receive` handler and consumes the resolved Items itself — see
 * `alternity-statblock-drops.js`, which turns them into schema rows.
 */

import { fromUuid, game, performIntegerSort, ui } from '../module-info.js';
import { bindOnce } from './alternity-sheet-binding.js';

const NS = 'alt';

/** Added to the sheet root while a drag hovers it. */
export const DROP_HOVER_CLASS = `${NS}-drop-hover`;

/** Marks the row currently being dragged, so it can dim itself. */
export const DRAG_SOURCE_CLASS = `${NS}-drag-source`;

/**
 * The rows that can be picked up. `.alt-item-card` covers nine of the character
 * sheet's ten lists; computers render as a wider `.alt-computer-card` panel whose
 * item id sits on its delete button rather than on the card, which is why
 * {@link itemIdFromRow} looks at descendants too.
 */
export const DEFAULT_ROW_SELECTOR = `.${NS}-item-card, .${NS}-computer-card`;

/**
 * Fields inside a row that own their own drag behaviour — dragging a text
 * selection out of an input must not be mistaken for dragging the item.
 */
const FIELD_SELECTOR = 'input, textarea, select, [contenteditable="true"]';

/** Binding-group name for `bindOnce`, so these listeners attach exactly once. */
const BOUND_KEY = 'dragDrop';

/**
 * Gap left between the sort values of adjacent items, matching Foundry's own
 * `CONST.SORT_INTEGER_DENSITY`. Inlined rather than read off the global so this
 * module keeps to the one-import-per-global rule in CLAUDE.md.
 */
const SORT_DENSITY = 100000;

/**
 * Which tab of the character sheet renders each item type, so a drop can reveal
 * what it just added instead of silently filing it away behind another tab.
 * Types the sheet has no list for (`skill`, `effect` — both consumed by
 * AlternityItem rather than displayed) are absent, and simply don't switch tabs.
 */
export const ITEM_TYPE_TABS = Object.freeze({
    achievementBenefit: 'character',
    species:            'character',
    weapon:             'combat',
    armor:              'combat',
    perkFlaw:           'combat',
    personalEquipment:  'combat',
    fx:                 'special',
    mutation:           'special',
    cybertech:          'special',
    computer:           'special',
    program:            'special',
});

/** @returns {string|null} The tab that displays `type`, or null if none does. */
export function tabForItemType(type) {
    return ITEM_TYPE_TABS[type] ?? null;
}

/**
 * Read Foundry's drag payload off a drop event.
 *
 * @param {DragEvent} event
 * @returns {object|null} The parsed payload, or null if there wasn't one. A
 *   malformed payload is null rather than a throw: a drop from outside Foundry
 *   (a file, a link, a text selection) is a normal thing to receive.
 */
export function parseDropData(event) {
    let raw;
    try {
        raw = event?.dataTransfer?.getData('text/plain');
    } catch {
        // getData throws outside a drag context, and returns "" during dragover.
        return null;
    }
    if (!raw) return null;
    try {
        const data = JSON.parse(raw);
        return (data && typeof data === 'object' && !Array.isArray(data)) ? data : null;
    } catch {
        return null;
    }
}

/**
 * True when this payload is one this module knows how to consume. Checked before
 * `preventDefault`, because a payload we won't handle should keep whatever
 * behaviour the browser and Foundry already gave it.
 *
 * @param {object|null} data
 * @returns {boolean}
 */
export function isSupportedDrop(data) {
    if (!data?.uuid) return false;
    if (data.type === 'Item') return true;
    // A Folder payload does not always carry the type of its contents, so it is
    // accepted on spec and discarded later if the folder turns out to hold
    // something else.
    return data.type === 'Folder' && (data.documentName ?? 'Item') === 'Item';
}

/**
 * Walk a folder and every subfolder, resolving each entry to a real Item.
 *
 * Entries are resolved by uuid rather than used directly, because a folder in a
 * compendium answers `contents` with lightweight *index entries*, not documents.
 * Both shapes carry `uuid`, so going through `fromUuid` is the one path that
 * works for a world folder and a compendium folder alike.
 *
 * @param {Folder} folder
 * @param {Set<string>} seen - Guards against a cyclic folder tree.
 * @returns {Promise<Item[]>}
 */
async function collectFolderItems(folder, seen = new Set()) {
    if (!folder || seen.has(folder.id)) return [];
    seen.add(folder.id);

    const uuids = (folder.contents ?? []).map(entry => entry?.uuid).filter(Boolean);
    const resolved = await Promise.all(uuids.map(uuid => fromUuid(uuid)));
    const items = resolved.filter(doc => doc?.documentName === 'Item');

    for (const child of folder.children ?? []) {
        // v11+ reports children as `{folder, children}` wrappers; older versions
        // stored the Folder itself.
        items.push(...await collectFolderItems(child?.folder ?? child, seen));
    }
    return items;
}

/**
 * Resolve a drag payload into the Items it stands for.
 *
 * @param {object|null} data - Payload from {@link parseDropData}.
 * @returns {Promise<Item[]>} Empty for anything this module doesn't handle.
 */
export async function resolveDroppedItems(data) {
    if (!isSupportedDrop(data)) return [];
    const doc = await fromUuid(data.uuid);
    if (!doc) return [];
    if (data.type === 'Item') return doc.documentName === 'Item' ? [doc] : [];
    // Folder: `type` on a Folder document is the document class it holds.
    if (doc.documentName !== 'Folder' || doc.type !== 'Item') return [];
    return collectFolderItems(doc);
}

/**
 * Strip a source Item down to data safe to embed on an actor.
 *
 * @param {Item|object} item
 * @returns {object}
 */
export function toEmbeddedItemData(item) {
    const data = typeof item?.toObject === 'function' ? item.toObject() : { ...item };
    // `_id` belongs to where the item came from — reusing it collides with an
    // existing owned item — and an embedded item has no folder or ownership of
    // its own; it inherits the actor's.
    delete data._id;
    delete data.folder;
    delete data.ownership;
    return data;
}

/** Highest sort value among the actor's items of one type, or 0 if it has none. */
function maxSortForType(actor, type) {
    const sorts = (actor?.items ?? [])
        .filter(item => item.type === type)
        .map(item => item.sort ?? 0);
    return sorts.length ? Math.max(...sorts) : 0;
}

/**
 * Copy resolved Items onto an actor, each appended below the items of its own
 * type. Sort values are assigned here rather than inherited, so a weapon dragged
 * out of a compendium lands at the bottom of the weapon list instead of wherever
 * its sort value happened to put it.
 *
 * @param {Actor} actor
 * @param {Item[]} items
 * @returns {Promise<Item[]>} The created embedded documents.
 */
export async function createDroppedItems(actor, items) {
    if (!actor || !items?.length) return [];
    const nextSort = new Map();
    const payload = items.map(item => {
        const data = toEmbeddedItemData(item);
        const previous = nextSort.get(data.type) ?? maxSortForType(actor, data.type);
        const sort = previous + SORT_DENSITY;
        nextSort.set(data.type, sort);
        return { ...data, sort };
    });
    const created = await actor.createEmbeddedDocuments('Item', payload);
    return created ?? [];
}

/**
 * Re-order one of the actor's own items relative to another.
 *
 * Only meaningful within a single list, since each list on the sheet is one item
 * type — dropping a weapon onto a mutation is treated as no instruction at all
 * rather than as a cross-list move.
 *
 * @param {Actor} actor
 * @param {string} sourceId
 * @param {string} targetId
 * @returns {Promise<boolean>} True if a re-order was applied.
 */
export async function sortItemWithin(actor, sourceId, targetId) {
    const source = actor?.items?.get?.(sourceId);
    const target = actor?.items?.get?.(targetId);
    if (!source || !target) return false;
    if (source.id === target.id) return false;
    if (source.type !== target.type) return false;

    const siblings = actor.items.filter(item => item.type === source.type && item.id !== source.id);
    const updates = performIntegerSort(source, { target, siblings });
    if (!updates?.length) return false;
    await actor.updateEmbeddedDocuments('Item', updates.map(({ target: doc, update }) => ({
        _id: doc.id,
        ...update,
    })));
    return true;
}

/**
 * The item id a draggable row stands for.
 *
 * Looks at the row itself first and then at its descendants, because the
 * computer card carries the id on its delete button rather than on the card.
 *
 * @param {HTMLElement|null} row
 * @returns {string|null}
 */
export function itemIdFromRow(row) {
    if (!row) return null;
    return row.dataset?.itemId
        || row.querySelector?.('[data-item-id]')?.dataset?.itemId
        || null;
}

/** Localize with a literal fallback, so a missing lang key never blanks a toast. */
function label(key, fallback, data) {
    const i18n = game?.i18n;
    if (!i18n) return fallback;
    const text = data ? i18n.format?.(key, data) : i18n.localize?.(key);
    // Foundry hands back the key itself when it has no translation for it.
    return (!text || text === key) ? fallback : text;
}

/**
 * Mark the sheet's item rows draggable, and stop their icons from being dragged
 * as plain images.
 *
 * Must run on **every** render: ApplicationV2 replaces the rendered part's HTML,
 * so anything set on the rows themselves is gone by the next render. The event
 * listeners in {@link bindActorSheetDragDrop} survive because they sit on the
 * root element, which persists.
 *
 * @param {HTMLElement} root
 * @param {string} rowSelector
 */
export function markDraggableRows(root, rowSelector = DEFAULT_ROW_SELECTOR) {
    for (const row of root?.querySelectorAll?.(rowSelector) ?? []) {
        row.draggable = true;
        // `<img>` is natively draggable, so without this the item icon — the most
        // obvious thing on the row to grab — starts an image drag instead.
        for (const img of row.querySelectorAll('img')) img.draggable = false;
    }
}

/**
 * Make this module the only drop handler for a sheet class.
 *
 * Foundry v14's `ActorSheetV2` binds its own `DragDrop` in `_onRender` and creates
 * the dropped item in `_onDropItem`. Every sheet in this system overrides
 * `_onRender` without calling `super`, so that never happens — but adding the
 * `super` call is exactly the kind of tidy-up a later change makes, and it would
 * silently double every drop.
 *
 * The two methods are shut off on the **prototype**, not on the instance: core
 * captures `this._canDragDrop` / `this._onDrop` once, when its lazy `_dragDrop`
 * getter first runs, so an instance property assigned afterwards would come too
 * late to matter. Defining them is harmless on v12/v13, where the base class has
 * no such methods to shadow.
 *
 * If this system ever does move onto core's plumbing, this call and the `drop`
 * listener in {@link bindActorSheetDragDrop} come out together.
 *
 * @param {typeof foundry.applications.sheets.ActorSheetV2} SheetClass
 */
export function claimDropHandling(SheetClass) {
    const proto = SheetClass?.prototype;
    if (!proto) return;
    /** @override — core's drop permission, refused so only this module acts. */
    proto._canDragDrop = () => false;
    /** @override — belt and braces, in case a caller reaches `_onDrop` directly. */
    proto._onDrop = () => null;
}

/**
 * Wire drag-and-drop of owned items onto a sheet.
 *
 * Call from `_onRender`. Listeners are attached once per root element and use
 * delegation, so they keep working across re-renders; the per-row attributes are
 * refreshed on every call.
 *
 * @param {ActorSheetV2} sheet - Needs `.actor`; `.isEditable` is honoured if present.
 * @param {HTMLElement} root - The sheet's root element (`this.element`).
 * @param {object} [options]
 * @param {?string} [options.rowSelector] - Which rows are draggable; null for none.
 * @param {(created: Item[]) => void} [options.onDropped] - Called after a copy.
 * @param {(items: Item[], ctx: {actor: Actor, sheet: object}) => Promise<void>} [options.receive]
 *   Consume the dropped items some other way than by embedding them. This is how
 *   the statblock sheets translate a dropped Item into a schema row instead —
 *   see `alternity-statblock-drops.js`.
 */
export function bindActorSheetDragDrop(sheet, root, options = {}) {
    if (!root) return;
    const { rowSelector = DEFAULT_ROW_SELECTOR, onDropped = null, receive = null } = options;

    // Re-applied on every render: the rows themselves are rebuilt each time, so
    // the `draggable` attribute has to be put back. The listeners below are not,
    // because the root element they sit on persists — see alternity-sheet-binding.
    if (rowSelector) markDraggableRows(root, rowSelector);

    // A doubled `drop` handler creates the dropped item twice, which makes this
    // the most important once-only binding in the system.
    bindOnce(root, BOUND_KEY, () => {
        const clearHover = () => root.classList.remove(DROP_HOVER_CLASS);

        // A sheet with no draggable rows — a statblock, whose rows are schema
        // entries rather than documents — takes drops but never starts one.
        if (rowSelector) bindRowDragging(sheet, root, rowSelector, clearHover);

        root.addEventListener('dragover', (event) => {
            // The payload is unreadable until `drop`, so this can only tell that
            // *something* Foundry-shaped is being dragged, not what.
            if (!event.dataTransfer?.types?.includes?.('text/plain')) return;
            event.preventDefault();
            root.classList.add(DROP_HOVER_CLASS);
        });

        root.addEventListener('dragleave', (event) => {
            // dragleave also fires when crossing between children, so the highlight
            // is only dropped once the cursor has left the sheet entirely.
            if (!event.relatedTarget || !root.contains(event.relatedTarget)) clearHover();
        });

        root.addEventListener('drop', (event) => {
            clearHover();
            const data = parseDropData(event);
            if (!isSupportedDrop(data)) return;
            // Claim the drop synchronously: `preventDefault` after an await is too
            // late, and the browser would follow its own default for the payload.
            event.preventDefault();
            event.stopPropagation();
            // The row under the cursor has to be read now too — `event.target` is
            // still valid, but resolving `closest` after a re-render is not.
            const dropRow = rowSelector ? event.target?.closest?.(rowSelector) : null;
            handleDrop(sheet, data, itemIdFromRow(dropRow), { onDropped, receive });
        });
    });
}

/** Pick-up half of the wiring, for the sheets whose rows are real documents. */
function bindRowDragging(sheet, root, rowSelector, clearHover) {
    root.addEventListener('dragstart', (event) => {
        // Let a text selection inside a field drag as text.
        if (event.target?.closest?.(FIELD_SELECTOR)) return;
        const row = event.target?.closest?.(rowSelector);
        const item = sheet.actor?.items?.get?.(itemIdFromRow(row));
        if (!item) return;
        const payload = typeof item.toDragData === 'function'
            ? item.toDragData()
            : { type: 'Item', uuid: item.uuid };
        event.dataTransfer.setData('text/plain', JSON.stringify(payload));
        event.dataTransfer.effectAllowed = 'copyMove';
        row.classList.add(DRAG_SOURCE_CLASS);
    });

    root.addEventListener('dragend', (event) => {
        event.target?.closest?.(rowSelector)?.classList.remove(DRAG_SOURCE_CLASS);
        clearHover();
    });
}

/**
 * The asynchronous half of a drop, split out so the listener itself can stay
 * synchronous up to `preventDefault`.
 *
 * @param {ActorSheetV2} sheet
 * @param {object} data
 * @param {string|null} dropTargetId - Item id of the row dropped on, if any.
 * @param {object} handlers
 * @param {((created: Item[]) => void)|null} handlers.onDropped
 * @param {((items: Item[], ctx: object) => Promise<void>)|null} handlers.receive
 */
async function handleDrop(sheet, data, dropTargetId, { onDropped, receive }) {
    const actor = sheet.actor;
    if (!actor) return;
    if (sheet.isEditable === false || !actor.isOwner) {
        ui.notifications?.warn?.(label(
            'ALTERNITY.DragDrop.NotEditable',
            'You do not have permission to change this sheet.',
        ));
        return;
    }

    let items;
    try {
        items = await resolveDroppedItems(data);
    } catch (error) {
        console.error('[Alternity] Failed to resolve a dropped item:', error);
        return;
    }
    if (!items.length) return;

    // A sheet that consumes drops its own way — a statblock turning the item into
    // a schema row — owns everything from here, including its own reporting.
    if (receive) {
        try {
            await receive(items, { actor, sheet });
        } catch (error) {
            console.error('[Alternity] Failed to apply a dropped item:', error);
            ui.notifications?.error?.(label(
                'ALTERNITY.DragDrop.Failed',
                'Could not add the dropped item — see the console for details.',
            ));
        }
        return;
    }

    // An item that already belongs to this actor was dragged from one of its own
    // lists, so this is a re-order rather than a request for a second copy.
    const own = items.filter(item => item.parent?.id === actor.id);
    if (own.length) {
        if (dropTargetId) await sortItemWithin(actor, own[0].id, dropTargetId);
        return;
    }

    let created;
    try {
        created = await createDroppedItems(actor, items);
    } catch (error) {
        console.error('[Alternity] Failed to add a dropped item:', error);
        ui.notifications?.error?.(label(
            'ALTERNITY.DragDrop.Failed',
            'Could not add the dropped item — see the console for details.',
        ));
        return;
    }
    if (!created.length) return;

    onDropped?.(created);
    ui.notifications?.info?.(created.length === 1
        ? label('ALTERNITY.DragDrop.AddedOne', `${created[0].name} added to ${actor.name}.`,
            { name: created[0].name, actor: actor.name })
        : label('ALTERNITY.DragDrop.AddedMany', `${created.length} items added to ${actor.name}.`,
            { count: created.length, actor: actor.name }));
}
