import type {
    ChannelDto,
    DiscordStatusDto,
    GuildDto,
    LogLineDto,
    PlaybackStateDto,
    PlexConfigDto,
    PlexItemDetailDto,
    PlexItemDto,
    PlexLibraryDto,
    PlexQuality,
    PlexStreamDto,
    ProgrammeDto,
    QueueItemDto,
    SettingsDto,
    SetupStatusDto,
    SourceDto,
} from '@shared/types';
import { ApiError } from './api';
import { parseDateKey } from './format';
import type {
    AuthConfig,
    AuthSession,
    ChannelPage,
    ChannelQuery,
    DiscordTokenState,
    DiscordTokensInput,
    EnableAuthInput,
    EnableAuthResult,
    EnqueueInput,
    GuideResponse,
    LogPage,
    LogQuery,
    SaveSourceInput,
    StartPlaceholderInput,
    StartPlexInput,
    SubtitleMode,
} from './types';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const BOOT = Date.now();

const GROUPS = [
    'News',
    'Sports',
    'Movies',
    'Entertainment',
    'Kids',
    'Documentary',
    'Music',
    'International',
    'Local',
] as const;

type GroupName = (typeof GROUPS)[number];

const GROUP_PARTS: Record<GroupName, { prefixes: string[]; suffixes: string[] }> = {
    News: {
        prefixes: ['Northline', 'Meridian', 'Civic', 'Beacon', 'Harbor', 'Capitol', 'Global', 'Pulse'],
        suffixes: ['News', '24', 'Now', 'Report', 'Desk', 'Live'],
    },
    Sports: {
        prefixes: ['Aurora', 'Stadium', 'Prime', 'Victory', 'Circuit', 'Arena', 'Summit', 'Rapid'],
        suffixes: ['Sports', 'Arena', 'Matchday', 'Racing', 'FC', 'Extra'],
    },
    Movies: {
        prefixes: ['Cinevault', 'Silver', 'Nocturne', 'Parallax', 'Grand', 'Reel', 'Midnight', 'Frame'],
        suffixes: ['Movies', 'Cinema', 'Classics', 'Premiere', 'Screen', 'One'],
    },
    Entertainment: {
        prefixes: ['Studio', 'Encore', 'Vivid', 'Marquee', 'Backlot', 'Neon', 'Showcase', 'Loft'],
        suffixes: ['One', 'Live', 'Mix', 'Stage', 'Channel', 'Plus'],
    },
    Kids: {
        prefixes: ['Rocket', 'Milo', 'Tiny', 'Story', 'Puzzle', 'Cloud', 'Paws', 'Doodle'],
        suffixes: ['Club', 'Kids', 'Junior', 'Play', 'Zone', 'Friends'],
    },
    Documentary: {
        prefixes: ['Deep', 'Concrete', 'Archive', 'Wild', 'Built', 'Atlas', 'Field', 'Signal'],
        suffixes: ['Docs', 'Earth', 'History', 'World', 'Story', 'One'],
    },
    Music: {
        prefixes: ['Midnight', 'Vinyl', 'Quarry', 'Frequency', 'Session', 'Club', 'Acoustic', 'Top'],
        suffixes: ['Music', 'Live', 'Radio', 'Hits', 'Room', 'Twenty'],
    },
    International: {
        prefixes: ['World', 'Canal', 'Nord', 'Pacific', 'Andes', 'Sahara', 'Euro', 'Asia'],
        suffixes: ['Service', '7', 'News', 'Report', 'Now', 'International'],
    },
    Local: {
        prefixes: ['City', 'Neighborhood', 'Local', 'Community', 'High', 'Town', 'Market', 'Open'],
        suffixes: ['Live', 'Edit', 'Calendar', 'Square', 'Street', 'Mic'],
    },
};

const PROGRAMME_TITLES: Record<GroupName, string[]> = {
    News: [
        'Morning Brief',
        'World at Six',
        'The Newsroom',
        'Crossfire',
        'Night Desk',
        'Correspondent',
        'Frontline Report',
        'Weather Watch',
        'The Long Read',
        'Market Open',
    ],
    Sports: [
        'Matchday Live',
        'The Final Whistle',
        'Court Side',
        'Grand Prix Preview',
        'Cliffhanger',
        'Extra Time',
        'The Sports Desk',
        'Race Day',
        'Training Ground',
        'Full Time',
    ],
    Movies: [
        'Harbor Lights',
        'The Glass Hour',
        'Last Train North',
        'Paper Moons',
        'A Quiet Signal',
        'The Understudy',
        'Red Horizon',
        'Small Hours',
        'Night Ferry',
        'Copper Line',
    ],
    Entertainment: [
        'The Late Set',
        'Studio Sessions',
        'Behind the Curtain',
        'Weekend Mix',
        'The Green Room',
        'Spotlight',
        'House Band',
        'Off Script',
        'The Guest List',
        'Second Take',
    ],
    Kids: [
        'Rocket Club',
        'Milo and the Moon',
        'Tiny Giants',
        'Story Garden',
        'The Puzzle Crew',
        'Cloud Kites',
        'Paws and Claws',
        'Doodle Lab',
        'Treehouse Time',
        'The Odd Squad',
    ],
    Documentary: [
        'Deep Field',
        'Concrete and Sky',
        'The Last Fishermen',
        'Archive 1974',
        'Wild Coast',
        'Built to Last',
        'The Long Winter',
        'Salt Road',
        'Under the Ice',
        'The Cartographers',
    ],
    Music: [
        'Midnight Frequencies',
        'Live at the Quarry',
        'New Releases',
        'Vinyl Hour',
        'The Session',
        'Club Night',
        'Acoustic Room',
        'Top Twenty',
        'B-Sides',
        'The Mixtape',
    ],
    International: [
        'World Service',
        'Canal 7 Reports',
        'RTV Nord',
        'Pacific News',
        'Andes Today',
        'Sahara Report',
        'Euro Desk',
        'Asia Now',
        'The Foreign Desk',
        'Global Dispatch',
    ],
    Local: [
        'City Hall Live',
        'Neighborhood Watch',
        'The Local Edit',
        'Community Calendar',
        'High Street',
        'Town Square',
        'Weekend Market',
        'Open Mic',
        'The District',
        'Local Heroes',
    ],
};

const PROGRAMME_DESCRIPTIONS = [
    'A closer look at the stories shaping the day, with reports from the field and a panel of guests.',
    'A feature presentation with production notes, cast interviews, and a look behind the scenes.',
    'Live coverage with analysis, reaction, and the context behind the result.',
    'A patient, visual portrait of the people and places that rarely make the evening news.',
    'A studio session recorded in one take, with no overdubs and no second chances.',
    'The latest headlines, weather, and traffic, updated through the hour.',
    'An archive restoration paired with new interviews from the original crew.',
    'A weekly roundup of releases, deep cuts, and the records worth your time.',
    'A family-friendly adventure about curiosity, teamwork, and very small rockets.',
    'A long-form conversation with the people who build, run, and repair the places we share.',
];

const SLOT_MINUTES: Record<GroupName, number> = {
    News: 30,
    Sports: 60,
    Movies: 120,
    Entertainment: 60,
    Kids: 30,
    Documentary: 60,
    Music: 60,
    International: 30,
    Local: 60,
};

