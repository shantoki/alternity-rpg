/**
 * @file CybertechData.js
 * @description TypeDataModel: Schema for the 'cybertech' Item type.
 *
 * Covers the Player's Handbook Chapter 15 "Cybertech" catalog (Table P53) —
 * BattleKlaws, body plating, cyberlimbs, cyberoptics, nanocomputers, NIJacks,
 * fast chips, reflex circuitry, self-repair units and the rest of the cyber
 * gear list.
 *
 * Every piece of gear shares one mechanical spine: it is bought at a quality
 * (Ordinary / Good / Amazing), it consumes `size` points of the owner's cyber
 * tolerance track when installed, and it may require supporting hardware
 * (a nanocomputer, an exoskeleton, a cyberlimb) before it can be used. The
 * per-item benefits then vary, so this schema models the handful of shapes the
 * book actually uses rather than a bespoke field per gear entry:
 *
 *   - abilityModifier   : cyberlimb (+1/+2/+3 STR), MusclePlus, Amazing body
 *                          plating (-2 DEX)
 *   - durabilityBonus   : CF skinweave / exoskeleton (extra stun/wound/mortal points)
 *   - armorProtection   : body plating (LI/HI/En die ranges — free text, matching
 *                          the character sheet's own armor ratings)
 *   - actionCheckModifier: fast chip (-1/-2/-3 steps; negative is a bonus, per the
 *                          convention used throughout this codebase)
 *   - damageFormula     : BattleKlaw / subdermal weapon mounts (Ordinary/Good/Amazing
 *                          damage triple as printed, e.g. "d4+2w/d6+2w/d4m")
 *
 * Cyber tolerance itself is *not* stored here — it is derived from the owner's
 * Constitution and the sizes of all installed gear by
 * AlternityMathService.calculateCyberTolerance().
 */

const { fields } = foundry.data;

/** Broad groupings for the Table P53 gear list. */
export const CYBERTECH_CATEGORIES = Object.freeze([
    'Weapon',       // BattleKlaw, subdermal weapon mount
    'Protection',   // body plating, CF skinweave, exoskeleton
    'Enhancement',  // cyberlimb, MusclePlus, fast chip, reflex
    'Sensory',      // cyberoptics, optic screen
    'Interface',    // nanocomputer, NIJack, neural 3D, data slot, subdermal comm
    'Utility',      // self-repair unit, ER slot, BioWatch
    'Cosmetic',     // BioArt
]);

/** Quality tiers — the "Cost per Quality" columns of Table P53. */
export const CYBERTECH_QUALITIES = Object.freeze(['Ordinary', 'Good', 'Amazing']);

export class CybertechData extends foundry.abstract.TypeDataModel {

    /** @override */
    static defineSchema() {
        return {
            // ── Classification ───────────────────────────────────────────
            category: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'Enhancement',
                choices:  [...CYBERTECH_CATEGORIES],
            }),

            quality: new fields.StringField({
                required: true,
                nullable: false,
                initial:  'Ordinary',
                choices:  [...CYBERTECH_QUALITIES],
            }),

