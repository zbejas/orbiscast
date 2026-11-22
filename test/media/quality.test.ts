import { describe, expect, it } from 'vitest';
import { DISCORD_MAX_HEIGHT, discordHeightForQuality } from '../../src/modules/media/quality';

describe('Discord media height', () => {
    it('caps 4K presets to 1080p', () => {
        expect(discordHeightForQuality('4k-20')).toBe(1080);
        expect(discordHeightForQuality('4k-20')).toBe(DISCORD_MAX_HEIGHT);
    });

    it('keeps the 1080p and 720p presets', () => {
        expect(discordHeightForQuality('1080p-8')).toBe(1080);
        expect(discordHeightForQuality('1080p-12')).toBe(1080);
        expect(discordHeightForQuality('720p-4')).toBe(720);
    });
});
