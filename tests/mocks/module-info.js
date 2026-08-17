/**
 * @file module-info.js (test mock)
 * @description Substituted for src/module-info.js by the `moduleNameMapper` in
 * jest.config.js.
 *
 * Everything here resolves against `globalThis` **lazily**, which is the whole
 * point: the real shim captures globals at import time, but under Jest the
 * harness (tests/mocks/roll-harness.js) installs them after the modules under test
 * have already been imported. A plain `export const Roll = globalThis.Roll` would
 * therefore capture `undefined` forever.
 *
 * So each export below is either a delegating constructor, a function, or a Proxy
 * that reads through to the global at the moment it is used.
 */

/**
 * Forward every property read to the named global, at read time — mirroring the
 * production shim, including the method binding. That binding matters even here:
 * without it, `this` inside a method is the Proxy, and a Foundry class that reads a
 * private field throws ("Cannot read private member #id from an object whose class
 * did not declare it"). Keeping the two in step means a test exercises the same
 * semantics production does.
 */
function isClass(value) {
    return typeof value === 'function'
        && /^class[\s{]/.test(Function.prototype.toString.call(value));
}

function lateBound(name) {
    return new Proxy({}, {
        get: (_t, prop) => {
            const source = globalThis[name];
            if (source === undefined || source === null) return undefined;
            const value = source[prop];
            return (typeof value === 'function' && !isClass(value))
                ? value.bind(source)
                : value;
        },
        set: (_t, prop, value) => {
            (globalThis[name] ??= {})[prop] = value;
            return true;
        },
        has: (_t, prop) => prop in (globalThis[name] ?? {}),
    });
}

export class Actor {}
export class Combatant {}
export class Combat {}
export class Dialog {}
export const Actors = lateBound('Actors');
export const ActorSheet = class {};
export const ActorSheetV2 = class {};
export const Element = globalThis.Element || class {};
export const DOMPack = {};

/**
 * Delegating constructor: `new Roll(f)` builds whatever the harness installed as
 * `globalThis.Roll` at the moment of the call.
 */
export class Roll {
    constructor(...args) {
        return new globalThis.Roll(...args);
    }
}

export const ChatMessage = lateBound('ChatMessage');
export const game = lateBound('game');
export const ui = lateBound('ui');

export const renderTemplate = (...args) => {
    const fn = globalThis.foundry?.applications?.handlebars?.renderTemplate
        || globalThis.renderTemplate;
    return fn(...args);
};

export const fromUuid = (...args) => {
    const fn = globalThis.foundry?.utils?.fromUuid || globalThis.fromUuid;
    return fn(...args);
};

export const performIntegerSort = (...args) => {
    const fn = globalThis.foundry?.utils?.performIntegerSort
        || globalThis.SortingHelpers?.performIntegerSort;
    return fn(...args);
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * A working Hooks implementation rather than a pair of no-ops.
 *
 * The roll pipeline uses hooks for real — `alternity:preRollCheck` can veto a
 * check by returning false, and `alternity:rollCheck` is how a module observes a
 * result — so a no-op mock would let a broken veto pass its tests.
 */
const listeners = new Map();

export const Hooks = {
    on(event, fn) {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event).push(fn);
        return fn;
    },
    once(event, fn) {
        const wrapped = (...args) => {
            Hooks.off(event, wrapped);
            return fn(...args);
        };
        return Hooks.on(event, wrapped);
    },
    off(event, fn) {
        const list = listeners.get(event);
        if (!list) return;
        const i = list.indexOf(fn);
        if (i >= 0) list.splice(i, 1);
    },
    /** Stops at the first listener that returns false, and reports it — as Foundry does. */
    call(event, ...args) {
        for (const fn of listeners.get(event) ?? []) {
            if (fn(...args) === false) return false;
        }
        return true;
    },
    /** Calls every listener regardless of return value, awaiting any that are async. */
    async callAll(event, ...args) {
        for (const fn of listeners.get(event) ?? []) {
            await fn(...args);
        }
        return true;
    },
    /** Test-only: drop every registered listener between tests. */
    _reset() {
        listeners.clear();
    },
};
