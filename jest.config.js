export default {
  testEnvironment: 'node',
  transform: {},
  // Defines a minimal `foundry` global before any module is imported. The
  // TypeDataModels read `foundry.data.fields` and extend
  // `foundry.abstract.TypeDataModel` at import time, so without this they cannot be
  // loaded under Node at all — which is what kept `migrateData` untested.
  setupFiles: ['<rootDir>/tests/mocks/foundry-globals.js'],
  moduleNameMapper: {
    'module-info\\.js$': '<rootDir>/tests/mocks/module-info.js'
  }
};
