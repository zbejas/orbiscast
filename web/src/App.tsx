import { Navigate, Route, Routes } from 'react-router';
import { AppShell, ToastProvider } from '@/components';
import DashboardPage from '@/routes/dashboard';
import ChannelsPage from '@/routes/channels';
import IptvPage from '@/routes/iptv';
import MediaPage from '@/routes/media';
import MediaSourcesPage from '@/routes/media-sources';
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
                    <Route path="iptv" element={<IptvPage />} />
                    <Route path="guide" element={<Navigate to="/iptv?tab=guide" replace />} />
                    <Route path="media" element={<MediaPage />} />
                    <Route path="media/sources" element={<MediaSourcesPage />} />
                    <Route path="plex" element={<Navigate to="/media/sources" replace />} />
                    <Route path="sources" element={<Navigate to="/iptv" replace />} />
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
