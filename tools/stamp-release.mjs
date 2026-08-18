/**
 * @file tools/stamp-release.mjs
 * @description Write the release version and its URLs into system.json.
 *
 *     node tools/stamp-release.mjs v1.3.0 shantoki/alternity-rpg
 *
 * Foundry installs a system by fetching a manifest, reading `version` and following
 * `download`. Those three have to agree: a manifest whose `version` matches what is
 * already installed makes Foundry report no update, and a `download` pointing at the
 * wrong tag installs the wrong code under the right version number.
 *
 * The tag is the single source of truth, and the release workflow passes it in, so
 * nothing has to be remembered or edited by hand at release time. The committed
 * system.json keeps whatever version it has; only the released copy is stamped.
 */

import fs from 'node:fs';
import path from 'node:path';

const [tag, repository] = process.argv.slice(2);

if (!tag || !repository) {
    console.error('Usage: node tools/stamp-release.mjs <tag> <owner/repo>');
    process.exit(1);
}

// Tags are conventionally `v1.3.0`; system.json wants the bare version.
const version = tag.replace(/^v/, '');
if (!/^\d+\.\d+\.\d+/.test(version)) {
    console.error(`Tag "${tag}" is not a version. Expected something like v1.3.0.`);
    process.exit(1);
}

const file = path.join(import.meta.dirname, '..', 'system.json');
const system = JSON.parse(fs.readFileSync(file, 'utf8'));

system.version = version;
system.url = `https://github.com/${repository}`;
// `manifest` deliberately points at the *latest* release rather than at this one, so an
// installed copy checks for updates against whatever is newest rather than pinning
// itself to the version it was installed from.
system.manifest = `https://github.com/${repository}/releases/latest/download/system.json`;
system.download = `https://github.com/${repository}/releases/download/${tag}/alternity-v2.zip`;

fs.writeFileSync(file, `${JSON.stringify(system, null, 2)}\n`, 'utf8');

console.log(`Stamped system.json for ${version}`);
console.log(`  manifest: ${system.manifest}`);
console.log(`  download: ${system.download}`);
