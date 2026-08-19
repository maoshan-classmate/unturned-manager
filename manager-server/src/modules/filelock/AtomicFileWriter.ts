/**
 * AtomicFileWriter——共享原子写工具。
 *
 * 适用对象：ConfigService 与 LdmConfigWriter 都需要原子写 + 备份 + 回滚, 抽到共享模块复用。
 *
 * 行为契约：
 *   - **每次写都生成新备份**：目标文件写入前, 先把原文件复制为 `<path>.bak.<UTC-ISO>`
 *   - **原子写**：写到 `.<path>.tmp` → rename 到目标（OS 层 atomic）
 *   - **失败自动回滚**：temp rename 失败时, 从 .bak 恢复原内容 + 抛 AppError
 *   - **保留最近 10 份备份**：写入完成后, 扫同文件名的 .bak.<UTC-ISO>, 超出 10 份按 mtime 删最旧的
 *
 * 依赖：FileLockProvider（构造注入）—— 保证同名文件并发写互斥
 *
 * 路径解析：调用方传**绝对路径**（LdmConfigWriter 用 pathResolver.resolveServerPath,
 * ConfigService 用 resolveInstallDir）。AtomicFileWriter 不假设任何目录结构。
 */
import fs from "fs/promises";
import path from "path";
import type { IFileLockProvider } from "@unturned-manager/shared";
import { logger } from "../../utils/logger.js";
import { AppError } from "../../utils/AppError.js";

// ─── 常量 ─────────────────────────────────────────────

/** 默认备份保留数量 */
const DEFAULT_KEEP_BACKUPS = 10;
/** 默认锁持有者标识 */
const DEFAULT_LOCK_OWNER = "AtomicFileWriter";

// ─── 类型 ─────────────────────────────────────────────

/**
 * AtomicFileWriter 写入选项。
 * @field path 目标文件**绝对路径**
 * @field content 待写入内容（字符串）
 * @field backupSuffix 自定义备份后缀（默认 `.bak.<UTC-ISO>`）
 * @field owner 锁持有者标识（默认 'AtomicFileWriter'）
 * @field keepBackups 备份保留数量（默认 10）
 */
export interface AtomicWriteOptions {
  path: string;
  content: string;
  backupSuffix?: string;
  owner?: string;
  keepBackups?: number;
}

/**
 * AtomicFileWriter 写入结果。
 * @field success 是否成功
 * @field backupPath 备份文件绝对路径（写入成功时；新文件首次写入时可能为 null——无原文件可备份）
 * @field writtenAtIso 写入时间戳（ISO 字符串）
 */
export interface AtomicWriteResult {
  success: boolean;
  backupPath: string | null;
  writtenAtIso: string;
}

// ─── 实现 ─────────────────────────────────────────────

export class AtomicFileWriter {
  /**
   * @param fileLock 文件互斥锁（同名文件并发写互斥；进程内单实例即可）
   */
  constructor(private readonly fileLock: IFileLockProvider) {}

