/**
 * LDM 插件 .dll 版本号读取器（实现 `ILdmAssemblyVersionReader`）。
 *
 * 委托 `pe-metadata.ts` 纯函数（Buffer → string|null）做实际解析——失败一律 null。
 * 这里仅做 IO 壳：readFile → 缓冲长度校验 → 解析。
 * 永不抛错（接口契约 §"失败安全降级"）。
 */
import { readFile } from "fs/promises";
import type { ILdmAssemblyVersionReader } from "@unturned-manager/shared";
import { parsePeAssemblyVersion } from "./pe-metadata.js";

// ─── 常量 ────────────────────────────────────────────────

/** 单文件最大允许 100MB（防止恶意大文件 / IO 抖动） */
const MAX_DLL_FILE_SIZE = 100 * 1024 * 1024;

// ─── 实现 ────────────────────────────────────────────────

/**
 * .NET 程序集版本号读取器。
 * 自写 PE/CLI ECMA-335 解析——零依赖，5MB 插件 < 5ms。
 */
export class LdmAssemblyVersionReader implements ILdmAssemblyVersionReader {
  /**
   * 读 .dll AssemblyVersionAttribute 版本号（如 `'1.2.3.4'`）。
   * 失败安全：文件不存在 / IO 错误 / 非 .NET / 无 CLR 头 / 解析异常 = null。
   *
   * @param dllPath - .dll 绝对路径
   * @returns `'1.2.3.4'` 或 null
   */
  async readVersion(dllPath: string): Promise<string | null> {
    try {
      const data = await readFile(dllPath);
      if (data.length === 0) return null;
      if (data.length > MAX_DLL_FILE_SIZE) return null;
      return parsePeAssemblyVersion(data);
    } catch {
      return null; // 文件不存在 / 权限 / IO 异常
    }
  }
}
