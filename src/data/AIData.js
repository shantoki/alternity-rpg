/**
 * @file AIData.js
 * @description TypeDataModel: Schema for the 'ai' Actor type.
 *
 * Sources: *Dataware* Ch.5 (Artificial Intelligences) for the statblock shape and
 * the hardware table, and *Player's Handbook* Ch.10 for the mechanics behind it.
 * The two dovetail unusually well — Dataware prints six complete AIs whose numbers
 * all fall out of the Player's Handbook's prose rules, which is what made the
 * OCR-destroyed Table D12 recoverable. See the constants in `alternity-math.js`.
 *
 * An AI is not a robot with a better brain, and the differences run deep enough
 * that sharing a sheet between them would have been misleading:
 *
 *   - **It has three abilities, not six.** Intelligence, Will and Personality are
 *     the AI. Strength, Dexterity and Constitution belong to the Grid avatar its
 *     operating system generates, so they are derived here, never entered — and
 *     every Strength, Dexterity or Constitution *skill* is unavailable to it.
 *   - **Its damage track is the avatar's.** Durability comes from the shadow's
 *     Constitution, so a better operating system is also a tougher one.
 *   - **Quality is two axes.** The AI operating system program has a quality and
 *     the processor it runs on has a quality, and they are crossed to get the
 *     action check. A Marginal program on an Amazing processor is a real build.
 *   - **The OS is free.** A robot's operating system permanently holds one active
 *     memory slot; an AI's holds none.
 *   - **It can be unbounded.** On a supercomputer core fitted with a dedicated
 *     neural matrix the active memory limit disappears entirely, which is the
 *     difference between an AI that swaps programs mid-scene and one that does not.
 *
 * Scope: a record sheet for a designed or published AI, in the same spirit as the
 * ship and robot sheets. Skills live here as inline rows against the memory budget
 * rather than going through AlternityCharacterState, so an AI does not yet roll
 * through the shared hero machinery.
 */

const { fields } = foundry.data;

import {
    AlternityMathService,
    AI_QUALITIES,
    AI_PROCESSORS,
    AI_AVATAR_PROGRAMS,
    AI_FREE_BROAD_SKILLS,
    AI_MAX_MIRROR_SHADOWS,
} from '../services/alternity-math.js';

export { AI_QUALITIES, AI_PROCESSORS, AI_AVATAR_PROGRAMS };

/** The only abilities an AI actually owns. The other three are its avatar's. */
export const AI_ABILITIES = Object.freeze(['INT', 'WIL', 'PER']);

/**
 * Where the AI's brain lives. "In every case, the core processor for any AI must
 * be at least a mainframe" — a personal computer cannot hold one at all.
 */
export const AI_CORE_TYPES = Object.freeze(['Mainframe', 'Supercomputer']);

/** Rows in the printed "Physical Form" block: what protects the AI, and what it shoots with. */
export const AI_PHYSICAL_FORM_KINDS = Object.freeze(['CPU Armor', 'Weapon']);

function damageSchema() {
    return new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 });
}

export class AIData extends foundry.abstract.TypeDataModel {

