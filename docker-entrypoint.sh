#!/bin/sh
# 容器入口——首次启动时从镜像引导副本补 SteamCMD 缺省文件
set -e

# SteamCMD bind mount 兜底：空宿主目录会遮蔽镜像 SteamCMD，这里从 /opt/steamcmd-bootstrap 补缺
if [ -d /opt/steamcmd-bootstrap ] && [ ! -f /opt/steamcmd/steamcmd.sh ]; then
  echo "[entrypoint] 初始化 SteamCMD"
  mkdir -p /opt/steamcmd
  cp -an /opt/steamcmd-bootstrap/. /opt/steamcmd/
  chmod +x /opt/steamcmd/steamcmd.sh 2>/dev/null || true
  chmod +x /opt/steamcmd/linux32/steamcmd 2>/dev/null || true
fi

mkdir -p /data /opt/unturned

exec "$@"