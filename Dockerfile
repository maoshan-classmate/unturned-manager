# unturned-manager Dockerfile
# 多阶段构建：base（系统依赖 + SteamCMD + Mono）→ builder（Panel 构建）→ runtime（运行）
# 依赖清单来源：claudedocs/research_gsm3_steamcmd_unturned_2026-08-08.md §4.1
#               claudedocs/research_gsm3_linux_uat_bugfix_2026-08-10.md（BUG-10 修复）
#
# 说明（相对旧版修复）：
#  - Stage 2 原从不执行后端 npm install → node_modules 缺失。现从根 npm ci --workspaces 一次装齐。
#  - shared 是 workspace 链接包（main=./index.ts 纯 TS），运行时需拷源码 + node_modules 符号链接。
#  - env 名用 INSTALL_DIR（config.ts 读取），旧版 U3DS_INSTALL_DIR 无效。
#  - JWT_SECRET / ENCRYPTION_KEY / ADMIN_PASSWORD 不写死镜像层——由 docker-compose 注入。
#  - BUG-10：换 npm + apt 国内镜像源；SteamCMD 走 akamai 不换（GSM3 同款）。
#  - BUG-3/7：装 mono-complete（Unturned Unity Mono 脚本后端必需，GSM3 Dockerfile 同款依赖集）。

# ─── Stage 1: 系统依赖 + SteamCMD + Mono ────────────────
FROM node:20-slim AS base

ENV DEBIAN_FRONTEND=noninteractive

# ★ BUG-10：换 apt 源到清华（GSM3 仅换 npm，本项目升级 apt；SteamCMD 走 akamai 不能换）
RUN sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g; s|security.debian.org|mirrors.tuna.tsinghua.edu.cn|g' \
    /etc/apt/sources.list.d/debian.sources 2>/dev/null \
 || sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g; s|security.debian.org|mirrors.tuna.tsinghua.edu.cn|g' \
    /etc/apt/sources.list

# ★ BUG-10：apt 镜像加速（清华源 + timeout）
RUN echo 'Acquire::http::Timeout "30";\nAcquire::https::Timeout "30";' > /etc/apt/apt.conf.d/99timeout

# i386 架构 + SteamCMD 32 位运行时 + Unity 引擎 / Mono 依赖
RUN dpkg --add-architecture i386 \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    curl wget ca-certificates \
    lib32gcc-s1 libc6-i386 lib32stdc++6 \
    libncurses6:i386 libbz2-1.0:i386 libstdc++6:i386 libssl3:i386 \
    # Unity 引擎依赖（Unturned 用 Unity 2020.3 LTS Mono）
    libsdl2-2.0-0 libsdl2-2.0-0:i386 \
    libpulse0 libpulse0:i386 \
    libfontconfig1 libfontconfig1:i386 \
    libudev1 libudev1:i386 \
    libvulkan1 libvulkan1:i386 \
    # Mono 依赖（Unity Mono 脚本后端）——抄 GSM3 Dockerfile:21-66 Mono 集合
    libgdiplus \
    libc6-dev \
    libasound2 \
    libnss3 \
    libcap2 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libgtk-3-0 \
    libgdk-pixbuf-2.0-0 \
    libpango-1.0-0 \
    libx11-6 \
    libxt6 \
    # X11 客户端库（Unity headless 模式仍需）
    libxrandr2 libxcursor1 libxi6 libxtst6 \
    # 工具
    procps net-tools gnupg \
  && apt-get install -y --no-install-recommends mono-complete \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# SteamCMD 安装（预装到 /opt/steamcmd——SteamCmdManager 探测路径之一）
