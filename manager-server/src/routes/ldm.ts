/**
 * LDM Mod 框架路由——已装插件 / 配置读写 / 应用变更端点。
 *
 * 挂载：/api/servers/:id/ldm/...   →  createLdmServerRouter（discovery + commands + config writer）
 *
 * 依赖通过 composition-root 注入（DI 容器）。
 */
import fs from "fs/promises";
import { Router } from "express";
import path from "path";
import {
  PluginCommandRequestSchema,
  PluginConfigWriteSchema,
  RocketConfigWriteSchema,
  RocketUnturnedConfigWriteSchema,
  PermissionsConfigWriteSchema,
  ReloadPluginSchema,
  PluginSearchQuerySchema,
  type ILdmApplyService,
  type ILdmDiscoveryService,
  type ILdmPluginCommandsService,
  type ILdmConfigWriter,
  type ILdmConfigReader,
  type ServerId,
  type PluginRuntimeStatus,
} from "@unturned-manager/shared";
import { authenticateToken } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { AppError } from "../utils/AppError.js";
import { resolveServerPath } from "../modules/server/pathResolver.js";
import { logger } from "../utils/logger.js";

// ─── 服务端路由（per-server）───────────────────────────────

/**
 * 服务端 LDM 路由：/api/servers/:id/ldm ...
 *
 * - GET    /installed                                  列出已装插件
 * - POST   /load-plugin                                加载插件（PTY 写 /rocket load）
 * - POST   /unload-plugin                              卸载插件（PTY 写 /rocket unload）
 * - GET    /plugins/:name/config                       读单个 Configuration.xml
 * - PUT    /plugins/:name/config                       写 Configuration.xml
 * - PUT    /rocket-config                              写 Rocket.config.xml（结构化）
 * - PUT    /permissions-config                         写 Permissions.config.xml（树形）
 */
