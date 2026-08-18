/**
 * @file alternity-roll-service.js
 * @description The single place a check or a damage roll is actually rolled.
 *
 * Why this exists as its own service: before it, the only working roll pipeline
 * lived inside `AlternityRollComponent` on the hero sheet, so the seven statblock
 * sheets (supporting cast, creature, robot, AI, spaceship, warship, vehicle) had
 * scores printed on them and no way to roll any of them. Rather than copy the
 * dice-and-chat plumbing into each sheet, all of it moved here.
 *
 * The division of labour matches the rest of the codebase:
 *
 *   AlternityMathService  — pure. Steps, degrees, damage-code parsing. No Foundry.
 *   AlternityRollService  — this file. Dice, chat cards, targets. No arithmetic.
 *   sheets / documents    — decide *what* is being rolled, then call in here.
 *
 * So nothing below adds, halves or compares numbers itself; every such question
 * is asked of the math service.
 */

import {
    AlternityMathService,
    SUCCESS_DEGREES,
    PERSONAL_DAMAGE_GRADES,
    DAMAGE_TYPES,
    DEFAULT_PERSONAL_TOUGHNESS,
} from './alternity-math.js';
import {
    getAlternityState,
    ABILITY_TYPES,
} from '../data/alternity-actor-data.js';
import { speciesDefenseModifiers } from '../data/SpeciesData.js';
import { Roll, ChatMessage, Hooks, game, renderTemplate } from '../module-info.js';

const NAMESPACE = 'alternity-v2';

const CHECK_CARD  = `systems/${NAMESPACE}/templates/roll/roll-card.hbs`;
const DAMAGE_CARD = `systems/${NAMESPACE}/templates/roll/damage-card.hbs`;
const ARMOR_CARD  = `systems/${NAMESPACE}/templates/roll/armor-card.hbs`;

/** Actor types that keep an AlternityCharacterState alongside their schema. */
const STATEFUL_TYPES = Object.freeze(['character', 'npc']);

/** Damage form -> the sub-field armour is rated in, on every armour-bearing shape. */
const FORM_KEYS = Object.freeze({ LI: 'li', HI: 'hi', En: 'en' });

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Chat style constant, resolved defensively. Foundry renamed
 * CONST.CHAT_MESSAGE_TYPES to CHAT_MESSAGE_STYLES, and this system supports both
 * v12 and v14.
 */
function _rollStyle() {
    return CONST.CHAT_MESSAGE_STYLES?.ROLL ?? CONST.CHAT_MESSAGE_TYPES?.ROLL ?? 0;
}

function _whisperTo(whisper) {
    return whisper ? { whisper: ChatMessage.getWhisperRecipients('GM') } : {};
}

/**
 * The protections that lost the layering roll, out of an armour roll's trace.
 *
 * `selectBestArmorRoll` traces the winner at its negative value and every discarded
 * layer at 0, and only the winning value reaches the math service — so the discarded
 * lines have to be re-attached to whatever trace the damage resolution produced, or a
 * layered target shows several dice with only one of them accounted for.
 *
 * Exported through both apply paths (`AlternityActor.applyAlternityDamage` and
 * `_applyTrackDamage`) rather than done once at the card, so the same explanation
 * reaches the `alternity:damageApplied` hook as well.
 *
 * @param {object[]} [trace]
 * @returns {object[]}
 */
export function layeredArmorLines(trace) {
    return (trace ?? []).filter((line) => line && line.value === 0);
}

// ---------------------------------------------------------------------------
// AlternityRollService
// ---------------------------------------------------------------------------

