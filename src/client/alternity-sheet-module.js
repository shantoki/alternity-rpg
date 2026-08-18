/**
 * @file alternity-sheet-module.js
 * @description Phase 3 – Client UI: Character, NPC, and Vehicle sheets for Alternity.
 */

import {
    getAlternityState,
    saveAlternityState,
    ABILITY_TYPES,
    ABILITIES,
    WOUND_LEVELS,
    SKILL_DEFINITIONS,
    AlternityAbilitySet,
    AlternityCharacterState,
} from '../data/alternity-actor-data.js';
import {
    AlternityMathService,
    SUCCESS_DEGREES,
    CONDITION_STEP_MODIFIERS,
    RANGE_BANDS,
    PERSONAL_TOUGHNESS_CLASSES,
    DEFAULT_PERSONAL_TOUGHNESS,
} from '../services/alternity-math.js';
import { AlternityRollService } from '../services/alternity-roll-service.js';
import { bindActorSheetDragDrop, claimDropHandling, tabForItemType } from './alternity-drag-drop.js';
import { bindStatblockDragDrop } from './alternity-statblock-drops.js';
import { bindOnce } from './alternity-sheet-binding.js';
import { SHIP_TOUGHNESS_CLASSES, SHIP_HULL_TYPES, SHIP_STATUS_EFFECTS } from '../data/WarshipData.js';
import {
    SPACESHIP_HULL_TYPES,
    SPACESHIP_ARMOR_GRADES,
    SHIP_STATIONS,
    SHIP_SYSTEM_CATEGORIES,
    SHIP_COMPUTER_QUALITIES,
    SHIP_DAMAGE_TYPES,
    WEAPON_ARCS,
    DAMAGE_CONTROL_BONUS,
    FTL_DRIVE_TYPES,
    COMPARTMENT_KINDS,
    FIREPOWER_CLASSES,
} from '../data/SpaceshipData.js';
import {
    ROBOT_SIZES,
    ROBOT_PROCESSORS,
    ROBOT_CABLING,
    ROBOT_ABILITIES,
    ROBOT_PROFESSIONS,
    ROBOT_SYSTEM_CATEGORIES,
    CHASSIS_COST_MODES,
} from '../data/RobotData.js';
import {
    PROFESSIONS,
    NPC_QUALITY_TIERS,
    SUPPORTING_CAST_ROLES,
    REACTION_DEGREES,
    NPC_DAMAGE_TYPES,
} from '../data/NpcData.js';
import {
    CREATURE_CATEGORIES,
    DAMAGE_TYPES,
    CREATURE_ABILITIES,
    ANIMAL_SCALE_ABILITIES,
} from '../data/CreatureData.js';
import {
    AI_QUALITIES,
    AI_PROCESSORS,
    AI_AVATAR_PROGRAMS,
    AI_ABILITIES,
    AI_CORE_TYPES,
    AI_PHYSICAL_FORM_KINDS,
} from '../data/AIData.js';
import { renderTemplate, Roll, ChatMessage } from '../module-info.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NS = 'alt';

const WOUND_SEVERITY = Object.freeze({
    Healthy:  'healthy',
    Stunned:  'stunned',
    Wounded:  'wounded',
    Bleeding: 'bleeding',
    Down:     'down',
    Out:      'out',
});

/**
 * Outcome → CSS class. 'Marginal' is spelled out rather than read off
 * SUCCESS_DEGREES, which has no MARGINAL member: a Marginal result is only
 * reachable on an Action Check, where a would-be failure is downgraded to one, so
 * it is not one of the degrees `_calculateDegree` can return. Keying off the
 * missing constant put the whole map under the key `undefined`.
 */
const DEGREE_CLASSES = Object.freeze({
    'Marginal':                          'degree--marginal',
    [SUCCESS_DEGREES.ORDINARY]:          'degree--ordinary',
    [SUCCESS_DEGREES.GOOD]:              'degree--good',
    [SUCCESS_DEGREES.AMAZING]:           'degree--amazing',
    [SUCCESS_DEGREES.FAILURE]:           'degree--failure',
    [SUCCESS_DEGREES.CRITICAL_FAILURE]:  'degree--critical-failure',
});

const ABILITY_TYPE_ICONS = Object.freeze({
    [ABILITY_TYPES.STANCE]:  '⬡',
    [ABILITY_TYPES.PASSIVE]: '◈',
    [ABILITY_TYPES.ACTION]:  '◆',
});

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function pct(current, max) {
    if (!max || max <= 0) return '0%';
    return `${Math.min(100, Math.max(0, Math.round((current / max) * 100)))}%`;
}

function fmtMod(value) {
    if (value > 0) return `+${value}`;
    return String(value);
}

function safeInt(val, fallback = 0) {
    const n = parseInt(val, 10);
    return isFinite(n) ? n : fallback;
}

/**
 * Like safeInt, but keeps the fractional part. Ship acceleration is printed as
 * low as 0.001 Mpp and cruising speed as 1.5 AU/hr, so those fields cannot be
 * rounded on the way in.
 */
function safeFloat(val, fallback = 0) {
    const n = parseFloat(val);
    return isFinite(n) ? n : fallback;
}

/**
 * Write one changed form field back onto a document.
 *
 * The subtlety is array rows. A binding like `system.weapons.2.arc` expands to
 * `{system: {weapons: {2: {arc: …}}}}`, and Foundry's ArrayField *replaces* rather
 * than merges — so submitting that path on its own risks writing back an array
 * whose only populated slot is the edited row, silently discarding every other
 * row on the sheet. Sheets that submit the whole form (ApplicationV2's
 * `form.submitOnChange`, which the item sheet uses) are unaffected, because every
 * row is present in the payload. The ship sheets listen for individual `change`
 * events instead, so they need the array path rewritten into a read-modify-write
 * over a clone of the full array.
 *
 * @param {Document} document  - The document to update.
 * @param {HTMLElement} input  - The element that changed; must carry a `name`.
 * @param {object} arrayFields - Map whose keys are the document's array-valued
 *                               schema fields (the row-defaults table works).
 * @returns {Promise<Document>|undefined}
 */
function applySheetFieldChange(document, input, arrayFields = {}) {
    if (!input?.name) return undefined;

    // Only `type="number"` inputs are coerced. String-typed schema fields are
    // always bound to `type="text"`, so this can't turn a dice code into a number.
    const value = input.type === 'checkbox' ? input.checked
        : input.type === 'number' ? safeFloat(input.value, 0)
        : input.value;

    const arrayPath = /^system\.(\w+)\.(\d+)\.(.+)$/.exec(input.name);
    if (arrayPath && Object.hasOwn(arrayFields, arrayPath[1])) {
        const [, arrayKey, indexText, fieldPath] = arrayPath;
        const rows = foundry.utils.deepClone(document.system[arrayKey] ?? []);
        const row = rows[Number(indexText)];
        if (!row) return undefined;
        foundry.utils.setProperty(row, fieldPath, value);
        return document.update({ [`system.${arrayKey}`]: rows });
    }

    return document.update({ [input.name]: value });
}

// ---------------------------------------------------------------------------
// Shared roll plumbing for the statblock sheets
// ---------------------------------------------------------------------------
//
// Supporting cast, creatures, robots, AIs and spaceships all print scores and all
// need the same four things rollable: an ability, a skill, an attack, and the
// round's Action Check. None of them keep an AlternityCharacterState, so none of
// them can use the hero sheet's state-backed paths — but the *shape* of the work
// is identical, so it lives here once rather than five times over.
//
// Each sheet's static action handler is a two-liner that reads its own row shape
// and calls in here.

/**
 * Mount the roll panel into a sheet's `.alt-roll-mount`.
 *
 * @param {ApplicationV2} sheet - Must be rendered, and its template must contain
 *        a `.alt-roll-mount` element.
 * @param {object} check   - { name, scores, baseStep, modifiers?, rangeClass? }.
 * @param {string} context
 * @param {object} [options] - Forwarded to AlternityRollComponent.
 * @returns {AlternityRollComponent|null}
 */
function mountRoller(sheet, check, context, options = {}) {
    const mount = sheet.element?.querySelector(`.${NS}-roll-mount`);
    if (!mount) {
        console.warn(`[Alternity] ${sheet.constructor.name} has no .${NS}-roll-mount element.`);
        return null;
    }
    mount.hidden = false;
    mount.innerHTML = '';
    const roller = new AlternityRollComponent(mount, sheet.document, check, context, options);
    roller.render();
    mount.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return roller;
}

/**
 * Wire the roll panel's close event on a statblock sheet.
 *
 * Called from each sheet's `_onRender`. The hero sheet does this inside its own
 * `_activateListeners`; the statblock sheets have no such method, so this is the
 * whole of what they need.
 *
 * @param {ApplicationV2} sheet
 */
function bindRollMount(sheet) {
    const mount = sheet.element?.querySelector(`.${NS}-roll-mount`);
    if (!mount) return;
    mount.addEventListener('alternity:rollClosed', () => { mount.hidden = true; });
}

/**
 * Feat check on a bare ability score.
 *
 * Base step +1, because a check made against an ability rather than a trained
 * specialty is a feat check (core mechanics, "Base Situation Die").
 *
 * @param {ApplicationV2} sheet
 * @param {string} abilityKey - Key into `system.abilities`, any case.
 */
function rollStatblockAbility(sheet, abilityKey) {
    const raw = sheet.document.system?.abilities?.[abilityKey]
        ?? sheet.document.system?.abilities?.[abilityKey?.toLowerCase()]
        ?? sheet.document.system?.abilities?.[abilityKey?.toUpperCase()];

    if (typeof raw !== 'number' || raw <= 0) {
        ui.notifications?.warn(game.i18n.format('ALTERNITY.Roll.NoAbilityScore', {
            ability: abilityKey,
        }));
        return null;
    }

    return mountRoller(
        sheet,
        {
            name: game.i18n.format('ALTERNITY.Roll.AbilityFeatCheck', {
                ability: String(abilityKey).toUpperCase(),
            }),
            scores: AlternityMathService.calculateScoreRun(raw),
            baseStep: 1,
        },
        game.i18n.localize('ALTERNITY.Roll.FeatCheck'),
    );
}

/**
 * Roll this round's Action Check.
 *
 * Every statblock type derives an `actionCheck` triple in its own
 * `prepareDerivedData`, so the score is read from there rather than recomputed.
 * Marked `isActionCheck` so the roll service applies the rule that an Action
 * Check cannot fail.
 *
 * @param {ApplicationV2} sheet
 */
function rollStatblockActionCheck(sheet) {
    const sys = sheet.document.system ?? {};
    // Creatures store a flat `actionCheckScore` because the compendium prints one
    // that does not obey the derivation; everything else exposes the triple.
    const ac = sys.actionCheck
        ?? (sys.actionCheckScore ? AlternityMathService.calculateScoreRun(sys.actionCheckScore) : null);

    if (!ac || !ac.ordinary) {
        ui.notifications?.warn(game.i18n.localize('ALTERNITY.Roll.NoActionCheck'));
        return null;
    }

    return mountRoller(
        sheet,
        {
            name: game.i18n.localize('ALTERNITY.Roll.ActionCheck'),
            scores: { ordinary: ac.ordinary, good: ac.good, amazing: ac.amazing },
            baseStep: 0,
        },
        game.i18n.localize('ALTERNITY.Roll.ActionCheck'),
        { isActionCheck: true },
    );
}

/**
 * Roll a statblock attack row.
 *
 * A printed attack score already has the creature's or NPC's training folded into
 * it, so it is rolled at base step 0 like a trained specialty rather than at the
 * feat-check step. The row's three damage codes ride along as the check's damage
 * payload, so the resulting card offers whichever grade the roll earns.
 *
 * @param {ApplicationV2} sheet
 * @param {object} row - { name, score, scoreRun?, damageOrdinary, damageGood,
 *                         damageAmazing, damageType?, mode? }.
 * @param {object} [options]
 * @param {string} [options.attackKind='melee'] - Which resistance the target uses.
 */
async function rollStatblockAttack(sheet, row, options = {}) {
    if (!row) return null;

    // A printed run wins over the single score, because the books occasionally
    // print a run that does not obey the halve-and-quarter rule.
    const scores = AlternityMathService.parseScoreRun(row.scoreRun || row.score);
    if (!scores.isValid || scores.ordinary <= 0) {
        ui.notifications?.warn(game.i18n.format('ALTERNITY.Roll.NoAttackScore', {
            attack: row.name || game.i18n.localize('ALTERNITY.Roll.Attack'),
        }));
        return null;
    }

    const { modifiers, toughness } = await AlternityRollService.collectTargetModifiers({
        attackKind: options.attackKind ?? 'melee',
    });

    return mountRoller(
        sheet,
        {
            name: row.name || game.i18n.localize('ALTERNITY.Roll.Attack'),
            scores: { ordinary: scores.ordinary, good: scores.good, amazing: scores.amazing },
            baseStep: 0,
            modifiers,
        },
        game.i18n.localize('ALTERNITY.Roll.Attack'),
        {
            damage: {
                name: row.name || game.i18n.localize('ALTERNITY.Roll.Attack'),
                codes: {
                    ordinary: row.damageOrdinary ?? '',
                    good:     row.damageGood ?? '',
                    amazing:  row.damageAmazing ?? '',
                },
                damageType: row.damageType ?? '',
                firepower: row.firepower ?? null,
                // Only reported when a token is actually targeted; the degrade rule
                // needs both halves and a guessed toughness would misstate the damage.
                targetToughness: toughness ?? null,
                actorUuid: sheet.document.uuid,
            },
        },
    );
}

/**
 * Roll a statblock skill row.
 *
 * Two row shapes are in play and both are handled: creatures and ship stations
 * store a finished score (or a printed run), while robots and AIs store an
 * ability plus a rank and expect the score to be derived from them.
 *
 * @param {ApplicationV2} sheet
 * @param {object} row - { name, score?|scoreRun?, ability?, rank?, isBroad?, isSpecialty? }.
 * @param {object} [options]
 * @param {object[]} [options.modifiers=[]] - e.g. an AI's per-skill penalty.
 */
function rollStatblockSkill(sheet, row, options = {}) {
    if (!row) return null;

    const isBroad = row.isBroad ?? (row.isSpecialty === false);
    let scores;

    if (row.score !== undefined || row.scoreRun !== undefined) {
        const parsed = AlternityMathService.parseScoreRun(row.scoreRun || row.score);
        scores = { ordinary: parsed.ordinary, good: parsed.good, amazing: parsed.amazing };
    } else {
        const abilityKey = row.ability;
        const abilities = sheet.document.system?.abilities ?? {};
        const abilityScore = abilities[abilityKey]
            ?? abilities[String(abilityKey).toLowerCase()]
            ?? abilities[String(abilityKey).toUpperCase()]
            ?? 0;
        scores = AlternityMathService.calculateSkillScores(abilityScore, row.rank ?? 0);
    }

    if (!scores.ordinary) {
        ui.notifications?.warn(game.i18n.format('ALTERNITY.Roll.NoSkillScore', {
            skill: row.name || game.i18n.localize('ALTERNITY.Roll.UnnamedSkill'),
        }));
        return null;
    }

    return mountRoller(
        sheet,
        {
            name: row.name || game.i18n.localize('ALTERNITY.Roll.UnnamedSkill'),
            scores,
            // Broad skills roll at +1 step, trained specialties at 0.
            baseStep: isBroad ? 1 : 0,
            modifiers: options.modifiers ?? [],
        },
        row.name || game.i18n.localize('ALTERNITY.Roll.UnnamedSkill'),
    );
}

/**
 * Roll a dodge defence for a statblock actor.
 *
 * There is no skill list to look an Acrobatics-dodge rank up in, so this is the
 * untrained fallback the core rules give: half the Dexterity score at feat-check
 * step. A supporting-cast member who genuinely has the specialty should have it
 * as a skill row and be rolled from there.
 *
 * @param {ApplicationV2} sheet
 */
