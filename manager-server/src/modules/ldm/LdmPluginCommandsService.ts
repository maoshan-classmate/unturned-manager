/**
 * LDM 插件命令服务——PTY 终端 owner-trust，唯一通道。
 *
 * **命令协议**（U.cs:93-118 默认翻译）：
 *   - `/rocket load <name>` → 成功：stdout 含 "Loading {name}"（U.cs 命令前缀）
 *     失败：stdout 含 "Unable to load plugin" / "Could not find plugin"
 *   - `/rocket unload <name>` → 成功：stdout 含 "Unloading {name}"
 *     失败：stdout 含 "Unable to unload plugin" / "Could not find plugin"
 *
 * **race 防护**：per-server 互斥锁（同时只允许一个 load/unload）。
 * **超时**：10s 内未收到 LDM 响应 → pty-marker-timeout。
 */
import type {
  ILdmPluginCommandsService,
  LdmRuntimeStatusReader,
  ServerId,
  IServerManager,
} from '@unturned-manager/shared';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';
import type { IPtyManager } from '@unturned-manager/shared';
import { ServerState } from '@unturned-manager/shared';

// ─── 常量 ────────────────────────────────────────────────

const COMMAND_TIMEOUT_MS = 10_000;

// ─── 锚点（U.cs:93-118）──────────────────────────────────

/** 成功载荷：stdout 含 "Loading {name}" 或 "Unloading {name}" */
const LOAD_SUCCESS_MARKERS = [/^Loading\s+/i, /Loaded plugin/i];
const UNLOAD_SUCCESS_MARKERS = [/^Unloading\s+/i, /Unloaded plugin/i];

/** 失败载荷：stdout 含 "Unable to" / "Could not" / "not found" / "does not exist" */
const FAILURE_MARKERS = [
  /Unable to (load|unload)/i,
  /Could not (find|load|unload)/i,
  /(not found|does not exist|is not installed)/i,
  /Unknown plugin/i,
  /Failed to/i,
];

function isFailureLine(line: string): boolean {
  return FAILURE_MARKERS.some((rx) => rx.test(line));
}

// ─── service ─────────────────────────────────────────────

export class LdmPluginCommandsService implements ILdmPluginCommandsService {
  /** per-server 互斥锁——同一 serverId 同时只能跑一个 plugin 命令 */
  private locks = new Map<ServerId, Promise<void>>();

  constructor(
    private readonly pty: Pick<IPtyManager, "write" | "waitForMarker" | "onData">,
    private readonly serverManager: Pick<IServerManager, "getState">,
    private readonly _runtimeStatusReader: LdmRuntimeStatusReader,
  ) {}

  async loadPlugin(serverId: ServerId, pluginName: string) {
    return this.run(serverId, pluginName, "load", LOAD_SUCCESS_MARKERS);
  }

  async unloadPlugin(serverId: ServerId, pluginName: string) {
    return this.run(serverId, pluginName, "unload", UNLOAD_SUCCESS_MARKERS);
  }

  /**
   * PTY 写 `/p reload` 重载 Permissions.config.xml（Phase 2b D4）。
   * 不停服，不触发状态机转换——Permissions.config.xml 变更后由 LdmApplyService 在 postStartHook 触发。
   *
   * 成功锚点（LDM 源码 RocketPermissions 加载完成）：`Reloaded permissions from 'Permissions.config.xml'`
   * 失败锚点：权限文件不存在 / XML 损坏
   *
   * @param serverId - 实例标识
   * @returns outcome + LDM stdout 末尾（≤ 256 字）
   * @throws AppError('server-not-running') 实例未运行
   * @throws AppError('pty-write-failed') PTY 写入失败
   * @throws AppError('pty-timeout') 10s 内未收到 LDM 响应
   */
  async reloadPermissions(
    serverId: ServerId,
  ): Promise<{ outcome: "success" | "failure"; ldmOutput: string }> {
    return this.runMarkerless(serverId, "/p reload", [
      /^Reloaded permissions/i,
      /Reloaded\s+permissions\s+from/i,
    ]);
  }

