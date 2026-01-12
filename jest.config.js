module.exports = {
    testEnvironment: 'node',
    verbose: true,
    forceExit: true,
    clearMocks: true,
    resetMocks: true,
    restoreMocks: true,
    testMatch: ['**/test-backend.js'],
    setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
    collectCoverage: true,
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov'],
    coveragePathIgnorePatterns: [
        '/node_modules/',
        '/coverage/',
        '/jest.config.js'
    ]
};