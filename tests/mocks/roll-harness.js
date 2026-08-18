/**
 * @file roll-harness.js
 * @description A Foundry stand-in good enough to run the roll pipeline under Jest.
 *
 * AlternityRollService is the one service that genuinely needs Foundry: it rolls
 * dice, renders templates and posts chat messages. Testing it therefore means
 * standing those three things up rather than mocking around them — otherwise the
 * pipeline that every sheet's roll button now depends on would have no coverage at
 * all, which is exactly the situation the roll code was in before.
 *
 * The dice are made deterministic (`queueRolls`) so a test can assert on an
 * outcome rather than on a distribution, and templates render to a marker string
 * with their context attached, so a test can inspect what the card was *told*
 * without depending on the markup.
 *
 * Not simulated: schema validation, document lifecycle, canvas. A test that needs
 * those belongs against the math service instead.
 */

// ---------------------------------------------------------------------------
// Deterministic dice
// ---------------------------------------------------------------------------

/** Values `Roll` hands out, in order. Refilled by `queueRolls`. */
let scriptedResults = [];

/**
 * Fix what the next dice will show.
 *
 * Values are consumed one per *die term*, in formula order: a `1d20+1d4` check
 * takes two. A term with several dice (`+3d20`) still takes one value, which is
 * used as that term's total — the individual faces are not modelled because
 * nothing in the system reads them.
 *
 * @param {number[]} values
 */
export function queueRolls(values) {
    scriptedResults = [...values];
}

function nextResult(fallback) {
    return scriptedResults.length ? scriptedResults.shift() : fallback;
}

/**
 * A stand-in for Foundry's Roll, covering the subset the roll pipeline uses:
 * `evaluate()`, `total`, `terms`, and `render()`.
 *
 * Formulas are parsed rather than evaluated for real, because the parse is the
 * part the production code depends on — `AlternityRollService` reads
 * `roll.terms[0]` and `roll.terms[2]` back out to separate the control die from
 * the situation die, and that indexing is worth testing.
 */
export class MockRoll {
    constructor(formula) {
        this.formula = String(formula);
        this.terms = [];
        this.total = 0;
        this._evaluated = false;
    }

    async evaluate() {
        // Split into dice/number terms and the operators between them, keeping the
        // same [term, operator, term, ...] shape Foundry produces.
        const pieces = this.formula.match(/\d*d\d+|\d+|[+\-*/]/g) ?? [];
        let total = 0;
        let sign = 1;

        for (const piece of pieces) {
            if (['+', '-', '*', '/'].includes(piece)) {
                this.terms.push({ operator: piece, total: undefined });
                sign = piece === '-' ? -1 : 1;
                continue;
            }

            const dice = /^(\d*)d(\d+)$/.exec(piece);
            if (dice) {
                const count = dice[1] ? Number(dice[1]) : 1;
                const faces = Number(dice[2]);
                // One scripted value per term. The fallback is the maximum, which
                // makes an unscripted roll obviously wrong rather than plausibly so.
                const value = nextResult(count * faces);
                this.terms.push({ faces, number: count, total: value });
                total += sign * value;
            } else {
                const value = Number(piece);
                this.terms.push({ total: value });
                total += sign * value;
            }
        }

        this.total = total;
        this._evaluated = true;
        return this;
    }

    async render() {
        return `<div class="dice-roll" data-formula="${this.formula}">${this.total}</div>`;
    }

