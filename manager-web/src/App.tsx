import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext.js';
import { WebSocketProvider } from './contexts/WebSocketContext.js';
import { Sidebar } from './components/layout/Sidebar.js';
import { LoginPage } from './pages/LoginPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { ConsolePage } from './pages/ConsolePage.js';
import { ModsPage } from './pages/ModsPage.js';
import { PlayersPage } from './pages/PlayersPage.js';
import { ConfigPage } from './pages/ConfigPage.js';
import { FilesPage } from './pages/FilesPage.js';
import { ServerSetupPage } from './pages/ServerSetupPage.js';
import { SettingsPage } from './pages/SettingsPage.js';

function AppLayout() {
  const { isAuthenticated, restoring } = useAuth();

  // Session 恢复中——显示加载
  if (restoring) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-900">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
          <span className="text-sm" style={{ color: '#94A3B8' }}>恢复会话中...</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <WebSocketProvider>
      <div className="flex h-screen bg-slate-900">
        <Sidebar />
        <main className="flex-1 overflow-auto p-6">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/_default" element={<Navigate to="/" replace />} />
            <Route path="/login" element={<Navigate to="/" replace />} />
            <Route path="/:serverId/console" element={<ConsolePage />} />
            <Route path="/:serverId/mods" element={<ModsPage />} />
            <Route path="/:serverId/players" element={<PlayersPage />} />
            <Route path="/:serverId/config/commands" element={<ConfigPage />} />
            <Route path="/:serverId/files" element={<FilesPage />} />
            <Route path="/:serverId/server-setup" element={<ServerSetupPage />} />
            <Route path="/:serverId/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </WebSocketProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/*" element={<AppLayout />} />
      </Routes>
    </AuthProvider>
  );
}
