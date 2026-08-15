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
  LdmStatus,
  PluginRuntimeStatus,
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

  /**
   * LDM 统一状态（Phase 3）——轻量扫描，避免 listInstalledPlugins 的 PE 元数据开销。
   *
   * @param serverId 实例标识
   * @returns ldmInstalled / rocketDirExists / pluginCount —— 前端「LDM 状态」卡用
   */
  async getStatus(serverId: ServerId): Promise<LdmStatus> {
    const rocket = rocketDir(serverId);
    const rocketDirExists = await fileExists(rocket);
    const ldmInstalled =
      rocketDirExists && (await fileExists(path.join(config.installDir, LDM_MODULE_MARKER)));

    let pluginCount = 0;
    if (ldmInstalled) {
      const pluginsDir = rocketPluginsDir(serverId);
      try {
        const entries = await readdir(pluginsDir, { withFileTypes: true });
        pluginCount = entries.filter(
          (e) => e.isFile() && e.name.toLowerCase().endsWith(".dll"),
        ).length;
      } catch {
        pluginCount = 0;
      }
    }

    return {
      serverId,
      ldmInstalled,
      rocketDirExists,
      pluginCount,
      detectedAtIso: new Date().toISOString(),
    };
  }

  /**
   * 按 query / 状态筛选已装插件——内存过滤（不重新读盘，Phase 4b）。
   *
   * 复用 listInstalledPlugins 全部逻辑（含 runtimeStatus 注入），
   * 内存过滤：name.includes(query) + version?.startsWith(query) + runtimeStatus === status
   * （设计稿 §4.1：版本按「前缀」匹配，插件名按「子串」匹配）
   *
   * @param serverId 实例标识
   * @param opts.query .dll 名子串 / 版本号前缀（不区分大小写）
   * @param opts.status 运行时状态筛选；null/undefined = 全部
   * @returns 筛选后的插件列表
   * @throws AppError('server-not-found') 实例不存在（透传 listInstalledPlugins）
   */
  async searchPlugins(
    serverId: ServerId,
    opts: { query?: string; status?: PluginRuntimeStatus | null },
  ): Promise<InstalledPlugin[]> {
    const all = await this.listInstalledPlugins(serverId);
    const q = (opts.query ?? "").trim().toLowerCase();
    const status = opts.status ?? null;
    return all.plugins.filter((p) => {
      if (status !== null && p.runtimeStatus !== status) return false;
      if (q === "") return true;
      if (p.name.toLowerCase().includes(q)) return true;
      // 版本按前缀匹配（设计稿 §4.1）——例：查 "3" 命中 "3.0.0.0" 但不命中 "13.0.0.0"
      if (p.version?.toLowerCase().startsWith(q)) return true;
      return false;
    });
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
