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
            <div className="oc-page-enter mx-auto w-full max-w-[1600px] space-y-4 p-3 sm:p-5 xl:p-6">
                <div
                    role="tablist"
                    aria-label="IPTV sections"
                    className="flex items-center gap-1 border-b border-border"
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
                                    'relative -mb-px inline-flex h-10 items-center gap-2 rounded-t-md border-b-2 px-3 text-sm font-medium transition-colors',
                                    active
                                        ? 'border-blurple text-text'
                                        : 'border-transparent text-text-muted hover:bg-white/[0.03] hover:text-text'
                                )}
                            >
                                <Icon size={15} aria-hidden="true" />
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
