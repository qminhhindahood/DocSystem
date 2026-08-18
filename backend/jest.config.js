module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/src/test/jest.setup.ts'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.(ts|tsx)$': 'babel-jest',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
};
