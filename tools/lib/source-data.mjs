/**
 * @file tools/lib/source-data.mjs
 * @description Readers over the converted Alternity character-generator data.
 *
 * `external/data/*.xml` is the original data set shipped with the (long dead) Alternity
 * character generator; `external/json/**` is a straight xmltodict-style conversion of
 * it, which is what this tooling reads. Attributes carry an `@` prefix and element text
 * does not, so `Damage` and `@DamageType` are two different fields on the same record -
 * hence `attr()` and `text()` rather than one accessor.
 *
 * `external/` is gitignored, so this is *not* part of the runtime system. The committed
 * artefact is what the converter writes to `packs/_source/`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SOURCE_ROOT = path.join(REPO_ROOT, 'external', 'json');

/** Where each source book's records should be filed, keyed by the raw `@Source` value. */
const BOOK_LABELS = {
    core: 'Core Rulebook',
    'sd aeg': 'Star Drive Arms & Equipment Guide',
    'dm aeg': 'Dark Matter Arms & Equipment Guide',
    'gamma world': 'Gamma World',
    'dark matter': 'Dark Matter',
    dataware: 'Dataware',
    mindwalking: 'Mindwalking',
    tangents: 'Tangents',
    'beyond science': 'Beyond Science',
    'dragon 273': 'Dragon Magazine 273',
    externals: 'Externals',
    'beyond science_dark_matter': 'Beyond Science (Dark Matter)',
};

/** True when the source data is present; it is gitignored, so a clone will not have it. */
export function sourceDataAvailable() {
    return fs.existsSync(SOURCE_ROOT);
}

/**
 * Read one converted JSON file relative to `external/json`.
 *
 * Relative paths are posix throughout - they are written into the documents as
 * provenance, so a pack built on Windows and one built on Linux have to agree.
 */
export function readSource(relativePath) {
    return JSON.parse(fs.readFileSync(path.join(SOURCE_ROOT, ...relativePath.split('/')), 'utf8'));
}

/** List converted JSON files under `external/json/<dir>` matching a prefix. */
export function listSource(dir, prefix = '') {
    return fs.readdirSync(path.join(SOURCE_ROOT, dir))
        .filter(f => f.endsWith('.json') && f.startsWith(prefix))
        .sort()
        .map(f => `${dir}/${f}`);
}

/**
 * xmltodict collapses a single repeated element to a bare object rather than a
 * one-element array, so every list in this data set is "array, object, or missing".
 */
export function asArray(value) {
    if (value === null || value === undefined) return [];
    return Array.isArray(value) ? value : [value];
}

/**
 * Pull the records out of one converted file.
 *
 * @param {string} relativePath  File under `external/json`.
 * @param {string[]} pathParts   The element path down to the repeating record,
 *                               e.g. `['AttackForms', 'AttackForm']`.
 * @returns {object[]} Records, each tagged with `_sourceFile`.
 */
export function readRecords(relativePath, pathParts) {
    let node = readSource(relativePath);
    for (const part of pathParts) {
        if (node === null || node === undefined) return [];
        node = node[part];
    }
    return asArray(node).map(record => ({ ...record, _sourceFile: relativePath }));
}

/** Read the same record path out of every file matching a prefix, concatenated. */
export function readRecordsAcross(dir, prefix, pathParts) {
    return listSource(dir, prefix).flatMap(file => readRecords(file, pathParts));
}

/**
 * The display label for a source book.
 *
 * The raw `@Source` values are inconsistently cased between files ('core' vs 'Core',
 * 'SD AEG' vs 'sd aeg'), which would otherwise produce two folders for one book.
 */
export function bookLabel(rawSource, fallbackFile = '') {
    const key = String(rawSource ?? '').trim().toLowerCase();
    if (BOOK_LABELS[key]) return BOOK_LABELS[key];
    if (key) return String(rawSource).trim();
    // Fall back to the filename stem, which encodes the book for files whose records
    // carry no `@Source` at all (cyberware.json, achieve.json).
    const stem = path.basename(fallbackFile, '.json').replace(/^[a-z]+_/, '');
    return BOOK_LABELS[stem.toLowerCase()] ?? (stem || 'Unknown Source');
}

/** Read an `@`-prefixed XML attribute. */
export function attr(record, name) {
    return record?.[`@${name}`];
}

/** Coerce a source value to a number, with a fallback for '', '-' and non-numerics. */
export function num(value, fallback = 0) {
    if (value === null || value === undefined || value === '' || value === '-') return fallback;
    const parsed = Number(String(value).trim());
    return Number.isFinite(parsed) ? parsed : fallback;
}

/** Coerce a source value to a non-negative integer. */
export function int(value, fallback = 0) {
    return Math.trunc(num(value, fallback));
}

/** The source data spells booleans 'True'/'False'. */
export function bool(value) {
    return String(value).trim().toLowerCase() === 'true';
}

/** Coerce a source value to a trimmed string, mapping the '-' placeholder to ''. */
export function str(value, fallback = '') {
    if (value === null || value === undefined) return fallback;
    const text = String(value).trim();
    return text === '-' ? fallback : text;
}

/**
 * Availability is a small integer in the weapon/armor data and a three-letter code in
 * the equipment data. `walter_weapons.xsl` is the decoder for the numeric form.
 */
export function availabilityLabel(value) {
    const numeric = { 1: 'Common', 2: 'Controlled', 3: 'Military', 4: 'Restricted' };
    const coded = { com: 'Common', con: 'Controlled', mil: 'Military', res: 'Restricted', any: 'Any' };
    const raw = String(value ?? '').trim();
    if (raw in numeric) return numeric[raw];
    return coded[raw.toLowerCase()] ?? 'Any';
}

/**
 * Disambiguate names that repeat across source books.
 *
 * The packs merge every book, so a Katana printed in both the Core Rulebook and Gamma
 * World would otherwise land as two identically-named items with nothing to tell them
 * apart in the compendium list. The first occurrence keeps the printed name and later
 * ones are suffixed with their book - which also keeps `stableId` unique, since it
 * hashes the name.
 *
 * @param {Array<{name: string, book: string}>} entries  Mutated in place.
 */
export function disambiguateNames(entries) {
    const counts = new Map();
    for (const entry of entries) counts.set(entry.name, (counts.get(entry.name) ?? 0) + 1);

    const used = new Set();
    for (const entry of entries) {
        if (counts.get(entry.name) > 1 && used.has(entry.name)) {
            let candidate = `${entry.name} (${entry.book})`;
            let suffix = 2;
            while (used.has(candidate)) candidate = `${entry.name} (${entry.book} ${suffix++})`;
            entry.name = candidate;
        }
        used.add(entry.name);
    }
    return entries;
}
