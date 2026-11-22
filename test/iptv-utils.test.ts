import { describe, expect, it } from 'vitest';
import { parseDate } from '../src/modules/iptv/utils';

describe('parseDate', () => {
    it('parses an XMLTV timestamp without a timezone offset as UTC', () => {
        expect(parseDate('20240101120000').toISOString()).toBe('2024-01-01T12:00:00.000Z');
    });

    it('applies a positive timezone offset', () => {
        expect(parseDate('20240101120000 +0200').toISOString()).toBe('2024-01-01T10:00:00.000Z');
    });

    it('applies a negative timezone offset', () => {
        expect(parseDate('20240101120000 -0500').toISOString()).toBe('2024-01-01T17:00:00.000Z');
    });

    it('throws for timestamps that are too short', () => {
        expect(() => parseDate('2024')).toThrow();
    });
});
