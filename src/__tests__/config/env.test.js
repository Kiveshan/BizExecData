import { validateEnv } from '../../config/env.js';

const valid = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://u:p@db:5432/app',
  SESSION_SECRET: 'x'.repeat(48),
  ENCRYPTION_KEY: 'k'.repeat(32),
};

describe('validateEnv', () => {
  it('accepts a complete, strong configuration', () => {
    expect(() => validateEnv(valid)).not.toThrow();
  });

  it('is skipped under test', () => {
    expect(() => validateEnv({ NODE_ENV: 'test' })).not.toThrow();
  });

  it.each([
    ['DATABASE_URL', undefined, /DATABASE_URL \(or DB_HOST\/DB_NAME\/DB_USER\/DB_PASSWORD\) is not set/],
    ['SESSION_SECRET', undefined, /SESSION_SECRET is not set/],
    ['SESSION_SECRET', 'short', /at least 32 characters/],
    ['SESSION_SECRET', 'default-secret-change-in-production', /example placeholder/],
    ['SESSION_SECRET', 'replace-with-a-long-random-string', /example placeholder/],
    ['ENCRYPTION_KEY', undefined, /ENCRYPTION_KEY is not set/],
    ['ENCRYPTION_KEY', 'k'.repeat(31), /exactly 32 bytes \(got 31\)/],
    ['ENCRYPTION_KEY', 'replace-with-a-32-byte-key-exactly', /exactly 32 bytes \(got 34\)/],
    ['ENCRYPTION_KEY', '0123456789abcdef0123456789abcdef', /example placeholder/],
  ])('rejects %s=%s', (key, value, message) => {
    expect(() => validateEnv({ ...valid, [key]: value })).toThrow(message);
  });

  it('checks in development too, not only production', () => {
    expect(() => validateEnv({ ...valid, NODE_ENV: 'development', SESSION_SECRET: undefined }))
      .toThrow(/SESSION_SECRET is not set/);
  });

  it('reports every problem at once', () => {
    expect(() => validateEnv({ NODE_ENV: 'production' })).toThrow(
      /DATABASE_URL[\s\S]*SESSION_SECRET[\s\S]*ENCRYPTION_KEY/
    );
  });
});
