/**
 * @file alternity-item-sheet.js
 * @description Item sheet for Alternity Fastplay.
 */

const NS = 'alt';

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
            }
        });
    }

    /** @override */
    static PARTS = {
        sheet: {
            template: "systems/alternity-v2/templates/item/item-sheet.hbs"
        }
    };

    /** @override */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        context.alt = NS;
        context.system = this.item.system;
        
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
        const html = this.element;
        // Standard Foundry tabs initialization if needed
        // (ItemSheetV2 usually handles its own tabs if configured in DEFAULT_OPTIONS)
    }
}
