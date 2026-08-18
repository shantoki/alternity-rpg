/**
 * @file tools/build-packs.mjs
 * @description Compile `packs/_source/**` into the LevelDB packs Foundry loads.
 *
 *     npm run build:packs            # compile every pack
 *     npm run build:packs -- weapons # compile just the packs whose name matches
 *
 * Foundry has read compendia out of LevelDB directories since v11, so a pack cannot be
 * a JSON file the way it could under v10 and earlier. The JSON under `packs/_source` is
 * the editable form and this script is what turns it into the loadable one; nothing
 * reads `packs/_source` at runtime.
 *
 * Run `npm run extract:packs` to go the other way, after editing a pack inside Foundry.
 */

import fs from 'node:fs';
import path from 'node:path';
import { compilePack, extractPack } from '@foundryvtt/foundryvtt-cli';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const PACKS_DIR = path.join(REPO_ROOT, 'packs');
const SOURCE_DIR = path.join(PACKS_DIR, '_source');

/** Pack names that have a source directory, optionally filtered by CLI arguments. */
function packNames(filters) {
    if (!fs.existsSync(SOURCE_DIR)) return [];
    return fs.readdirSync(SOURCE_DIR, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .filter(name => !filters.length || filters.some(filter => name.includes(filter)))
        .sort();
}

async function build(filters) {
    const names = packNames(filters);
    if (!names.length) {
        console.error(`No packs to build under ${SOURCE_DIR}`);
        process.exitCode = 1;
        return;
    }

    for (const name of names) {
        const source = path.join(SOURCE_DIR, name);
        const destination = path.join(PACKS_DIR, name);
        const count = fs.readdirSync(source).filter(file => file.endsWith('.json')).length;
        await compilePack(source, destination, { recursive: true });
        console.log(`${name.padEnd(24)} ${String(count).padStart(4)} documents -> packs/${name}`);
    }
}

async function extract(filters) {
    const names = packNames(filters);
    for (const name of names) {
        const source = path.join(PACKS_DIR, name);
        if (!fs.existsSync(source)) continue;
        await extractPack(source, path.join(SOURCE_DIR, name), {
            clean: true,
            jsonOptions: { space: 2 },
        });
        console.log(`packs/${name} -> packs/_source/${name}`);
    }
}

const [mode, ...filters] = process.argv.slice(2);
if (mode === '--extract') await extract(filters);
else await build(mode ? [mode, ...filters] : []);
