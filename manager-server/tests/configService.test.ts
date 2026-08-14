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
    ).rejects.toMatchObject({ code: "loadout-mutually-exclusive", status: 400 });
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

  it("Config.txt: sections Record 往返", async () => {
    // ConfigService parseConfigTxt 只认 '=' 或 ':' 分隔（当前实现），所以测试用等号
    const input =
      "[Browser]\nLogin_Token=abc123\nDesc_Full=hello\n\n[Server]\nVAC_Secure=true\n";
    await fs.writeFile(path.join(serverDir, "Config.txt"), input);

    const first = await svc.readConfigTxt(serverId);
    expect(first.sections.Browser?.entries).toContainEqual(
      expect.objectContaining({ key: "Login_Token", value: "abc123" }),
    );
    expect(first.sections.Server?.entries[0]?.key).toBe("VAC_Secure");

    await svc.writeConfigTxt(serverId, first);
    const second = await svc.readConfigTxt(serverId);
    expect(Object.keys(second.sections).sort()).toEqual(["Browser", "Server"]);
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