export function createLdmServerRouter(deps: {
  discovery: ILdmDiscoveryService;
  commands: ILdmPluginCommandsService;
  configWriter: ILdmConfigWriter;
  configReader: ILdmConfigReader;
  applyService: ILdmApplyService;
}): Router {
  const router = Router({ mergeParams: true });
  router.use(authenticateToken);

  // GET /installed
  router.get(
    "/installed",
    asyncHandler(async (req, res) => {
      const serverId = req.params.id as string;
      if (!serverId) throw new AppError("server-id-missing", "实例 ID 缺失", 400);
      const result = await deps.discovery.listInstalledPlugins(serverId as ServerId);
      res.json({
        data: {
          serverId,
          plugins: result.plugins,
          ldmNotDetected: result.ldmNotDetected,
          detectedAtIso: new Date().toISOString(),
        },
      });
    }),
  );

  // GET /status — LDM 统一状态（）——前端「LDM 状态」卡用
  router.get(
    "/status",
    asyncHandler(async (req, res) => {
      const serverId = req.params.id as string;
      if (!serverId) throw new AppError("server-id-missing", "实例 ID 缺失", 400);
      const status = await deps.discovery.getStatus(serverId as ServerId);
      res.json({ data: status });
    }),
  );

  // GET /version — LDM 主框架版本（）——前端「关于 LDM」卡用
  // 服务端必须 RUNNING 才能调 PTY；非 RUNNING 时 commands.readLdmVersion 抛 server-not-running 409
  router.get(
    "/version",
    asyncHandler(async (req, res) => {
      const serverId = req.params.id as string;
      if (!serverId) throw new AppError("server-id-missing", "实例 ID 缺失", 400);
      const info = await deps.commands.readLdmVersion(serverId as ServerId);
      res.json({ data: { serverId, ...info } });
    }),
  );

  // GET /modules-state — Rocket.Unturned 模块加载状态（）——前端「关于 LDM」卡用
  // 服务端必须 RUNNING；非 RUNNING 时 commands.readModulesState 抛 server-not-running 409
  router.get(
    "/modules-state",
    asyncHandler(async (req, res) => {
      const serverId = req.params.id as string;
      if (!serverId) throw new AppError("server-id-missing", "实例 ID 缺失", 400);
      const state = await deps.commands.readModulesState(serverId as ServerId);
      res.json({ data: { serverId, ...state } });
    }),
  );

  // ─── Phase 4a 端点 ────────────────────────────────────────

  // POST /reload-plugin — 单插件 reload（B4，**不保证成功**，前端二级确认）
  router.post(
    "/reload-plugin",
    validate(ReloadPluginSchema, "body"),
    asyncHandler(async (req, res) => {
      const serverId = req.params.id as string;
      if (!serverId) throw new AppError("server-id-missing", "实例 ID 缺失", 400);
      const { pluginName } = req.body as { pluginName: string };
      const result = await deps.commands.reloadPlugin(serverId as ServerId, pluginName);
      res.json({
        data: {
          serverId,
          pluginName,
          outcome: result.outcome,
          ldmOutput: result.ldmOutput,
        },
      });
    }),
  );

  // ─── Phase 4b 端点 ────────────────────────────────────────

  // GET /plugins/search?query=&status= — 插件搜索/筛选
  router.get(
    "/plugins/search",
    asyncHandler(async (req, res) => {
      const serverId = req.params.id as string;
      if (!serverId) throw new AppError("server-id-missing", "实例 ID 缺失", 400);
      // Zod 校验 query 参数
      const parsed = PluginSearchQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError(
          "status-invalid",
          `搜索参数非法：${parsed.error.issues.map((i) => i.message).join("; ")}`,
          400,
        );
      }
      const { query, status } = parsed.data;
      const result = await deps.discovery.searchPlugins(serverId as ServerId, {
        query,
        status: status as PluginRuntimeStatus | null,
      });
      res.json({ data: result });
    }),
  );

  // POST /load-plugin
  router.post(
    "/load-plugin",
    validate(PluginCommandRequestSchema, "body"),
    asyncHandler(async (req, res) => {
      const serverId = req.params.id as string;
      if (!serverId) throw new AppError("server-id-missing", "实例 ID 缺失", 400);
      const { pluginName } = req.body as { pluginName: string };
      const result = await deps.commands.loadPlugin(serverId as ServerId, pluginName);
      res.json({
        data: {
          serverId,
          pluginName,
          outcome: result.outcome,
          ldmOutput: result.ldmOutput,
        },
      });
    }),
  );

  // POST /unload-plugin
  router.post(
    "/unload-plugin",
    validate(PluginCommandRequestSchema, "body"),
    asyncHandler(async (req, res) => {
      const serverId = req.params.id as string;
      if (!serverId) throw new AppError("server-id-missing", "实例 ID 缺失", 400);
      const { pluginName } = req.body as { pluginName: string };
      const result = await deps.commands.unloadPlugin(serverId as ServerId, pluginName);
      res.json({
        data: {
          serverId,
          pluginName,
          outcome: result.outcome,
          ldmOutput: result.ldmOutput,
        },
      });
    }),
  );

  // ─── Phase 2a 配置写入端点 ─────────────────────────────────

  // GET /plugins/:name/config — 读单个 Configuration.xml 原文
  router.get(
    "/plugins/:name/config",
    asyncHandler(async (req, res) => {
      const serverId = req.params.id as string;
      if (!serverId) throw new AppError("server-id-missing", "实例 ID 缺失", 400);
      const pluginName = (req.params.name as string | undefined) ?? "";
      if (!pluginName)
        throw new AppError("plugin-name-missing", "插件名缺失", 400);

      // 插件名合法字符校验（与 writer 一致）
      if (!/^[A-Za-z0-9._-]+$/.test(pluginName)) {
        throw new AppError(
          "plugin-name-invalid",
          `插件名含非法字符：${pluginName}`,
          400,
        );
      }

      const filePath = resolveServerPath(
        serverId as ServerId,
        path.join("Rocket", "Plugins", pluginName, `${pluginName}.configuration.xml`),
      );

      try {
        const raw = await fs.readFile(filePath, "utf-8");
        const stat = await fs.stat(filePath);
        res.json({
          data: {
            name: pluginName,
            raw,
            sizeBytes: stat.size,
            modifiedAtIso: stat.mtime.toISOString(),
          },
        });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          throw new AppError(
            "plugin-config-not-found",
            `插件 ${pluginName} 配置不存在（${pluginName}.configuration.xml 未找到）`,
            404,
          );
        }
        throw new AppError(
          "ldm-config-read-failed",
          `读取插件配置失败：${err instanceof Error ? err.message : String(err)}`,
          500,
        );
      }
    }),
  );

  // PUT /plugins/:name/config — 写 Configuration.xml（通用 XML 原文）
  router.put(
    "/plugins/:name/config",
    validate(PluginConfigWriteSchema, "body"),
    asyncHandler(async (req, res) => {
      const serverId = req.params.id as string;
      if (!serverId) throw new AppError("server-id-missing", "实例 ID 缺失", 400);
      const pluginName = (req.params.name as string | undefined) ?? "";
      if (!pluginName) throw new AppError("plugin-name-missing", "插件名缺失", 400);
      const { raw } = req.body as { raw: string };

      try {
        const result = await deps.configWriter.writePluginConfig(
          serverId as ServerId,
          pluginName,
          raw,
        );
        logger.info(
          { serverId, pluginName, sizeBytes: result.backupPath.length },
          "PUT /plugins/:name/config 成功",
        );
        res.json({
          data: {
            serverId,
            pluginName,
            success: result.success,
            backupPath: result.backupPath,
            writtenAtIso: result.writtenAtIso,
          },
        });
      } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError(
          "ldm-config-write-failed",
          `写插件配置失败：${err instanceof Error ? err.message : String(err)}`,
          500,
        );
      }
    }),
  );

  // PUT /rocket-config — 写 Rocket.config.xml（结构化字段）
  router.put(
    "/rocket-config",
    validate(RocketConfigWriteSchema, "body"),
    asyncHandler(async (req, res) => {
      const serverId = req.params.id as string;
      if (!serverId) throw new AppError("server-id-missing", "实例 ID 缺失", 400);
      const fields = req.body as Parameters<ILdmConfigWriter["writeRocketConfig"]>[1];

      const result = await deps.configWriter.writeRocketConfig(
        serverId as ServerId,
        fields,
      );
      res.json({
        data: {
          serverId,
          file: "Rocket.config.xml",
          success: result.success,
          backupPath: result.backupPath,
          writtenAtIso: result.writtenAtIso,
        },
      });
    }),
  );

  // PUT /rocket-unturned-config — 写 Rocket.Unturned.config.xml（9 字段）
  router.put(
    "/rocket-unturned-config",
    validate(RocketUnturnedConfigWriteSchema, "body"),
    asyncHandler(async (req, res) => {
      const serverId = req.params.id as string;
      if (!serverId) throw new AppError("server-id-missing", "实例 ID 缺失", 400);
      const fields = req.body as Parameters<ILdmConfigWriter["writeRocketUnturnedConfig"]>[1];

      const result = await deps.configWriter.writeRocketUnturnedConfig(
        serverId as ServerId,
        fields,
      );
      res.json({
        data: {
          serverId,
          file: "Rocket.Unturned.config.xml",
          success: result.success,
          backupPath: result.backupPath,
          writtenAtIso: result.writtenAtIso,
        },
      });
    }),
  );

  // PUT /permissions-config — 写 Permissions.config.xml（树形）
  router.put(
    "/permissions-config",
    validate(PermissionsConfigWriteSchema, "body"),
    asyncHandler(async (req, res) => {
      const serverId = req.params.id as string;
      if (!serverId) throw new AppError("server-id-missing", "实例 ID 缺失", 400);
      const fields = req.body as Parameters<ILdmConfigWriter["writePermissionsConfig"]>[1];

      const result = await deps.configWriter.writePermissionsConfig(
        serverId as ServerId,
        fields,
      );
      res.json({
        data: {
          serverId,
          file: "Permissions.config.xml",
          success: result.success,
          backupPath: result.backupPath,
          writtenAtIso: result.writtenAtIso,
        },
      });
    }),
  );

  // ─── （编辑器配套）配置读取端点 ─────────────────────

  // GET /rocket-config — 读 Rocket.config.xml（16 字段结构化 + 原文）
  router.get(
    "/rocket-config",
    asyncHandler(async (req, res) => {
      const serverId = req.params.id as string;
      if (!serverId) throw new AppError("server-id-missing", "实例 ID 缺失", 400);
      const result = await deps.configReader.readRocketConfig(serverId as ServerId);
      res.json({ data: result });
    }),
  );

  // GET /rocket-unturned-config — 读 Rocket.Unturned.config.xml（9 字段结构化 + 原文）
  router.get(
    "/rocket-unturned-config",
    asyncHandler(async (req, res) => {
      const serverId = req.params.id as string;
      if (!serverId) throw new AppError("server-id-missing", "实例 ID 缺失", 400);
      const result = await deps.configReader.readRocketUnturnedConfig(serverId as ServerId);
      res.json({ data: result });
    }),
  );

  // GET /permissions-config — 读 Permissions.config.xml（树形结构 + 原文）
  router.get(
    "/permissions-config",
    asyncHandler(async (req, res) => {
      const serverId = req.params.id as string;
      if (!serverId) throw new AppError("server-id-missing", "实例 ID 缺失", 400);
      const result = await deps.configReader.readPermissionsConfig(serverId as ServerId);
      res.json({ data: result });
    }),
  );

  // ─── Phase 2b 应用变更端点 ─────────────────────────────────────

  // POST /apply — 应用 LDM 配置变更（走 PTY 重启流水线）
  router.post(
    "/apply",
    asyncHandler(async (req, res) => {
      const serverId = req.params.id as string;
      if (!serverId) throw new AppError("server-id-missing", "实例 ID 缺失", 400);
      const { changedPlugins } = (req.body ?? {}) as {
        changedPlugins?: string[];
      };

      const result = await deps.applyService.apply(
        serverId as ServerId,
        changedPlugins ? { changedPlugins } : undefined,
      );
      res.json({ data: result });
    }),
  );

  return router;
}