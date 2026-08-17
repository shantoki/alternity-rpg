/**
 * @fileoverview Shim for Foundry VTT globals.
 * Provides ESM exports for standard Foundry classes and hooks.
 */

export const Hooks = globalThis.Hooks;
export const Actor = globalThis.Actor;
export const ActorSheet = globalThis.foundry?.appv1?.sheets?.ActorSheet || globalThis.ActorSheet;
export const ActorSheetV2 = globalThis.foundry?.applications?.sheets?.ActorSheetV2 || globalThis.foundry?.applications?.api?.ApplicationV2;
export const Actors = globalThis.foundry?.documents?.collections?.Actors || globalThis.Actors;
export const Combatant = globalThis.Combatant;
export const Combat = globalThis.Combat;
export const ChatMessage = globalThis.ChatMessage;
export const Roll = globalThis.Roll;
export const Dialog = globalThis.Dialog;
export const game = globalThis.game;
export const Element = globalThis.Element || class {};
export const DOMPack = globalThis.DOMPack || {};
export const renderTemplate = (...args) => {
    const fn = globalThis.foundry?.applications?.handlebars?.renderTemplate || globalThis.renderTemplate;
    return fn(...args);
};

/**
 * Wrapped rather than re-exported as a const, for the same reason renderTemplate
 * is: the global is resolved at call time, so this still works for modules that
 * are imported before Foundry has finished populating its globals.
 */
export const fromUuid = (...args) => {
    const fn = globalThis.foundry?.utils?.fromUuid || globalThis.fromUuid;
    return fn(...args);
};

