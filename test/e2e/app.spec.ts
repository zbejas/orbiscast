import { expect, test } from '@playwright/test';

test('renders the dashboard and primary navigation', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'OrbisCast dashboard' }).first()).toBeVisible();

    for (const label of ['Channels', 'IPTV', 'Media', 'Discord', 'Logs', 'Settings']) {
        await expect(page.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
});

test('navigates to media and shows the empty state', async ({ page }) => {
    await page.goto('/media');

    await expect(page.getByRole('heading', { level: 1, name: 'Media' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /No media sources/i })).toBeVisible();
});

test('opens the media source form on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/media/sources');

    await page.getByRole('button', { name: 'Add source', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Add media source' })).toBeVisible();
    await expect(page.getByLabel('Server type')).toHaveValue('plex');
    await expect(page.getByLabel('Server URL')).toBeVisible();
});

test('navigates to channels and shows the empty state', async ({ page }) => {
    await page.goto('/channels');

    await expect(page.getByRole('heading', { level: 1, name: 'Channels' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /No channels yet/i })).toBeVisible();
});

test('saves streaming settings', async ({ page }) => {
    await page.goto('/settings');

    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    const bitrate = page.getByLabel('Video bitrate');
    await bitrate.fill('6200');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(
        page.getByRole('region', { name: 'Notifications' }).getByText('Settings saved')
    ).toBeVisible();
});

test('dismisses a notification toast automatically', async ({ page }) => {
    await page.goto('/settings');

    await page.getByLabel('Video bitrate').fill('6400');
    await page.getByRole('button', { name: 'Save changes' }).click();
    const toast = page
        .getByRole('region', { name: 'Notifications' })
        .getByText('Settings saved');
    await expect(toast).toBeVisible();
    await expect(toast).toBeHidden({ timeout: 9_000 });
});

test('opens the mobile navigation drawer', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    await page.getByRole('button', { name: 'Open navigation' }).click();
    const drawer = page.getByRole('dialog', { name: 'Navigation' });
    await expect(drawer).toBeVisible();
    await drawer.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
});

test('shows the live viewer count on every now-playing surface', async ({ page }) => {
    const now = Date.now();
    const playback = {
        mode: 'iptv',
        title: 'Demo News',
        subtitle: 'News',
        posterUrl: null,
        guildId: 'demo-guild',
        guildName: 'Demo Guild',
        voiceChannelId: 'demo-voice',
        voiceChannelName: 'General',
        startedAt: now - 60_000,
        positionMs: null,
        durationMs: null,
        positionUpdatedAt: null,
        viewers: 3,
        watching: [
            { id: 'viewer-1', displayName: 'Ada' },
            { id: 'viewer-2', displayName: 'Grace' },
            { id: 'viewer-3', displayName: 'Linus' },
        ],
        paused: false,
        queueItemId: null,
        sourceId: null,
        sourceName: null,
        sourceKind: null,
    };

    await page.route('**/api/playback', route => route.fulfill({ json: playback }));
    await page.route('**/api/events', route =>
        route.fulfill({
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
            body: '',
        })
    );

    await page.goto('/');
    await expect(
        page.getByText('3 viewers', { exact: true }).filter({ visible: true })
    ).toHaveCount(2);
    await expect(page.getByText('Watching now')).toBeVisible();

    await page.setViewportSize({ width: 900, height: 844 });
    await page.reload();
    await expect(page.getByRole('link', { name: /Demo News, 3 viewers/ })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.getByRole('link', { name: /Demo News, 3 viewers/ })).toBeVisible();
});
