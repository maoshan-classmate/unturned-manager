/**
 * LDM Mod 框架路由——Phase 1 + Phase 2a 端点。
 *
 * 挂载：
 *   - /api/servers/:id/ldm/...   →  createLdmServerRouter（discovery + commands + config writer）
 *   - /api/ldm/...               →  createLdmCommunityRouter（community + PAT test）
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
  PermissionsConfigWriteSchema,
  ReloadPluginSchema,
  PluginSearchQuerySchema,
  type ILdmApplyService,
  type ILdmDiscoveryService,
  type ILdmPluginCommandsService,
  type ILdmPluginSourceService,
  type ILdmConfigWriter,
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

  // GET /status — LDM 统一状态（Phase 3）——前端「LDM 状态」卡用
  router.get(
    "/status",
    asyncHandler(async (req, res) => {
      const serverId = req.params.id as string;
      if (!serverId) throw new AppError("server-id-missing", "实例 ID 缺失", 400);
      const status = await deps.discovery.getStatus(serverId as ServerId);
      res.json({ data: status });
    }),
  );

  // GET /version — LDM 主框架版本（Phase 3-3 D2）——前端「关于 LDM」卡用
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

  // GET /modules-state — Rocket.Unturned 模块加载状态（Phase 3-3 D3）——前端「关于 LDM」卡用
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

// ─── 全局路由（community / PAT）───────────────────────────

/**
 * 全局 LDM 路由：/api/ldm ...
 *
 * - GET  /community-plugins      拉取 LDM-Community 列表
 * - POST /community-plugins/test-pat  测试 GitHub PAT
 */
export function createLdmCommunityRouter(svc: ILdmPluginSourceService): Router {
  const router = Router();
  router.use(authenticateToken);

  // GET /community-plugins
  router.get(
    "/community-plugins",
    asyncHandler(async (req, res) => {
      // PAT 从 header 读（X-Github-Pat）—— 不入 store，仅当前请求使用
      const pat = (req.headers["x-github-pat"] as string | undefined) ?? null;
      const result = await svc.listCommunityPlugins(pat);
      res.json({ data: result });
    }),
  );

  // POST /community-plugins/test-pat
  router.post(
    "/community-plugins/test-pat",
    asyncHandler(async (req, res) => {
      const { pat } = req.body as { pat: string };
      const result = await svc.testPat(pat);
      res.json({ data: result });
    }),
  );

  // GET /community-plugins/:owner/:repo — 详情页（Phase 3）——前端详情抽屉用
  // 注意：Express `:slug` 不匹配 `/`，改用 `:owner/:repo` 两段参数
  router.get(
    "/community-plugins/:owner/:repo",
    asyncHandler(async (req, res) => {
      const owner = req.params.owner as string | undefined;
      const repo = req.params.repo as string | undefined;
      if (!owner || !repo) {
        throw new AppError(
          "plugin-slug-invalid",
          `插件 slug 格式错误（需 owner/repo）：${owner ?? ""}/${repo ?? ""}`,
          400,
        );
      }
      const slug = `${owner}/${repo}`;
      const pat = (req.headers["x-github-pat"] as string | undefined) ?? null;
      const detail = await svc.getPluginDetail(slug, pat);
      if (!detail) {
        throw new AppError(
          "plugin-detail-not-found",
          `未找到插件 ${slug}（LDM-Community 列表中无此条目）`,
          404,
        );
      }
      res.json({ data: detail });
    }),
  );

  return router;
}