module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: ['**/tests/**/*.test.[jt]s'],
    testPathIgnorePatterns: ['/node_modules/', '/dist/'],
    setupFilesAfterEnv: ['./tests/setup.ts'],
    clearMocks: true,
    restoreMocks: true,
    verbose: true,
    testTimeout: 30000,
    moduleNameMapper: {
        '^../controllers/(.*)$': '<rootDir>/controllers/$1',
        '^../services/(.*)$': '<rootDir>/services/$1',
        '^../db$': '<rootDir>/db.ts',
    },
};