async function rollStatblockDefence(sheet) {
    const abilities = sheet.document.system?.abilities ?? {};
    const dex = abilities.dex ?? abilities.DEX ?? 0;
    if (!dex) {
        ui.notifications?.warn(game.i18n.format('ALTERNITY.Roll.NoAbilityScore', { ability: 'DEX' }));
        return null;
    }

    return AlternityRollService.rollDodge({
        actor: sheet.document,
        name: game.i18n.localize('ALTERNITY.Roll.Dodge'),
        scores: AlternityMathService.calculateSkillScores(dex, 0, { untrained: true }),
        baseStep: 1,
    });
}

// ---------------------------------------------------------------------------
// AlternityRollComponent
// ---------------------------------------------------------------------------

/**
 * The inline roll widget every sheet mounts into its `.alt-roll-mount` element.
 *
 * It is a *pre-roll* panel: its job is to show what is about to be rolled and
 * collect the two things only the player at the table can supply — the
 * Gamemaster's circumstance call, and (for a shot) which range band the target is
 * in — before handing the whole thing to AlternityRollService.
 *
 * The dice, the resolution and the chat card all belong to the service now. This
 * class used to own copies of all three, which is why the situation die was being
 * assembled in two places at once and only the copy inside the character sheet
 * ever worked.
 */
class AlternityRollComponent {
    /**
     * @param {HTMLElement} container - Mount point, cleared on render.
     * @param {Actor}  actor
     * @param {object} check   - { name, scores, baseStep, modifiers? }.
     * @param {string} context - Category label; filters which stances apply.
     * @param {object} [options]
     * @param {object}   [options.damage]     - Damage payload for the resulting card.
     * @param {object[]} [options.rangeBands] - [{ band, steps, distance }] from the weapon.
     * @param {boolean}  [options.isActionCheck]
     */
    constructor(container, actor, check, context, options = {}) {
        if (!container || !(container instanceof HTMLElement)) {
            throw new Error('[AlternityRollComponent] container must be an HTMLElement.');
        }
        if (!check?.scores || typeof check.scores.ordinary !== 'number') {
            throw new Error('[AlternityRollComponent] check.scores.ordinary must be a number.');
        }
        if (!context) throw new Error('[AlternityRollComponent] context is required.');

        this.container = container;
        this.actor     = actor;
        this.check     = check;
        this.context   = context;
        this.options   = options;
        this._result   = null;
    }

    async render() {
        // Live modifiers are shown before the roll so a player can see *why* their
        // step is what it is, rather than discovering it in the card afterwards.
        const standing = await AlternityRollService.collectActorModifiers(this.actor, {
            context: this.context,
        });

        const html = await renderTemplate("systems/alternity/templates/roll/roll-panel.hbs", {
            alt: NS,
            context: this.context,
            check: {
                ...this.check,
                baseStep: this.check.baseStep ?? 0,
            },
            standing,
            hasStanding: standing.length > 0,
            conditions: Object.entries(CONDITION_STEP_MODIFIERS).map(([key, steps]) => ({
                key, steps,
                label: game.i18n.localize(`ALTERNITY.Condition.${key}`),
                // 'Marginal' is the zero point of the ladder, so it is the default.
                isDefault: steps === 0,
            })),
            rangeBands: (this.options.rangeBands ?? []).map((b) => ({
                ...b,
                label: game.i18n.localize(`ALTERNITY.RangeBand.${b.band}`),
            })),
            hasRangeBands: (this.options.rangeBands ?? []).length > 0,
            hasDamage: !!this.options.damage,
        });
        this.container.innerHTML = html;
        this._bindEvents();
        return this;
    }

    /**
     * Collect the picks made in the panel and roll.
     * @returns {Promise<object|null>}
     */
    async execute() {
        const modifiers = [...(this.check.modifiers ?? [])];

        const conditionKey = this.container.querySelector(`.${NS}-roll-condition-select`)?.value;
        const conditionSteps = AlternityMathService.getConditionStepModifier(conditionKey);
        if (conditionSteps !== 0) {
            modifiers.push(AlternityMathService.buildModifier(
                game.i18n.localize('ALTERNITY.Roll.Circumstance'),
                conditionSteps,
                game.i18n.format('ALTERNITY.Roll.CircumstanceNamed', {
                    condition: game.i18n.localize(`ALTERNITY.Condition.${conditionKey}`),
                }),
            ));
        }

        // Free-numeric step field, kept alongside the condition ladder because
        // some modifiers in the book are quoted directly in steps (a weapon's
        // accuracy, a cover penalty) rather than as a named condition.
        const extraSteps = safeInt(this.container.querySelector(`.${NS}-roll-step-input`)?.value, 0);
        if (extraSteps !== 0) {
            modifiers.push(AlternityMathService.buildModifier(
                game.i18n.localize('ALTERNITY.Roll.ExtraSteps'),
                extraSteps,
                game.i18n.localize('ALTERNITY.Roll.ExtraStepsReason'),
            ));
        }

        const bandSelect = this.container.querySelector(`.${NS}-roll-range-select`);
        if (bandSelect?.value && RANGE_BANDS.includes(bandSelect.value)) {
            modifiers.push(...AlternityMathService.getRangeStepModifier(
                bandSelect.dataset.rangeClass, bandSelect.value,
            ).modifierTrace);
        }

        const result = await AlternityRollService.rollCheck({
            actor:    this.actor,
            name:     this.check.name,
            context:  this.context,
            scores:   this.check.scores,
            baseStep: this.check.baseStep ?? 0,
            modifiers,
            whisper:  !!this.container.querySelector(`.${NS}-roll-whisper`)?.checked,
            isActionCheck: !!this.options.isActionCheck,
            damage:   this.options.damage ?? null,
        });

        this._result = result;
        if (result) {
            this._showOutcome(result);
            this.container.dispatchEvent(new CustomEvent('alternity:rollResult', {
                bubbles: true,
                detail: result,
            }));
        }
        return result;
    }

    /**
     * Echo the outcome in the panel itself. The chat card is the record; this is
     * so the roller does not have to look away from the sheet to see what happened.
     * @private
     */
    _showOutcome(result) {
        const slot = this.container.querySelector(`.${NS}-roll-outcome-slot`);
        if (!slot) return;
        slot.hidden = false;
        slot.className = `${NS}-roll-outcome-slot ${DEGREE_CLASSES[result.degree] ?? ''}`;
        slot.textContent = `${result.degree} — ${result.finalValue} `
            + `${game.i18n.localize('ALTERNITY.Roll.VersusOrdinary')} ${result.scores.ordinary}`;
    }

    _bindEvents() {
        this.container.querySelector(`[data-action="roll"]`)?.addEventListener('click', () => this.execute());
        this.container.querySelector(`.${NS}-roll-close`)?.addEventListener('click', () => {
            this.container.innerHTML = '';
            this.container.dispatchEvent(new CustomEvent('alternity:rollClosed', { bubbles: true }));
        });
    }
}

// ---------------------------------------------------------------------------
// AlternityCharacterSheet
// ---------------------------------------------------------------------------

