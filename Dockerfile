# unturned-manager Dockerfile
# 多阶段构建：base（系统依赖 + SteamCMD + Mono）→ builder（Panel 构建）→ runtime（运行）

# ─── Stage 1: 系统依赖 + SteamCMD + Mono ────────────────
FROM node:20-slim AS base

ENV DEBIAN_FRONTEND=noninteractive

# apt 清华镜像 + 超时
RUN sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g; s|security.debian.org|mirrors.tuna.tsinghua.edu.cn|g' \
    /etc/apt/sources.list.d/debian.sources 2>/dev/null \
 || sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g; s|security.debian.org|mirrors.tuna.tsinghua.edu.cn|g' \
    /etc/apt/sources.list
RUN echo 'Acquire::http::Timeout "30";\nAcquire::https::Timeout "30";' > /etc/apt/apt.conf.d/99timeout

RUN dpkg --add-architecture i386 \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    curl wget ca-certificates \
    lib32gcc-s1 libc6-i386 lib32stdc++6 \
    libncurses6:i386 libbz2-1.0:i386 libstdc++6:i386 libssl3:i386 \
    libsdl2-2.0-0 libsdl2-2.0-0:i386 \
    libpulse0 libpulse0:i386 \
    libfontconfig1 libfontconfig1:i386 \
    libudev1 libudev1:i386 \
    libvulkan1 libvulkan1:i386 \
    libgdiplus libc6-dev libasound2 libnss3 libcap2 \
    libatk1.0-0 libcairo2 libcups2 libgtk-3-0 \
    libgdk-pixbuf-2.0-0 libpango-1.0-0 libx11-6 libxt6 \
    libxrandr2 libxcursor1 libxi6 libxtst6 \
    procps net-tools gnupg \
  && apt-get install -y --no-install-recommends mono-complete \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# SteamCMD 安装
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
FROM node:20 AS builder

RUN npm config set registry https://registry.npmmirror.com \
  && npm config set fetch-retry-mintimeout 20000 \
  && npm config set fetch-retry-maxtimeout 120000 \
  && npm config set fetch-timeout 300000

WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY manager-server/package.json manager-server/
COPY manager-web/package.json manager-web/

# npm install（非 ci）——lockfile 在 Windows 生成时跳过 Linux 平台原生二进制，跨平台 ci 会报错
RUN npm install --prefer-offline --no-audit

COPY shared/ shared/
COPY manager-server/ manager-server/
COPY manager-web/ manager-web/

RUN npm run build -w manager-web

# ─── Stage 3: 运行时 ────────────────────────────────────
FROM base AS runtime

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

# SteamCMD bind mount 引导副本（空宿主目录遮蔽镜像 SteamCMD 时 entrypoint 从这里 cp -an 补缺）
RUN cp -r /opt/steamcmd /opt/steamcmd-bootstrap

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/manager-server/package.json ./manager-server/package.json
COPY --from=builder /app/manager-server/src ./manager-server/src
COPY --from=builder /app/manager-web/dist ./public

RUN mkdir -p /data /opt/unturned

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# 去 CRLF——Windows 工作区拷贝的 .sh 可能是 \r\n，shebang 解析会失败
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh && chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

EXPOSE 3001
EXPOSE 27015/udp 27016/udp 25545

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fs --noproxy '*' http://localhost:3001/api/health || exit 1

CMD ["node", "--import", "tsx", "manager-server/src/index.ts"]