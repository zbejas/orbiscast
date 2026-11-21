import { describe, expect, it } from 'vitest';
import { redactSecrets, redactUrl } from '../src/utils/redact';

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

    it('redacts Jellyfin tokens and API keys', () => {
        expect(redactSecrets('Authorization: MediaBrowser Token="secret"')).toBe('Authorization: redacted');
        expect(redactSecrets('X-Emby-Token: secret')).toBe('X-Emby-Token: redacted');
        expect(redactSecrets('https://jellyfin.test/Items?api_key=secret&x=1')).toBe(
            'https://jellyfin.test/Items?api_key=***&x=1'
        );
    });

    it('redacts provider credentials in URLs', () => {
        expect(redactSecrets('http://user:pass@provider.example/live/1.ts')).toBe(
            'http://***@provider.example/live/1.ts'
        );
        expect(redactSecrets('http://provider.example/live/alice/s3cret/42.ts')).toBe(
            'http://provider.example/live/***/***/42.ts'
        );
        expect(redactSecrets('http://provider.example/playlist?username=alice&password=s3cret')).toBe(
            'http://provider.example/playlist?username=***&password=***'
        );
    });

    it('leaves ordinary text alone', () => {
        expect(redactSecrets('Plex request failed with status 400')).toBe('Plex request failed with status 400');
    });
});

describe('redactUrl', () => {
    it('keeps the host and path while masking credentials', () => {
        expect(redactUrl('https://provider.example:8080/movie/alice/s3cret/99.mkv')).toBe(
            'https://provider.example:8080/movie/***/***/99.mkv'
        );
    });
});
