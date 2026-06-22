export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/e2e/specs/**/*.test.ts'],
  testSequencer: '<rootDir>/tests/e2e/sequencer.cjs',
  globalSetup: '<rootDir>/tests/e2e/setup/global.setup.ts',
  globalTeardown: '<rootDir>/tests/e2e/setup/global.teardown.ts',
  testTimeout: 30000,
  verbose: true,
  forceExit: true,
  clearMocks: true,
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { useESM: false }],
  },
  // Keep the default terminal reporter AND add the HTML report generator.
  // The HTML report is written to tests/e2e/report.html after every run.
  reporters: [
    'default',
    '<rootDir>/tests/e2e/e2e-reporter.cjs',
  ],
};
