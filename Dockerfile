# unturned-manager Dockerfile
# 多阶段构建：base（系统依赖 + SteamCMD）→ builder（Panel 构建）→ runtime（运行）
# 依赖清单来源：claudedocs/research_gsm3_steamcmd_unturned_2026-08-08.md §4.1
#
# 说明（相对旧版修复）：
#  - Stage 2 原从不执行后端 npm install → node_modules 缺失。现从根 npm ci --workspaces 一次装齐。
#  - shared 是 workspace 链接包（main=./index.ts 纯 TS），运行时需拷源码 + node_modules 符号链接。
#  - env 名用 INSTALL_DIR（config.ts 读取），旧版 U3DS_INSTALL_DIR 无效。
#  - JWT_SECRET / ENCRYPTION_KEY / ADMIN_PASSWORD 不写死镜像层——由 docker-compose 注入。

# ─── Stage 1: 系统依赖 + SteamCMD ──────────────────────
FROM node:20-slim AS base

ENV DEBIAN_FRONTEND=noninteractive

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
    # Mono 依赖（Unity Mono 脚本后端）
    libgdiplus \
    # X11 客户端库（Unity headless 模式仍需）
    libx11-6 libxt6 libgtk-3-0 libxrandr2 libxcursor1 libxi6 libxtst6 \
    # 工具
    procps net-tools \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# SteamCMD 安装（预装到 /opt/steamcmd——SteamCmdManager 探测路径之一）
RUN mkdir -p /opt/steamcmd \
  && cd /opt/steamcmd \
  && wget -q https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz \
  && tar -xzf steamcmd_linux.tar.gz \
  && rm steamcmd_linux.tar.gz \
  && ./steamcmd.sh +quit \
  && mkdir -p ~/.steam/sdk32 ~/.steam/sdk64 \
  && ln -sf /opt/steamcmd/linux32/steamclient.so ~/.steam/sdk32/steamclient.so \
  && ln -sf /opt/steamcmd/linux64/steamclient.so ~/.steam/sdk64/steamclient.so

# ─── Stage 2: Panel 构建 ───────────────────────────────
# 用完整 node:20（自带 python3/make/g++——argon2/better-sqlite3 原生模块编译必需）
FROM node:20 AS builder

WORKDIR /app

# 先拷 package.json + lockfile（利用 Docker 层缓存）
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY manager-server/package.json manager-server/
COPY manager-web/package.json manager-web/

# npm workspaces 根安装全部依赖（含 dev——运行时用 tsx 直接跑 TS 源码，无编译产物）
RUN npm ci

# 再拷源码
COPY shared/ shared/
COPY manager-server/ manager-server/
COPY manager-web/ manager-web/

# 构建前端（tsc typecheck + vite build → manager-web/dist）
RUN npm run build -w manager-web

# ─── Stage 3: 运行时 ────────────────────────────────────
FROM node:20-slim

ENV DEBIAN_FRONTEND=noninteractive

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

# 运行时共享依赖（i386 + Mono + Unity）
COPY --from=base /usr/lib/i386-linux-gnu /usr/lib/i386-linux-gnu
COPY --from=base /usr/lib/x86_64-linux-gnu/libgdiplus* /usr/lib/x86_64-linux-gnu/
COPY --from=base /opt/steamcmd /opt/steamcmd
COPY --from=base /root/.steam /root/.steam

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
