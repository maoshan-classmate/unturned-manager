import { describe, it, expect, beforeAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import Database from "better-sqlite3";
import * as argon2 from "argon2";
import fs from "fs/promises";
import path from "path";
import os from "os";

import { buildContainer } from "../src/composition-root.js";
import { setAuthService } from "../src/middleware/auth.js";
import { createAuthRouter } from "../src/routes/auth.js";
import { createServersRouter } from "../src/routes/servers.js";
import { createModsRouter } from "../src/routes/mods.js";
import { createModBrowseRouter } from "../src/routes/mod-browse.js";
import { errorHandler } from "../src/middleware/errorHandler.js";
import { setSetting } from "../src/modules/settings/settingsStorage.js";
import { resolveInstallDir } from "../src/modules/server/pathResolver.js";

let db: Database.Database;
let app: express.Express;
let accessToken: string;
let container: ReturnType<typeof buildContainer>;

// ─── 全局 fetch mock（不连真 Steam） ────────────────────
const originalFetch = global.fetch;

/** 从 GetDetails URL 里提取 fileIds（兼容 URL 编码 `publishedfileids%5B0%5D=X` 和原始 `publishedfileids[0]=X`） */
function extractFileIdsFromUrl(u: string): string[] {
  const decoded = decodeURIComponent(u);
  const ids: string[] = [];
  const re = /publishedfileids(?:\[\d*\])?=(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(decoded)) !== null) {
    ids.push(m[1]!);
  }
  return ids;
}

/** GetDetails mock 的 mod 详情表（fileId → 详情） */
const DETAILS_FIXTURES: Record<string, Record<string, unknown>> = {
  "111": {
    publishedfileid: "111",
    result: 1,
    title: "Hawaii",
    creator: "76561198000000001",
    file_description: "[h1]Tropical map[/h1]",
    preview_url: "https://example.com/111.jpg",
    file_size: 12345678,
    time_updated: 1722612345,
    // GetDetails 带 includevotes 时返回投票数据（回归保护：详情评分不丢）
    vote_data: { score: 0.6, votes_up: 10, votes_down: 2 },
  },
  "222": {
    publishedfileid: "222",
    result: 1,
    title: "Zombie Survival",
    creator: "76561198000000002",
    file_description: "Survive the horde",
    preview_url: "https://example.com/222.jpg",
    file_size: 8765432,
    time_updated: 1722612789,
  },
  "555": {
    publishedfileid: "555",
    result: 1,
    title: "Mod 555",
    creator: "76561198000000002",
    file_description: "desc 555",
    preview_url: "https://example.com/555.jpg",
    file_size: 999,
    time_updated: 1722612345,
  },
};

