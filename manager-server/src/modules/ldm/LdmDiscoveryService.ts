/**
 * LDM 插件发现服务——扫描 Servers/<ID>/Rocket/Plugins/ 目录，组装 InstalledPlugin 列表。
 *
 * **PHASE 1 字段**（per 设计文档 §12.2 + 实施契约 §6）：
 *   - name：`Uconomy.dll` → `Uconomy`（去扩展）
 *   - version：AssemblyVersionAttribute（PE 解析失败 → null）
 *   - sizeBytes：`stat().size`
 *   - hasConfig：`<pluginName>.configuration.xml` 存在
 *   - modifiedAtIso：`mtime.toISOString()`
 *   - runtimeStatus：实例 RUNNING 时由 LdmRuntimeStatusReader 注入（解析失败/未运行 = 'unknown'）
 *
 * **LDM 激活检测**：`Modules/Rocket.Unturned/Rocket.Unturned.module` 存在 = 已激活。
 * 整目录 `Servers/<ID>/Rocket/` 不存在 → ldmNotDetected = true（前端隐藏本 Tab）。
 */
import { readdir, stat } from 'fs/promises';
import path from 'path';
import type {
  ILdmDiscoveryService,
  ILdmAssemblyVersionReader,
  InstalledPlugin,
  LdmRuntimeStatusReader,
  ServerId,
} from '@unturned-manager/shared';
import { AppError } from '../../utils/AppError.js';
import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';

// ─── 常量 ────────────────────────────────────────────────

const LDM_MODULE_MARKER = path.join('Modules', 'Rocket.Unturned', 'Rocket.Unturned.module');

function rocketPluginsDir(serverId: ServerId): string {
  return path.join(config.installDir, 'Servers', serverId, 'Rocket', 'Plugins');
}

function rocketDir(serverId: ServerId): string {
  return path.join(config.installDir, 'Servers', serverId, 'Rocket');
}

// ─── service ─────────────────────────────────────────────

export class LdmDiscoveryService implements ILdmDiscoveryService {
  constructor(
    private readonly versionReader: ILdmAssemblyVersionReader,
    private readonly runtimeStatusReader: LdmRuntimeStatusReader,
  ) {}

  async listInstalledPlugins(serverId: ServerId) {
    // 1. LDM 激活检测（全局 Modules + 实例 Rocket 目录）
    const ldmDetected = await isLdmActivated(serverId);
    if (!ldmDetected) {
      return { plugins: [], ldmNotDetected: true };
    }

    // 2. 扫描插件目录
    const dir = rocketPluginsDir(serverId);
    let names: string[];
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      names = entries
        .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.dll'))
        .map((e) => e.name);
    } catch (err) {
      // 目录不存在 = 0 插件
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { plugins: [], ldmNotDetected: false };
      }
      throw new AppError(
        'filesystem-error',
        '读取插件目录失败：' + (err as Error).message,
        500,
      );
    }

    // 3. 对每个 .dll 读 stat + PE 元数据
    const runtimeStatus = await this.runtimeStatusReader(serverId).catch(() => ({}));
    const plugins: InstalledPlugin[] = [];
    for (const fileName of names) {
      const pluginName = fileName.replace(/\.dll$/i, '');
      const dllPath = path.join(dir, fileName);
      try {
        const [st, version] = await Promise.all([
          stat(dllPath),
          this.versionReader.readVersion(dllPath),
        ]);
        const configPath = path.join(dir, pluginName, `${pluginName}.configuration.xml`);
        const hasConfig = await fileExists(configPath);
        plugins.push({
          name: pluginName,
          version,
          sizeBytes: st.size,
          hasConfig,
          modifiedAtIso: st.mtime.toISOString(),
          runtimeStatus: (runtimeStatus as Record<string, InstalledPlugin['runtimeStatus']>)[pluginName] ?? 'unknown',
        });
      } catch (err) {
        logger.warn({ err, serverId, fileName }, 'LDM 插件元数据读取失败，跳过');
      }
    }

    // 排序：按插件名字母序
    plugins.sort((a, b) => a.name.localeCompare(b.name));
    return { plugins, ldmNotDetected: false };
  }
}

// ─── 工具 ────────────────────────────────────────────────

/** LDM 激活检测：实例 Rocket 目录存在 + 全局 Modules 标记存在 = 激活 */
async function isLdmActivated(serverId: ServerId): Promise<boolean> {
  const rocket = rocketDir(serverId);
  const moduleMarker = path.join(config.installDir, LDM_MODULE_MARKER);
  return (await fileExists(rocket)) && (await fileExists(moduleMarker));
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
