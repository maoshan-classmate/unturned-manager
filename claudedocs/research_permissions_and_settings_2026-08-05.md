# 权限管理 & 系统设置 页面调研报告

**日期**: 2026-08-05
**参考项目**: GameServerManager (GSM3)
**深度**: Deep (3-hop web search + 完整源码分析)

---

## 一、权限管理页面

### 1.1 GSM3 现状

GSM3 **没有** RBAC 系统，也没有用户管理页面。

**用户模型** (`server/src/modules/auth/AuthManager.ts`):
```ts
interface User {
  id: string
  username: string
  password: string
  role: 'admin' | 'user'   // 仅两种角色
  createdAt: string
  lastLogin?: string
}
```

**中间件** (`server/src/middleware/auth.ts`):
- `authenticateToken` — JWT 验证
- `requireRole(role)` — 角色检查（admin 可通过任何检查）
- `requireAdmin` — 仅 admin

**缺失**:
- 无用户管理页面（`/api/auth/users` 存在但客户端无 UI 消费）
- 无角色分配界面（第一个注册用户自动成为 admin，之后无法注册）
- 无权限粒度（无 RBAC scope/feature 级别控制）

### 1.2 GSM3 中 "权限" 的实际含义

GSM3 的 PermissionsDialog (`client/src/components/PermissionsDialog.tsx`) 是 **UNIX 文件权限管理**，不是用户权限：
- 所有者/组 输入框
- 读/写/执行 复选框（所有者/组/其他）
- 八进制实时计算 (`chmod 755`)
- 递归应用开关（目录专用）
- Linux-only（调用 `stat` + `chmod`/`chown`）

### 1.3 unturned-manager 权限页面设计建议

考虑到项目当前是"单用户 JWT 登录"但"数据库预留 users 表支持未来多用户扩展"：

**页面内容**:

| 区域 | 内容 | 说明 |
|------|------|------|
| 用户列表 | 表格：用户名/角色/创建时间/最后登录 | 管理员可见 |
| 添加用户 | 弹窗：用户名+密码+角色(admin/user) | 简单表单 |
| 密码修改 | 弹窗：当前密码+新密码+确认 | 自服务 |
| 登录审计 | 表格：用户名/时间/IP/状态(成功/失败) | 安全审计 |
| 文件权限 | 文件所有者/组/读写执行权限管理 | Linux 文件 chmod |

**关键设计决策**:
- 无需完整 RBAC，只保留 admin/user 两级角色
- 文件权限功能是 unturned 服务器管理的刚需（配置文件权限、Mod 文件权限）
- 用户管理为未来多管理员场景预留

---

## 二、系统设置页面

### 2.1 GSM3 SettingsPage 结构

GSM3 的系统设置页面 (`client/src/pages/SettingsPage.tsx`, 3301 行) 包含以下功能模块：

| # | 模块 | 关键配置项 |
|---|------|-----------|
| 1 | **网页设置** | 主题模式(亮/暗)、低功耗模式(空闲超时)、深度睡眠(标签页隐藏)、首页资源监控开关、天气地理位置 |
| 2 | **背景壁纸** | 主面板壁纸上传、登录页壁纸、亮度调节 |
| 3 | **SteamCMD 设置** | 在线安装/手动路径、路径检测、安装进度 |
| 4 | **赞助者密钥** | 验证/清除 sponsor key |
| 5 | **终端选项** | 默认用户(Linux 系统用户下拉选择) |
| 6 | **游戏设置** | 默认安装路径 |
| 7 | **安全配置** | Token 重置规则(启动时/过期时/手动)、Token 过期时间、外部 API 开关/密钥管理 |
| 8 | **账户安全** | 用户名修改、密码修改、Token 过期自动跳转开关 |
| 9 | **面板日志** | 实时控制台日志流、日志文件列表/查看/下载全部 |
| 10 | **设置操作** | 开发者入口、重启引导、更新游戏列表、重置/保存 |

### 2.2 持久化方式

| 存储层 | 内容 |
|--------|------|
| `localStorage` (`webSettings`) | 低功耗/深度睡眠/天气城市/资源监控 |
| `localStorage` (`gsm3-theme`) | 主题模式 |
| `localStorage` (`gsm3-wallpaper`) | 壁纸配置 |
| `localStorage` (`gsm3-onboarding`) | 引导步骤 |
| `localStorage` (`gsm3-auth`) | 用户信息 + token 过期行为 |
| 服务端 `data/config.json` | JWT secret/过期、安全配置、游戏/终端默认值、外部 API |
| 服务端 `data/users.json` | 用户账号数据 |

