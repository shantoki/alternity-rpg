/**
 * @file alternity-item-sheet.js
 * @description Shared item sheet for every Alternity Fastplay item type.
 */

const NS = 'alt';

// Default row shapes for the effect item's array fields, keyed by field name
// (mirrors the generic add/delete-row pattern used by AlternityWarshipSheet).
const EFFECT_ARRAY_DEFAULTS = Object.freeze({
    effects:        { effectType: 'Modifier', value: 0, damageType: null, stat: '', duration: 'instant', notes: '' },
    requiredChecks: { checkType: 'resource', params: {}, failMessage: '' },
});

export class AlternityItemSheet extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sheets.ItemSheetV2) {
    /**
     * A plain static field, not a getter calling `mergeObject(super.DEFAULT_OPTIONS, …)`:
     * ApplicationV2 already walks the prototype chain and merges each class's own
     * DEFAULT_OPTIONS. The old getter merged *in place*, mutating the shared base-class
     * static and leaking these classes onto every other ItemSheetV2 in the world.
     */
    static DEFAULT_OPTIONS = {
        classes: [NS, `${NS}-item-sheet`],
        tag: 'form',
        // Foundry's own form controller owns the <form>'s submit/Enter-key handling and
        // writes the submitted form back onto the document. `submitOnChange` makes it fire
        // on every field change too, so this sheet needs no hand-wired 'change' listener
        // and no manual submit/keydown guards.
        form: {
            submitOnChange: true,
            closeOnSubmit:  false,
        },
        // width/height belong under `position`; under `window` they were silently ignored.
        position: { width: 560, height: 620 },
        window:   { resizable: true },
        actions: {
            switchTab:      this._onTabAction,
            addArrayRow:    this._onAddArrayRowAction,
            deleteArrayRow: this._onDeleteArrayRowAction,
        },
    };

    /** @override */
    static PARTS = {
        sheet: {
            template: 'systems/alternity-v2/templates/item/item-sheet.hbs',
        },
    };

    static _onTabAction(event, target) {
        this._activeTab = target.dataset.tab;
        this.render();
    }

    static async _onAddArrayRowAction(event, target) {
        const arrayKey = target.dataset.array;
        const defaults = EFFECT_ARRAY_DEFAULTS[arrayKey];
        if (!defaults) return;
        const current = foundry.utils.getProperty(this.item.system, arrayKey) ?? [];
        await this.item.update({ [`system.${arrayKey}`]: [...current, { ...defaults }] });
    }

    static async _onDeleteArrayRowAction(event, target) {
        const arrayKey = target.dataset.array;
        const idx = Number(target.dataset.index);
        if (!Number.isInteger(idx) || idx < 0) return;
        const current = foundry.utils.getProperty(this.item.system, arrayKey) ?? [];
        await this.item.update({ [`system.${arrayKey}`]: current.filter((_, i) => i !== idx) });
    }

    /** @override */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const item = this.item;

        context.alt = NS;
        // `item` was previously never put on the context — the header's {{item.name}} and
        // every `{{#if (eq item.type '…')}}` Details branch silently resolved against
        // undefined, which is why the sheet showed a blank name and an empty Details tab.
        // Every actor sheet in this system sets its own `context.actor` the same way.
        // That empty Details tab was also the reason Enter used to navigate the browser:
        // it left the form with exactly one text input, which is the only case where a
        // submit-button-less form submits implicitly. See the note in item-sheet.hbs.
        context.item     = item;
        context.system   = item.system;
        context.itemType = item.type;
        // Precomputed rather than built in-template: no `concat` Handlebars helper exists
        // in this codebase, so `{{localize (concat 'TYPES.Item.' itemType)}}` would silently
        // render nothing.
        context.typeLabel = game.i18n.localize(`TYPES.Item.${item.type}`);
        context.owner    = item.isOwner;
        context.editable = this.isEditable;
        // Schema fields for {{formInput}} (used for the rich-text description).
        context.systemFields = item.system?.schema?.fields ?? {};
        context.activeTab    = this._activeTab || 'description';