beforeAll(async () => {
  // 内存 DB + 全部 schema
  db = new Database(":memory:");
  db.pragma("journal_mode = MEMORY");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE refresh_tokens (
      jti TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at TEXT NOT NULL,
      revoked_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE settings (
      key TEXT PRIMARY KEY, value_enc TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // seed admin
  const hash = await argon2.hash("admin123");
  db.prepare(
    "INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)",
  ).run("admin", hash);

  // 设 WebAPI Key（让 Steam API 调用不抛 503）
  setSetting(
    db,
    "steam_webapi_key",
    "TEST_FAKE_KEY_FOR_UNIT_TEST_ONLY_32CHARS",
  );

  // mock fetch（让 Steam WebAPI 走预设响应，不连真 Steam）
  global.fetch = vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes("/QueryFiles/v1/")) {
      // QueryFiles 一次返回全字段（browse 只调 QueryFiles，不再二次 GetDetails）
      return new Response(
        JSON.stringify({
          response: {
            total: 2,
            publishedfiledetails: [
              {
                publishedfileid: "111",
                title: "Hawaii",
                creator: "76561198000000001",
                file_description: "[h1]Tropical map[/h1]",
                preview_url: "https://example.com/111.jpg",
                file_size: 12345678,
                time_updated: 1722612345,
                vote_data: { score: 0.537, votes_up: 8, votes_down: 0 },
              },
              {
                publishedfileid: "222",
                title: "Zombie Survival",
                creator: "76561198000000002",
                file_description: "Survive the horde",
                preview_url: "https://example.com/222.jpg",
                file_size: 8765432,
                time_updated: 1722612789,
                vote_data: { score: 0.82, votes_up: 20, votes_down: 2 },
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (u.includes("/GetDetails/v1/")) {
      const fileIds = extractFileIdsFromUrl(u);
      const details = fileIds
        .map(
          (id) =>
            DETAILS_FIXTURES[id] ?? {
              publishedfileid: id,
              result: 1,
              title: `Mod ${id}`,
              creator: "76561198000000002",
              file_description: "desc",
              file_size: 100,
              time_updated: 1722612345,
            },
        )
        .filter(Boolean);
      return new Response(
        JSON.stringify({ response: { publishedfiledetails: details } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (u.includes("/GetPlayerSummaries/v2/")) {
      return new Response(
        JSON.stringify({
          response: {
            players: [
              { steamid: "76561198000000001", personaname: "Renaxon" },
              { steamid: "76561198000000002", personaname: "TestAuthor" },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  // ADR-0003 B2：实例身份=目录存在性。清理 MyServer——防上次 run 残留 Commands.dat 误触发 409
  await fs.rm(path.join(resolveInstallDir(), "Servers", "MyServer"), {
    recursive: true,
    force: true,
  });

  container = buildContainer(db);
  setAuthService(
    container.authService as import("../src/modules/auth/AuthService.js").AuthService,
  );

  // mock SteamCMD 下载（不真 spawn）—— BUG-5/6 异步启动返回 jobId
  vi.spyOn(container.steamCmdManager, "downloadWorkshopItem").mockResolvedValue(
    "steamcmd-download-test",
  );

  app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/api/auth", createAuthRouter(container.authService));
  app.use("/api/servers", createServersRouter(container.serverManager));
  app.use("/api/mods", createModBrowseRouter(container.workshopMeta));
  app.use(
    "/api/servers/:id",
    createModsRouter(
      container.serverManager,
      container.workshopMeta,
      container.workshopAcf,
      container.workshopDelete,
      container.steamCmdManager,
      container.configService,
    ),
  );
  app.use(errorHandler);

  // login 拿 token
  const loginRes = await request(app)
    .post("/api/auth/login")
    .send({ username: "admin", password: "admin123" })
    .expect(200);
  accessToken = loginRes.body.data.accessToken;

  // 创建 MyServer（POST /api/servers 会触发 ServerManager.createServer，
  // 该方法会 INSERT DB + set 到 in-memory Map，listServers 立即可见）
  // installDir 传 resolveInstallDir()（全局 .test-install）——routes local resolveInstallDir 读
  // ServerManager.config.installDir，Config/Workshop 服务读 config.installDir，三者必须指向同一根
  await request(app)
    .post("/api/servers")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({
      id: "MyServer",
      name: "Test",
      gamePort: 27015,
      ownerSteamId: "76561198000000001",
      installDir: resolveInstallDir(),
    })
    .expect(201);
});

// ─── 8 端点集成测试 ─────────────────────────────────────

describe("routes/mods · 8 端点", () => {
  it("GET /mods/search → 200 + Steam 元数据（QueryFiles 全字段 + 评分）", async () => {
    const res = await request(app)
      .get(
        "/api/mods/search?q=tropical&page=1&pageSize=10&sort=popular&range=week&type=text",
      )
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.rows).toHaveLength(2);
    expect(res.body.data.rows[0].fileId).toBe("111");
    expect(res.body.data.rows[0].title).toBe("Hawaii");
    expect(res.body.data.rows[0].author).toBe("76561198000000001"); // 作者显示 SteamID
    expect(res.body.data.rows[0].voteScore).toBeCloseTo(0.537 * 5, 1); // 评分 0-1 → 0-5
    expect(res.body.data.rows[0].description).toContain("Tropical map"); // BBCode 由前端 stripBbcode() 兜底
  });

  it("GET /mods/search → 400 缺 sort", async () => {
    await request(app)
      .get("/api/mods/search?sort=invalid")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(400);
  });

  it("GET /mods/search → 401 无 token", async () => {
    await request(app).get("/api/mods/search").expect(401);
  });

  it("GET /mods/:fileId → 200 + 详情（含评分 voteScore，回归保护）", async () => {
    const res = await request(app)
      .get("/api/mods/111")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body.data.fileId).toBe("111");
    expect(res.body.data.title).toBe("Hawaii");
    // score 0.6 → voteScore 3.0（GetDetails 必须带 includevotes 才有此字段）
    expect(res.body.data.voteScore).toBeCloseTo(3, 5);
  });

  it("POST /mods/batch-details → 200 + 批量元数据", async () => {
    const res = await request(app)
      .post("/api/mods/batch-details")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ fileIds: ["111", "222"] })
      .expect(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].fileId).toBe("111");
    expect(res.body.data[0].title).toBe("Hawaii");
    expect(res.body.data[0].author).toBe("76561198000000001"); // 批量场景不查作者名，显示 SteamID
  });

  it("POST /mods/batch-details → 400 空数组", async () => {
    await request(app)
      .post("/api/mods/batch-details")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ fileIds: [] })
      .expect(400);
  });

  it("GET /mods/acf → 200 + 空 acf 列表", async () => {
    const res = await request(app)
      .get("/api/servers/MyServer/mods/acf")
      .set("Authorization", `Bearer ${accessToken}`);
    if (res.status !== 200 || res.body.data?.items === undefined) {
      console.log("DEBUG acf res:", res.status, JSON.stringify(res.body));
    }
    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([]);
    expect(res.body.data.parsedAt).toBeTruthy();
  });

  it("POST /mods/download → 202 + jobId（异步启动，BUG-5/6）", async () => {
    // steamCmd.downloadWorkshopItem 已全局 mock（beforeAll）——异步启动立即返回 jobId
    const res = await request(app)
      .post("/api/servers/MyServer/mods/download")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ fileId: "333" })
      .expect(202);
    expect(res.body.data.jobId).toBe("steamcmd-download-test");
    expect(res.body.data.fileId).toBe("333");
    expect(res.body.data.modTitle).toBe("Mod 333"); // GetDetails mock 动态返回
    // BUG-5/6：不再同步等下载完成/读 acf——前端靠 WS completed 刷新已下载列表
    expect(res.body.data.acfItem).toBeUndefined();
  });

  it("POST /mods/download → 400 无 fileId", async () => {
    await request(app)
      .post("/api/servers/MyServer/mods/download")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({})
      .expect(400);
  });

  it("POST /mods/apply → 202 + operationId（异步执行）", async () => {
    // 模拟运行时：先让服务端进入 RUNNING 状态，再 apply
    // 但 RUNNING 状态需要 RCON 全 mock；这里仅测 202 响应，apply 内部会失败但前端只看 operationId
    const res = await request(app)
      .post("/api/servers/MyServer/mods/apply")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ fileIds: ["111", "222"] })
      .expect(202);
    expect(res.body.data.operationId).toMatch(/^apply_/);
    expect(res.body.data.status).toBe("running");
  });

  it("DELETE /mods/:fileId → 200（STOPPED + activeOperation=none 应成功）", async () => {
    // 实际：STOPPED + activeOperation=none → delete 应成功
    // 写一个假的 acf 让它有东西可删（路径根 = resolveInstallDir()，与 WorkshopDeleteService 读取一致）
    const serverDir = path.join(resolveInstallDir(), "Servers", "MyServer");
    // ★ BUG-3：U3DS 实际读取路径带 Steam/ 层（DedicatedUGC.cs:560-567）
    const workshopDir = path.join(
      serverDir,
      "Workshop",
      "Steam",
      "steamapps",
      "workshop",
    );
    const contentDir = path.join(workshopDir, "content", "304930", "444");
    await fs.mkdir(contentDir, { recursive: true });
    await fs.writeFile(path.join(contentDir, "dummy.txt"), "x", "utf-8");
    await fs.writeFile(
      path.join(workshopDir, "appworkshop_304930.acf"),
      `"AppWorkshop"
{
	"appid"		"304930"
	"WorkshopItemsInstalled"
	{
		"444"
		{
			"timeupdated"		"1722612345"
			"size"				"100"
		}
	}
}`,
      "utf-8",
    );
    // 写 WorkshopDownloadConfig.json 让 rollback 有东西可回
    // ★ BUG-2：U3-SDK 读 Servers/<ID>/WorkshopDownloadConfig.json（无 Server/ 层）
    await fs.writeFile(
      path.join(serverDir, "WorkshopDownloadConfig.json"),
      JSON.stringify({ File_IDs: ["444"] }, null, 2),
      "utf-8",
    );

    // ADR-0003 / T2：不再 UPDATE servers.install_dir——Config/Workshop 服务走全局 config.installDir
    const res = await request(app)
      .delete("/api/servers/MyServer/mods/444")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body.data.success).toBe(true);
    expect(res.body.data.removedFrom).toEqual(
      expect.arrayContaining(["acf", "content", "file_ids"]),
    );

    // 清理（只清本项目测试目录）
    await fs.rm(serverDir, { recursive: true, force: true });
  });

  it("GET /mods/downloaded → 200 + 已下载列表", async () => {
    // 复用 delete 测试的 fixture — 但已被删除，单独再写一个
    const serverDir = path.join(resolveInstallDir(), "Servers", "MyServer");
    // ★ BUG-3：U3DS 实际读取路径带 Steam/ 层（DedicatedUGC.cs:560-567）
    const workshopDir = path.join(
      serverDir,
      "Workshop",
      "Steam",
      "steamapps",
      "workshop",
    );
    await fs.mkdir(workshopDir, { recursive: true });
    await fs.writeFile(
      path.join(workshopDir, "appworkshop_304930.acf"),
      `"AppWorkshop"
{
	"appid"		"304930"
	"WorkshopItemsInstalled"
	{
		"555"
		{
			"timeupdated"		"1722612345"
			"size"				"999"
		}
	}
}`,
      "utf-8",
    );

    const res = await request(app)
      .get("/api/servers/MyServer/mods/downloaded")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].fileId).toBe("555");
    expect(res.body.data[0].title).toBe("Mod 555"); // GetDetails mock 动态返回

    await fs.rm(serverDir, { recursive: true, force: true });
  });

  it("GET /mods/downloaded → BUG-5/6 修复：staging 待 apply 的 mod 也可见", async () => {
    // 关键场景：下载到 staging（SteamCMD workshop_download_item 后），主 acf 尚未更新，
    // 但 /mods/downloaded 必须能看到该 mod（applied=false，前端显示「待应用/已下载」）
    const serverDir = path.join(resolveInstallDir(), "Servers", "MyServer");
    // 只写 staging acf，不写主 acf —— 模拟「下载完还没 apply」
    const stagingDir = path.join(
      serverDir,
      "Workshop",
      "staging",
      "steamapps",
      "workshop",
    );
    await fs.mkdir(stagingDir, { recursive: true });
    await fs.writeFile(
      path.join(stagingDir, "appworkshop_304930.acf"),
      `"AppWorkshop"
{
	"appid"		"304930"
	"WorkshopItemsInstalled"
	{
		"666"
		{
			"timeupdated"		"1722612346"
			"size"				"888"
		}
	}
}`,
      "utf-8",
    );

    const res = await request(app)
      .get("/api/servers/MyServer/mods/downloaded")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    // ★ BUG-5/6 缺口断言：staging 的 mod 必须出现，且 applied=false（不在 File_IDs）
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].fileId).toBe("666");
    expect(res.body.data[0].applied).toBe(false);
    expect(res.body.data[0].title).toBe("Mod 666"); // GetDetails mock 动态返回

    await fs.rm(serverDir, { recursive: true, force: true });
  });
});
