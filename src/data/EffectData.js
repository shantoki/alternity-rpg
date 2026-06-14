/**
 * @file EffectData.js
 * @description Step 7 — TypeDataModel: Schema for the 'effect' Item type.
 *
 * Effect items are the Foundry-native equivalent of SystemEffectItem
 * (alternity-item-template.js). They serve as reusable templates for special
 * abilities, psionic powers, and equipment activations.
 *
 * Relationship to SystemEffectItem:
 *   SystemEffectItem is still used by the hook layer (stored as a flag) for
 *   its validateRequirements() logic. EffectData is the *Foundry schema* for
 *   how effect items appear in actors' Items collections and compendium packs.
 *   The two are kept in sync — EffectData stores the same logical fields as
 *   SystemEffectItem's serialised form.
 *
 * Key fields:
 *   - effectCategory : Power | Stance | Passive | Equipment
 *   - targetScope    : Self | Single | Area | AllAllies | AllEnemies
 *   - isReusable     : True = template (multi-use); False = single-use consumable
 *   - effects[]      : Array of effect entries (type, value, damageType, duration)
 *   - requiredChecks[]: Array of prerequisite gates (resource, condition, skill)
 *   - activation     : How the effect is triggered (action type)
 *   - techPointCost  : TP cost to activate
 *   - psiPointCost   : PP cost to activate
 */

const { fields } = foundry.data;

// ---------------------------------------------------------------------------
// Sub-schemas for effects[] and requiredChecks[] entries
// ---------------------------------------------------------------------------

/**
 * Schema for a single effect entry in the effects[] array.
 * Mirrors AlternityEffect's serialised shape.
 */
class EffectEntryModel extends foundry.abstract.DataModel {
    static defineSchema() {
        return {
            effectType: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'Modifier',
                choices:  ['Damage', 'Buff', 'Modifier'],
            }),
            value: new fields.NumberField({
                required: true,
                nullable: false,
                initial:  0,
            }),
            damageType: new fields.StringField({
                required: false,
                nullable: true,
                initial:  null,
                choices:  [
                    null, 'Ballistic', 'Energy', 'Laser', 'Piercing', 'Slashing',
                    'Impact', 'Incendiary', 'Toxic', 'Radiation', 'Psionic',
                ],
            }),
            stat: new fields.StringField({
                required: false,
                initial:  '',
            }),
            duration: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'instant',
                choices:  ['instant', 'round', 'scene', 'permanent'],
            }),
            notes: new fields.StringField({
                required: false,
                initial:  '',
            }),
        };
    }
}

/**
 * Schema for a single prerequisite check in the requiredChecks[] array.
 * Mirrors RequiredCheck's serialised shape.
 */
class RequiredCheckModel extends foundry.abstract.DataModel {
    static defineSchema() {
        return {
            checkType: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'resource',
                choices:  ['resource', 'condition', 'skill'],
            }),
            // params is a free-form JSON object — stored as an ObjectField
            // because its keys vary by checkType.
            params: new fields.ObjectField({
                required: true,
                initial:  {},
            }),
            failMessage: new fields.StringField({
                required: false,
                initial:  '',
            }),
        };
    }
}

// ---------------------------------------------------------------------------
// EffectData
// ---------------------------------------------------------------------------

export class EffectData extends foundry.abstract.TypeDataModel {

    /** @override */
    static defineSchema() {
        return {
            // ── Classification ───────────────────────────────────────────
            effectCategory: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'Passive',
                choices:  ['Power', 'Stance', 'Passive', 'Equipment', 'Action'],
            }),

            targetScope: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'Self',
                choices:  ['Self', 'Single', 'Area', 'AllAllies', 'AllEnemies'],
            }),

            isReusable: new fields.BooleanField({
                required: true,
                initial:  true,
            }),

            // ── Activation ───────────────────────────────────────────────
            activation: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'action',
                choices:  ['free', 'minor', 'action', 'reaction', 'passive'],
            }),

            // ── Resource costs ───────────────────────────────────────────
            techPointCost: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  0,
                min:      0,
            }),

            psiPointCost: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  0,
                min:      0,
            }),

            // ── Effect entries ───────────────────────────────────────────
            effects: new fields.ArrayField(
                new fields.EmbeddedDataField(EffectEntryModel),
                { required: true, initial: [] }
            ),

            // ── Prerequisite gates ───────────────────────────────────────
            requiredChecks: new fields.ArrayField(
                new fields.EmbeddedDataField(RequiredCheckModel),
                { required: true, initial: [] }
            ),

            // ── Trigger condition (for Stances and context-gated effects) ─
            triggerContext: new fields.StringField({
                required: false,
                initial:  '',
                // e.g. 'Combat', 'Stealth', 'Any', '' (always active)
            }),

            // ── Flavour / rules text ─────────────────────────────────────
            description: new fields.HTMLField({
                required: false,
                initial:  '',
            }),
        };
    }

    /** @override */
    prepareDerivedData() {
        // Derived: does this effect cost any resources?
        this.hasCost = this.techPointCost > 0 || this.psiPointCost > 0;

        // Derived: does this effect deal damage?
        this.dealsDamage = this.effects.some(e => e.effectType === 'Damage');

        // Derived: is this a context-gated stance?
        this.isStance    = this.effectCategory === 'Stance';
        this.isPassive   = this.effectCategory === 'Passive' && this.activation === 'passive';

        // Derived: total modifier value (for quick-display on the sheet)
        this.netModifier = this.effects
            .filter(e => e.effectType === 'Modifier' || e.effectType === 'Buff')
            .reduce((sum, e) => sum + (e.value || 0), 0);
    }

    /** @override */
    static migrateData(source) {
        // v0.1: effectType stored at top level → moved to effects[0].effectType
        if (source.effectType && !source.effects?.length) {
            source.effects = [{
                effectType: source.effectType,
                value:      source.value ?? 0,
                damageType: source.damageType ?? null,
                duration:   source.duration ?? 'instant',
                notes:      '',
            }];
            delete source.effectType;
            delete source.value;
            delete source.damageType;
            delete source.duration;
        }
        return super.migrateData(source);
    }
}
