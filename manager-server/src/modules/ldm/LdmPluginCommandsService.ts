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

  // ─── 内部 ─────────────────────────────────────────────

  private async run(
    serverId: ServerId,
    pluginName: string,
    verb: "load" | "unload",
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
