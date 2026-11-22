import { CalendarDays, Rss, type LucideIcon } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { PageHeader } from '@/components';
import { cn } from '@/lib/cn';
import { usePageTitle } from '@/lib/hooks';
import { GuidePanel } from './guide';
import { SourcesPanel } from './sources';

type IptvTab = 'sources' | 'guide';

const TABS: Array<{ id: IptvTab; label: string; icon: LucideIcon }> = [
    { id: 'sources', label: 'Sources', icon: Rss },
    { id: 'guide', label: 'Guide', icon: CalendarDays },
];

export default function IptvPage() {
    usePageTitle('IPTV');
    const [searchParams, setSearchParams] = useSearchParams();
    const tab: IptvTab = searchParams.get('tab') === 'guide' ? 'guide' : 'sources';

    const selectTab = (next: IptvTab) => {
        const params = new URLSearchParams(searchParams);
        if (next === 'sources') {
            params.delete('tab');
        } else {
            params.set('tab', next);
        }
        setSearchParams(params);
    };

    return (
        <>
            <PageHeader title="IPTV" meta="Playlists, guides, and channel data" />
            <div className="mx-auto w-full max-w-[1600px] space-y-5 p-3 sm:p-5 xl:p-6">
                <div
                    role="tablist"
                    aria-label="IPTV sections"
                    className="inline-flex w-full max-w-xs items-center gap-1 rounded-full border border-outline-variant bg-surface-container p-1.5"
                >
                    {TABS.map(({ id, label, icon: Icon }) => {
                        const active = tab === id;
                        return (
                            <button
                                key={id}
                                type="button"
                                role="tab"
                                id={`iptv-tab-${id}`}
                                aria-selected={active}
                                aria-controls={`iptv-panel-${id}`}
                                tabIndex={active ? 0 : -1}
                                onClick={() => selectTab(id)}
                                onKeyDown={(event) => {
                                    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
                                        return;
                                    }
                                    event.preventDefault();
                                    const next: IptvTab = id === 'sources' ? 'guide' : 'sources';
                                    selectTab(next);
                                    window.requestAnimationFrame(() =>
                                        document.getElementById(`iptv-tab-${next}`)?.focus()
                                    );
                                }}
                                className={cn(
                                    'oc-control inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full px-3.5 text-sm font-medium transition-[background-color,color,box-shadow] duration-200',
                                    active
                                        ? 'bg-primary-container text-on-primary-container'
                                        : 'text-text-muted hover:bg-white/[0.05] hover:text-text'
                                )}
                            >
                                <Icon size={16} aria-hidden="true" />
                                {label}
                            </button>
                        );
                    })}
                </div>

                <section
                    role="tabpanel"
                    id={`iptv-panel-${tab}`}
                    aria-labelledby={`iptv-tab-${tab}`}
                >
                    {tab === 'sources' ? <SourcesPanel /> : <GuidePanel />}
                </section>
            </div>
        </>
    );
}
