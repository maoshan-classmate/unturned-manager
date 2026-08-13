import fs from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { STEAM_APP_IDS } from "@unturned-manager/shared";
import type {
  ServerId,
  WorkshopFileId,
  IWorkshopApplyService,
  IWorkshopAcfService,
  IConfigService,
  IBroadcaster,
} from "@unturned-manager/shared";
import { logger } from "../../utils/logger.js";
import {
  resolveInstallDir,
  resolveServerPath,
} from "../server/pathResolver.js";

const execFileAsync = promisify(execFile);

// AppID 唯一真源 = shared/constants.ts STEAM_APP_IDS.UNTURNED_GAME=304930

/** staging acf 内容目录（SteamCMD 下载后落点——保持原样，SteamCMD 自动生成此结构） */
const STAGING_CONTENT_SUBDIR = path.join(
  "Workshop",
  "staging",
  "steamapps",
  "workshop",
  "content",
  STEAM_APP_IDS.UNTURNED_GAME,
);

/**
 * content acf 内容目录（U3DS 启动读取）。
 * ★ BUG-3 修复：U3-SDK `DedicatedUGC.cs:560-567` 用 `Workshop/Steam/steamapps/workshop/content/304930/`。
 * 旧实现缺 `Steam/` 层，U3DS 扫不到 → 客户端显示「创意工坊：禁用」。
 */
const CONTENT_SUBDIR = path.join(
  "Workshop",
  "Steam",
  "steamapps",
  "workshop",
  "content",
  STEAM_APP_IDS.UNTURNED_GAME,
);

// v2.6：WORKSHOP_CONFIG_REL 已废弃——本服务不再触碰 WorkshopDownloadConfig.json。
// 保留注释以便回溯（写入已迁至 PUT /api/servers/:id/config/workshop）。

/**
 * staging → content 移动服务——在 ServerManager.startInternal 顶部、U3DS STOPPED 时调用。
 *
 * v2.6 设计：保存与重启解耦——「写 File_IDs」走 PUT /config/workshop；本服务只负责
 * 把已下载到 staging 的 Mod 文件移进 content/304930/，让 U3DS 下次启动读到。任一失败
 * 上抛阻止 spawn 老进程。
 *
 * 4 步流程：
 *  1. 解析 staging acf → 拿 mod 元数据
 *  2. acf.addItem（每个新 mod，addItem 内部自带备份 + 回滚）
 *  3. mv staging/content/<id>/ → content/<id>/
 *  4. 失败 → 回滚 acf（addItem 内部），不碰 WorkshopDownloadConfig.json
 *
 * 不再负责：
 *  - 写 File_IDs（改由 ConfigService.writeWorkshopFileIds 在「保存 Mod」调用）
 *  - 备份 WorkshopDownloadConfig.json（本服务不再触碰 config）
 */
export class WorkshopApplyService implements IWorkshopApplyService {
  constructor(
    private acfService: IWorkshopAcfService,
    // v2.6：构造签名保留 configService 以备未来扩展，但 applyStaged 不再调用其任何方法
    _configService: IConfigService,
    private broadcaster: IBroadcaster,
  ) {}

  async applyStaged(serverId: ServerId): Promise<void> {
    // 启动前先读已有 content acf——决定哪些 fileId 是「新增」的（避免重复 addItem）
    const acfItems = await this.acfService.listItems(serverId);

    // 解析 staging acf → 拿所有 mod 元数据；空则整步跳过（无需移动、无需广播）
    const { acf: stagingAcf } = await this.parseStagingAcf(serverId);
    if (stagingAcf.items.size === 0) {
      logger.info({ serverId }, "staging acf 为空，跳过移动");
      return;
    }

    try {
      // ① acf.addItem（每个新 mod）——先 addItem 全部，再 mv
      for (const [fileId, item] of stagingAcf.items) {
        if (!acfItems.some((existing) => existing.fileId === fileId)) {
          await this.acfService.addItem(
            serverId,
            fileId as WorkshopFileId,
            item,
          );
          logger.info(
            { serverId, fileId, size: item.size },
            "staging mod → content acf",
          );
        }
      }

      // ② mv staging/content/<id>/ → content/<id>/
      const { stagingDir, contentDir } = await this.resolvePaths(serverId);
      for (const fileId of stagingAcf.items.keys()) {
        const src = path.join(stagingDir, fileId);
        const dst = path.join(contentDir, fileId);
        await this.moveDir(src, dst);
        logger.info({ serverId, fileId }, "staging content → content");
      }

      this.broadcaster.broadcast({
        type: "mod_apply_progress",
        serverId,
        stage: "ready",
        message: `${stagingAcf.items.size} 个 mod 已移动到 content`,
      } as never);

      logger.info(
        { serverId, count: stagingAcf.items.size },
        "staging → content 移动完成",
      );
    } catch (err) {
      // ③ 失败：acf 备份由 addItem 内部已处理；本服务不再回滚 WorkshopDownloadConfig.json
      logger.error({ err, serverId }, "staging → content 移动失败");
      this.broadcaster.broadcast({
        type: "mod_apply_progress",
        serverId,
        stage: "failed",
        message: err instanceof Error ? err.message : "unknown",
      } as never);
      throw err;
    }
  }

