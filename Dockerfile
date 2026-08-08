# unturned-manager Dockerfile
# 多阶段构建：依赖 → SteamCMD → Panel
# 依赖清单来源：research_gsm3_steamcmd_unturned_2026-08-08.md §4.1

# ─── Stage 1: 系统依赖 + SteamCMD ──────────────────────
FROM node:20-slim AS base

ENV DEBIAN_FRONTEND=noninteractive

# i386 架构 + SteamCMD 32 位运行时
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

# SteamCMD 安装（预装到 /opt/steamcmd）
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
FROM node:20-slim AS builder

WORKDIR /app

# shared 包
COPY shared/package.json shared/tsconfig.json shared/
COPY shared/ shared/

# manager-web 构建
COPY manager-web/package.json manager-web/tsconfig.json manager-web/vite.config.* manager-web/
COPY manager-web/ manager-web/
RUN cd manager-web && npm install && npm run build

# manager-server（仅复制源码，运行时 install）
COPY manager-server/package.json manager-server/tsconfig.json manager-server/
COPY manager-server/src/ manager-server/src/

# ─── Stage 3: 运行时 ────────────────────────────────────
FROM node:20-slim

ENV NODE_ENV=production
ENV SERVER_PORT=3001
ENV HOST=0.0.0.0
ENV LOG_LEVEL=info
ENV DB_PATH=/data/unturned-manager.db
ENV DATA_DIR=/data
ENV U3DS_INSTALL_DIR=/opt/unturned

WORKDIR /app

# 共享运行时依赖（i386 + Mono + Unity）
COPY --from=base /usr/lib/i386-linux-gnu /usr/lib/i386-linux-gnu
COPY --from=base /usr/lib/x86_64-linux-gnu/libgdiplus* /usr/lib/x86_64-linux-gnu/
COPY --from=base /opt/steamcmd /opt/steamcmd
COPY --from=base /root/.steam /root/.steam

# Panel 文件
COPY --from=builder /app/manager-server/node_modules ./node_modules
COPY --from=builder /app/manager-server/package.json ./
COPY --from=builder /app/manager-server/src ./src
COPY --from=builder /app/manager-web/dist ./public
COPY --from=builder /app/shared ./shared

RUN mkdir -p /data /opt/unturned

EXPOSE 3001

CMD ["node", "--import", "tsx", "src/index.ts"]
