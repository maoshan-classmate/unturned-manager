import fs from 'fs';
import type Database from 'better-sqlite3';
import type { ISteamCmdManager, SteamCmdStatus } from '@unturned-manager/shared';
import { logger } from '../../utils/logger.js';

// ─── 常量 ────────────────────────────────────────────────

/** SteamCMD 常见安装路径 */
const DEFAULT_PATHS = [
  '/usr/games/steamcmd',
  '/usr/bin/steamcmd',
  '/opt/steamcmd',
  '/home/steam/steamcmd',
];

// ─── 实现 ────────────────────────────────────────────────

export class SteamCmdManager implements ISteamCmdManager {
  constructor(
    private db: Database.Database,
    private steamCmdPath?: string,
  ) {}

  async getStatus(): Promise<SteamCmdStatus> {
    const exePath = this.steamCmdPath ?? this.findSteamCmd();
    const isInstalled = exePath !== null && fs.existsSync(exePath);

    return {
      isInstalled,
      installPath: exePath ?? undefined,
      lastChecked: new Date().toISOString(),
    };
  }

  async install(_installDir: string): Promise<void> {
    // Sprint 2: 假设 SteamCMD 已预装（Docker 环境）
    // 后续 Sprint 实现实际下载逻辑
    const status = await this.getStatus();
    if (!status.isInstalled) {
      throw new Error(
        'SteamCMD 未安装。请在宿主机安装 SteamCMD，或使用包含 SteamCMD 的 Docker 镜像。',
      );
    }
  }

  async updateU3DS(installDir: string): Promise<void> {
    // ⚠️ 安全门控：检查所有实例是否 STOPPED
    const runningServers = this.db
      .prepare("SELECT id FROM servers WHERE state != 'STOPPED' AND install_dir = ?")
      .all(installDir) as Array<{ id: string }>;

    if (runningServers.length > 0) {
      const ids = runningServers.map((s) => s.id).join(', ');
      throw new Error(`以下服务端仍在运行，无法更新 U3DS：${ids}。请先停止所有实例。`);
    }

    // Sprint 2: 骨架——不执行真实 spawn
    // 后续 Sprint：spawn steamcmd +login anonymous +force_install_dir <dir> +app_update 1110390 validate +quit
    logger.info({ installDir }, 'U3DS 更新请求已接受（Sprint 2 骨架——未实际执行 spawn）');
  }

  // ── 内部 ──────────────────────────────────────────────

  private findSteamCmd(): string | null {
    for (const p of DEFAULT_PATHS) {
      if (fs.existsSync(p)) return p;
      if (fs.existsSync(p + '.sh')) return p + '.sh';
      if (fs.existsSync(p + '.exe')) return p + '.exe';
    }
    return null;
  }
}
