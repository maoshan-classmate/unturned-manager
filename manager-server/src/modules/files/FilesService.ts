import fs from 'fs/promises';
import path from 'path';
import type {
  ServerId,
  IFilesService,
  IFileLockProvider,
  FileEntry,
  FilePermissions,
  WritableFileStream,
} from '@unturned-manager/shared';
import { logger } from '../../utils/logger.js';
import { resolveInstallDir } from '../server/pathResolver.js';
import { AppError } from '../../utils/AppError.js';

// ─── 常量 ────────────────────────────────────────────────

/** 路径白名单前缀（架构 spec §5.8） */
const ALLOWED_PREFIXES = [
  'Server/', 'Workshop/', 'Logs/', 'Rocket/', 'Bundles/',
];

/** 敏感字段脱敏正则（架构 spec §5.8 第 4 条） */
const REDACT_PATTERNS: Array<[RegExp, string]> = [
  [/GSLT\s+\S+/gi, 'GSLT [REDACTED]'],
  [/Password\s+\S+/gi, 'Password [REDACTED]'],
  [/Login_Token\s+\S+/gi, 'Login_Token [REDACTED]'],
  [/login\s+\S+/gi, 'login [REDACTED]'],
  [/7656119\d{10}:[^\s]+/g, 'SteamID:[REDACTED]'],
];

/** 文本文件扩展名（用于脱敏决策） */
const TEXT_EXTENSIONS = new Set([
  '.txt', '.dat', '.json', '.yaml', '.yml', '.xml', '.cfg', '.ini',
  '.log', '.csv', '.md', '.js', '.ts', '.html', '.css', '.env',
  '.sh', '.bash', '.config', '.conf',
]);

// ─── 实现 ────────────────────────────────────────────────

export class FilesService implements IFilesService {
  constructor(
    private fileLock: IFileLockProvider,
  ) {}

  // ── 路径解析 + 安全校验 ──────────────────────────────

  /** 安全路径校验：realpath + 白名单前缀 + 防穿越 */
  private async validatePath(
    serverId: ServerId,
    relativePath: string,
  ): Promise<string> {
    // 禁止非法字符
    if (relativePath.includes('\x00') || relativePath.includes('..')) {
      throw new AppError('path_invalid', '路径包含非法字符', 403);
    }

    const installDir = resolveInstallDir();
    const baseDir = path.join(installDir, 'Servers', serverId);
    const absPath = path.resolve(baseDir, relativePath);

    // 前缀校验
    if (!absPath.startsWith(path.resolve(baseDir))) {
      throw new AppError('path_forbidden', '路径越界', 403);
    }

    // realpath 解析（文件不存在时跳过——用于 write/create 操作）
    try {
      const real = await fs.realpath(absPath);
      if (!real.startsWith(path.resolve(baseDir))) {
        throw new AppError('path_forbidden', '符号链接越界', 403);
      }
      return real;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return absPath; // 文件不存在，允许后续创建
      }
      throw err;
    }
  }

  // ── 文件/目录操作 ─────────────────────────────────────

  async listDirectory(serverId: ServerId, relativePath: string): Promise<FileEntry[]> {
    const absPath = await this.validatePath(serverId, relativePath || '.');

    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(absPath, { withFileTypes: true });
    } catch {
      logger.warn({ serverId, relativePath }, '目录不存在');
      return [];
    }

    const results: FileEntry[] = [];
    for (const entry of entries) {
      const entryPath = path.join(relativePath, entry.name);
      let stat: { size: number; mtime: Date };
      try {
        stat = await fs.stat(path.join(absPath, entry.name));
      } catch {
        stat = { size: 0, mtime: new Date(0) };
      }

      results.push({
        name: entry.name,
        path: entryPath.replace(/\\/g, '/'),
        isDirectory: entry.isDirectory(),
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      });
    }

    // 目录优先，字母排序
    results.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return results;
  }

  async readFile(serverId: ServerId, relativePath: string): Promise<Uint8Array> {
    const absPath = await this.validatePath(serverId, relativePath);
    const buffer = await fs.readFile(absPath);

    // 文本文件脱敏
    if (this.isTextFile(relativePath)) {
      let text = buffer.toString('utf-8');
      text = this.redactSensitive(text);
      return new TextEncoder().encode(text);
    }

    return new Uint8Array(buffer);
  }

  async writeFile(serverId: ServerId, relativePath: string, content: Uint8Array): Promise<void> {
    const absPath = await this.validatePath(serverId, relativePath);

    await this.fileLock.acquire(absPath, 'FilesService');
    try {
      const tmpPath = absPath + '.tmp.' + Date.now();
      await fs.writeFile(tmpPath, content);
      await fs.rename(tmpPath, absPath);
      logger.info({ serverId, relativePath }, '文件已写入');
    } finally {
      this.fileLock.release(absPath, 'FilesService');
    }
  }

  async deleteEntry(serverId: ServerId, relativePath: string): Promise<void> {
    const absPath = await this.validatePath(serverId, relativePath);

    const stat = await fs.stat(absPath);
    if (stat.isDirectory()) {
      await fs.rm(absPath, { recursive: true });
    } else {
      await fs.unlink(absPath);
    }
    logger.info({ serverId, relativePath }, '已删除');
  }

  async createDirectory(serverId: ServerId, relativePath: string): Promise<void> {
    const absPath = await this.validatePath(serverId, relativePath);
    await fs.mkdir(absPath, { recursive: true });
    logger.info({ serverId, relativePath }, '目录已创建');
  }

  async renameEntry(serverId: ServerId, relativePath: string, newName: string): Promise<void> {
    const absPath = await this.validatePath(serverId, relativePath);
    const dir = path.dirname(absPath);
    const newPath = path.join(dir, newName);

    // 校验新路径仍在白名单内
    const baseDir = path.resolve(resolveInstallDir(), 'Servers', serverId);
    if (!path.resolve(newPath).startsWith(baseDir)) {
      throw new AppError('path_forbidden', '重命名目标越界', 403);
    }

    await fs.rename(absPath, newPath);
    logger.info({ serverId, from: relativePath, to: newName }, '已重命名');
  }

  async getPermissions(serverId: ServerId, relativePath: string): Promise<FilePermissions> {
    const absPath = await this.validatePath(serverId, relativePath);
    try {
      await fs.access(absPath, fs.constants.R_OK | fs.constants.W_OK);
      return { owner: 'write', group: 'read', other: 'read' };
    } catch {
      try {
        await fs.access(absPath, fs.constants.R_OK);
        return { owner: 'read', group: 'read', other: 'none' };
      } catch {
        return { owner: 'none', group: 'none', other: 'none' };
      }
    }
  }

  createUploadStream(_serverId: ServerId, _relativePath: string, _size: number): WritableFileStream {
    // Sprint 2: 暂不实现分块上传
    throw new AppError('not_implemented', '分块上传将在后续 Sprint 实现', 501);
  }

  // ── 脱敏 ──────────────────────────────────────────────

  private redactSensitive(content: string): string {
    for (const [pattern, replacement] of REDACT_PATTERNS) {
      content = content.replace(pattern, replacement);
    }
    return content;
  }

  private isTextFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    if (TEXT_EXTENSIONS.has(ext)) return true;
    // 无扩展名大概率是文本（如 Commands.dat、Adminlist.dat）
    if (!ext) return true;
    return false;
  }
}
