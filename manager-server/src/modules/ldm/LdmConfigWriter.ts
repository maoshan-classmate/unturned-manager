/**
 * LdmConfigWriter——LDM 配置文件写入服务（Phase 2a 落地）。
 *
 * 职责：把结构化字段（或通用 XML 原文）写入 Rocket/Plugins 配置目录。
 * 流程：字段合并 → XML 字符串 → AtomicFileWriter 原子写（备份 + 回滚）。
 *
 * 写配置运行时允许（不强制 STOPPED）；
 * 生效需用户主动触发「应用变更」走 PTY 重启流水线（设计文档 §1.2 钉死边界）。
 *
 * 路径解析：复用 `server/pathResolver.resolveServerPath` —— 不假设任何目录结构。
 * 原子写 + 备份 + 回滚：复用 `filelock/AtomicFileWriter`（与 ConfigService 共享）。
 * 字段合并 / 序列化：复用 `RocketConfigXmlParser`（保留注释 / CDATA / 嵌套 / 未知键）。
 *
 * @see docs/architecture/ldm-phase2-design.md §3.2
 */
import path from "path";
import {
  type ServerId,
  type ILdmConfigWriter,
  type RocketConfigFields,
  type RocketUnturnedConfigFields,
  type PermissionsConfigFields,
  type LdmConfigWriteResult,
} from "@unturned-manager/shared";
import { AppError } from "../../utils/AppError.js";
import { logger } from "../../utils/logger.js";
import { AtomicFileWriter } from "../filelock/AtomicFileWriter.js";
import { RocketConfigXmlParser } from "./RocketConfigXmlParser.js";
import { resolveServerPath } from "../server/pathResolver.js";

// ─── 常量 ─────────────────────────────────────────────

/** LDM 配置目录相对路径 */
const ROCKET_DIR = "Rocket";
/** 框架主配置文件名 */
const ROCKET_CONFIG_FILE = "Rocket.config.xml";
/** Rocket.Unturned 特有配置文件名 */
const ROCKET_UNTURNED_CONFIG_FILE = "Rocket.Unturned.config.xml";
/** 权限组配置文件名 */
const PERMISSIONS_CONFIG_FILE = "Permissions.config.xml";

/** 插件名合法字符正则（与 schemas/ldm.schema.ts PluginCommandRequestSchema 一致） */
const PLUGIN_NAME_RE = /^[A-Za-z0-9._-]+$/;

// ─── 实现 ─────────────────────────────────────────────

export class LdmConfigWriter implements ILdmConfigWriter {
  /**
   * @param atomicWriter 共享原子写（备份 + 回滚 + 清理旧备份）
   * @param parser XML 解析器（字段合并 + 序列化 + 通用 XML）
   */
  constructor(
    private readonly atomicWriter: AtomicFileWriter,
    private readonly parser: RocketConfigXmlParser,
  ) {}

  // ─── writeRocketConfig ──────────────────────────────

  async writeRocketConfig(
    serverId: ServerId,
    fields: RocketConfigFields,
  ): Promise<LdmConfigWriteResult> {
    const targetPath = resolveServerPath(
      serverId,
      path.join(ROCKET_DIR, ROCKET_CONFIG_FILE),
    );
    const originalXml = await this.readOrEmpty(targetPath);
    const newXml = this.parser.serializeRocketConfig(fields, originalXml);
    return this.atomicWriteFile(serverId, targetPath, newXml, "Rocket.config.xml");
  }

  // ─── writeRocketUnturnedConfig ──────────────────────

  async writeRocketUnturnedConfig(
    serverId: ServerId,
    fields: RocketUnturnedConfigFields,
  ): Promise<LdmConfigWriteResult> {
    const targetPath = resolveServerPath(
      serverId,
      path.join(ROCKET_DIR, ROCKET_UNTURNED_CONFIG_FILE),
    );
    const originalXml = await this.readOrEmpty(targetPath);
    const newXml = this.parser.serializeRocketUnturnedConfig(fields, originalXml);
    return this.atomicWriteFile(
      serverId,
      targetPath,
      newXml,
      "Rocket.Unturned.config.xml",
    );
  }

