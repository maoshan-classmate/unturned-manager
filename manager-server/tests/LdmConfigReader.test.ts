import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import type { ServerId } from "@unturned-manager/shared";
import { LdmConfigReader } from "../src/modules/ldm/LdmConfigReader.js";
import { RocketConfigXmlParser } from "../src/modules/ldm/RocketConfigXmlParser.js";
import { resolveInstallDir } from "../src/modules/server/pathResolver.js";

const serverId: ServerId = "LdmReaderTest" as ServerId;
const serverDir = path.join(resolveInstallDir(), "Servers", serverId);
const ROCKET_DIR = path.join(serverDir, "Rocket");
const ROCKET_CONFIG_PATH = path.join(ROCKET_DIR, "Rocket.config.xml");
const ROCKET_UNTURNED_CONFIG_PATH = path.join(
  ROCKET_DIR,
  "Rocket.Unturned.config.xml",
);
const PERMISSIONS_CONFIG_PATH = path.join(
  ROCKET_DIR,
  "Permissions.config.xml",
);

describe("LdmConfigReader", () => {
  let reader: LdmConfigReader;

  beforeEach(async () => {
    await fs.rm(serverDir, { recursive: true, force: true });
    await fs.mkdir(ROCKET_DIR, { recursive: true });
    reader = new LdmConfigReader(new RocketConfigXmlParser());
  });

  // ─── readRocketConfig ────────────────────────────────

  it("readRocketConfig 成功 + discriminated union file 字段", async () => {
    const xml = `<RocketConfiguration>
  <LanguageCode>en</LanguageCode>
  <MaxFrames>60</MaxFrames>
  <AutomaticShutdown>
    <Enabled>False</Enabled>
    <Interval>86400</Interval>
  </AutomaticShutdown>
</RocketConfiguration>`;
    await fs.writeFile(ROCKET_CONFIG_PATH, xml, "utf-8");

    const result = await reader.readRocketConfig(serverId);

    expect(result.file).toBe("Rocket.config.xml");
    expect(result.raw).toBe(xml);
    expect(result.serverId).toBe(serverId);
    expect(typeof result.sizeBytes).toBe("number");
    expect(typeof result.modifiedAtIso).toBe("string");
    // narrow fields 到 RocketConfigFields
    if (result.file === "Rocket.config.xml") {
      expect(result.fields.languageCode).toBe("en");
      expect(result.fields.maxFrames).toBe(60);
      expect(result.fields.automaticShutdownEnabled).toBe(false);
    }
  });

  // ─── readRocketUnturnedConfig ────────────────────────

  it("readRocketUnturnedConfig 成功 + 9 字段 narrow", async () => {
    const xml = `<RocketConfiguration>
  <AutomaticSave>
    <Enabled>True</Enabled>
    <Interval>300</Interval>
  </AutomaticSave>
  <CharacterNameValidation>True</CharacterNameValidation>
  <CharacterNameValidationRule>^[A-Za-z0-9_]+$</CharacterNameValidationRule>
  <LogSuspiciousPlayerMovement>True</LogSuspiciousPlayerMovement>
  <EnableItemBlacklist>True</EnableItemBlacklist>
  <EnableItemSpawnLimit>True</EnableItemSpawnLimit>
  <MaxSpawnAmount>100</MaxSpawnAmount>
  <EnableVehicleBlacklist>False</EnableVehicleBlacklist>
</RocketConfiguration>`;
    await fs.writeFile(ROCKET_UNTURNED_CONFIG_PATH, xml, "utf-8");

    const result = await reader.readRocketUnturnedConfig(serverId);

    expect(result.file).toBe("Rocket.Unturned.config.xml");
    if (result.file === "Rocket.Unturned.config.xml") {
      expect(result.fields.automaticSaveEnabled).toBe(true);
      expect(result.fields.automaticSaveInterval).toBe(300);
      expect(result.fields.characterNameValidation).toBe(true);
      expect(result.fields.maxSpawnAmount).toBe(100);
    }
  });

  // ─── readPermissionsConfig ───────────────────────────

  it("readPermissionsConfig 成功 + Groups 树形 narrow", async () => {
    const xml = `<?xml version="1.0"?>
<RocketPermissions>
  <DefaultGroup>default</DefaultGroup>
  <Groups>
    <Group>
      <Id>default</Id>
      <DisplayName>Player</DisplayName>
      <Color>white</Color>
      <Priority>100</Priority>
      <Permissions>
        <Permission>rocket.kits</Permission>
      </Permissions>
    </Group>
    <Group>
      <Id>vip</Id>
      <DisplayName>VIP</DisplayName>
      <Color>yellow</Color>
      <ParentGroup>default</ParentGroup>
      <Priority>50</Priority>
    </Group>
  </Groups>
</RocketPermissions>`;
    await fs.writeFile(PERMISSIONS_CONFIG_PATH, xml, "utf-8");

    const result = await reader.readPermissionsConfig(serverId);

    expect(result.file).toBe("Permissions.config.xml");
    if (result.file === "Permissions.config.xml") {
      expect(result.fields.defaultGroup).toBe("default");
      expect(result.fields.groups.length).toBe(2);
      expect(result.fields.groups[0].id).toBe("default");
      expect(result.fields.groups[1].id).toBe("vip");
      expect(result.fields.groups[1].parentGroup).toBe("default");
    }
  });

  // ─── 错误码：404 文件不存在 ───────────────────────────

  it("文件不存在抛 ldm-config-not-found (404)", async () => {
    // beforeEach 已清空目录，未创建任何文件
    await expect(reader.readRocketConfig(serverId)).rejects.toMatchObject({
      code: "ldm-config-not-found",
      status: 404,
    });
  });

  // ─── 错误码：500 解析失败 ─────────────────────────────

  it("XML 解析失败抛 ldm-config-read-failed (500)", async () => {
    // 写一个明显不合法的 XML
    await fs.writeFile(
      ROCKET_CONFIG_PATH,
      "<RocketConfiguration><Unclosed>",
      "utf-8",
    );

    await expect(reader.readRocketConfig(serverId)).rejects.toMatchObject({
      code: "ldm-config-read-failed",
      status: 500,
    });
  });
});