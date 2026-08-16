import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import { ConfigService } from "../src/modules/config/ConfigService.js";
import { FileLockProvider } from "../src/modules/filelock/FileLockProvider.js";
import { resolveInstallDir } from "../src/modules/server/pathResolver.js";
import type { ServerId } from "@unturned-manager/shared";

describe("ConfigService — 5 种格式往返", () => {
  let svc: ConfigService;
  // serverId 唯一（并行 forks pool 下各文件目录隔离，避免互踩 .test-install）
  const serverId: ServerId = "CfgServer" as ServerId;
  /** fixture 根 = config.installDir（ADR-0003 / T2：真源全局，测试 fixture 必须写到同一处） */
  const serverDir = path.join(resolveInstallDir(), "Servers", serverId);

  beforeEach(async () => {
    // 清理 + 重建本测试的 Servers/<id> 目录（避免跨用例残留）
    await fs.rm(serverDir, { recursive: true, force: true });
    await fs.mkdir(path.join(serverDir, "Server"), { recursive: true });

    // T2 后构造器单参（fileLock）——不再依赖 db
    svc = new ConfigService(new FileLockProvider());
  });

  it("Commands.dat: read → write → read 等价", async () => {
    const input =
      "Name MyServer\nPort 27015\nCheats\n# comment\nUnknownKey customValue\n";
    await fs.writeFile(path.join(serverDir, "Server", "Commands.dat"), input);

    const first = await svc.readCommandsDat(serverId);
    expect(first.known.Name).toBe("MyServer");
    expect(first.known.Port).toBe("27015");
    expect(first.known.Cheats).toBe("");
    expect(first.unknown.UnknownKey).toBe("customValue");
    expect(first.comments).toContain("# comment");

    await svc.writeCommandsDat(serverId, first);
    const second = await svc.readCommandsDat(serverId);
    expect(second.known.Name).toBe(first.known.Name);
    expect(second.known.Port).toBe(first.known.Port);
    expect(second.known.Cheats).toBe(first.known.Cheats);
    expect(second.unknown.UnknownKey).toBe("customValue");
  });

  it("Commands.dat: 拆写遗留子键（LogChat/VotifyPassCooldown）解析时丢弃", async () => {
    const input =
      "Name MyServer\n" +
      "Log Y/Y/Y/N\n" +
      "LogChat true\n" +
      "LogJoin true\n" +
      "VotifyPassCooldown 5\n" +
      "UnknownKey customValue\n";
    await fs.writeFile(path.join(serverDir, "Server", "Commands.dat"), input);

    const first = await svc.readCommandsDat(serverId);
    // 合成单行正常进 known
    expect(first.known.Log).toBe("Y/Y/Y/N");
    // 拆写子键被丢弃——不进 unknown
    expect(first.unknown.LogChat).toBeUndefined();
    expect(first.unknown.VotifyPassCooldown).toBeUndefined();
    // 真未知键仍保留
    expect(first.unknown.UnknownKey).toBe("customValue");

    // 保存后文件里不再有残留子键
    await svc.writeCommandsDat(serverId, first);
    const second = await svc.readCommandsDat(serverId);
    expect(second.known.Log).toBe("Y/Y/Y/N");
    expect(second.unknown.LogChat).toBeUndefined();
    expect(second.unknown.VotifyPassCooldown).toBeUndefined();
    expect(second.unknown.UnknownKey).toBe("customValue");
  });

  it("Commands.dat: 乐观锁 mtime 冲突抛 config_conflict(409)", async () => {
    const absPath = path.join(serverDir, "Server", "Commands.dat");
    await fs.writeFile(absPath, "Name A\n");
    const st = await fs.stat(absPath);
    const expectedMtime = Math.floor(st.mtimeMs);

    // 用当前 mtime 写 → 成功（mtime 未变）
    await svc.writeCommandsDat(
      serverId,
      {
        known: { Name: "A" },
        unknown: {},
        comments: [],
      },
      expectedMtime,
    );

    // 外部改文件 → mtime 变化 → 再用旧 mtime 写 → 冲突
    await new Promise((r) => setTimeout(r, 20));
    await fs.writeFile(absPath, "Name C\n");
    await expect(
      svc.writeCommandsDat(
        serverId,
        { known: { Name: "B" }, unknown: {}, comments: [] },
        expectedMtime,
      ),
    ).rejects.toMatchObject({ code: "config_conflict", status: 409 });
  });

  it("Commands.dat: 255 与技能组并存 → 抛 loadout-mutually-exclusive(400)", async () => {
    await expect(
      svc.writeCommandsDat(serverId, {
        known: {},
        unknown: {},
        comments: [],
        loadouts: [
          { skillsetId: 255, itemIds: [1100] },
          { skillsetId: 2, itemIds: [1064] },
        ],
      }),
    ).rejects.toMatchObject({
      code: "loadout-mutually-exclusive",
      status: 400,
    });
  });

  it("Commands.dat: 仅 255 或仅技能组 → 正常写", async () => {
    // 仅 255
    await svc.writeCommandsDat(serverId, {
      known: {},
      unknown: {},
      comments: [],
      loadouts: [{ skillsetId: 255, itemIds: [1100] }],
    });
    // 仅技能组（多个并存合法——D4）
    await svc.writeCommandsDat(serverId, {
      known: {},
      unknown: {},
      comments: [],
      loadouts: [
        { skillsetId: 2, itemIds: [1064] },
        { skillsetId: 10, itemIds: [311, 312] },
      ],
    });
  });

  it("Config.txt: 原生格式 sections Record 往返（U3-SDK DatTokenizer 语法）", async () => {
    // U3-SDK 原生格式（DatTokenizer.cs / DatParser.cs）：区块 { } + key value 空格分隔 + // 注释
    const input =
      "Version 1\n" +
      "\n" +
      "Browser\n" +
      "{\n" +
      "\t// > Short description\n" +
      "\tDesc_Hint\n" +
      "\t// > Long description\n" +
      "\tDesc_Full hello\n" +
      "}\n" +
      "\n" +
      "Server\n" +
      "{\n" +
      "\t// > Default: True\n" +
      "\tVAC_Secure\n" +
      "\tMax_Ping_Milliseconds 750\n" +
      "}\n";
    await fs.writeFile(path.join(serverDir, "Config.txt"), input);

    const first = await svc.readConfigTxt(serverId);
    // 原生 section 名（无方括号）
    expect(first.sections.Browser?.entries).toContainEqual(
      expect.objectContaining({ key: "Desc_Hint", value: null }),
    );
    expect(first.sections.Browser?.entries).toContainEqual(
      expect.objectContaining({ key: "Desc_Full", value: "hello" }),
    );
    expect(first.sections.Server?.entries[0]?.key).toBe("VAC_Secure");

    await svc.writeConfigTxt(serverId, first);
    const second = await svc.readConfigTxt(serverId);
    expect(Object.keys(second.sections).sort()).toEqual(["Browser", "Server"]);
  });

  it("Config.txt: round-trip 保注释 + 保裸 key + 保 value", async () => {
    const input =
      "Version 1\n" +
      "Browser\n" +
      "{\n" +
      "\t// > auto comment\n" +
      "\tIcon\n" +
      "\tLogin_Token abc123\n" +
      "}\n";
    await fs.writeFile(path.join(serverDir, "Config.txt"), input);

    const first = await svc.readConfigTxt(serverId);
    await svc.writeConfigTxt(serverId, first);
    const second = await svc.readConfigTxt(serverId);

    // 注释保留（关联到 key）
    expect(second.sections.Browser?.entries[0]?.comment).toBe("auto comment");
    // 裸 key（value null）保留
    expect(second.sections.Browser?.entries[0]?.value).toBeNull();
    // 覆盖 key 保留 value
    expect(second.sections.Browser?.entries[1]?.value).toBe("abc123");
  });

  it("Config.txt: 未知嵌套结构（列表/嵌套块）rawBlocks 保留不丢", async () => {
    const input =
      "Version 1\n" +
      "Browser\n" +
      "{\n" +
      "\tLinks\n" +
      "\t[\n" +
      "\t\t{\n" +
      "\t\t\tMessage Hello\n" +
      "\t\t\tURL https://example.com\n" +
      "\t\t}\n" +
      "\t]\n" +
      "}\n";
    await fs.writeFile(path.join(serverDir, "Config.txt"), input);

    const first = await svc.readConfigTxt(serverId);
    await svc.writeConfigTxt(serverId, first);
    const second = await svc.readConfigTxt(serverId);

    // rawBlocks 保存了 Links 嵌套结构（首行 `Links [`）
    const raw = second.sections.Browser?.rawBlocks ?? [];
    expect(raw.some((b) => b.includes("Links"))).toBe(true);
  });

  it("Config.txt: 重复 key（U3DS 双份结构）合并为单条，保留最后一条", async () => {
    // 真实 U3DS 写回形态：同 section 内同 key 出现两次（基础裸 key + override 带值）。
    // 面板必须与 U3-SDK DatParser.cs:145（DatDictionary 唯一 key，后者覆盖前者）对齐——
    // 否则保存时只更新第一条、U3DS 读最后一条 → 用户配置被旧值覆盖（启动后"变默认"，Bug 1）。
    const input =
      "Version 1\n" +
      "Zombies\n" +
      "{\n" +
      "\tSpawn_Chance\n" +
      "\tLoot_Chance\n" +
      "\tSpawn_Chance 0\n" +
      "\tLoot_Chance 1\n" +
      "}\n";
    await fs.writeFile(path.join(serverDir, "Config.txt"), input);

    const parsed = await svc.readConfigTxt(serverId);
    const zombieEntries = parsed.sections.Zombies?.entries ?? [];
    const spawn = zombieEntries.filter((e) => e.key === "Spawn_Chance");
    const loot = zombieEntries.filter((e) => e.key === "Loot_Chance");
    // 每条 key 只剩一条（保留文件里最后一条 = U3DS 实际生效值）
    expect(spawn.length).toBe(1);
    expect(spawn[0]?.value).toBe("0");
    expect(loot.length).toBe(1);
    expect(loot[0]?.value).toBe("1");
  });

  it("Config.txt: 区块外散落覆盖字段归位到刚结束的区块，round-trip 不丢覆盖值", async () => {
    // U3DS 双份结构：区块内是默认裸 key，区块闭合后 root 层紧跟同一批字段的覆盖值。
    // 面板必须把散落覆盖值归位到对应区块并 dedup，否则保存后覆盖值丢失 → 配置变默认。
    const input =
      "Version 1\n" +
      "Server\n" +
      "{\n" +
      "\tVAC_Secure\n" +
      "\tMax_Ping_Milliseconds\n" +
      "}\n" +
      "VAC_Secure false\n" +
      "Max_Ping_Milliseconds\n" +
      "\n" +
      "Items\n" +
      "{\n" +
      "\tSpawn_Chance\n" +
      "}\n" +
      "Spawn_Chance 0.8\n";
    await fs.writeFile(path.join(serverDir, "Config.txt"), input);

    const parsed = await svc.readConfigTxt(serverId);
    // 覆盖值归位到区块：VAC_Secure 取散落层的 false（区块内裸 key 被覆盖）
    const serverEntries = parsed.sections.Server?.entries ?? [];
    const vac = serverEntries.filter((e) => e.key === "VAC_Secure");
    expect(vac.length).toBe(1);
    expect(vac[0]?.value).toBe("false");
    // Items 同样归位覆盖值
    const itemEntries = parsed.sections.Items?.entries ?? [];
    const spawn = itemEntries.filter((e) => e.key === "Spawn_Chance");
    expect(spawn.length).toBe(1);
    expect(spawn[0]?.value).toBe("0.8");

    // round-trip 写回：区块头 = 名字独占一行 + `{` 下一行（U3-SDK DatTokenizer 兼容格式）
    await svc.writeConfigTxt(serverId, parsed);
    const written = await fs.readFile(
      path.join(serverDir, "Config.txt"),
      "utf-8",
    );
    expect(written).toContain("Server\n{\n\tVAC_Secure false");
    expect(written).toContain("Items\n{\n\tSpawn_Chance 0.8");
    // 不残留 root 散落字段（区块外不再有带值的散落行，如裸的 `VAC_Secure false`）
    const scatteredValues = written
      .split("\n")
      .filter(
        (l) =>
          l.trim() &&
          !l.startsWith("\t") &&
          !l.startsWith("//") &&
          /\s+\S/.test(l.trim()) &&
          l.trim() !== "Version 1",
      );
    expect(scatteredValues).toEqual([]);
  });

  it("Workshop.json: 只写 File_IDs，其他字段不动", async () => {
    const input = JSON.stringify({
      File_IDs: ["1", "2"],
      Should_Monitor_Updates: true,
      Query_Cache_Max_Age_Seconds: 600,
      Max_Query_Retries: 2,
      Use_Cached_Downloads: true,
      Shutdown_Update_Detected_Timer: 600,
      Shutdown_Update_Detected_Message: "msg1",
      Shutdown_Kick_Message: "msg2",
    });
    // ★ BUG-2：U3-SDK 读 Servers/<id>/WorkshopDownloadConfig.json（无 Server/ 层）
    await fs.writeFile(
      path.join(serverDir, "WorkshopDownloadConfig.json"),
      input,
    );

    await svc.writeWorkshopFileIds(serverId, ["3", "4"]);
    const content = await fs.readFile(
      path.join(serverDir, "WorkshopDownloadConfig.json"),
      "utf-8",
    );
    const parsed = JSON.parse(content);
    expect(parsed.File_IDs).toEqual(["3", "4"]);
    expect(parsed.Should_Monitor_Updates).toBe(true);
    expect(parsed.Shutdown_Update_Detected_Message).toBe("msg1"); // 未被改写
  });

  // ★ 2026-08-14 实机根因回归：U3DS 启动时把 File_IDs 规范化为 number（ulong）写回，
  // 面板 zod schema 必须接受 number 并归一为 string，
  // 避免 /mods/downloaded 的 `fileIdsSet.has(stringFileId)` 永远 false → UI 全显示「未应用」。
  it("Workshop.json: File_IDs 兼容 U3DS 写的 number，read 归一为 string", async () => {
    // 模拟 U3DS 启动后写回的格式（List<ulong> 序列化为 JSON number）
    const input = JSON.stringify({
      File_IDs: [3775651116, 1234567890],
      Should_Monitor_Updates: true,
      Query_Cache_Max_Age_Seconds: 600,
      Max_Query_Retries: 2,
      Use_Cached_Downloads: true,
      Shutdown_Update_Detected_Timer: 600,
      Shutdown_Update_Detected_Message: "msg",
      Shutdown_Kick_Message: "msg2",
    });
    await fs.writeFile(
      path.join(serverDir, "WorkshopDownloadConfig.json"),
      input,
    );

    const read = await svc.readWorkshopConfig(serverId);
    // 归一后必须全是 string（与 acf VDF 解析的 string fileId 一致，Set.has 才匹配）
    expect(read.File_IDs).toEqual(["3775651116", "1234567890"]);
    for (const id of read.File_IDs) {
      expect(typeof id).toBe("string");
    }
  });

  it("Workshop.json: 写时归一为 string（不被 U3DS 改回 number）", async () => {
    // 写 string 数组（前端约定）
    await svc.writeWorkshopFileIds(serverId, ["3775651116", "1234567890"]);
    const content = await fs.readFile(
      path.join(serverDir, "WorkshopDownloadConfig.json"),
      "utf-8",
    );
    // 写盘必须是 string（带引号），不能是 number
    expect(content).toContain('"3775651116"');
    expect(content).toContain('"1234567890"');
    expect(content).not.toMatch(/\[(?:\d+,?\s*)+\]/); // 不能是纯数字数组
  });

  // ─── Loadout 重复行（CommandLoadout.cs:13-49 + PlayerSkills.cs:43-97）────────

  it("Loadout: 解析多行 Loadout 为结构化 loadouts 数组", async () => {
    // 11 = 军人（合法），3 = 农民，255 = 所有技能组；itemID = ushort 0–65535
    const input =
      [
        "Name MyServer",
        "Loadout 1/5/18/100",
        "Loadout 4/255",
        "Loadout 255/1/2/3",
        "UnknownKey customValue",
      ].join("\n") + "\n";
    await fs.writeFile(path.join(serverDir, "Server", "Commands.dat"), input);

    const record = await svc.readCommandsDat(serverId);

    // Loadout 行不进 known（CLAUDE.md §4.3 解析器契约）
    expect(record.known.Loadout).toBeUndefined();
    // 结构化解析到 loadouts 数组
    expect(record.loadouts).toEqual([
      { skillsetId: 1, itemIds: [5, 18, 100] },
      { skillsetId: 4, itemIds: [255] },
      { skillsetId: 255, itemIds: [1, 2, 3] },
    ]);
    // 其他键不受影响
    expect(record.known.Name).toBe("MyServer");
    expect(record.unknown.UnknownKey).toBe("customValue");
  });

  it("Loadout: 非法 SkillsetID (>10 且非 255) 与非法 itemID (>65535) 行被丢弃", async () => {
    const input =
      [
        "Loadout 1/5", // 合法 → 保留
        "Loadout 11/100", // 非法 skillsetId（>10 非 255） → 丢弃
        "Loadout 256/100", // 非法 skillsetId（byte 溢出）→ 丢弃
        "Loadout 2/99999", // 非法 itemID（>65535）→ 整行丢弃
        "Loadout 5", // 合法，无物品 → 保留
      ].join("\n") + "\n";
    await fs.writeFile(path.join(serverDir, "Server", "Commands.dat"), input);

    const record = await svc.readCommandsDat(serverId);

    expect(record.loadouts).toEqual([
      { skillsetId: 1, itemIds: [5] },
      { skillsetId: 5, itemIds: [] },
    ]);
  });

  it("Loadout: 序列化多 loadouts → 每行 Loadout <id>/<item>/<item>... 写回", async () => {
    await svc.writeCommandsDat(serverId, {
      known: { Name: "MyServer" },
      unknown: {},
      comments: [],
      loadouts: [
        { skillsetId: 1, itemIds: [5, 18] },
        { skillsetId: 2, itemIds: [1, 2, 3] },
      ],
    });

    const content = await fs.readFile(
      path.join(serverDir, "Server", "Commands.dat"),
      "utf-8",
    );
    const lines = content.trim().split("\n");

    // Loadout 行存在且格式正确（多技能组并存合法——D4）
    expect(lines).toContain("Loadout 1/5/18");
    expect(lines).toContain("Loadout 2/1/2/3");
    // 已知键 Loadout 不进 known 行——所以不会同时出现单行 'Loadout ...'
    expect(lines.filter((l) => l.startsWith("Loadout ")).length).toBe(2);
  });

  it("Loadout: 往返等价——读后写回内容稳定", async () => {
    const input =
      [
        "Name MyServer",
        "Loadout 1/5/18",
        "Loadout 2/1/2/3",
        "# trailing comment",
      ].join("\n") + "\n";
    await fs.writeFile(path.join(serverDir, "Server", "Commands.dat"), input);

    const first = await svc.readCommandsDat(serverId);
    await svc.writeCommandsDat(serverId, first);
    const second = await svc.readCommandsDat(serverId);

    expect(second.loadouts).toEqual(first.loadouts);
    expect(second.known).toEqual(first.known);
    expect(second.unknown).toEqual(first.unknown);
    expect(second.comments).toEqual(first.comments);
  });

  it("Loadout: 面板存非法 loadout 被序列化时跳过（防御层兜底）", async () => {
    // 即使前端构造出非法 entry，后端 serialize 也兜底跳过，不污染 Commands.dat
    await svc.writeCommandsDat(serverId, {
      known: { Name: "MyServer" },
      unknown: {},
      comments: [],
      loadouts: [
        { skillsetId: 1, itemIds: [5] }, // 合法
        { skillsetId: 99, itemIds: [10] }, // 非法 skillsetId → 跳过
        { skillsetId: 2, itemIds: [1, 2] }, // 合法
      ],
    });

    const content = await fs.readFile(
      path.join(serverDir, "Server", "Commands.dat"),
      "utf-8",
    );
    expect(content).toContain("Loadout 1/5");
    expect(content).toContain("Loadout 2/1/2");
    expect(content).not.toContain("Loadout 99/");
  });
});
