import type { IFileLockProvider } from '@unturned-manager/shared';
import { logger } from '../../utils/logger.js';

interface LockEntry {
  owner: string;
  acquiredAt: number;
}

/**
 * 进程内文件级互斥锁注册表。
 *
 * ConfigService 和 FilesService 共享同一实例，按文件路径互斥。
 * v1 仅进程内互斥（单进程 Express），不需要跨进程锁。
 */
export class FileLockProvider implements IFileLockProvider {
  private locks = new Map<string, LockEntry>();

  async acquire(path: string, owner: string, timeoutMs = 10_000): Promise<void> {
    const start = Date.now();

    while (this.locks.has(path)) {
      if (Date.now() - start >= timeoutMs) {
        const holder = this.locks.get(path)!;
        logger.warn(
          { path, owner, holder: holder.owner, elapsed: Date.now() - start },
          '文件锁获取超时',
        );
        throw new Error(
          `文件锁获取超时: ${path} 被 ${holder.owner} 持有 ${Date.now() - holder.acquiredAt}ms`,
        );
      }
      // 轮询间隔 50ms，避免 CPU 空转
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    this.locks.set(path, { owner, acquiredAt: Date.now() });
  }

  release(path: string, owner: string): void {
    const entry = this.locks.get(path);
    if (!entry) {
      return; // 幂等：锁不存在，不报错
    }
    if (entry.owner !== owner) {
      logger.warn(
        { path, owner, holder: entry.owner },
        '尝试释放非自己持有的文件锁',
      );
      return; // 不抛异常，但也不释放（防止误释放他人的锁）
    }
    this.locks.delete(path);
  }

  isLocked(path: string): boolean {
    return this.locks.has(path);
  }
}
