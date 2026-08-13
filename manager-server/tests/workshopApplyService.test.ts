import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import { WorkshopApplyService } from "../src/modules/workshop/WorkshopApplyService.js";
import { resolveInstallDir } from "../src/modules/server/pathResolver.js";
import type {
  IBroadcaster,
  IConfigService,
  ServerId,
  ServerEvent,
  WorkshopFileId,
} from "@unturned-manager/shared";

// ─── 测试基础设施 ────────────────────────────────────────

const SERVER_ID = "ApplyServer" as ServerId;
const FILE_ID_A = "100000000001" as WorkshopFileId;
const FILE_ID_B = "100000000002" as WorkshopFileId;

const installDir = resolveInstallDir();
const serverDir = path.join(installDir, "Servers", SERVER_ID);

// staging 与 content 路径——真源对齐 WorkshopApplyService.ts 内的常量
// ★ 2026-08-14 实机根因：staging 路径仍带 steamapps/workshop（SteamCMD 标准结构），
// content 路径去 steamapps/workshop（U3DS `DedicatedUGC.cs:560` 真实只到 Workshop/Steam/）。
const STAGING_CONTENT = path.join(
  serverDir,
  "Workshop",
  "staging",
  "steamapps",
  "workshop",
  "content",
  "304930",
);
const CONTENT_DIR = path.join(
  serverDir,
  "Workshop",
  "Steam",
  "content",
  "304930",
);
const STAGING_ACF_DIR = path.join(
  serverDir,
  "Workshop",
  "staging",
  "steamapps",
  "workshop",
);
const STAGING_ACF_PATH = path.join(STAGING_ACF_DIR, "appworkshop_304930.acf");

// v2.6：WorkshopApplyService 新接口——构造时注入 IWorkshopAcfService +
// _configService（保留以备未来扩展，applyStaged 不再调用）+ IBroadcaster
function makeSvc(opts?: {
  acfService?: unknown;
  configService?: IConfigService;
  broadcaster?: IBroadcaster & { events: ServerEvent[] };
}) {
  const events: ServerEvent[] = [];
  const broadcaster = opts?.broadcaster ?? {
    events,
    broadcast: vi.fn((e: ServerEvent) => events.push(e)),
    register: vi.fn(),
    unregister: vi.fn(),
    registerRequestHandler: vi.fn(),
    destroy: vi.fn(async () => {}),
  };
  const configService =
    opts?.configService ??
    ({
      // v2.6 ★ 关键断言点：writeWorkshopFileIds 不应被触发
      writeWorkshopFileIds: vi.fn(async () => {}),
      backup: vi.fn(async () => "/tmp/backup.json"),
      rollback: vi.fn(async () => {}),
    } as unknown as IConfigService);

  // 简化版 acfService mock：只暴露 applyStaged 内部实际用到的方法
  const acfService =
    opts?.acfService ??
    ({
      listItems: vi.fn(async () => []),
      parse: vi.fn(async () => ({ items: new Map() })),
      addItem: vi.fn(async () => {}),
      backup: vi.fn(async () => "/tmp/acf.bak"),
      rollback: vi.fn(async () => {}),
    });

  return {
    svc: new WorkshopApplyService(
      acfService as never,
      configService,
      broadcaster as never,
    ),
    acfService,
    configService,
    broadcaster,
  };
}

async function writeAcf(items: Array<{ fileId: string; size?: number }>) {
  await fs.mkdir(STAGING_ACF_DIR, { recursive: true });
  const entries = items
    .map(
      (it) =>
        `  "${it.fileId}"\n  {\n    "timeupdated"  "${Math.floor(Date.now() / 1000)}"\n    "size"  "${it.size ?? 100}"\n  }`,
    )
    .join("\n");
  const body = `"AppWorkshop"\n{\n  "WorkshopItemsInstalled"\n  {\n${entries}\n  }\n}\n`;
  await fs.writeFile(STAGING_ACF_PATH, body, "utf-8");
}

beforeEach(async () => {
  await fs.rm(serverDir, { recursive: true, force: true });
});

afterEach(async () => {
  await fs.rm(serverDir, { recursive: true, force: true });
});

// ─── 主行为 ────────────────────────────────────────────