interface SourceSeed {
    id: number;
    name: string;
    playlistUrl: string;
    xmltvUrl: string | null;
    enabled: boolean;
    refreshMinutes: number;
    channelCount: number;
    visibleCount: number;
    lastRefreshedAt: number;
    lastError: string | null;
}

const SOURCE_SEEDS: SourceSeed[] = [
    {
        id: 1,
        name: 'Aurora TV',
        playlistUrl: 'https://lists.example.net/aurora.m3u',
        xmltvUrl: 'https://lists.example.net/aurora.xml',
        enabled: true,
        refreshMinutes: 60,
        channelCount: 3200,
        visibleCount: 28,
        lastRefreshedAt: BOOT - 11 * MINUTE,
        lastError: null,
    },
    {
        id: 2,
        name: 'Backup Streams',
        playlistUrl: 'https://lists.example.net/backup.m3u',
        xmltvUrl: 'https://lists.example.net/backup.xml',
        enabled: true,
        refreshMinutes: 180,
        channelCount: 1400,
        visibleCount: 12,
        lastRefreshedAt: BOOT - 3 * HOUR,
        lastError:
            'Playlist returned HTTP 502 after three attempts. The last good channel list is still in use.',
    },
    {
        id: 3,
        name: 'Stadium Addon',
        playlistUrl: 'https://lists.example.net/stadium.m3u',
        xmltvUrl: null,
        enabled: false,
        refreshMinutes: 360,
        channelCount: 400,
        visibleCount: 4,
        lastRefreshedAt: BOOT - 27 * HOUR,
        lastError: null,
    },
];

