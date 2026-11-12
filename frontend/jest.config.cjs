const path = require('path');

module.exports = {
  roots: ['<rootDir>/src'],
  // jsdom lacks fetch/Request; CRA polyfilled them with whatwg-fetch (react-router data routers need Request).
  setupFiles: ['whatwg-fetch'],
  setupFilesAfterEnv: ['<rootDir>/src/setupTests.ts'],
  testEnvironment: 'jsdom',
  resetMocks: true,
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.{js,jsx,ts,tsx}',
    '<rootDir>/src/**/*.{spec,test}.{js,jsx,ts,tsx}',
  ],
  moduleFileExtensions: ['js', 'ts', 'tsx', 'json', 'jsx', 'node'],
  transform: {
    '^.+\\.(js|jsx|mjs|cjs|ts|tsx)$': [
      'babel-jest',
      { configFile: path.join(__dirname, 'jest/babel.config.cjs') },
    ],
    '^.+\\.css$': '<rootDir>/jest/cssTransform.cjs',
    '^(?!.*\\.(js|jsx|mjs|cjs|ts|tsx|css|json)$)': '<rootDir>/jest/fileTransform.cjs',
  },
  moduleNameMapper: {
    '\\?worker$': '<rootDir>/jest/workerStub.cjs',
    '^.+\\.module\\.(css|sass|scss)$': 'identity-obj-proxy',
    '^react-router-dom$': '<rootDir>/node_modules/react-router-dom/dist/index.js',
    '^react-router/dom$': '<rootDir>/node_modules/react-router/dist/development/dom-export.js',
    '^@phosphor-icons/react$': '<rootDir>/node_modules/@phosphor-icons/react/dist/index.es.js',
  },
  transformIgnorePatterns: [
    '[/\\\\]node_modules[/\\\\](?!axios|react-router-dom|@remix-run|turbo-stream|@phosphor-icons).+\\.(js|jsx|mjs|cjs|ts|tsx)$',
  ],
  collectCoverageFrom: ['src/services/*.ts', '!src/services/api.ts'],
  coverageThreshold: {
    global: {
      branches: 85,
      lines: 90,
    },
  },
};