class AlternityCharacterSheet extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {
    /** @override */
    static get DEFAULT_OPTIONS() {
        return foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
            classes: [NS, `${NS}-sheet-app`, `${NS}-character-sheet`],
            tag: "form",
            window: {
                resizable: true,
                width: 540,
                height: 860
            },
            actions: {
                switchTab:      this._onTabAction,
                toggleAbility:  this._onToggleAbilityAction,
                deleteAbility:  this._onDeleteAbilityAction,
                useAbility:     this._onUseAbilityAction,
                addAbility:     this._onAddAbilityAction,
                setWound:       this._onSetWoundAction,
                quickRoll:      this._onQuickRollAction,
                rollActionCheck: this._onRollActionCheckAction,
                rollDefence:    this._onRollDefenceAction,
                rollWeaponDamage: this._onRollWeaponDamageAction,
                toggleRule:     this._onToggleRuleAction,
                rollSkill:      this._onRollSkillAction,
                addSkill:       this._onAddSkillAction,
                deleteSkill:    this._onDeleteSkillAction,
                addItem:        this._onAddItemAction,
                deleteItem:     this._onDeleteItemAction,
                editItem:       this._onEditItemAction,
                rollWeapon:     this._onRollWeaponAction,
                rollPerkCheck:  this._onRollPerkCheckAction,
                useCharge:      this._onUseChargeAction,
                toggleInstalled: this._onToggleInstalledAction,
                rollCyberCheck:  this._onRollCyberCheckAction,
                toggleLoaded:    this._onToggleLoadedAction,
                rollFXPower:     this._onRollFXPowerAction,
                rollMutation:    this._onRollMutationAction,
                purchaseBenefit: this._onPurchaseBenefitAction,
                refundBenefit:   this._onRefundBenefitAction,
                setPsionicEnergy: this._onPsionicPipAction,
                setLastResort:   this._onLastResortPipAction,
                // `editSkill` and `editState` are deliberately absent. They mark
                // *inputs*, and are handled by the `change` listener in
                // _onSheetChange. Registering them here bound them to undefined,
                // which ApplicationV2 would have thrown on had anyone clicked the
                // field rather than typed in it.
            }
        });
    }

    /** @override */
    static PARTS = {
        sheet: {
            template: "systems/alternity/templates/actor/actor-sheet.hbs"
        }
    };

    constructor(options = {}) {
        const isDocument = options instanceof foundry.abstract.Document;
        const actualOptions = isDocument ? (arguments[1] || {}) : options;
        if (isDocument) actualOptions.document = options;
        super(actualOptions);
        this._activeRoller = null;
        this._altState = null;
        this._activeTab = 'character';
        this._skillFilter = '';
    }

    /** @override */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        context.actor = this.document;
        context.system = this.document.system;
        context.alt = NS;
        
        // Load Alternity state
        this._altState = await getAlternityState(this.document) || new AlternityCharacterState({ actorId: this.document.id });
        const state    = this._altState;

        // Build rich abilities object. The buy range comes off the state rather than
        // being fixed at 4-14 in the template: it is the hero's *species'* range, and
        // several print scores outside the human span in both directions.
        const abilities = {};
        for (const ab of ABILITIES) {
            abilities[ab] = {
                label:     ab,
                score:     state.abilityScores[ab],
                ...state.abilityRange(ab),
                ...state.getAbilityData(ab)
            };
        }

        // Skills hierarchy
        const skillsByAbility = {};
        const psionicSkills = [];
        for (const ab of ABILITIES) {
            const allForAb = [
                ...SKILL_DEFINITIONS.filter(d => d.ability === ab).map(d => ({
                    ...d, rank: state.skills[d.id]?.rank ?? 0, scores: state.getSkillScores(d.id), isCustom: false
                })),
                ...state.customSkills.filter(s => s.ability === ab).map(s => ({
                    ...s, rank: s.rank ?? 0, scores: state.getSkillScores(s.id), isCustom: true
                }))
            ];
            skillsByAbility[ab] = allForAb;
        }
        for (const ab of ABILITIES) {
            const allForAb = skillsByAbility[ab];
            const nonPsionic = allForAb.filter(s => !s.isPsionic);
            const psionicOnly = allForAb.filter(s => s.isPsionic);
            psionicSkills.push(...psionicOnly);
            const hierarchy = [];
            const broads = nonPsionic.filter(s => !s.isSpecialty);
            for (const broad of broads) {
                const specialties = nonPsionic.filter(s => s.parent === broad.id);
                hierarchy.push({ ...broad, specialties });
            }
            const orphans = nonPsionic.filter(s => s.isSpecialty && !hierarchy.some(h => h.specialties.some(sp => sp.id === s.id)));
            if (orphans.length > 0) hierarchy.push({ id: `orphans-${ab}`, name: 'Other', isSpecialty: false, isOrphanContainer: true, specialties: orphans });
            skillsByAbility[ab] = hierarchy;
        }
        const psionicHierarchy = [];
        const psionicBroads = psionicSkills.filter(s => !s.isSpecialty);
        for (const broad of psionicBroads) {
            const specialties = psionicSkills.filter(s => s.parent === broad.id);
            psionicHierarchy.push({ ...broad, specialties });
        }

        context.abilities       = abilities;
        context.skillsByAbility = skillsByAbility;
        context.psionicHierarchy = psionicHierarchy;
        context.state           = state;
        // The four damage tracks (PHB Ch.3). This used to map over
        // `state.resources`, which AlternityCharacterState has never had — so it
        // always produced an empty array and the bars at the top of the sheet
        // rendered nothing at all.
        //
        // `label` is localized here rather than in the template: the markup used
        // `{{localize (concat 'ALTERNITY.' dur.label)}}`, and no `concat` helper is
        // registered in this codebase, so those labels resolved to nothing even
        // when the array was populated.
        const DURABILITY_TRACKS = [
            { key: 'stun',    labelKey: 'ALTERNITY.Durability.Stun' },
            { key: 'wound',   labelKey: 'ALTERNITY.Durability.Wound' },
            { key: 'mortal',  labelKey: 'ALTERNITY.Durability.Mortal' },
            { key: 'fatigue', labelKey: 'ALTERNITY.Durability.Fatigue' },
        ];
        context.durability = DURABILITY_TRACKS.map(({ key, labelKey }) => {
            const current = state.durability?.[key] ?? 0;
            const max     = state.durability?.[`${key}Max`] ?? 0;
            return { key, label: game.i18n.localize(labelKey), current, max, pct: pct(current, max) };
        });

        // Last resort points (PHB Ch.2). `max` is GM-entered — Table P6 did not
        // survive OCR — so the track renders whatever maximum the sheet holds.
        const lr = state.lastResort ?? { value: 0, max: 0, cost: 0 };
        context.lastResort = {
            ...lr,
            // Five boxes is the ceiling the book prints, because a Free Agent can
            // reach that many.
            pips: [...Array(Math.min(5, Math.max(0, lr.max))).keys()].map(i => i < lr.value),
        };

        // Ordered by the `sort` field rather than by the collection's own order, so
        // that dragging a row to a new position in a list actually sticks. Items
        // created before drag-ordering existed all carry sort 0, where a stable
        // sort leaves them in the creation order they have always displayed in.
        const ownedItems = (type) => this.document.items
            .filter(i => i.type === type)
            .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
        context.inventory = {
            weapons: ownedItems('weapon'),
            armor:   ownedItems('armor'),
            computers: ownedItems('computer'),
            perksFlaws: ownedItems('perkFlaw'),
            personalEquipment: ownedItems('personalEquipment'),
            cybertech: ownedItems('cybertech'),
            programs: ownedItems('program'),
            fxPowers: ownedItems('fx'),
            mutations: ownedItems('mutation'),
            achievementBenefits: ownedItems('achievementBenefit')
        };

        // A hero holds at most one species — `AlternityActor.removeOtherSpecies`
        // enforces that on drop — so this is a single item rather than a list. The
        // name falls back to the state's string for a hero who predates the Item type
        // or whose Gamemaster never dropped one.
        const speciesItem = this.document.items.find(item => item.type === 'species') ?? null;
        context.species = {
            item:   speciesItem,
            name:   speciesItem?.name || state.species || '',
            traits: speciesItem?.system?.traits ?? [],
        };

        // Active memory is derived from the owned computers' capacity and the
        // slot costs of the loaded programs (PHB Ch.10) — the software analogue
        // of the cyber tolerance track above. Called defensively for the same
        // reason: a live server can be running out-of-step JS.
        context.activeMemory = this.document.getActiveMemory?.() ?? null;

        // Mutation points are two separate pools: advantages spend mutation
        // points, drawbacks grant drawback points that must themselves be spent.
        // Totals come off the items so the sheet can't disagree with what's owned.
        const mutationItems = context.inventory.mutations;
        context.mutationPoints = {
            spent:     mutationItems.filter(i => i.system.isAdvantage).reduce((sum, i) => sum + (i.system.cost ?? 0), 0),
            available: state.mutations?.points ?? 0,
            drawbackGranted: mutationItems.filter(i => i.system.isDrawback).reduce((sum, i) => sum + (i.system.cost ?? 0), 0),
            drawbackBudget:  state.mutations?.drawbackPoints ?? 0,
        };

        // Cyber tolerance is derived from CON + the sizes of installed cybertech items
        // (PHB Ch.15), so the sheet reads it rather than storing it. Called defensively:
        // template and document-class changes can reach a live server out of step.
        context.cyberTolerance = this.document.getCyberTolerance?.({
            constitution: state.abilityScores.CON,
        }) ?? null;
        context.cyberToleranceTrack = context.cyberTolerance
            ? ['left', 'centre', 'right'].map(section => ({
                section,
                boxes: [...Array(context.cyberTolerance.sections[section]).keys()]
                    .map(i => i < context.cyberTolerance.filled[section]),
            }))
            : [];

        // Values the template has always rendered but nothing ever supplied, so they
        // showed blank: the Action Check block at the top of the sheet, actions per
        // round, the armor ratings, career and background. All five already lived on
        // AlternityCharacterState — only the hand-off was missing.
        context.actionCheck      = state.getActionCheckData();
        context.actionsPerRound  = state.getActionsPerRound();
        context.armor            = state.armor || { li: '', hi: '', en: '' };
        // Derived, and read-only on the sheet: a hero is an Ordinary-toughness target
        // unless what they are wearing says otherwise (a body tank makes them Good).
        context.toughness        = this.actor.system?.effectiveToughness
            ?? DEFAULT_PERSONAL_TOUGHNESS;
        context.raisesToughness  = context.toughness !== DEFAULT_PERSONAL_TOUGHNESS;
        context.career           = state.career || '';
        context.background       = state.background || '';

        context.woundLevel       = state.woundLevel;
        context.WOUND_LEVELS     = WOUND_LEVELS;
        context.WOUND_SEVERITY   = WOUND_SEVERITY;
        context.woundSeverity    = WOUND_SEVERITY[state.woundLevel] || 'healthy';
        context.woundPenalty     = state.getDamageStepPenalty();
        context.isIncapacitated  = state.woundLevel === 'Out';
        context.abilitiesList    = state.abilitySets.filter(a => a.type === ABILITY_TYPES.STANCE || a.type === ABILITY_TYPES.PASSIVE);
        context.actions          = state.abilitySets.filter(a => a.type === ABILITY_TYPES.ACTION);
        context.activeTab        = this._activeTab || 'character';
        context.skillFilter      = this._skillFilter || '';
        context.combatMovement   = state.combatMovement || { sprint: 0, run: 0, walk: 0, easySwim: 0, swim: 0, glide: 0, fly: 0 };
        context.personalData     = state.personalData || { age: '', height: '', weight: '', appearance: '', allegiance: '', socialStatus: '', contacts: '', enemies: '' };
        // The achievement track is stored on actor.system (CharacterData), not on
        // AlternityCharacterState — this used to read `state.achievementTrack`,
        // which does not exist, so the level silently rendered as 1 forever.
        const achievement = this.document.system?.achievementTrack ?? {};
        context.achievementTrack = {
            level:        achievement.level ?? 1,
            pointsSpent:  achievement.pointsSpent ?? 0,
            pointsStored: achievement.pointsStored ?? 0,
            checkmarks: [...Array(23).keys()].map(i => i < (achievement.level ?? 1))
        };
        context.features         = state.features || { usePsionics: false, useMutations: false, useCybertech: false };
        context.psionics         = state.psionics || { energy: { value: 0, max: 0 }, powers: [] };
        context.psionicEnergyTrack = [...Array(state.psionics?.energy?.max || 0).keys()].map(i => i < (state.psionics?.energy?.value || 0));
        context.mutations        = state.mutations || { 
            origin: '', uniqueness: '', points: 0, drawbackPoints: 0, 
            ordinary: '', good: '', amazing: '', 
            slightDrawbacks: '', moderateDrawbacks: '', extremeDrawback: '' 
        };
        context.cybertech        = state.cybertech || { tolerance: { value: 0, max: 0 }, cykosis: 0, gearInstalled: '' };
        context.ABILITY_TYPES    = ABILITY_TYPES;
        context.ACTION_TYPE      = ABILITY_TYPES.ACTION;
        context.ACTION_ICON      = ABILITY_TYPE_ICONS[ABILITY_TYPES.ACTION];
        context.ABILITY_TYPE_ICONS = ABILITY_TYPE_ICONS;
        context.fmtMod           = fmtMod;
        context.abilityCardTemplate = "systems/alternity/templates/actor/ability-card.hbs";

        return context;
    }

    /** @override */
    _onRender(context, options) {
        this._activateListeners(this.element);
        // Items dropped from a compendium, the sidebar or another sheet are copied
        // onto this actor; items dragged within a list are re-ordered.
        bindActorSheetDragDrop(this, this.element, {
            onDropped: (created) => {
                // Reveal the list the item landed in — otherwise a weapon dropped
                // while the Skills tab is open appears to have gone nowhere.
                const tab = tabForItemType(created[0]?.type);
                if (tab && tab !== this._activeTab) {
                    this._activeTab = tab;
                    this.render();
                }
            },
        });
    }

    _activateListeners(html) {
        // Split by what the listener is attached to, not by what it does.
        //
        // `html` is `this.element`, which is created once and then reused for the
        // life of the sheet — ApplicationV2 replaces the rendered *part* inside it.
        // So a listener added here on every render accumulates one copy per render,
        // and since `_onSheetChange` saves and re-renders, a single edit ended up
        // firing that cycle once per render the sheet had been through. These three
        // therefore go through `bindOnce`.
        //
        // Everything below them is attached to an element the template produced.
        // Those elements are thrown away and rebuilt by each render, taking their
        // listeners with them, so they must be re-attached every time.
        bindOnce(html, 'sheetListeners', () => {
            html.addEventListener('change', (e) => this._onSheetChange(e));
            html.addEventListener('alternity:rollResult', (e) => console.log('[AlternitySheet] Roll result:', e.detail));
            html.addEventListener('alternity:rollClosed', () => {
                const mount = html.querySelector(`.${NS}-roll-mount`);
                if (mount) mount.hidden = true;
                this._activeRoller = null;
            });
        });

        html.querySelector(`[data-field="name"]`)?.addEventListener('blur', (e) => this.actor.update({ name: e.target.textContent.trim() }));
        const searchInput = html.querySelector(`.${NS}-skills-search-input`);
        if (searchInput) {
            searchInput.value = this._skillFilter;
            searchInput.addEventListener('input', (e) => {
                this._skillFilter = e.target.value;
                this.constructor._onFilterSkillsAction.call(this, e, e.target);
            });
            if (this._skillFilter) this.constructor._onFilterSkillsAction.call(this, null, searchInput);
        }
        html.querySelectorAll(`.${NS}-ability-name[contenteditable="true"], .${NS}-ability-desc[contenteditable="true"]`).forEach(el => {
            el.addEventListener('blur', (e) => this._onAbilityEdit(e));
        });
        html.querySelectorAll(`.${NS}-custom-skill-name[contenteditable="true"]`).forEach(el => {
            el.addEventListener('blur', (e) => this._onCustomSkillNameEdit(e));
        });
    }

    async _onAbilityEdit(event) {
        const el = event.target;
        const ability = this._altState.abilitySets.find(a => a.id === el.dataset.abilityId);
        if (!ability) return;
        if (el.dataset.field === 'name') ability.name = el.textContent.trim() || 'Unnamed Ability';
        else if (el.dataset.field === 'description') ability.effectPayload.reason = el.textContent.trim();
        await saveAlternityState(this.actor, this._altState);
    }

    async _onCustomSkillNameEdit(event) {
        const custom = this._altState.customSkills.find(s => s.id === event.target.dataset.skillId);
        if (!custom) return;
        custom.name = event.target.textContent.trim() || 'New Skill';
        await saveAlternityState(this.actor, this._altState);
    }

    async _onSheetChange(e) {
        const input  = e.target;
        const action = input.dataset.action;
        if (action === 'editResource') {
            const key = input.dataset.resource;
            if (this._altState.durability.hasOwnProperty(key)) {
                this._altState.durability[key] = Math.max(0, safeInt(input.value, 0));
                this._altState._recalculateWoundLevel?.();
                await saveAlternityState(this.actor, this._altState);
                this.render();
            }
        } else if (action === 'editLastResort') {
            // `max` and `cost` come from Table P6, which did not survive OCR, so
            // they are entered rather than derived. Spent points are clamped to
            // the new maximum: lowering max below the current value would
            // otherwise leave the track showing more spent pips than it has.
            const field = input.dataset.field;
            if (field === 'max' || field === 'cost') {
                const raw = Math.max(0, safeInt(input.value, 0));
                this._altState.lastResort[field] = field === 'max' ? Math.min(5, raw) : raw;
                this._altState.lastResort.value = Math.min(
                    this._altState.lastResort.value,
                    this._altState.lastResort.max
                );
                await saveAlternityState(this.actor, this._altState);
                this.render();
            }
        } else if (action === 'editAbility') {
            this._altState.setAbilityScore(input.dataset.ability, safeInt(input.value, 0));
            await saveAlternityState(this.actor, this._altState);
            this.render(true);
        } else if (action === 'editState') {
            const val = input.type === 'checkbox' ? input.checked : input.value;
            foundry.utils.setProperty(this._altState, input.dataset.field, val);
            await saveAlternityState(this.actor, this._altState);
            if (input.dataset.field === 'profession' || input.dataset.field.startsWith('features.')) this.render(true);
        } else if (action === 'editArmor') {
            // Armor ratings are free text so they can hold die ranges ("d6-1"), which
            // is why they are not run through safeInt like the numeric fields above.
            const type = input.dataset.type;
            if (this._altState.armor && Object.hasOwn(this._altState.armor, type)) {
                this._altState.armor[type] = input.value.trim();
                await saveAlternityState(this.actor, this._altState);
            }
        } else if (action === 'editSkill') {
            this._altState.setSkillRank(input.dataset.skillId, safeInt(input.value, 0));
            await saveAlternityState(this.actor, this._altState);
            this.render();
        }
    }

    static _onTabAction(event, target) {
        this._activeTab = target.dataset.tab;
        this.render();
    }

    static async _onToggleAbilityAction(event, target) {
        const ability = this._altState.abilitySets.find(a => a.id === target.dataset.abilityId);
        if (!ability) return;
        ability.isActive ? ability.deactivate() : ability.activate();
        await saveAlternityState(this.actor, this._altState);
        this.render();
    }

    static async _onDeleteAbilityAction(event, target) {
        this._altState.removeAbility(target.dataset.abilityId);
        await saveAlternityState(this.actor, this._altState);
        this.render();
    }

    static async _onUseAbilityAction(event, target) {
        const ability = this._altState.abilitySets.find(a => a.id === target.dataset.abilityId);
        if (!ability || !ability.isActive) return;

        // The ability's payload carries a single Ordinary score, which the math
        // service expands into the triple the check needs. This used to hand the
        // panel a `baseValue` key it never read, so every ability roll opened a
        // panel with no score and threw when the Roll button was pressed.
        const scores = AlternityMathService.calculateScoreRun(
            ability.effectPayload?.baseValue ?? this._altState.abilityScores.WIL ?? 10
        );

        this._openRoller(
            { name: ability.name, scores, baseStep: ability.effectPayload?.baseStep ?? 0 },
            ability.triggerCondition?.context || game.i18n.localize('ALTERNITY.Roll.General'),
        );
    }

    static async _onAddAbilityAction(event, target) {
        this._altState.addAbility(new AlternityAbilitySet({ id: `ability-${Date.now()}`, name: `New ${target.dataset.type}`, type: target.dataset.type }));
        await saveAlternityState(this.actor, this._altState);
        this.render(true);
    }

    static async _onSetWoundAction(event, target) {
        this._altState.setWoundLevel(target.dataset.wound);
        await saveAlternityState(this.actor, this._altState);
        this.render();
    }

    /**
     * Feat check on a bare ability score (base step +1, per the core mechanic).
     *
     * The triple now comes from the math service instead of being derived inline —
     * the halve-and-quarter rule lives in exactly one place.
     */
    static _onQuickRollAction(event, target) {
        const ability = target.dataset.ability;
        const scores = AlternityMathService.calculateScoreRun(
            this._altState.abilityScores[ability] ?? 10
        );
        const context = target.dataset.context || game.i18n.localize('ALTERNITY.Roll.FeatCheck');
        this._openRoller(
            {
                name: game.i18n.format('ALTERNITY.Roll.AbilityFeatCheck', { ability }),
                scores,
                baseStep: 1,
            },
            context,
        );
    }

    /**
     * Roll this round's Action Check (core mechanics, "Action Economy").
     *
     * Base step 0, and it cannot fail: a result that would have failed becomes a
     * Marginal success, which the roll service applies. Kept separate from the
     * combat tracker's initiative roll so a hero can check their phase without
     * being in a combat encounter.
     */
    static _onRollActionCheckAction() {
        const ac = this._altState.getActionCheckData();
        this._openRoller(
            {
                name: game.i18n.localize('ALTERNITY.Roll.ActionCheck'),
                scores: { ordinary: ac.ordinary, good: ac.good, amazing: ac.amazing },
                baseStep: 0,
            },
            game.i18n.localize('ALTERNITY.Roll.ActionCheck'),
            { isActionCheck: true },
        );
    }

    /**
     * Roll a dodge defence (core mechanics, "Dodge Defense").
     *
     * Rolls Acrobatics-dodge and stores the resulting step adjustment on the hero,
     * where the next attack against them picks it up. Rolled directly rather than
     * through the panel: it is a reaction, and stopping to pick a circumstance
     * modifier for a reaction is not how it plays at the table.
     */
    static async _onRollDefenceAction() {
        await AlternityRollService.rollDodge({
            actor: this.actor,
            name: game.i18n.localize('ALTERNITY.Roll.Dodge'),
            scores: this._altState.getSkillScores('dex-dodge'),
            baseStep: this._altState.getSkillBaseStep('dex-dodge'),
        });
    }

    static async _onToggleRuleAction(event, target) {
        this._altState.setSpecialRule(target.dataset.ruleId, target.checked);
        await saveAlternityState(this.actor, this._altState);
        this.render();
    }

    static async _onPsionicPipAction(event, target) {
        const val = safeInt(target.dataset.value, 0);
        if (!this._altState.psionics) return;
        this._altState.psionics.energy.value = (this._altState.psionics.energy.value === val) ? val - 1 : val;
        this._altState.psionics.energy.value = Math.max(0, this._altState.psionics.energy.value);
        await saveAlternityState(this.actor, this._altState);
        this.render();
    }

    /**
     * Spend or restore a last resort point (PHB Ch.2 "Last Resorts").
     *
     * Same click-to-toggle behaviour as the psionic energy track: clicking the
     * pip you are already at steps back down by one, so a mis-click is undoable
     * without a separate control.
     */
    static async _onLastResortPipAction(event, target) {
        const val = safeInt(target.dataset.value, 0);
        if (!this._altState.lastResort) return;
        const current = this._altState.lastResort.value;
        const next    = (current === val) ? val - 1 : val;
        this._altState.lastResort.value = Math.min(
            this._altState.lastResort.max,
            Math.max(0, next)
        );
        await saveAlternityState(this.actor, this._altState);
        this.render();
    }

    static async _onAddSkillAction(event, target) {
        this._altState.addCustomSkill({ name: 'New Skill', ability: target.dataset.ability, isSpecialty: true, rank: 0 });
        await saveAlternityState(this.actor, this._altState);
        this.render();
    }

    static async _onDeleteSkillAction(event, target) {
        this._altState.removeCustomSkill(target.dataset.skillId);
        await saveAlternityState(this.actor, this._altState);
        this.render();
    }

    static async _onRollSkillAction(event, target) {
        const skillId = target.dataset.skillId;
        const skillDef = SKILL_DEFINITIONS.find(d => d.id === skillId)
            || this._altState.customSkills.find(s => s.id === skillId);
        if (!skillDef) return;

        const scores = this._altState.getSkillScores(skillId);

        // A score of zero means the skill is one that cannot be attempted
        // untrained at all, so there is nothing to roll under.
        if (scores.ordinary <= 0) {
            ui.notifications?.warn(game.i18n.format('ALTERNITY.Roll.CannotUseUntrainedNamed', {
                skill: skillDef.name,
            }));
            return;
        }

        this._openRoller(
            {
                name: skillDef.name,
                scores,
                baseStep: this._altState.getSkillBaseStep(skillId),
            },
            skillDef.name,
        );
    }

    static _onFilterSkillsAction(event, target) {
        const query = target.value.toLowerCase().trim();
        this.element.querySelectorAll(`.${NS}-skill-group`).forEach(group => {
            const gMatches = group.querySelector(`.${NS}-skill-group-header`)?.textContent.toLowerCase().includes(query);
            let visibleInGroup = 0;
            group.querySelectorAll(`.${NS}-skill-broad-container`).forEach(container => {
                const broadMatch = container.querySelector(`.${NS}-skill-roll-btn, .${NS}-skill-name`)?.textContent.toLowerCase().includes(query);
                let vSpecialties = 0;
                container.querySelectorAll(`.${NS}-skill-item.is-specialty`).forEach(sItem => {
                    const sMatch = gMatches || broadMatch || sItem.querySelector(`.${NS}-skill-roll-btn, .${NS}-custom-skill-name`)?.textContent.toLowerCase().includes(query);
                    sItem.hidden = !sMatch;
                    if (sMatch) vSpecialties++;
                });
                const showBroad = gMatches || broadMatch || vSpecialties > 0;
                container.querySelector(`.${NS}-skill-item.is-broad`).hidden = !showBroad;
                container.hidden = !showBroad && vSpecialties === 0;
                if (!container.hidden) visibleInGroup++;
            });
            group.hidden = visibleInGroup === 0 && !gMatches;
        });
    }

    /**
     * Mount the roll panel for one check.
     *
     * @param {object} check   - { name, scores, baseStep, modifiers?, rangeClass? }.
     * @param {string} context - Category label, e.g. 'Melee Attack'.
     * @param {object} [options] - Passed through to AlternityRollComponent
     *        (`damage`, `rangeBands`, `isActionCheck`).
     */
    _openRoller(check, context, options = {}) {
        const mount = this.element?.querySelector(`.${NS}-roll-mount`);
        if (!mount) {
            console.warn('[Alternity] Sheet has no .alt-roll-mount element to open the roll panel in.');
            return;
        }
        mount.hidden = false;
        mount.innerHTML = '';
        this._activeRoller = new AlternityRollComponent(mount, this.actor, check, context, options);
        this._activeRoller.render();
        mount.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    static async _onAddItemAction(event, target) {
        await this.actor.createEmbeddedDocuments('Item', [{ name: `New ${target.dataset.type}`, type: target.dataset.type }]);
    }

    static async _onDeleteItemAction(event, target) {
        const itemId = target.closest('[data-item-id]')?.dataset.itemId;
        if (itemId) await this.actor.deleteEmbeddedDocuments('Item', [itemId]);
    }

    static async _onEditItemAction(event, target) {
        this.actor.items.get(target.closest('[data-item-id]')?.dataset.itemId)?.sheet.render(true);
    }

    /**
     * Open the roll panel for a weapon attack.
     *
     * An Alternity attack is a roll-under check on the weapon's *governing
     * specialty* — Melee Weapons-blade, Modern Ranged Weapons-pistol and so on —
     * so the score and the base step both come from that skill. This used to roll
     * against the raw attack ability score at a base step chosen from the weapon
     * type, which ignored the hero's training entirely: a rank-6 blade specialist
     * and someone who had never held a sword rolled identically.
     *
     * The weapon's accuracy and the defender's resistance and dodge go in as step
     * modifiers, the range bands are offered in the panel, and the three damage
     * codes ride along so the resulting card can offer whichever grade is earned.
     */
    static async _onRollWeaponAction(event, target) {
        const item = this.actor.items.get(target.dataset.itemId
            ?? target.closest('[data-item-id]')?.dataset.itemId);
        if (!item || item.type !== 'weapon') return;

        const sys = item.system;
        const isMelee = ['Melee', 'Thrown'].includes(sys.weaponType);
        const skillId = sys.requiredSkill || (isMelee ? 'str-melee' : 'dex-ranged-mod');

        const scores = this._altState.getSkillScores(skillId);
        if (scores.ordinary <= 0) {
            ui.notifications?.warn(game.i18n.format('ALTERNITY.Roll.CannotUseUntrainedNamed', {
                skill: item.name,
            }));
            return;
        }

        const modifiers = [];
        if (sys.attackBonus) {
            modifiers.push(AlternityMathService.buildModifier(
                game.i18n.localize('ALTERNITY.Weapon.Accuracy'),
                sys.attackBonus,
                game.i18n.format('ALTERNITY.Weapon.AccuracyReason', { weapon: item.name }),
            ));
        }

        // Alternity's stand-in for an armour class: whoever is targeted hands the
        // attacker a step penalty from their resistance modifier, plus any dodge
        // they rolled this round.
        const { modifiers: targetModifiers, toughness } = await AlternityRollService.collectTargetModifiers({
            attackKind: isMelee ? 'melee' : 'ranged',
        });
        modifiers.push(...targetModifiers);

        this._openRoller(
            {
                name: item.name,
                scores,
                baseStep: this._altState.getSkillBaseStep(skillId),
                modifiers,
                rangeClass: sys.rangeClass,
            },
            isMelee
                ? game.i18n.localize('ALTERNITY.Roll.MeleeAttack')
                : game.i18n.localize('ALTERNITY.Roll.RangedAttack'),
            {
                // The target's toughness rides along so the damage card can report a
                // firepower shortfall — a pistol against a body tank loses a grade
                // before armour is even rolled (GM Guide Ch.11).
                damage: { ...item.getDamagePayload(), targetToughness: toughness ?? null },
                rangeBands: sys.rangeBands ?? [],
            },
        );
    }

    /**
     * Roll one damage grade straight off the inventory row, bypassing the attack
     * check. For the cases the attack card cannot cover: damage from an attack
     * rolled physically at the table, or a re-roll for a second target.
     */
    static async _onRollWeaponDamageAction(event, target) {
        const item = this.actor.items.get(target.dataset.itemId
            ?? target.closest('[data-item-id]')?.dataset.itemId);
        if (!item || item.type !== 'weapon') return;
        await item.rollDamage({ grade: target.dataset.grade ?? 'ordinary' });
    }

    static async _onRollPerkCheckAction(event, target) {
        const item = this.actor.items.get(target.dataset.itemId);
        if (!item || item.type !== 'perkFlaw' || !item.system.requiresCheck) return;
        const abilityKey = item.system.linkedAbility;
        if (!['STR', 'DEX', 'CON', 'INT', 'WIL', 'PER'].includes(abilityKey)) {
            ui.notifications?.warn(`${item.name} has no ability score to check against.`);
            return;
        }
        const scores = AlternityMathService.calculateScoreRun(
            this._altState.abilityScores[abilityKey] ?? 10
        );
        this._openRoller(
            { name: item.name, scores, baseStep: 1 },
            game.i18n.format('ALTERNITY.Roll.PerkCheck', { perk: item.name }),
        );
    }

    /**
     * Install or remove a piece of cyber gear (PHB Ch.15 "Installing Cyber Gear").
     *
     * Installation is refused outright when the gear would overflow the hero's cyber
     * tolerance track, and triggers a Constitution feat check when it pushes them past
     * the halfway mark — the point at which the body starts rejecting implants.
     */
    static async _onToggleInstalledAction(event, target) {
        const itemId = target.dataset.itemId ?? target.closest('[data-item-id]')?.dataset.itemId;
        const item   = this.actor.items.get(itemId);
        if (!item || item.type !== 'cybertech') return;

        const installing = !item.system.isInstalled;

        if (installing) {
            // Ask the actor what the track would look like with this piece fitted,
            // rather than doing the arithmetic here.
            const projected = this.actor.getCyberTolerance?.({
                alsoInstall:  item.id,
                constitution: this._altState?.abilityScores?.CON,
            });

            if (projected?.isOverloaded) {
                ui.notifications?.warn(
                    `${item.name}: ${game.i18n.localize('ALTERNITY.Cybertech.ToleranceFull')}`
                );
                return;
            }

            if (projected?.requiresFeatCheck) {
                // Not rolled here: the item update re-renders the sheet, which would tear
                // the roll panel back out. The card exposes its own rollCyberCheck button.
                ui.notifications?.info(
                    `${item.name}: ${game.i18n.localize('ALTERNITY.Cybertech.FeatCheckRequired')}`
                );
            }
        }

        await item.update({ 'system.isInstalled': installing });
    }

    /**
     * Roll the Constitution feat check that decides whether the body accepts a new
     * implant (PHB Ch.15 "Surgery Results"). Feat checks use base step +1.
     */
    static async _onRollCyberCheckAction(event, target) {
        const itemId = target.dataset.itemId ?? target.closest('[data-item-id]')?.dataset.itemId;
        const item   = this.actor.items.get(itemId);
        if (!item || item.type !== 'cybertech') return;

        const scores = AlternityMathService.calculateScoreRun(this._altState.abilityScores.CON ?? 10);
        this._openRoller(
            { name: item.name, scores, baseStep: 1 },
            game.i18n.localize('ALTERNITY.Cybertech.ToleranceCheck'),
        );
    }

    static async _onUseChargeAction(event, target) {
        const item = this.actor.items.get(target.dataset.itemId);
        if (!item || item.type !== 'personalEquipment') return;
        const current = item.system.currentCharges ?? 0;
        if (current <= 0) {
            ui.notifications?.warn(`${item.name} has no charges remaining.`);
            return;
        }
        await item.update({ 'system.currentCharges': current - 1 });
    }

    /**
     * Load or unload a program from the computer's active memory
     * (PHB Ch.10; Dataware Ch.2 "Running Programs").
     *
     * Loading is refused when the program would overflow the available slots —
     * the same guard `toggleInstalled` applies to the cyber tolerance track, and
     * for the same reason: the budget is the whole point of the mechanic.
     * Unloading is always allowed.
     */
    static async _onToggleLoadedAction(event, target) {
        const itemId = target.dataset.itemId ?? target.closest('[data-item-id]')?.dataset.itemId;
        const item   = this.actor.items.get(itemId);
        if (!item || item.type !== 'program') return;

        const loading = !item.system.isLoaded;

        if (loading) {
            const projected = this.actor.getActiveMemory?.({ alsoLoad: item.id });

            if (projected && projected.max === 0 && !projected.isUnlimited) {
                ui.notifications?.warn(
                    `${item.name}: ${game.i18n.localize('ALTERNITY.Program.NoComputer')}`
                );
                return;
            }

            if (projected?.isOverloaded) {
                ui.notifications?.warn(
                    `${item.name}: ${game.i18n.localize('ALTERNITY.Program.MemoryFull')}`
                );
                return;
            }
        }

        await item.update({ 'system.isLoaded': loading });
    }

    /**
     * Roll an FX power (Mindwalking; GM Guide Ch.16).
     *
     * A power is a skill, so this rolls under the power's own score — the
     * linked ability plus its rank — at the broad/specialty base step the item
     * derives. Energy is deliberately NOT deducted here: the cost is paid on
     * success *or* failure, but only once the roll resolves, and the roll panel
     * owns that outcome.
     */
    static async _onRollFXPowerAction(event, target) {
        const itemId = target.dataset.itemId ?? target.closest('[data-item-id]')?.dataset.itemId;
        const item   = this.actor.items.get(itemId);
        if (!item || item.type !== 'fx') return;

        if (!item.system.isUsable) {
            ui.notifications?.warn(`${item.name}: ${game.i18n.localize('ALTERNITY.FX.Untrained')}`);
            return;
        }
        if (!item.system.canAffordEnergy) {
            ui.notifications?.warn(`${item.name}: ${game.i18n.localize('ALTERNITY.FX.NoEnergy')}`);
            return;
        }

        const scores = item.system.scores ?? { ordinary: 0, good: 0, amazing: 0 };

        this._openRoller(
            { name: item.name, scores, baseStep: item.system.baseStep ?? 0 },
            `${item.name} (${item.system.broadSkill})`,
        );
    }

    /**
     * Roll a mutation's activation check (PHB Ch.13).
     *
     * This rolls the *untrained* fallback — half the linked ability score at a
     * +4 base situation die. A hero who actually has the related skill should
     * roll that skill from the Skills tab instead, which is why this is only
     * offered on mutations that need a check at all.
     */
    static async _onRollMutationAction(event, target) {
        const itemId = target.dataset.itemId ?? target.closest('[data-item-id]')?.dataset.itemId;
        const item   = this.actor.items.get(itemId);
        if (!item || item.type !== 'mutation') return;

        if (item.system.isPassive) {
            ui.notifications?.info(`${item.name}: ${game.i18n.localize('ALTERNITY.Mutation.Passive')}`);
            return;
        }
        if (item.system.linkedAbility === 'Varies') {
            ui.notifications?.warn(`${item.name} has no single ability to check against.`);
            return;
        }

        const scores = item.system.untrainedScores ?? { ordinary: 0, good: 0, amazing: 0 };

        this._openRoller(
            { name: item.name, scores, baseStep: item.system.untrainedBaseStep ?? 4 },
            game.i18n.format('ALTERNITY.Roll.MutationCheck', { mutation: item.name }),
        );
    }

    /**
     * Buy one more instance of an achievement benefit (PHB Ch.8).
     *
     * The item owns the eligibility rules, so this asks it rather than
     * re-deriving them: the level gate, the purchase cap, the one-per-level
     * rule and the price all differ per benefit and per profession.
     */
    static async _onPurchaseBenefitAction(event, target) {
        const itemId = target.dataset.itemId ?? target.closest('[data-item-id]')?.dataset.itemId;
        const item   = this.actor.items.get(itemId);
        if (!item || item.type !== 'achievementBenefit') return;

        // The achievement track lives on actor.system (CharacterData), NOT on
        // AlternityCharacterState — `pointsStored` is the unspent skill point pool.
        const track = this.actor.system?.achievementTrack ?? {};

        const verdict = item.system.getPurchaseVerdict({
            achievementLevel:     track.level ?? 1,
            availableSkillPoints: track.pointsStored ?? 0,
        });

        if (!verdict.canPurchase) {
            ui.notifications?.warn(`${item.name}: ${verdict.reasons[0]}`);
            return;
        }

        await item.update({ 'system.timesPurchased': (item.system.timesPurchased ?? 0) + 1 });
    }

    /** Undo a purchase — the counter is player-editable, so this just decrements. */
    static async _onRefundBenefitAction(event, target) {
        const itemId = target.dataset.itemId ?? target.closest('[data-item-id]')?.dataset.itemId;
        const item   = this.actor.items.get(itemId);
        if (!item || item.type !== 'achievementBenefit') return;

        const current = item.system.timesPurchased ?? 0;
        if (current <= 0) return;
        await item.update({ 'system.timesPurchased': current - 1 });
    }
}