  // ─── writePermissionsConfig ──────────────────────────

  async writePermissionsConfig(
    serverId: ServerId,
    fields: PermissionsConfigFields,
  ): Promise<LdmConfigWriteResult> {
    const targetPath = resolveServerPath(
      serverId,
      path.join(ROCKET_DIR, PERMISSIONS_CONFIG_FILE),
    );
    const originalXml = await this.readOrEmpty(targetPath);
    const newXml = this.parser.serializePermissionsConfig(fields, originalXml);
    return this.atomicWriteFile(serverId, targetPath, newXml, "Permissions.config.xml");
  }

  // ─── writePluginConfig ──────────────────────────────

  async writePluginConfig(
    serverId: ServerId,
    pluginName: string,
    rawXml: string,
  ): Promise<LdmConfigWriteResult> {
    // 校验 pluginName 合法字符（路径安全）
    if (!PLUGIN_NAME_RE.test(pluginName)) {
      throw new AppError(
        "plugin-name-invalid",
        `插件名含非法字符：${pluginName}（仅允许字母数字 . _ -）`,
        400,
      );
    }
    // 校验 XML 合法性（parseGeneric 抛错即不合法）
    try {
      this.parser.parseGeneric(rawXml);
    } catch (err) {
      throw new AppError(
        "plugin-config-invalid",
        `Configuration.xml XML 解析失败：${err instanceof Error ? err.message : String(err)}`,
        400,
      );
    }
    const targetPath = resolveServerPath(
      serverId,
      path.join(ROCKET_DIR, "Plugins", pluginName, `${pluginName}.configuration.xml`),
    );
    return this.atomicWriteFile(
      serverId,
      targetPath,
      rawXml,
      `${pluginName}.configuration.xml`,
    );
  }

  // ─── 私有辅助 ──────────────────────────────────────────

  /**
   * 读原 XML（如文件不存在返回空串——首次启动 U3DS 未生成时调用方会构造空结构）。
   */
  private async readOrEmpty(targetPath: string): Promise<string> {
    try {
      const fs = await import("fs/promises");
      return await fs.readFile(targetPath, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw new AppError(
        "ldm-config-read-failed",
        `读取原配置失败：${err instanceof Error ? err.message : String(err)}`,
        500,
      );
    }
  }

  /**
   * 调 AtomicFileWriter 原子写 + 错误码翻译为 LDM 专属错误码。
   *
   * @param serverId 实例 ID（用于日志上下文）
   * @param targetPath 目标文件绝对路径
   * @param content 待写入内容
   * @param label 文件标签（用于错误信息 + 日志）
   */
  private async atomicWriteFile(
    serverId: ServerId,
    targetPath: string,
    content: string,
    label: string,
  ): Promise<LdmConfigWriteResult> {
    try {
      const result = await this.atomicWriter.writeFile({
        path: targetPath,
        content,
        owner: `LdmConfigWriter:${serverId}`,
      });
      logger.info(
        { serverId, label, backupPath: result.backupPath },
        "LDM 配置写入成功",
      );
      return {
        success: result.success,
        backupPath: result.backupPath ?? "",
        writtenAtIso: result.writtenAtIso,
      };
    } catch (err) {
      if (err instanceof AppError) throw err; // 已是 AppError 透传
      throw new AppError(
        "ldm-config-write-failed",
        `${label} 写入失败：${err instanceof Error ? err.message : String(err)}`,
        500,
      );
    }
  }
}

// 类型引用辅助：避免「import 但未使用」编译告警（ILdmConfigWriter 实现标记）
export type _ILdmConfigWriterRef = ILdmConfigWriter;