  /**
   * PTY 写 `/rocket reload <name>`——单插件 reload（Phase 4a B4）。
   *
   * **不保证成功**——社区已知 reload 会破坏部分插件状态（设计 §11.1 B4）；
   * 前端**必须**弹二次确认由用户决策。
   * 成功 reload 零日志（与 load 行为一致，CommandRocket.cs 行为）——
   * success markers 用 `Reloading|Reload ` 捕获 reload 启动事件，failure
   * 锚点复用 isFailureLine() 全局函数（识别 Failed/Unable to/Could not）。
   *
   * @param serverId - 实例标识
   * @param pluginName - 插件名（Linux 大小写敏感）
   * @returns outcome + LDM stdout 末尾（≤ 256 字）
   * @throws AppError('server-not-running') 实例未运行
   * @throws AppError('pty-write-failed') PTY 写入失败
   * @throws AppError('pty-timeout') 10s 内未收到 LDM 响应
   * @throws AppError('operation-conflict') 已有同 server 的 plugin command 在跑
   */
  async reloadPlugin(
    serverId: ServerId,
    pluginName: string,
  ): Promise<{ outcome: "success" | "failure"; ldmOutput: string }> {
    return this.run(serverId, pluginName, "reload", [
      /Reloading\s+|Reload\s+/i,
    ]);
  }

  /**
   * 读LDM 主框架版本（D2）——PTY 写空 `/rocket`（U.cs:88-118 输出 Rocket v<ver> for Unturned v<gameVer>）。
   *
   * @param serverId - 实例标识
   * @returns LDM 版本字符串（如 `"Rocket v4.0.0.0 for Unturned v3.25.0.0"`）—— 解析失败返回 null
   * @throws AppError('server-not-running') 实例未运行
   */
  async readLdmVersion(
    serverId: ServerId,
  ): Promise<{ ldmVersion: string | null; gameVersion: string | null; raw: string }> {
    const state = this.serverManager.getState(serverId);
    if (state !== ServerState.RUNNING) {
      throw new AppError("server-not-running", "实例未运行，无法读 LDM 版本", 409);
    }
    const result = await this.runMarkerless(serverId, "/rocket", [
      /^Rocket\s+v[\d.]+\s+for\s+Unturned\s+v[\d.]+/i,
    ]);
    const match = result.ldmOutput.match(
      /Rocket\s+v(?<ldm>[\d.]+)\s+for\s+Unturned\s+v(?<game>[\d.]+)/,
    );
    return {
      ldmVersion: match?.groups?.ldm ?? null,
      gameVersion: match?.groups?.game ?? null,
      raw: result.ldmOutput,
    };
  }

  /**
   * 读 Rocket.Unturned 模块加载状态（D3）——PTY 写 `/modules` 解析 stdout。
   *
   * @param serverId - 实例标识
   * @returns rocketUnturnedLoaded - 是否加载了 Rocket.Unturned 模块；raw - 完整 stdout
   * @throws AppError('server-not-running') 实例未运行
   */
  async readModulesState(
    serverId: ServerId,
  ): Promise<{ rocketUnturnedLoaded: boolean; raw: string }> {
    const state = this.serverManager.getState(serverId);
    if (state !== ServerState.RUNNING) {
      throw new AppError("server-not-running", "实例未运行，无法读模块状态", 409);
    }
    const result = await this.runMarkerless(serverId, "/modules", []);
    const loaded = /Rocket\.Unturned/i.test(result.ldmOutput);
    return { rocketUnturnedLoaded: loaded, raw: result.ldmOutput };
  }

