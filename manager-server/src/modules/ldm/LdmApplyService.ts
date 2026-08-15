/**
 * LdmApplyService——LDM 配置变更应用服务（Phase 2b 薄业务层）。
 *
 * 职责：调 ServerManager.applyChangesCore（与 mod_apply 共用流水线本体），
 *       期间推 WS `ldm_apply_progress` 事件 + 启动后 PTY 写 `/p reload`（D4）。
 *
 * 与 LdmConfigWriter 的关系（用户 2026-08-15 拍板）：
 *   - LdmConfigWriter 写文件（保存配置）—— 文件 I/O 不阻断 ServerManager
 *   - LdmApplyService 调 applyChangesCore（应用配置）—— 触发 PTY 重启流水线
 *   - **两动作完全解耦**：用户可保存后选择稍后重启，也可保存前先重启
 *
 * WS 推送阶段（stages）：
 *   - preparing → 用户触发 apply，等待 preStopHook
 *   - stopping → applyChangesCore 内部 stopInternal（不发 — 走通用 state_change）
 *   - starting → applyChangesCore 内部 startInternal（不发 — 走通用 state_change）
 *   - verifying → postStartHook 推 /p reload
 *   - ready → 全部完成
 *   - failed → 任何步骤抛错
 *
 * @see docs/architecture/ldm-phase2-design.md §4.1
 */
import type {
  IBroadcaster,
  ILdmApplyService,
  ILdmPluginCommandsService,
  IServerManager,
  LdmApplyResult,
  ServerId,
} from "@unturned-manager/shared";
import { AppError } from "../../utils/AppError.js";
import { logger } from "../../utils/logger.js";

// ─── 实现 ─────────────────────────────────

export class LdmApplyService implements ILdmApplyService {
  /**
   * @param serverManager 实例管理（applyChangesCore 本体所在）
   * @param pluginCommands PTY 命令服务（D4 /p reload 重载权限）
   * @param broadcaster WS 广播（推送 ldm_apply_progress 阶段）
   */
  constructor(
    private readonly serverManager: IServerManager,
    private readonly pluginCommands: ILdmPluginCommandsService,
    private readonly broadcaster: IBroadcaster,
  ) {}

  async apply(
    serverId: ServerId,
    opts?: { changedPlugins?: string[] },
  ): Promise<LdmApplyResult> {
    const startedAtIso = new Date().toISOString();
    const changedPlugins = opts?.changedPlugins ?? [];
    logger.info(
      { serverId, changedPlugins },
      "LdmApplyService.apply 开始",
    );

    /** 推 WS ldm_apply_progress 进度 */
    const pushStage = (
      stage: LdmApplyResult["stage"],
      percent?: number,
      errorMessage?: string,
    ): void => {
      this.broadcaster.broadcast({
        type: "ldm_apply_progress",
        serverId,
        stage,
        percent,
        errorMessage,
      });
    };

    try {
      pushStage("preparing", 0);

      await this.serverManager.applyChangesCore(serverId, {
        hook: "ldm_apply",
        preStopHook: async () => {
          // preStopHook 在 stopInternal 之前触发
          // preparing 阶段已推；无需额外动作
        },
        postStartHook: async () => {
          // postStartHook 在 startInternal 之后触发（PTY 已 spawn）
          pushStage("verifying", 90);
          try {
            // D4：调 /p reload 触发 LDM 权限重载（Permissions.config.xml 变更后必走）
            await this.pluginCommands.reloadPermissions(serverId);
            pushStage("ready", 100);
            logger.info(
              { serverId, changedPlugins },
              "LdmApplyService.apply 完成",
            );
          } catch (reloadErr) {
            // /p reload 失败仅记录——实例已启动不能让 UI 以为失败
            logger.error(
              { err: reloadErr, serverId },
              "/p reload 失败——实例已运行但权限配置未重载；用户可在控制台手动 /p reload",
            );
          }
        },
      });

      const completedAtIso = new Date().toISOString();
      pushStage("ready", 100);

      return {
        serverId,
        success: true,
        stage: "ready",
        startedAtIso,
        completedAtIso,
      };
    } catch (err) {
      const completedAtIso = new Date().toISOString();
      pushStage("failed", undefined, err instanceof Error ? err.message : String(err));
      logger.error(
        { err, serverId, changedPlugins },
        "LdmApplyService.apply 失败",
      );
      if (err instanceof AppError) throw err;
      throw new AppError(
        "ldm-apply-failed",
        `LDM 配置应用失败：${err instanceof Error ? err.message : String(err)}`,
        500,
      );
    }
  }
}