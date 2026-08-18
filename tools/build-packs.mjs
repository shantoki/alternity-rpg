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

/**
 * The compiler is loaded dynamically so a missing install can be reported as the setup
 * step it is. A static import fails before any of this file runs, and all the operator
 * gets is a `ERR_MODULE_NOT_FOUND` stack trace out of node's ESM resolver — which says
 * nothing about `npm install` being the fix.
 */
const { compilePack, extractPack } = await (async () => {
    try {
        return await import('@foundryvtt/foundryvtt-cli');
    } catch (error) {
        if (error?.code === 'ERR_MODULE_NOT_FOUND' && String(error.message).includes('foundryvtt-cli')) {
            console.error([
                'Cannot find @foundryvtt/foundryvtt-cli, which compiles the packs.',
                '',
                'It is a devDependency, so this usually means dependencies have not been',
                'installed since it was added. Run:',
                '',
                '    npm install',
                '',
                'If you install with --omit=dev or NODE_ENV=production, the pack tooling is',
                'skipped and this script cannot run at all.',
            ].join('\n'));
            process.exit(1);
        }
        throw error;
    }
})();

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
        try {
            await compilePack(source, destination, { recursive: true });
        } catch (error) {
            reportNativeBindingFailure(error);
            throw error;
        }
        console.log(`${name.padEnd(24)} ${String(count).padStart(4)} documents -> packs/${name}`);
    }
}

/**
 * A LevelDB is a native module, and npm can be configured not to run the install script
 * that fetches its prebuilt binary. When that happens the failure surfaces here rather
 * than at install time, as a missing `.node` file, so say what it actually means.
 */
function reportNativeBindingFailure(error) {
    const message = String(error?.message ?? '');
    if (!/classic-level|node-gyp-build|\.node|bindings/i.test(message)) return;
    console.error([
        '',
        'The LevelDB binding (classic-level) failed to load. It ships a prebuilt binary',
        'fetched by an install script, which some npm configurations do not run.',
        '',
        '    npm rebuild classic-level',
        '',
        'or reinstall with install scripts permitted.',
    ].join('\n'));
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
