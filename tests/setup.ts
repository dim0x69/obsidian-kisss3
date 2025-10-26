// Jest setup file - runs before all tests
import { jest } from '@jest/globals';

// Setup global console methods to avoid noise in tests
global.console = {
  ...console,
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
};

// Setup fake timers for consistent test results
beforeEach(() => {
  jest.clearAllTimers();
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2024-01-15T10:00:00.000Z'));
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});