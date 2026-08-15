/**
 * LdmConfigReader——LDM 配置文件读取服务（编辑器配套）。
 *
 * 职责：读 Rocket.config.xml / Rocket.Unturned.config.xml / Permissions.config.xml
 * 返回结构化字段（与 RocketConfigXmlParser.parse* 配对）+ 原文 XML + 文件元数据。
 *
 * 不要求实例 RUNNING（纯文件 I/O）。
 * 错误码：ldm-config-not-found (404) / ldm-config-read-failed (500)。
 *
 * @see docs/architecture/ldm-editor-design.md §3.1
 */
import fs from "fs/promises";
import path from "path";
import {
  type ServerId,
  type ILdmConfigReader,
  type LdmConfigReadResult,
} from "@unturned-manager/shared";
import { AppError } from "../../utils/AppError.js";
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

// ─── 实现 ─────────────────────────────────────────────

export class LdmConfigReader implements ILdmConfigReader {
  constructor(private readonly parser: RocketConfigXmlParser) {}

  // ─── readRocketConfig ────────────────────────────────

  async readRocketConfig(serverId: ServerId): Promise<LdmConfigReadResult> {
    return this.readFile(
      serverId,
      ROCKET_CONFIG_FILE,
      (xml) => this.parser.parseRocketConfig(xml),
    );
  }

  // ─── readRocketUnturnedConfig ────────────────────────

  async readRocketUnturnedConfig(serverId: ServerId): Promise<LdmConfigReadResult> {
    return this.readFile(
      serverId,
      ROCKET_UNTURNED_CONFIG_FILE,
      (xml) => this.parser.parseRocketUnturnedConfig(xml),
    );
  }

  // ─── readPermissionsConfig ───────────────────────────

  async readPermissionsConfig(serverId: ServerId): Promise<LdmConfigReadResult> {
    return this.readFile(
      serverId,
      PERMISSIONS_CONFIG_FILE,
      (xml) => this.parser.parsePermissionsConfig(xml),
    );
  }

  // ─── 内部：读盘 + 解析 + 元数据 ──────────────────────

  /**
   * 读文件 + 解析 + 元数据。
   * 返回 discriminated union——调用方拿到 result 后按 file 字段 narrow 到具体 fields 类型。
   *
   * @param serverId 实例标识
   * @param fileName 配置文件名（discriminated union 的字面量字符串）
   * @param parseFn 解析函数（xml → { fields, raw }）
   * @returns 读响应（union 类型；前端用 result.file === "..." narrow）
   * @throws AppError('ldm-config-not-found') 404 文件不存在
   * @throws AppError('ldm-config-read-failed') 500 读盘/解析失败
   */
  private async readFile(
    serverId: ServerId,
    fileName: LdmConfigReadResult["file"],
    parseFn: (
      xml: string,
    ) => { fields: LdmConfigReadResult["fields"]; raw: string },
  ): Promise<LdmConfigReadResult> {
    const filePath = resolveServerPath(serverId, path.join(ROCKET_DIR, fileName));

    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf-8");
    } catch (err) {
      const errno = (err as NodeJS.ErrnoException).code;
      if (errno === "ENOENT") {
        throw new AppError(
          "ldm-config-not-found",
          `配置文件不存在：${fileName}（首次启动服务端前不会有此文件）`,
          404,
        );
      }
      throw new AppError(
        "ldm-config-read-failed",
        `读取 ${fileName} 失败：${err instanceof Error ? err.message : String(err)}`,
        500,
      );
    }

    let stat: import("fs").Stats;
    try {
      stat = await fs.stat(filePath);
    } catch (err) {
      throw new AppError(
        "ldm-config-read-failed",
        `获取 ${fileName} 元数据失败：${err instanceof Error ? err.message : String(err)}`,
        500,
      );
    }

    let parsed: { fields: LdmConfigReadResult["fields"]; raw: string };
    try {
      parsed = parseFn(raw);
    } catch (err) {
      throw new AppError(
        "ldm-config-read-failed",
        `解析 ${fileName} 失败：${err instanceof Error ? err.message : String(err)}`,
        500,
      );
    }

    return {
      serverId,
      file: fileName,
      raw: parsed.raw,
      fields: parsed.fields,
      sizeBytes: stat.size,
      modifiedAtIso: stat.mtime.toISOString(),
    } as LdmConfigReadResult;
  }
}