import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext.js';
import { WebSocketProvider } from './contexts/WebSocketContext.js';
import { Sidebar } from './components/layout/Sidebar.js';
import { LoginPage } from './pages/LoginPage.js';

// 占位页面
function Placeholder({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-slate-100 mb-2">{title}</h1>
        <p className="text-slate-400">此页面将在后续 Sprint 中实现</p>
      </div>
    </div>
  );
}

function AppLayout() {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <WebSocketProvider>
      <div className="flex h-screen bg-slate-900">
        <Sidebar />
        <main className="flex-1 overflow-auto p-6">
          <Routes>
            <Route path="/" element={<Placeholder title="Dashboard" />} />
            <Route path="/_default" element={<Navigate to="/" replace />} />
            <Route path="/login" element={<Navigate to="/" replace />} />
            <Route path="/:serverId/console" element={<Placeholder title="Console" />} />
            <Route path="/:serverId/mods" element={<Placeholder title="Mods" />} />
            <Route path="/:serverId/players" element={<Placeholder title="Players" />} />
            <Route path="/:serverId/config/commands" element={<Placeholder title="Config" />} />
            <Route path="/:serverId/files" element={<Placeholder title="Files" />} />
            <Route path="/:serverId/permissions" element={<Placeholder title="Permissions" />} />
            <Route path="/:serverId/server-setup" element={<Placeholder title="Server Setup" />} />
            <Route path="/settings" element={<Placeholder title="Settings" />} />
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
