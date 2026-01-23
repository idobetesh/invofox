/**
 * Jest configuration for unit tests
 * Runs tests in tests/unit directory
 * @type {import('ts-jest').JestConfigWithTsJest}
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/unit'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/index.ts',
  ],
  coverageDirectory: 'coverage/unit',
  verbose: true,
  // Performance optimizations
  maxWorkers: '50%', // Use 50% of CPU cores (faster than default)
  cache: true,
  cacheDirectory: '<rootDir>/.jest-cache',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        types: ['jest', 'node'],
        esModuleInterop: true,
      },
      isolatedModules: true, // Faster compilation, skips type checking
    }],
  },
};
