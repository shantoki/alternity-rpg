/**
 * @file alternity-item-sheet.js
 * @description Item sheet for Alternity Fastplay.
 */

const NS = 'alt';

// Default row shapes for the effect item's array fields, keyed by field name
// (mirrors the generic add/delete-row pattern used by AlternityWarshipSheet).
const EFFECT_ARRAY_DEFAULTS = Object.freeze({
    effects:        { effectType: 'Modifier', value: 0, damageType: null, stat: '', duration: 'instant', notes: '' },
    requiredChecks: { checkType: 'resource', params: {}, failMessage: '' },
});

export class AlternityItemSheet extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sheets.ItemSheetV2) {
    /** @override */
    static get DEFAULT_OPTIONS() {
        return foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
            classes: [NS, `${NS}-item-sheet`],
            tag: "form",
            window: {
                resizable: true,
                width: 500,
                height: 600
            },
            actions: {
                switchTab:     this._onTabAction,
                addArrayRow:   this._onAddArrayRowAction,
                deleteArrayRow: this._onDeleteArrayRowAction,
            }
        });
    }

    /** @override */
    static PARTS = {
        sheet: {
            template: "systems/alternity-v2/templates/item/item-sheet.hbs"
        }
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
        context.alt = NS;
        context.system = this.item.system;
        context.activeTab = this._activeTab || 'description';

        // Provide configuration choices for selects
        context.config = {
            weaponTypes: {
                'Melee': 'Melee',
                'Ranged': 'Ranged',
                'Thrown': 'Thrown',
                'Heavy': 'Heavy'
            },
            damageTypes: [
                'Ballistic', 'Energy', 'Laser', 'Piercing', 'Slashing',
                'Impact', 'Incendiary', 'Toxic', 'Radiation', 'Psionic',
            ].reduce((obj, val) => { obj[val] = val; return obj; }, {}),
            perkFlawCategories: { Perk: 'Perk', Flaw: 'Flaw' },
            perkFlawAbilities: ['STR', 'DEX', 'CON', 'INT', 'WIL', 'PER', 'Special', 'None']
                .reduce((obj, val) => { obj[val] = val; return obj; }, {}),
            perkFlawActivationTypes: { Active: 'Active', Conscious: 'Conscious' },
            personalEquipmentCategories: [
                'Communications', 'Medical', 'Professional', 'Sensors', 'Survival', 'Clothing', 'Miscellaneous',
            ].reduce((obj, val) => { obj[val] = val; return obj; }, {}),
            abilities: ['STR', 'DEX', 'CON', 'INT', 'WIL', 'PER']
                .reduce((obj, val) => { obj[val] = val; return obj; }, {}),
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

    /** @override */
    _onRender(context, options) {
        // Tab switching is handled by the switchTab action (see DEFAULT_OPTIONS.actions).
    }
}
