/**
 * @file ComputerData.js
 * @description TypeDataModel: Schema for the 'computer' Item type.
 */

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
        };
    }
}
