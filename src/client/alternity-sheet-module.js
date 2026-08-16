/**
 * @file alternity-sheet-module.js
 * @description Phase 3 – Client UI: Character, NPC, and Vehicle sheets for Alternity Fastplay.
 */

import {
    getAlternityState,
    saveAlternityState,
    ABILITY_TYPES,
    ABILITIES,
    WOUND_LEVELS,
    WOUND_PENALTIES,
    SKILL_DEFINITIONS,
    AlternityAbilitySet,
    AlternityCharacterState,
} from '../data/alternity-actor-data.js';
import { AlternityMathService, SUCCESS_DEGREES, DIFFICULTY_DCS, SITUATION_DIE_SCALE } from '../services/alternity-math.js';
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

const DEGREE_CLASSES = Object.freeze({
    [SUCCESS_DEGREES.MARGINAL]:  'degree--marginal',
    [SUCCESS_DEGREES.ORDINARY]:  'degree--ordinary',
    [SUCCESS_DEGREES.GOOD]:      'degree--good',
    [SUCCESS_DEGREES.AMAZING]:   'degree--amazing',
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

// ---------------------------------------------------------------------------
// AlternityRollComponent
// ---------------------------------------------------------------------------

class AlternityRollComponent {
    constructor(container, actor, checks, context) {
        if (!container || !(container instanceof HTMLElement)) {
            throw new Error('[AlternityRollComponent] container must be an HTMLElement.');
        }
        if (!Array.isArray(checks) || checks.length === 0) {
            throw new Error('[AlternityRollComponent] checks must be a non-empty array.');
        }
        if (!context) throw new Error('[AlternityRollComponent] context is required.');

        this.container = container;
        this.actor     = actor;
        this.checks    = checks;
        this.context   = context;
        this._result   = null;
    }

    async render() {
        const html = await renderTemplate("systems/alternity-v2/templates/roll/roll-panel.hbs", {
            alt: NS,
            context: this.context,
            checks: this.checks
        });
        this.container.innerHTML = html;
        this._bindEvents();
        return this;
    }

    async execute(forcedRoll) {
        let control = forcedRoll;
        if (control === undefined) {
            const r = new Roll("1d20");
            await r.evaluate();
            control = r.total;
        }
        return this._resolve(control);
    }

    _bindEvents() {
        const btn = (sel) => this.container.querySelector(sel);
        btn(`[data-action="roll"]`)?.addEventListener('click', async () => {
            await this.execute();
        });
        btn(`.${NS}-roll-close`)?.addEventListener('click', () => {
            this.container.innerHTML = '';
            this.container.dispatchEvent(new CustomEvent('alternity:rollClosed', { bubbles: true }));
        });
    }

    async _resolve(controlRoll) {
        const altState = this.actor ? await getAlternityState(this.actor) : null;
        const modifiers = [];

        if (altState) {
            const damagePenalty = altState.getDamageStepPenalty();
            if (damagePenalty > 0) {
                modifiers.push(AlternityMathService.buildModifier(
                    'Wound/Dazed Penalty', damagePenalty, 'Current durability penalty'
                ));
            }
            const activeAbilities = altState.getActiveAbilities();
            for (const ability of activeAbilities) {
                const trigger = ability.triggerCondition;
                if (trigger.context && trigger.context !== this.context && trigger.context !== 'Any') continue;
                if (typeof ability.effectPayload.step === 'number') {
                    modifiers.push(AlternityMathService.buildModifier(
                        ability.name, ability.effectPayload.step, `Ability: ${ability.name}`
                    ));
                }
            }
        }

        const primaryCheck = this.checks[0];
        const stepModifier = safeInt(this.container.querySelector(`.${NS}-roll-step-select`)?.value, 0);
        if (stepModifier !== 0) {
            modifiers.push(AlternityMathService.buildModifier(
                'Situational Modifier', stepModifier, 'Manually selected situation step'
            ));
        }

        const totalModifier = modifiers.reduce((sum, m) => sum + m.value, 0);
        const totalStep = primaryCheck.baseStep + totalModifier;
        const totalStepClamped = Math.min(7, Math.max(-5, totalStep));
        
        const formula = totalStepClamped === 0 ? '1d20' : `1d20${SITUATION_DIE_SCALE[String(totalStepClamped)][2]}`;
        const roll = new Roll(formula);
        await roll.evaluate();

        const evaluatedControl = roll.terms[0].total;
        let evaluatedSituation = 0;
        if (roll.terms.length > 2) {
            evaluatedSituation = roll.terms[2].total;
        }

        const resolveResult = AlternityMathService.resolveAbilityCheck(
            primaryCheck.scores,
            primaryCheck.baseStep,
            modifiers,
            this.context,
            { control: evaluatedControl, situation: evaluatedSituation }
        );

        this._result = { ...resolveResult, checkName: primaryCheck.name };
        
        const rollOptions = {
            context:       this.context,
            scores:        primaryCheck.scores,
            baseValue:     primaryCheck.scores.ordinary,
            adjustedValue: resolveResult.finalValue,
            succeeded:     resolveResult.succeeded,
            degree:        resolveResult.degree,
            margin:        resolveResult.margin,
            modifierTrace: resolveResult.modifierTrace,
            whisper:       false
        };

        await this.actor._createRollChatMessage(roll, rollOptions);

        this.container.dispatchEvent(new CustomEvent('alternity:rollResult', {
            bubbles: true,
            detail: this._result,
        }));

        return this._result;
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
                toggleRule:     this._onToggleRuleAction,
                editSkill:      this._onEditSkillAction,
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
                editState:      this._onEditStateAction
            }
        });
    }

    /** @override */
    static PARTS = {
        sheet: {
            template: "systems/alternity-v2/templates/actor/actor-sheet.hbs"
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

        // Build rich abilities object
        const abilities = {};
        for (const ab of ABILITIES) {
            abilities[ab] = {
                label:     ab,
                score:     state.abilityScores[ab],
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

        context.inventory = {
            weapons: this.document.items.filter(i => i.type === 'weapon'),
            armor:   this.document.items.filter(i => i.type === 'armor'),
            computers: this.document.items.filter(i => i.type === 'computer'),
            perksFlaws: this.document.items.filter(i => i.type === 'perkFlaw'),
            personalEquipment: this.document.items.filter(i => i.type === 'personalEquipment'),
            cybertech: this.document.items.filter(i => i.type === 'cybertech'),
            programs: this.document.items.filter(i => i.type === 'program'),
            fxPowers: this.document.items.filter(i => i.type === 'fx'),
            mutations: this.document.items.filter(i => i.type === 'mutation'),
            achievementBenefits: this.document.items.filter(i => i.type === 'achievementBenefit')
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
        context.armor            = state.armor || { li: 0, hi: 0, en: 0 };
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
        context.abilityCardTemplate = "systems/alternity-v2/templates/actor/ability-card.hbs";

        return context;
    }

    /** @override */
    _onRender(context, options) {
        this._activateListeners(this.element);
    }

    _activateListeners(html) {
        html.addEventListener('change', (e) => this._onSheetChange(e));
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
        html.addEventListener('alternity:rollResult', (e) => console.log('[AlternitySheet] Roll result:', e.detail));
        html.addEventListener('alternity:rollClosed', () => {
            html.querySelector(`.${NS}-roll-mount`).hidden = true;
            this._activeRoller = null;
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
        this._openRoller([{ name: ability.name, baseValue: ability.effectPayload?.baseValue || 25 }], ability.triggerCondition?.context || 'General', this.element);
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

    static _onQuickRollAction(event, target) {
        const score = this._altState.abilityScores[target.dataset.ability] ?? 10;
        const scores = { ordinary: score, good: Math.floor(score/2), amazing: Math.floor(score/4) };
        this._openRoller([{ name: `${target.dataset.context} Check`, scores, baseStep: 1 }], target.dataset.context, this.element);
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
        const skillDef = SKILL_DEFINITIONS.find(d => d.id === skillId) || this._altState.customSkills.find(s => s.id === skillId);
        if (!skillDef) return;
        this._openRoller([{ name: skillDef.name, scores: this._altState.getSkillScores(skillId), baseStep: this._altState.getSkillBaseStep(skillId) }], skillDef.name, this.element);
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

    _openRoller(checks, context, html) {
        const mount = html.querySelector(`.${NS}-roll-mount`);
        if (!mount) return;
        mount.hidden = false;
        mount.innerHTML = '';
        this._activeRoller = new AlternityRollComponent(mount, this.actor, checks, context);
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

    static async _onRollWeaponAction(event, target) {
        const item = this.actor.items.get(target.dataset.itemId);
        if (!item || item.type !== 'weapon') return;
        const context = item.system.weaponType === 'Melee' ? 'Melee Attack' : 'Ranged Attack';
        const score = this._altState.abilityScores[item.system.attackAbility.toUpperCase()] ?? 10;
        this._openRoller([{ name: item.name, scores: { ordinary: score, good: Math.floor(score/2), amazing: Math.floor(score/4) }, baseStep: item.system.weaponType === 'Melee' ? 0 : 1 }], context, this.element);
    }

    static async _onRollPerkCheckAction(event, target) {
        const item = this.actor.items.get(target.dataset.itemId);
        if (!item || item.type !== 'perkFlaw' || !item.system.requiresCheck) return;
        const abilityKey = item.system.linkedAbility;
        if (!['STR', 'DEX', 'CON', 'INT', 'WIL', 'PER'].includes(abilityKey)) {
            ui.notifications?.warn(`${item.name} has no ability score to check against.`);
            return;
        }
        const score = this._altState.abilityScores[abilityKey] ?? 10;
        this._openRoller([{ name: item.name, scores: { ordinary: score, good: Math.floor(score/2), amazing: Math.floor(score/4) }, baseStep: 1 }], `${item.name} Perk Check`, this.element);
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

        const score = this._altState.abilityScores.CON ?? 10;
        this._openRoller(
            [{
                name: item.name,
                scores: { ordinary: score, good: Math.floor(score / 2), amazing: Math.floor(score / 4) },
                baseStep: 1,
            }],
            'Cyber Tolerance (CON Feat Check)',
            this.element
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

        const scores = item.system.scores
            ?? { ordinary: 0, good: 0, amazing: 0 };

        this._openRoller(
            [{ name: item.name, scores, baseStep: item.system.baseStep ?? 0 }],
            `${item.name} (${item.system.broadSkill})`,
            this.element
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
            [{ name: item.name, scores, baseStep: item.system.untrainedBaseStep ?? 4 }],
            `${item.name} (untrained)`,
            this.element
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
// AlternityNpcSheet
// ---------------------------------------------------------------------------

class AlternityNpcSheet extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {
    static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
        classes: [NS, `${NS}-sheet-app`, `${NS}-npc-sheet`],
        tag: "form",
        window: { resizable: true, width: 560, height: 750 },
        actions: {
            switchTab: this._onTabAction,
            setWound:  this._onSetWoundAction
        }
    });
    static PARTS = {
        sheet: { template: "systems/alternity-v2/templates/actor/actor-npc-sheet.hbs" }
    };

    constructor(options = {}) {
        super(options);
        this._activeTab = 'tactics';
    }

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        context.actor = this.document;
        context.system = this.document.system;
        context.alt = NS;
        context.woundSeverity = WOUND_SEVERITY[this.document.system.woundLevel] || 'healthy';
        context.activeTab = this._activeTab;
        context.WOUND_LEVELS = WOUND_LEVELS;
        context.WOUND_SEVERITY = WOUND_SEVERITY;
        context.crChoices = ['Easy', 'Average', 'Tough', 'Overwhelming'];
        return context;
    }

    _onRender(context, options) {
        const html = this.element;
        html.addEventListener('change', (e) => {
            const input = e.target;
            if (input.name) {
                const val = input.type === 'checkbox' ? input.checked : input.value;
                this.document.update({ [input.name]: val });
            }
        });

        // Tab visibility
        html.querySelectorAll('.tab').forEach(t => {
            t.classList.toggle('active', t.dataset.tab === this._activeTab);
            t.style.display = t.dataset.tab === this._activeTab ? 'block' : 'none';
        });
        html.querySelectorAll('.item[data-tab]').forEach(i => {
            i.classList.toggle('active', i.dataset.tab === this._activeTab);
        });
    }

    static _onTabAction(event, target) {
        this._activeTab = target.dataset.tab;
        this.render();
    }

    static async _onSetWoundAction(event, target) {
        const woundLevel = target.dataset.wound;
        await this.document.update({ "system.woundLevel": woundLevel });
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
        sheet: { template: "systems/alternity-v2/templates/actor/actor-vehicle-sheet.hbs" }
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
        this.element.addEventListener('change', (e) => {
            const input = e.target;
            if (input.name) {
                const val = input.type === 'checkbox' ? input.checked : input.value;
                this.document.update({ [input.name]: val });
            }
        });
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
        sheet: { template: "systems/alternity-v2/templates/actor/actor-warship-sheet.hbs" }
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
        this.element.addEventListener('change', (e) => {
            const input = e.target;
            if (input.name) {
                const val = input.type === 'checkbox' ? input.checked : input.value;
                this.document.update({ [input.name]: val });
            }
        });
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

    static async _onRollShipWeaponAction(event, target) {
        const idx = safeInt(target.dataset.index, -1);
        const weapon = this.document.system.weapons?.[idx];
        if (!weapon) return;
        const roll = await new Roll(weapon.damageFormula || '1d6').evaluate();
        await roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor: this.document }),
            flavor: `${weapon.name || 'Weapon'} — ${weapon.damageType} (${weapon.firepowerClass})`,
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
        }
    });

    static PARTS = {
        sheet: { template: "systems/alternity-v2/templates/actor/actor-spaceship-sheet.hbs" }
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
        this.element.addEventListener('change', (e) => {
            const input = e.target;
            if (!input.name) return;

            const value = input.type === 'checkbox' ? input.checked
                : input.type === 'number' ? safeFloat(input.value, 0)
                : input.value;

            // Paths that reach into one of the inline tables (`system.weapons.2.arc`)
            // are rewritten into a whole-array update. Foundry's ArrayField replaces
            // rather than merges, so submitting the indexed path alone risks writing
            // back an array holding only the edited row. Read-modify-write on a clone
            // is unambiguous, and matches what the row buttons already do.
            const arrayPath = /^system\.(\w+)\.(\d+)\.(.+)$/.exec(input.name);
            if (arrayPath && Object.hasOwn(SPACESHIP_ARRAY_FIELDS, arrayPath[1])) {
                const [, arrayKey, indexText, fieldPath] = arrayPath;
                const rows = foundry.utils.deepClone(this.document.system[arrayKey] ?? []);
                const row = rows[Number(indexText)];
                if (!row) return;
                foundry.utils.setProperty(row, fieldPath, value);
                this.document.update({ [`system.${arrayKey}`]: rows });
                return;
            }

            this.document.update({ [input.name]: value });
        });
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

        // Alternity damage codes carry a trailing grade letter ("d6+2s"), which is
        // notation, not dice — strip it before handing the string to Roll.
        const roll = await new Roll(String(formula).replace(/[swm]\s*$/i, '')).evaluate();

        // Against a spaceship's Amazing toughness the weapon's firepower decides
        // whether this damage lands at all, so show the result of that comparison.
        const degrade = AlternityMathService.calculateFirepowerDegrade(
            grade === 'amazing' ? 'mortal' : grade === 'good' ? 'wound' : 'stun',
            weapon.firepower
        );

        await roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor: this.document }),
            flavor: game.i18n.format('ALTERNITY.Spaceship.WeaponRoll', {
                weapon: weapon.name || game.i18n.localize('ALTERNITY.Spaceship.Weapon'),
                grade,
                firepower: weapon.firepower,
                versusShip: degrade.isNegated
                    ? game.i18n.localize('ALTERNITY.Spaceship.DegradedToNothing')
                    : game.i18n.format('ALTERNITY.Spaceship.DegradedTo', { grade: degrade.finalGrade }),
            }),
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
    
    await foundry.applications.handlebars.loadTemplates([
        "systems/alternity-v2/templates/actor/ability-card.hbs"
    ]);

    const ItemsCollection = foundry.documents.collections.Items ?? Items;
    if (typeof ItemsCollection !== 'undefined') {
        const { AlternityItemSheet } = await import('./alternity-item-sheet.js');
        ItemsCollection.registerSheet('alternity-v2', AlternityItemSheet, { makeDefault: true, label: 'Alternity Item Sheet' });
    }

    const ActorsCollection = foundry.documents.collections.Actors ?? Actors;
    if (typeof ActorsCollection === 'undefined') return;

    ActorsCollection.registerSheet('alternity-v2', AlternityCharacterSheet, { types: ['character'], makeDefault: true, label: 'Alternity Character Sheet' });
    ActorsCollection.registerSheet('alternity-v2', AlternityNpcSheet, { types: ['npc'], makeDefault: true, label: 'Alternity NPC Sheet' });
    ActorsCollection.registerSheet('alternity-v2', AlternityVehicleSheet, { types: ['vehicle'], makeDefault: true, label: 'Alternity Vehicle Sheet' });
    ActorsCollection.registerSheet('alternity-v2', AlternityWarshipSheet, { types: ['warship'], makeDefault: true, label: 'Alternity Warship Sheet' });
    ActorsCollection.registerSheet('alternity-v2', AlternitySpaceshipSheet, { types: ['spaceship'], makeDefault: true, label: 'Alternity Spaceship Sheet' });
}

export {
    AlternityRollComponent,
    AlternityCharacterSheet as AlternitySheetApplication,
    AlternityCharacterSheet,
    AlternityNpcSheet,
    AlternityVehicleSheet,
    AlternityWarshipSheet,
    AlternitySpaceshipSheet,
    registerAlternitySheet,
    pct,
    fmtMod,
    WOUND_SEVERITY,
    DEGREE_CLASSES,
};
