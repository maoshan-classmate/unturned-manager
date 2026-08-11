import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { pino } from "pino";
import { U3dsStatusProvider } from "../src/modules/u3ds/U3dsStatusProvider.js";

/**
 * U3dsStatusProvider 单测——修实机第 11 项。
 *
 * 测试夹具用 os.tmpdir() 完全隔离的临时目录作为 installDir，
 * 不污染 .test-install（status query 是 installDir 维度的，
 * 没有 per-server 隔离需求）。
 */

const silentLogger = pino({ level: "silent" });

/** 一个完整有效的安装清单（VDF 格式，标准 Steam 布局） */
const MANIFEST_VDF = `"AppState"
{
  "appid"        "1110390"
  "name"         "Unturned Dedicated Server"
  "buildid"      "1785799152"
  "LastUpdated"  "1723412345"
  "installdir"   "Unturned"
}
`;

/** 一个损坏的安装清单（VDF 解析失败） */
const CORRUPT_VDF = `"AppState"
{
  "appid"  "1110390"
  // 大括号不闭合
`;

/** 一个完整有效的 Status.json（按 SDG 官方 schema） */
const STATUS_JSON = JSON.stringify({
  Game: {
    Major_Version: 24,
    Minor_Version: 5,
    Patch_Version: 0,
  },
});

async function createTempInstallDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "u3ds-status-test-"));
}

/** 在 installDir 下放一个启动脚本，触发「已安装」分支 */
async function makeInstalled(installDir: string): Promise<void> {
  await fs.writeFile(
    path.join(installDir, "ServerHelper.sh"),
    "#!/bin/sh\nexit 0\n",
  );
}

/** 在 installDir/steamapps/ 下放一份完整的安装清单 */
async function writeManifest(
  installDir: string,
  body: string,
): Promise<void> {
  const steamappsDir = path.join(installDir, "steamapps");
  await fs.mkdir(steamappsDir, { recursive: true });
  await fs.writeFile(
    path.join(steamappsDir, "appmanifest_1110390.acf"),
    body,
  );
}

describe("U3dsStatusProvider", () => {
  let tempDir: string;
  let provider: U3dsStatusProvider;

  beforeEach(async () => {
    tempDir = await createTempInstallDir();
    // 显式注入 linux 平台——测试在 Windows 上跑，process.platform 是 win32
    // （detectStartScript 对 win32 返回空数组，永远判定为未安装）
    provider = new U3dsStatusProvider(silentLogger, tempDir, "linux");
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("完整安装（启动脚本 + Status.json + 清单全在）：返回所有字段", async () => {
    await makeInstalled(tempDir);
    await fs.writeFile(path.join(tempDir, "Status.json"), STATUS_JSON);
    await writeManifest(tempDir, MANIFEST_VDF);

    const status = await provider.getStatus();

    expect(status.isInstalled).toBe(true);
    expect(status.appId).toBe("1110390");
    expect(status.version).toBe("3.24.5.0");
    expect(status.buildId).toBe("1785799152");
    // LastUpdated=1723412345 → ISO 字符串
    expect(status.lastUpdated).toBe(
      new Date(1723412345 * 1000).toISOString(),
    );
    expect(status.installPath).toBe(tempDir);
  });

  it("无启动脚本：isInstalled=false 且不再读其它文件", async () => {
    // 不放 ServerHelper.sh；Status.json 与清单存在但应当被忽略
    await fs.writeFile(path.join(tempDir, "Status.json"), STATUS_JSON);
    await writeManifest(tempDir, MANIFEST_VDF);

    const status = await provider.getStatus();

    expect(status.isInstalled).toBe(false);
    expect(status.version).toBeUndefined();
    expect(status.buildId).toBeUndefined();
  });

  it("已装但缺 Status.json：version 缺失，buildId 与 lastUpdated 仍有", async () => {
    await makeInstalled(tempDir);
    await writeManifest(tempDir, MANIFEST_VDF);

    const status = await provider.getStatus();

    expect(status.isInstalled).toBe(true);
    expect(status.version).toBeUndefined();
    expect(status.buildId).toBe("1785799152");
    expect(status.lastUpdated).toBe(
      new Date(1723412345 * 1000).toISOString(),
    );
  });

  it("已装但缺安装清单：buildId 缺失，lastUpdated 也缺失（无文件可回落）", async () => {
    await makeInstalled(tempDir);
    await fs.writeFile(path.join(tempDir, "Status.json"), STATUS_JSON);

    const status = await provider.getStatus();

    expect(status.isInstalled).toBe(true);
    expect(status.version).toBe("3.24.5.0");
    expect(status.buildId).toBeUndefined();
    expect(status.lastUpdated).toBeUndefined();
  });

  it("清单 VDF 损坏：buildId/lastUpdated 缺失但 lastUpdated 回落文件修改时间", async () => {
    await makeInstalled(tempDir);
    await fs.writeFile(path.join(tempDir, "Status.json"), STATUS_JSON);
    await writeManifest(tempDir, CORRUPT_VDF);

    const status = await provider.getStatus();

    expect(status.isInstalled).toBe(true);
    expect(status.version).toBe("3.24.5.0");
    expect(status.buildId).toBeUndefined();
    // 回落：lastUpdated 应为清单文件自身的 mtime（不是 undefined）
    expect(status.lastUpdated).toBeDefined();
    const manifestStat = await fs.stat(
      path.join(tempDir, "steamapps", "appmanifest_1110390.acf"),
    );
    expect(status.lastUpdated).toBe(manifestStat.mtime.toISOString());
  });

  it("清单有 buildid 但时间戳字段不在候选名单：lastUpdated 回落文件修改时间", async () => {
    await makeInstalled(tempDir);
    // 清单里只有一个 buildid，没有任何时间戳字段
    const manifestNoTs = `"AppState"
{
  "appid"   "1110390"
  "buildid" "1785799152"
}
`;
    await writeManifest(tempDir, manifestNoTs);

    const status = await provider.getStatus();

    expect(status.isInstalled).toBe(true);
    expect(status.buildId).toBe("1785799152");
    expect(status.lastUpdated).toBeDefined();
    const manifestStat = await fs.stat(
      path.join(tempDir, "steamapps", "appmanifest_1110390.acf"),
    );
    expect(status.lastUpdated).toBe(manifestStat.mtime.toISOString());
  });

  it("Status.json 不是合法 JSON：version 缺失不影响其它字段", async () => {
    await makeInstalled(tempDir);
    await fs.writeFile(path.join(tempDir, "Status.json"), "{not json");
    await writeManifest(tempDir, MANIFEST_VDF);

    const status = await provider.getStatus();

    expect(status.isInstalled).toBe(true);
    expect(status.version).toBeUndefined();
    expect(status.buildId).toBe("1785799152");
  });

  it("Status.json 的版本字段不齐全：version 缺失而非抛错", async () => {
    await makeInstalled(tempDir);
    // 只放了 Major，其它字段缺失
    await fs.writeFile(
      path.join(tempDir, "Status.json"),
      JSON.stringify({ Game: { Major_Version: 24 } }),
    );
    await writeManifest(tempDir, MANIFEST_VDF);

    const status = await provider.getStatus();

    expect(status.version).toBeUndefined();
    expect(status.buildId).toBe("1785799152");
  });
});