// ---------------------------------------------------------------------------
// AlternityNpcSheet — the supporting cast
// ---------------------------------------------------------------------------

const NPC_ARRAY_FIELDS = Object.freeze({
    attacks: {
        name: '', score: 0, damageOrdinary: '', damageGood: '', damageAmazing: '',
        damageType: 'LI', range: '', notes: '',
    },
});

class AlternityNpcSheet extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {
    static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
        classes: [NS, `${NS}-sheet-app`, `${NS}-npc-sheet`],
        tag: "form",
        window: { resizable: true, width: 620, height: 800 },
        actions: {
            setWound:      this._onSetWoundAction,
            setNpcDamage:  this._onSetNpcDamageAction,
            addNpcRow:     this._onAddNpcRowAction,
            deleteNpcRow:  this._onDeleteNpcRowAction,
            rollAbility:     this._onRollAbilityAction,
            rollActionCheck: this._onRollActionCheckAction,
            rollAttack:      this._onRollAttackAction,
            rollDefence:     this._onRollDefenceAction,
        }
    });
    static PARTS = {
        sheet: { template: "systems/alternity/templates/actor/actor-npc-sheet.hbs" }
    };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const system = this.document.system;

        context.actor = this.document;
        context.system = system;
        context.alt = NS;
        context.woundSeverity = WOUND_SEVERITY[system.woundLevel] || 'healthy';
        context.WOUND_LEVELS = WOUND_LEVELS;
        context.WOUND_SEVERITY = WOUND_SEVERITY;

        // ── Choice lists ────────────────────────────────────────────────────
        context.qualityChoices = Object.entries(NPC_QUALITY_TIERS).map(([key, cfg]) => ({
            key,
            ...cfg,
            // The tier's own summary, so the Gamemaster can see what they are
            // picking: "as capable as a level 6 hero, average ability 11".
            hint: cfg.heroLevel === null
                ? game.i18n.format('ALTERNITY.Npc.TierMarginalHint', { average: cfg.averageAbility })
                : game.i18n.format('ALTERNITY.Npc.TierHint', {
                    level: cfg.heroLevel, average: cfg.averageAbility,
                }),
        }));
        context.professionChoices = PROFESSIONS;
        context.roleChoices = SUPPORTING_CAST_ROLES;
        context.reactionDegreeChoices = REACTION_DEGREES;
        context.damageTypeChoices = NPC_DAMAGE_TYPES;
        context.toughnessChoices = PERSONAL_TOUGHNESS_CLASSES;

        // ── Abilities ───────────────────────────────────────────────────────
        context.abilities = ['str', 'dex', 'con', 'int', 'wil', 'per'].map((key) => ({
            key,
            label: game.i18n.localize(`ALTERNITY.Ability.${key.toUpperCase()}`),
            value: system.abilities?.[key] ?? 0,
        }));

        // ── Damage tracks ───────────────────────────────────────────────────
        context.tracks = ['stun', 'wound', 'mortal', 'fatigue'].map((key) => {
            const track = system.durability?.[key] ?? { value: 0, max: 0 };
            return {
                key,
                label: game.i18n.localize(`ALTERNITY.${key.charAt(0).toUpperCase()}${key.slice(1)}`),
                value: track.value, max: track.max,
                pct: pct(track.value, track.max),
            };
        });

        // ── Movement ────────────────────────────────────────────────────────
        // Every rate is editable, but the statblock summary only names the ones
        // that are actually set — a walking NPC should not advertise a fly speed.
        context.movementKeys = ['sprint', 'run', 'walk', 'easySwim', 'swim', 'glide', 'fly']
            .map((key) => ({
                key,
                label: game.i18n.localize(`ALTERNITY.Movement.${key}`),
                value: system.movement?.[key] ?? 0,
            }));
        context.movementSummary = (system.movementRates ?? [])
            .map((r) => `${game.i18n.localize(`ALTERNITY.Movement.${r.key}`)} ${r.value}`)
            .join(', ');

        context.attackRows = system.attackRows ?? [];

        // The tier decides this on its own, so say so rather than letting the
        // profession select look as though it is being ignored.
        context.professionBonusSuppressed = system.qualityInfo?.isNonprofessional
            && system.profession !== 'Nonprofessional';

        return context;
    }

    _onRender(context, options) {
        // Bound once, not once per render: `this.element` outlives every render, so
        // an unguarded listener here stacks a copy each time and turns one edit into
        // one write per render the sheet has been through.
        bindOnce(this.element, 'sheetChange', () => {
            this.element.addEventListener('change', (e) => {
                applySheetFieldChange(this.document, e.target, NPC_ARRAY_FIELDS);
            });
        });
        bindRollMount(this);
        bindStatblockDragDrop(this, this.element, NPC_ARRAY_FIELDS);
    }

    static async _onSetWoundAction(event, target) {
        const woundLevel = target.dataset.wound;
        await this.document.update({ "system.woundLevel": woundLevel });
    }

    // -----------------------------------------------------------------------
    // Rolling
    // -----------------------------------------------------------------------

    static _onRollAbilityAction(event, target) {
        return rollStatblockAbility(this, target.dataset.ability);
    }

    static _onRollActionCheckAction() {
        return rollStatblockActionCheck(this);
    }

    /**
     * Roll an attack row. A supporting-cast attack with a range is a shot and is
     * resisted by the target's ranged resistance; one without is a melee attack.
     */
    static async _onRollAttackAction(event, target) {
        const row = this.document.system.attackRows?.[safeInt(target.dataset.index, -1)];
        return rollStatblockAttack(this, row, {
            attackKind: row?.range ? 'ranged' : 'melee',
        });
    }

    static async _onRollDefenceAction() {
        return rollStatblockDefence(this);
    }

    static async _onSetNpcDamageAction(event, target) {
        const track = target.dataset.track;
        const delta = safeInt(target.dataset.delta, 0);
        if (!['stun', 'wound', 'mortal', 'fatigue'].includes(track)) return;

        const max = this.document.system.durability?.[track]?.max ?? 0;
        const current = this.document.system.durability?.[track]?.value ?? 0;
        await this.document.update({
            [`system.durability.${track}.value`]: Math.min(max, Math.max(0, current + delta)),
        });
    }

    static async _onAddNpcRowAction(event, target) {
        const arrayKey = target.dataset.array;
        const defaults = NPC_ARRAY_FIELDS[arrayKey];
        if (!defaults) return;
        const current = foundry.utils.getProperty(this.document.system, arrayKey) ?? [];
        await this.document.update({
            [`system.${arrayKey}`]: [...current, foundry.utils.deepClone(defaults)],
        });
    }

    static async _onDeleteNpcRowAction(event, target) {
        const arrayKey = target.dataset.array;
        const idx = safeInt(target.dataset.index, -1);
        if (idx < 0 || !NPC_ARRAY_FIELDS[arrayKey]) return;
        const current = foundry.utils.getProperty(this.document.system, arrayKey) ?? [];
        await this.document.update({ [`system.${arrayKey}`]: current.filter((_, i) => i !== idx) });
    }
}

