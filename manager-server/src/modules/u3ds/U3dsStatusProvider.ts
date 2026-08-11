import fs from "fs/promises";
import path from "path";
import type { Logger } from "pino";
import type { IU3dsStatusProvider, U3dsStatus } from "@unturned-manager/shared";
import { STEAM_APP_IDS } from "@unturned-manager/shared";
import { detectStartScript } from "../server/startScript.js";
import { resolveInstallDir } from "../server/pathResolver.js";
import { parseVdf, VdfParseError } from "../workshop/VdfParser.js";

// ─── 常量 ────────────────────────────────────────────────

/** 状态文件名（SDG 官方固定：安装根目录下直接一份 Status.json） */
const STATUS_FILE_NAME = "Status.json";

/** 安装清单文件名前缀（steamcmd +app_update 1110390 后由 SteamCMD 生成） */
const APP_MANIFEST_PREFIX = "appmanifest_";

/** steamapps 目录名（标准 Steam 库布局） */
const STEAMAPPS_DIR_NAME = "steamapps";

/** 构建号字段名 */
const BUILD_ID_KEY = "buildid";

/** 版本段字段（Status.json Game 段） */
const VERSION_FIELDS = ["Major_Version", "Minor_Version", "Patch_Version"] as const;

/**
 * 可选时间戳字段名。
 * 优先级递减：清单里的 LastUpdated、TimeUpdated、其余已知字段；
 * 全部读不到时回落到清单文件自身的修改时间——这个字段名未经实机验证
 * （项目有过「想当然」的教训），故最坏情况至少给一个时间戳。
 */
const TIMESTAMP_KEY_CANDIDATES = [
  "LastUpdated",
  "TimeUpdated",
  "timeupdated",
  "lastupdated",
] as const;

// ─── 实现 ────────────────────────────────────────────────

/**
 * Unturned 服务端（U3DS）安装状态提供器（ADR-0004 Phase 6 之后 RCON 通道已删除，
 * 此类型取代任何运行时探测入口——纯读，无副作用）。
 *
 * 数据来源（按可信度递减）：
 * 1. `<installDir>/ServerHelper.sh` 或 `<installDir>/ExampleServer.sh` 存在性 = 已安装
 * 2. `<installDir>/Status.json` 的 `Game` 段三个版本字段拼成 `3.{主}.{次}.{补丁}`
 *    （SDG 官方 `GameStatusData.FormatApplicationVersion()` 的原样格式，开头的 `3.` 官方写死）
 * 3. `<installDir>/steamapps/appmanifest_1110390.acf` 的 `buildid` + 时间戳
 *
 * 任一缺失都不抛错（卡片要能表达「未安装」），只在日志记一行警告。
 */
export class U3dsStatusProvider implements IU3dsStatusProvider {
  private readonly logger: Logger;
  private readonly installDir: string;
  private readonly platform: NodeJS.Platform;

  constructor(
    logger: Logger,
    installDir?: string,
    platform: NodeJS.Platform = process.platform,
  ) {
    this.logger = logger;
    this.installDir = installDir ?? resolveInstallDir();
    this.platform = platform;
  }

  /**
   * 读取安装状态。
   *
   * @returns 安装状态对象；任一字段读不到时该字段为 undefined
   */
  async getStatus(): Promise<U3dsStatus> {
    const startScript = await detectStartScript(
      this.installDir,
      this.platform,
    );
    const isInstalled = startScript !== null;

    const result: U3dsStatus = {
      appId: STEAM_APP_IDS.U3DS_SERVER,
      isInstalled,
      installPath: this.installDir,
    };

    if (!isInstalled) {
      // 未安装时不再浪费时间去读版本文件——返回时版本字段保持 undefined
      return result;
    }

    const version = await this.readVersion();
    if (version !== undefined) result.version = version;

    const { buildId, lastUpdated } = await this.readManifest();
    if (buildId !== undefined) result.buildId = buildId;
    if (lastUpdated !== undefined) result.lastUpdated = lastUpdated;

    return result;
  }

