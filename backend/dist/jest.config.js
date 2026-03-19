"use strict";
module.exports = {
    testEnvironment: 'node',
    testMatch: ['**/tests/**/*.test.js'],
    setupFilesAfterEnv: ['./tests/setup.js'],
    clearMocks: true,
    restoreMocks: true,
    verbose: true,
    testTimeout: 30000,
};
//# sourceMappingURL=jest.config.js.map