// ---------------------------------------------------------------------------
// AlternityVehicleSheet
// ---------------------------------------------------------------------------

class AlternityVehicleSheet extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {
    static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
        classes: [NS, `${NS}-sheet-app`, `${NS}-vehicle-sheet`],
        tag: "form",
        window: { resizable: true, width: 560, height: 600 }
    });
    static PARTS = {
        sheet: { template: "systems/alternity/templates/actor/actor-vehicle-sheet.hbs" }
    };
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        context.actor = this.document;
        context.system = this.document.system;
        context.alt = NS;
        context.vehicleTypeChoices = ['Ground', 'Air', 'Space', 'Water'];
        context.sizeChoices = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'];
        return context;
    }
    _onRender(context, options) {
        bindOnce(this.element, 'sheetChange', () => {
            this.element.addEventListener('change', (e) => {
                const input = e.target;
                if (input.name) {
                    const val = input.type === 'checkbox' ? input.checked : input.value;
                    this.document.update({ [input.name]: val });
                }
            });
        });
        // A vehicle has no attack or gear arrays to drop into — it is driven by a
        // character's own Vehicle Operation check. Bound anyway so a drop is
        // refused out loud instead of appearing to have worked.
        bindStatblockDragDrop(this, this.element, {});
    }
}

// ---------------------------------------------------------------------------
// AlternityWarshipSheet
// ---------------------------------------------------------------------------

const WARSHIP_ARRAY_FIELDS = Object.freeze({
    systems:  { category: 'Misc', name: '' },
    weapons:  { name: '', fireMode: 'Single', arc: 'Fore', firepowerClass: 'Medium', damageFormula: '1d6', damageType: 'lowImpact', damageGrade: 'wound' },
    defenses: { name: '' },
    sensors:  { name: '' },
    zones:    { label: '', hullPointLimit: 0 },
});

class AlternityWarshipSheet extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {
    static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
        classes: [NS, `${NS}-sheet-app`, `${NS}-warship-sheet`],
        tag: "form",
        window: { resizable: true, width: 700, height: 780 },
        actions: {
            addSystemRow:    this._onAddArrayRowAction,
            deleteSystemRow: this._onDeleteArrayRowAction,
            rollShipWeapon:  this._onRollShipWeaponAction,
            setDamage:       this._onSetDamageAction,
        }
    });

    static PARTS = {
        sheet: { template: "systems/alternity/templates/actor/actor-warship-sheet.hbs" }
    };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        context.actor = this.document;
        context.system = this.document.system;
        context.alt = NS;
        context.hullCategoryChoices = ['Military', 'Civilian'];
        context.hullTypeChoices = SHIP_HULL_TYPES;
        context.toughnessChoices = SHIP_TOUGHNESS_CLASSES;
        context.firepowerClassChoices = SHIP_TOUGHNESS_CLASSES;
        context.fireModeChoices = ['Single', 'Burst', 'Auto', 'Battery'];
        context.arcChoices = ['Fore', 'Aft', 'Port', 'Starboard', 'Turret', 'Fixed'];
        context.damageTypeChoices = ['lowImpact', 'highImpact', 'energy'];
        context.damageGradeChoices = ['stun', 'wound', 'mortal', 'critical'];
        context.systemCategoryChoices = ['Hull', 'Armor', 'Power', 'Engine', 'FTL', 'Support', 'Command', 'Sensors', 'Hangar', 'Misc'];
        context.shipStatusEffects = SHIP_STATUS_EFFECTS;
        return context;
    }

    _onRender(context, options) {
        bindOnce(this.element, 'sheetChange', () => {
            this.element.addEventListener('change', (e) => {
                applySheetFieldChange(this.document, e.target, WARSHIP_ARRAY_FIELDS);
            });
        });
        bindRollMount(this);
        bindStatblockDragDrop(this, this.element, WARSHIP_ARRAY_FIELDS);
    }

    static async _onAddArrayRowAction(event, target) {
        const arrayKey = target.dataset.array;
        const defaults = WARSHIP_ARRAY_FIELDS[arrayKey];
        if (!defaults) return;
        const current = foundry.utils.getProperty(this.document.system, arrayKey) ?? [];
        await this.document.update({ [`system.${arrayKey}`]: [...current, { ...defaults }] });
    }

    static async _onDeleteArrayRowAction(event, target) {
        const arrayKey = target.dataset.array;
        const idx = safeInt(target.dataset.index, -1);
        if (idx < 0) return;
        const current = foundry.utils.getProperty(this.document.system, arrayKey) ?? [];
        await this.document.update({ [`system.${arrayKey}`]: current.filter((_, i) => i !== idx) });
    }

    /**
     * Roll a warship weapon's damage.
     *
     * Warships run their own firepower ladder (SmallCraft..SuperHeavy) rather than
     * the core rules' Marginal..Amazing one, and the grade shift is applied when the
     * damage is *received* by `AlternityActor.applyWarshipDamage` — which needs the
     * defending ship's toughness — so no degrade is reported here.
     *
     * A warship weapon's grade can also be `critical`, which is a track the personal
     * and spaceship scales do not have. The damage card only understands the three
     * personal tracks, so the grade is carried in the card's label rather than being
     * squeezed into `fallbackCategory` and silently coming out as "wound".
     */
    static async _onRollShipWeaponAction(event, target) {
        const idx = safeInt(target.dataset.index, -1);
        const weapon = this.document.system.weapons?.[idx];
        if (!weapon) return;

        const isPersonalGrade = ['stun', 'wound', 'mortal'].includes(weapon.damageGrade);

        await AlternityRollService.rollDamage({
            actor: this.document,
            name: isPersonalGrade
                ? (weapon.name || game.i18n.localize('ALTERNITY.Spaceship.Weapon'))
                : `${weapon.name || game.i18n.localize('ALTERNITY.Spaceship.Weapon')} (${weapon.damageGrade})`,
            code: weapon.damageFormula || '1d6',
            damageType: weapon.damageType,
            firepower: weapon.firepowerClass,
            fallbackCategory: isPersonalGrade ? weapon.damageGrade : 'wound',
        });
    }

    static async _onSetDamageAction(event, target) {
        // Quick +/- adjuster for the damage tracks (point-based, unlike the
        // character sheet's discrete wound-level pips) — data-delta e.g. "1", "-1", "5", "-5".
        const track = target.dataset.track;
        const delta = safeInt(target.dataset.delta, 0);
        const current = this.document.system.damage?.[track];
        if (!current) return;
        const newVal = Math.min(current.max, Math.max(0, current.value + delta));
        await this.document.update({ [`system.damage.${track}.value`]: newVal });
    }
}

// ---------------------------------------------------------------------------
// AlternitySpaceshipSheet
// ---------------------------------------------------------------------------

/**
 * Default rows for each of the spaceship's inline tables. Keyed by the schema
 * field name so `data-array="weapons"` on a button is all the markup needs.
 */
const SPACESHIP_ARRAY_FIELDS = Object.freeze({
    compartments: {
        label: '', kind: 'Cargo', durability: 4,
        damage: { stun: 0, wound: 0, mortal: 0 },
        hitLow: 0, hitHigh: 0, hasLifeSupport: true, damageControl: 'None', systemsText: '',
    },
    weapons: {
        name: '', compartment: 0, arc: 'Fore', range: '',
        damageOrdinary: '', damageGood: '', damageAmazing: '',
        damageType: 'lowImpact', firepower: 'Amazing', actionsPerRound: 1,
        durabilityCost: 0, powerReq: 0, isOffline: false, notes: '',
    },
    defenses: {
        name: '', compartment: 0, isActive: false, effectText: '',
        durabilityCost: 0, powerReq: 0, isOffline: false, notes: '',
    },
    systems: {
        name: '', compartment: 0, category: 'Misc', range: '',
        durabilityCost: 0, powerReq: 0, isOffline: false, notes: '',
    },
    stations: {
        role: 'Helm', compartment: 0, crewName: '', skillName: '', skillScore: '',
    },
});

/** Which compartment tracks the +/- buttons can touch. */
const COMPARTMENT_TRACKS = Object.freeze(['stun', 'wound', 'mortal']);

