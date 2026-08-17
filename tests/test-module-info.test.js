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
        delete globalThis.ui;

        const shim = await importShim(nonce++);

        // Reading through a missing global yields undefined rather than exploding,
        // so a module can be imported before Foundry is ready.
        expect(shim.game.i18n).toBeUndefined();
        expect(shim.ui.notifications).toBeUndefined();
    });

    it('should read ui through to whatever Foundry installs later', async () => {
        delete globalThis.ui;
        const shim = await importShim(nonce++);

        const warned = [];
        globalThis.ui = { notifications: { warn: (m) => warned.push(m) } };

        shim.ui.notifications.warn('careful');
        expect(warned).toEqual(['careful']);
    });

    it('should call a method with the real object as `this`, not the Proxy', async () => {
        // The reason a naive read-through Proxy is not enough. Foundry's classes use
        // private fields, and a private-field lookup throws when the receiver is not
        // the declaring class:
        //
        //   Hooks.on(...) -> TypeError: Cannot read private member #id from an
        //                    object whose class did not declare it
        //
        // Foundry's `game` is a Game instance with private fields of its own, so this
        // is not hypothetical for the one export that must be proxied.
        class FakeGame {
            #secret = 'hidden';
            static #counter = 0;
            reveal() { return this.#secret; }
            bump() { return ++FakeGame.#counter; }
        }
        globalThis.game = new FakeGame();

        const shim = await importShim(nonce++);

        expect(() => shim.game.reveal()).not.toThrow();
        expect(shim.game.reveal()).toBe('hidden');
        expect(shim.game.bump()).toBe(1);
    });

    it('should hand back a class untouched rather than binding away its statics', async () => {
        // A bound function loses the original's own static properties, so the trap
        // must not bind a constructor it finds hanging off a proxied global.
        class Widget { static make() { return 'made'; } }
        globalThis.game = { Widget };

        const shim = await importShim(nonce++);

        expect(shim.game.Widget).toBe(Widget);
        expect(shim.game.Widget.make()).toBe('made');
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

    it('should hand back the real Hooks object, not a Proxy over it', async () => {
        // Hooks.on reads a private static field, so it MUST be the genuine class —
        // this is the regression that a blanket "late-bind everything" caused:
        //
        //   TypeError: Cannot read private member #id from an object whose class
        //   did not declare it
        //     at Proxy.on
        //
        // Hooks is fully defined before Foundry loads a system's esmodules (index.js
        // registers its own init hook at module scope), so an eager capture is both
        // correct and the only safe option.
        class FakeHooks {
            static #id = 0;
            static on() { return ++FakeHooks.#id; }
        }
        globalThis.Hooks = FakeHooks;

        const shim = await importShim(nonce++);

        expect(shim.Hooks).toBe(FakeHooks);
        expect(() => shim.Hooks.on()).not.toThrow();
    });

    it('should hand back the real ChatMessage object, not a Proxy over it', async () => {
        // Same reasoning as Hooks: ChatMessage.create and getSpeaker are called
        // directly on it, and it is ready long before esmodules load.
        class FakeChatMessage {
            static #seq = 0;
            static create() { return ++FakeChatMessage.#seq; }
        }
        globalThis.ChatMessage = FakeChatMessage;

        const shim = await importShim(nonce++);

        expect(shim.ChatMessage).toBe(FakeChatMessage);
        expect(() => shim.ChatMessage.create()).not.toThrow();
    });
});