### 2.3 服务端路由

| 路由前缀 | 功能 | 文件 |
|---------|------|------|
| `/api/settings` | 游戏路径默认值 | `routes/settings.ts` |
| `/api/config` | 终端配置、游戏配置 | `routes/config.ts` |
| `/api/security` | Token 规则、过期时间、外部 API | `routes/security.ts` |
| `/api/system/logs` | 日志列表/查看/下载/流 | `routes/system.ts` |
| `/api/system/users` | 系统用户列表 | `routes/system.ts` |
| `/api/auth` | 用户CRUD、登录审计 | `routes/auth.ts` |
| `/api/wallpaper` | 壁纸上传 | `routes/wallpaper.ts` |
| `/api/sponsor` | 赞助密钥 | `routes/sponsor.ts` |

### 2.4 unturned-manager 系统设置页面设计建议

按优先级排列：

| 优先级 | 模块 | 原因 |
|--------|------|------|
| 🔴 必须 | **账户安全** | 密码修改、Token 管理是所有面板的基础功能 |
| 🔴 必须 | **安全配置** | JWT Token 过期时间、安全策略 |
| 🟡 重要 | **网页设置** | 主题（已有暗色）、低功耗模式 |
| 🟡 重要 | **面板日志** | 运维排障刚需 |
| 🟢 可选 | **终端选项** | Linux 默认用户 |
| 🟢 可选 | **游戏设置** | 默认安装路径、SteamCMD 路径 |
| ⚪ 暂不需要 | **壁纸/赞助者/引导** | 超出 MVP 范围 |

**简化后的页面内容**:

```
系统设置页面
├── 账户安全
│   ├── 修改用户名
│   ├── 修改密码
│   └── Token 过期自动跳转
├── 安全配置
│   ├── JWT Token 过期时间
│   └── 会话超时
├── 网页设置
│   ├── 低功耗模式
│   └── 资源监控开关
├── 游戏默认设置
│   ├── SteamCMD 安装路径
│   ├── U3DS 默认安装路径
│   └── 终端默认用户
└── 面板日志
    ├── 实时日志流
    └── 日志文件列表/下载
```

---

## 三、关键差异对比

| 维度 | GSM3 | unturned-manager 建议 |
|------|------|----------------------|
| 用户角色 | admin / user | admin / user（保持一致） |
| 权限粒度 | 无 RBAC | 无需 RBAC（MVP 单用户为主） |
| 文件权限 | Linux chmod UI | 保留（Unturned 服务器文件管理需要） |
| 主题 | 亮/暗切换 | 仅暗色主题 |
| 壁纸 | 支持自定义 | 不需要 |
| SteamCMD | 内置安装器 | 已在 Server Setup 页面处理 |
| 多语言 | 仅中文 | 中文 |
| 赞助系统 | 有 | 不需要 |

---

## 四、数据流设计

### 权限页面状态管理
```
usePermissionStore (Zustand)
├── users: User[]           // 用户列表
├── loginAttempts: Log[]    // 登录审计
├── filePermissions: {...}  // 文件权限状态
├── loadUsers()
├── addUser(data)
├── changePassword(data)
└── loadLoginAttempts()
```

### 系统设置持久化
```
localStorage
├── unturned-theme: 'dark'
└── unturned-webSettings: { lowPower, resourceMonitor }

服务端 config.json
├── jwt: { secret, expiresIn }
├── auth: { sessionTimeout }
└── defaults: { installPath, steamcmdPath }
```

---

## 五、源文件引用

- GSM3 SettingsPage: `client/src/pages/SettingsPage.tsx`
- GSM3 AuthManager: `server/src/modules/auth/AuthManager.ts`
- GSM3 Auth Middleware: `server/src/middleware/auth.ts`
- GSM3 ConfigManager: `server/src/modules/config/ConfigManager.ts`
- GSM3 PermissionsDialog: `client/src/components/PermissionsDialog.tsx`
- GSM3 Security Routes: `server/src/routes/security.ts`
- GSM3 Auth Routes: `server/src/routes/auth.ts`
- GSM3 Settings Routes: `server/src/routes/settings.ts`
- GSM3 System Routes: `server/src/routes/system.ts`

**结论**: GSM3 的权限系统极简（admin/user 二元），系统设置功能丰富但可针对性裁剪。unturned-manager 应聚焦于：用户管理（为多用户预留）+ 文件权限管理 + 核心系统设置（安全/账户/日志）。
