/**
 * @file ArmorData.js
 * @description TypeDataModel: Schema for the 'armor' Item type.
 *
 * ## Armour in Alternity is damage absorption, not a to-hit number
 *
 * There is no armour class. Armour never makes its wearer harder to hit; it stops
 * points of primary damage after the hit lands, and it is rated **once per damage
 * form** as a die range — the shape every printed suit uses:
 *
 *     Armor: d6-1 (LI), d4 (HI), d4+1 (En)
 *
 * That is what `protection` holds, matching `CybertechData.armorProtection` and
 * `CreatureData.naturalArmor` so all three kinds of protection can be compared and
 * layered against each other. The rating for the form that hit is rolled on every
 * hit (`AlternityRollService.rollArmorProtection`), and only the most favourable
 * roll counts when several protections overlap (PHB Ch.11, "Layering Armor").
 *
 * This replaces the old flat `damageResistance` + `resistedTypes` pair, which could
 * not express a die range at all — so no armour in the system could be entered as
 * the book prints it — and `armorBonus`, a d20 armour-class field that was being
 * added to the wearer's resistance modifier, making heavy armour dodge better. The
 * one thing that *does* legitimately adjust a resistance modifier is field gear
 * (the PL 7 deflection harness, +2 steps; the PL 8 displacer softsuit, +3), so that
 * survives as `resistanceModifierBonus` — a step adjustment the item has to state,
 * not something derived from how thick the armour is.
 *
 * Key fields:
 *   - armorType               : Light | Medium | Heavy | Powered
 *   - protection              : {li, hi, en} die ranges — the actual armour rating
 *   - toughness               : Ordinary | Good | Amazing (GM Guide Ch.11)
 *   - resistanceModifierBonus : step bonus to the wearer's resistance modifier
 *   - speedPenalty            : Feet of movement lost per round
 *   - skillPenalty            : Step penalty to the wearer's checks while worn
 *   - isEquipped              : Whether currently worn
 *   - techPointCost           : TP to activate powered armor per scene
 */

import {
    DAMAGE_TYPES,
    LEGACY_DAMAGE_TYPE_MAP,
    PERSONAL_TOUGHNESS_CLASSES,
    DEFAULT_PERSONAL_TOUGHNESS,
    AlternityMathService,
} from '../services/alternity-math.js';
import { progressLevelField, costField, availabilityField, concealmentField } from './item-acquisition.js';

const { fields } = foundry.data;

/** Damage form -> the `protection` sub-field it is rated in. */
const FORM_TO_PROTECTION_KEY = Object.freeze({ LI: 'li', HI: 'hi', En: 'en' });

export class ArmorData extends foundry.abstract.TypeDataModel {

    /** @override */
    static defineSchema() {
        return {
            // ── Classification ───────────────────────────────────────────
            armorType: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'Light',
                choices:  ['Light', 'Medium', 'Heavy', 'Powered'],
            }),

            // ── Protection ───────────────────────────────────────────────
            /**
             * One die range per damage form, as printed. Free text because the
             * printed values include shapes that are not roll-safe formulas —
             * `d6-1` needs its die count spelled out and a form the suit does not
             * cover is printed as a dash. `AlternityMathService.parseArmorValue`
             * reads them; a blank means "stops nothing of this form".
             */
            protection: new fields.SchemaField({
                li: new fields.StringField({ required: false, initial: '' }),
                hi: new fields.StringField({ required: false, initial: '' }),
                en: new fields.StringField({ required: false, initial: '' }),
            }, { initial: { li: '', hi: '', en: '' } }),

            /**
             * GM Guide Ch.11, "Firepower and Toughness": most personal armour is
             * Ordinary, but "a few types of personal armor (such as powered attack
             * armor and body tanks) have Good toughness" — and a weapon whose
             * firepower falls short of it has its damage degraded a grade before
             * the armour is even rolled. Worn armour confers this on its wearer.
             */
            toughness: new fields.StringField({
                required: true,
                nullable: false,
                initial:  DEFAULT_PERSONAL_TOUGHNESS,
                choices:  PERSONAL_TOUGHNESS_CLASSES,
            }),

