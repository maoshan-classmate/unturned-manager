/**
 * U3DS 启动脚本探测 + 可执行权限。
 *
 * T6 抄 GSM `InstanceManager.ts:202-225`（detectStartScript）+ `:878-907`（chmod +x）。
 * 脚本名按 U3DS 实际定义：多实例模式优先 `ServerHelper.sh`（CLAUDE.md SOP），
 * 单服模式回落 `ExampleServer.sh`；win32 无启动脚本（U3DS 是 Linux 专用服务端）。
 */
import fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../../utils/logger.js';

const execAsync = promisify(exec);

/** U3DS 启动脚本名（按平台）——多实例优先 ServerHelper.sh，单服回落 ExampleServer.sh */
const U3DS_START_SCRIPTS: Record<string, string[]> = {
  linux: ['ServerHelper.sh', 'ExampleServer.sh'],
  darwin: ['ServerHelper.sh', 'ExampleServer.sh'],
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
  if (platform === 'win32') return;
  // U3DS 是 Linux 专用——chmod 路径永远 POSIX（用 / 拼接，避免 win32 开发机上 path.join 产反斜杠）
  const fullPath = `${installDir}/${script}`;
  try {
    await execAsync(`chmod +x "${fullPath}"`);
    logger.info({ fullPath }, '已为启动脚本添加可执行权限');
  } catch (err) {
    logger.warn({ fullPath, err }, '添加可执行权限失败，尝试继续启动');
  }
}