describe("WorkshopApplyService · applyStaged (v2.6：仅移动，不碰 File_IDs)", () => {
  it("staging acf 为空 → 直接 return，不触发任何写操作", async () => {
    const { svc, acfService, configService, broadcaster } = makeSvc();

    await svc.applyStaged(SERVER_ID);

    expect(acfService.addItem).not.toHaveBeenCalled();
    expect((configService as any).writeWorkshopFileIds).not.toHaveBeenCalled(); // ★ 不写 File_IDs
    expect((configService as any).backup).not.toHaveBeenCalled(); // v2.6 ★ 不再备份 config
    const ready = broadcaster.events.filter(
      (e) => e.type === "mod_apply_progress",
    );
    expect(ready.length).toBe(0); // 空跳过不广播
  });

  it("staging 有新 mod → addItem + mv staging→content；不调 writeWorkshopFileIds", async () => {
    await fs.mkdir(path.join(STAGING_CONTENT, FILE_ID_A), { recursive: true });
    await fs.mkdir(path.join(STAGING_CONTENT, FILE_ID_B), { recursive: true });
    await writeAcf([
      { fileId: FILE_ID_A, size: 100 },
      { fileId: FILE_ID_B, size: 200 },
    ]);

    const { svc, acfService, configService, broadcaster } = makeSvc();
    await svc.applyStaged(SERVER_ID);

    // 两个 addItem 都触发了
    expect(acfService.addItem).toHaveBeenCalledTimes(2);

    // 文件确实从 staging 移到 content
    await expect(fs.access(path.join(CONTENT_DIR, FILE_ID_A))).resolves.toBeUndefined();
    await expect(fs.access(path.join(CONTENT_DIR, FILE_ID_B))).resolves.toBeUndefined();
    await expect(fs.access(path.join(STAGING_CONTENT, FILE_ID_A))).rejects.toThrow();

    // ★ v2.6 关键断言：writeWorkshopFileIds 不被调用（File_IDs 由「保存」唯一写入）
    expect((configService as any).writeWorkshopFileIds).not.toHaveBeenCalled();

    // ready 广播
    const ready = broadcaster.events.find(
      (e) => e.type === "mod_apply_progress",
    );
    expect(ready).toBeDefined();
    if (ready && ready.type === "mod_apply_progress") {
      expect(ready.stage).toBe("ready");
      expect(ready.message).toContain("2 个 mod");
    }
  });

  it("staging 含已存在的 mod → addItem 跳过，但仍尝试 mv（content 已存在则覆盖）", async () => {
    // content 已存在 FILE_ID_A（acf 列表返回它）
    await fs.mkdir(path.join(CONTENT_DIR, FILE_ID_A), { recursive: true });
    await fs.writeFile(path.join(CONTENT_DIR, FILE_ID_A, "old.txt"), "old");
    // staging 有同样 fileId
    await fs.mkdir(path.join(STAGING_CONTENT, FILE_ID_A), { recursive: true });
    await fs.writeFile(path.join(STAGING_CONTENT, FILE_ID_A, "new.txt"), "new");
    await writeAcf([{ fileId: FILE_ID_A, size: 100 }]);

    const { svc, acfService, configService } = makeSvc({
      acfService: {
        listItems: vi.fn(async () => [
          {
            fileId: FILE_ID_A,
            timeupdated: 0,
            size: 100,
          },
        ]),
        parse: vi.fn(async () => ({ items: new Map() })),
        addItem: vi.fn(async () => {}),
      },
    });
    await svc.applyStaged(SERVER_ID);

    // 已有 → addItem 跳过
    expect(acfService.addItem).not.toHaveBeenCalled();
    // 但仍写 File_IDs？★ 仍不写
    expect((configService as any).writeWorkshopFileIds).not.toHaveBeenCalled();
    // 内容被 mv 覆盖
    await expect(
      fs.readFile(path.join(CONTENT_DIR, FILE_ID_A, "new.txt"), "utf-8"),
    ).resolves.toBe("new");
    await expect(
      fs.readFile(path.join(CONTENT_DIR, FILE_ID_A, "old.txt"), "utf-8"),
    ).rejects.toThrow();
  });

  it("addItem 失败 → 上抛、广播 failed；不写 File_IDs、不回滚 config", async () => {
    await fs.mkdir(path.join(STAGING_CONTENT, FILE_ID_A), { recursive: true });
    await writeAcf([{ fileId: FILE_ID_A, size: 100 }]);

    const { configService, broadcaster } = makeSvc({
      acfService: {
        listItems: vi.fn(async () => []),
        parse: vi.fn(async () => ({ items: new Map() })),
        addItem: vi.fn(async () => {
          throw new Error("磁盘满");
        }),
      },
    });

    const svc = new WorkshopApplyService(
      {
        listItems: vi.fn(async () => []),
        parse: vi.fn(async () => ({ items: new Map() })),
        addItem: vi.fn(async () => {
          throw new Error("磁盘满");
        }),
      } as never,
      configService,
      broadcaster as never,
    );

    await expect(svc.applyStaged(SERVER_ID)).rejects.toThrow(/磁盘满/);

    expect((configService as any).writeWorkshopFileIds).not.toHaveBeenCalled();
    expect((configService as any).rollback).not.toHaveBeenCalled(); // v2.6 ★ 不再回滚 config
    const failed = broadcaster.events.find(
      (e) => e.type === "mod_apply_progress",
    );
    expect(failed).toBeDefined();
    if (failed && failed.type === "mod_apply_progress") {
      expect(failed.stage).toBe("failed");
    }
  });
});