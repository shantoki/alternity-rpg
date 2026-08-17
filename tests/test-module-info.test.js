/**
 * @fileoverview Tests the REAL src/module-info.js, not the mock that normally
 * replaces it.
 *
 * The `moduleNameMapper` in jest.config.js rewrites any import ending in
 * `module-info.js` to `tests/mocks/module-info.js`, so the production shim could
 * never be reached from a test — which is how it went so long carrying the bug
 * these tests describe. The file is instead read off disk and imported as a
 * `data:` URL, which the mapper does not touch. That works because the shim has no
 * imports of its own; if it ever gains one, this approach needs revisiting.
 *
 * The bug: `export const game = globalThis.game` runs when Foundry loads the
 * system's esmodules, which is *before* `Localization.initialize()` populates
 * `game.i18n`. The shell object is captured permanently, so every later
 * `game.i18n.localize(...)` throws "Cannot read properties of undefined (reading
 * 'localize')". It surfaced on the damage button of the attack chat card; the
 * sheets had always been immune only because they use the bare `game` global
 * instead of importing it.
 */

import { readFileSync } from 'node:fs';

const shimSource = readFileSync(new URL('../src/module-info.js', import.meta.url), 'utf8');

/**
 * Import a fresh copy of the real shim.
 *
 * A cache-busting comment is appended so each call re-evaluates the module: these
 * tests turn on *when* a global is read, so a cached instance from a previous test
 * would defeat the whole point.
 *
 * @param {number} nonce
 * @returns {Promise<object>}
 */
function importShim(nonce) {
    const src = `${shimSource}\n//${nonce}`;
    return import(`data:text/javascript,${encodeURIComponent(src)}`);
}

let nonce = 0;

/** Snapshot and restore the globals these tests move around. */
const saved = {};
beforeEach(() => {
    for (const key of ['game', 'ChatMessage', 'Hooks', 'Roll', 'CONFIG', 'ui']) {
        saved[key] = globalThis[key];
    }
});
afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
        globalThis[key] = value;
    }
});

describe('src/module-info.js — late binding', () => {
    it('should see a game.i18n that did not exist when the shim was imported', async () => {
        // Reproduce Foundry's boot order exactly: a bare `game` shell first...
        globalThis.game = {};
        const shim = await importShim(nonce++);

        // ...the shim is imported here, as an esmodule would be...
        expect(shim.game.i18n).toBeUndefined();

        // ...and Localization.initialize() populates i18n only afterwards.
        globalThis.game.i18n = { localize: (k) => `localized:${k}` };

        // An eager `export const game = globalThis.game` passes this line and fails
        // the next one, because it captured the shell object.
        expect(shim.game.i18n).toBeDefined();
        expect(shim.game.i18n.localize('ALTERNITY.Stun')).toBe('localized:ALTERNITY.Stun');
    });

    it('should follow a wholesale replacement of the game object', async () => {
        globalThis.game = { i18n: { localize: () => 'first' } };
        const shim = await importShim(nonce++);

        // Foundry does not mutate the shell — it assigns a whole new Game instance.
        globalThis.game = { i18n: { localize: () => 'second' } };

        expect(shim.game.i18n.localize('x')).toBe('second');
    });

    it('should not throw merely because a global is absent at import time', async () => {
        delete globalThis.game;
        delete globalThis.ChatMessage;
        delete globalThis.Hooks;

        const shim = await importShim(nonce++);

        // Reading through a missing global yields undefined rather than exploding,
        // so a module can be imported before Foundry is ready.
        expect(shim.game.i18n).toBeUndefined();
        expect(shim.ChatMessage.create).toBeUndefined();
        expect(shim.Hooks.on).toBeUndefined();
    });

    it('should late-bind ChatMessage and Hooks as well as game', async () => {
        delete globalThis.ChatMessage;
        delete globalThis.Hooks;
        const shim = await importShim(nonce++);

        const created = [];
        globalThis.ChatMessage = { create: (d) => { created.push(d); return d; } };
        globalThis.Hooks = { on: () => 'registered' };

        expect(shim.ChatMessage.create({ content: 'hi' })).toEqual({ content: 'hi' });
        expect(created).toHaveLength(1);
        expect(shim.Hooks.on('event', () => {})).toBe('registered');
    });

    it('should build the Roll that exists at call time, not at import time', async () => {
        globalThis.Roll = class Early { constructor() { this.which = 'early'; } };
        const shim = await importShim(nonce++);

        globalThis.Roll = class Late { constructor(formula) { this.which = 'late'; this.formula = formula; } };

        const roll = new shim.Roll('1d20');
        expect(roll.which).toBe('late');
        expect(roll.formula).toBe('1d20');
    });

    it('should resolve renderTemplate and fromUuid per call', async () => {
        const shim = await importShim(nonce++);

        globalThis.foundry.applications = {
            handlebars: { renderTemplate: async (path) => `rendered:${path}` },
        };
        globalThis.foundry.utils.fromUuid = async (uuid) => ({ uuid });

        await expect(shim.renderTemplate('a/b.hbs')).resolves.toBe('rendered:a/b.hbs');
        await expect(shim.fromUuid('Actor.x')).resolves.toEqual({ uuid: 'Actor.x' });
    });

    it('should keep the document base classes eager, since they appear in class heritage', async () => {
        // `class AlternityActor extends Actor` is evaluated at import time, and a
        // Proxy cannot stand in for a base class — so these must be the real thing
        // when the shim loads. Foundry defines them before it loads esmodules.
        globalThis.Actor = class FoundryActor {};
        globalThis.Combatant = class FoundryCombatant {};

        const shim = await importShim(nonce++);

        expect(shim.Actor).toBe(globalThis.Actor);
        expect(shim.Combatant).toBe(globalThis.Combatant);
        // Extending it must actually work, which is the whole reason it stays eager.
        expect(() => class Extended extends shim.Actor {}).not.toThrow();
    });

    it('should late-bind every symbol used only as a namespace', async () => {
        // A guard against a future "simplification" back to eager consts. Anything
        // read as `X.y` rather than extended has to survive being defined late.
        delete globalThis.game;
        delete globalThis.ChatMessage;
        delete globalThis.Hooks;
        delete globalThis.CONFIG;
        delete globalThis.ui;

        const shim = await importShim(nonce++);

        globalThis.game = { i18n: { localize: () => 'ok' } };
        globalThis.ChatMessage = { create: () => 'ok' };
        globalThis.Hooks = { callAll: () => 'ok' };
        globalThis.CONFIG = { sounds: { dice: 'ok' } };
        globalThis.ui = { notifications: { warn: () => 'ok' } };

        expect(shim.game.i18n.localize()).toBe('ok');
        expect(shim.ChatMessage.create()).toBe('ok');
        expect(shim.Hooks.callAll()).toBe('ok');
        expect(shim.CONFIG.sounds.dice).toBe('ok');
        expect(shim.ui.notifications.warn()).toBe('ok');
    });
});
