/**
 * Jest configuration for flow (end-to-end conversation) tests
 * Tests complete user journeys through the bot's conversation state machine
 * @type {import('ts-jest').JestConfigWithTsJest}
 */
module.exports = {
  ...require('./jest.config'),
  roots: ['<rootDir>/tests/flow'],
  testMatch: ['**/*.flow.test.ts'],
  testTimeout: 15000,
  coverageDirectory: 'coverage/flow',
  cacheDirectory: '<rootDir>/.jest-cache-flow',
  forceExit: true,
};
