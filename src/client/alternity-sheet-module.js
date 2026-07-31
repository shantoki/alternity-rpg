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
                setPsionicEnergy: this._onPsionicPipAction,
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
        context.durability = Object.entries(state.resources || {}).map(([key, val]) => ({
            label: key, current: val?.value || 0, max: val?.max || 0, pct: pct(val?.value || 0, val?.max || 0)
        }));

        context.inventory = {
            weapons: this.document.items.filter(i => i.type === 'weapon'),
            armor:   this.document.items.filter(i => i.type === 'armor'),
            computers: this.document.items.filter(i => i.type === 'computer'),
            perksFlaws: this.document.items.filter(i => i.type === 'perkFlaw'),
            personalEquipment: this.document.items.filter(i => i.type === 'personalEquipment')
        };

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
        context.achievementTrack = {
            level: state.achievementTrack?.level || 1,
            checkmarks: [...Array(23).keys()].map(i => i < (state.achievementTrack?.level || 1))
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
        } else if (action === 'editAbility') {
            this._altState.setAbilityScore(input.dataset.ability, safeInt(input.value, 0));
            await saveAlternityState(this.actor, this._altState);
            this.render(true);
        } else if (action === 'editState') {
            const val = input.type === 'checkbox' ? input.checked : input.value;
            foundry.utils.setProperty(this._altState, input.dataset.field, val);
            await saveAlternityState(this.actor, this._altState);
            if (input.dataset.field === 'profession' || input.dataset.field.startsWith('features.')) this.render(true);
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
// Registration
// ---------------------------------------------------------------------------

async function registerAlternitySheet() {
    Handlebars.registerHelper('fmtMod', fmtMod);
    Handlebars.registerHelper('firstChar', (str) => String(str ?? '')[0]);
    Handlebars.registerHelper('pct', pct);
    Handlebars.registerHelper('add', (a, b) => Number(a) + Number(b));
    Handlebars.registerHelper('and', (a, b) => a && b);
    Handlebars.registerHelper('or', (a, b) => a || b);
    
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
}

export {
    AlternityRollComponent,
    AlternityCharacterSheet as AlternitySheetApplication,
    AlternityCharacterSheet,
    AlternityNpcSheet,
    AlternityVehicleSheet,
    AlternityWarshipSheet,
    registerAlternitySheet,
    pct,
    fmtMod,
    WOUND_SEVERITY,
    DEGREE_CLASSES,
};