  // ── 私有 ────────────────────────────────────────────

  /**
   * 读 staging acf → 直接解析（不经过 AcfService，因为 staging 路径不同）
   */
  private async parseStagingAcf(serverId: ServerId): Promise<{
    acf: {
      items: Map<
        string,
        {
          fileId: WorkshopFileId;
          timeupdated: number;
          size: number;
          manifest?: string;
        }
      >;
    };
  }> {
    // 收集所有 staging 中已下载的 mod（acf 给元数据 + content/ 目录给存在性）
    const { stagingDir, installDir } = await this.resolvePaths(serverId);
    const stagingAcfPath = path.join(
      installDir,
      "Servers",
      serverId,
      "Workshop",
      "staging",
      "steamapps",
      "workshop",
      `appworkshop_${STEAM_APP_IDS.UNTURNED_GAME}.acf`,
    );

    let content: string;
    try {
      content = await fs.readFile(stagingAcfPath, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { acf: { items: new Map() } };
      }
      throw err;
    }

    // 复用 VdfParser 解析
    const { parseVdf } = await import("./VdfParser.js");
    const parsed = parseVdf(content);
    const root = parsed.AppWorkshop as Record<string, unknown> | undefined;
    const installed = (root?.WorkshopItemsInstalled ?? {}) as Record<
      string,
      Record<string, string>
    >;
    const items = new Map<
      WorkshopFileId,
      {
        fileId: WorkshopFileId;
        timeupdated: number;
        size: number;
        manifest?: string;
      }
    >();
    for (const [fileId, meta] of Object.entries(installed)) {
      // 仅保留 content/ 目录里真正存在的（避免 acf 残留）
      try {
        await fs.access(path.join(stagingDir, fileId));
      } catch {
        continue;
      }
      const timeupdated = parseInt(meta.timeupdated ?? "0", 10);
      const size = parseInt(meta.size ?? "0", 10);
      const manifest = meta.manifest;
      items.set(fileId as WorkshopFileId, {
        fileId: fileId as WorkshopFileId,
        timeupdated: Number.isFinite(timeupdated) ? timeupdated : 0,
        size: Number.isFinite(size) ? size : 0,
        ...(typeof manifest === "string" ? { manifest } : {}),
      });
    }
    return { acf: { items } };
  }

  /**
   * 跨设备的目录移动：先尝试 rename，失败降级 cp -r + rm
   */
  private async moveDir(src: string, dst: string): Promise<void> {
    // 如果 dst 已存在，先删（U3DS 内容目录是 mod 的数据目录，不存在冲突）
    if (await this.fileExists(dst)) {
      await fs.rm(dst, { recursive: true, force: true });
    }
    try {
      await fs.rename(src, dst);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EXDEV") throw err;
      // 跨设备降级
      await execFileAsync("cp", ["-r", src, dst]);
      await fs.rm(src, { recursive: true, force: true });
    }
  }

  private async fileExists(p: string): Promise<boolean> {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 拼 staging / content 绝对路径（ADR-0003 / T2：真源 = config.installDir 全局）
   */
  private resolvePaths(serverId: ServerId): {
    installDir: string;
    stagingDir: string;
    contentDir: string;
  } {
    return {
      installDir: resolveInstallDir(),
      stagingDir: resolveServerPath(serverId, STAGING_CONTENT_SUBDIR),
      contentDir: resolveServerPath(serverId, CONTENT_SUBDIR),
    };
  }
}