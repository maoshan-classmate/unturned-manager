## 会话要点：Docker 部署闭环（多阶段构建修复 + 静态托管 + compose env 映射）

### commit
- `67bc10c` 其他更新: Docker部署闭环——构建修复+静态托管+compose env映射（7 文件 +199/-29）

### Dockerfile 重写（修 4 个致命 bug）
- builder 改完整 node:20 + 根目录 `npm ci`（workspaces 一次装齐，argon2/better-sqlite3 就地编译）；旧版从不装后端依赖，`COPY --from=builder .../node_modules` 指向不存在的目录
- 运行时 `node --import tsx manager-server/src/index.ts`（tsx 在 devDependencies，npm ci 全量含 dev）；tsx 直接跑 TS 源码，无编译产物
- env 名 `INSTALL_DIR`（config.ts 读取；旧版 `U3DS_INSTALL_DIR` 无效）+ `STEAMCMD_DIR=/opt/steamcmd`（base 阶段烘焙位置）
- 敏感值 JWT_SECRET/ENCRYPTION_KEY/ADMIN_PASSWORD 不写死镜像层，由 compose 注入

### 静态托管（index.ts，生产功能新增）
- `process.cwd()/public` 存在 index.html 才挂载（dev vite 5173 自动跳过）
- `/assets/` 内容哈希文件名 `max-age=31536000, immutable`；其余 no-cache（setHeaders 覆盖 noCache 全局 no-store）
- SPA fallback 正则排除 `/api`、`/ws`，非 API GET 回 index.html（BrowserRouter 需要）

### STEAMCMD_DIR env 映射（补齐与 INSTALL_DIR 的不一致）
- config.ts 加 `steamCmdDir`；composition-root 构造第 3 参 `undefined` → `config.steamCmdDir`（复用 SteamCmdManager 现成「显式路径优先、undefined 回落 DEFAULT_PATHS 探测」语义，模块零改动）
- 显式声明优先、不静默回落；未设回落候选探测

### compose / 卷持久化
- `docker-compose.yml` 单服务 panel：environment 用 `${VAR:-default}` 映射宿主 .env；ports 3001 + 27015/27016/udp + 25545
- 卷：panel-data:/data、unturned-data:/opt/unturned、steamcmd-data:/opt/steamcmd（SteamCMD 自更新持久化，命名卷 copy-on-first-use 灌入镜像烘焙内容）
- `.env.example`（compose 环境变量模板）+ `.dockerignore`（排除 node_modules/.env/.research/test-servers）新建

### 默认值（快速启动 + 安全警告）
- JWT_SECRET/ENCRYPTION_KEY/ADMIN_PASSWORD 带默认值（沿用 manager-server/.env 开发值），compose `:-` 缺失/留空可用 → 零配置 `docker compose up`
- ⚠️ 固定默认值 = 所有未覆盖部署共享同一密钥（JWT 可伪造、落库 RCON 凭证可解密）——生产必须 `.env` 覆盖，警告已写进 compose 注释 + .env.example 顶部

### 验证证据（2026-08-09）
- 后端 `tsc --noEmit` 零错误；前端 `npm run build -w manager-web` 成功（即 builder 阶段命令）
- `npm ls` 依赖树完整 → 容器内 `npm ci` 可靠；`tests/utilities.test.ts` 9 用例全绿（构造签名未变）
- js-yaml 解析 docker-compose.yml：YAML 合法、卷引用对齐、默认值插值正确
- ⚠️ 本机无 Docker——容器内原生模块编译 / SteamCMD 拉取 / 镜像构建仍需 Linux 实机验证（Sprint 5）
