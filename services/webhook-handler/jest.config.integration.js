/**
 * Jest configuration for integration tests
 * Runs tests in tests/integration directory
 */

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/integration'],
  testMatch: ['**/*.integration.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/**/*.test.ts'],
  coverageDirectory: 'coverage/integration',
  verbose: true,
  testTimeout: 10000, // Integration tests may take longer
  forceExit: true, // Force exit after tests complete (integration tests may have open handles)
  // Don't transform node_modules except for ES modules
  transformIgnorePatterns: ['node_modules/(?!(.*\\.mjs$))'],
};
