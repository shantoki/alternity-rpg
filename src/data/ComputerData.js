/**
 * @file ComputerData.js
 * @description TypeDataModel: Schema for the 'computer' Item type.
 */

import { progressLevelField, costField, availabilityField } from './item-acquisition.js';

const { fields } = foundry.data;

export class ComputerData extends foundry.abstract.TypeDataModel {
    /** @override */
    static defineSchema() {
        return {
            mass: new fields.NumberField({ initial: 0, min: 0 }),
            processorQuality: new fields.StringField({ initial: '' }),
            activeMemory: new fields.NumberField({ initial: 0, min: 0 }),
            activeStorage: new fields.NumberField({ initial: 0, min: 0 }),
            programs: new fields.HTMLField({ initial: '' }),

            // What the gear tables print alongside the specification, shared with the
            // weapon, armour and equipment schemas so one availability list serves all
            // of them.
            progressLevel: progressLevelField(),
            cost: costField(),
            availability: availabilityField(),

            // Every other item type defines this and the shared sheet's Description tab
            // binds to it — without it, anything typed there was silently discarded.
            description: new fields.HTMLField({ required: false, initial: '' }),
        };
    }
}
