const baseConfig = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: './tsconfig.test.json' }],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@release-owl/contracts$': '<rootDir>/packages/contracts/src/index.ts',
    '^@release-owl/platform$': '<rootDir>/packages/platform/src/index.ts',
  },
  setupFiles: ['<rootDir>/src/__tests__/setup.ts'],
};

module.exports = {
  ...baseConfig,
  projects: [
    {
      ...baseConfig,
      displayName: 'unit',
      testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts'],
    },
    {
      ...baseConfig,
      displayName: 'platform',
      testMatch: ['<rootDir>/packages/**/__tests__/**/*.test.ts'],
      setupFiles: [],
    },
    {
      ...baseConfig,
      displayName: 'notification',
      testMatch: [
        '<rootDir>/services/notification/src/**/__tests__/**/*.test.ts',
      ],
      setupFiles: ['<rootDir>/services/notification/src/__tests__/setup.ts'],
    },
    {
      ...baseConfig,
      displayName: 'integration',
      testMatch: ['<rootDir>/tests/integration/**/*.test.ts'],
      globalSetup: '<rootDir>/tests/integration/global-setup.ts',
      // overrides baseConfig.setupFiles — loads .env.test before any imports
      setupFiles: ['<rootDir>/tests/integration/env-setup.ts'],
    },
  ],
};
