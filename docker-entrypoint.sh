#!/bin/sh
# unturned-manager 容器入口（Docker ENTRYPOINT）
#
# BUG-4：compose 把 SteamCMD bind mount 到 ./steamcmd:/opt/steamcmd，首次启动时空宿主目录
# 会遮蔽镜像烘焙的 SteamCMD。这里从镜像内置引导副本 /opt/steamcmd-bootstrap 补缺（cp -an
# 不覆盖已有文件），保证 SteamCMD 可用（避免 BUG-1 spawn /opt/steamcmd EACCES 复发）。
set -e

# 1. SteamCMD bind mount 初始化：缺 steamcmd.sh 才拷贝
if [ -d /opt/steamcmd-bootstrap ] && [ ! -f /opt/steamcmd/steamcmd.sh ]; then
  echo "[entrypoint] 初始化 SteamCMD: /opt/steamcmd-bootstrap -> /opt/steamcmd"
  mkdir -p /opt/steamcmd
  cp -an /opt/steamcmd-bootstrap/. /opt/steamcmd/
  # cp -a 已保留权限，补一道可执行位保险
  chmod +x /opt/steamcmd/steamcmd.sh 2>/dev/null || true
  chmod +x /opt/steamcmd/linux32/steamcmd 2>/dev/null || true
fi

# 2. 确保数据/安装目录存在（compose bind mount 宿主目录由 Docker 创建，这里兜底）
mkdir -p /data /opt/unturned

# 3. 转交 CMD（node --import tsx manager-server/src/index.ts）
exec "$@"
