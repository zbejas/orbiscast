import { Navigate, Route, Routes } from 'react-router';
import { AppShell, ToastProvider } from '@/components';
import DashboardPage from '@/routes/dashboard';
import ChannelsPage from '@/routes/channels';
import GuidePage from '@/routes/guide';
import PlexPage from '@/routes/plex';
import SourcesPage from '@/routes/sources';
import DiscordPage from '@/routes/discord';
import LogsPage from '@/routes/logs';
import SettingsPage from '@/routes/settings';
import SetupPage from '@/routes/setup';
import LoginPage from '@/routes/login';
import NotFoundPage from '@/routes/not-found';

export default function App() {
    return (
        <ToastProvider>
            <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route element={<AppShell />}>
                    <Route index element={<DashboardPage />} />
                    <Route path="dashboard" element={<Navigate to="/" replace />} />
                    <Route path="channels" element={<ChannelsPage />} />
                    <Route path="guide" element={<GuidePage />} />
                    <Route path="plex" element={<PlexPage />} />
                    <Route path="sources" element={<SourcesPage />} />
                    <Route path="discord" element={<DiscordPage />} />
                    <Route path="logs" element={<LogsPage />} />
                    <Route path="settings" element={<SettingsPage />} />
                    <Route path="setup" element={<SetupPage />} />
                    <Route path="*" element={<NotFoundPage />} />
                </Route>
            </Routes>
        </ToastProvider>
    );
}