class AlternitySpaceshipSheet extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {
    static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
        classes: [NS, `${NS}-sheet-app`, `${NS}-spaceship-sheet`],
        tag: "form",
        window: { resizable: true, width: 760, height: 820 },
        actions: {
            addShipRow:            this._onAddShipRowAction,
            deleteShipRow:         this._onDeleteShipRowAction,
            setCompartmentDamage:  this._onSetCompartmentDamageAction,
            clearCompartmentDamage: this._onClearCompartmentDamageAction,
            rollHitLocation:       this._onRollHitLocationAction,
            fillHitTable:          this._onFillHitTableAction,
            rollShipWeapon:        this._onRollShipWeaponAction,
            rollShipAttack:        this._onRollShipAttackAction,
            rollStation:           this._onRollStationAction,
            rollDurabilityCheck:   this._onRollDurabilityCheckAction,
        }
    });

    static PARTS = {
        sheet: { template: "systems/alternity/templates/actor/actor-spaceship-sheet.hbs" }
    };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const system = this.document.system;

        context.actor = this.document;
        context.system = system;
        context.alt = NS;

        // ── Choice lists ────────────────────────────────────────────────────
        context.hullCategoryChoices = ['Civilian', 'Military'];
        context.hullTypeChoices     = SPACESHIP_HULL_TYPES;
        context.compartmentKinds    = COMPARTMENT_KINDS;
        context.armorGradeChoices   = SPACESHIP_ARMOR_GRADES;
        context.damageControlChoices = Object.keys(DAMAGE_CONTROL_BONUS);
        context.ftlChoices          = Object.entries(FTL_DRIVE_TYPES)
            .map(([key, cfg]) => ({ key, ...cfg }));
        context.stationChoices      = SHIP_STATIONS;
        context.systemCategoryChoices = SHIP_SYSTEM_CATEGORIES;
        context.computerQualityChoices = SHIP_COMPUTER_QUALITIES;
        context.damageTypeChoices   = SHIP_DAMAGE_TYPES;
        context.arcChoices          = WEAPON_ARCS;
        context.firepowerChoices    = FIREPOWER_CLASSES;
        context.trackKeys           = COMPARTMENT_TRACKS;

        // ── Compartments ────────────────────────────────────────────────────
        // `compartmentDetails` is built in prepareDerivedData and already carries the
        // derived ratings, penalties and percentages. Only the presentation bits
        // (localised labels, per-track rows for the bar loop) are added here.
        context.compartments = (system.compartmentDetails ?? []).map((c) => ({
            ...c,
            tracks: COMPARTMENT_TRACKS.map((key) => ({
                key,
                label:     game.i18n.localize(`ALTERNITY.${key.charAt(0).toUpperCase()}${key.slice(1)}`),
                damage:    c.damage?.[key] ?? 0,
                rating:    c.ratings?.[key] ?? 0,
                remaining: c.remaining?.[key] ?? 0,
                pct:       c[`${key}Pct`] ?? 0,
            })),
            hitRangeLabel: c.hitHigh > c.hitLow ? `${c.hitLow}-${c.hitHigh}` : `${c.hitLow}`,
        }));

        // A compartment picker for the systems/stations tables, so a row points at a
        // real compartment instead of a number typed from memory.
        context.compartmentOptions = context.compartments.map((c) => ({
            number: c.number,
            label:  `C${c.number} — ${c.label || c.kind}`,
        }));

        // ── Hull budget ─────────────────────────────────────────────────────
        context.hullBudget = {
            hullSize:    system.hullSize,
            armorCost:   system.armorDurabilityCost,
            available:   system.durabilityAvailable,
            assigned:    system.totalDurability,
            unassigned:  system.durabilityUnassigned,
            isOver:      system.isOverDurability,
            countLimit:  system.compartmentLimit,
            count:       system.compartmentCount,
            isOverCount: system.isOverCompartmentLimit,
        };

        context.hitTableCoverage = system.hitTableCoverage;
        context.ftlStarfall = FTL_DRIVE_TYPES[system.ftl?.driveType]?.starfall ?? '';

        return context;
    }

    _onRender(context, options) {
        bindOnce(this.element, 'sheetChange', () => {
            this.element.addEventListener('change', (e) => {
                applySheetFieldChange(this.document, e.target, SPACESHIP_ARRAY_FIELDS);
            });
        });
        bindRollMount(this);
        bindStatblockDragDrop(this, this.element, SPACESHIP_ARRAY_FIELDS);
    }

    // -----------------------------------------------------------------------
    // Crew checks
    // -----------------------------------------------------------------------

    /**
     * Roll the crew check for a station.
     *
     * The station's skill score is stored as printed text ("9/4/2") because a
     * published ship quotes its crew's scores rather than deriving them from
     * character sheets, so it is parsed rather than computed. Base step 0: a
     * station is manned by someone with the specialty, or it is not manned.
     */
    static _onRollStationAction(event, target) {
        const row = this.document.system.stations?.[safeInt(target.dataset.index, -1)];
        if (!row) return null;

        const parsed = AlternityMathService.parseScoreRun(row.skillScore);
        if (!parsed.isValid) {
            ui.notifications?.warn(game.i18n.format('ALTERNITY.Spaceship.NoStationScore', {
                station: row.role ?? '',
            }));
            return null;
        }

        return mountRoller(
            this,
            {
                name: row.skillName || row.role,
                scores: { ordinary: parsed.ordinary, good: parsed.good, amazing: parsed.amazing },
                baseStep: 0,
            },
            game.i18n.format('ALTERNITY.Spaceship.StationCheck', {
                station: row.role ?? '', crew: row.crewName || '—',
            }),
        );
    }

    /**
     * Roll a compartment's durability check — the check its damage-control party
     * makes to keep it working (GM Guide Ch.11). The score is already derived on
     * the compartment, so this only has to roll it.
     */
    static _onRollDurabilityCheckAction(event, target) {
        const compartment = this.document.system.compartmentDetails?.[safeInt(target.dataset.index, -1)];
        if (!compartment) return null;

        const score = compartment.durabilityCheckScore ?? 0;
        if (score <= 0) {
            ui.notifications?.warn(game.i18n.localize('ALTERNITY.Spaceship.NoDurabilityCheck'));
            return null;
        }

        return mountRoller(
            this,
            {
                name: game.i18n.localize('ALTERNITY.Spaceship.DurabilityCheck'),
                scores: AlternityMathService.calculateScoreRun(score),
                baseStep: 0,
            },
            `C${compartment.number} — ${compartment.label || compartment.kind}`,
        );
    }

    /**
     * Roll the gunner's attack check for a ship weapon, with the achieved degree
     * selecting which of the weapon's three damage columns fires.
     *
     * Distinct from `rollShipWeapon` below, which rolls a *named* grade's damage
     * directly — that one is for when the gunner's check was made on their own
     * character sheet, which is the usual case for a crewed ship. This one is for
     * a ship whose weapon score is recorded on the ship itself.
     */
    static async _onRollShipAttackAction(event, target) {
        const idx = safeInt(target.dataset.index, -1);
        const weapon = this.document.system.weapons?.[idx];
        if (!weapon) return null;

        // A ship weapon's own row carries no attack score — the gunner supplies it —
        // so the score comes from whichever station is crewing the weapons post.
        const station = (this.document.system.stations ?? [])
            .find((s) => s.role === 'Weapons' && AlternityMathService.parseScoreRun(s.skillScore).isValid);

        const parsed = AlternityMathService.parseScoreRun(station?.skillScore);
        if (!parsed.isValid) {
            ui.notifications?.warn(game.i18n.localize('ALTERNITY.Spaceship.NoGunner'));
            return null;
        }

        return mountRoller(
            this,
            {
                name: weapon.name || game.i18n.localize('ALTERNITY.Spaceship.Weapon'),
                scores: { ordinary: parsed.ordinary, good: parsed.good, amazing: parsed.amazing },
                baseStep: 0,
            },
            game.i18n.localize('ALTERNITY.Roll.Attack'),
            {
                damage: {
                    name: weapon.name || game.i18n.localize('ALTERNITY.Spaceship.Weapon'),
                    codes: {
                        ordinary: weapon.damageOrdinary ?? '',
                        good:     weapon.damageGood ?? '',
                        amazing:  weapon.damageAmazing ?? '',
                    },
                    damageType: weapon.damageType ?? '',
                    firepower: weapon.firepower ?? null,
                    actorUuid: this.document.uuid,
                },
            },
        );
    }

    // -----------------------------------------------------------------------
    // Row management
    // -----------------------------------------------------------------------

    static async _onAddShipRowAction(event, target) {
        const arrayKey = target.dataset.array;
        const defaults = SPACESHIP_ARRAY_FIELDS[arrayKey];
        if (!defaults) return;
        const current = foundry.utils.getProperty(this.document.system, arrayKey) ?? [];
        await this.document.update({
            [`system.${arrayKey}`]: [...current, foundry.utils.deepClone(defaults)],
        });
    }

    static async _onDeleteShipRowAction(event, target) {
        const arrayKey = target.dataset.array;
        const idx = safeInt(target.dataset.index, -1);
        if (idx < 0 || !SPACESHIP_ARRAY_FIELDS[arrayKey]) return;
        const current = foundry.utils.getProperty(this.document.system, arrayKey) ?? [];
        await this.document.update({ [`system.${arrayKey}`]: current.filter((_, i) => i !== idx) });
    }

    // -----------------------------------------------------------------------
    // Compartment damage
    // -----------------------------------------------------------------------

    static async _onSetCompartmentDamageAction(event, target) {
        const idx = safeInt(target.dataset.index, -1);
        const track = target.dataset.track;
        const delta = safeInt(target.dataset.delta, 0);
        if (idx < 0 || !COMPARTMENT_TRACKS.includes(track)) return;

        const compartments = foundry.utils.deepClone(this.document.system.compartments ?? []);
        const compartment = compartments[idx];
        if (!compartment) return;

        // Clamp to the derived rating rather than letting damage run past the track.
        // Excess stun becoming wound (and wound becoming mortal) is a judged call the
        // GM makes at the table, so it is not applied automatically here.
        const ratings = AlternityMathService.calculateCompartmentRatings(compartment.durability);
        compartment.damage = compartment.damage ?? { stun: 0, wound: 0, mortal: 0 };
        compartment.damage[track] = Math.min(
            ratings[track],
            Math.max(0, (compartment.damage[track] ?? 0) + delta)
        );

        await this.document.update({ 'system.compartments': compartments });
    }

    static async _onClearCompartmentDamageAction(event, target) {
        const idx = safeInt(target.dataset.index, -1);
        if (idx < 0) return;
        const compartments = foundry.utils.deepClone(this.document.system.compartments ?? []);
        if (!compartments[idx]) return;
        compartments[idx].damage = { stun: 0, wound: 0, mortal: 0 };
        await this.document.update({ 'system.compartments': compartments });
    }

    // -----------------------------------------------------------------------
    // Hit location
    // -----------------------------------------------------------------------

    /**
     * Roll d20 on the ship's own hit table and report which compartment eats it.
     * A `data-sensor-shift` on the button carries the sensors operator's adjustment
     * (Ordinary/Good/Amazing on a System Operation-sensors check = +1/+2/+3).
     */
    static async _onRollHitLocationAction(event, target) {
        const compartments = this.document.system.compartmentDetails ?? [];
        if (!compartments.length) {
            ui.notifications?.warn(game.i18n.localize('ALTERNITY.Spaceship.NoCompartments'));
            return;
        }

        const sensorShift = safeInt(target.dataset.sensorShift, 0);
        const roll = await new Roll('1d20').evaluate();
        const result = AlternityMathService.resolveCompartmentHit(
            compartments, roll.total, { sensorShift }
        );

        let flavor;
        if (result.allDestroyed) {
            flavor = game.i18n.localize('ALTERNITY.Spaceship.AllCompartmentsWrecked');
        } else if (result.resolvedIndex === -1) {
            // Only reachable when the d20 bands don't tile 1-20 — the sheet warns
            // about that above the compartment list, but say so here too.
            flavor = game.i18n.format('ALTERNITY.Spaceship.NoCompartmentForRoll', {
                roll: result.adjustedRoll,
            });
        } else {
            const hit = compartments[result.resolvedIndex];
            const name = `C${hit.number} — ${hit.label || hit.kind}`;
            flavor = result.walkedPast.length
                ? game.i18n.format('ALTERNITY.Spaceship.HitAfterWreck', {
                    compartment: name,
                    wrecked: result.walkedPast.map((i) => `C${i + 1}`).join(', '),
                })
                : game.i18n.format('ALTERNITY.Spaceship.HitCompartment', { compartment: name });
        }

        await roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor: this.document }),
            flavor,
        });
    }

    /**
     * Fill every compartment's d20 band from Table G50.
     *
     * Overwrites whatever is there, so it is the "I'm designing a ship" button, not
     * the "I'm transcribing a statblock" one — a published ship's Random damage line
     * should be typed in as printed.
     */
    static async _onFillHitTableAction(event, target) {
        const compartments = foundry.utils.deepClone(this.document.system.compartments ?? []);
        if (!compartments.length) return;

        const table = AlternityMathService.calculateCompartmentHitTable(compartments.length);
        table.ranges.forEach((range, i) => {
            if (!compartments[i]) return;
            compartments[i].hitLow  = range.low;
            compartments[i].hitHigh = range.high;
        });

        await this.document.update({ 'system.compartments': compartments });

        if (table.isDerived) {
            ui.notifications?.info(game.i18n.format('ALTERNITY.Spaceship.HitTableDerived', {
                count: compartments.length,
            }));
        }
    }

    // -----------------------------------------------------------------------
    // Weapons
    // -----------------------------------------------------------------------

    /**
     * Roll one damage grade for a ship weapon. Which grade fires is decided by the
     * gunner's own skill check on their character sheet, so the button carries the
     * grade (`data-grade="good"`) rather than the sheet guessing.
     */
    static async _onRollShipWeaponAction(event, target) {
        const idx = safeInt(target.dataset.index, -1);
        const grade = target.dataset.grade ?? 'ordinary';
        const weapon = this.document.system.weapons?.[idx];
        if (!weapon) return;

        const formulaKey = `damage${grade.charAt(0).toUpperCase()}${grade.slice(1)}`;
        const formula = weapon[formulaKey];
        if (!formula) {
            ui.notifications?.warn(game.i18n.format('ALTERNITY.Spaceship.NoDamageFormula', {
                weapon: weapon.name || game.i18n.localize('ALTERNITY.Spaceship.Weapon'),
                grade,
            }));
            return;
        }

        // Routed through the roll service rather than rolling here: it strips the
        // damage code's grade letter, reads the track off it, and posts a card that
        // can actually be applied to a target. This used to strip the letter with a
        // local regex and post a bare Roll, so a ship's damage had to be typed into
        // the target's sheet by hand.
        //
        // Every spaceship has Amazing toughness (GM Guide Ch.11), which is what the
        // weapon's firepower is compared against.
        await AlternityRollService.rollDamage({
            actor: this.document,
            name: weapon.name || game.i18n.localize('ALTERNITY.Spaceship.Weapon'),
            code: formula,
            grade,
            damageType: weapon.damageType,
            firepower: weapon.firepower,
            targetToughness: 'Amazing',
        });
    }
}

// ---------------------------------------------------------------------------
// AlternityRobotSheet
// ---------------------------------------------------------------------------

const ROBOT_ARRAY_FIELDS = Object.freeze({
    systems: {
        name: '', category: 'Miscellaneous', quantity: 1, costMode: 'points',
        chassisPoints: 0, chassisPercent: 0, powerPoints: 0, cost: '', notes: '', isOffline: false,
    },
    skills: {
        name: '', isBroad: false, rank: 0, ranksLoaded: 0, isLoaded: true,
        skillPointCost: 0, ability: '',
    },
    perksFlaws: { name: '', kind: 'Perk', skillPointChange: 0, notes: '' },
});

/** The tracks the +/- buttons can touch. Fatigue only exists on some chassis. */
const ROBOT_TRACKS = Object.freeze(['stun', 'wound', 'mortal', 'fatigue']);

