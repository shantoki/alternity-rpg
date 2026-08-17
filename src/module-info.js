/**
 * @fileoverview Shim for Foundry VTT globals.
 *
 * Foundry globals do not exist under Node, so every module that touches one
 * imports it from here and tests substitute `tests/mocks/module-info.js` via the
 * `moduleNameMapper` in jest.config.js.
 *
 * ## Why `game` is late-bound and almost nothing else is
 *
 * Foundry loads a system's `esmodules` while it is still booting. At that moment
 * `globalThis.game` exists but is a bare shell — `game.i18n` in particular is not
 * populated until `Localization.initialize()` runs, much later.
 *
 * So `export const game = globalThis.game` captures the shell **permanently**.
 * Every later read of `game.i18n` then returns undefined, and the first call
 * through it dies with "Cannot read properties of undefined (reading 'localize')".
 *
 * `game` is the only global with that problem. Every other one this file exports is
 * fully defined before esmodules load — which is why `src/index.js` can call
 * `Hooks.once('init', ...)` at module scope, and why chat messages have always
 * posted. They stay eager, deliberately; see the warning below.
 *
 * ## Why a Proxy is the wrong tool for most of them
 *
 * A Proxy makes `this` inside a method the *Proxy*, not the real object. Foundry's
 * classes use private fields, and a private-field lookup throws outright when the
 * receiver is not the declaring class:
 *
 *   Hooks.on(...)  ->  TypeError: Cannot read private member #id from an object
 *                      whose class did not declare it
 *
 * The `get` trap below therefore binds methods to the real object. Binding is not
 * free either — a bound function loses the original's own static properties — so
 * the trap leaves class constructors alone, and the Proxy is reserved for globals
 * that are read as property bags rather than called as objects.
 *
 * **Only add a symbol to `lateBound` if it genuinely is not ready at import time,
 * and only if it is read rather than called.** `Actor`, `Item` and `Combatant`
 * additionally *cannot* be proxied at all: they appear in class heritage
 * (`class AlternityActor extends Actor`), which JavaScript evaluates when the module
 * is imported, and a Proxy cannot serve as a base class.
 */

/** True for `class X {}`, false for `function f() {}` or a method. */
function isClass(value) {
    return typeof value === 'function'
        && /^class[\s{]/.test(Function.prototype.toString.call(value));
}

/**
 * Forward property reads to the named global at read time rather than at import
 * time, binding any method to the real object so private-field access works.
 *
 * @param {string} name - Key on globalThis to read through to.
 * @returns {Proxy}
 */
function lateBound(name) {
    return new Proxy({}, {
        get: (_target, prop) => {
            const source = globalThis[name];
            if (source === undefined || source === null) return undefined;
            const value = source[prop];
            // Methods are bound so `this` is the real object; classes are handed
            // back untouched, because binding one would strip its statics.
            return (typeof value === 'function' && !isClass(value))
                ? value.bind(source)
                : value;
        },
        set: (_target, prop, value) => {
            (globalThis[name] ??= {})[prop] = value;
            return true;
        },
        has: (_target, prop) => prop in (globalThis[name] ?? {}),
        ownKeys: () => Reflect.ownKeys(globalThis[name] ?? {}),
        getOwnPropertyDescriptor: (_target, prop) => {
            const descriptor = Reflect.getOwnPropertyDescriptor(globalThis[name] ?? {}, prop);
            // A Proxy may not report a property as non-configurable when its own
            // target lacks it, so the descriptor is relaxed on the way out.
            return descriptor ? { ...descriptor, configurable: true } : undefined;
        },
    });
}

// ── The one global that is not ready when esmodules load ────────────────────
export const game = lateBound('game');

/**
 * `ui` is populated during the same boot phase as `game`, so it is read through
 * rather than captured. Safe as a Proxy because it is only ever used as a property
 * bag: in `ui.notifications.warn(...)` the method belongs to `notifications`, which
 * the trap hands back as the real object.
 */
export const ui = lateBound('ui');

// ── Eager: fully defined before esmodules load ──────────────────────────────
// Actor / Combatant / Combat are additionally *required* to be real classes here,
// because they are extended at import time.
export const Actor = globalThis.Actor;
export const Combatant = globalThis.Combatant;
export const Combat = globalThis.Combat;
export const Hooks = globalThis.Hooks;
export const ChatMessage = globalThis.ChatMessage;
export const CONFIG = globalThis.CONFIG;

export const ActorSheet = globalThis.foundry?.appv1?.sheets?.ActorSheet || globalThis.ActorSheet;
export const ActorSheetV2 = globalThis.foundry?.applications?.sheets?.ActorSheetV2
    || globalThis.foundry?.applications?.api?.ApplicationV2;
export const Actors = globalThis.foundry?.documents?.collections?.Actors || globalThis.Actors;

export const Element = globalThis.Element || class {};
export const DOMPack = globalThis.DOMPack || {};

/**
 * Delegating constructors rather than captures, so `new Roll(...)` builds whatever
 * the global is at the moment of the call. No `this` hazard here: construction
 * returns a real instance, and every later read is against that instance rather
 * than against this class.
 */
export class Roll {
    constructor(...args) {
        return new globalThis.Roll(...args);
    }
}

export class Dialog {
    constructor(...args) {
        return new globalThis.Dialog(...args);
    }
}

// ── Functions: resolved per call ────────────────────────────────────────────
export const renderTemplate = (...args) => {
    const fn = globalThis.foundry?.applications?.handlebars?.renderTemplate
        || globalThis.renderTemplate;
    return fn(...args);
};

export const fromUuid = (...args) => {
    const fn = globalThis.foundry?.utils?.fromUuid || globalThis.fromUuid;
    return fn(...args);
};

/**
 * Relative sort-value solver, used when an item is dragged to a new position in a
 * list. The v12 global alias is kept as a fallback for the same reason the two
 * above have one.
 */
export const performIntegerSort = (...args) => {
    const fn = globalThis.foundry?.utils?.performIntegerSort
        || globalThis.SortingHelpers?.performIntegerSort;
    return fn(...args);
};
