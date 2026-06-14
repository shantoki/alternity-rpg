/**
 * @file AlternityCombatant.js
 * @description Custom Combatant class for the Alternity system.
 * Handles the unique phase-based initiative and multi-action turn spawning.
 */

import { Combatant } from '../module-info.js';

export class AlternityCombatant extends Combatant {
    /** @override */
    getInitiativeRoll(formula) {
        console.log('[Alternity] AlternityCombatant.getInitiativeRoll called');
        return new Roll('1d20');
    }

    /** @override */
    async rollInitiative(formula) {
        console.log('[Alternity] AlternityCombatant.rollInitiative called for', this.name);
        
        // If this combatant doesn't have an actor, fall back to default
        if (!this.actor) return super.rollInitiative(formula);

        // Call the Actor's custom roll logic
        const initiative = await this.actor.rollInitiative();
        
        // Update this combatant's initiative
        return this.update({ initiative });
    }
}
