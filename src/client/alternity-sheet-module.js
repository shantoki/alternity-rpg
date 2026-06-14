/**
 * @file alternity-sheet-module.js
 * @description Phase 3 – Client UI: Character sheet and roll component for Alternity Fastplay.
 *
 * Architecture:
 *   AlternityRollComponent  — Standalone roll panel. Accepts checks[] + context, calls the
 *                             math service via the createAbilityCheck hook, renders a full
 *                             modifier breakdown and outcome badge.
 *
 *   AlternitySheetApplication — Extends Foundry's ActorSheet. Renders the complete character
 *                               sheet: abilities panel (stances/passives/actions with live
 *                               toggles), resource bars (Stamina, Vitality, TP, PP), wound
 *                               level indicator, and special rule toggles.
 *
 * Data flow (read):
 *   Actor flag → getAlternityState() → AlternityCharacterState → sheet template data
 *
 * Data flow (write):
 *   Sheet interaction → saveAlternityState() → Actor flag → sheet re-render
 *
 * The UI layer NEVER performs its own calculations. All math is delegated to
 * AlternityMathService via hook events or direct service calls.
 *
 * Separation of concerns is enforced throughout:
 *   - No game logic lives in this file.
 *   - No DOM manipulation lives in the data or service layers.
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** CSS class prefix — keeps our classes namespaced away from Foundry core. */
const NS = 'alt';

/** Wound level → UI severity class mapping. */
const WOUND_SEVERITY = Object.freeze({
    Healthy:  'healthy',
    Stunned:  'stunned',
    Wounded:  'wounded',
    Bleeding: 'bleeding',
    Down:     'down',
    Out:      'out',
});

/** Degree of success → CSS badge class. */
const DEGREE_CLASSES = Object.freeze({
    [SUCCESS_DEGREES.MARGINAL]:  'degree--marginal',
    [SUCCESS_DEGREES.ORDINARY]:  'degree--ordinary',
    [SUCCESS_DEGREES.GOOD]:      'degree--good',
    [SUCCESS_DEGREES.AMAZING]:   'degree--amazing',
});

/** Ability type → icon character (used in the sheet header tabs). */
const ABILITY_TYPE_ICONS = Object.freeze({
    [ABILITY_TYPES.STANCE]:  '⬡',
    [ABILITY_TYPES.PASSIVE]: '◈',
    [ABILITY_TYPES.ACTION]:  '◆',
});

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/**
 * Build a percentage string (clamped 0–100) for CSS width/progress bars.
 * @param {number} current
 * @param {number} max
 * @returns {string} e.g. "75%"
 */
function pct(current, max) {
    if (!max || max <= 0) return '0%';
    return `${Math.min(100, Math.max(0, Math.round((current / max) * 100)))}%`;
}

/**
 * Format a modifier value for display: "+3", "-5", "0".
 * @param {number} value
 * @returns {string}
 */
function fmtMod(value) {
    if (value > 0) return `+${value}`;
    return String(value);
}

/**
 * Safely parse an integer from a DOM input, falling back to a default.
 * @param {string|number} val
 * @param {number} fallback
 * @returns {number}
 */
function safeInt(val, fallback = 0) {
    const n = parseInt(val, 10);
    return isFinite(n) ? n : fallback;
}

// ---------------------------------------------------------------------------
// AlternityRollComponent
// ---------------------------------------------------------------------------

/**
 * A self-contained roll panel rendered into a given DOM container.
 *
 * Responsibilities:
 *  - Accept a list of pending checks (skill name + base target) and a context string.
 *  - Simulate a d20 roll (or accept a provided roll value for testing).
 *  - Call the createAbilityCheck hook pathway via the math service.
 *  - Render a full modifier breakdown table and an outcome badge.
 *  - Emit a 'result' custom event on the container when the roll resolves.
 *
 * Usage (inside AlternitySheetApplication._onRollSkill):
 *   const roller = new AlternityRollComponent(containerEl, actor, checks, context);
 *   roller.render();
 *
 * @fires CustomEvent('alternity:rollResult') on the container element.
 */
