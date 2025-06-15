module.exports = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/src/setupTests.js'],
  passWithNoTests: true, //This is to avoid the error when there are no tests, TODO: in the future, we should add tests for frontend components
  moduleNameMapper: {
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    '\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$': 'jest-transform-stub'
  },
  transform: {
    '^.+\\.(js|jsx)$': 'babel-jest',
  },
  testMatch: [
    '<rootDir>/components/**/__tests__/**/*.(js|jsx)',
    '<rootDir>/components/**/?(*.)(test|spec).(js|jsx)',
    '<rootDir>/src/**/__tests__/**/*.(js|jsx)',
    '<rootDir>/src/**/?(*.)(test|spec).(js|jsx)'
  ],
  moduleFileExtensions: ['js', 'jsx', 'json'],
  collectCoverageFrom: [
    'src/**/*.{js,jsx}',
    'components/**/*.{js,jsx}',
    '*.{js,jsx}', // Include root level files like main.jsx, utils.jsx
    '!src/index.js',
    '!src/setupTests.js',
    '!components/**/__tests__/**',
    '!src/**/__tests__/**',
    '!**/*.test.js',
    '!**/*.test.jsx',
    '!jest.config.js',
    '!babel.config.js',
    '!vite.config.mjs'
  ],
  coverageThreshold: {
    global: {
      branches: 0.5,
      functions: 1,
      lines: 1,
      statements: 1
    }
  }
}; 