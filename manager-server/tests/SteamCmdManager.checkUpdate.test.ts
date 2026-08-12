/**
 * SteamCmdManager.checkUpdate 单测（BUG-1 闭环，2026-08-13）。
 *
 * 验证修复行为：
 *   - 本地 buildid == 远端 buildid → latestVersion: ""（前端"已是最新"）
 *   - 本地 buildid ≠ 远端 buildid → latestVersion: 远端 buildid（前端"有新版本"）
 *   - 本地 acf 缺失/解析失败 → 兜底为远端 buildid（未安装场景仍可提示更新）
 *   - installDir 未传 → 跳过本地对比，回落到原"远端有值即提示"语义
 *
 * 设计：颗粒度最小——只覆盖 checkUpdate 这一方法的本地对比逻辑，不触及其他方法。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { STEAM_APP_IDS } from '@unturned-manager/shared';
import type { IBroadcaster } from '@unturned-manager/shared';
import { SteamCmdManager } from '../src/modules/steamcmd/SteamCmdManager.js';
import type { ExecFileAdapter } from '../src/modules/steamcmd/SteamCmdManager.js';

// ─── Mock broadcaster（颗粒度最小：只记录 broadcast 调用）───────────────

interface RecordedEvent {
  type: string;
  jobId?: string;
  stage?: string;
  latestVersion?: string;
}

function createMockBroadcaster(): IBroadcaster & { events: RecordedEvent[] } {
  const events: RecordedEvent[] = [];
  return {
    events,
    broadcast(event: RecordedEvent) {
      events.push(event);
    },
  };
}

// ─── Fixture helpers ────────────────────────────────────────

/** 写临时 acf——SDG 官方 SteamCMD 安装后生成的 buildid 格式 */
async function writeAcf(
  installDir: string,
  buildId: string,
): Promise<string> {
  const manifestPath = path.join(
    installDir,
    'steamapps',
    `appmanifest_${STEAM_APP_IDS.U3DS_SERVER}.acf`,
  );
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(
    manifestPath,
    `"AppState"\n{\n"buildid"\t"${buildId}"\n}\n`,
    'utf8',
  );
  return manifestPath;
}

/** 构造 mock stdout——模拟 SteamCMD app_info_print 输出 */
function makeStdout(buildId: string): string {
  return [
    'App info for app 1110390:',
    '  name         "Unturned Dedicated Server"',
    `  buildid      "${buildId}"`,
    '  ...',
  ].join('\n');
}

// ─── Test setup ─────────────────────────────────────────────

describe('SteamCmdManager.checkUpdate — BUG-1 本地 vs 远端对比闭环', () => {
  let tempDir: string;
  let fakeSteamCmdPath: string;
  let broadcaster: ReturnType<typeof createMockBroadcaster>;
  let execAdapter: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    // 临时安装目录（同时充当 U3DS installDir 和"假装是 SteamCMD 二进制"的探测点）
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'steamcmd-check-test-'));
    // getExePath → resolveExecutable 会 stat 这个文件，存在即视为可执行
    fakeSteamCmdPath = path.join(tempDir, 'fakeSteamCmd');
    await fs.writeFile(fakeSteamCmdPath, '#!/bin/sh\necho fake\n');

    broadcaster = createMockBroadcaster();
    execAdapter = vi.fn<ExecFileAdapter>();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /** 触发 checkUpdate + 等后台异步完成 + 过滤出目标 jobId 的 completed 事件 */
  async function runCheckUpdate(installDir: string | undefined) {
    const mgr = new SteamCmdManager(
      {} as never,                  // processSupervisor: checkUpdate 不用
      broadcaster,
      fakeSteamCmdPath,
      () => [],                     // activeProbe
      execAdapter,                  // execFileAdapter 注入点
    );

    // mock execFileAdapter 第一次 attempt 即返回成功 stdout
    execAdapter.mockResolvedValue({ stdout: makeStdout('12345678') });

    const jobId = await mgr.checkUpdate(installDir);

    // 后台异步：等 broadcast events 出现 completed 事件（最多 1s）
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline) {
      const done = broadcaster.events.find(
        (e) => e.jobId === jobId && e.stage === 'completed',
      );
      if (done) return done;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('checkUpdate 后台未在 1s 内 broadcast completed');
  }

  // ── 用例 1：本地 == 远端 → 已是最新（latestVersion = ""）──

  it('本地 buildid == 远端 buildid → latestVersion 为空串（前端渲染"已是最新"）', async () => {
    await writeAcf(tempDir, '12345678'); // 与 mock 远端一致
    const event = await runCheckUpdate(tempDir);
    expect(event.latestVersion).toBe('');
  });

  // ── 用例 2：本地 ≠ 远端 → 有新版本（latestVersion = 远端）──

  it('本地 buildid ≠ 远端 buildid → latestVersion 为远端 buildid（前端渲染"有新版本"）', async () => {
    await writeAcf(tempDir, '99999999'); // 与 mock 远端 12345678 不一致
    const event = await runCheckUpdate(tempDir);
    expect(event.latestVersion).toBe('12345678');
  });

  // ── 用例 3：本地 acf 缺失 → 兜底为远端 buildid（未安装场景仍可提示更新）──

  it('本地 appmanifest acf 缺失 → 兜底返回远端 buildid', async () => {
    // 不写 acf → ENOENT
    const event = await runCheckUpdate(tempDir);
    expect(event.latestVersion).toBe('12345678');
  });

  // ── 用例 4：本地 acf VDF 损坏 → 兜底为远端 buildid ──

  it('本地 acf VDF 解析失败 → 兜底返回远端 buildid', async () => {
    const manifestPath = path.join(
      tempDir,
      'steamapps',
      `appmanifest_${STEAM_APP_IDS.U3DS_SERVER}.acf`,
    );
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(manifestPath, 'this is not valid VDF {{{{', 'utf8');
    const event = await runCheckUpdate(tempDir);
    expect(event.latestVersion).toBe('12345678');
  });

  // ── 用例 5：installDir 未传 → 跳过本地对比，落到远端 buildid ──

  it('installDir 未传 → 跳过本地对比，回落远端 buildid（原契约兼容）', async () => {
    const event = await runCheckUpdate(undefined);
    expect(event.latestVersion).toBe('12345678');
  });
});