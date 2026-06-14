/**
 * @fileoverview Defines the data structures for various item types in the Alternity system.
 */

import { Item } from "module-info";

/**
 * Base class for all Alternity Items.
 */
export class AlternityItem extends Item {
    /**
     * Prepares item data for rendering and logic.
     */
    prepareData() {
        super.prepareData();
        const itemData = this.system;

        // Common preparation logic (e.g., weight calculation)
    }
}

/**
 * Weapon Item Type
 */
export class AlternityWeapon extends AlternityItem {
    static get schema() {
        return {
            skill: "string",
            acc: "number",
            actions: "number",
            clipSize: "number",
            ammoUsed: "number",
            hide: "string",
            mass: "number",
            damage: {
                ordinary: "string",
                good: "string",
                amazing: "string"
            },
            range: {
                short: "number",
                medium: "number",
                long: "number"
            }
        };
    }
}

/**
 * Armor Item Type
 */
export class AlternityArmor extends AlternityItem {
    static get schema() {
        return {
            li: "number",
            hi: "number",
            en: "number",
            mass: "number",
            speedPenalty: "number"
        };
    }
}

/**
 * Cybertech Item Type
 */
export class AlternityCybertech extends AlternityItem {
    static get schema() {
        return {
            toleranceCost: "number",
            installed: "boolean",
            description: "string"
        };
    }
}

/**
 * Computer Item Type
 */
export class AlternityComputer extends AlternityItem {
    static get schema() {
        return {
            model: "string",
            processorQuality: "string",
            activeMemory: "number",
            activeStorage: "number",
            programs: "array"
        };
    }
}
