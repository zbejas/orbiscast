import { describe, expect, it } from 'vitest';
import { redactSecrets } from '../src/utils/redact';

describe('redactSecrets', () => {
    it('redacts Plex tokens in URLs', () => {
        expect(redactSecrets('http://plex/start.m3u8?session=1&X-Plex-Token=secret-value&x=2')).toBe(
            'http://plex/start.m3u8?session=1&X-Plex-Token=redacted&x=2'
        );
    });

    it('redacts authorization headers and bearer tokens', () => {
        expect(redactSecrets('Authorization: Bot abc.def.ghi')).toBe('Authorization: redacted');
        expect(redactSecrets('Authorization: abc.def.ghi')).toBe('Authorization: redacted');
        expect(redactSecrets('Bearer abc.def.ghi')).toBe('Bearer redacted');
    });

    it('leaves ordinary text alone', () => {
        expect(redactSecrets('Plex request failed with status 400')).toBe('Plex request failed with status 400');
    });
});
