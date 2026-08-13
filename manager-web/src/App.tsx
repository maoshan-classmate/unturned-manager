import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext.js";
import { WebSocketProvider } from "./contexts/WebSocketContext.js";
import { CurrentServerProvider } from "./contexts/CurrentServerContext.js";
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

function AppLayout() {
  const { isAuthenticated, restoring } = useAuth();

  // Session 恢复中——显示加载
  if (restoring) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-900">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
          <span className="text-sm" style={{ color: "#94A3B8" }}>
            恢复会话中...
          </span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <CurrentServerProvider>
      <WebSocketProvider>
        <div className="flex h-screen bg-slate-900">
          <Sidebar />
          <main className="flex-1 overflow-auto p-6">
            <Routes>
              {/* 首页 + 登录重定向 */}
              <Route path="/" element={<DashboardPage />} />
              <Route path="/login" element={<Navigate to="/" replace />} />

              {/* 全局类路由——不依赖具体实例；从之前误嵌的 :serverId 段拆出 */}
              <Route path="/server-setup" element={<ServerSetupPage />} />
              <Route path="/settings" element={<SettingsPage />} />

              {/* 实例类路由——纯路径；实例标识由共享层（CurrentServerProvider）承载 */}
              <Route path="/console" element={<ConsolePage />} />
              <Route path="/mods" element={<ModsPage />} />
              <Route path="/config/commands" element={<ConfigPage />} />
              <Route path="/ldm" element={<LdmPage />} />
              <Route path="/files" element={<FilesPage />} />

              {/*
                兼容迁移期——老路径重定向到纯路径。React Router v6 按 specificity 匹配：
                字面量优先于动态段，所以 /console 命中纯路径；/S1/console 命中此处重定向。
                用户已收藏的旧实例链接自动迁移到新形态。
              */}
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
          </main>
        </div>
      </WebSocketProvider>
    </CurrentServerProvider>
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
