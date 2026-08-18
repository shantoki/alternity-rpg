/**
 * @file tools/convert-source-data.mjs
 * @description Regenerate `packs/_source/**` from the Alternity character generator data.
 *
 *     npm run convert:source
 *
 * The generator data lives in `external/`, which is gitignored - so most of this script
 * only runs on a checkout that has it, and its *output* is what is committed. Anyone
 * without the source data can still edit `packs/_source` by hand and run
 * `npm run build:packs`.
 *
 * The two ship packs are the exception: the generator data set has no starships in it, so
 * `convert/warships.mjs` and `convert/spaceships.mjs` carry their tables inline and run
 * anywhere. They mark themselves with `NEEDS_SOURCE_DATA = false`.
 *
 * Document ids are hashed from the pack, type and name (`stableId`), so re-running this
 * against unchanged data rewrites the same bytes: a source-data fix shows up as a diff
 * of the records that actually changed, and items already dragged onto actors keep
 * pointing at the same compendium entry.
 */

import fs from 'node:fs';
import path from 'node:path';
import { makeFolder, slugify } from './lib/fvtt.mjs';
import { REPO_ROOT, sourceDataAvailable } from './lib/source-data.mjs';

import * as weapons from './convert/weapons.mjs';
import * as armor from './convert/armor.mjs';
import * as equipment from './convert/equipment.mjs';
import * as skills from './convert/skills.mjs';
import * as fx from './convert/fx.mjs';
import * as cybertech from './convert/cybertech.mjs';
import * as achievements from './convert/achievements.mjs';
import * as species from './convert/species.mjs';
import * as templates from './convert/templates.mjs';
import * as warships from './convert/warships.mjs';
import * as spaceships from './convert/spaceships.mjs';

/**
 * Every converter here reads `external/json` except the two ship packs, which have no
 * input file at all - the character generator's data set has no starships in it, so their
 * tables are transcribed inside the converter and they declare `NEEDS_SOURCE_DATA = false`.
 * That is why the missing-source-data check below is per converter rather than a single
 * gate on the whole run: a clone without the generator data can still rebuild the ships.
 */
const CONVERTERS = [
    weapons, armor, equipment, skills, fx, cybertech, achievements, species, templates,
    warships, spaceships,
];

const SOURCE_DIR = path.join(REPO_ROOT, 'packs', '_source');

/** The Document type a pack holds, read off the `_key` its documents carry. */
const COLLECTION_TO_TYPE = { items: 'Item', actors: 'Actor', journal: 'JournalEntry' };

function documentType(doc) {
    const [, collection] = String(doc._key).split('!');
    return COLLECTION_TO_TYPE[collection] ?? 'Item';
}

/**
 * Group a pack's documents into compendium folders.
 *
 * The packs merge every source book, so without folders a weapons compendium is 252
 * flat rows with no way to see which are Core and which are Gamma World. Converters
 * name their own grouping through `provenance.folder` where the book is not the useful
 * axis - the achievements pack folders by profession instead.
 */
function addFolders(pack, docs) {
    const type = documentType(docs[0]);
    const folderNames = [...new Set(docs.map(doc => {
        const provenance = doc.flags?.['alternity']?.provenance ?? {};
        return provenance.folder ?? provenance.book;
    }).filter(Boolean))].sort();

    const folders = folderNames.map((name, index) => makeFolder({ pack, name, type, sort: index * 100 }));
    const idsByName = new Map(folders.map(folder => [folder.name, folder._id]));

    for (const doc of docs) {
        const provenance = doc.flags?.['alternity']?.provenance ?? {};
        doc.folder = idsByName.get(provenance.folder ?? provenance.book) ?? null;
    }
    return folders;
}

/** Write one pack's documents, replacing whatever was there before. */
function writePack(pack, docs) {
    const dir = path.join(SOURCE_DIR, pack);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    for (const doc of docs) {
        // The id is part of the filename because two differently-named documents can
        // slugify to the same string ("Gauntlet, Good" and "Gauntlet Good"), and
        // because it keeps the filename stable when a name is edited by hand.
        const file = path.join(dir, `${slugify(doc.name)}_${doc._id}.json`);
        fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
    }
}

function main() {
    const hasSourceData = sourceDataAvailable();
    if (!hasSourceData) {
        console.warn('No source data found under external/json - the packs built from the');
        console.warn('character generator data set will be skipped. packs/_source is the');
        console.warn('committed output, so nothing is lost by not rebuilding them here.');
    }

    fs.mkdirSync(SOURCE_DIR, { recursive: true });
    let total = 0;
    let ran = 0;

    for (const converter of CONVERTERS) {
        if (converter.NEEDS_SOURCE_DATA !== false && !hasSourceData) {
            console.log(`${converter.PACK.padEnd(24)} skipped - needs external/json`);
            continue;
        }
        ran += 1;
        const docs = converter.convert();
        if (!docs.length) {
            console.warn(`${converter.PACK}: no documents produced`);
            continue;
        }

        const duplicates = docs.length - new Set(docs.map(doc => doc._id)).size;
        if (duplicates) throw new Error(`${converter.PACK}: ${duplicates} documents share an id`);

        const folders = addFolders(converter.PACK, docs);
        writePack(converter.PACK, [...folders, ...docs]);
        total += docs.length;
        console.log(`${converter.PACK.padEnd(24)} ${String(docs.length).padStart(4)} documents in ${folders.length} folders`);
    }

    console.log(`\n${total} documents written to packs/_source`);

    // A run that converted nothing at all is a failure; one that skipped the packs whose
    // input is missing and wrote the rest is not.
    if (!ran) {
        console.error('No converter could run.');
        process.exitCode = 1;
    }
}

main();
