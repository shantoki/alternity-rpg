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
