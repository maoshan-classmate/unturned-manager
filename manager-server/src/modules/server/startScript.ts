/**
 * U3DS 启动脚本探测 + 可执行权限。
 *
 * T6 抄 GSM `InstanceManager.ts:202-225`（detectStartScript）+ `:878-907`（chmod +x）。
 * 脚本名按 U3DS 实际定义：多实例模式优先 `ServerHelper.sh`（CLAUDE.md SOP），
 * 单服模式回落 `ExampleServer.sh`；win32 无启动脚本（U3DS 是 Linux 专用服务端）。
 */
import fs from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";
import { logger } from "../../utils/logger.js";

const execAsync = promisify(exec);

/** U3DS 启动脚本名（按平台）——多实例优先 ServerHelper.sh，单服回落 ExampleServer.sh */
const U3DS_START_SCRIPTS: Record<string, string[]> = {
  linux: ["ServerHelper.sh", "ExampleServer.sh"],
  darwin: ["ServerHelper.sh", "ExampleServer.sh"],
  win32: [], // U3DS 是 Linux 专用——win32 无启动脚本
};

/**
 * 返回指定平台的 U3DS 启动脚本名优先级列表。
 *
 * @param platform - 平台标识（默认 process.platform）
 * @returns 按优先级排列的脚本名数组
 *
 * @example
 * ```typescript
 * startScriptNames('linux'); // ['ServerHelper.sh', 'ExampleServer.sh']
 * startScriptNames('win32'); // []
 * ```
 */
export function startScriptNames(platform: string): string[] {
  return U3DS_START_SCRIPTS[platform] ?? [];
}

/**
 * 探测 U3DS 启动脚本——按平台优先级在 installDir 中查找第一个存在的脚本。
 *
 * @param installDir - U3DS 安装根目录
 * @param platform - 平台标识（测试注入用，默认 process.platform）
 * @returns 命中的脚本名；未命中或目录不可读返回 null
 *
 * @example
 * ```typescript
 * const script = await detectStartScript('/opt/unturned'); // 'ServerHelper.sh'
 * if (!script) throw new AppError('start-script-not-found', ...);
 * ```
 */
export async function detectStartScript(
  installDir: string,
  platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
  try {
    const files = await fs.readdir(installDir);
    for (const name of startScriptNames(platform)) {
      if (files.includes(name)) return name;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 给启动脚本添加可执行权限（抄 GSM chmod 兜底模式）。
 * 非 win32 才需要；chmod 失败仅 warn 不阻塞启动（GSM InstanceManager.ts:895-905 同款）。
 *
 * @param installDir - U3DS 安装根目录
 * @param script - 已探测到的脚本名
 * @param platform - 平台标识（测试注入用，默认 process.platform）
 *
 * @example
 * ```typescript
 * await ensureStartScriptExecutable('/opt/unturned', 'ServerHelper.sh');
 * ```
 */
export async function ensureStartScriptExecutable(
  installDir: string,
  script: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (platform === "win32") return;
  // U3DS 是 Linux 专用——chmod 路径永远 POSIX（用 / 拼接，避免 win32 开发机上 path.join 产反斜杠）
  const fullPath = `${installDir}/${script}`;
  try {
    await execAsync(`chmod +x "${fullPath}"`);
    logger.info({ fullPath }, "已为启动脚本添加可执行权限");
  } catch (err) {
    logger.warn({ fullPath, err }, "添加可执行权限失败，尝试继续启动");
  }
}

/**
 * U3-SDK `CommandLine.tryGetServer`（CommandLine.cs:167-234）支持的 4 种 server 启动参数前缀。
 * 大小写不敏感（tryGetServer 用 OrdinalIgnoreCase IndexOf 匹配）。
 */
const SERVER_ARG_PREFIXES = [
  "+internetserver/",
  "+lanserver/",
  "+secureserver/",
  "+insecureserver/",
] as const;

/**
 * 归一化 U3DS 启动命令——保证 `+InternetServer/<id>` 等 server 参数是命令行**最后一个参数**。
 *
 * 背景（BUG-1 根因，2026-08-13 实机排查）：U3-SDK `CommandLine.tryGetServer` 提取 serverID 时
 * 用 `IndexOf("+internetserver")` 定位后，`Substring` **一直取到命令行末尾**作为 id
 * （CommandLine.cs:203-216）。而 ServerHelper.sh 会透传所有附加参数（`"$@"`），所以若命令写成
 * `./ServerHelper.sh +InternetServer/MyServer -ThreadedConsole`，U3DS 实际得到的 serverID 是
 * `"MyServer -ThreadedConsole"`（带空格带尾参）→ 去读 `Servers/MyServer -ThreadedConsole/` 目录，
 * 面板写入的 `Servers/MyServer/` 全部失效。
 *
 * 本函数把 server 参数之后的所有尾随参数移到命令前部，使 server 参数成为末位参数，
 * 与 U3-SDK 官方用法（`+InternetServer/<id>` 在末尾）对齐。
 *
 * @param command - 原始启动命令字符串
 * @returns 归一化结果——command 为修正后的命令；changed 表示是否发生过调整
 *
 * @example
 * ```typescript
 * normalizeStartCommand('./ServerHelper.sh +InternetServer/MyServer -ThreadedConsole');
 * // → { command: './ServerHelper.sh -ThreadedConsole +InternetServer/MyServer', changed: true }
 * normalizeStartCommand('./ServerHelper.sh +InternetServer/MyServer');
 * // → { command: './ServerHelper.sh +InternetServer/MyServer', changed: false }
 * ```
 */
export function normalizeStartCommand(command: string): {
  command: string;
  changed: boolean;
} {
  const trimmed = command.trim();
  if (!trimmed) return { command, changed: false };

  const tokens = trimmed.split(/\s+/);

  // 找第一个 server 启动参数 token 的索引（如 +InternetServer/<id>）
  let serverIdx = -1;
  for (let i = 0; i < tokens.length; i++) {
    const lower = tokens[i]!.toLowerCase();
    if (SERVER_ARG_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
      serverIdx = i;
      break;
    }
  }
  // 没有 server 参数（如仅客户端式命令）或已无尾随参数 → 无需调整
  if (serverIdx === -1) return { command, changed: false };

  const trailing = tokens.slice(serverIdx + 1);
  if (trailing.length === 0) return { command, changed: false };

  // 尾随参数整体移到 server 参数之前，保证 server 参数是命令行最后一个参数
  const normalized = [
    ...tokens.slice(0, serverIdx),
    ...trailing,
    tokens[serverIdx],
  ].join(" ");
  return { command: normalized, changed: true };
}