class AlternityRobotSheet extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {
    static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
        classes: [NS, `${NS}-sheet-app`, `${NS}-robot-sheet`],
        tag: "form",
        window: { resizable: true, width: 760, height: 840 },
        actions: {
            addRobotRow:      this._onAddRobotRowAction,
            deleteRobotRow:   this._onDeleteRobotRowAction,
            setRobotDamage:   this._onSetRobotDamageAction,
            clearRobotDamage: this._onClearRobotDamageAction,
            loadAllRanks:     this._onLoadAllRanksAction,
            rollAbility:      this._onRollAbilityAction,
            rollActionCheck:  this._onRollActionCheckAction,
            rollSkill:        this._onRollSkillAction,
            rollDefence:      this._onRollDefenceAction,
        }
    });

    static PARTS = {
        sheet: { template: "systems/alternity/templates/actor/actor-robot-sheet.hbs" }
    };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const system = this.document.system;

        context.actor = this.document;
        context.system = system;
        context.alt = NS;

        // ── Choice lists ────────────────────────────────────────────────────
        context.sizeChoices = Object.entries(ROBOT_SIZES).map(([key, cfg]) => ({ key, ...cfg }));
        context.processorChoices = Object.entries(ROBOT_PROCESSORS).map(([key, cfg]) => ({
            key,
            label: `PL${cfg.progressLevel} ${cfg.quality}`,
            ...cfg,
        }));
        context.cablingChoices = Object.entries(ROBOT_CABLING).map(([key, cfg]) => ({ key, ...cfg }));
        context.professionChoices = ROBOT_PROFESSIONS;
        context.systemCategoryChoices = ROBOT_SYSTEM_CATEGORIES;
        context.costModeChoices = CHASSIS_COST_MODES;
        context.abilityKeys = ROBOT_ABILITIES;

        // ── Abilities, each with the ceiling its hardware imposes ───────────
        context.abilities = ROBOT_ABILITIES.map((key) => ({
            key,
            label: game.i18n.localize(`ALTERNITY.Ability.${key}`),
            value: system.abilities?.[key] ?? 0,
            cap: system.abilityCaps?.[key] ?? null,
            isBreached: (system.abilityBreaches ?? []).includes(key),
            // Which component is doing the capping — worth naming, because the
            // fix is different: a bigger chassis versus a better processor.
            capSource: ['STR', 'DEX', 'CON'].includes(key)
                ? game.i18n.localize('ALTERNITY.Robot.CapChassis')
                : game.i18n.localize('ALTERNITY.Robot.CapProcessor'),
        }));

        // ── The four budgets, in one shape the template can loop over ───────
        const memory = system.memory ?? {};
        context.budgets = [
            {
                key: 'chassis',
                label: game.i18n.localize('ALTERNITY.Robot.ChassisPoints'),
                used: system.chassisSpent, max: system.chassisPoints,
                free: system.chassisFree, isOver: system.isOverChassis,
                hint: game.i18n.localize('ALTERNITY.Robot.ChassisPointsHint'),
            },
            {
                key: 'power',
                label: game.i18n.localize('ALTERNITY.Robot.Power'),
                used: system.powerConsumed, max: system.powerGenerated,
                free: system.powerSurplus, isOver: system.isPowerDeficit,
                // Deliberately a warning rather than an error: an over-drawn robot
                // is legal, it just has to shut things down.
                isSoft: true,
                hint: game.i18n.localize('ALTERNITY.Robot.PowerHint'),
            },
            {
                key: 'memory',
                label: game.i18n.localize('ALTERNITY.Robot.Memory'),
                used: memory.used, max: memory.isUnlimited ? '∞' : memory.max,
                free: memory.isUnlimited ? '∞' : memory.remaining,
                isOver: memory.isOverloaded,
                hint: game.i18n.localize('ALTERNITY.Robot.MemoryHint'),
            },
            {
                key: 'skillPoints',
                label: game.i18n.localize('ALTERNITY.Robot.SkillPoints'),
                used: system.skillPoints?.spent, max: system.skillPoints?.total,
                free: system.skillPoints?.remaining, isOver: system.skillPoints?.isOverspent,
                hint: game.i18n.localize('ALTERNITY.Robot.SkillPointsHint'),
            },
        ];

        // ── Damage tracks ───────────────────────────────────────────────────
        context.tracks = ROBOT_TRACKS
            // A robot has no fatigue track unless it was built with biological or
            // synthetic-tissue actuators, so the row is omitted rather than zeroed.
            .filter((key) => key !== 'fatigue' || system.hasFatigue)
            .map((key) => {
                const track = system.durability?.[key] ?? { value: 0, max: 0 };
                return {
                    key,
                    label: game.i18n.localize(`ALTERNITY.${key.charAt(0).toUpperCase()}${key.slice(1)}`),
                    value: track.value, max: track.max,
                    pct: pct(track.value, track.max),
                };
            });

        context.systemRows = system.systemDetails ?? [];
        context.skillRows  = (system.skills ?? []).map((skill, index) => ({
            ...skill,
            index,
            isOverRanked: system.maxSkillRank !== null && !skill.isBroad
                && (skill.rank ?? 0) > system.maxSkillRank,
            // Slots this skill is holding right now.
            slots: skill.isLoaded === false ? 0
                : skill.isBroad ? 1 : (skill.ranksLoaded ?? 0),
        }));
        context.perkFlawRows = (system.perksFlaws ?? []).map((row, index) => ({ ...row, index }));

        context.limbsBlocked = system.hasIllegalLimbs;
        context.processorInfo = system.processorInfo;
        // `powerModifier: null` means the cabling physically cannot carry power —
        // optic cables are not wires, nerves are cells — which is a different thing
        // from a modifier of 0. Resolved here because Handlebars cannot tell a null
        // apart from a zero in an {{#if}}.
        context.cablingInfo = system.cablingInfo
            ? { ...system.cablingInfo, canPowerBoost: system.cablingInfo.powerModifier !== null }
            : null;

        return context;
    }

    _onRender(context, options) {
        bindOnce(this.element, 'sheetChange', () => {
            this.element.addEventListener('change', (e) => {
                applySheetFieldChange(this.document, e.target, ROBOT_ARRAY_FIELDS);
            });
        });
        bindRollMount(this);
        bindStatblockDragDrop(this, this.element, ROBOT_ARRAY_FIELDS);
    }

    // -----------------------------------------------------------------------
    // Rolling
    // -----------------------------------------------------------------------

    static _onRollAbilityAction(event, target) {
        return rollStatblockAbility(this, target.dataset.ability);
    }

    static _onRollActionCheckAction() {
        return rollStatblockActionCheck(this);
    }

    /**
     * Roll a skill row.
     *
     * Refused when the skill is not in active memory: a robot that has swapped a
     * skill out cannot use it, which is the entire point of the memory budget.
     * Partially-loaded skills roll at the ranks that are actually resident, not at
     * the ranks the robot owns.
     */
    static _onRollSkillAction(event, target) {
        const row = this.document.system.skills?.[safeInt(target.dataset.index, -1)];
        if (!row) return null;

        if (row.isLoaded === false) {
            ui.notifications?.warn(game.i18n.format('ALTERNITY.Robot.SkillNotLoaded', {
                skill: row.name,
            }));
            return null;
        }

        const effectiveRank = row.isBroad ? (row.rank ?? 0) : (row.ranksLoaded ?? 0);
        return rollStatblockSkill(this, { ...row, rank: effectiveRank });
    }

    static async _onRollDefenceAction() {
        return rollStatblockDefence(this);
    }

    // -----------------------------------------------------------------------
    // Row management
    // -----------------------------------------------------------------------

    static async _onAddRobotRowAction(event, target) {
        const arrayKey = target.dataset.array;
        const defaults = ROBOT_ARRAY_FIELDS[arrayKey];
        if (!defaults) return;
        const current = foundry.utils.getProperty(this.document.system, arrayKey) ?? [];
        await this.document.update({
            [`system.${arrayKey}`]: [...current, foundry.utils.deepClone(defaults)],
        });
    }

    static async _onDeleteRobotRowAction(event, target) {
        const arrayKey = target.dataset.array;
        const idx = safeInt(target.dataset.index, -1);
        if (idx < 0 || !ROBOT_ARRAY_FIELDS[arrayKey]) return;
        const current = foundry.utils.getProperty(this.document.system, arrayKey) ?? [];
        await this.document.update({ [`system.${arrayKey}`]: current.filter((_, i) => i !== idx) });
    }

    // -----------------------------------------------------------------------
    // Damage
    // -----------------------------------------------------------------------

    static async _onSetRobotDamageAction(event, target) {
        const track = target.dataset.track;
        const delta = safeInt(target.dataset.delta, 0);
        if (!ROBOT_TRACKS.includes(track)) return;

        const max = this.document.system.durability?.[track]?.max ?? 0;
        const current = this.document.system.damage?.[track] ?? 0;
        await this.document.update({
            [`system.damage.${track}`]: Math.min(max, Math.max(0, current + delta)),
        });
    }

    static async _onClearRobotDamageAction() {
        await this.document.update({
            'system.damage': { stun: 0, wound: 0, mortal: 0, fatigue: 0 },
        });
    }

    // -----------------------------------------------------------------------
    // Memory
    // -----------------------------------------------------------------------

    /**
     * Load a skill fully into active memory, or unload it entirely.
     *
     * Partial loads are legal and often necessary — the whole point of the memory
     * budget is that a robot frequently cannot hold its own kit at once — so the
     * ranks field stays editable. This is just the common case as one click.
     */
    static async _onLoadAllRanksAction(event, target) {
        const idx = safeInt(target.dataset.index, -1);
        if (idx < 0) return;
        const skills = foundry.utils.deepClone(this.document.system.skills ?? []);
        const skill = skills[idx];
        if (!skill) return;

        const isFullyLoaded = skill.isLoaded && (skill.isBroad || skill.ranksLoaded >= skill.rank);
        skill.isLoaded = !isFullyLoaded;
        skill.ranksLoaded = isFullyLoaded ? 0 : (skill.rank ?? 0);

        await this.document.update({ 'system.skills': skills });
    }
}

// ---------------------------------------------------------------------------
// AlternityAISheet
// ---------------------------------------------------------------------------

const AI_ARRAY_FIELDS = Object.freeze({
    physicalForm: { name: '', kind: 'CPU Armor', skill: '', value: '' },
    gridPrograms: { name: '', quality: 'Ordinary', slots: 0, effect: '', isLoaded: true, isAIDisabled: false },
    skills:       { name: '', isBroad: false, rank: 0, ranksLoaded: 0, isLoaded: true, ability: '' },
    remotes:      { name: '', quantity: 1, progressLevel: 6, statblock: '', notes: '' },
});

/** An AI has no fatigue track — its avatar is software and does not get tired. */
const AI_TRACKS = Object.freeze(['stun', 'wound', 'mortal']);

/** Every ability a skill row can hang off, including the three an AI is barred from. */
const AI_ALL_ABILITIES = Object.freeze(['STR', 'DEX', 'CON', 'INT', 'WIL', 'PER']);

class AlternityAISheet extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {
    static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
        classes: [NS, `${NS}-sheet-app`, `${NS}-ai-sheet`],
        tag: "form",
        window: { resizable: true, width: 780, height: 860 },
        actions: {
            addAIRow:       this._onAddAIRowAction,
            deleteAIRow:    this._onDeleteAIRowAction,
            setAIDamage:    this._onSetAIDamageAction,
            clearAIDamage:  this._onClearAIDamageAction,
            loadAllAIRanks: this._onLoadAllAIRanksAction,
            rollAbility:      this._onRollAbilityAction,
            rollActionCheck:  this._onRollActionCheckAction,
            rollSkill:        this._onRollSkillAction,
            rollGridSkill:    this._onRollGridSkillAction,
        }
    });

    static PARTS = {
        sheet: { template: "systems/alternity/templates/actor/actor-ai-sheet.hbs" }
    };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const system = this.document.system;

        context.actor = this.document;
        context.system = system;
        context.alt = NS;

        // ── Choice lists ────────────────────────────────────────────────────
        context.qualityChoices = AI_QUALITIES;
        context.coreTypeChoices = AI_CORE_TYPES;
        context.physicalFormKindChoices = AI_PHYSICAL_FORM_KINDS;
        context.allAbilityChoices = AI_ALL_ABILITIES;
        context.processorChoices = Object.entries(AI_PROCESSORS).map(([key, cfg]) => ({
            key,
            label: `PL${cfg.progressLevel} ${cfg.quality}`,
            ...cfg,
        }));
        context.avatarProgramChoices = Object.entries(AI_AVATAR_PROGRAMS)
            .map(([key, cfg]) => ({ key, label: cfg.label }));
        context.avatarProgramLabel = AI_AVATAR_PROGRAMS[system.avatarProgram]?.label ?? '';

        // ── Abilities, split by what actually owns them ─────────────────────
        // The left group is the AI; the right group is the shadow it wears in the
        // Grid, and is read-only because it is a pure function of the OS quality
        // and the AI's hacking rank.
        context.abilities = AI_ABILITIES.map((key) => ({
            key,
            label: game.i18n.localize(`ALTERNITY.Ability.${key}`),
            value: system.abilities?.[key] ?? 0,
        }));
        context.avatarAbilities = ['STR', 'DEX', 'CON'].map((key) => ({
            key,
            label: game.i18n.localize(`ALTERNITY.Ability.${key}`),
            value: system.avatar?.[key] ?? 0,
        }));

        // ── AI Functions, each with the limit its rank governs ──────────────
        context.aiFunctionRows = [
            {
                key: 'multitask',
                label: game.i18n.localize('ALTERNITY.AI.Multitask'),
                hint: game.i18n.localize('ALTERNITY.AI.MultitaskHint'),
                value: system.aiFunctions?.multitask ?? 0,
                readout: game.i18n.format('ALTERNITY.AI.SubsystemsReadout', {
                    count: system.subsystemsControlled ?? 1,
                }),
            },
            {
                key: 'prediction',
                label: game.i18n.localize('ALTERNITY.AI.Prediction'),
                hint: game.i18n.localize('ALTERNITY.AI.PredictionHint'),
                value: system.aiFunctions?.prediction ?? 0,
                readout: null,
            },
            {
                key: 'remote',
                label: game.i18n.localize('ALTERNITY.AI.Remote'),
                hint: game.i18n.localize('ALTERNITY.AI.RemoteHint'),
                value: system.aiFunctions?.remote ?? 0,
                readout: game.i18n.format('ALTERNITY.AI.RemotesReadout', {
                    count: system.remotesControlled ?? 0,
                }),
            },
        ];

        // ── Damage tracks ───────────────────────────────────────────────────
        context.tracks = AI_TRACKS.map((key) => {
            const track = system.durability?.[key] ?? { value: 0, max: 0 };
            return {
                key,
                label: game.i18n.localize(`ALTERNITY.${key.charAt(0).toUpperCase()}${key.slice(1)}`),
                value: track.value, max: track.max,
                pct: pct(track.value, track.max),
            };
        });

        // ── Rows ────────────────────────────────────────────────────────────
        context.physicalFormRows = (system.physicalForm ?? []).map((row, index) => ({ ...row, index }));
        context.gridProgramRows   = (system.gridPrograms ?? []).map((row, index) => ({ ...row, index }));
        context.remoteRows        = (system.remotes ?? []).map((row, index) => ({ ...row, index }));

        context.skillRows = (system.skills ?? []).map((skill, index) => {
            const restriction = AlternityMathService.getAISkillRestriction(skill.name, skill.ability);
            return {
                ...skill,
                index,
                isBarred: restriction.isBarred,
                penalty: restriction.penalty,
                isOverRanked: system.maxSkillRank !== null && !skill.isBroad
                    && (skill.rank ?? 0) > system.maxSkillRank,
                // Slots this skill is holding right now. An AI's OS is free, so
                // unlike a robot this is the whole of the memory bill bar programs.
                slots: skill.isLoaded === false ? 0
                    : skill.isBroad ? 1 : (skill.ranksLoaded ?? 0),
            };
        });

        // Surfaced separately from the rows so the banner can name every problem
        // at once rather than relying on the reader spotting a highlighted row.
        context.skillIssues = system.skillIssues ?? [];

        return context;
    }

    _onRender(context, options) {
        bindOnce(this.element, 'sheetChange', () => {
            this.element.addEventListener('change', (e) => {
                applySheetFieldChange(this.document, e.target, AI_ARRAY_FIELDS);
            });
        });
        bindRollMount(this);
        bindStatblockDragDrop(this, this.element, AI_ARRAY_FIELDS);
    }

    // -----------------------------------------------------------------------
    // Rolling
    // -----------------------------------------------------------------------

    /**
     * An AI has no Strength, Dexterity or Constitution of its own, so those three
     * are not offered here. Its avatar's physical scores are rolled through the
     * Grid skill instead.
     */
    static _onRollAbilityAction(event, target) {
        return rollStatblockAbility(this, target.dataset.ability);
    }

    static _onRollActionCheckAction() {
        return rollStatblockActionCheck(this);
    }

    /**
     * Roll a skill row, honouring the two restrictions an AI is under: some skills
     * it simply cannot attempt, and others carry a standing step penalty. Both come
     * from the math service, which is also what the sheet's warning banner reads.
     */
    static _onRollSkillAction(event, target) {
        const row = this.document.system.skills?.[safeInt(target.dataset.index, -1)];
        if (!row) return null;

        const restriction = AlternityMathService.getAISkillRestriction(row.name, row.ability);
        if (restriction.isBarred) {
            ui.notifications?.warn(restriction.reason
                ?? game.i18n.format('ALTERNITY.AI.SkillBarred', { skill: row.name }));
            return null;
        }

        if (row.isLoaded === false) {
            ui.notifications?.warn(game.i18n.format('ALTERNITY.AI.SkillNotLoaded', { skill: row.name }));
            return null;
        }

        const modifiers = restriction.penalty
            ? [AlternityMathService.buildModifier(
                game.i18n.localize('ALTERNITY.AI.SkillPenalty'),
                restriction.penalty,
                restriction.reason ?? '',
            )]
            : [];

        const effectiveRank = row.isBroad ? (row.rank ?? 0) : (row.ranksLoaded ?? 0);
        return rollStatblockSkill(this, { ...row, rank: effectiveRank }, { modifiers });
    }

    /**
     * Roll the AI's Grid skill — the derived score its Computer Science-hacking
     * rank and Intelligence produce, which is what it acts with inside the Grid.
     */
    static _onRollGridSkillAction() {
        const scores = this.document.system.gridSkillScore;
        if (!scores?.ordinary) {
            ui.notifications?.warn(game.i18n.localize('ALTERNITY.AI.NoGridSkill'));
            return null;
        }
        return mountRoller(
            this,
            {
                name: game.i18n.localize('ALTERNITY.AI.GridSkillScore'),
                scores,
                baseStep: 0,
            },
            game.i18n.localize('ALTERNITY.AI.Grid'),
        );
    }

    // -----------------------------------------------------------------------
    // Row management
    // -----------------------------------------------------------------------

    static async _onAddAIRowAction(event, target) {
        const arrayKey = target.dataset.array;
        const defaults = AI_ARRAY_FIELDS[arrayKey];
        if (!defaults) return;
        const current = foundry.utils.getProperty(this.document.system, arrayKey) ?? [];
        await this.document.update({
            [`system.${arrayKey}`]: [...current, foundry.utils.deepClone(defaults)],
        });
    }

    static async _onDeleteAIRowAction(event, target) {
        const arrayKey = target.dataset.array;
        const idx = safeInt(target.dataset.index, -1);
        if (idx < 0 || !AI_ARRAY_FIELDS[arrayKey]) return;
        const current = foundry.utils.getProperty(this.document.system, arrayKey) ?? [];
        await this.document.update({ [`system.${arrayKey}`]: current.filter((_, i) => i !== idx) });
    }

    // -----------------------------------------------------------------------
    // Damage
    // -----------------------------------------------------------------------

    static async _onSetAIDamageAction(event, target) {
        const track = target.dataset.track;
        const delta = safeInt(target.dataset.delta, 0);
        if (!AI_TRACKS.includes(track)) return;

        const max = this.document.system.durability?.[track]?.max ?? 0;
        const current = this.document.system.damage?.[track] ?? 0;
        await this.document.update({
            [`system.damage.${track}`]: Math.min(max, Math.max(0, current + delta)),
        });
    }

    static async _onClearAIDamageAction() {
        await this.document.update({
            'system.damage': { stun: 0, wound: 0, mortal: 0 },
        });
    }

    // -----------------------------------------------------------------------
    // Memory
    // -----------------------------------------------------------------------

    /**
     * Load a skill fully into active memory, or unload it entirely.
     *
     * Part-loading is the normal state of affairs for a mainframe AI — it pulls
     * the rest out of storage memory when it needs it — so the ranks field stays
     * editable and this is only the common case as one click.
     */
    static async _onLoadAllAIRanksAction(event, target) {
        const idx = safeInt(target.dataset.index, -1);
        if (idx < 0) return;
        const skills = foundry.utils.deepClone(this.document.system.skills ?? []);
        const skill = skills[idx];
        if (!skill) return;

        const isFullyLoaded = skill.isLoaded && (skill.isBroad || skill.ranksLoaded >= skill.rank);
        skill.isLoaded = !isFullyLoaded;
        skill.ranksLoaded = isFullyLoaded ? 0 : (skill.rank ?? 0);

        await this.document.update({ 'system.skills': skills });
    }
}