        // NOTE: the template deliberately branches on `document.type` (supplied by
        // DocumentSheetV2._prepareContext) rather than on per-type flags added here.
        // Binding the type branches to framework-provided context means a problem in this
        // method can't blank out the entire Details tab — which is exactly what happened
        // when `context.item` was missing and every `(eq item.type '…')` test saw undefined.

        // Provide configuration choices for selects
        context.config = {
            weaponTypes: {
                'Melee': 'Melee',
                'Ranged': 'Ranged',
                'Thrown': 'Thrown',
                'Heavy': 'Heavy'
            },
            armorTypes: ['Light', 'Medium', 'Heavy', 'Powered']
                .reduce((obj, val) => { obj[val] = val; return obj; }, {}),
            damageTypes: [
                'Ballistic', 'Energy', 'Laser', 'Piercing', 'Slashing',
                'Impact', 'Incendiary', 'Toxic', 'Radiation', 'Psionic',
            ].reduce((obj, val) => { obj[val] = val; return obj; }, {}),
            // NOTE: damageCategory and attackAbility deliberately have no entry here —
            // the template renders those two selects with inline <option> markup so it
            // does not depend on config keys introduced in the same change as the markup.
            perkFlawCategories: { Perk: 'Perk', Flaw: 'Flaw' },
            perkFlawAbilities: ['STR', 'DEX', 'CON', 'INT', 'WIL', 'PER', 'Special', 'None']
                .reduce((obj, val) => { obj[val] = val; return obj; }, {}),
            perkFlawActivationTypes: { Active: 'Active', Conscious: 'Conscious' },
            personalEquipmentCategories: [
                'Communications', 'Medical', 'Professional', 'Sensors', 'Survival', 'Clothing', 'Miscellaneous',
            ].reduce((obj, val) => { obj[val] = val; return obj; }, {}),
            abilities: ['STR', 'DEX', 'CON', 'INT', 'WIL', 'PER']
                .reduce((obj, val) => { obj[val] = val; return obj; }, {}),
            // NOTE: the cybertech Details tab deliberately has no config entry here.
            // Its selects render inline <option> markup mirroring CybertechData's own
            // schema choices, so the template can't depend on a config key arriving in
            // the same deploy — `selectOptions` throws on an undefined choices object,
            // which would abort the render of the whole shared sheet, for every type.
            effectCategories: ['Power', 'Stance', 'Passive', 'Equipment', 'Action']
                .reduce((obj, val) => { obj[val] = val; return obj; }, {}),
            effectTargetScopes: ['Self', 'Single', 'Area', 'AllAllies', 'AllEnemies']
                .reduce((obj, val) => { obj[val] = val; return obj; }, {}),
            effectActivations: {
                free:     game.i18n.localize('ALTERNITY.Activation.Free'),
                minor:    game.i18n.localize('ALTERNITY.Activation.Minor'),
                action:   game.i18n.localize('ALTERNITY.Activation.Action'),
                reaction: game.i18n.localize('ALTERNITY.Activation.Reaction'),
                passive:  game.i18n.localize('ALTERNITY.Activation.Passive'),
            },
            effectEntryTypes: ['Damage', 'Buff', 'Modifier'],
            effectDurations: ['instant', 'round', 'scene', 'permanent'],
            checkTypes: ['resource', 'condition', 'skill'],
            skills: {} // To be populated if needed
        };

        // Populate skills from SKILL_DEFINITIONS if possible
        try {
            const { SKILL_DEFINITIONS } = await import('../data/alternity-actor-data.js');
            context.config.skills = SKILL_DEFINITIONS.reduce((obj, skill) => {
                obj[skill.id] = skill.name;
                return obj;
            }, {});
        } catch (e) {
            console.error('[Alternity] Failed to load skill definitions for item sheet:', e);
        }

        return context;
    }
}
