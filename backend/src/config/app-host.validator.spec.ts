import { validateAppHost } from './app-host.validator';

describe('validateAppHost', () => {
  it('accepts 127.0.0.1 (loopback, uso local)', () => {
    expect(validateAppHost('127.0.0.1')).toBe(true);
  });

  it('accepts 0.0.0.0 (todas as interfaces, uso em container)', () => {
    expect(validateAppHost('0.0.0.0')).toBe(true);
  });

  it('accepts a plain hostname', () => {
    expect(validateAppHost('backend.internal')).toBe(true);
  });

  it('accepts localhost', () => {
    expect(validateAppHost('localhost')).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(validateAppHost('')).toBe(false);
  });

  it('rejects a value with protocol scheme', () => {
    expect(validateAppHost('http://127.0.0.1')).toBe(false);
  });

  it('rejects a value with an embedded port', () => {
    expect(validateAppHost('127.0.0.1:3000')).toBe(false);
  });

  it('rejects a value with a path', () => {
    expect(validateAppHost('127.0.0.1/health')).toBe(false);
  });

  it('rejects a value with userinfo', () => {
    expect(validateAppHost('user@127.0.0.1')).toBe(false);
  });

  it('rejects a bare IPv6 literal (out of scope for this validator)', () => {
    expect(validateAppHost('::1')).toBe(false);
  });

  it('rejects whitespace', () => {
    expect(validateAppHost('127.0.0.1 ')).toBe(false);
  });
});
