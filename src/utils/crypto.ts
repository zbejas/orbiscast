import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * On-disk key material. The encryption key protects stored provider tokens.
 * The auth secret is used by Better Auth for session signing.
 */
export interface KeyMaterial {
    version: 1;
    encryptionKey: string;
    authSecret: string;
}

const KEY_FILE = 'keys.json';
const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;

/**
 * Loads data/keys.json or creates it on first boot.
 *
 * The file is created with mode 0600. Losing it makes encrypted provider
 * tokens unrecoverable, so callers should surface that in the UI.
 *
 * @param dataDir - Directory that owns the SQLite database and key file
 * @returns Parsed key material
 */
export function loadOrCreateKeys(dataDir: string): KeyMaterial {
    mkdirSync(dataDir, { recursive: true });
    const path = join(dataDir, KEY_FILE);

    if (existsSync(path)) {
        const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<KeyMaterial>;
        if (parsed.version !== 1 || typeof parsed.encryptionKey !== 'string' || typeof parsed.authSecret !== 'string') {
            throw new Error(`Invalid key file: ${path}`);
        }
        const key = Buffer.from(parsed.encryptionKey, 'base64');
        if (key.length !== KEY_BYTES) {
            throw new Error(`Invalid encryption key length in ${path}`);
        }
        return parsed as KeyMaterial;
    }

    const material: KeyMaterial = {
        version: 1,
        encryptionKey: randomBytes(KEY_BYTES).toString('base64'),
        authSecret: randomBytes(KEY_BYTES).toString('base64url'),
    };

    writeFileSync(path, JSON.stringify(material, null, 2), { encoding: 'utf8', mode: 0o600 });
    chmodSync(path, 0o600);
    return material;
}

/**
 * Returns the AES key as bytes.
 *
 * @param material - Loaded key material
 * @returns 32-byte key buffer
 */
export function encryptionKey(material: KeyMaterial): Buffer {
    return Buffer.from(material.encryptionKey, 'base64');
}

/**
 * Encrypts a secret with AES-256-GCM.
 *
 * @param plaintext - Value to encrypt
 * @param key - 32-byte key
 * @returns Versioned ciphertext string
 */
export function encryptSecret(plaintext: string, key: Buffer): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

/**
 * Decrypts a value produced by encryptSecret.
 *
 * @param value - Versioned ciphertext string
 * @param key - 32-byte key
 * @returns Decrypted plaintext
 */
export function decryptSecret(value: string, key: Buffer): string {
    const [version, ivPart, tagPart, dataPart] = value.split(':');
    if (version !== 'v1' || !ivPart || !tagPart || !dataPart) {
        throw new Error('Unsupported encrypted value');
    }
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivPart, 'base64'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64')), decipher.final()]).toString('utf8');
}

/**
 * Masks a secret for API responses and logs.
 *
 * @param value - Secret value
 * @returns Last four characters with the rest hidden
 */
export function maskSecret(value: string): string {
    if (!value) {
        return '';
    }
    const visible = value.slice(-4);
    return `${'*'.repeat(Math.max(4, value.length - visible.length))}${visible}`;
}