  /**
   * 通用「写命令 + 收 stdout」内部方法——无插件名（reloadPermissions / /rocket / /modules 用）。
   *
   * @param serverId 实例标识
   * @param cmd 待写入的命令字符串（不含 \n，自动加）
   * @param successMarkers 成功锚点正则数组（命中即视为 success）
   * @returns outcome + 末尾 stdout（≤ 256 字）
   */
  private async runMarkerless(
    serverId: ServerId,
    cmd: string,
    successMarkers: RegExp[],
  ): Promise<{ outcome: "success" | "failure"; ldmOutput: string }> {
    const state = this.serverManager.getState(serverId);
    if (state !== ServerState.RUNNING) {
      throw new AppError("server-not-running", `实例未运行，无法执行 ${cmd}`, 409);
    }
    const collector: string[] = [];
    let markerHit: "success" | "failure" | null = null;
    const offData = this.pty.onData(serverId, (line) => {
      if (markerHit) return;
      collector.push(line);
      if (successMarkers.some((rx) => rx.test(line))) {
        markerHit = "success";
      }
    });
    try {
      try {
        this.pty.write(serverId, `${cmd}\n`);
      } catch {
        throw new AppError("pty-write-failed", "PTY 写入失败", 500);
      }
      await Promise.race([
        pollForMarker(collector, () => markerHit, COMMAND_TIMEOUT_MS),
        this.pty
          .waitForMarker(serverId, /Reloaded|Rocket\.Unturned|Rocket\s+v/, COMMAND_TIMEOUT_MS)
          .then(() => markerHit),
      ]);
      const outcome = markerHit ?? "failure";
      const tail = collector.slice(-8).join("\n").slice(-256);
      return { outcome, ldmOutput: tail };
    } finally {
      offData();
    }
  }

  // ─── 内部 ─────────────────────────────────────────────

  private async run(
    serverId: ServerId,
    pluginName: string,
    verb: "load" | "unload" | "reload",
    successMarkers: RegExp[],
  ): Promise<{ outcome: "success" | "failure"; ldmOutput: string }> {
    // 1. 互斥锁
    const prev = this.locks.get(serverId) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    this.locks.set(serverId, prev.then(() => next));
    await prev;
    try {
      // 2. 实例必须运行
      const state = this.serverManager.getState(serverId);
      if (state !== ServerState.RUNNING) {
        throw new AppError(
          "server-not-running",
          "服务实例未运行，无法对插件执行命令",
          409,
        );
      }

      // 3. 采集最近 256 字最近输出（PTY 滚动 buffer——这里用收集器）
      const collector: string[] = [];
      let markerHit: "success" | "failure" | null = null;
      const offData = this.pty.onData(serverId, (line) => {
        if (markerHit) return;
        collector.push(line);
        if (successMarkers.some((rx) => rx.test(line))) {
          markerHit = "success";
        } else if (isFailureLine(line)) {
          markerHit = "failure";
        }
      });

      try {
        // 4. 写命令
        try {
          this.pty.write(serverId, `/rocket ${verb} ${pluginName}\n`);
        } catch {
          throw new AppError("pty-write-failed", "PTY 写入失败", 500);
        }

        // 5. 等响应
        const winner = await Promise.race([
          pollForMarker(collector, () => markerHit, COMMAND_TIMEOUT_MS),
          this.pty
            .waitForMarker(serverId, /Loading\s+|Unloading\s+|Unable to|Could not|Failed/, COMMAND_TIMEOUT_MS)
            .then(() => markerHit),
        ]);

        const outcome = winner ?? "failure"; // 超时/未匹配 → failure
        const tail = collector.slice(-8).join("\n").slice(-256);
        return { outcome, ldmOutput: tail };
      } finally {
        offData();
      }
    } finally {
      release();
      // 锁链清理：若当前就是链尾，删除避免 Map 无限增长
      if (this.locks.get(serverId) === prev.then(() => next)) {
        this.locks.delete(serverId);
      }
    }
  }
}

/** 极简轮询：每 50ms 读 markerHit 一次，命中即返回 */
async function pollForMarker(
  _collector: string[],
  getMarker: () => "success" | "failure" | null,
  timeoutMs: number,
): Promise<"success" | "failure" | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const m = getMarker();
    if (m) return m;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}