  /**
   * 原子写：备份原文件 → 写 temp → rename → 清理旧备份。
   *
   * 失败语义：
   *   - temp 写入失败 → rename 未发生 → 抛 AppError('atomic-write-failed')，原文件保留
   *   - rename 失败 → 从 .bak 恢复 → 抛 AppError('atomic-write-failed')
   *   - 备份写入失败 → 抛 AppError('atomic-write-failed')，目标文件未触碰
   *
   * @param opts 写入选项（见 AtomicWriteOptions）
   * @returns 写入结果（备份路径 + 时间戳）
   * @throws AppError('atomic-write-failed', 500) 任意写入步骤失败
   */
  async writeFile(opts: AtomicWriteOptions): Promise<AtomicWriteResult> {
    const owner = opts.owner ?? DEFAULT_LOCK_OWNER;
    const keepBackups = opts.keepBackups ?? DEFAULT_KEEP_BACKUPS;
    const writtenAtIso = new Date().toISOString();
    // Windows 文件名不允许 `:`，把 ISO 时间戳的 `:` 替换为 `-`（同时去尾 `Z` 避免文件名歧义）
    const safeSuffix = writtenAtIso.replace(/:/g, "-").replace(/\.\d+Z$/, "Z");
    const backupSuffix = opts.backupSuffix ?? `.bak.${safeSuffix}`;

    await this.fileLock.acquire(opts.path, owner);

    let backupPath: string | null = null;
    let tempPath: string | null = null;
    try {
      // ─── 步骤 1：读原文件（如有）→ 复制为 .bak
      const originalExists = await this.fileExists(opts.path);
      if (originalExists) {
        backupPath = `${opts.path}${backupSuffix}`;
        // 用 readFile + writeFile 实现文件复制（copyFile 在 Windows 下不够可靠）
        const originalContent = await fs.readFile(opts.path, "utf-8");
        await fs.writeFile(backupPath, originalContent, "utf-8");
      }

      // ─── 步骤 2：写 temp 文件
      tempPath = `${opts.path}.tmp`;
      await fs.writeFile(tempPath, opts.content, "utf-8");

      // ─── 步骤 3：rename temp → 目标（OS 层原子）
      await fs.rename(tempPath, opts.path);
      tempPath = null; // rename 成功后 temp 路径已被消费

      // ─── 步骤 4：清理旧备份（保留最近 keepBackups 份）
      if (backupPath) {
        await this.cleanupOldBackups(opts.path, keepBackups, backupPath);
      }

      return { success: true, backupPath, writtenAtIso };
    } catch (err) {
      // ─── 失败回滚：从 .bak 恢复 + 清理 temp
      logger.error({ err, path: opts.path }, "AtomicFileWriter 写入失败，尝试回滚");
      if (tempPath) {
        await this.safeUnlink(tempPath);
      }
      if (backupPath && (await this.fileExists(opts.path))) {
        // 如果新文件已部分写入，从 .bak 恢复
        try {
          const backupContent = await fs.readFile(backupPath, "utf-8");
          await fs.writeFile(opts.path, backupContent, "utf-8");
        } catch (rollbackErr) {
          logger.error(
            { err: rollbackErr, path: opts.path, backupPath },
            "回滚也失败：原文件可能损坏",
          );
        }
      }
      throw new AppError(
        "atomic-write-failed",
        `配置文件写入失败：${err instanceof Error ? err.message : String(err)}`,
        500,
      );
    } finally {
      this.fileLock.release(opts.path, owner);
    }
  }

  // ─── 私有辅助 ──────────────────────────────────────────

  /** 检查文件是否存在（捕获 ENOENT） */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(filePath);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  /** 安全删除文件（捕获 ENOENT，不抛错） */
  private async safeUnlink(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        logger.warn({ err, path: filePath }, "safeUnlink 失败");
      }
    }
  }

  /**
   * 清理同一文件名的旧备份——保留最近 N 份，超出按 mtime 删最旧的。
   *
   * 算法：扫描同目录 .bak.* 文件 → 按 mtime desc 排序 → 保留前 N 个 → 删其余
   *
   * @param targetPath 目标文件路径（如 /opt/unturned/Servers/X/Rocket.config.xml）
   * @param keepCount 保留数量
   * @param currentBackupSuffix 当前备份后缀（避免误删本次刚生成的备份）
   */
  private async cleanupOldBackups(
    targetPath: string,
    keepCount: number,
    currentBackupSuffix: string,
  ): Promise<void> {
    const dir = path.dirname(targetPath);
    const baseName = path.basename(targetPath);
    const currentBackupPath = `${targetPath}${currentBackupSuffix}`;

    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch (err) {
      logger.warn({ err, dir }, "扫描备份目录失败");
      return;
    }

    const backupEntries = entries.filter(
      (e) => e.startsWith(`${baseName}.bak.`) && `${dir}/${e}` !== currentBackupPath,
    );

    if (backupEntries.length <= keepCount) return;

    // 按 mtime 排序
    const withMtime = await Promise.all(
      backupEntries.map(async (name) => {
        const fullPath = path.join(dir, name);
        try {
          const stat = await fs.stat(fullPath);
          return { path: fullPath, mtime: stat.mtimeMs };
        } catch {
          return { path: fullPath, mtime: 0 };
        }
      }),
    );
    withMtime.sort((a, b) => b.mtime - a.mtime); // 新的在前

    // 删超出部分
    const toDelete = withMtime.slice(keepCount);
    await Promise.all(
      toDelete.map((e) =>
        this.safeUnlink(e.path).then(() =>
          logger.debug({ path: e.path }, "清理旧备份"),
        ),
      ),
    );
  }
}