  /**
   * 读 `Status.json` 拼游戏版本号。
   *
   * 字段读取规则：必须三个字段都存在且为数字才视为有效；
   * 缺失一个或类型不符视为「无可用版本号」，不抛错。
   */
  private async readVersion(): Promise<string | undefined> {
    const statusPath = path.join(this.installDir, STATUS_FILE_NAME);
    let raw: string;
    try {
      raw = await fs.readFile(statusPath, "utf8");
    } catch (err) {
      this.logger.debug(
        { err, statusPath },
        "Status.json 不存在或不可读，跳过版本号",
      );
      return undefined;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (err) {
      this.logger.warn(
        { err, statusPath },
        "Status.json 不是合法 JSON，跳过版本号",
      );
      return undefined;
    }

    if (!parsed || typeof parsed !== "object") return undefined;
    const game = (parsed as Record<string, unknown>)["Game"];
    if (!game || typeof game !== "object") return undefined;

    const gameObj = game as Record<string, unknown>;
    const nums: number[] = [];
    for (const key of VERSION_FIELDS) {
      const raw = gameObj[key];
      if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
        return undefined;
      }
      nums.push(Math.floor(raw));
    }

    // SDG 官方格式：3.{主}.{次}.{补丁}——与 GameStatusData.FormatApplicationVersion() 一致
    return `3.${nums[0]}.${nums[1]}.${nums[2]}`;
  }

  /**
   * 读安装清单（acf）拿构建号和上次更新时间。
   *
   * 路径约定：`<installDir>/steamapps/appmanifest_<U3DS_APP_ID>.acf`
   * ——用户实机已确认。如果清单里读不到时间戳字段，回落到清单文件自身的修改时间。
   */
  private async readManifest(): Promise<{
    buildId?: string;
    lastUpdated?: string;
  }> {
    const manifestPath = path.join(
      this.installDir,
      STEAMAPPS_DIR_NAME,
      `${APP_MANIFEST_PREFIX}${STEAM_APP_IDS.U3DS_SERVER}.acf`,
    );

    let raw: string;
    try {
      raw = await fs.readFile(manifestPath, "utf8");
    } catch {
      this.logger.debug(
        { manifestPath },
        "安装清单不存在，跳过构建号与更新时间",
      );
      return {};
    }

    let buildId: string | undefined;
    let lastUpdated: string | undefined;
    try {
      const parsed = parseVdf(raw);
      // VDF 顶层是一个 key 包裹的对象（通常是 "AppState"），取该根节点
      const rootKey = Object.keys(parsed)[0];
      const root = rootKey ? (parsed[rootKey] as Record<string, unknown>) : undefined;
      if (root) {
        const buildIdRaw = root[BUILD_ID_KEY];
        if (typeof buildIdRaw === "string") buildId = buildIdRaw;
        // 清单文件里的时间戳是 Steam 的 Unix 时间戳（秒）
        const ts = this.extractTimestamp(root);
        if (ts !== undefined) {
          lastUpdated = new Date(ts * 1000).toISOString();
        }
      }
    } catch (err) {
      if (err instanceof VdfParseError) {
        this.logger.warn(
          { err, manifestPath },
          "安装清单 VDF 解析失败，跳过构建号与时间戳",
        );
      } else {
        this.logger.warn(
          { err, manifestPath },
          "安装清单读取异常，跳过构建号与时间戳",
        );
      }
    }

    // 最坏情况：清单里没有时间戳字段，用文件自身修改时间兜底（绝不返回 undefined 时间）
    if (lastUpdated === undefined) {
      try {
        const stat = await fs.stat(manifestPath);
        lastUpdated = stat.mtime.toISOString();
      } catch {
        // 极端兜底失败——保持 undefined
      }
    }

    return { buildId, lastUpdated };
  }

  /**
   * 在清单根对象里按候选字段名顺序找一个时间戳值。
   * Steam 标准字段是 Unix 秒数字符串；非数字或缺失返回 undefined。
   */
  private extractTimestamp(root: Record<string, unknown>): number | undefined {
    for (const key of TIMESTAMP_KEY_CANDIDATES) {
      const v = root[key];
      if (typeof v === "string") {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) return n;
      }
      if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
    }
    return undefined;
  }
}