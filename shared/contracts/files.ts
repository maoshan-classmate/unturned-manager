import type { ServerId } from '../types/branded.js';
import type { FileEntry, FilePermissions } from '../types/domain.js';

/** 面板级目录浏览响应（sc:design §7.6）——entries + 上级目录 */
export interface PanelDirectoryResult {
  entries: FileEntry[];
  /** 上级目录相对 installDir 的路径；null = 已在顶层（installDir 根） */
  parentPath: string | null;
}

// 泛化可写流类型——共享层不依赖 Node stream 模块
export interface WritableFileStream {
  write(chunk: Uint8Array): void;
  end(): void;
  on(event: 'finish', callback: () => void): void;
  on(event: 'error', callback: (err: Error) => void): void;
}

export interface IFilesService {
  listDirectory(serverId: ServerId, relativePath: string): Promise<FileEntry[]>;
  /** 面板级目录浏览——不依赖具体实例，浏览 installDir 根目录（sc:design §7.6） */
  listPanelDirectory(relativePath: string): Promise<PanelDirectoryResult>;
  readFile(serverId: ServerId, relativePath: string): Promise<Uint8Array>;
  writeFile(serverId: ServerId, relativePath: string, content: Uint8Array): Promise<void>;
  deleteEntry(serverId: ServerId, relativePath: string): Promise<void>;
  createDirectory(serverId: ServerId, relativePath: string): Promise<void>;
  renameEntry(serverId: ServerId, relativePath: string, newName: string): Promise<void>;
  getPermissions(serverId: ServerId, relativePath: string): Promise<FilePermissions>;
  createUploadStream(serverId: ServerId, relativePath: string, size: number): WritableFileStream;
}