// ---------------------------------------------------------------------------
// AlternityCreatureSheet
// ---------------------------------------------------------------------------

const CREATURE_ARRAY_FIELDS = Object.freeze({
    attacks: {
        name: '', score: 0, damageOrdinary: '', damageGood: '', damageAmazing: '',
        damageType: 'LI', mode: 'O', notes: '',
    },
    skills: { name: '', score: 0, isSpecialty: false },
});

const CREATURE_TRACKS = Object.freeze(['stun', 'wound', 'mortal', 'fatigue']);

class AlternityCreatureSheet extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {
    static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
        classes: [NS, `${NS}-sheet-app`, `${NS}-creature-sheet`],
        tag: "form",
        window: { resizable: true, width: 680, height: 820 },
        actions: {
            addCreatureRow:      this._onAddCreatureRowAction,
            deleteCreatureRow:   this._onDeleteCreatureRowAction,
            setCreatureDamage:   this._onSetCreatureDamageAction,
            clearCreatureDamage: this._onClearCreatureDamageAction,
            rollAbility:         this._onRollAbilityAction,
            rollActionCheck:     this._onRollActionCheckAction,
            rollAttack:          this._onRollAttackAction,
            rollSkill:           this._onRollSkillAction,
            rollDefence:         this._onRollDefenceAction,
        }
    });

    static PARTS = {
        sheet: { template: "systems/alternity/templates/actor/actor-creature-sheet.hbs" }
    };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const system = this.document.system;

        context.actor = this.document;
        context.system = system;
        context.alt = NS;

        // ── Choice lists ────────────────────────────────────────────────────
        context.categoryChoices = CREATURE_CATEGORIES;
        context.reactionDegreeChoices = REACTION_DEGREES;
        context.damageTypeChoices = DAMAGE_TYPES;
        context.toughnessChoices = PERSONAL_TOUGHNESS_CLASSES;

        // ── Abilities, with their printed range and the animal scale ────────
        context.abilities = CREATURE_ABILITIES.map((key) => ({
            key,
            label: game.i18n.localize(`ALTERNITY.Ability.${key.toUpperCase()}`),
            value: system.abilities?.[key] ?? 0,
            range: system.abilityRanges?.[key] ?? '',
            // Only Intelligence and Personality carry a second scale.
            hasAnimalScale: ANIMAL_SCALE_ABILITIES.includes(key),
            animalValue: system.animalScale?.[key] ?? 0,
        }));

        // ── Damage tracks ───────────────────────────────────────────────────
        context.tracks = CREATURE_TRACKS.map((key) => {
            const track = system.durability?.[key] ?? { value: 0, max: 0 };
            return {
                key,
                label: game.i18n.localize(`ALTERNITY.${key.charAt(0).toUpperCase()}${key.slice(1)}`),
                value: track.value, max: track.max,
                pct: pct(track.value, track.max),
            };
        });

        // ── Defenses ────────────────────────────────────────────────────────
        // A null resistance is not zero: the compendium prints "no resistance
        // modifier vs. ranged attacks", which is a different statement from +0.
        context.resistances = ['melee', 'ranged'].map((key) => {
            const value = system.resistance?.[key];
            return {
                key,
                label: game.i18n.localize(`ALTERNITY.Creature.Resistance${key === 'melee' ? 'Melee' : 'Ranged'}`),
                hint: game.i18n.localize('ALTERNITY.Creature.ResistanceHint'),
                value: value ?? null,
                display: value === null || value === undefined
                    ? game.i18n.localize('ALTERNITY.Creature.NoResistance')
                    : fmtMod(value),
            };
        });

        context.armorSlots = [
            { key: 'li', label: 'LI', value: system.naturalArmor?.li ?? '' },
            { key: 'hi', label: 'HI', value: system.naturalArmor?.hi ?? '' },
            { key: 'en', label: 'En', value: system.naturalArmor?.en ?? '' },
        ];

        // ── Movement ────────────────────────────────────────────────────────
        context.movementKeys = ['sprint', 'run', 'walk', 'crawl', 'easySwim', 'swim', 'glide', 'fly']
            .map((key) => ({
                key,
                label: game.i18n.localize(`ALTERNITY.Movement.${key}`),
                value: system.movement?.[key] ?? 0,
            }));
        context.movementSummary = (system.movementRates ?? [])
            .map((r) => `${game.i18n.localize(`ALTERNITY.Movement.${r.key}`)} ${r.value}`)
            .join(', ');

        context.attackRows = system.attackRows ?? [];
        context.skillRows  = system.skillRows ?? [];

        return context;
    }

    _onRender(context, options) {
        bindOnce(this.element, 'sheetChange', () => {
            this.element.addEventListener('change', (e) => {
                applySheetFieldChange(this.document, e.target, CREATURE_ARRAY_FIELDS);
            });
        });
        bindRollMount(this);
        bindStatblockDragDrop(this, this.element, CREATURE_ARRAY_FIELDS);
    }

    // -----------------------------------------------------------------------
    // Rolling
    // -----------------------------------------------------------------------

    static _onRollAbilityAction(event, target) {
        return rollStatblockAbility(this, target.dataset.ability);
    }

    static _onRollActionCheckAction() {
        return rollStatblockActionCheck(this);
    }

    /**
     * Roll an attack row. The mode column ('O' for an ordinary attack, 'F' for a
     * ranged/breath one in the compendium's shorthand) decides which of the
     * target's two resistance modifiers applies.
     */
    static async _onRollAttackAction(event, target) {
        const row = this.document.system.attackRows?.[safeInt(target.dataset.index, -1)];
        const isRanged = /f|r/i.test(String(row?.mode ?? ''));
        return rollStatblockAttack(this, row, { attackKind: isRanged ? 'ranged' : 'melee' });
    }

    static _onRollSkillAction(event, target) {
        const row = this.document.system.skillRows?.[safeInt(target.dataset.index, -1)];
        return rollStatblockSkill(this, row);
    }

    static async _onRollDefenceAction() {
        return rollStatblockDefence(this);
    }

    // -----------------------------------------------------------------------
    // Row management
    // -----------------------------------------------------------------------

    static async _onAddCreatureRowAction(event, target) {
        const arrayKey = target.dataset.array;
        const defaults = CREATURE_ARRAY_FIELDS[arrayKey];
        if (!defaults) return;
        const current = foundry.utils.getProperty(this.document.system, arrayKey) ?? [];
        await this.document.update({
            [`system.${arrayKey}`]: [...current, foundry.utils.deepClone(defaults)],
        });
    }

    static async _onDeleteCreatureRowAction(event, target) {
        const arrayKey = target.dataset.array;
        const idx = safeInt(target.dataset.index, -1);
        if (idx < 0 || !CREATURE_ARRAY_FIELDS[arrayKey]) return;
        const current = foundry.utils.getProperty(this.document.system, arrayKey) ?? [];
        await this.document.update({ [`system.${arrayKey}`]: current.filter((_, i) => i !== idx) });
    }

    // -----------------------------------------------------------------------
    // Damage
    // -----------------------------------------------------------------------

    static async _onSetCreatureDamageAction(event, target) {
        const track = target.dataset.track;
        const delta = safeInt(target.dataset.delta, 0);
        if (!CREATURE_TRACKS.includes(track)) return;

        const max = this.document.system.durability?.[track]?.max ?? 0;
        const current = this.document.system.damage?.[track]?.value ?? 0;
        await this.document.update({
            [`system.damage.${track}.value`]: Math.min(max, Math.max(0, current + delta)),
        });
    }

    static async _onClearCreatureDamageAction() {
        await this.document.update({
            'system.damage.stun.value': 0,
            'system.damage.wound.value': 0,
            'system.damage.mortal.value': 0,
            'system.damage.fatigue.value': 0,
        });
    }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

async function registerAlternitySheet() {
    Handlebars.registerHelper('fmtMod', fmtMod);
    Handlebars.registerHelper('firstChar', (str) => String(str ?? '')[0]);
    Handlebars.registerHelper('pct', pct);
    Handlebars.registerHelper('add', (a, b) => Number(a) + Number(b));
    Handlebars.registerHelper('and', (a, b) => a && b);
    Handlebars.registerHelper('or', (a, b) => a || b);
    Handlebars.registerHelper('includes', (arr, val) => Array.isArray(arr) && arr.includes(val));
    /**
     * String concatenation, used to build localization keys from a prefix and a
     * runtime value — `{{localize (concat 'ALTERNITY.' woundLevel)}}`.
     *
     * Five call sites across actor-sheet, actor-npc-sheet and the roll card have
     * always used this helper, but it was never registered: Handlebars resolves
     * an unknown sub-expression to undefined, so `localize` received undefined and
     * rendered nothing. That silently blanked the wound-level readout at the top
     * of both actor sheets, every wound-pip tooltip, and the roll card's phase
     * label. The trailing options object Handlebars appends is dropped.
     */
    Handlebars.registerHelper('concat', (...args) => args.slice(0, -1).join(''));
    /** Lower-cased, for building CSS class names from a degree label. */
    Handlebars.registerHelper('lower', (str) => String(str ?? '').toLowerCase().replace(/\s+/g, '-'));

    await foundry.applications.handlebars.loadTemplates([
        "systems/alternity/templates/actor/ability-card.hbs",
        // Preloaded so a roll never waits on a template fetch mid-click.
        "systems/alternity/templates/roll/roll-panel.hbs",
        "systems/alternity/templates/roll/roll-card.hbs",
        "systems/alternity/templates/roll/damage-card.hbs",
        "systems/alternity/templates/roll/armor-card.hbs",
        "systems/alternity/templates/roll/action-check-card.hbs",
    ]);

    const ItemsCollection = foundry.documents.collections.Items ?? Items;
    if (typeof ItemsCollection !== 'undefined') {
        const { AlternityItemSheet } = await import('./alternity-item-sheet.js');
        ItemsCollection.registerSheet('alternity', AlternityItemSheet, { makeDefault: true, label: 'Alternity Item Sheet' });
    }

    const ActorsCollection = foundry.documents.collections.Actors ?? Actors;
    if (typeof ActorsCollection === 'undefined') return;

    // Drops are handled by alternity-drag-drop.js, so core ActorSheetV2's own drop
    // path is shut off on every one of these classes. Without this, a later change
    // that adds `super._onRender(...)` to any sheet — which is what binds core's
    // DragDrop — would make each drop create the item twice.
    for (const SheetClass of [
        AlternityCharacterSheet, AlternityNpcSheet, AlternityVehicleSheet, AlternityWarshipSheet,
        AlternitySpaceshipSheet, AlternityRobotSheet, AlternityAISheet, AlternityCreatureSheet,
    ]) claimDropHandling(SheetClass);

    ActorsCollection.registerSheet('alternity', AlternityCharacterSheet, { types: ['character'], makeDefault: true, label: 'Alternity Character Sheet' });
    ActorsCollection.registerSheet('alternity', AlternityNpcSheet, { types: ['npc'], makeDefault: true, label: 'Alternity NPC Sheet' });
    ActorsCollection.registerSheet('alternity', AlternityVehicleSheet, { types: ['vehicle'], makeDefault: true, label: 'Alternity Vehicle Sheet' });
    ActorsCollection.registerSheet('alternity', AlternityWarshipSheet, { types: ['warship'], makeDefault: true, label: 'Alternity Warship Sheet' });
    ActorsCollection.registerSheet('alternity', AlternitySpaceshipSheet, { types: ['spaceship'], makeDefault: true, label: 'Alternity Spaceship Sheet' });
    ActorsCollection.registerSheet('alternity', AlternityRobotSheet, { types: ['robot'], makeDefault: true, label: 'Alternity Robot Sheet' });
    ActorsCollection.registerSheet('alternity', AlternityAISheet, { types: ['ai'], makeDefault: true, label: 'Alternity AI Sheet' });
    ActorsCollection.registerSheet('alternity', AlternityCreatureSheet, { types: ['creature'], makeDefault: true, label: 'Alternity Creature Sheet' });
}

export {
    AlternityRollComponent,
    AlternityCharacterSheet as AlternitySheetApplication,
    AlternityCharacterSheet,
    AlternityNpcSheet,
    AlternityVehicleSheet,
    AlternityWarshipSheet,
    AlternitySpaceshipSheet,
    AlternityRobotSheet,
    AlternityAISheet,
    AlternityCreatureSheet,
    registerAlternitySheet,
    pct,
    fmtMod,
    WOUND_SEVERITY,
    DEGREE_CLASSES,
};
