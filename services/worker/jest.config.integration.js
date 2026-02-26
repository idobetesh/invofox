/**
 * Jest configuration for integration tests
 * Runs tests in tests/integration directory
 * @type {import('ts-jest').JestConfigWithTsJest}
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/integration'],
  testMatch: ['**/*.test.ts', '**/*.e2e.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/index.ts',
  ],
  coverageDirectory: 'coverage/integration',
  verbose: true,
  testTimeout: 10000, // Integration tests may take longer
  maxWorkers: 1, // Run integration tests serially to avoid port conflicts and ECONNRESET
  forceExit: true, // Force exit after tests complete (integration tests may have open handles)
  cache: true,
  cacheDirectory: '<rootDir>/.jest-cache-integration',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        types: ['jest', 'node'],
        esModuleInterop: true,
      },
      isolatedModules: true,
    }],
  },
};