    /** @override */
    static defineSchema() {
        return {
            // ── Identity ─────────────────────────────────────────────────────
            concept: new fields.StringField({ required: false, initial: '' }),

            progressLevel: new fields.NumberField({
                required: true, nullable: false, integer: true, initial: 7, min: 6, max: 9,
            }),

            // "In most cases, AI level correlates closely with age: an AI gains 1
            // level every other year." Age is shown derived from this rather than
            // stored, so the two cannot drift apart.
            level: new fields.NumberField({
                required: true, nullable: false, integer: true, initial: 1, min: 1,
            }),

            // ── The two quality axes ─────────────────────────────────────────
            // The operating system program's quality sets the Grid avatar's
            // physical scores; the processor's sets memory, skill rank and the
            // situation die. Crossing them gives the action check.
            osQuality: new fields.StringField({
                required: true, nullable: false, initial: 'Ordinary', choices: AI_QUALITIES,
            }),

            processor: new fields.StringField({
                required: true, nullable: false, initial: 'PL7-Ordinary',
                choices: Object.keys(AI_PROCESSORS),
            }),

            coreType: new fields.StringField({
                required: true, nullable: false, initial: 'Mainframe', choices: AI_CORE_TYPES,
            }),

            // A supercomputer core is only unbounded when it is actually fitted
            // with "dedicated neural matrix circuitry designed to house an AI's
            // processing power" — the two are separate purchases.
            hasNeuralMatrix: new fields.BooleanField({ required: true, initial: false }),

            avatarProgram: new fields.StringField({
                required: true, nullable: false, initial: 'shadowForm',
                choices: Object.keys(AI_AVATAR_PROGRAMS),
            }),

            // ── Abilities ────────────────────────────────────────────────────
            abilities: new fields.SchemaField(Object.fromEntries(
                AI_ABILITIES.map((key) => [key, new fields.NumberField({
                    required: true, nullable: false, integer: true, initial: 10, min: 1,
                })])
            )),

            // Drives both the avatar's physical scores and the Grid skill score,
            // which is why it is a first-class field rather than a skill row.
            hackingRank: new fields.NumberField({
                required: true, nullable: false, integer: true, initial: 0, min: 0,
            }),

            // Action check bonuses earned with achievement level. Kept separate
            // from the program/processor base so the sheet can show both.
            actionCheckBonus: new fields.NumberField({
                required: true, nullable: false, integer: true, initial: 0,
            }),

            // ── AI Functions specialties ─────────────────────────────────────
            // Every AI has the AI Functions broad skill free, and its three
            // specialties each govern a hard limit, so they get named fields.
            aiFunctions: new fields.SchemaField({
                multitask:  new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
                prediction: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
                remote:     new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
            }),

            // The fourth free broad skill, "whatever broad skill best defines the
            // reason for their construction" — Navigation for a ship's AI, and so on.
            purposeSkill: new fields.StringField({ required: false, initial: '' }),

            // ── Grid presence ────────────────────────────────────────────────
            // Mirror image software splits the avatar into up to ten shadows, each
            // suffering a step penalty of one less than the number created.
            mirrorShadows: new fields.NumberField({
                required: true, nullable: false, integer: true, initial: 1, min: 1, max: AI_MAX_MIRROR_SHADOWS,
            }),

            interface: new fields.StringField({ required: false, initial: '' }),
            cost:      new fields.StringField({ required: false, initial: '' }),

            // ── Backups ──────────────────────────────────────────────────────
            // "If the AI ever suffers a power loss, loses data to hackers, or
            // accrues sufficient damage to its processor to destroy it, it can
            // reconstruct its matrix from the backup log."
            hasBackups: new fields.BooleanField({ required: true, initial: false }),
            lastBackup: new fields.StringField({ required: false, initial: '' }),

            // ── Damage taken (maxima derive from the avatar's Constitution) ───
            damage: new fields.SchemaField({
                stun:   damageSchema(),
                wound:  damageSchema(),
                mortal: damageSchema(),
            }),

            // ── Physical form ────────────────────────────────────────────────
            // The armour on the box the AI lives in, and any weapon it can fire
            // through actuators. Most AIs have neither and print "None".
            physicalForm: new fields.ArrayField(new fields.SchemaField({
                name: new fields.StringField({ required: true, nullable: false, initial: '' }),
                kind: new fields.StringField({
                    required: true, nullable: false, initial: 'CPU Armor',
                    choices: AI_PHYSICAL_FORM_KINDS,
                }),
                skill: new fields.StringField({ required: false, initial: '' }),
                // Armour value or damage track, both printed as free text die ranges.
                value: new fields.StringField({ required: false, initial: '' }),
            }), { initial: [] }),

            // ── Grid avatar programs ─────────────────────────────────────────
            gridPrograms: new fields.ArrayField(new fields.SchemaField({
                name: new fields.StringField({ required: true, nullable: false, initial: '' }),
                quality: new fields.StringField({
                    required: true, nullable: false, initial: 'Ordinary', choices: AI_QUALITIES,
                }),
                slots: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
                // Damage or armour value, printed as free text.
                effect: new fields.StringField({ required: false, initial: '' }),
                isLoaded: new fields.BooleanField({ required: true, initial: true }),
                // "Some programs are AI-disabled ... making it impossible for an AI
                // to run the program on its host computer."
                isAIDisabled: new fields.BooleanField({ required: true, initial: false }),
            }), { initial: [] }),

            // ── Skills (programs, in memory terms) ───────────────────────────
            skills: new fields.ArrayField(new fields.SchemaField({
                name:    new fields.StringField({ required: true, nullable: false, initial: '' }),
                isBroad: new fields.BooleanField({ required: true, initial: false }),
                rank:    new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
                // A mainframe AI routinely holds only part of a skill, pulling the
                // rest out of storage memory when it needs it.
                ranksLoaded: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
                isLoaded:    new fields.BooleanField({ required: true, initial: true }),
                ability:     new fields.StringField({ required: false, initial: '' }),
            }), { initial: [] }),

            // ── Remotes ──────────────────────────────────────────────────────
            // An AI's hands, eyes and presence in real space.
            remotes: new fields.ArrayField(new fields.SchemaField({
                name: new fields.StringField({ required: true, nullable: false, initial: '' }),
                quantity: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 1, min: 0 }),
                progressLevel: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 6, min: 5, max: 9 }),
                statblock: new fields.StringField({ required: false, initial: '' }),
                notes:     new fields.StringField({ required: false, initial: '' }),
            }), { initial: [] }),

            // ── Free text ────────────────────────────────────────────────────
            notes:       new fields.HTMLField({ required: false, initial: '' }),
            description: new fields.HTMLField({ required: false, initial: '' }),
        };
    }

    /** @override */
    prepareDerivedData() {
        const abilities = this.abilities ?? {};
        const int = abilities.INT ?? 1;
        const wil = abilities.WIL ?? 1;

        const processor = AI_PROCESSORS[this.processor] ?? null;
        this.processorInfo = processor;

        // ── The Grid avatar, and with it every physical number on the sheet ──
        const avatar = AlternityMathService.calculateAIGridAvatar(
            this.osQuality, this.hackingRank ?? 0, { program: this.avatarProgram }
        );
        this.avatar = { STR: avatar.STR, DEX: avatar.DEX, CON: avatar.CON };
        this.hackingBonus = avatar.hackingBonus;
        this.gridMovementRate = avatar.gridMovementRate;

        this.durability = {
            stun:   { value: this.damage?.stun ?? 0,   max: avatar.durability.stun },
            wound:  { value: this.damage?.wound ?? 0,  max: avatar.durability.wound },
            mortal: { value: this.damage?.mortal ?? 0, max: avatar.durability.mortal },
        };

        // No separate hull-integrity aggregate here, unlike the ships: the three
        // tracks above are already value/max pairs, so token bars have something
        // real to point at and a summary would just duplicate `durability.mortal`.

        // ── Action check ────────────────────────────────────────────────────
        const actionCheck = AlternityMathService.calculateAIActionCheck(
            this.osQuality, processor?.quality ?? 'Ordinary', { bonus: this.actionCheckBonus ?? 0 }
        );
        this.actionCheck = actionCheck;
        this.actionsPerRound = actionCheck.actionsPerRound;
        this.actionCheckModifier = processor?.actionCheckModifier ?? '+d0';
        this.actionCheckStep = processor?.step ?? 0;

        // ── Grid skill score ────────────────────────────────────────────────
        this.gridSkillScore = AlternityMathService.calculateGridSkillScore(int, this.hackingRank ?? 0);

        // ── Resistance modifiers ────────────────────────────────────────────
        // Grid attacks are resisted with Intelligence, not with the avatar's
        // physical scores — confirmed by five of the six printed AIs. The Grid
        // Lord prints +7 against a +4 Intelligence band; that one cell is not
        // reproducible from any stated rule and is treated as a scan artefact.
        const intResistance = AlternityMathService.calculateResistanceModifier(int, 'INT');
        this.resistance = {
            int:  intResistance,
            wil:  AlternityMathService.calculateResistanceModifier(wil, 'WIL'),
            grid: intResistance,
        };

        // ── Active memory ───────────────────────────────────────────────────
        // A supercomputer core is only unbounded once a neural matrix is fitted.
        const isUnlimited = this.coreType === 'Supercomputer' && this.hasNeuralMatrix;
        const gridProgramSlots = (this.gridPrograms ?? [])
            .filter((row) => row.isLoaded && !row.isAIDisabled)
            .reduce((sum, row) => sum + (row.slots ?? 0), 0);

        this.memory = AlternityMathService.calculateAIMemoryLoad(
            processor?.activeSlots ?? 0, this.skills ?? [],
            { reservedSlots: gridProgramSlots, isUnlimited }
        );
        this.gridProgramSlots = gridProgramSlots;
        this.isUnlimitedMemory = isUnlimited;
        // Worth flagging rather than silently ignoring: the matrix is the expensive
        // half of the purchase and a supercomputer without one buys nothing here.
        this.hasUnusedSupercomputer = this.coreType === 'Supercomputer' && !this.hasNeuralMatrix;

        // ── Skill ceilings and restrictions ─────────────────────────────────
        this.maxSkillRank = processor?.maxSkillRank ?? null;

        this.skillIssues = [];
        this.overRankedSkills = [];
        for (const skill of this.skills ?? []) {
            const label = skill.name || 'Unnamed skill';
            if (this.maxSkillRank !== null && !skill.isBroad && (skill.rank ?? 0) > this.maxSkillRank) {
                this.overRankedSkills.push(label);
            }
            const restriction = AlternityMathService.getAISkillRestriction(skill.name, skill.ability);
            if (restriction.isBarred || restriction.penalty) {
                this.skillIssues.push({ name: label, ...restriction });
            }
        }

        // Programs a previous owner loaded that this AI simply cannot run.
        this.disabledPrograms = (this.gridPrograms ?? [])
            .filter((row) => row.isAIDisabled)
            .map((row) => row.name || 'Unnamed program');

        // ── AI Functions ────────────────────────────────────────────────────
        const fn = this.aiFunctions ?? {};
        // "An AI with the skill may operate one additional subsystem for each rank"
        // — without it, the AI has only its central processing power.
        this.subsystemsControlled = 1 + (fn.multitask ?? 0);
        // The remote rank governs how many remotes can act at once on one task.
        // More can be carried; their input just lands in storage memory.
        this.remotesControlled = fn.remote ?? 0;
        this.remotesOwned = (this.remotes ?? []).reduce((sum, row) => sum + (row.quantity ?? 0), 0);
        this.needsMultitaskForRemotes = this.remotesOwned > 0 && (fn.multitask ?? 0) === 0;

        // ── Mirror shadows ──────────────────────────────────────────────────
        const shadows = Math.max(1, this.mirrorShadows ?? 1);
        this.mirrorPenalty = shadows - 1;

        // ── Free broad skills ───────────────────────────────────────────────
        this.freeBroadSkills = [...AI_FREE_BROAD_SKILLS, this.purposeSkill || '—'];

        // "An AI gains 1 level every other year. Thus, a 5th-level AI is usually
        // about 30 years old." Level 1 at age 2, so age = level x 2.
        this.approximateAge = (this.level ?? 1) * 2;
        // Manufacturers hold an AI back until about age 12 — level 6.
        this.isReleasable = (this.level ?? 1) >= 6;
        // Citizenship attaches at age 12 too, and only from PL 7 onward.
        this.hasCitizenship = this.isReleasable && (this.progressLevel ?? 7) >= 7;

        // ── Status summary ──────────────────────────────────────────────────
        const dur = avatar.durability;
        if (dur.mortal > 0 && (this.damage?.mortal ?? 0) >= dur.mortal) {
            // Destroyed is not necessarily final — that is the whole point of backups.
            this.status = this.hasBackups ? 'Restorable' : 'Destroyed';
        } else if ((this.damage?.wound ?? 0) >= dur.wound) {
            this.status = 'Disabled';
        } else if ((this.damage?.stun ?? 0) >= dur.stun) {
            this.status = 'Crashed';
        } else if (this.memory.isOverloaded || this.overRankedSkills.length) {
            this.status = 'Strained';
        } else {
            this.status = 'Operational';
        }
    }

    /** @override */
    static migrateData(source) {
        return super.migrateData(source);
    }
}
