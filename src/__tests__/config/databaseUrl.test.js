import { resolveDatabaseUrl } from '../../config/databaseUrl.js';

describe('resolveDatabaseUrl', () => {
  const parts = {
    DB_HOST: 'db.internal',
    DB_NAME: 'bizexec',
    DB_USER: 'app',
    DB_PASSWORD: 'secret',
  };

  it('prefers an explicit DATABASE_URL', () => {
    expect(resolveDatabaseUrl({ ...parts, DATABASE_URL: 'postgresql://x' })).toBe('postgresql://x');
  });

  it('builds a URL from split DB_* values, defaulting the port', () => {
    expect(resolveDatabaseUrl(parts)).toBe('postgresql://app:secret@db.internal:5432/bizexec');
  });

  it('percent-encodes credentials so generated passwords cannot break the URL', () => {
    const url = resolveDatabaseUrl({ ...parts, DB_PASSWORD: 'p@ss:w/rd#?%' });

    expect(url).toBe('postgresql://app:p%40ss%3Aw%2Frd%23%3F%25@db.internal:5432/bizexec');
    expect(decodeURIComponent(new URL(url).password)).toBe('p@ss:w/rd#?%');
  });

  it.each(['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'])(
    'returns undefined when %s is missing',
    (key) => {
      expect(resolveDatabaseUrl({ ...parts, [key]: undefined })).toBeUndefined();
    }
  );
});