# ★ BUG-10：SteamCMD 走 akamai 不能换（GSM3:201-204 同款），加 multi-URL fallback
RUN mkdir -p /opt/steamcmd \
  && cd /opt/steamcmd \
  && (wget -t 5 --retry-connrefused --waitretry=1 --read-timeout=20 --timeout=15 -O steamcmd_linux.tar.gz https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz \
   || wget -t 5 --retry-connrefused --waitretry=1 --read-timeout=20 --timeout=15 -O steamcmd_linux.tar.gz https://media.steampowered.com/installer/steamcmd_linux.tar.gz) \
  && tar -xzf steamcmd_linux.tar.gz \
  && rm steamcmd_linux.tar.gz \
  && ./steamcmd.sh +quit \
  && mkdir -p ~/.steam/sdk32 ~/.steam/sdk64 \
  && ln -sf /opt/steamcmd/linux32/steamclient.so ~/.steam/sdk32/steamclient.so \
  && ln -sf /opt/steamcmd/linux64/steamclient.so ~/.steam/sdk64/steamclient.so

# ─── Stage 2: Panel 构建 ───────────────────────────────
# 用完整 node:20（自带 python3/make/g++——argon2/better-sqlite3 原生模块编译必需）
FROM node:20 AS builder

# ★ BUG-10：npm 镜像源（GSM3 Dockerfile:84 同款）
RUN npm config set registry https://registry.npmmirror.com \
  && npm config set fetch-retry-mintimeout 20000 \
  && npm config set fetch-retry-maxtimeout 120000 \
  && npm config set fetch-timeout 300000

WORKDIR /app

# 先拷 package.json + lockfile（利用 Docker 层缓存）
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY manager-server/package.json manager-server/
COPY manager-web/package.json manager-web/

# npm workspaces 根安装全部依赖（含 dev——运行时用 tsx 直接跑 TS 源码，无编译产物）
# ⚠️ 用 npm install 而非 npm ci：npm ci 严格按 lockfile 重现 node_modules 树，但 lockfile
#    在 Windows 生成时跳过了 Linux 平台原生二进制（@rollup/rollup-linux-x64-gnu 等 optionalDeps）。
#    Docker 在 Linux 上 ci 会照搬跳过 → vite build 找不到 loader（npm/cli#4828 bug）。
#    npm install 在目标平台实时解析 optional deps，不受 lockfile 跨平台限制。版本仍由 lockfile 锁定。
RUN npm install --prefer-offline --no-audit

# 再拷源码
COPY shared/ shared/
COPY manager-server/ manager-server/
COPY manager-web/ manager-web/

# 构建前端（tsc typecheck + vite build → manager-web/dist）
RUN npm run build -w manager-web

# ─── Stage 3: 运行时 ────────────────────────────────────
FROM node:20-slim

ENV DEBIAN_FRONTEND=noninteractive

# ★ BUG-10：runtime 同样换清华源
RUN sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g; s|security.debian.org|mirrors.tuna.tsinghua.edu.cn|g' \
    /etc/apt/sources.list.d/debian.sources 2>/dev/null \
 || sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g; s|security.debian.org|mirrors.tuna.tsinghua.edu.cn|g' \
    /etc/apt/sources.list

# 健康检查依赖 curl（slim 镜像不自带）
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# 默认 env——敏感值（JWT_SECRET/ENCRYPTION_KEY/ADMIN_PASSWORD）由 docker-compose 注入
ENV NODE_ENV=production \
    SERVER_PORT=3001 \
    HOST=0.0.0.0 \
    LOG_LEVEL=info \
    DB_PATH=/data/unturned-manager.db \
    DATA_DIR=/data \
    INSTALL_DIR=/opt/unturned \
    STEAMCMD_DIR=/opt/steamcmd \
    CORS_ORIGIN=*

WORKDIR /app

# 运行时共享依赖（i386 + Mono + Unity + SteamCMD）
COPY --from=base /usr/lib/i386-linux-gnu /usr/lib/i386-linux-gnu
COPY --from=base /usr/lib/x86_64-linux-gnu/libgdiplus* /usr/lib/x86_64-linux-gnu/
COPY --from=base /opt/steamcmd /opt/steamcmd
COPY --from=base /root/.steam /root/.steam
# ★ BUG-3 联动：复制 mono 到 runtime（不然 U3DS 启不起来）
COPY --from=base /usr/bin/mono /usr/bin/mono
COPY --from=base /usr/lib/mono /usr/lib/mono
COPY --from=base /usr/share/mono /usr/share/mono

# Panel 运行文件
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/manager-server/package.json ./manager-server/package.json
COPY --from=builder /app/manager-server/src ./manager-server/src
COPY --from=builder /app/manager-web/dist ./public

RUN mkdir -p /data /opt/unturned

# 面板 HTTP
EXPOSE 3001
# U3DS 默认游戏端口（Commands.dat Port）+ OpenMod RCON——实际端口以各实例 Commands.dat 为准
EXPOSE 27015/udp 27016/udp 25545

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fs http://localhost:3001/api/health || exit 1

CMD ["node", "--import", "tsx", "manager-server/src/index.ts"]
