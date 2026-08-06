export interface IFileLockProvider {
  acquire(path: string, owner: string, timeoutMs?: number): Promise<void>;
  release(path: string, owner: string): void;
  isLocked(path: string): boolean;
}
