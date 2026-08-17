/**
 * @fileoverview Tests `bindOnce`, which is what stops this system's sheets from
 * stacking a duplicate listener on every render.
 *
 * The fault it prevents: `_onRender` runs after every render, but a sheet's root
 * element is created once and reused (Foundry replaces the rendered *part* inside
 * it). So `this.element.addEventListener('change', …)` in `_onRender` accumulates
 * one handler per render — and because the change handler saves and re-renders,
 * a single edit ended up firing that cycle once per render the sheet had been
 * through.
 */

import { bindOnce, markerFor } from '../src/client/alternity-sheet-binding.js';

/** A stand-in for a sheet root: a dataset and a listener tally. */
function makeRoot() {
    return {
        dataset: {},
        listeners: [],
        addEventListener(type, fn) { this.listeners.push({ type, fn }); },
    };
}

describe('bindOnce', () => {
    test('attaches on the first render and never again', () => {
        const root = makeRoot();
        const attach = (el) => el.addEventListener('change', () => {});

        expect(bindOnce(root, 'sheetChange', attach)).toBe(true);
        // Five more renders, as a sheet left open would see.
        for (let i = 0; i < 5; i++) expect(bindOnce(root, 'sheetChange', attach)).toBe(false);

        expect(root.listeners).toHaveLength(1);
    });

    test('tracks binding groups independently', () => {
        // The sheet's own change handling and drag-and-drop are added by different
        // callers; neither may block the other.
        const root = makeRoot();
        expect(bindOnce(root, 'sheetChange', (el) => el.addEventListener('change', () => {}))).toBe(true);
        expect(bindOnce(root, 'dragDrop', (el) => el.addEventListener('drop', () => {}))).toBe(true);
        expect(bindOnce(root, 'dragDrop', (el) => el.addEventListener('drop', () => {}))).toBe(false);

        expect(root.listeners.map(l => l.type)).toEqual(['change', 'drop']);
    });

    test('marks the root so the state is visible in the DOM inspector', () => {
        const root = makeRoot();
        bindOnce(root, 'sheetChange', () => {});
        expect(root.dataset.altBoundSheetChange).toBe('true');
    });

    test('a replaced root element rebinds', () => {
        // If Foundry ever swaps the root wholesale, the marker goes with it and the
        // next render must bind again — that is correct, not a leak.
        const attach = (el) => el.addEventListener('change', () => {});
        const first = makeRoot();
        const second = makeRoot();
        bindOnce(first, 'sheetChange', attach);
        expect(bindOnce(second, 'sheetChange', attach)).toBe(true);
        expect(second.listeners).toHaveLength(1);
    });

    test('does not retry after attach throws', () => {
        // Documented on purpose: the marker is written first, so a half-finished
        // attach leaves listeners missing rather than doubled.
        const root = makeRoot();
        let calls = 0;
        const broken = (el) => {
            calls++;
            el.addEventListener('change', () => {});
            throw new Error('half way');
        };

        expect(() => bindOnce(root, 'sheetChange', broken)).toThrow('half way');
        expect(bindOnce(root, 'sheetChange', broken)).toBe(false);
        expect(calls).toBe(1);
        expect(root.listeners).toHaveLength(1);
    });

    test('is a no-op when there is nothing to bind', () => {
        const root = makeRoot();
        // `_onRender` can run before the element exists in some render paths, and a
        // missing root must not throw or mark anything.
        expect(bindOnce(null, 'sheetChange', () => {})).toBe(false);
        expect(bindOnce(undefined, 'sheetChange', () => {})).toBe(false);
        expect(bindOnce({}, 'sheetChange', () => {})).toBe(false);
        expect(bindOnce(root, 'sheetChange', null)).toBe(false);
        expect(bindOnce(root, '', () => {})).toBe(false);
        expect(root.dataset).toEqual({});
    });
});

describe('markerFor', () => {
    test('builds a camelCase dataset key, i.e. a data-alt-bound-* attribute', () => {
        expect(markerFor('change')).toBe('altBoundChange');
        expect(markerFor('dragDrop')).toBe('altBoundDragDrop');
    });
});
