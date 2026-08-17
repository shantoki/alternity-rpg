/**
 * @fileoverview Shim for Foundry VTT globals.
 *
 * Foundry globals do not exist under Node, so every module that touches one
 * imports it from here and tests substitute `tests/mocks/module-info.js` via the
 * `moduleNameMapper` in jest.config.js.
 *
 * ## Why most of this is late-bound
 *
 * Foundry loads a system's `esmodules` while it is still booting. At that moment
 * `globalThis.game` exists but is a bare shell — `game.i18n` in particular is not
 * populated until `Localization.initialize()` runs, much later.
 *
 * So `export const game = globalThis.game` captures the shell **permanently**.
 * Every later read of `game.i18n` then returns undefined, and the first call
 * through it dies with "Cannot read properties of undefined (reading 'localize')".
 * That is exactly what happened to the damage button on the attack chat card: the
 * sheets had always worked because they happen to use the bare `game` global
 * rather than importing it, so the bug stayed hidden until a service imported
 * `game` from here and tried to localize something.
 *
 * Everything that is only ever used as a namespace (`game.i18n`,
 * `ChatMessage.create`, `Hooks.on`) is therefore resolved at *use* time.
 *
 * ## Why a few things cannot be
 *
 * `Actor`, `Item` and `Combatant` appear in class heritage
 * (`class AlternityActor extends Actor`), which JavaScript evaluates when the
 * module is imported. A Proxy cannot stand in for a base class, so these stay
 * eager — which is safe, because Foundry defines its document classes before it
 * loads a system's esmodules. If one of them ever comes back undefined, the fix is
 * load order, not this file.
 */

/**
 * Forward every property read to the named global, at read time rather than at
 * import time.
 *
 * @param {string} name - Key on globalThis to read through to.
 * @returns {Proxy}
 */
function lateBound(name) {
    return new Proxy({}, {
        get: (_target, prop) => globalThis[name]?.[prop],
        set: (_target, prop, value) => {
            (globalThis[name] ??= {})[prop] = value;
            return true;
        },
        has: (_target, prop) => prop in (globalThis[name] ?? {}),
        ownKeys: () => Reflect.ownKeys(globalThis[name] ?? {}),
        getOwnPropertyDescriptor: (_target, prop) => {
            const descriptor = Reflect.getOwnPropertyDescriptor(globalThis[name] ?? {}, prop);
            // A Proxy may not report a property as non-configurable when its own
            // target does not have it, so the descriptor is relaxed on the way out.
            return descriptor ? { ...descriptor, configurable: true } : undefined;
        },
    });
}

// ── Eager: used in class heritage, so they must be real at import time ──────
export const Actor = globalThis.Actor;
export const Combatant = globalThis.Combatant;
export const Combat = globalThis.Combat;

// ── Late-bound namespaces ───────────────────────────────────────────────────
export const game = lateBound('game');
export const ChatMessage = lateBound('ChatMessage');
export const Hooks = lateBound('Hooks');
export const CONFIG = lateBound('CONFIG');
export const ui = lateBound('ui');

/**
 * Delegating constructor, so `new Roll(...)` builds whatever `globalThis.Roll` is
 * at the moment of the call. Foundry does define Roll before esmodules load, but
 * routing it through here costs nothing and removes the whole class of bug.
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

// ── Sheet / collection accessors ────────────────────────────────────────────
// Resolved through getters because their Foundry v13+ namespaces (and the v12
// fallbacks) are not all populated at the same point in the boot sequence.
export const ActorSheet = globalThis.foundry?.appv1?.sheets?.ActorSheet || globalThis.ActorSheet;
export const ActorSheetV2 = globalThis.foundry?.applications?.sheets?.ActorSheetV2
    || globalThis.foundry?.applications?.api?.ApplicationV2;
export const Actors = globalThis.foundry?.documents?.collections?.Actors || globalThis.Actors;

export const Element = globalThis.Element || class {};
export const DOMPack = globalThis.DOMPack || {};

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
