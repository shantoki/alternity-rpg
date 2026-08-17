/**
 * @file foundry-globals.js
 * @description Minimal `foundry` global for Jest, loaded via `setupFiles`.
 *
 * Foundry globals do not exist under Node, which is why production code that
 * touches them imports through `module-info.js`. The TypeDataModels are the one
 * exception that cannot follow that rule: every `src/data/*Data.js` reads
 * `foundry.data.fields` at module scope and extends `foundry.abstract.TypeDataModel`
 * in its class heritage, both of which run at import time.
 *
 * That made the data models untestable, which mattered most for `migrateData` —
 * the code that rewrites a Gamemaster's existing actors in place, and the one place
 * in this system where a mistake destroys data rather than displaying it wrong.
 *
 * This mock is deliberately shallow. It exists to let a module *load* and to let
 * static helpers like `migrateData` run; it does not simulate schema validation,
 * so a test that needs real field behaviour should test the math service instead.
 */

/** Every field constructor returns its own options, which is enough to load. */
const fieldNames = [
    'StringField', 'NumberField', 'BooleanField', 'ArrayField', 'SchemaField',
    'HTMLField', 'ObjectField', 'FilePathField', 'DocumentIdField', 'SetField',
    'ColorField', 'AnyField', 'IntegerSortField',
];

const fields = {};
for (const name of fieldNames) {
    fields[name] = function MockField(...args) {
        return { fieldType: name, args };
    };
}

class TypeDataModel {
    static defineSchema() { return {}; }
    /** The real base class normalises legacy shapes; passing through is enough here. */
    static migrateData(source) { return source; }
    prepareBaseData() {}
    prepareDerivedData() {}
}

globalThis.foundry = {
    data: { fields },
    abstract: { TypeDataModel, DataModel: TypeDataModel },
    utils: {
        deepClone: (o) => (typeof o === 'object' && o !== null ? structuredClone(o) : o),
        mergeObject: (a, b) => ({ ...(a ?? {}), ...(b ?? {}) }),
        getProperty: (o, p) => p.split('.').reduce((x, k) => x?.[k], o),
        setProperty: (o, p, v) => {
            const keys = p.split('.');
            const last = keys.pop();
            keys.reduce((x, k) => (x[k] ??= {}), o)[last] = v;
            return true;
        },
        isPlainObject: (o) => Object.prototype.toString.call(o) === '[object Object]',
    },
};