export const AlternityRollService = {

    // -----------------------------------------------------------------------
    // Modifier collection
    // -----------------------------------------------------------------------

    /**
     * Gather every step modifier this actor is currently carrying, whatever type
     * it is.
     *
     * Heroes and supporting cast answer from their AlternityCharacterState, which
     * owns wound level, the Dazed fatigue penalty and active stances. Every other
     * actor type owns those numbers in its own TypeDataModel instead, and the
     * schema-side shape is uniform after `prepareDerivedData` (`woundPenalty` plus
     * a `durability.fatigue` track), so the fallback branch reads the same two
     * things from there.
     *
     * @param {Actor}  actor
     * @param {object} [options]
     * @param {string} [options.context] - Roll context, used to filter which
     *        stances and abilities are relevant to this particular check.
     * @param {boolean} [options.includeArmorPenalty=true] - Whether worn armour's
     *        check penalty applies. Off for checks armour cannot hinder.
     * @returns {Promise<object[]>} Modifiers in `buildModifier` shape.
     */
    async collectActorModifiers(actor, options = {}) {
        if (!actor) return [];
        const { context = 'General', includeArmorPenalty = true } = options;
        const modifiers = [];

        if (STATEFUL_TYPES.includes(actor.type)) {
            const state = await getAlternityState(actor);
            if (state) {
                // Wound level plus one step per marked fatigue box (Dazed).
                const penalty = state.getDamageStepPenalty();
                if (penalty !== 0) {
                    modifiers.push(AlternityMathService.buildModifier(
                        game.i18n.localize('ALTERNITY.Modifier.WoundPenalty'),
                        penalty,
                        game.i18n.localize('ALTERNITY.Modifier.WoundPenaltyReason'),
                    ));
                }

                for (const ability of state.getActiveAbilities()) {
                    const trigger = ability.triggerCondition ?? {};
                    // A stance scoped to "Melee Attack" should not modify a
                    // Knowledge check. 'Any' and an unset context mean always.
                    if (trigger.context && trigger.context !== context && trigger.context !== 'Any') continue;
                    const step = ability.effectPayload?.step;
                    if (typeof step !== 'number' || step === 0) continue;
                    modifiers.push(AlternityMathService.buildModifier(
                        ability.name, step, `${ability.type ?? ABILITY_TYPES.STANCE}: ${ability.name}`,
                    ));
                }
            }
        } else {
            const sys = actor.system ?? {};

            const woundPenalty = sys.woundPenalty ?? 0;
            if (woundPenalty !== 0) {
                modifiers.push(AlternityMathService.buildModifier(
                    game.i18n.localize('ALTERNITY.Modifier.WoundPenalty'),
                    woundPenalty,
                    game.i18n.localize('ALTERNITY.Modifier.WoundPenaltyReason'),
                ));
            }

            const fatigue = sys.durability?.fatigue?.value ?? 0;
            if (fatigue > 0) {
                modifiers.push(AlternityMathService.buildModifier(
                    game.i18n.localize('ALTERNITY.Modifier.Dazed'),
                    fatigue,
                    game.i18n.localize('ALTERNITY.Modifier.DazedReason'),
                ));
            }
        }

        // Worn armour hampers checks regardless of which layer owns the actor's
        // stats, so this sits outside the branch.
        if (includeArmorPenalty && actor.items?.size) {
            const penalty = actor.items
                .filter((i) => i.type === 'armor' && i.system?.isEquipped)
                .reduce((total, a) => total + (a.system?.skillPenalty ?? 0), 0);
            if (penalty !== 0) {
                modifiers.push(AlternityMathService.buildModifier(
                    game.i18n.localize('ALTERNITY.Modifier.ArmorPenalty'),
                    penalty,
                    game.i18n.localize('ALTERNITY.Modifier.ArmorPenaltyReason'),
                ));
            }
        }

        // A dodge the defender rolled earlier this round is stored on them and
        // spent by the next attack, so it is not collected here — see
        // `readPendingDodge`, which the attack path consults for its target.
        return modifiers;
    },

    // -----------------------------------------------------------------------
    // rollCheck
    // -----------------------------------------------------------------------

    /**
     * Roll one Alternity check: a d20 control die plus the situation die the net
     * step calls for, resolved roll-under against a triple score.
     *
     * Both dice live in a single Foundry Roll so the chat card shows one coherent
     * roll rather than two unrelated ones, and so Dice So Nice animates them
     * together.
     *
     * @param {object}   config
     * @param {Actor}    config.actor            - Whose check this is (used for the speaker and modifiers).
     * @param {string}   config.name             - What is being rolled, e.g. "Acrobatics-dodge".
     * @param {string}   config.context          - Category label, e.g. "Melee Attack". Filters stances.
     * @param {object}   config.scores           - { ordinary, good, amazing }.
     * @param {number}   [config.baseStep=0]     - 0 for specialty skills and Action Checks, 1 for broad/feat.
     * @param {object[]} [config.modifiers=[]]   - Extra modifiers on top of the actor's own.
     * @param {boolean}  [config.collectActorModifiers=true] - Set false for checks that must
     *        ignore the actor's condition (an Action Check is still subject to wounds, so this
     *        is only for genuinely unconditioned rolls).
     * @param {boolean}  [config.includeArmorPenalty=true]
     * @param {boolean}  [config.whisper=false]
     * @param {boolean}  [config.isActionCheck=false] - Action Checks cannot fail: any failing
     *        result is downgraded to a Marginal success (core mechanics, "Exception — Action Checks").
     * @param {object}   [config.damage=null]    - Damage payload to offer on the card once the
     *        degree is known. See `rollDamage` for its shape; `codes` is required.
     * @param {boolean}  [config.createMessage=true]
     * @returns {Promise<object>} The math service's result, plus `roll`, `name`,
     *          `context`, `message` and (when a damage payload was supplied)
     *          `damageSelection`.
     */
    async rollCheck(config) {
        const {
            actor,
            name,
            context,
            scores,
            baseStep = 0,
            modifiers: extraModifiers = [],
            collectActorModifiers = true,
            includeArmorPenalty = true,
            whisper = false,
            isActionCheck = false,
            damage = null,
            createMessage = true,
        } = config;

        if (!scores || typeof scores.ordinary !== 'number') {
            throw new Error('[AlternityRollService.rollCheck] config.scores.ordinary must be a number.');
        }

        const actorModifiers = collectActorModifiers
            ? await this.collectActorModifiers(actor, { context, includeArmorPenalty })
            : [];
        const modifiers = [...actorModifiers, ...extraModifiers.filter(Boolean)];

        // Let external modules and macros veto or amend the check before dice fly.
        const rollOptions = { actor, name, context, scores, baseStep, modifiers, whisper, isActionCheck };
        if (Hooks.call('alternity:preRollCheck', actor, rollOptions) === false) return null;

        const totalStep = rollOptions.baseStep
            + rollOptions.modifiers.reduce((sum, m) => sum + m.value, 0);
        const situation = AlternityMathService.buildSituationFormula(totalStep);

        const roll = new Roll(situation.formula);
        await roll.evaluate();

        const control = roll.terms[situation.controlIndex]?.total ?? roll.total;
        const situationRoll = situation.hasSituation
            ? (roll.terms[situation.situationIndex]?.total ?? 0)
            : 0;

        const result = AlternityMathService.resolveAbilityCheck(
            rollOptions.scores,
            rollOptions.baseStep,
            rollOptions.modifiers,
            `${rollOptions.name} (${rollOptions.context})`,
            { control, situation: situationRoll },
        );

        // An Action Check can never fail — a natural 20 included. Anything that
        // would have failed becomes a Marginal success instead, and a 20 also
        // trips the Bad Luck Rule, which the card flags for the Gamemaster.
        let degree = result.degree;
        let succeeded = result.succeeded;
        let badLuck = false;
        if (isActionCheck && !succeeded) {
            degree = 'Marginal';
            succeeded = true;
            badLuck = control === 20;
        }

        // Which damage column the achieved degree unlocks. Resolved before the
        // card renders so the button can name its own grade.
        const damageSelection = damage
            ? AlternityMathService.selectDamageGrade(degree, damage.codes ?? {})
            : null;

        const payload = {
            ...result,
            degree,
            succeeded,
            badLuck,
            name: rollOptions.name,
            context: rollOptions.context,
            roll,
            damageSelection,
        };

        if (createMessage) {
            payload.message = await this._postCheckCard(actor, payload, {
                whisper: rollOptions.whisper,
                damage,
                damageSelection,
            });
        }

        Hooks.callAll('alternity:rollCheck', actor, payload);
        return payload;
    },

    /**
     * Render and post the check result card.
     * @private
     */
    async _postCheckCard(actor, payload, { whisper, damage, damageSelection }) {
        // The flag carries the *resolved* grade and code, not the three-column run:
        // the card's button has to be able to fire without re-deciding which grade
        // the check earned, and the selection has already been made here.
        const offeredDamage = damage && damageSelection?.grade && damageSelection.code
            ? {
                name: damage.name,
                code: damageSelection.code,
                grade: damageSelection.grade,
                damageType: damage.damageType,
                firepower: damage.firepower,
                targetToughness: damage.targetToughness ?? null,
                bonus: damage.bonus ?? '',
                fallbackCategory: damage.fallbackCategory ?? 'wound',
                minimumOne: !!damage.minimumOne,
                actorUuid: damage.actorUuid ?? actor?.uuid ?? null,
                whisper: !!whisper,
            }
            : null;

        const content = await renderTemplate(CHECK_CARD, {
            context:       `${payload.name} — ${payload.context}`,
            actorName:     actor?.name ?? game.user?.name ?? '',
            succeeded:     payload.succeeded,
            degree:        payload.degree,
            badLuck:       payload.badLuck,
            oga:           payload.scores,
            rollHtml:      await payload.roll.render(),
            modifierTrace: payload.modifierTrace,
            adjustedValue: payload.finalValue,
            margin:        payload.margin,
            stepFormula:   payload.stepDie?.formula,
            isStepClamped: payload.stepDie?.isClamped,
            // Only offered when the attack actually connected and there is a
            // code in the achieved column to roll.
            damage: offeredDamage
                ? { ...offeredDamage, usedFallback: damageSelection.usedFallback }
                : null,
        });

        return ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content,
            style: _rollStyle(),
            rolls: [payload.roll],
            sound: CONFIG.sounds?.dice,
            flags: {
                [NAMESPACE]: {
                    check: {
                        actorUuid: actor?.uuid ?? null,
                        degree:    payload.degree,
                        succeeded: payload.succeeded,
                        // The resolved grade and code, so the card's damage button can
                        // fire long after the sheet that opened the roll has closed —
                        // and after a reload.
                        damage: offeredDamage,
                    },
                },
            },
            ..._whisperTo(whisper),
        });
    },

    // -----------------------------------------------------------------------
    // rollDamage
    // -----------------------------------------------------------------------

    /**
     * Roll one damage grade and post it with buttons to apply it to targets.
     *
     * The grade's damage code carries its own track letter ("d6+2w" is wound
     * damage), so the track is read out of the code rather than passed in
     * separately — that is what keeps a statblock's three columns able to land on
     * three different tracks, which they routinely do.
     *
     * @param {object}   config
     * @param {Actor}    config.actor
     * @param {string}   config.name              - Attack or weapon name.
     * @param {string}   config.code              - The damage code for the grade being rolled.
     * @param {string}   [config.grade]           - 'ordinary' | 'good' | 'amazing', for the card's label.
     * @param {string}   [config.damageType]      - LI / HI / En, or a weapon's descriptive type.
     * @param {string}   [config.firepower]       - Marginal..Amazing. Shown on the card, and
     *        compared against `targetToughness` when one is supplied.
     * @param {string}   [config.targetToughness] - The defender's toughness on the same ladder.
     *        Omitted means no degrade is reported: the rule needs both halves, and
     *        guessing the target's toughness would silently misstate the damage.
     * @param {string}   [config.bonus]           - Extra formula term, e.g. a Strength damage adjustment.
     * @param {string}   [config.fallbackCategory='wound'] - Track for a code with no letter.
     * @param {boolean}  [config.minimumOne=false] - Floor the total at 1 (Table P9's footnote,
     *        for a negative Strength damage adjustment).
     * @param {boolean}  [config.whisper=false]
     * @returns {Promise<{roll: Roll, total: number, category: string, message: ChatMessage}|null>}
     */
    async rollDamage(config) {
        const {
            actor,
            name,
            code,
            grade = null,
            damageType = '',
            firepower = null,
            targetToughness = null,
            bonus = '',
            fallbackCategory = 'wound',
            minimumOne = false,
            whisper = false,
        } = config;

        const parsed = AlternityMathService.parseDamageCode(code, { fallbackCategory });
        if (!parsed.isValid) {
            ui.notifications?.warn(game.i18n.format('ALTERNITY.Roll.NoDamageCode', {
                name: name ?? '', grade: grade ?? '',
            }));
            return null;
        }

        const formula = bonus ? `${parsed.formula} + ${bonus}` : parsed.formula;
        const roll = new Roll(formula);
        await roll.evaluate();

        // Table P9's "to a minimum of 1" footnote: a negative Strength damage
        // adjustment can never reduce a hit below a single point.
        const total = minimumOne ? Math.max(1, roll.total) : roll.total;

        // An inferior-firepower weapon degrades a grade against tougher armour.
        // Reported rather than applied — the roller decides what it landed on —
        // and only when the caller actually knows the target's toughness.
        const degrade = firepower && targetToughness
            ? AlternityMathService.calculateFirepowerDegrade(parsed.category, firepower, targetToughness)
            : null;

        const content = await renderTemplate(DAMAGE_CARD, {
            name,
            grade,
            gradeLabel: grade ? game.i18n.localize(`ALTERNITY.Degree${grade.charAt(0).toUpperCase()}${grade.slice(1)}`) : '',
            damageType,
            firepower,
            category: parsed.category,
            categoryLabel: game.i18n.localize(`ALTERNITY.${parsed.category.charAt(0).toUpperCase()}${parsed.category.slice(1)}`),
            total,
            code: parsed.raw,
            rollHtml: await roll.render(),
            degrade,
        });

        const message = await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content,
            style: _rollStyle(),
            rolls: [roll],
            sound: CONFIG.sounds?.dice,
            flags: {
                [NAMESPACE]: {
                    damage: {
                        actorUuid: actor?.uuid ?? null,
                        name, total, damageType, firepower,
                        category: parsed.category,
                    },
                },
            },
            ..._whisperTo(whisper),
        });

        return { roll, total, category: parsed.category, degrade, message };
    },

    // -----------------------------------------------------------------------
    // Armour
    // -----------------------------------------------------------------------

    /**
     * Every source of protection this actor is carrying, in one shape.
     *
     * Four kinds of protection exist in the system and they are stored four
     * different ways, which is exactly why they are collected here rather than at
     * each call site: worn armour Items keep a `protection` triple, installed
     * cybertech keeps an `armorProtection` triple, heroes and supporting cast keep a
     * hand-entered triple on their AlternityCharacterState, and creatures keep
     * `naturalArmor`. They all hold the same thing — a die range per damage form —
     * and under the layering rule they compete rather than stack, so they have to
     * end up in one list to be compared.
     *
     * @param {Actor} actor
     * @returns {Promise<Array<{source: string, li: string, hi: string, en: string, toughness: string|null}>>}
     */
    async collectArmorRatings(actor) {
        if (!actor) return [];
        const ratings = [];

        // ── Worn armour, and installed cybertech ────────────────────────────
        for (const item of actor.items ?? []) {
            if (item.type === 'armor' && item.system?.isEquipped) {
                const p = item.system.protection ?? {};
                ratings.push({
                    source: item.name,
                    li: p.li ?? '', hi: p.hi ?? '', en: p.en ?? '',
                    toughness: item.system.toughness ?? null,
                });
            } else if (item.type === 'cybertech' && item.system?.isInstalled) {
                const p = item.system.armorProtection ?? {};
                // Damaged implants still read as installed; the plating is what is
                // rated, so a damaged one is left to the Gamemaster to un-install.
                if (!p.li && !p.hi && !p.en) continue;
                ratings.push({
                    source: item.name,
                    li: p.li ?? '', hi: p.hi ?? '', en: p.en ?? '',
                    toughness: null,
                });
            }
        }

        // ── The hand-entered triple on the hero / supporting-cast sheet ──────
        if (STATEFUL_TYPES.includes(actor.type)) {
            const state = await getAlternityState(actor);
            const worn = state?.armor ?? {};
            if (worn.li || worn.hi || worn.en) {
                ratings.push({
                    source: game.i18n.localize('ALTERNITY.Armor.Ratings'),
                    li: String(worn.li ?? ''), hi: String(worn.hi ?? ''), en: String(worn.en ?? ''),
                    toughness: null,
                });
            }
        }

        // ── Natural armour ──────────────────────────────────────────────────
        const natural = actor.system?.naturalArmor;
        if (natural && (natural.li || natural.hi || natural.en)) {
            ratings.push({
                source: game.i18n.localize('ALTERNITY.Armor.Natural'),
                li: natural.li ?? '', hi: natural.hi ?? '', en: natural.en ?? '',
                toughness: null,
            });
        }

        // ── An AI's CPU armour, which lives in its physical-form table ───────
        for (const row of actor.system?.physicalForm ?? []) {
            if (row?.kind !== 'CPU Armor' || !row.value) continue;
            // One printed value covering every form: the box is armoured, not
            // rated per damage type the way a suit is.
            ratings.push({
                source: row.name || game.i18n.localize('ALTERNITY.Armor.Label'),
                li: row.value, hi: row.value, en: row.value,
                toughness: null,
            });
        }

        return ratings;
    },

    /**
     * The toughness a target actually presents: its own grade, raised by anything
     * it is wearing that provides a better one.
     *
     * @param {Actor} actor
     * @param {Array<{toughness: string|null}>} [ratings] - Reuses an already-collected list.
     * @returns {Promise<string>}
     */
    async collectTargetToughness(actor, ratings = null) {
        const list = ratings ?? await this.collectArmorRatings(actor);
        return AlternityMathService.selectHighestToughness(
            [actor?.system?.toughness, ...list.map((r) => r.toughness)],
            DEFAULT_PERSONAL_TOUGHNESS,
        );
    },

    /**
     * Roll every protection the actor has against one damage form and return the
     * result the layering rule keeps.
     *
     * The dice are here rather than in `applyAlternityDamage` for the same reason
     * every other roll in the system is: the document classes stay free of dice, and
     * a roll the players are entitled to see becomes a real Foundry `Roll` that Dice
     * So Nice can animate and the chat card can show. A rating printed as a flat
     * number is not rolled at all.
     *
     * @param {object} config
     * @param {Actor}  config.actor
     * @param {string} config.damageForm - 'LI' | 'HI' | 'En'.
     * Each roll comes back paired with the protection that made it. Two anonymous
     * dice on a chat card do not tell a player whether their implant rolled at all,
     * which is the whole question a layered defence raises.
     *
     * @returns {Promise<{
     *   value: number, source: string, toughness: string,
     *   rolls: Array<{source: string, roll: Roll}>,
     *   considered: object[], modifierTrace: object[],
     * }>}
     */
    async rollArmorProtection(config) {
        const { actor, damageForm } = config;
        const empty = {
            value: 0, source: '', rolls: [], considered: [], modifierTrace: [],
            toughness: DEFAULT_PERSONAL_TOUGHNESS,
        };
        if (!actor) return empty;

        const ratings = await this.collectArmorRatings(actor);
        const toughness = await this.collectTargetToughness(actor, ratings);

        // An unknown form cannot be matched to a rating. Armour is rated per form and
        // nothing else, so guessing one would apply the wrong die.
        const key = FORM_KEYS[damageForm];
        if (!key) {
            if (ratings.length) {
                console.warn(
                    `[Alternity] ${actor.name} has armour but the damage form "${damageForm}" is not one of `
                    + `${DAMAGE_TYPES.join(' / ')}, so no rating could be rolled.`
                );
            }
            return { ...empty, toughness };
        }

        const candidates = [];
        const rolls = [];

        for (const rating of ratings) {
            const parsed = AlternityMathService.parseArmorValue(rating[key]);
            if (!parsed.isValid) {
                if (String(rating[key] ?? '').trim()) {
                    console.warn(
                        `[Alternity] ${actor.name}: could not read the ${damageForm} armour rating `
                        + `"${rating[key]}" on ${rating.source}. Expected a die range such as "d6-1".`
                    );
                }
                continue;
            }

            if (!parsed.isDie) {
                candidates.push({ source: rating.source, value: parsed.flat });
                continue;
            }

            const roll = new Roll(parsed.formula);
            await roll.evaluate();
            rolls.push({ source: rating.source, roll });
            candidates.push({ source: rating.source, value: roll.total });
        }

        const best = AlternityMathService.selectBestArmorRoll(candidates);
        return { ...best, rolls, toughness };
    },

    // -----------------------------------------------------------------------
    // Applying damage
    // -----------------------------------------------------------------------

    /**
     * Apply a rolled damage total to whoever the user has targeted, falling back
     * to their controlled tokens.
     *
     * Targets are preferred over selection because targeting is the deliberate
     * "this is who I am shooting" gesture; a player usually has their own token
     * selected while shooting someone else, and applying damage to themselves
     * would be the one outcome nobody wants.
     *
     * @param {object} damageData - The `flags['alternity-v2'].damage` payload.
     * @returns {Promise<number>} How many actors were damaged.
     */
    async applyDamageToTargets(damageData) {
        const { total, category, damageType, firepower, name } = damageData ?? {};
        if (!PERSONAL_DAMAGE_GRADES.includes(category)) {
            ui.notifications?.warn(game.i18n.localize('ALTERNITY.Roll.UnknownDamageCategory'));
            return 0;
        }

        const targeted = Array.from(game.user?.targets ?? []);
        const tokens = targeted.length ? targeted : (canvas?.tokens?.controlled ?? []);
        if (!tokens.length) {
            ui.notifications?.warn(game.i18n.localize('ALTERNITY.Roll.NoTargets'));
            return 0;
        }

        // The form ('LI'/'HI'/'En') and the track are separate arguments and must not
        // stand in for each other. This used to pass `damageType || category`, which
        // handed a track name ('wound') in as a damage form whenever the form was
        // blank — and armour then tried to resist "wound".
        const damageForm = DAMAGE_TYPES.includes(damageType) ? damageType : 'LI';
        const context = name ? `${name} damage` : 'Damage';

        let applied = 0;
        for (const token of tokens) {
            const target = token.actor;
            if (!target) continue;

            // Armour is rolled per target, before the damage is handed over: each
            // defender rolls their own protection, and the roll has to exist before
            // anything can be subtracted with it.
            const armor = await this.rollArmorProtection({ actor: target, damageForm });

            const options = {
                category,
                context,
                firepower: firepower ?? null,
                toughness: armor.toughness,
                armorRoll: armor.value,
                armorSource: armor.source,
                armorTrace: armor.modifierTrace,
            };

            const outcome = (typeof target.applyAlternityDamage === 'function'
                && STATEFUL_TYPES.includes(target.type))
                ? await target.applyAlternityDamage(total, damageForm, options)
                : await this._applyTrackDamage(target, total, damageForm, options);

            if (outcome) {
                await this._postMitigationCard(target, {
                    rawDamage: total, damageForm, armor, outcome, name,
                });
            }
            applied += 1;
        }

        if (applied) {
            ui.notifications?.info(game.i18n.format('ALTERNITY.Roll.DamageApplied', {
                total, category, count: applied,
            }));
        }
        return applied;
    },

    /**
     * Show what happened between the damage roll and the target's tracks — but only
     * when something did. A hit that lands in full is already fully described by the
     * damage card, and a card per unmitigated hit would be noise.
     *
     * This exists because the armour roll would otherwise be invisible: it happens
     * inside the Apply handler, long after the attacker's card was posted, and "why
     * did 6 wounds become 4" is not something a player should have to take on trust.
     *
     * @private
     */
    async _postMitigationCard(target, { rawDamage, damageForm, armor, outcome, name }) {
        const hasMitigation = outcome.isNegated
            || (outcome.armorAbsorbed ?? 0) > 0
            || (outcome.degradeSteps ?? 0) > 0
            || (outcome.mitigated ?? 0) > 0;
        if (!hasMitigation) return null;

        const grade = outcome.grade ?? outcome.category ?? 'wound';
        const secondary = outcome.secondary ?? { stun: 0, wound: 0 };
        const secondaryParts = [];
        if (secondary.wound) secondaryParts.push(`${secondary.wound} ${game.i18n.localize('ALTERNITY.Wound')}`);
        if (secondary.stun) secondaryParts.push(`${secondary.stun} ${game.i18n.localize('ALTERNITY.Stun')}`);

        const content = await renderTemplate(ARMOR_CARD, {
            targetName:  target.name,
            damageForm,
            rawDamage,
            grade,
            // 'none' is a degrade outcome, not a track, so it has no track label —
            // localizing it would render the raw key on the card.
            gradeLabel:  grade === 'none'
                ? game.i18n.localize('ALTERNITY.Armor.Negated')
                : game.i18n.localize(`ALTERNITY.${grade.charAt(0).toUpperCase()}${grade.slice(1)}`),
            isNegated:   outcome.isNegated ?? false,
            primary:     outcome.finalDamage ?? outcome.primary ?? 0,
            degradeSteps: outcome.degradeSteps ?? 0,
            armorAbsorbed: outcome.armorAbsorbed ?? 0,
            armorSource: armor.source,
            secondaryLabel: secondaryParts.join(' + '),
            // Rendered here rather than in the template: `Roll#render` is async and
            // Handlebars helpers are not. Each block is labelled with the protection
            // that rolled it, and `isWinner` marks the one that counted — with several
            // layers rolling, an unlabelled pile of dice answers nothing.
            armorRolls: await Promise.all(armor.rolls.map(async ({ source, roll }) => ({
                source,
                isWinner: source === armor.source,
                html: await roll.render(),
            }))),
            trace:       outcome.modifierTrace ?? [],
            name,
        });

        return ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: target }),
            content,
            style: _rollStyle(),
            rolls: armor.rolls.map((r) => r.roll),
            flags: { [NAMESPACE]: { mitigation: { targetUuid: target.uuid, rawDamage, damageForm } } },
        });
    },

    /**
     * Apply damage to an actor type that stores its own damage tracks rather than
     * keeping an AlternityCharacterState.
     *
     * The three shapes in play are all handled: creatures nest a `{value, max}`
     * pair per track, robots and AIs store a bare number per track, and warships
     * have their own graded pipeline in `applyWarshipDamage` which this defers to.
     *
     * The whole degrade → secondary → armour sequence is the math service's
     * `resolvePersonalDamage`, the same one the hero path uses — a creature's natural
     * armour and printed toughness were previously collected by nobody and applied by
     * nothing, so a bear's `d6 (LI)` hide stopped exactly zero damage.
     *
     * @param {Actor}  actor
     * @param {number} total       - Raw damage rolled.
     * @param {string} damageForm  - 'LI' | 'HI' | 'En'.
     * @param {object} options     - See `applyDamageToTargets`.
     * @returns {Promise<object|null>} The resolution, or null when nothing was applied.
     * @private
     */
    async _applyTrackDamage(actor, total, damageForm, options = {}) {
        const { category, context, name } = options;

        if (actor.type === 'warship') {
            ui.notifications?.info(game.i18n.localize('ALTERNITY.Roll.UseShipDamage'));
            return null;
        }
        if (actor.type === 'spaceship') {
            // Every hit on a core-rules spaceship lands on a named compartment,
            // chosen by a hit-location roll on the ship's own sheet — there is no
            // ship-wide track to add to.
            ui.notifications?.info(game.i18n.localize('ALTERNITY.Roll.UseCompartmentDamage'));
            return null;
        }

        const resolved = AlternityMathService.resolvePersonalDamage({
            rawDamage:   total,
            damageGrade: category,
            damageForm,
            firepower:   options.firepower ?? null,
            toughness:   options.toughness ?? null,
            armorRoll:   options.armorRoll ?? 0,
            armorSource: options.armorSource || game.i18n.localize('ALTERNITY.Armor.Label'),
            context:     context ?? 'Damage',
        });

        // Secondary damage is added on top of whatever armour let through, because
        // armour never touches it — but it is figured from the post-degrade primary,
        // which is why it comes back from the resolution rather than being recomputed.
        const perTrack = { stun: resolved.secondary.stun, wound: resolved.secondary.wound };
        if (!resolved.isNegated) {
            perTrack[resolved.grade] = (perTrack[resolved.grade] ?? 0) + resolved.primary;
        }

        // Creatures nest each track as {value, max}; robots and AIs store a plain
        // number. Which one this actor uses is read off the data rather than the
        // type, so a future actor type gets the right branch for free.
        const raw = actor.system?.damage ?? {};
        const isNested = typeof raw[category] === 'object' && raw[category] !== null;
        const updates = {};

        for (const [track, amount] of Object.entries(perTrack)) {
            if (!amount) continue;
            const max = actor.system?.durability?.[track]?.max ?? 0;
            if (!max) continue;
            const current = isNested ? (raw[track]?.value ?? 0) : (raw[track] ?? 0);
            const next = Math.min(max, current + amount);
            updates[isNested ? `system.damage.${track}.value` : `system.damage.${track}`] = next;
        }

        if (Object.keys(updates).length) await actor.update(updates);

        // The layering rule's discarded rolls are not part of the resolution — the
        // math service is only ever handed the winning value — so they have to be
        // carried across from the armour roll. Without this a layered target showed
        // two dice on the card and an explanation for only one of them, which reads
        // as "it didn't roll the others". `AlternityActor.applyAlternityDamage` does
        // the same for the hero path; a test covers both so they cannot drift.
        const modifierTrace = [...layeredArmorLines(options.armorTrace), ...resolved.modifierTrace];

        Hooks.callAll('alternity:damageApplied', actor, {
            rawDamage: total,
            finalDamage: resolved.primary,
            mitigated: resolved.mitigated,
            damageType: damageForm,
            category: resolved.grade,
            modifierTrace,
            woundLevelChanged: false,
            newWoundLevel: actor.system?.woundLevel ?? actor.system?.status ?? null,
            source: name ?? null,
        });

        return { ...resolved, modifierTrace };
    },

    // -----------------------------------------------------------------------
    // Dodge
    // -----------------------------------------------------------------------

    /**
     * Roll an Acrobatics-dodge defence and stash the resulting step adjustment on
     * the defender, where the next attack against them will find it.
     *
     * Stored rather than applied immediately because the rule is prospective —
     * the adjustment applies to "the next attack" — and the attacker may not even
     * have declared yet. It lives in a flag rather than on AlternityCharacterState
     * so that statblock actors, which have no such state, can dodge too.
     *
     * @param {object} config
     * @param {Actor}  config.actor
     * @param {object} config.scores   - The dodge check's triple score.
     * @param {number} [config.baseStep=0]
     * @param {object[]} [config.modifiers=[]]
     * @param {string} [config.name]   - Defaults to the Acrobatics-dodge label.
     * @returns {Promise<object|null>} The check payload, with `dodge` attached.
     */
    async rollDodge(config) {
        const { actor, scores, baseStep = 0, modifiers = [], name } = config;

        const payload = await this.rollCheck({
            actor,
            name: name ?? game.i18n.localize('ALTERNITY.Roll.Dodge'),
            context: game.i18n.localize('ALTERNITY.Roll.Defence'),
            scores,
            baseStep,
            modifiers,
        });
        if (!payload) return null;

        const dodge = AlternityMathService.calculateDodgeAdjustment(payload.degree);
        payload.dodge = dodge;

        await actor?.setFlag(NAMESPACE, 'pendingDodge', {
            steps: dodge.steps,
            degree: payload.degree,
            // Round number rather than a timestamp: the flag is cleared by the
            // next attack or the end of the round, and a combat round is the unit
            // the rule is written in.
            round: game.combat?.round ?? null,
        });

        ui.notifications?.info(game.i18n.format('ALTERNITY.Roll.DodgeResult', {
            degree: payload.degree,
            steps: dodge.steps > 0 ? `+${dodge.steps}` : String(dodge.steps),
        }));

        return payload;
    },

    /**
     * Read (and consume) a defender's pending dodge adjustment.
     *
     * Consumed on read because the rule spends it on one attack. A dodge left
     * over from an earlier round is discarded rather than honoured.
     *
     * @param {Actor} target
     * @returns {Promise<object[]>} Modifiers to add to the attacker's check.
     */
    async readPendingDodge(target) {
        const pending = target?.getFlag?.(NAMESPACE, 'pendingDodge');
        if (!pending) return [];

        await target.unsetFlag(NAMESPACE, 'pendingDodge');

        const currentRound = game.combat?.round ?? null;
        if (pending.round !== null && currentRound !== null && pending.round !== currentRound) {
            return [];
        }
        if (!pending.steps) return [];

        return [AlternityMathService.buildModifier(
            game.i18n.localize('ALTERNITY.Roll.Dodge'),
            pending.steps,
            game.i18n.format('ALTERNITY.Roll.DodgeReason', {
                target: target.name, degree: pending.degree,
            }),
        )];
    },

    // -----------------------------------------------------------------------
    // Target-derived attack modifiers
    // -----------------------------------------------------------------------

    /**
     * Modifiers an attack picks up from whoever it is aimed at: the target's
     * resistance modifier, and any dodge they rolled this round.
     *
     * Alternity has no armour class — a defender's ability scores become a step
     * penalty on the attacker's check — so this is where "defence" actually
     * enters an attack roll. Only fires when exactly one token is targeted;
     * with none or several there is no single defender to read a modifier off.
     *
     * @param {object} [options]
     * @param {string} [options.attackKind='ranged'] - 'melee' | 'ranged'. Creatures
     *        rate the two separately, and a melee attack is resisted by a
     *        different score than a shot.
     * @returns {Promise<{modifiers: object[], target: Actor|null}>}
     */
    async collectTargetModifiers(options = {}) {
        const { attackKind = 'ranged' } = options;
        const targets = Array.from(game.user?.targets ?? []);
        if (targets.length !== 1) return { modifiers: [], target: null };

        const target = targets[0].actor;
        if (!target) return { modifiers: [], target: null };

        const modifiers = [];
        const sys = target.system ?? {};

        // Creatures print a separate melee and ranged resistance, and a null there
        // means "no resistance modifier against this kind of attack" — which is a
        // different statement from zero, so it is left out entirely rather than
        // pushed as a 0.
        const perKind = sys.resistance?.[attackKind];
        const resistance = perKind ?? sys.resistanceModifier
            ?? (attackKind === 'melee' ? sys.strResistanceModifier : sys.dexResistanceModifier);

        if (typeof resistance === 'number' && resistance !== 0) {
            modifiers.push(AlternityMathService.buildModifier(
                game.i18n.localize('ALTERNITY.Modifier.Resistance'),
                resistance,
                game.i18n.format('ALTERNITY.Modifier.ResistanceReason', { target: target.name }),
            ));
        }

        // A species can make its owner harder to hit: the Weren's camouflage reads
        // "+1 step to ranged attacks vs. weren". This belongs beside the resistance
        // modifier because it is the same kind of thing - Alternity has no armour
        // class, so every "harder to hit" is a step penalty on the attacker's check.
        // Only abilities whose printed note states a step land here; the rest of a
        // species' abilities are prose a Gamemaster adjudicates.
        for (const item of Array.from(target.items ?? [])) {
            if (item.type !== 'species') continue;
            for (const ability of speciesDefenseModifiers(item.system, attackKind)) {
                modifiers.push(AlternityMathService.buildModifier(
                    ability.name,
                    ability.value,
                    game.i18n.format('ALTERNITY.Modifier.SpeciesReason', {
                        target: target.name, species: item.name,
                    }),
                ));
            }
        }

        modifiers.push(...await this.readPendingDodge(target));

        // The target's toughness travels with the modifiers so the attack card can
        // report a firepower shortfall on the spot, rather than the player discovering
        // at apply time that their pistol was never going to hurt a body tank. It is
        // read here because it is the target's property and this is the one place the
        // attack path already looks at the target.
        const toughness = await this.collectTargetToughness(target);

        return { modifiers, target, toughness };
    },
};

export default AlternityRollService;
