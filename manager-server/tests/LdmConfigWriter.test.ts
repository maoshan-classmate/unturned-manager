import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import type { ServerId } from "@unturned-manager/shared";
import { AppError } from "../src/utils/AppError.js";
import { LdmConfigWriter } from "../src/modules/ldm/LdmConfigWriter.js";
import { RocketConfigXmlParser } from "../src/modules/ldm/RocketConfigXmlParser.js";
import { AtomicFileWriter } from "../src/modules/filelock/AtomicFileWriter.js";
import { FileLockProvider } from "../src/modules/filelock/FileLockProvider.js";
import { resolveInstallDir } from "../src/modules/server/pathResolver.js";

const serverId: ServerId = "LdmCfgTest" as ServerId;
const serverDir = path.join(resolveInstallDir(), "Servers", serverId);
const ROCKET_DIR = path.join(serverDir, "Rocket");
const ROCKET_CONFIG_PATH = path.join(ROCKET_DIR, "Rocket.config.xml");

describe("LdmConfigWriter", () => {
  let writer: LdmConfigWriter;

  beforeEach(async () => {
    await fs.rm(serverDir, { recursive: true, force: true });
    await fs.mkdir(ROCKET_DIR, { recursive: true });
    writer = new LdmConfigWriter(
      new AtomicFileWriter(new FileLockProvider()),
      new RocketConfigXmlParser(),
    );
  });

  it("写 Rocket.config.xml 成功 + 备份文件生成", async () => {
    const original = `<RocketConfiguration>
  <LanguageCode>en</LanguageCode>
  <MaxFrames>60</MaxFrames>
  <AutomaticShutdown>
    <Enabled>False</Enabled>
    <Interval>86400</Interval>
  </AutomaticShutdown>
</RocketConfiguration>`;
    await fs.writeFile(ROCKET_CONFIG_PATH, original, "utf-8");

    const result = await writer.writeRocketConfig(serverId, {
      languageCode: "zh-CN",
      maxFrames: 120,
      automaticShutdownEnabled: true,
      automaticShutdownInterval: 3600,
      webPermissionsEnabled: false,
      webPermissionsUrl: "",
      webPermissionsInterval: 180,
      webConfigurationsEnabled: false,
      webConfigurationsUrl: "",
    });

    expect(result.success).toBe(true);
    expect(result.backupPath).toContain(".bak.");
    // 备份文件存在
    expect(await fs.stat(result.backupPath)).toBeTruthy();
    // 目标文件内容正确（zh-CN）
    const newContent = await fs.readFile(ROCKET_CONFIG_PATH, "utf-8");
    expect(newContent).toContain("<LanguageCode>zh-CN</LanguageCode>");
    expect(newContent).toContain("<MaxFrames>120</MaxFrames>");
  });

  it("写 Permissions.config.xml 成功 + 字段保留", async () => {
    const original = `<?xml version="1.0"?>
<RocketPermissions>
  <DefaultGroup>default</DefaultGroup>
  <Groups>
    <Group>
      <Id>default</Id>
      <DisplayName>Player</DisplayName>
      <Color>white</Color>
      <Priority>100</Priority>
    </Group>
  </Groups>
</RocketPermissions>`;
    const permsPath = path.join(ROCKET_DIR, "Permissions.config.xml");
    await fs.writeFile(permsPath, original, "utf-8");

    const result = await writer.writePermissionsConfig(serverId, {
      defaultGroup: "default",
      groups: [
        {
          id: "default",
          displayName: "Player",
          color: "white",
          members: [],
          priority: 100,
          permissions: ["rocket.kits"],
        },
        {
          id: "vip",
          displayName: "VIP",
          color: "yellow",
          parentGroup: "default",
          members: [],
          priority: 50,
          permissions: ["rocket.warp"],
        },
      ],
    });

    expect(result.success).toBe(true);
    const newContent = await fs.readFile(permsPath, "utf-8");
    expect(newContent).toContain("<Id>vip</Id>");
    expect(newContent).toContain("<ParentGroup>default</ParentGroup>");
  });

  it("写插件 Configuration.xml 成功（通用 XML）", async () => {
    const pluginName = "Uconomy";
    const pluginDir = path.join(ROCKET_DIR, "Plugins", pluginName);
    await fs.mkdir(pluginDir, { recursive: true });

    const xml = `<?xml version="1.0"?>
<UconomyConfiguration>
  <Balance>100</Balance>
  <CurrencyName>Dollar</CurrencyName>
</UconomyConfiguration>`;

    const result = await writer.writePluginConfig(serverId, pluginName, xml);

    expect(result.success).toBe(true);
    const written = await fs.readFile(
      path.join(pluginDir, `${pluginName}.configuration.xml`),
      "utf-8",
    );
    expect(written).toContain("<Balance>100</Balance>");
    expect(written).toContain("<CurrencyName>Dollar</CurrencyName>");
  });

  it("运行时写成功（不阻断 ServerManager 状态——写是文件 I/O）", async () => {
    // 模拟实例 RUNNING 时写配置——不应报错（与 Phase 1 的「写必须 STOPPED」决策反）
    await expect(
      writer.writeRocketConfig(serverId, {
        languageCode: "en",
        maxFrames: 60,
        automaticShutdownEnabled: false,
        automaticShutdownInterval: 86400,
        webPermissionsEnabled: false,
        webPermissionsUrl: "",
        webPermissionsInterval: 180,
        webConfigurationsEnabled: false,
        webConfigurationsUrl: "",
      }),
    ).resolves.toMatchObject({ success: true });
  });

  it("写失败时回滚——目标父目录被删导致 rename 失败", async () => {
    // 让 Rocket/ 父目录被删——fs.rename temp → 目标会抛 ENOENT
    await fs.rm(ROCKET_DIR, { recursive: true, force: true });

    let thrown: unknown = null;
    try {
      await writer.writeRocketConfig(serverId, {
        languageCode: "zh-CN",
        maxFrames: 60,
        automaticShutdownEnabled: false,
        automaticShutdownInterval: 86400,
        webPermissionsEnabled: false,
        webPermissionsUrl: "",
        webPermissionsInterval: 180,
        webConfigurationsEnabled: false,
        webConfigurationsUrl: "",
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toMatch(
      /atomic-write-failed|ldm-config-write-failed/,
    );
  });

  it("pluginName 含非法字符 → 抛 AppError code=plugin-name-invalid", async () => {
    let thrown: unknown = null;
    try {
      await writer.writePluginConfig(serverId, "../etc/passwd", "<x/>");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe("plugin-name-invalid");
  });

  it("rawXml 不是合法 XML → 抛 AppError code=plugin-config-invalid", async () => {
    let thrown: unknown = null;
    try {
      await writer.writePluginConfig(serverId, "Bad", "<root><unclosed>");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe("plugin-config-invalid");
  });

  // ─── Phase 5 §4.2：writer 入口 Zod 校验（堵绕过路由的非法字段路径） ──

  it("writeRocketConfig maxFrames 类型非法 → 抛 ldm-config-invalid 400", async () => {
    // 绕过 TS 类型检查模拟「绕过路由直调 writer」的非法输入路径
    const illegal = {
      languageCode: "en",
      maxFrames: "not-a-number", // 应为 number
      automaticShutdownEnabled: false,
      automaticShutdownInterval: 86400,
      webPermissionsEnabled: false,
      webPermissionsUrl: "",
      webPermissionsInterval: 180,
      webConfigurationsEnabled: false,
      webConfigurationsUrl: "",
    } as unknown as Parameters<typeof writer.writeRocketConfig>[1];

    let thrown: unknown = null;
    try {
      await writer.writeRocketConfig(serverId, illegal);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe("ldm-config-invalid");
    expect((thrown as AppError).status).toBe(400);
  });

  it("writePermissionsConfig color 不在枚举 → 抛 ldm-config-invalid 400", async () => {
    const illegal = {
      defaultGroup: "default",
      groups: [
        {
          id: "default",
          displayName: "Player",
          color: "not-a-real-color", // 应在 LDM Color 枚举
          members: [],
          priority: 100,
          permissions: [],
        },
      ],
    } as unknown as Parameters<typeof writer.writePermissionsConfig>[1];

    let thrown: unknown = null;
    try {
      await writer.writePermissionsConfig(serverId, illegal);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe("ldm-config-invalid");
    expect((thrown as AppError).status).toBe(400);
  });

  it("writeRocketUnturnedConfig maxSpawnAmount 超出范围 → 抛 ldm-config-invalid 400", async () => {
    const illegal = {
      automaticSaveEnabled: true,
      automaticSaveInterval: 1800,
      characterNameValidation: false,
      characterNameValidationRule: "",
      logSuspiciousPlayerMovement: true,
      enableItemBlacklist: false,
      enableItemSpawnLimit: true,
      maxSpawnAmount: 0, // Zod min(1)
      enableVehicleBlacklist: false,
    } as unknown as Parameters<typeof writer.writeRocketUnturnedConfig>[1];

    let thrown: unknown = null;
    try {
      await writer.writeRocketUnturnedConfig(serverId, illegal);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe("ldm-config-invalid");
    expect((thrown as AppError).status).toBe(400);
  });
});