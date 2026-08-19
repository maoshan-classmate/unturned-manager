import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext.js";
import { WebSocketProvider } from "./contexts/WebSocketContext.js";
import { CurrentServerProvider } from "./contexts/CurrentServerContext.js";
import { ServersProvider, useServers } from "./contexts/ServersContext.js";
import { Sidebar } from "./components/layout/Sidebar.js";
import { LoginPage } from "./pages/LoginPage.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { ConsolePage } from "./pages/ConsolePage.js";
import { ModsPage } from "./pages/ModsPage.js";
import { ConfigPage } from "./pages/ConfigPage.js";
import { FilesPage } from "./pages/FilesPage.js";
import { ServerSetupPage } from "./pages/ServerSetupPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { LdmPage } from "./pages/LdmPage.js";
import { Toaster } from "./components/ui/sonner.js";

/**
 * 全屏加载屏——AppLayout 在两种情况下渲染：
 *   1. Session 恢复中（restoring=true，accessToken 校验）
 *   2. ServersProvider 初次加载实例列表中（serversLoading=true）
 *
 * 任一情况下都不渲染路由——避免页面级 hook 重复加载造成"占位卡一闪而过"。
 */
function AppLoadingScreen({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center h-screen bg-slate-900">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
        <span className="text-sm" style={{ color: "#94A3B8" }}>
          {text}
        </span>
      </div>
    </div>
  );
}

function AppLayout() {
  const { isAuthenticated, restoring } = useAuth();

  if (restoring) {
    return <AppLoadingScreen text="恢复会话中..." />;
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <CurrentServerProvider>
      <ServersProvider>
        <AppLayoutContent />
      </ServersProvider>
    </CurrentServerProvider>
  );
}

/**
 * AppLayout 内层——ServersProvider 数据稳定后再挂 WebSocketProvider + 路由。
 * 实例列表由 Provider 在 AppLayout 顶层挂载一次，路由切换不会重 mount。
 */
function AppLayoutContent() {
  const { loading: serversLoading } = useServers();

  if (serversLoading) {
    return <AppLoadingScreen text="加载服务器列表..." />;
  }

  return (
    <WebSocketProvider>
      <div className="flex h-screen bg-slate-900">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <div className="h-full px-6 py-6">
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/login" element={<Navigate to="/" replace />} />

              {/* 全局类路由——不依赖具体实例 */}
              <Route path="/server-setup" element={<ServerSetupPage />} />
              <Route path="/settings" element={<SettingsPage />} />

              {/* 实例类路由——纯路径；实例标识由 CurrentServerProvider 承载 */}
              <Route path="/console" element={<ConsolePage />} />
              <Route path="/mods" element={<ModsPage />} />
              <Route path="/config/commands" element={<ConfigPage />} />
              <Route path="/ldm" element={<LdmPage />} />
              <Route path="/files" element={<FilesPage />} />

              {/* 老路径重定向到纯路径——用户已收藏的旧实例链接自动迁移到新形态 */}
              <Route
                path="/:serverId/console"
                element={<Navigate to="/console" replace />}
              />
              <Route
                path="/:serverId/mods"
                element={<Navigate to="/mods" replace />}
              />
              <Route
                path="/:serverId/config/commands"
                element={<Navigate to="/config/commands" replace />}
              />
              <Route
                path="/:serverId/ldm"
                element={<Navigate to="/ldm" replace />}
              />
              <Route
                path="/:serverId/files"
                element={<Navigate to="/files" replace />}
              />
            </Routes>
          </div>
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
      <Toaster />
    </AuthProvider>
  );
}