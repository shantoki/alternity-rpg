/**
 * @file tools/lib/fvtt.mjs
 * @description Document shapes and identity for the compendium source files.
 *
 * A compiled pack is a LevelDB keyed by `!<collection>!<id>`, so every source file
 * carries its own `_key` - that is the one field `compilePack` requires. See
 * `tools/build-packs.mjs`.
 */

import { createHash } from 'node:crypto';

/** Foundry document ids are 16 characters out of this alphabet. */
const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * A document id derived from what the document *is* rather than from a random draw.
 *
 * The converter is re-run every time the source data changes, and a random id would
 * hand every document a new identity on each run - breaking every link, every actor
 * that already dragged the item in, and producing a diff of 1,100 changed files for a
 * one-record edit. Hashing a stable key instead means a re-run is a no-op for
 * everything that did not actually change.
 *
 * @param {...string} parts  Stable identifying parts (pack, source book, name).
 * @returns {string} A 16-character Foundry id.
 */
export function stableId(...parts) {
    const digest = createHash('sha256').update(parts.join(' ')).digest();
    let id = '';
    for (let i = 0; i < 16; i++) id += ID_ALPHABET[digest[i] % ID_ALPHABET.length];
    return id;
}

/** A filesystem-safe, stable filename for a source document. */
export function slugify(text) {
    return String(text)
        .normalize('NFKD')
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/[\s_]+/g, '-')
        .replace(/-+/g, '-')
        .toLowerCase() || 'unnamed';
}

/**
 * Build a compendium Folder document.
 * @param {object} opts
 * @param {string} opts.pack     Pack name, so ids stay unique across packs.
 * @param {string} opts.name     Folder label (the source book).
 * @param {string} opts.type     The Document type the folder holds ('Item', 'Actor', ...).
 * @param {number} [opts.sort]
 */
export function makeFolder({ pack, name, type, sort = 0 }) {
    const _id = stableId('folder', pack, name);
    return {
        _id,
        _key: `!folders!${_id}`,
        name,
        type,
        sorting: 'a',
        sort,
        color: null,
        folder: null,
        description: '',
        flags: {},
    };
}

/**
 * Build a compendium Item document.
 *
 * `provenance` is written to the item's own flag rather than dropped: the source XML
 * carries printed values (progress level, cost, availability, concealment, firing
 * modes) that the current Item schemas have no field for, and throwing them away
 * would mean re-deriving them from the books later. They are also rendered into the
 * description so they are readable today - see `statBlock`.
 */
export function makeItem({ pack, name, type, system, folder = null, img, sort = 0, provenance = {} }) {
    const _id = stableId(pack, type, name);
    return {
        _id,
        _key: `!items!${_id}`,
        name,
        type,
        img: img ?? 'icons/svg/item-bag.svg',
        system,
        effects: [],
        folder,
        sort,
        ownership: { default: 0 },
        flags: { 'alternity': { provenance } },
    };
}

/**
 * Build a compendium JournalEntry document with a single text page.
 *
 * Embedded documents need their own `_key` too: `compilePack` walks the document
 * hierarchy and writes each page as its own LevelDB row, keyed by the sublevel and the
 * parent's id joined to the page's - `!journal.pages!<entry>.<page>`. Without it the
 * batch write fails on an undefined key rather than quietly dropping the page.
 */
export function makeJournalEntry({ pack, name, html, folder = null, sort = 0, provenance = {} }) {
    const _id = stableId(pack, 'journal', name);
    const pageId = stableId(pack, 'page', name);
    return {
        _id,
        _key: `!journal!${_id}`,
        name,
        pages: [{
            _id: pageId,
            _key: `!journal.pages!${_id}.${pageId}`,
            name,
            type: 'text',
            title: { show: true, level: 1 },
            text: { format: 1, content: html },
            sort: 0,
            ownership: { default: -1 },
            flags: {},
        }],
        folder,
        sort,
        ownership: { default: 0 },
        flags: { 'alternity': { provenance } },
    };
}

/** Build a compendium Actor document. */
export function makeActor({ pack, name, type, system, items = [], flags = {}, folder = null, img, sort = 0 }) {
    const _id = stableId(pack, type, name);
    const portrait = img ?? 'icons/svg/mystery-man.svg';
    return {
        _id,
        _key: `!actors!${_id}`,
        name,
        type,
        img: portrait,
        system,
        items,
        effects: [],
        folder,
        sort,
        ownership: { default: 0 },
        prototypeToken: {
            name,
            actorLink: false,
            disposition: 0,
            texture: { src: portrait },
        },
        flags,
    };
}

/**
 * Render printed source values as an HTML definition list appended to a description.
 *
 * Kept in its own wrapper element so the later prose pass can prepend the book text
 * above it without having to parse the stat lines back out.
 *
 * @param {Array<[string, unknown]>} rows  Label/value pairs; blank values are dropped.
 */
export function statBlock(rows) {
    const cells = rows
        .filter(([, value]) => value !== null && value !== undefined && value !== '' && value !== '-')
        .map(([label, value]) => `<dt>${label}</dt><dd>${escapeHtml(value)}</dd>`);
    if (!cells.length) return '';
    return `<dl class="alternity-source-stats">${cells.join('')}</dl>`;
}

/** Escape a value for interpolation into the description HTML. */
export function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