class AlternityRollComponent {
    /**
     * @param {HTMLElement} container - The DOM element to render into.
     * @param {object}      actor     - Foundry Actor document (for state retrieval).
     * @param {Array<{name: string, baseValue: number}>} checks - Skill checks to resolve.
     * @param {string}      context   - Roll context (e.g. 'Combat', 'Stealth').
     */
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

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    /**
     * Render the roll panel in its initial (pre-roll) state.
     * @returns {Promise<AlternityRollComponent>} this
     */
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

    /**
     * Execute the roll programmatically (for testing / automation).
     * @param {number} [forcedRoll] - Skip RNG and use this value (1–20).
     * @returns {Promise<object>} The resolved result object.
     */
    async execute(forcedRoll) {
        let control = forcedRoll;
        if (control === undefined) {
            const r = new Roll("1d20");
            await r.evaluate();
            control = r.total;
        }
        return this._resolve(control);
    }

    // -----------------------------------------------------------------------
    // Private: HTML construction
    // -----------------------------------------------------------------------

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

    // -----------------------------------------------------------------------
    // Private: resolution
    // -----------------------------------------------------------------------

    /**
     * Resolve a roll against the first check's base values, applying all Alternity
     * modifiers by calling the math service. Renders the result.
     *
     * @param {number} controlRoll - Natural d20 result.
     * @returns {Promise<object>}
     */
    async _resolve(controlRoll) {
        // Retrieve live actor state for modifier assembly
        const altState = this.actor ? await getAlternityState(this.actor) : null;
        const modifiers = [];

        if (altState) {
            // Apply current damage step penalty (including Dazed)
            const damagePenalty = altState.getDamageStepPenalty();
            if (damagePenalty > 0) {
                modifiers.push(AlternityMathService.buildModifier(
                    'Wound/Dazed Penalty', damagePenalty, 'Current durability penalty'
                ));
            }

            // Active stance/passive modifiers (Steps)
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

        // Use the first check's base values (triple scores)
        const primaryCheck = this.checks[0];
        const stepModifier = safeInt(this.container.querySelector(`.${NS}-roll-step-select`)?.value, 0);
        if (stepModifier !== 0) {
            modifiers.push(AlternityMathService.buildModifier(
                'Situational Modifier', stepModifier, 'Manually selected situation step'
            ));
        }

        // Calculate situation die based on modifiers
        const totalModifier = modifiers.reduce((sum, m) => sum + m.value, 0);
        const totalStep = primaryCheck.baseStep + totalModifier;
        const totalStepClamped = Math.min(7, Math.max(-5, totalStep));
        
        // Post to Foundry Chat using native Roll for interactivity and better visuals
        const formula = totalStepClamped === 0 ? '1d20' : `1d20${SITUATION_DIE_SCALE[String(totalStepClamped)][2]}`;
        const roll = new Roll(formula);
        await roll.evaluate();

        // Extract actual dice results from the evaluated Roll object to ensure consistency
        // with the Alternity math service (1d20 is terms[0], situation die is terms[2])
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
        
        // Assemble roll options for the unified chat message
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

        // Post to chat using the actor's unified method
        await this.actor._createRollChatMessage(roll, rollOptions);

        this.container.dispatchEvent(new CustomEvent('alternity:rollResult', {
            bubbles: true,
            detail: this._result,
        }));

        return this._result;
    }

    _showValidationError(msg) {        const existing = this.container.querySelector(`.${NS}-roll-error`);
        if (existing) existing.remove();
        const err = document.createElement('p');
        err.className = `${NS}-roll-error`;
        err.textContent = msg;
        err.setAttribute('role', 'alert');
        this.container.querySelector(`.${NS}-roll-panel`)?.appendChild(err);
        setTimeout(() => err.remove(), 4000);
    }

    /** Escape HTML special characters for safe innerHTML insertion. */
    _esc(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
}

// ---------------------------------------------------------------------------
// AlternitySheetApplication
// ---------------------------------------------------------------------------

/**
 * The main character sheet for Alternity actors.
 *
 * Extends Foundry's ActorSheet. All Alternity-specific state is read from
 * the actor's flags via getAlternityState() and written back via saveAlternityState().
 */
class AlternitySheetApplication extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {
    /** @override */
    static get DEFAULT_OPTIONS() {
        return foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
            classes: [NS, `${NS}-sheet-app`],
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
                setPsionicEnergy: this._onPsionicPipAction
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

        const actor = this.document || actualOptions.document;
        if (!actor) throw new Error('[AlternitySheetApplication] valid actor required.');

        this._activeRoller = null;
        this._altState = null;
        this._activeTab = 'character';
        this._skillFilter = '';
    }

    // -----------------------------------------------------------------------
    // Foundry Application lifecycle
    // -----------------------------------------------------------------------

    /** @override */
    async _prepareContext(options) {
        this._altState = await getAlternityState(this.actor) || new AlternityCharacterState({ actorId: this.actor.id });
        const state    = this._altState;

        const dur      = state.durability;

        // Build rich abilities object for the sheet
        const abilities = {};
        for (const ab of ABILITIES) {
            abilities[ab] = {
                label:     ab,
                score:     state.abilityScores[ab],
                ...state.getAbilityData(ab)
            };
        }

        // Group skills by ability for the Skills tab
        const skillsByAbility = {};
        const psionicSkills = [];

        for (const ab of ABILITIES) {
            // Get all skills for this ability
            const allForAb = [
                ...SKILL_DEFINITIONS.filter(d => d.ability === ab).map(d => ({
                    ...d,
                    rank: state.skills[d.id]?.rank ?? 0,
                    scores: state.getSkillScores(d.id),
                    isCustom: false
                })),
                ...state.customSkills.filter(s => s.ability === ab).map(s => ({
                    ...s,
                    scores: state.getSkillScores(s.id),
                    isCustom: true
                }))
            ];

            // Separate psionic skills
            const nonPsionic = allForAb.filter(s => !s.isPsionic);
            const psionicOnly = allForAb.filter(s => s.isPsionic);
            psionicSkills.push(...psionicOnly);

            // Organize into Broad -> Specialties hierarchy
            const hierarchy = [];
            const broads = nonPsionic.filter(s => !s.isSpecialty);
            
            for (const broad of broads) {
                const specialties = nonPsionic.filter(s => s.parent === broad.id);
                hierarchy.push({
                    ...broad,
                    specialties
                });
            }

            // Handle specialties without a broad parent (if any) or orphaned custom skills
            const orphans = nonPsionic.filter(s => s.isSpecialty && !hierarchy.some(h => h.specialties.some(sp => sp.id === s.id)));
            if (orphans.length > 0) {
                hierarchy.push({
                    id: `orphans-${ab}`,
                    name: 'Other',
                    isSpecialty: false,
                    isOrphanContainer: true,
                    specialties: orphans
                });
            }

            skillsByAbility[ab] = hierarchy;
        }

        // Build psionic hierarchy
        const psionicHierarchy = [];
        const psionicBroads = psionicSkills.filter(s => !s.isSpecialty);
        for (const broad of psionicBroads) {
            const specialties = psionicSkills.filter(s => s.parent === broad.id);
            psionicHierarchy.push({
                ...broad,
                specialties
            });
        }

        // Group items for the sheet
        const weaponItems = this.actor.items.filter(i => i.type === 'weapon');
        const armorItems  = this.actor.items.filter(i => i.type === 'armor');
        const computerItems = this.actor.items.filter(i => i.type === 'computer');

        const ctx = {
            actor: this.actor,
            alt: NS,
            abilities,
            ABILITIES,
            skillsByAbility,
            actionCheck:      state.getActionCheckData(),
            actionsPerRound:  state.getActionsPerRound(),
            durability: {
                stun:   { current: dur.stun,   max: dur.stunMax,   pct: pct(dur.stun,   dur.stunMax),   label: 'Stun' },
                wound:  { current: dur.wound,  max: dur.woundMax,  pct: pct(dur.wound,  dur.woundMax),  label: 'Wound' },
                mortal: { current: dur.mortal, max: dur.mortalMax, pct: pct(dur.mortal, dur.mortalMax), label: 'Mortal' },
            },
            woundLevel:       state.woundLevel,
            WOUND_LEVELS,
            WOUND_SEVERITY,
            woundSeverity:    WOUND_SEVERITY[state.woundLevel] || 'healthy',
            woundPenalty:     state.getDamageStepPenalty(),
            isIncapacitated:  state.woundLevel === 'Out',
            abilitiesList: state.abilitySets.filter(a => a.type === ABILITY_TYPES.STANCE || a.type === ABILITY_TYPES.PASSIVE),
            actions:  state.abilitySets.filter(a => a.type === ABILITY_TYPES.ACTION),
            specialRules: state.specialRules,
            activeTab: this._activeTab,
            profession: state.profession,
            career: state.career,
            background: state.background,
            armor: state.armor,
            combatMovement: state.combatMovement || { sprint: 0, run: 0, walk: 0, easySwim: 0, swim: 0, glide: 0, fly: 0 },
            personalData: state.personalData || { age: '', height: '', weight: '', appearance: '', allegiance: '', socialStatus: '', contacts: '', enemies: '' },
            achievementTrack: {
                level: state.achievementTrack?.level || 1,
                checkmarks: [...Array(23).keys()].map(i => i < (state.achievementTrack?.level || 1))
            },
            features: state.features || { usePsionics: false, useMutations: false, useCybertech: false },
            psionics: state.psionics || { energy: { value: 0, max: 0 }, powers: [] },
            psionicEnergyTrack: [...Array(state.psionics?.energy?.max || 0).keys()].map(i => i < (state.psionics?.energy?.value || 0)),
            psionicHierarchy,
            mutations: state.mutations || { 
                origin: '', uniqueness: '', points: 0, drawbackPoints: 0, 
                ordinary: '', good: '', amazing: '', 
                slightDrawbacks: '', moderateDrawbacks: '', extremeDrawback: '' 
            },
            cybertech: state.cybertech || { tolerance: { value: 0, max: 0 }, cykosis: 0, gearInstalled: '' },
            weaponItems,
            armorItems,
            computerItems,
            inventory: {
                weapons: weaponItems,
                armor:   armorItems
            },
            ABILITY_TYPES,
            ACTION_TYPE: ABILITY_TYPES.ACTION,
            ACTION_ICON: ABILITY_TYPE_ICONS[ABILITY_TYPES.ACTION],
            ABILITY_TYPE_ICONS,
            fmtMod,
            abilityCardTemplate: "systems/alternity-v2/templates/actor/ability-card.hbs"
        };
        return ctx;
    }

    /** @override */
    _onRender(context, options) {
        const html = this.element;
        this._activateListeners(html);
    }

    _activateListeners(html) {
        html.addEventListener('change', (e) => this._onSheetChange(e));
        html.querySelector(`[data-field="name"]`)?.addEventListener('blur', (e) => {
            this._onNameChange(e.target.textContent.trim());
        });

        // Real-time skill filtering
        const searchInput = html.querySelector(`.${NS}-skills-search-input`);
        if (searchInput) {
            searchInput.value = this._skillFilter;
            searchInput.addEventListener('input', (e) => {
                this._skillFilter = e.target.value;
                this.constructor._onFilterSkillsAction.call(this, e, e.target);
            });
            // Apply current filter immediately after render if it exists
            if (this._skillFilter) {
                this.constructor._onFilterSkillsAction.call(this, null, searchInput);
            }
        }

        // Inline ability editing
        html.querySelectorAll(`.${NS}-ability-name[contenteditable="true"], .${NS}-ability-desc[contenteditable="true"]`).forEach(el => {
            el.addEventListener('blur', (e) => this._onAbilityEdit(e));
        });

        // Custom skill name editing
        html.querySelectorAll(`.${NS}-custom-skill-name[contenteditable="true"]`).forEach(el => {
            el.addEventListener('blur', (e) => this._onCustomSkillNameEdit(e));
        });

        html.addEventListener('alternity:rollResult', (e) => this._onRollResult(e.detail));
        html.addEventListener('alternity:rollClosed', () => {
            html.querySelector(`.${NS}-roll-mount`).hidden = true;
            this._activeRoller = null;
        });
    }

    async _onAbilityEdit(event) {
        const el = event.target;
        const abilityId = el.dataset.abilityId;
        const field = el.dataset.field;
        const newValue = el.textContent.trim();
        const state = this._altState;

        const ability = state.abilitySets.find(a => a.id === abilityId);
        if (!ability) return;

        if (field === 'name') {
            ability.name = newValue || 'Unnamed Ability';
        } else if (field === 'description') {
            ability.effectPayload.reason = newValue;
        }

        await saveAlternityState(this.actor, state);
    }

    async _onSheetChange(e) {
        const input  = e.target;
        const action = input.dataset.action;
        if (action === 'editResource') {
            await this._onEditResource(
                input.dataset.resource,
                input.dataset.field,
                safeInt(input.value, 0),
                this.element
            );
        } else if (action === 'editAbility') {
            await this._onEditAbility(
                input.dataset.ability,
                safeInt(input.value, 0),
                this.element
            );
        } else if (action === 'editState') {
            await this._onEditState(
                input.dataset.field,
                input.value,
                input
            );
        } else if (action === 'editArmor') {
            await this._onEditArmor(
                input.dataset.type,
                input.value,
                this.element
            );
        } else if (action === 'editSkill') {
            await this.constructor._onEditSkillAction.call(this, e, input);
        } else if (action === 'editComputer') {
            await this._onEditComputer(
                input.dataset.idx,
                input.dataset.field,
                input.value
            );
        }
    }

    async _onEditAbility(ability, value, html) {
        const state = this._altState;
        state.setAbilityScore(ability, value);
        await saveAlternityState(this.actor, state);
        // Derived stats like Action Check and Res Mod change, so we must re-render
        this.render(true);
    }

    async _onEditState(field, value, target) {
        const state = this._altState;

        // Detect if the change came from a checkbox
        const finalValue = (target?.type === 'checkbox' || target?.tagName === 'INPUT' && target?.type === 'checkbox') ? target.checked : value;

        foundry.utils.setProperty(state, field, finalValue);
        await saveAlternityState(this.actor, state);
        // If profession or features changed, re-render to update UI
        if (field === 'profession' || field.startsWith('features.')) this.render(true);
    }
    async _onEditArmor(type, value, html) {
        const state = this._altState;
        if (state.armor.hasOwnProperty(type)) {
            state.armor[type] = value;
            await saveAlternityState(this.actor, state);
        }
    }

    static _onTabAction(event, target) {
        const tab = target.dataset.tab;
        if (!tab) return;
        
        this._activeTab = tab;
        const html = this.element;
        // Toggle active class without full re-render for responsiveness
        html.querySelectorAll(`.${NS}-tab-panel`).forEach(p => {
            p.classList.toggle('active', p.dataset.tabPanel === this._activeTab);
        });
        html.querySelectorAll(`.${NS}-nav-btn`).forEach(b => {
            b.classList.toggle('active', b.dataset.tab === this._activeTab);
        });
    }

    static async _onToggleAbilityAction(event, target) {
        const abilityId = target.dataset.abilityId;
        const state   = this._altState;
        const ability = state.abilitySets.find(a => a.id === abilityId);
        if (!ability) return;
        ability.isActive ? ability.deactivate() : ability.activate();
        await saveAlternityState(this.actor, state);
        const card = this.element.querySelector(`[data-ability-id="${abilityId}"]`);
        const toggleBtn = card?.querySelector(`.${NS}-toggle-btn`);
        if (card && toggleBtn) {
            card.classList.toggle('active', ability.isActive);
            toggleBtn.classList.toggle('on',  ability.isActive);
            toggleBtn.classList.toggle('off', !ability.isActive);
            toggleBtn.setAttribute('aria-pressed', String(ability.isActive));
            toggleBtn.textContent = ability.isActive ? '◆' : '◇';
            const useBtn = card.querySelector(`.${NS}-use-btn`);
            if (useBtn) useBtn.disabled = !ability.isActive;
        }
    }

    static async _onDeleteAbilityAction(event, target) {
        const abilityId = target.dataset.abilityId;
        const state = this._altState;
        state.removeAbility(abilityId);
        await saveAlternityState(this.actor, state);
        const card = this.element.querySelector(`[data-ability-id="${abilityId}"]`);
        if (card) {
            card.style.transition = 'opacity 0.2s, transform 0.2s';
            card.style.opacity    = '0';
            card.style.transform  = 'translateX(20px)';
            setTimeout(() => card.remove(), 200);
        }
    }

    static async _onUseAbilityAction(event, target) {
        const abilityId = target.dataset.abilityId;
        const state   = this._altState;
        const ability = state.abilitySets.find(a => a.id === abilityId);
        if (!ability || !ability.isActive) return;
        const context   = ability.triggerCondition?.context || 'General';
        const baseValue = ability.effectPayload?.baseValue || 25;
        this._openRoller([{ name: ability.name, baseValue }], context, this.element);
    }

    static async _onAddAbilityAction(event, target) {
        const type = target.dataset.type;
        const id   = `ability-${Date.now()}`;
        const name = `New ${type}`;
        const state = this._altState;
        if (state.abilitySets.some(a => a.id === id)) return;
        state.addAbility(new AlternityAbilitySet({ id, name, type }));
        await saveAlternityState(this.actor, state);
        await this.render(true);
    }

    static async _onSetWoundAction(event, target) {
        const woundLevel = target.dataset.wound;
        const state = this._altState;
        state.setWoundLevel(woundLevel);
        await saveAlternityState(this.actor, state);
        const badge = this.element.querySelector(`.${NS}-wound-badge`);
        if (badge) {
            badge.className = `${NS}-wound-badge ${NS}-wound-badge--${WOUND_SEVERITY[woundLevel]}`;
            badge.textContent = woundLevel;
            const penalty = state.getDamageStepPenalty();
            if (penalty) {
                const em = document.createElement('em');
                em.textContent = `(${fmtMod(penalty)})`;
                badge.appendChild(em);
            }
        }
        this.element.querySelectorAll(`.${NS}-wound-pip`).forEach(pip => {
            pip.classList.toggle('active', pip.dataset.wound === woundLevel);
        });
    }

    static _onQuickRollAction(event, target) {
        const context = target.dataset.context;
        const ability = target.dataset.ability;
        const score = this._altState.abilityScores[ability] ?? 10;
        
        // Quick rolls use base ability score as the ordinary success threshold
        const scores = { ordinary: score, good: Math.floor(score/2), amazing: Math.floor(score/4) };
        const baseStep = 1; // Ability/Feat check
        
        this._openRoller([{ name: `${context} Check`, scores, baseStep }], context, this.element);
    }

    static async _onToggleRuleAction(event, target) {
        const ruleId = target.dataset.ruleId;
        const enabled = target.checked;
        const state = this._altState;
        try { state.setSpecialRule(ruleId, enabled); } catch { return; }
        await saveAlternityState(this.actor, state);
        const card = this.element.querySelector(`[data-rule-id="${ruleId}"]`);
        card?.classList.toggle('active', enabled);
    }

    static async _onPsionicPipAction(event, target) {
        const val = safeInt(target.dataset.value, 0);
        const state = this._altState;
        if (!state.psionics) return;
        
        // If clicking the current value, toggle down by 1
        if (state.psionics.energy.value === val) {
            state.psionics.energy.value = val - 1;
        } else {
            state.psionics.energy.value = val;
        }
        
        state.psionics.energy.value = Math.max(0, state.psionics.energy.value);
        await saveAlternityState(this.actor, state);
        this.render();
    }

    static async _onEditSkillAction(event, target) {
        console.log('[Alternity] _onEditSkillAction triggered', { event, target });
        const skillId = target.dataset.skillId;
        const rank = safeInt(target.value, 0);
        console.log(`[Alternity] Skill: ${skillId}, Rank: ${rank}`);
        
        const state = this._altState;
        if (!state) {
            console.error('[Alternity] State is null');
            return;
        }
        
        state.setSkillRank(skillId, rank);
        await saveAlternityState(this.actor, state);
        console.log('[Alternity] State saved');
        
        // Scores change when rank changes, so re-render the skill item
        const row = this.element.querySelector(`[data-skill-id="${skillId}"]`);
        if (row) {
            const scores = state.getSkillScores(skillId);
            console.log(`[Alternity] New scores for ${skillId}:`, scores);
            const scoreCol = row.querySelector(`.${NS}-skill-score-col`);
            if (scoreCol) scoreCol.textContent = `${scores.ordinary} / ${scores.good} / ${scores.amazing}`;
        } else {
            console.warn(`[Alternity] Could not find row for skillId ${skillId}`);
        }
    }

    async _onCustomSkillNameEdit(event) {
        const el = event.target;
        const skillId = el.dataset.skillId;
        const newName = el.textContent.trim();
        const state = this._altState;

        const custom = state.customSkills.find(s => s.id === skillId);
        if (!custom) return;

        custom.name = newName || 'New Skill';
        await saveAlternityState(this.actor, state);
    }

    static async _onAddSkillAction(event, target) {
        const ability = target.dataset.ability;
        const state = this._altState;
        state.addCustomSkill({
            name: 'New Skill',
            ability: ability,
            isSpecialty: true,
            rank: 0
        });
        await saveAlternityState(this.actor, state);
        this.render();
    }

    static async _onDeleteSkillAction(event, target) {
        const skillId = target.dataset.skillId;
        const state = this._altState;
        state.removeCustomSkill(skillId);
        await saveAlternityState(this.actor, state);
        this.render();
    }

    static async _onRollSkillAction(event, target) {
        const skillId = target.dataset.skillId;
        const state = this._altState;
        const actorData = await import('../data/alternity-actor-data.js');
        let skillDef = actorData.SKILL_DEFINITIONS.find(d => d.id === skillId);

        if (!skillDef) {
            skillDef = state.customSkills.find(s => s.id === skillId);
        }

        if (!skillDef) return;

        const scores = state.getSkillScores(skillId);
        const baseStep = state.getSkillBaseStep(skillId);

        this._openRoller([{ name: skillDef.name, scores, baseStep }], skillDef.name, this.element);
    }

    static _onFilterSkillsAction(event, target) {
        const query = target.value.toLowerCase().trim();
        const html = this.element;
        const groups = html.querySelectorAll(`.${NS}-skill-group`);

        groups.forEach(group => {
            const groupNameEl = group.querySelector(`.${NS}-skill-group-header`);
            const groupName = groupNameEl ? groupNameEl.textContent.toLowerCase() : '';
            const groupMatches = groupName.includes(query);
            
            const broadContainers = group.querySelectorAll(`.${NS}-skill-broad-container`);
            let visibleInGroup = 0;

            broadContainers.forEach(container => {
                const broadItem = container.querySelector(`.${NS}-skill-item.is-broad`);
                const specialtyItems = container.querySelectorAll(`.${NS}-skill-item.is-specialty`);
                
                // Helper to get name from either button or contenteditable span
                const getName = (item) => {
                    const btn = item.querySelector(`.${NS}-skill-roll-btn`);
                    if (btn) return btn.textContent.toLowerCase();
                    const span = item.querySelector(`.${NS}-custom-skill-name`);
                    if (span) return span.textContent.toLowerCase();
                    const nameSpan = item.querySelector(`.${NS}-skill-name`);
                    return nameSpan ? nameSpan.textContent.toLowerCase() : '';
                };

                const broadName = broadItem ? getName(broadItem) : '';
                const broadMatches = broadName.includes(query);
                
                let visibleSpecialties = 0;
                specialtyItems.forEach(sItem => {
                    const sName = getName(sItem);
                    const sMatches = groupMatches || broadMatches || sName.includes(query);
                    sItem.hidden = !sMatches;
                    if (sMatches) visibleSpecialties++;
                });

                // A broad skill is visible if the group matches, it matches itself, or any specialty matches
                const showBroad = groupMatches || broadMatches || visibleSpecialties > 0;
                if (broadItem) broadItem.hidden = !showBroad;
                
                // Hide the whole container if nothing inside is visible
                container.hidden = !showBroad && visibleSpecialties === 0;
                if (!container.hidden) visibleInGroup++;
            });

            // Hide the entire group if no skills match AND the group header doesn't match
            group.hidden = visibleInGroup === 0 && !groupMatches;
        });
    }

    async _onEditResource(resourceKey, field, value, html) {
        const state = this._altState;
        // Map durability keys (stun, wound, mortal) directly to durability state
        if (!state.durability.hasOwnProperty(resourceKey)) return;
        
        // Update current value only
        if (field === 'current') {
            state.durability[resourceKey] = Math.max(0, value);
        }
        
        state._recalculateWoundLevel?.();
        await saveAlternityState(this.actor, state);
        
        // Query the DOM element for the bar
        const barEl = html.querySelector(`[data-resource="${resourceKey}"] .${NS}-bar-fill`);
        if (barEl) {
            const cur   = state.durability[resourceKey];
            const max   = state.durability[resourceKey + 'Max'];
            barEl.style.width = pct(cur, max);
        }
    }

    _onRollResult(result) { console.log('[AlternitySheet] Roll result:', result); }

    async _onNameChange(newName) {
        if (!newName) return;
        try { await this.actor.update({ name: newName }); } catch {}
    }

    _openRoller(checks, context, html) {
        const mount = html.querySelector(`.${NS}-roll-mount`);
        if (!mount) return;
        mount.hidden  = false;
        mount.innerHTML = '';
        this._activeRoller = new AlternityRollComponent(mount, this.actor, checks, context);
        this._activeRoller.render();
        mount.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    _animateIn(html) {
        const cards = html.querySelectorAll(`.${NS}-ability-card, .${NS}-rule-card, .${NS}-resource-bar`);
        cards.forEach((card, i) => {
            card.style.opacity   = '0';
            card.style.transform = 'translateY(8px)';
            card.style.transition = `opacity 0.25s ${i * 30}ms, transform 0.25s ${i * 30}ms`;
            requestAnimationFrame(() => {
                card.style.opacity   = '1';
                card.style.transform = 'translateY(0)';
            });
        });
    }

    static async _onAddItemAction(event, target) {
        const type = target.dataset.type;
        if (!type) return;
        const itemData = {
            name: `New ${type.charAt(0).toUpperCase() + type.slice(1)}`,
            type: type,
            system: {}
        };
        await this.actor.createEmbeddedDocuments('Item', [itemData]);
    }

    static async _onDeleteItemAction(event, target) {
        const itemId = target.closest('[data-item-id]')?.dataset.itemId;
        if (!itemId) return;
        const item = this.actor.items.get(itemId);
        if (!item) return;

        const confirm = await foundry.applications.api.DialogV2.confirm({
            content: `<p>Are you sure you want to delete <strong>${item.name}</strong>?</p>`,
            rejectClose: false,
            modal: true
        });

        if (confirm) {
            await this.actor.deleteEmbeddedDocuments('Item', [itemId]);
        }
    }

    static async _onEditItemAction(event, target) {
        const itemId = target.closest('[data-item-id]')?.dataset.itemId;
        if (!itemId) return;
        const item = this.actor.items.get(itemId);
        item?.sheet.render(true);
    }

    static async _onRollWeaponAction(event, target) {
        const itemId = target.dataset.itemId;
        const item = this.actor.items.get(itemId);
        if (!item || item.type !== 'weapon') return;

        // Implementation of weapon rolling would go here, 
        // likely calling AlternityMathService and opening the roller.
        console.log(`[Alternity] Rolling attack for ${item.name}`);
        
        // For now, just a placeholder that opens the roller with some data
        const context = item.system.weaponType === 'Melee' ? 'Melee Attack' : 'Ranged Attack';
        const ability = item.system.attackAbility.toUpperCase();
        const score = this._altState.abilityScores[ability] ?? 10;
        const scores = { ordinary: score, good: Math.floor(score/2), amazing: Math.floor(score/4) };
        
        this._openRoller([{ 
            name: item.name, 
            scores, 
            baseStep: item.system.weaponType === 'Melee' ? 0 : 1 // Simple logic for now
        }], context, this.element);
    }

}

async function registerAlternitySheet() {
    // Register Handlebars helpers
    Handlebars.registerHelper('fmtMod', fmtMod);
    Handlebars.registerHelper('firstChar', (str) => String(str ?? '')[0]);
    Handlebars.registerHelper('pct', pct);
    Handlebars.registerHelper('add', (a, b) => Number(a) + Number(b));
    Handlebars.registerHelper('and', (a, b) => a && b);
    Handlebars.registerHelper('or', (a, b) => a || b);
    
    // Register partials
    await foundry.applications.handlebars.loadTemplates([
        "systems/alternity-v2/templates/actor/ability-card.hbs"
    ]);

    const ItemsCollection = foundry.documents.collections.Items ?? Items;
    if (typeof ItemsCollection !== 'undefined') {
        const { AlternityItemSheet } = await import('./alternity-item-sheet.js');
        ItemsCollection.registerSheet('alternity-v2', AlternityItemSheet, {
            makeDefault: true,
            label:       'Alternity Item Sheet',
        });
    }

    const ActorsCollection = foundry.documents.collections.Actors ?? Actors;
    if (typeof ActorsCollection === 'undefined') return;
    ActorsCollection.registerSheet('alternity-v2', AlternitySheetApplication, {
        makeDefault: true,
        label:       'Alternity Character Sheet',
    });
}

export {
    AlternityRollComponent,
    AlternitySheetApplication,
    registerAlternitySheet,
    pct,
    fmtMod,
    WOUND_SEVERITY,
    DEGREE_CLASSES,
};
