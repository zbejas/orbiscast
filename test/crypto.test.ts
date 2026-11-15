import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decryptSecret, encryptSecret, encryptionKey, loadOrCreateKeys, maskSecret } from '../src/utils/crypto';

let dir: string;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orbiscast-crypto-'));
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

describe('crypto', () => {
    it('creates a key file with mode 0600 and reloads it', () => {
        const first = loadOrCreateKeys(dir);
        const second = loadOrCreateKeys(dir);

        expect(second).toEqual(first);
        expect(statSync(join(dir, 'keys.json')).mode & 0o777).toBe(0o600);
        expect(encryptionKey(first)).toHaveLength(32);
    });

    it('round-trips a secret and rejects tampering', () => {
        const keys = loadOrCreateKeys(dir);
        const key = encryptionKey(keys);
        const ciphertext = encryptSecret('plex-token-value', key);

        expect(ciphertext).not.toContain('plex-token-value');
        expect(decryptSecret(ciphertext, key)).toBe('plex-token-value');

        const parts = ciphertext.split(':');
        const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:${Buffer.from('nope').toString('base64')}`;
        expect(() => decryptSecret(tampered, key)).toThrow();
    });

    it('rejects a malformed key file', () => {
        writeFileSync(join(dir, 'keys.json'), JSON.stringify({ version: 1, encryptionKey: 'short', authSecret: 'x' }));
        expect(() => loadOrCreateKeys(dir)).toThrow(/Invalid encryption key length/);
    });

    it('masks secrets and keeps the last four characters', () => {
        expect(maskSecret('abcdefghijkl')).toBe('********ijkl');
        expect(maskSecret('abc')).toBe('****abc');
        expect(maskSecret('')).toBe('');
    });
});