function hashNumbers(...values: number[]): number {
    let hash = 2166136261;
    for (const value of values) {
        hash ^= value;
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function slotMsFor(group: string): number {
    const minutes = SLOT_MINUTES[group as GroupName] ?? 60;
    return minutes * MINUTE;
}

function programmeTitle(channelId: number, group: string, slot: number, dayIndex: number): string {
    const pool = PROGRAMME_TITLES[group as GroupName] ?? PROGRAMME_TITLES.Entertainment;
    return pool[hashNumbers(channelId, slot, dayIndex) % pool.length];
}

function programmeDescription(channelId: number, slot: number): string {
    return PROGRAMME_DESCRIPTIONS[hashNumbers(channelId, slot, 7) % PROGRAMME_DESCRIPTIONS.length];
}

function localDayIndex(dayStart: number): number {
    return Math.floor(dayStart / DAY);
}

function currentTitles(channelId: number, group: string, at: number): { now: string; next: string } {
    const dayStart = new Date(at);
    dayStart.setHours(0, 0, 0, 0);
    const start = dayStart.getTime();
    const slotMs = slotMsFor(group);
    const slot = Math.floor((at - start) / slotMs);
    const dayIndex = localDayIndex(start);
    return {
        now: programmeTitle(channelId, group, slot, dayIndex),
        next: programmeTitle(channelId, group, slot + 1, dayIndex),
    };
}

let channelId = 1;

function buildChannels(): ChannelDto[] {
    const channels: ChannelDto[] = [];
    const now = Date.now();

    for (const source of SOURCE_SEEDS) {
        const visibleIndexes = new Set<number>();
        for (let index = 0; index < source.visibleCount; index += 1) {
            visibleIndexes.add(Math.floor(((index + 0.5) * source.channelCount) / source.visibleCount));
        }

        const usedNames = new Set<string>();
        for (let index = 0; index < source.channelCount; index += 1) {
            const group = GROUPS[(index + source.id) % GROUPS.length];
            const parts = GROUP_PARTS[group];
            const prefix = parts.prefixes[(index + source.id * 3) % parts.prefixes.length];
            const suffix = parts.suffixes[(index * 2 + source.id) % parts.suffixes.length];
            let name = `${prefix} ${suffix}`;
            if (usedNames.has(name)) {
                let copy = 2;
                while (usedNames.has(`${name} ${copy}`)) copy += 1;
                name = `${name} ${copy}`;
            }
            usedNames.add(name);

            const visible = visibleIndexes.has(index);
            const id = channelId;
            channelId += 1;
            const titles = visible ? currentTitles(id, group, now) : null;

            channels.push({
                id,
                sourceId: source.id,
                sourceName: source.name,
                name,
                logo: null,
                group,
                tvgId: `mock.${source.id}.${index + 1}`,
                visible,
                kind: 'iptv',
                nowPlaying: titles?.now ?? null,
                next: titles?.next ?? null,
            });
        }
    }

    channels.push({
        id: 900001,
        sourceId: null,
        sourceName: 'Plex',
        name: 'Plex On Demand',
        logo: null,
        group: 'Plex',
        tvgId: 'plex.on-demand',
        visible: true,
        kind: 'plex',
        nowPlaying: 'On demand',
        next: null,
    });

    return channels;
}

function buildSources(): SourceDto[] {
    return SOURCE_SEEDS.map((source) => ({
        id: source.id,
        name: source.name,
        playlistUrl: source.playlistUrl,
        xmltvUrl: source.xmltvUrl,
        enabled: source.enabled,
        refreshMinutes: source.refreshMinutes,
        lastRefreshedAt: source.lastRefreshedAt,
        lastError: source.lastError,
        channelCount: source.channelCount,
        visibleCount: source.visibleCount,
        refreshing: false,
    }));
}

const LIBRARIES: PlexLibraryDto[] = [
    { key: 'movies', title: 'Movies', type: 'movie', enabled: true },
    { key: 'shows', title: 'TV Shows', type: 'show', enabled: true },
    { key: 'docs', title: 'Documentaries', type: 'movie', enabled: true },
];

interface MovieSeed {
    title: string;
    year: number;
    minutes: number;
    libraryKey: string;
    summary: string;
}

const MOVIES: MovieSeed[] = [
    {
        title: 'The Long Orbit',
        year: 2021,
        minutes: 112,
        libraryKey: 'movies',
        summary:
            'A quiet cartographer takes a contract on a decommissioned survey station and finds the last maps of a town that was never rebuilt. A patient drama about distance, memory, and the people who keep measuring both.',
    },
    {
        title: 'Harbor Lights',
        year: 2019,
        minutes: 104,
        libraryKey: 'movies',
        summary:
            'Two dockworkers inherit a failing ferry route and one season to make it pay. Shot on the water over a single winter, with a cast of first-time actors from the harbor.',
    },
    {
        title: 'Static Bloom',
        year: 2023,
        minutes: 98,
        libraryKey: 'movies',
        summary:
            'A radio engineer starts receiving a weather report from next week. The signal is clear. The forecast is not good.',
    },
    {
        title: 'The Cartographer’s Daughter',
        year: 2017,
        minutes: 121,
        libraryKey: 'movies',
        summary:
            'A daughter finishes the survey her father abandoned, walking the same ridge line forty years later. A film about inherited work and the landscape that outlasts it.',
    },
    {
        title: 'Last Train North',
        year: 2015,
        minutes: 107,
        libraryKey: 'movies',
        summary:
            'The final service on a mountain line becomes a slow, accidental reunion for six passengers. A chamber piece with snow, a broken heater, and nowhere to be.',
    },
    {
        title: 'Paper Moons',
        year: 2020,
        minutes: 94,
        libraryKey: 'movies',
        summary:
            'A small-town projectionist keeps a failing cinema alive with a program of films nobody has heard of. When the last reel goes missing, the town helps him look.',
    },
    {
        title: 'A Quiet Signal',
        year: 2022,
        minutes: 131,
        libraryKey: 'movies',
        summary:
            'A listening station on the coast records something it cannot explain. The operator and the analyst disagree about what it means, and the tape keeps running.',
    },
    {
        title: 'Red Horizon',
        year: 2018,
        minutes: 118,
        libraryKey: 'movies',
        summary:
            'A wildfire crew works a ridge line with one road out. A procedural thriller built from radio traffic, hand signals, and the sound of wind changing.',
    },
    {
        title: 'Small Hours',
        year: 2024,
        minutes: 89,
        libraryKey: 'movies',
        summary:
            'A night-shift bakery, a delivery route, and a city that only makes sense at four in the morning. A warm, loose-limbed comedy about staying awake.',
    },
    {
        title: 'The Understudy',
        year: 2016,
        minutes: 102,
        libraryKey: 'movies',
        summary:
            'A second-choice actor gets one night on stage and a critic in the third row. A backstage film about ambition, luck, and the parts we almost get.',
    },
    {
        title: 'Glass House',
        year: 2013,
        minutes: 110,
        libraryKey: 'movies',
        summary:
            'An architect designs a home with no curtains and then has to live in it. A dry, precise comedy about transparency and the limits of a good idea.',
    },
    {
        title: 'Night Ferry',
        year: 2021,
        minutes: 96,
        libraryKey: 'movies',
        summary:
            'The overnight crossing is delayed. The bar is open. A stranger has a story that does not quite add up.',
    },
    {
        title: 'The Weather Station',
        year: 2019,
        minutes: 108,
        libraryKey: 'movies',
        summary:
            'A meteorologist overwinters at a remote station with a broken uplink and a logbook that is not hers. A patient study of routine, isolation, and the first clear day.',
    },
    {
        title: 'Copper Line',
        year: 2014,
        minutes: 125,
        libraryKey: 'movies',
        summary:
            'Three generations of a family work the same telephone exchange as the network is taken apart around them. A film about infrastructure, told in dial tones.',
    },
    {
        title: 'After the Tide',
        year: 2023,
        minutes: 101,
        libraryKey: 'movies',
        summary:
            'A coastal town rebuilds after a storm and argues about what should be built back. A documentary crew arrives with a camera and a list of questions.',
    },
    {
        title: 'Mountain Standard Time',
        year: 2020,
        minutes: 113,
        libraryKey: 'movies',
        summary:
            'A long-distance hike becomes a study of a friendship that has run out of things to say. Big country, small conversations, no shortcuts.',
    },
    {
        title: 'The Quiet Part',
        year: 2018,
        minutes: 87,
        libraryKey: 'movies',
        summary:
            'A family reunion, a broken piano, and one afternoon to say the thing everyone has been avoiding. A single-location drama with an extraordinary ensemble.',
    },
    {
        title: 'Field Notes',
        year: 2022,
        minutes: 99,
        libraryKey: 'movies',
        summary:
            'A naturalist’s notebook is found in a library return bin. The film follows the route it describes, one margin note at a time.',
    },
    {
        title: 'Deep Field',
        year: 2023,
        minutes: 92,
        libraryKey: 'docs',
        summary:
            'A year with the astronomers who point the largest telescope at the emptiest part of the sky and wait. Told in long exposures and very short sentences.',
    },
    {
        title: 'Concrete and Sky',
        year: 2021,
        minutes: 104,
        libraryKey: 'docs',
        summary:
            'The people who maintain a city’s elevated railway explain the system one bridge at a time. A documentary about maintenance as a form of care.',
    },
    {
        title: 'The Last Fishermen',
        year: 2018,
        minutes: 118,
        libraryKey: 'docs',
        summary:
            'Three boats, one quota, and a harbor that is being rezoned. A patient portrait of work that is ending on its own schedule.',
    },
    {
        title: 'Archive 1974',
        year: 2024,
        minutes: 88,
        libraryKey: 'docs',
        summary:
            'A box of unlabeled film cans turns out to hold a year in the life of a small town. Restored, sequenced, and left mostly un narrated.',
    },
    {
        title: 'Wild Coast',
        year: 2020,
        minutes: 96,
        libraryKey: 'docs',
        summary:
            'A season on a coastline with no road access. The crew walks in, stays put, and lets the weather set the schedule.',
    },
];

interface ShowSeed {
    title: string;
    year: number;
    seasons: number;
    episodesPerSeason: number;
    summary: string;
}

const SHOWS: ShowSeed[] = [
    {
        title: 'Night Shift',
        year: 2022,
        seasons: 2,
        episodesPerSeason: 7,
        summary:
            'The overnight crew of a city hospital, a radio dispatch desk, and a late-night diner share the same six blocks and most of the same problems. A drama about the hours when the city is technically closed.',
    },
    {
        title: 'Cold Harbor',
        year: 2020,
        seasons: 2,
        episodesPerSeason: 6,
        summary:
            'A forensic accountant is sent to audit a port authority and finds a town that runs on favors. Slow, salty, and very precise.',
    },
    {
        title: 'Northbound',
        year: 2023,
        seasons: 1,
        episodesPerSeason: 8,
        summary:
            'A freight crew works the same route through four seasons. Each episode is a different stretch of track and a different argument.',
    },
    {
        title: 'Static',
        year: 2019,
        seasons: 2,
        episodesPerSeason: 6,
        summary:
            'A small AM station keeps broadcasting after the license expires. The signal reaches further than anyone expected.',
    },
    {
        title: 'The Archivist',
        year: 2021,
        seasons: 1,
        episodesPerSeason: 7,
        summary:
            'A records clerk starts filing the future by mistake. A dry, uncanny comedy about paperwork and predestination.',
    },
    {
        title: 'Paper City',
        year: 2024,
        seasons: 1,
        episodesPerSeason: 6,
        summary:
            'A planning department redraws a neighborhood on paper and then has to live in the drawing. An ensemble drama about maps, permits, and neighbors.',
    },
];

const EPISODE_TITLES = [
    'Closing Time',
    'Dead Air',
    'The 3:12',
    'Low Tide',
    'A Small Favor',
    'The Long Way Round',
    'Open Line',
    'Second Shift',
    'The Inventory',
    'A Clear Night',
    'The Handoff',
    'Paper Trail',
    'The Last Delivery',
    'The Ridge',
    'Signal Check',
];

const EPISODE_DESCRIPTIONS = [
    'A routine night turns when a call comes in from the other side of the harbor.',
    'An old record surfaces and nobody can agree on what it means.',
    'The crew splits over a decision that cannot wait until morning.',
    'A favor for a neighbor puts the whole schedule behind.',
    'A storm warning changes the plan for everyone on shift.',
    'A new arrival asks the question everyone has been avoiding.',
    'A missing file sends two people back through the last month of work.',
    'The quietest hour of the night turns out to be the busiest.',
    'A temporary fix becomes permanent, and nobody is happy about it.',
    'A familiar face returns with an offer that is hard to refuse.',
    'The team has one night to undo a mistake before it goes public.',
    'A small disagreement becomes a fight that changes the shift.',
];

function slugify(title: string): string {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

function buildPlexItems(): PlexItemDto[] {
    const items: PlexItemDto[] = [];

    for (const movie of MOVIES) {
        const slug = slugify(movie.title);
        const ratingKey = `movie:${slug}`;
        items.push({
            ratingKey,
            key: ratingKey,
            libraryKey: movie.libraryKey,
            type: 'movie',
            title: movie.title,
            showTitle: null,
            seasonNumber: null,
            episodeNumber: null,
            year: movie.year,
            durationMs: movie.minutes * MINUTE,
            thumbUrl: null,
            summary: movie.summary,
        });
    }

    for (const [showIndex, show] of SHOWS.entries()) {
        const showSlug = slugify(show.title);
        const showKey = `show:${showSlug}`;
        items.push({
            ratingKey: showKey,
            key: showKey,
            libraryKey: 'shows',
            type: 'show',
            title: show.title,
            showTitle: null,
            seasonNumber: null,
            episodeNumber: null,
            year: show.year,
            durationMs: null,
            thumbUrl: null,
            summary: show.summary,
        });

        for (let season = 1; season <= show.seasons; season += 1) {
            const seasonKey = `${showKey}:s${season}`;
            items.push({
                ratingKey: seasonKey,
                key: seasonKey,
                libraryKey: 'shows',
                type: 'season',
                title: `Season ${season}`,
                showTitle: show.title,
                seasonNumber: season,
                episodeNumber: null,
                year: show.year,
                durationMs: null,
                thumbUrl: null,
                summary: `Season ${season} of ${show.title}.`,
            });

            for (let episode = 1; episode <= show.episodesPerSeason; episode += 1) {
                const episodeKey = `${seasonKey}:e${episode}`;
                const seed = hashNumbers(showSlug.length, season, episode);
                const runtime = 42 + (seed % 15);
                const title =
                    EPISODE_TITLES[
                        (showIndex * 4 + (season - 1) * 3 + episode - 1) % EPISODE_TITLES.length
                    ];
                items.push({
                    ratingKey: episodeKey,
                    key: episodeKey,
                    libraryKey: 'shows',
                    type: 'episode',
                    title,
                    showTitle: show.title,
                    seasonNumber: season,
                    episodeNumber: episode,
                    year: show.year,
                    durationMs: runtime * MINUTE,
                    thumbUrl: null,
                    summary: `${show.title}, season ${season}, episode ${episode}. ${EPISODE_DESCRIPTIONS[(showIndex * 5 + season * 3 + episode) % EPISODE_DESCRIPTIONS.length]}`,
                });
            }
        }
    }

    return items;
}

const PLEX_STREAMS: PlexStreamDto[] = [
    {
        id: 1,
        index: 1,
        type: 'audio',
        language: 'English',
        displayTitle: 'English 5.1',
        codec: 'eac3',
        default: true,
        forced: false,
        burnable: false,
    },
    {
        id: 2,
        index: 2,
        type: 'audio',
        language: 'French',
        displayTitle: 'French 5.1',
        codec: 'ac3',
        default: false,
        forced: false,
        burnable: false,
    },
    {
        id: 3,
        index: 3,
        type: 'subtitle',
        language: 'English',
        displayTitle: 'English (SDH)',
        codec: 'srt',
        default: false,
        forced: false,
        burnable: false,
    },
    {
        id: 4,
        index: 4,
        type: 'subtitle',
        language: 'Spanish',
        displayTitle: 'Spanish',
        codec: 'srt',
        default: false,
        forced: false,
        burnable: false,
    },
];

function buildQueue(items: PlexItemDto[]): QueueItemDto[] {
    const byKey = new Map(items.map((item) => [item.ratingKey, item]));
    const seeds: Array<{
        ratingKey: string;
        quality: PlexQuality;
        subtitleMode: SubtitleMode;
        status: QueueItemDto['status'];
        error?: string;
    }> = [
        {
            ratingKey: 'movie:the-long-orbit',
            quality: '1080p-8',
            subtitleMode: 'auto',
            status: 'queued',
        },
        {
            ratingKey: 'show:night-shift:s1:e2',
            quality: '1080p-8',
            subtitleMode: 3,
            status: 'queued',
        },
        {
            ratingKey: 'movie:harbor-lights',
            quality: '720p-4',
            subtitleMode: 'off',
            status: 'queued',
        },
        {
            ratingKey: 'movie:static-bloom',
            quality: '1080p-12',
            subtitleMode: 'auto',
            status: 'failed',
            error: 'Plex reported the media is unavailable. Check that the library still has this file.',
        },
    ];

    return seeds.map((seed, index) => {
        const item = byKey.get(seed.ratingKey);
        if (!item) {
            throw new Error(`Mock queue references a missing Plex item: ${seed.ratingKey}`);
        }
        return {
            id: index + 1,
            position: index,
            status: seed.status,
            ratingKey: item.ratingKey,
            type: item.type === 'episode' ? 'episode' : 'movie',
            title: item.title,
            showTitle: item.showTitle,
            seasonNumber: item.seasonNumber,
            episodeNumber: item.episodeNumber,
            durationMs: item.durationMs,
            thumbUrl: null,
            quality: seed.quality,
            subtitleMode: seed.subtitleMode,
            error: seed.error ?? null,
        };
    });
}

const GUILDS: GuildDto[] = [
    {
        id: '104203948572661760',
        name: 'Night Shift',
        iconUrl: null,
        allowedRoleIds: ['role-stream', 'role-mod'],
        roles: [
            { id: 'role-stream', name: 'Stream Control', color: 0x5865f2 },
            { id: 'role-mod', name: 'Moderator', color: 0x3ba55d },
            { id: 'role-vip', name: 'VIP', color: 0xe5a00d },
            { id: 'role-member', name: 'Member', color: 0x9aa3b2 },
            { id: 'role-guest', name: 'Guest', color: 0x6f7889 },
        ],
        voiceChannels: [
            { id: 'voice-1', name: 'The Screening Room', guildId: '104203948572661760' },
            { id: 'voice-2', name: 'Lounge', guildId: '104203948572661760' },
            { id: 'voice-3', name: 'Game Night', guildId: '104203948572661760' },
        ],
    },
    {
        id: '208700451233529856',
        name: 'The Watchlist',
        iconUrl: null,
        allowedRoleIds: ['role-watch'],
        roles: [
            { id: 'role-watch', name: 'Watch Party', color: 0x5865f2 },
            { id: 'role-critic', name: 'Critic', color: 0xe5a00d },
            { id: 'role-member-2', name: 'Member', color: 0x9aa3b2 },
        ],
        voiceChannels: [
            { id: 'voice-4', name: 'Main Screen', guildId: '208700451233529856' },
            { id: 'voice-5', name: 'Late Show', guildId: '208700451233529856' },
        ],
    },
    {
        id: '331100982374412288',
        name: 'Basement Cinema',
        iconUrl: null,
        allowedRoleIds: [],
        roles: [
            { id: 'role-owner', name: 'Owner', color: 0xed4245 },
            { id: 'role-projection', name: 'Projectionist', color: 0x5865f2 },
            { id: 'role-regular', name: 'Regular', color: 0x9aa3b2 },
        ],
        voiceChannels: [{ id: 'voice-6', name: 'Basement', guildId: '331100982374412288' }],
    },
];

const LOG_TEMPLATES: Array<{ level: string; message: string }> = [
    { level: 'info', message: 'Voice connection established in Night Shift / The Screening Room.' },
    { level: 'info', message: 'EPG refresh completed in 4.2s (5,000 channels, 128,400 programmes).' },
    { level: 'info', message: 'Streaming Northline News at 1080p, 6,000 kbps, H.264.' },
    { level: 'info', message: 'Viewer count changed from 8 to 9 in The Screening Room.' },
    { level: 'info', message: 'Plex library scan finished: 22 movies, 6 shows, 90 episodes.' },
    { level: 'info', message: 'Queue item 2 started: Night Shift, season 1, episode 2.' },
    { level: 'debug', message: 'FFmpeg pipeline ready: libx264, veryfast, 1080p, 6,000 kbps.' },
    { level: 'debug', message: 'DAVE session keys rotated for the active voice connection.' },
    { level: 'debug', message: 'Plex transcode session opened at 8 Mbps for The Long Orbit.' },
    { level: 'debug', message: 'XMLTV parser skipped 14 entries with no channel id.' },
    { level: 'warn', message: 'Source Backup Streams took 41s to respond. Still within the retry window.' },
    {
        level: 'warn',
        message: 'Streamer bitrate fell to 4,200 kbps for 12s. Network jitter on the uplink.',
    },
    { level: 'warn', message: 'Plex server reported a slow transcode start (2.8s).' },
    {
        level: 'error',
        message:
            'Source Backup Streams returned HTTP 502 after three attempts. Keeping the previous channel list.',
    },
    {
        level: 'error',
        message: 'Plex item Static Bloom is unavailable. Removed from the playable queue.',
    },
    { level: 'info', message: 'Scheduled refresh for Aurora TV finished with no changes.' },
    { level: 'info', message: 'Guild role allowlist updated for Night Shift.' },
    { level: 'debug', message: 'Cache hit for playlist: aurora.m3u (2.1 MB, 3200 entries).' },
    { level: 'info', message: 'Playback stopped by the operator from the WebUI.' },
    { level: 'info', message: 'Streamer disconnected from voice without logging out the account.' },
];

let logId = 1;

function buildLogs(): LogLineDto[] {
    const lines: LogLineDto[] = [];
    const total = 180;
    for (let index = 0; index < total; index += 1) {
        const template = LOG_TEMPLATES[(index * 7 + 3) % LOG_TEMPLATES.length];
        const offset = (total - index) * 18 * SECOND + (index % 5) * 900;
        lines.push({
            id: logId,
            timestamp: BOOT - offset,
            level: template.level,
            message: template.message,
        });
        logId += 1;
    }
    return lines;
}

export function createMockLogLine(): LogLineDto {
    const template = LOG_TEMPLATES[logId % LOG_TEMPLATES.length];
    const line: LogLineDto = {
        id: logId,
        timestamp: Date.now(),
        level: template.level,
        message: template.message,
    };
    logId += 1;
    return line;
}

const SETTINGS: SettingsDto = {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    logLevel: 'info',
    publicUrl: 'https://orbiscast.example.com',
    trustedOrigins: [],
    stream: {
        bitrateVideo: 6000,
        bitrateVideoMax: 8000,
        minimizeLatency: false,
        disableTranscode: false,
        defaultStreamTimeout: 30,
    },
    plex: {
        channelName: 'Plex On Demand',
        idleMinutes: 20,
        emptyGraceSeconds: 120,
        defaultQuality: '1080p-8',
    },
    auth: {
        enabled: false,
    },
};

const PLEX_CONFIG: PlexConfigDto = {
    serverUrl: 'https://plex.example.com',
    tokenSet: true,
    tokenLast4: '7b1c',
    channelName: 'Plex On Demand',
    idleMinutes: 20,
    emptyGraceSeconds: 120,
    defaultQuality: '1080p-8',
    connected: true,
    error: null,
};

const PLAYBACK: PlaybackStateDto = {
    mode: 'iptv',
    title: 'Northline News',
    subtitle: 'Aurora TV · News',
    posterUrl: null,
    guildId: '104203948572661760',
    guildName: 'Night Shift',
    voiceChannelId: 'voice-1',
    voiceChannelName: 'The Screening Room',
    startedAt: BOOT - 102 * MINUTE,
    positionMs: null,
    durationMs: null,
    positionUpdatedAt: null,
    viewers: 9,
    paused: false,
    queueItemId: null,
};

interface MockDatabase {
    playback: PlaybackStateDto;
    sources: SourceDto[];
    channels: ChannelDto[];
    plexItems: PlexItemDto[];
    queue: QueueItemDto[];
    logs: LogLineDto[];
    settings: SettingsDto;
    plexConfig: PlexConfigDto;
    discord: DiscordStatusDto;
    tokens: DiscordTokenState;
    session: AuthSession;
    hasUser: boolean;
}

const database: MockDatabase = {
    playback: { ...PLAYBACK },
    sources: buildSources(),
    channels: buildChannels(),
    plexItems: buildPlexItems(),
    queue: [],
    logs: buildLogs(),
    settings: { ...SETTINGS, stream: { ...SETTINGS.stream }, plex: { ...SETTINGS.plex }, auth: { ...SETTINGS.auth } },
    plexConfig: { ...PLEX_CONFIG },
    discord: {
        bot: 'online',
        streamer: 'online',
        botTag: 'OrbisCast#4127',
        streamerTag: 'orbis.stream#0001',
        error: null,
        guilds: GUILDS,
    },
    tokens: {
        botTokenSet: true,
        userTokenSet: true,
        botLast4: '4f2a',
        userLast4: '9c1e',
    },
    session: { user: null },
    hasUser: false,
};

database.queue = buildQueue(database.plexItems);

function delay<T>(value: T, ms = 160): Promise<T> {
    return new Promise((resolve) => {
        setTimeout(() => resolve(structuredClone(value)), ms);
    });
}

function fail(status: number, code: string, message: string): Promise<never> {
    return new Promise((_, reject) => {
        setTimeout(() => reject(new ApiError(status, code, message)), 160);
    });
}

function recomputeSourceCounts(): void {
    for (const source of database.sources) {
        const sourceChannels = database.channels.filter((channel) => channel.sourceId === source.id);
        source.channelCount = sourceChannels.length;
        source.visibleCount = sourceChannels.filter((channel) => channel.visible).length;
    }
}

function nextSourceId(): number {
    return Math.max(0, ...database.sources.map((source) => source.id)) + 1;
}

function findGuild(guildId: string): GuildDto | undefined {
    return database.discord.guilds.find((guild) => guild.id === guildId);
}

function guildVoice(guildId: string, voiceChannelId: string): { guildName: string; voiceName: string } {
    const guild = findGuild(guildId);
    const voice = guild?.voiceChannels.find((channel) => channel.id === voiceChannelId);
    return {
        guildName: guild?.name ?? 'Unknown server',
        voiceName: voice?.name ?? 'Unknown channel',
    };
}

function findPlexItem(ratingKey: string): PlexItemDto | undefined {
    return database.plexItems.find((item) => item.ratingKey === ratingKey);
}

function queueForItem(ratingKey: string): QueueItemDto | undefined {
    return database.queue.find(
        (item) => item.ratingKey === ratingKey && (item.status === 'queued' || item.status === 'playing')
    );
}

function playbackTitleForQueueItem(item: QueueItemDto): string {
    return item.showTitle
        ? `${item.showTitle} · S${item.seasonNumber ?? 1} E${item.episodeNumber ?? 1}`
        : 'Plex movie';
}

function startPlaybackFromQueue(
    item: QueueItemDto,
    guildId: string,
    voiceChannelId: string
): PlaybackStateDto {
    const { guildName, voiceName } = guildVoice(guildId, voiceChannelId);
    for (const queueItem of database.queue) {
        if (queueItem.status === 'playing') queueItem.status = 'queued';
    }
    item.status = 'playing';
    database.playback = {
        mode: 'plex',
        title: item.title,
        subtitle: playbackTitleForQueueItem(item),
        posterUrl: null,
        guildId,
        guildName,
        voiceChannelId,
        voiceChannelName: voiceName,
        startedAt: Date.now(),
        positionMs: 0,
        durationMs: item.durationMs,
        positionUpdatedAt: Date.now(),
        viewers: 4,
        paused: false,
        queueItemId: item.id,
    };
    return database.playback;
}

function stopPlaybackState(): PlaybackStateDto {
    for (const item of database.queue) {
        if (item.status === 'playing') item.status = 'queued';
    }
    database.playback = {
        mode: 'idle',
        title: null,
        subtitle: null,
        posterUrl: null,
        guildId: null,
        guildName: null,
        voiceChannelId: null,
        voiceChannelName: null,
        startedAt: null,
        positionMs: null,
        durationMs: null,
        positionUpdatedAt: null,
        viewers: 0,
        paused: false,
        queueItemId: null,
    };
    return database.playback;
}

function isRealPlayback(): boolean {
    return database.playback.mode === 'iptv' || database.playback.mode === 'plex';
}

function buildGuide(dayKey: string): GuideResponse {
    const dayStart = parseDateKey(dayKey);
    const dayEnd = dayStart + DAY;
    const dayIndex = localDayIndex(dayStart);
    const channels = database.channels.filter((channel) => channel.kind === 'iptv' && channel.visible);
    const programmes: ProgrammeDto[] = [];

    for (const channel of channels) {
        const group = channel.group ?? 'Entertainment';
        const slotMs = slotMsFor(group);
        let slot = 0;
        for (let start = dayStart; start < dayEnd; start += slotMs, slot += 1) {
            const stop = Math.min(start + slotMs, dayEnd);
            programmes.push({
                id: dayIndex * 10_000_000 + channel.id * 1_000 + slot,
                sourceId: channel.sourceId ?? 0,
                channelTvgId: channel.tvgId ?? `mock-${channel.id}`,
                title: programmeTitle(channel.id, group, slot, dayIndex),
                description: programmeDescription(channel.id, slot),
                start,
                stop,
                category: group,
            });
        }
    }

    return { dayStart, dayEnd, channels, programmes };
}

function filteredChannels(query: ChannelQuery): ChannelPage {
    const search = query.search.trim().toLowerCase();
    const allChannels = database.channels.filter((channel) => channel.kind === 'iptv');
    const visibleTotal = allChannels.filter((channel) => channel.visible).length;
    const groups = Array.from(new Set(allChannels.map((channel) => channel.group).filter(Boolean))).sort() as string[];

    const filtered = allChannels.filter((channel) => {
        if (query.sourceId !== 'all' && channel.sourceId !== query.sourceId) return false;
        if (query.group !== 'all' && channel.group !== query.group) return false;
        if (query.visibility === 'visible' && !channel.visible) return false;
        if (query.visibility === 'hidden' && channel.visible) return false;
        if (search) {
            const haystack = `${channel.name} ${channel.group ?? ''} ${channel.sourceName}`.toLowerCase();
            if (!haystack.includes(search)) return false;
        }
        return true;
    });

    const start = (query.page - 1) * query.pageSize;
    return {
        items: filtered.slice(start, start + query.pageSize),
        total: filtered.length,
        page: query.page,
        pageSize: query.pageSize,
        visibleTotal,
        totalAll: allChannels.length,
        groups,
    };
}

function filteredLogs(query: LogQuery): LogPage {
    const search = query.search.trim().toLowerCase();
    const filtered = database.logs.filter((line) => {
        if (query.level !== 'all' && line.level !== query.level) return false;
        if (search && !line.message.toLowerCase().includes(search)) return false;
        return true;
    });
    return {
        items: filtered.slice(Math.max(0, filtered.length - query.limit)),
        total: filtered.length,
    };
}

function setupStatus(): SetupStatusDto {
    const discordConfigured = database.tokens.botTokenSet && database.tokens.userTokenSet;
    const discordValid = database.discord.bot === 'online' && database.discord.streamer === 'online';
    const sourcesConfigured = database.sources.length > 0;
    const plexConfigured = database.plexConfig.tokenSet;
    const plexValid = database.plexConfig.connected && !database.plexConfig.error;
    const authEnabled = database.settings.auth.enabled;
    return {
        needsSetup: !discordValid || !sourcesConfigured || !plexValid,
        discordConfigured,
        discordValid,
        sourcesConfigured,
        plexConfigured,
        plexValid,
        authEnabled,
    };
}

function updateSetupAfterChange(): void {
    // Setup status is derived on read. Kept as a named hook for mutation call sites.
}

function detailFor(item: PlexItemDto): PlexItemDetailDto {
    return {
        ...item,
        streams: item.type === 'movie' || item.type === 'episode' ? PLEX_STREAMS : [],
    };
}

export const mockApi = {
    getPlayback: () => delay(database.playback, 120),

    stopPlayback: () => {
        stopPlaybackState();
        return delay(database.playback, 180);
    },

    pausePlayback: () => {
        if (database.playback.mode !== 'plex') {
            return fail(409, 'not_plex', 'Only Plex playback can be paused.');
        }
        if (!database.playback.paused && database.playback.positionMs !== null) {
            const updatedAt = database.playback.positionUpdatedAt ?? Date.now();
            database.playback.positionMs += Math.max(0, Date.now() - updatedAt);
        }
        database.playback.positionUpdatedAt = Date.now();
        database.playback.paused = true;
        return delay(database.playback, 120);
    },

    resumePlayback: () => {
        if (database.playback.mode !== 'plex') {
            return fail(409, 'not_plex', 'Only Plex playback can be paused.');
        }
        database.playback.positionUpdatedAt = Date.now();
        database.playback.paused = false;
        return delay(database.playback, 120);
    },

    seekPlayback: (seconds: number) => {
        if (database.playback.mode !== 'plex') {
            return fail(409, 'not_plex', 'Only Plex playback can be seeked.');
        }
        const duration = database.playback.durationMs ?? 0;
        const max = duration > 0 ? Math.max(0, duration - 1000) : seconds * 1000;
        database.playback.positionMs = Math.max(0, Math.min(seconds * 1000, max));
        database.playback.positionUpdatedAt = Date.now();
        database.playback.paused = false;
        return delay(database.playback, 180);
    },

    skipPlayback: () => {
        if (database.playback.mode === 'plex' && database.playback.queueItemId != null) {
            const current = database.queue.find((item) => item.id === database.playback.queueItemId);
            if (current) current.status = 'played';
            const next = database.queue
                .filter((item) => item.status === 'queued')
                .sort((a, b) => a.position - b.position)[0];
            if (next && database.playback.guildId && database.playback.voiceChannelId) {
                startPlaybackFromQueue(next, database.playback.guildId, database.playback.voiceChannelId);
                return delay(database.playback, 180);
            }
        }
        stopPlaybackState();
        return delay(database.playback, 180);
    },

    getChannels: (query: ChannelQuery) => delay(filteredChannels(query), 180),

    setChannelVisible: (id: number, visible: boolean) => {
        const channel = database.channels.find((entry) => entry.id === id);
        if (!channel) return fail(404, 'channel_not_found', 'That channel no longer exists.');
        if (channel.kind === 'plex') {
            return fail(409, 'plex_channel_locked', 'The Plex channel is always visible.');
        }
        channel.visible = visible;
        recomputeSourceCounts();
        return delay(channel, 120);
    },

    setBulkChannelVisible: (ids: number[], visible: boolean) => {
        const targets = database.channels.filter(
            (channel) => channel.kind === 'iptv' && ids.includes(channel.id)
        );
        for (const channel of targets) channel.visible = visible;
        recomputeSourceCounts();
        return delay({ updated: targets.length }, 180);
    },

    getGuide: (day: string) => delay(buildGuide(day), 220),

    getSources: () => delay(database.sources, 160),

    createSource: (input: SaveSourceInput) => {
        const source: SourceDto = {
            id: nextSourceId(),
            name: input.name,
            playlistUrl: input.playlistUrl,
            xmltvUrl: input.xmltvUrl,
            enabled: input.enabled,
            refreshMinutes: input.refreshMinutes,
            lastRefreshedAt: null,
            lastError: null,
            channelCount: 0,
            visibleCount: 0,
            refreshing: false,
        };
        database.sources.push(source);
        updateSetupAfterChange();
        return delay(source, 220);
    },

    updateSource: (input: SaveSourceInput) => {
        const source = database.sources.find((entry) => entry.id === input.id);
        if (!source) return fail(404, 'source_not_found', 'That source no longer exists.');
        source.name = input.name;
        source.playlistUrl = input.playlistUrl;
        source.xmltvUrl = input.xmltvUrl;
        source.refreshMinutes = input.refreshMinutes;
        source.enabled = input.enabled;
        updateSetupAfterChange();
        return delay(source, 220);
    },

    deleteSource: (id: number) => {
        const index = database.sources.findIndex((source) => source.id === id);
        if (index === -1) return fail(404, 'source_not_found', 'That source no longer exists.');
        database.sources.splice(index, 1);
        database.channels = database.channels.filter((channel) => channel.sourceId !== id);
        updateSetupAfterChange();
        return new Promise<void>((resolve) => setTimeout(resolve, 200));
    },

    refreshSource: (id: number) => {
        const source = database.sources.find((entry) => entry.id === id);
        if (!source) return fail(404, 'source_not_found', 'That source no longer exists.');
        return new Promise<SourceDto>((resolve) => {
            setTimeout(() => {
                source.lastRefreshedAt = Date.now();
                source.lastError = null;
                source.refreshing = false;
                resolve(structuredClone(source));
            }, 1100);
        });
    },

    getPlexConfig: () => delay(database.plexConfig, 120),

    getPlexLibraries: () => delay(LIBRARIES, 160),

    setPlexLibraryEnabled: (key: string, enabled: boolean) => {
        const library = LIBRARIES.find((entry) => entry.key === key);
        if (!library) return fail(404, 'plex_library_not_found', 'That Plex library no longer exists.');
        library.enabled = enabled;
        return delay(LIBRARIES, 220);
    },

    savePlexConfig: (input: { serverUrl: string; token?: string }) => {
        database.plexConfig.serverUrl = input.serverUrl;
        if (input.token) {
            database.plexConfig.tokenSet = true;
            database.plexConfig.tokenLast4 = input.token.slice(-4);
        }
        const connected = /^https?:\/\//.test(input.serverUrl) && database.plexConfig.tokenSet;
        database.plexConfig.connected = connected;
        database.plexConfig.error = connected
            ? null
            : 'Plex did not return a server identity. Check the URL and token.';
        return delay(database.plexConfig, 600);
    },

    getPlexItems: (libraryKey: string, search: string) => {
        const needle = search.trim().toLowerCase();
        const items = database.plexItems.filter((item) => {
            if (item.libraryKey !== libraryKey) return false;
            if (item.type !== 'movie' && item.type !== 'show') return false;
            if (!needle) return true;
            return `${item.title} ${item.showTitle ?? ''}`.toLowerCase().includes(needle);
        });
        return delay(items, 200);
    },

    getPlexItem: (ratingKey: string) => {
        const item = findPlexItem(ratingKey);
        if (!item) return fail(404, 'plex_item_not_found', 'That Plex item is no longer in the library.');
        return delay(detailFor(item), 160);
    },

    getPlexChildren: (ratingKey: string) => {
        const item = findPlexItem(ratingKey);
        if (!item) return fail(404, 'plex_item_not_found', 'That Plex item is no longer in the library.');
        let children: PlexItemDto[] = [];
        if (item.type === 'show') {
            children = database.plexItems.filter(
                (entry) => entry.type === 'season' && entry.ratingKey.startsWith(`${ratingKey}:s`)
            );
        } else if (item.type === 'season') {
            children = database.plexItems.filter(
                (entry) => entry.type === 'episode' && entry.ratingKey.startsWith(`${ratingKey}:e`)
            );
        }
        return delay(
            children.sort(
                (a, b) =>
                    (a.seasonNumber ?? 0) - (b.seasonNumber ?? 0) ||
                    (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0)
            ),
            160
        );
    },

    getQueue: () => delay([...database.queue].sort((a, b) => a.position - b.position), 160),

    enqueue: (input: EnqueueInput) => {
        const existing = database.queue.find(
            (item) => item.ratingKey === input.ratingKey && item.status !== 'failed'
        );
        if (existing) return fail(409, 'already_queued', 'That item is already in the queue.');
        const item: QueueItemDto = {
            id: Math.max(0, ...database.queue.map((entry) => entry.id)) + 1,
            position: database.queue.filter((entry) => entry.status !== 'failed').length,
            status: 'queued',
            ratingKey: input.ratingKey,
            type: input.type,
            title: input.title,
            showTitle: input.showTitle,
            seasonNumber: input.seasonNumber,
            episodeNumber: input.episodeNumber,
            durationMs: input.durationMs,
            thumbUrl: null,
            quality: input.quality,
            subtitleMode: input.subtitleMode,
            error: null,
        };
        database.queue.push(item);
        return delay(item, 200);
    },

    removeQueueItem: (id: number) => {
        const index = database.queue.findIndex((item) => item.id === id);
        if (index === -1) return fail(404, 'queue_item_not_found', 'That queue item is already gone.');
        database.queue.splice(index, 1);
        let position = 0;
        for (const item of database.queue) {
            item.position = position;
            position += 1;
        }
        return new Promise<void>((resolve) => setTimeout(resolve, 160));
    },

    moveQueueItem: (id: number, direction: 'up' | 'down') => {
        const queue = [...database.queue].sort((a, b) => a.position - b.position);
        const index = queue.findIndex((item) => item.id === id);
        if (index === -1) return fail(404, 'queue_item_not_found', 'That queue item is already gone.');
        const target = direction === 'up' ? index - 1 : index + 1;
        if (target < 0 || target >= queue.length) {
            return delay([...database.queue].sort((a, b) => a.position - b.position), 120);
        }
        [queue[index], queue[target]] = [queue[target], queue[index]];
        queue.forEach((item, position) => {
            item.position = position;
        });
        return delay(queue, 160);
    },

    shuffleQueue: () => {
        const queued = database.queue.filter((item) => item.status === 'queued');
        const failed = database.queue.filter((item) => item.status !== 'queued');
        for (let index = queued.length - 1; index > 0; index -= 1) {
            const swap = Math.floor(Math.random() * (index + 1));
            [queued[index], queued[swap]] = [queued[swap], queued[index]];
        }
        const ordered = [...queued, ...failed];
        ordered.forEach((item, position) => {
            item.position = position;
        });
        database.queue = ordered;
        return delay([...database.queue].sort((a, b) => a.position - b.position), 160);
    },

    clearQueue: () => {
        database.queue = database.queue.filter((item) => item.status === 'playing');
        database.queue.forEach((item, position) => {
            item.position = position;
        });
        return new Promise<void>((resolve) => setTimeout(resolve, 180));
    },

    playQueueItem: (id: number, guildId: string, voiceChannelId: string) => {
        if (isRealPlayback()) {
            return fail(409, 'playback_busy', 'Stop the current stream before starting another item.');
        }
        const item = database.queue.find((entry) => entry.id === id);
        if (!item) return fail(404, 'queue_item_not_found', 'That queue item is already gone.');
        if (item.status === 'failed') {
            return fail(409, 'queue_item_failed', 'That item failed in Plex and cannot be played.');
        }
        startPlaybackFromQueue(item, guildId, voiceChannelId);
        return delay(database.playback, 220);
    },

    startPlex: (input: StartPlexInput) => {
        if (isRealPlayback()) {
            return fail(409, 'playback_busy', 'Stop the current stream before starting another item.');
        }
        const item = findPlexItem(input.ratingKey);
        if (!item) return fail(404, 'plex_item_not_found', 'That Plex item is no longer in the library.');
        if (item.type !== 'movie' && item.type !== 'episode') {
            return fail(422, 'plex_item_not_playable', 'Choose a movie or an episode to start playback.');
        }

        let queueItem = queueForItem(item.ratingKey);
        if (!queueItem) {
            queueItem = {
                id: Math.max(0, ...database.queue.map((entry) => entry.id)) + 1,
                position: database.queue.filter((entry) => entry.status !== 'failed').length,
                status: 'queued',
                ratingKey: item.ratingKey,
                type: item.type,
                title: item.title,
                showTitle: item.showTitle,
                seasonNumber: item.seasonNumber,
                episodeNumber: item.episodeNumber,
                durationMs: item.durationMs,
                thumbUrl: null,
                quality: input.quality,
                subtitleMode: input.subtitleMode,
                error: null,
            };
            database.queue.push(queueItem);
        }
        startPlaybackFromQueue(queueItem, input.guildId, input.voiceChannelId);
        return delay(database.playback, 220);
    },

    startPlaceholder: (input: StartPlaceholderInput) => {
        if (isRealPlayback()) {
            return fail(409, 'playback_busy', 'Stop the current stream before opening the Plex channel.');
        }
        const { guildName, voiceName } = guildVoice(input.guildId, input.voiceChannelId);
        database.playback = {
            mode: 'placeholder',
            title: database.settings.plex.channelName,
            subtitle: 'Waiting for the first queue item',
            posterUrl: null,
            guildId: input.guildId,
            guildName,
            voiceChannelId: input.voiceChannelId,
            voiceChannelName: voiceName,
            startedAt: Date.now(),
            positionMs: null,
            durationMs: null,
            positionUpdatedAt: null,
            viewers: 1,
            paused: false,
            queueItemId: null,
        };
        return delay(database.playback, 220);
    },

    getDiscordStatus: () => delay(database.discord, 160),

    getDiscordTokens: () => delay(database.tokens, 80),

    saveDiscordTokens: (input: DiscordTokensInput) => {
        const botToken = input.botToken ?? '';
        const userToken = input.userToken ?? '';
        if (botToken.trim()) {
            database.tokens.botTokenSet = true;
            database.tokens.botLast4 = botToken.trim().slice(-4);
        }
        if (userToken.trim()) {
            database.tokens.userTokenSet = true;
            database.tokens.userLast4 = userToken.trim().slice(-4);
        }
        updateSetupAfterChange();
        return delay(database.discord, 240);
    },

    validateDiscord: () => {
        if (!database.tokens.botTokenSet || !database.tokens.userTokenSet) {
            return fail(422, 'tokens_missing', 'Save both the bot token and the streamer token first.');
        }
        database.discord.bot = 'online';
        database.discord.streamer = 'online';
        database.discord.error = null;
        return delay(database.discord, 700);
    },

    reconnectDiscord: () => {
        database.discord.bot = 'online';
        database.discord.streamer = 'online';
        database.discord.error = null;
        return delay(database.discord, 1000);
    },

    setGuildRoles: (guildId: string, roleIds: string[]) => {
        const guild = findGuild(guildId);
        if (!guild) return fail(404, 'guild_not_found', 'The bot is no longer in that server.');
        guild.allowedRoleIds = roleIds;
        return delay(guild, 180);
    },

    getLogs: (query: LogQuery) => delay(filteredLogs(query), 140),

    getSettings: () => delay(database.settings, 140),

    updateSettings: (settings: SettingsDto) => {
        database.settings = structuredClone(settings);
        database.plexConfig.channelName = settings.plex.channelName;
        database.plexConfig.idleMinutes = settings.plex.idleMinutes;
        database.plexConfig.emptyGraceSeconds = settings.plex.emptyGraceSeconds;
        database.plexConfig.defaultQuality = settings.plex.defaultQuality;
        if (database.playback.mode === 'placeholder') {
            database.playback.title = settings.plex.channelName;
        }
        return delay(database.settings, 240);
    },

    getSetup: () => delay(setupStatus(), 140),

    getSession: () => delay(database.session, 80),

    getAuthConfig: () =>
        delay<AuthConfig>(
            { enabled: database.settings.auth.enabled, hasUser: database.hasUser },
            80
        ),

    enableAuth: (input: EnableAuthInput) => {
        if (database.settings.auth.enabled) {
            return fail(409, 'already_enabled', 'Auth is already enabled.');
        }
        if (input.username.trim().length < 3 || input.username.trim().length > 30) {
            return fail(400, 'invalid_username', 'The username must be between 3 and 30 characters.');
        }
        if (input.password.length < 8 || input.password.length > 128) {
            return fail(400, 'invalid_password', 'The password must be between 8 and 128 characters.');
        }
        database.hasUser = true;
        database.settings.auth.enabled = true;
        return delay<EnableAuthResult>(
            { enabled: true, createdAdmin: true },
            280
        );
    },

    login: (username: string, password: string) => {
        if (!username.trim() || !password) {
            return fail(401, 'invalid_credentials', 'Enter your username and password.');
        }
        if (password.length < 4) {
            return fail(401, 'invalid_credentials', 'Invalid username or password.');
        }
        database.session = { user: { id: 'admin-1', name: username.trim() } };
        return delay(database.session, 320);
    },

    logout: () => {
        database.session = { user: null };
        return new Promise<void>((resolve) => setTimeout(resolve, 120));
    },
};

export type { PlexQuality };