    async toMessage(data = {}) {
        return globalThis.ChatMessage.create({ ...data, rolls: [this] });
    }
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

/** Every message the pipeline posted, newest last. Cleared by `resetHarness`. */
export const chatLog = [];

/** Every template render the pipeline asked for, with the context it passed. */
export const renderLog = [];

/** Notifications the pipeline raised, so a test can assert on a refusal. */
export const notifications = { warn: [], info: [], error: [] };

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

/** Answers `DialogV2.wait` hands back, in order. Refilled by `queueDialogs`. */
let scriptedDialogs = [];

/** Every dialog configuration the code under test asked for. */
export const dialogLog = [];

/**
 * Fix what the next dialogs return.
 *
 * Each value is an object of form values keyed by control `name`, or `null` for a
 * dialog the user dismissed. An unscripted dialog counts as dismissed, so a test
 * that forgets to queue one sees a cancellation rather than a phantom submission.
 *
 * The values are handed to the *real* accept-button callback through a stand-in
 * form, so `_readFormValues` is exercised rather than bypassed — that function is
 * the one piece of dialog plumbing with a Foundry-generation hazard in it.
 *
 * @param {...(object|null)} answers
 */
export function queueDialogs(...answers) {
    scriptedDialogs = [...answers];
}

/** A form whose named controls are the scripted answer. */
function _stubForm(values) {
    const controls = Object.entries(values).map(([name, value]) => (
        typeof value === 'boolean'
            ? { name, type: 'checkbox', checked: value }
            : { name, type: 'text', value: String(value) }
    ));
    return { querySelectorAll: () => controls };
}

// ---------------------------------------------------------------------------
// Installation
// ---------------------------------------------------------------------------

/**
 * Install the harness onto globalThis. Call once per test file, before the modules
 * under test are used.
 */
export function installRollHarness() {
    globalThis.Roll = MockRoll;

    globalThis.ChatMessage = {
        create: async (data) => {
            const message = { ...data, id: `msg-${chatLog.length + 1}` };
            chatLog.push(message);
            return message;
        },
        getSpeaker: ({ actor } = {}) => ({ actor: actor?.id ?? null, alias: actor?.name ?? 'GM' }),
        getWhisperRecipients: () => ['gm-user'],
    };

    globalThis.CONST = { CHAT_MESSAGE_STYLES: { ROLL: 5, OTHER: 0 } };
    globalThis.CONFIG = { sounds: { dice: 'dice.wav' } };

    globalThis.ui = {
        notifications: {
            warn: (m) => notifications.warn.push(m),
            info: (m) => notifications.info.push(m),
            error: (m) => notifications.error.push(m),
        },
    };

    globalThis.canvas = { tokens: { controlled: [], placeables: [] } };

    globalThis.game = {
        // Localization is identity-with-interpolation: a test asserting on a
        // message should assert on the key, not on English prose that may change.
        i18n: {
            localize: (key) => key,
            format: (key, data = {}) => `${key}:${JSON.stringify(data)}`,
        },
        user: { targets: new Set(), name: 'Tester' },
        combat: null,
        // The actor picker offers world actors as well as placed tokens, which is
        // the only reason it can reach an NPC that never got a token.
        actors: { contents: [] },
    };

    // Templates render to a marker holding their context, so a test can inspect
    // what the card was told without coupling to the markup.
    globalThis.foundry.applications = {
        handlebars: {
            renderTemplate: async (path, context) => {
                renderLog.push({ path, context });
                return `<!--${path}-->`;
            },
        },
    };

    globalThis.foundry.applications.api = {
        DialogV2: {
            wait: async (config) => {
                dialogLog.push(config);
                const answer = scriptedDialogs.length ? scriptedDialogs.shift() : null;
                if (!answer) return null;   // dismissed — DialogV2 resolves null
                const accept = config.buttons?.find((b) => b.action === 'accept')
                    ?? config.buttons?.[0];
                return accept?.callback?.({}, { form: _stubForm(answer) }, {}) ?? null;
            },
        },
    };

    globalThis.foundry.utils.fromUuid = async (uuid) => registry.get(uuid) ?? null;
}

/** Documents `fromUuid` can resolve. Populated by `makeActor`. */
const registry = new Map();

/** Wipe everything the harness recorded, between tests. */
export function resetHarness() {
    chatLog.length = 0;
    renderLog.length = 0;
    notifications.warn.length = 0;
    notifications.info.length = 0;
    notifications.error.length = 0;
    scriptedResults = [];
    scriptedDialogs = [];
    dialogLog.length = 0;
    registry.clear();
    tokenCount = 0;
    globalThis.game.user.targets = new Set();
    globalThis.game.combat = null;
    globalThis.game.actors = { contents: [] };
    globalThis.canvas.tokens.controlled = [];
    globalThis.canvas.tokens.placeables = [];
}

/**
 * A minimal actor: enough `system`, `items`, `flags` and `update` for the roll
 * service to read modifiers off it and write damage back to it.
 *
 * @param {object} [options]
 * @param {string} [options.type='creature'] - Anything outside character/npc takes
 *        the schema-backed modifier path rather than the character-state one.
 * @param {object} [options.system]
 * @param {object[]} [options.items]
 * @returns {object}
 */
export function makeActor(options = {}) {
    const { type = 'creature', system = {}, items = [], name = 'Test Actor' } = options;
    const actor = {
        id: `actor-${registry.size + 1}`,
        uuid: `Actor.actor-${registry.size + 1}`,
        name,
        type,
        system,
        flags: {},
        items: {
            _list: items,
            get size() { return this._list.length; },
            filter(fn) { return this._list.filter(fn); },
            find(fn) { return this._list.find(fn); },
            get(id) { return this._list.find((i) => i.id === id); },
            [Symbol.iterator]() { return this._list[Symbol.iterator](); },
        },
        updates: [],
        async update(changes) {
            this.updates.push(changes);
            for (const [path, value] of Object.entries(changes)) {
                globalThis.foundry.utils.setProperty(this, path, value);
            }
            return this;
        },
        getFlag(scope, key) { return this.flags[scope]?.[key]; },
        async setFlag(scope, key, value) {
            (this.flags[scope] ??= {})[key] = value;
            return this;
        },
        async unsetFlag(scope, key) {
            delete this.flags[scope]?.[key];
            return this;
        },
    };
    registry.set(actor.uuid, actor);
    return actor;
}

/** Put a token in front of the user's crosshairs, so target modifiers apply. */
export function targetActor(actor) {
    globalThis.game.user.targets = new Set([{ actor }]);
}

/** Tokens handed out by `placeToken`, so each gets its own uuid. */
let tokenCount = 0;

/**
 * Put a token for an actor on the scene, optionally selected or targeted.
 *
 * The token's own uuid is registered with `fromUuid`, resolving to something with an
 * `.actor` — which is what a TokenDocument does, and what the apply paths rely on so
 * an unlinked token takes damage on its own delta rather than on the world actor.
 *
 * @param {object} actor
 * @param {object} [options]
 * @param {string}  [options.name]
 * @param {boolean} [options.controlled=false]
 * @param {boolean} [options.targeted=false]
 * @returns {object} The placed token.
 */
export function placeToken(actor, options = {}) {
    const { name, controlled = false, targeted = false } = options;
    const token = {
        name: name ?? actor.name,
        actor,
        document: { uuid: `Scene.scene-1.Token.token-${++tokenCount}` },
    };
    registry.set(token.document.uuid, { actor });
    globalThis.canvas.tokens.placeables.push(token);
    if (controlled) globalThis.canvas.tokens.controlled.push(token);
    if (targeted) globalThis.game.user.targets.add(token);
    return token;
}

/** Put actors in the world collection, so the actor picker can offer them. */
export function worldActors(...actors) {
    globalThis.game.actors = { contents: [...actors] };
}