            // ── Penalties ────────────────────────────────────────────────
            speedPenalty: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  0,
                min:      0,
                max:      30,
            }),

            // Step penalty applied to the wearer's own checks (Stealth, Acrobatics,
            // and so on). Positive is a penalty, per the convention used throughout.
            skillPenalty: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  0,
                min:      0,
                max:      10,
            }),

            // ── Field effects ────────────────────────────────────────────
            /**
             * Steps added to the wearer's Strength/Dexterity resistance modifier.
             * Ordinary armour does **not** do this — leave it at 0. It exists for
             * the gear that says so in its own entry: "The deflection harness
             * improves the user's applicable resistance modifier (either Strength or
             * Dexterity) by +2 steps" (PL 7), and the displacer softsuit's +3 (PL 8).
             */
            resistanceModifierBonus: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  0,
                min:      0,
                max:      5,
            }),

            // ── Power (powered armor only) ───────────────────────────────
            techPointCost: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  0,
                min:      0,
            }),

            // ── The rest of the armour table's columns ─────────────────
            /**
             * Progress Level, Cost, Availability and Hide. Catalogue facts rather than
             * mechanics — nothing in the damage pipeline reads them — but the armour
             * table prints all four, and a suit that cannot state its own price is one
             * the compendium has to describe in prose instead.
             */
            progressLevel: progressLevelField(),
            cost:          costField(),
            availability:  availabilityField(),
            concealment:   concealmentField(),

            // ── Inventory state ──────────────────────────────────────────
            isEquipped: new fields.BooleanField({
                required: true,
                initial:  false,
            }),

            weight: new fields.NumberField({
                required: true,
                nullable: false,
                initial:  5.0,
                min:      0,
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
        // Derived: whether this armor requires ongoing tech point expenditure
        this.isPowered      = this.armorType === 'Powered';
        this.usesTechPoints = this.techPointCost > 0;

        // Derived: the per-form ratings, parsed once so the sheet can show which of
        // them are actually readable. A rating that cannot be parsed is reported
        // rather than quietly treated as no protection.
        this.parsedProtection = {};
        const printed = [];
        let hasProtection = false;
        let hasUnreadable = false;

        for (const form of DAMAGE_TYPES) {
            const key = FORM_TO_PROTECTION_KEY[form];
            const raw = this.protection?.[key] ?? '';
            const parsed = AlternityMathService.parseArmorValue(raw);
            this.parsedProtection[key] = parsed;

            if (parsed.isValid) {
                hasProtection = true;
                printed.push(`${parsed.raw} (${form})`);
            } else if (String(raw).trim()) {
                hasUnreadable = true;
                printed.push(`${raw}? (${form})`);
            }
        }

        this.hasProtection    = hasProtection;
        this.hasUnreadable    = hasUnreadable;
        this.protectionLabel  = printed.length ? printed.join(', ') : '—';

        // Derived: human-readable labels for the sheet
        this.speedPenaltyLabel = this.speedPenalty > 0 ? `-${this.speedPenalty} ft` : '—';
        this.skillPenaltyLabel = this.skillPenalty > 0 ? `+${this.skillPenalty} step` : '—';
        this.resistanceBonusLabel = this.resistanceModifierBonus > 0
            ? `+${this.resistanceModifierBonus} steps`
            : '—';
        this.raisesToughness = this.toughness !== DEFAULT_PERSONAL_TOUGHNESS;
    }

    /** @override */
    static migrateData(source) {
        // v0.1: single resistedType string → resistedTypes array
        if (typeof source.resistedType === 'string' && !source.resistedTypes) {
            source.resistedTypes = source.resistedType ? [source.resistedType] : [];
            delete source.resistedType;
        }

        // v0.3: the d20-flavoured damage list became the three forms the rules use.
        // Still needed on the way through: a flat resistance is converted into the
        // `protection` triple below, and it has to know which *form* it applied to.
        if (Array.isArray(source.resistedTypes)) {
            source.resistedTypes = [...new Set(source.resistedTypes.map((type) => (
                DAMAGE_TYPES.includes(type) ? type : (LEGACY_DAMAGE_TYPE_MAP[type] ?? null)
            )).filter(Boolean))];
        }

        // v0.4: a flat `damageResistance` plus a list of forms it applied to becomes
        // a die range per form. Only ever runs when `protection` is still empty, so
        // it cannot overwrite a rating someone has since entered by hand.
        const protection = source.protection ?? {};
        const hasProtection = ['li', 'hi', 'en'].some((k) => String(protection[k] ?? '').trim());
        const legacyResistance = Number(source.damageResistance) || 0;

        if (!hasProtection && legacyResistance > 0) {
            // An empty `resistedTypes` meant "resists everything", which is the only
            // reading under which the old field did anything for most armour.
            const forms = source.resistedTypes?.length ? source.resistedTypes : DAMAGE_TYPES;
            source.protection = { li: '', hi: '', en: '', ...protection };
            for (const form of forms) {
                const key = FORM_TO_PROTECTION_KEY[form];
                if (key) source.protection[key] = String(legacyResistance);
            }
            console.warn(
                `[Alternity] Armour resistance ${legacyResistance} (${forms.join(', ')}) migrated to a `
                + `flat protection rating. The books print armour as die ranges — "d6-1 (LI), d4 (HI), `
                + `d4+1 (En)" — so re-enter this suit's printed values.`
            );
        }

        // v0.4: `armorBonus` was a d20 armour-class number being added to the
        // wearer's resistance modifier. Alternity has no armour class, and only
        // field gear (deflection harness, displacer softsuit) adjusts a resistance
        // modifier at all — so the value is carried across but capped at the range
        // that gear actually uses, and reported rather than silently reinterpreted.
        if (source.armorBonus !== undefined && source.resistanceModifierBonus === undefined) {
            const carried = Math.min(5, Math.max(0, Number(source.armorBonus) || 0));
            source.resistanceModifierBonus = carried;
            if (carried > 0) {
                console.warn(
                    `[Alternity] Armour bonus +${source.armorBonus} carried over as a resistance-modifier `
                    + `bonus of +${carried} steps. Armour does not make its wearer harder to hit in `
                    + `Alternity — set this to 0 unless the item is a deflection harness or displacer suit.`
                );
            }
            delete source.armorBonus;
        }

        return super.migrateData(source);
    }
}
