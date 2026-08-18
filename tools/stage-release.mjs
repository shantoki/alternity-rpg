/**
 * @file tools/stage-release.mjs
 * @description Copy the files a player's Foundry needs into a staging directory.
 *
 *     node tools/stage-release.mjs dist/alternity
 *
 * The set is defined by exclusion in `.releaseignore`: everything not listed is shipped,
 * so a new runtime directory is included by default rather than silently left out of the
 * archive by an allow-list nobody remembered to update.
 *
 * Written in Node rather than as an `rsync --exclude-from` line in the workflow so the
 * selection can be checked on any machine, including the Windows ones this system is
 * developed on, instead of only inside CI.
 */

import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

/**
 * Read `.releaseignore`, dropping comments and blanks.
 *
 * Patterns are plain paths, relative to the repository root, naming a file or a whole
 * directory. No globs: the list is short and read by people, and a glob dialect nobody
 * is sure of is how a release quietly ships someone's `external/` data set.
 */
function readIgnoreList() {
    const file = path.join(REPO_ROOT, '.releaseignore');
    return new Set(fs.readFileSync(file, 'utf8')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'))
        .map(line => line.replace(/\/+$/, '')));
}

/**
 * LevelDB's own scratch files, which a compiled pack always has lying beside it.
 *
 * `LOCK` is the file the store flocks while a process has it open, and `LOG` is its
 * debug output; neither is part of the data, and shipping a lock file inside a zip that
 * gets unpacked into someone's Data/systems is at best noise. Named here rather than in
 * `.releaseignore` because it would otherwise be one line per pack.
 */
const LEVELDB_SCRATCH = new Set(['LOCK', 'LOG', 'LOG.old']);

/** Copy `source` into `destination`, skipping anything the ignore list names. */
function copyTree(ignored, relative, destinationRoot) {
    if (ignored.has(relative)) return 0;
    if (LEVELDB_SCRATCH.has(path.posix.basename(relative))) return 0;

    const absolute = path.join(REPO_ROOT, relative);
    const stats = fs.statSync(absolute);

    if (!stats.isDirectory()) {
        const target = path.join(destinationRoot, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(absolute, target);
        return 1;
    }

    let copied = 0;
    for (const entry of fs.readdirSync(absolute)) {
        copied += copyTree(ignored, path.posix.join(relative, entry), destinationRoot);
    }
    return copied;
}

const destination = path.resolve(process.argv[2] ?? path.join(REPO_ROOT, 'dist', 'alternity'));
const ignored = readIgnoreList();

// A packed system that carries no compendia is the failure this whole release path
// exists to prevent, and it is invisible until someone installs it.
const packsDir = path.join(REPO_ROOT, 'packs');
const compiled = fs.existsSync(packsDir)
    ? fs.readdirSync(packsDir).filter(name => name !== '_source')
    : [];
if (!compiled.length) {
    console.error('No compiled packs under packs/ - run `npm run build:packs` first.');
    process.exit(1);
}

fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(destination, { recursive: true });

let total = 0;
for (const entry of fs.readdirSync(REPO_ROOT)) {
    total += copyTree(ignored, entry, destination);
}

console.log(`Staged ${total} files into ${path.relative(REPO_ROOT, destination) || destination}`);
console.log(`  compendium packs: ${compiled.length}`);
