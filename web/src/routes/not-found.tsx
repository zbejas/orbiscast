import { ArrowLeft, Compass } from 'lucide-react';
import { Link } from 'react-router';
import { OrbitalGlyph, PageHeader, buttonStyles } from '@/components';

export default function NotFoundPage() {
    return (
        <>
            <PageHeader title="Page not found" meta="404" />
            <div className="oc-page-enter flex min-h-[calc(100dvh-4rem)] items-center justify-center p-4 sm:p-6">
                <div className="flex w-full max-w-lg flex-col items-center text-center">
                    <OrbitalGlyph size={96} className="text-blurple-text opacity-80" strokeWidth={1.1} />
                    <h2 className="mt-5 text-[clamp(1.5rem,1.2rem+1vw,2rem)] font-semibold tracking-[-0.02em] text-text">
                        This route does not exist
                    </h2>
                    <p className="mt-2 max-w-md text-sm leading-relaxed text-text-muted">
                        The page may have moved, or the link may be out of date. Everything the operator needs is
                        reachable from the sidebar.
                    </p>
                    <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                        <Link to="/" className={buttonStyles({ variant: 'primary' })}>
                            <ArrowLeft size={15} aria-hidden="true" />
                            Back to dashboard
                        </Link>
                        <Link to="/channels" className={buttonStyles({ variant: 'secondary' })}>
                            <Compass size={15} aria-hidden="true" />
                            Browse channels
                        </Link>
                    </div>
                </div>
            </div>
        </>
    );
}
