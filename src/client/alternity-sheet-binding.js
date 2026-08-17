/**
 * @file alternity-sheet-binding.js
 * @description `bindOnce` — attach listeners to a sheet's root element exactly once.
 *
 * ## The bug this exists to prevent
 *
 * `_onRender` runs after **every** render, but a sheet's root element is created
 * once and then reused. Verified in Foundry v14's
 * `HandlebarsApplicationMixin._replaceHTML`: it replaces each *part* inside
 * `content`, and `content` **is** `this.element`. So:
 *
 *   _onRender() { this.element.addEventListener('change', …) }
 *
 * stacks one more handler on every render. After five renders a single `change`
 * fires five identical save-and-render cycles, each of which renders again — the
 * cost grows with how long the sheet has been open, which is exactly the kind of
 * fault that never shows up in a quick test and gets blamed on Foundry.
 *
 * Listeners on elements *inside* the part are not affected, because those elements
 * are thrown away and rebuilt by each render; only the root persists. So the rule
 * is: **anything bound to `this.element` goes through here; anything bound to an
 * element the template produced does not.**
 *
 * A root element that is ever replaced wholesale loses its marker with it, and the
 * next `_onRender` rebinds — which is the correct behaviour, not a leak.
 */

/**
 * Attach event listeners to `root` the first time this is called for a given
 * `root`/`key` pair, and never again.
 *
 * `key` names the binding group, so unrelated groups on the same root — the sheet's
 * own `change` handling and drag-and-drop, say — are tracked independently and
 * either can be added without disturbing the other.
 *
 * The marker is written *before* `attach` runs, deliberately: if `attach` throws
 * half way through, some of its listeners are already live, and retrying on the
 * next render would double those. Refusing to retry keeps the failure to "some
 * listeners missing" rather than "some listeners doubled", which is the direction
 * this whole module is here to protect.
 *
 * @param {HTMLElement|null|undefined} root - Usually a sheet's `this.element`.
 * @param {string} key - Names the binding group, e.g. 'change' or 'dragDrop'.
 * @param {(root: HTMLElement) => void} attach - Adds the listeners.
 * @returns {boolean} True if `attach` ran, false if it had already run or there
 *   was nothing to bind to.
 */
export function bindOnce(root, key, attach) {
    if (!root?.dataset || typeof attach !== 'function' || !key) return false;
    const marker = markerFor(key);
    if (root.dataset[marker]) return false;
    root.dataset[marker] = 'true';
    attach(root);
    return true;
}

/**
 * Dataset property for a binding group — `'change'` becomes `altBoundChange`, i.e.
 * the attribute `data-alt-bound-change`, so the markers are visible in the DOM
 * inspector when working out why a handler did or did not attach.
 *
 * @param {string} key
 * @returns {string}
 */
export function markerFor(key) {
    return `altBound${key.charAt(0).toUpperCase()}${key.slice(1)}`;
}
