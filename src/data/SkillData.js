/**
 * @file SkillData.js
 * @description Step 7 — TypeDataModel: Schema for the 'skill' Item type.
 *
 * Skill items represent individual skills owned by an actor (carried in their
 * Items collection). They mirror the SKILL_DEFINITIONS entries from
 * alternity-actor-data.js but live as discrete Item documents so they can be
 * dragged, dropped, and shared via compendium packs.
 *
 * Target number formula:  effectiveRank + abilityModifier + 10
 *   effectiveRank = rank (background skill: floor(rank / 2))
 *
 * Key fields:
 *   - skillId        : Matches id in SKILL_DEFINITIONS (e.g. 'dex-ranged')
 *   - linkedAbility  : One of STR|DEX|CON|INT|WIL|PER
 *   - rank           : Current rank 0–10
 *   - isBackground   : True if the character learned this as a background skill
 *   - specialisation : Optional free-text specialisation within the skill
 *   - targetNumber   : Derived — the DC to roll under for this skill
 */

const { fields } = foundry.data;

export class SkillData extends foundry.abstract.TypeDataModel {

    /** @override */
    static defineSchema() {
        return {
            // ── Skill identity ───────────────────────────────────────────
            // Must match an id in SKILL_DEFINITIONS for the math service to
            // resolve the correct linked ability modifier.
            skillId: new fields.StringField({
                required: true,
                nullable: false,
                initial:  '',
            }),

            linkedAbility: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'STR',
                choices:  ['STR', 'DEX', 'CON', 'INT', 'WIL', 'PER'],
            }),

            // ── Rank ─────────────────────────────────────────────────────
            rank: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  0,
                min:      0,
                max:      10,
            }),

            isBackground: new fields.BooleanField({
                required: true,
                initial:  false,
            }),

            // ── Specialisation ───────────────────────────────────────────
            // Optional narrow focus within the skill (e.g. "Pistols" under Ranged Combat).
            // Specialisations grant +2 to rolls within the specialty.
            specialisation: new fields.StringField({
                required: false,
                initial:  '',
            }),

            specialisationBonus: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  2,   // standard specialisation bonus
                min:      0,
                max:      5,
            }),

            // ── Cached derived values (updated by prepareDerivedData) ────
            // These are NOT stored — they are recomputed each load so the sheet
            // can read them without running the full math service.
            // They depend on the owning actor's ability scores.
            effectiveRank: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  0,
            }),

            targetNumber: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  10,  // floor: 0 rank + 0 ability + 10
            }),

            // ── Flavour ──────────────────────────────────────────────────
            description: new fields.HTMLField({
                required: false,
                initial:  '',
            }),
        };
    }

    /** @override */
    prepareDerivedData() {
        // Effective rank: background skills count at half rank (floor)
        this.effectiveRank = this.isBackground
            ? Math.floor(this.rank / 2)
            : this.rank;

        // Target number: effectiveRank + ability modifier (from owning actor) + 10
        // The owning actor's ability modifier is resolved here if the parent is set.
        const actor         = this.parent?.actor ?? this.parent;
        const abilityKey    = this.linkedAbility?.toLowerCase();
        const abilityMod    = actor?.system?.abilities?.[abilityKey] ?? 0;

        this.targetNumber = this.effectiveRank + abilityMod + 10;

        // Include specialisation bonus in a separate display field
        this.targetNumberWithSpec = this.specialisation
            ? this.targetNumber + this.specialisationBonus
            : this.targetNumber;
    }

    /** @override */
    static migrateData(source) {
        // v0.1: ability stored as full word (e.g. 'Dexterity') → abbreviation ('DEX')
        const abilityMap = {
            Strength: 'STR', Dexterity: 'DEX', Constitution: 'CON',
            Intelligence: 'INT', Willpower: 'WIL', Perception: 'PER',
        };
        if (source.linkedAbility && abilityMap[source.linkedAbility]) {
            source.linkedAbility = abilityMap[source.linkedAbility];
        }
        return super.migrateData(source);
    }
}
