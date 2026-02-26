/**
 * Tier 2: fetchMetadata tests use mocked child_process.execFile and util.promisify.
 * Node's promisify(execFile) resolves with only the first success value (stdout string);
 * url-metadata expects { stdout, stderr }. So we mock promisify to resolve to that shape.
 */
declare global {
  // eslint-disable-next-line no-var
  var __urlMetadataExecFileStdout: string | undefined;
}
jest.mock('child_process', () => ({
  execFile: jest.fn(
    (
      _cmd: string,
      _args: string[],
      cb: (err: Error | null, stdout?: string, stderr?: string) => void,
    ) => {
      setImmediate(() =>
        cb(null, globalThis.__urlMetadataExecFileStdout ?? '', ''),
      );
    },
  ),
}));
jest.mock('util', () => {
  const actual = jest.requireActual<typeof import('util')>('util');
  return {
    ...actual,
    promisify<T>(fn: (...args: unknown[]) => void): (...args: unknown[]) => Promise<T> {
      return (...args: unknown[]) =>
        new Promise((resolve, reject) => {
          const cb = (err: Error | null, stdout?: string, stderr?: string) => {
            if (err) reject(err);
            else resolve({ stdout: stdout ?? '', stderr: stderr ?? '' } as T);
          };
          (fn as (...a: unknown[]) => void)(...args, cb);
        });
    },
  };
});

import { extractUrlFromTask, fetchMetadata, isValidURL } from './url-metadata';

describe('isValidURL', () => {
  it('returns true for valid http URL', () => {
    expect(isValidURL('http://example.com')).toBe(true);
  });

  it('returns true for valid https URL', () => {
    expect(isValidURL('https://example.com/path')).toBe(true);
  });

  it('trims whitespace before validating', () => {
    expect(isValidURL('  https://example.com  ')).toBe(true);
  });

  it('returns false for empty string', () => {
    expect(isValidURL('')).toBe(false);
  });

  it('returns false for whitespace-only string', () => {
    expect(isValidURL('   ')).toBe(false);
  });

  it('returns false for file URL without host', () => {
    expect(isValidURL('file:///path/to/file')).toBe(false);
  });

  it('returns false for invalid URL string', () => {
    expect(isValidURL('not a url')).toBe(false);
  });

  it('returns false for protocol-relative string without host', () => {
    expect(isValidURL('://example.com')).toBe(false);
  });
});

describe('extractUrlFromTask', () => {
  it('returns URL found in name', () => {
    expect(extractUrlFromTask('Check https://example.com', '')).toBe('https://example.com');
  });

  it('returns URL found in note', () => {
    expect(extractUrlFromTask('Task', 'See http://foo.org')).toBe('http://foo.org');
  });

  it('returns first URL when both name and note contain URLs', () => {
    expect(extractUrlFromTask('Link https://first.com', 'and https://second.com')).toBe(
      'https://first.com',
    );
  });

  it('returns null when no URL present', () => {
    expect(extractUrlFromTask('Just a task', 'with a note')).toBeNull();
  });

  it('returns null for empty name and note', () => {
    expect(extractUrlFromTask('', '')).toBeNull();
  });

  it('returns URL when whole name is a URL', () => {
    expect(extractUrlFromTask('https://example.com', '')).toBe('https://example.com');
  });

  it('returns URL when whole note is a URL', () => {
    expect(extractUrlFromTask('', 'https://example.com')).toBe('https://example.com');
  });

  it('validates matched pattern with isValidURL', () => {
    expect(extractUrlFromTask('Malformed https://', '')).toBeNull();
  });
});

describe('fetchMetadata', () => {
  it('returns null for invalid URL', async () => {
    expect(await fetchMetadata('not a url')).toBeNull();
  });

  it('parses HTML and returns title and description for non-YouTube URL', async () => {
    globalThis.__urlMetadataExecFileStdout = `
      <!DOCTYPE html>
      <html><head>
        <title>Example Page</title>
        <meta name="description" content="A short description.">
      </head></html>`;
    const result = await fetchMetadata('https://example.com');
    expect(result).toEqual({ title: 'Example Page', description: 'A short description.' });
  });

  it('returns title and null description when meta description missing', async () => {
    globalThis.__urlMetadataExecFileStdout = '<html><head><title>No Desc</title></head></html>';
    const result = await fetchMetadata('https://example.com');
    expect(result).toEqual({ title: 'No Desc', description: null });
  });

  it('returns null when HTML has no title', async () => {
    globalThis.__urlMetadataExecFileStdout = '<html><body>no title</body></html>';
    const result = await fetchMetadata('https://example.com');
    expect(result).toBeNull();
  });

  it('returns YouTube metadata from noembed-style JSON when URL is YouTube', async () => {
    globalThis.__urlMetadataExecFileStdout = JSON.stringify({
      title: 'Video Title - YouTube',
      description: 'Video description',
    });
    const result = await fetchMetadata('https://www.youtube.com/watch?v=abc');
    expect(result).toEqual({
      title: 'Video Title',
      description: 'Video description',
    });
  });
});