            progressLevel: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  5,
                min:      0,
                max:      9,
            }),

            // ── Cost / footprint ─────────────────────────────────────────
            cost: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  0,
                min:      0,
            }),

            mass: new fields.NumberField({
                required: true,
                nullable: false,
                initial:  0,
                min:      0,
            }),

            // Cyber tolerance points consumed while installed (Table P53 "Size").
            size: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  1,
                min:      0,
            }),

            // ── Prerequisites ────────────────────────────────────────────
            // The "*" footnote on Table P53: gear that needs a nanocomputer to work.
            requiresNanocomputer: new fields.BooleanField({
                required: true,
                initial:  false,
            }),

            // Good cyberlimb / MusclePlus and anything that drives the body past
            // its natural limits needs an exoskeleton to anchor it.
            requiresExoskeleton: new fields.BooleanField({
                required: true,
                initial:  false,
            }),

            // Amazing BattleKlaw / MusclePlus must be mounted in a cyberlimb.
            requiresCyberlimb: new fields.BooleanField({
                required: true,
                initial:  false,
            }),

            // The "**" footnote: gear installable at no skill point cost. The
            // 10-skill-point charge is paid once per character, not per item, so
            // this only records whether this piece is exempt from it.
            requiresSkillPoints: new fields.BooleanField({
                required: true,
                initial:  true,
            }),

            // ── Installation state ───────────────────────────────────────
            // Gear only fills tolerance boxes once it is actually in the body;
            // an un-installed item is just cargo.
            isInstalled: new fields.BooleanField({
                required: true,
                initial:  false,
            }),

            // Damaged gear keeps applying its penalties until a cyber surgeon (or a
            // self-repair unit) fixes it — PHB Ch.15 "Damage to Cyber Gear".
            isDamaged: new fields.BooleanField({
                required: true,
                initial:  false,
            }),

            // ── Mechanical benefits ──────────────────────────────────────
            abilityModifier: new fields.SchemaField({
                ability: new fields.StringField({
                    required: true,
                    nullable: false,
                    initial:  'None',
                    choices:  ['STR', 'DEX', 'CON', 'INT', 'WIL', 'PER', 'None'],
                }),
                value: new fields.NumberField({
                    required: true,
                    nullable: false,
                    integer:  true,
                    initial:  0,
                }),
            }, { initial: { ability: 'None', value: 0 } }),

            durabilityBonus: new fields.SchemaField({
                stun:   new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
                wound:  new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
                mortal: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
            }, { initial: { stun: 0, wound: 0, mortal: 0 } }),

            // Free text, not numbers: body plating is printed as die ranges
            // ("d4", "d4-1", "d6+1"), and the character sheet's own armor ratings
            // are free-text for exactly the same reason.
            armorProtection: new fields.SchemaField({
                li: new fields.StringField({ required: false, initial: '' }),
                hi: new fields.StringField({ required: false, initial: '' }),
                en: new fields.StringField({ required: false, initial: '' }),
            }, { initial: { li: '', hi: '', en: '' } }),

            // Fast chip: -1 / -2 / -3 steps by quality. Negative = bonus.
            actionCheckModifier: new fields.NumberField({
                required: true,
                nullable: false,
                integer:  true,
                initial:  0,
            }),

            // Ordinary/Good/Amazing damage triple exactly as printed in the book.
            damageFormula: new fields.StringField({
                required: false,
                initial:  '',
            }),

            // ── Activation (fast chip, reflex, self-repair unit, ER slot) ──
            isActivated: new fields.BooleanField({
                required: true,
                initial:  false,
            }),

            // Free text: "1 fatigue at end of use", "2 stun per round", etc.
            activationCost: new fields.StringField({
                required: false,
                initial:  '',
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
        this.plLabel     = `PL ${this.progressLevel}`;
        this.costDisplay = this.cost > 0 ? `$${this.cost}` : '—';
        this.sizeDisplay = `${this.size}`;

        // ── Benefit summaries ────────────────────────────────────────────
        this.hasAbilityModifier = this.abilityModifier.ability !== 'None' && this.abilityModifier.value !== 0;
        this.abilityModifierDisplay = this.hasAbilityModifier
            ? `${this.abilityModifier.value > 0 ? '+' : ''}${this.abilityModifier.value} ${this.abilityModifier.ability}`
            : '—';

        const durabilityParts = [];
        if (this.durabilityBonus.stun)   durabilityParts.push(`+${this.durabilityBonus.stun} stun`);
        if (this.durabilityBonus.wound)  durabilityParts.push(`+${this.durabilityBonus.wound} wound`);
        if (this.durabilityBonus.mortal) durabilityParts.push(`+${this.durabilityBonus.mortal} mortal`);
        this.hasDurabilityBonus  = durabilityParts.length > 0;
        this.durabilityDisplay   = durabilityParts.length ? durabilityParts.join(', ') : '—';

        const armorParts = [];
        if (this.armorProtection.li) armorParts.push(`LI ${this.armorProtection.li}`);
        if (this.armorProtection.hi) armorParts.push(`HI ${this.armorProtection.hi}`);
        if (this.armorProtection.en) armorParts.push(`En ${this.armorProtection.en}`);
        this.hasArmorProtection = armorParts.length > 0;
        this.armorDisplay       = armorParts.length ? armorParts.join(' / ') : '—';

        this.hasActionCheckModifier = this.actionCheckModifier !== 0;
        this.actionCheckDisplay     = this.hasActionCheckModifier
            ? `${this.actionCheckModifier > 0 ? '+' : ''}${this.actionCheckModifier} step${Math.abs(this.actionCheckModifier) === 1 ? '' : 's'}`
            : '—';

        this.hasDamage = !!this.damageFormula;

        // ── Prerequisites ────────────────────────────────────────────────
        const requirements = [];
        if (this.requiresNanocomputer) requirements.push('Nanocomputer');
        if (this.requiresExoskeleton)  requirements.push('Exoskeleton');
        if (this.requiresCyberlimb)    requirements.push('Cyberlimb');
        this.hasRequirements     = requirements.length > 0;
        this.requirementsDisplay = requirements.length ? requirements.join(', ') : '—';

        // ── Activation ───────────────────────────────────────────────────
        // Only gear that costs something to switch on is treated as activatable;
        // everything else is simply on once installed.
        this.isActivatable = !!this.activationCost;
    }
}
