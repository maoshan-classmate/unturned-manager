import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import { SteamCmdManager, type ExecFileAdapter } from '../src/modules/steamcmd/SteamCmdManager.js';
import type { IProcessSupervisor, IBroadcaster } from '@unturned-manager/shared';

// ─── 测试替身 ─────────────────────────────────────────────

const fakeProcessSupervisor = {
  spawn: vi.fn(),
  onStdout: vi.fn(),
  waitForExit: vi.fn().mockResolvedValue(undefined),
  forceKill: vi.fn(),
  onCrash: vi.fn(),
  destroy: vi.fn().mockResolvedValue(undefined),
} as unknown as IProcessSupervisor;

const fakeBroadcaster = {
  broadcast: vi.fn(),
  init: vi.fn(),
  register: vi.fn(),
  unregister: vi.fn(),
  destroy: vi.fn().mockResolvedValue(undefined),
} as unknown as IBroadcaster;

/** 构造可控的 execFileAdapter —— 单测里直接调 mockReturnValueOnce */
function mockAdapter(): ExecFileAdapter & ReturnType<typeof vi.fn> {
  return vi.fn() as unknown as ExecFileAdapter & ReturnType<typeof vi.fn>;
}

// ─── 测试 ────────────────────────────────────────────────

describe('SteamCmdManager — BUG-9 修复: getStatus version 字段', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getStatus 当 SteamCMD 未安装时返回 isInstalled=false 且 version=undefined', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const exec = mockAdapter();
    const manager = new SteamCmdManager(fakeProcessSupervisor, fakeBroadcaster, '/nonexistent/steamcmd', () => [], exec);

    const status = await manager.getStatus();

    expect(status.isInstalled).toBe(false);
    expect(status.version).toBeUndefined();
    // installPath 是构造器传入的 steamCmdPath（即使 isInstalled=false 也带回）
    expect(status.installPath).toBe('/nonexistent/steamcmd');
    expect(status.lastChecked).toBeDefined();
    expect(exec).not.toHaveBeenCalled();  // 未安装就不 spawn
  });

  it('getStatus 当 SteamCMD 已安装时 spawn +version 解析 version 字段', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const exec = mockAdapter();
    exec.mockResolvedValueOnce({
      stdout: 'Steam Console Client (Linux) Version 1719583862 - 2024-06-27T00:00:00 UTC\n',
      stderr: '',
    });

    const manager = new SteamCmdManager(fakeProcessSupervisor, fakeBroadcaster, '/opt/steamcmd/steamcmd.sh', () => [], exec);
    const status = await manager.getStatus();

    expect(status.isInstalled).toBe(true);
    expect(status.installPath).toBe('/opt/steamcmd/steamcmd.sh');
    expect(status.version).toBe('1719583862 (2024-06-27T00:00:00 UTC)');
    expect(exec).toHaveBeenCalledWith('/opt/steamcmd/steamcmd.sh', ['+version', '+quit'], { timeout: 10_000 });
  });

  it('getStatus 当 steamcmd +version 解析失败时仍返回 isInstalled=true 但 version=undefined（兜底）', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const exec = mockAdapter();
    exec.mockRejectedValueOnce(new Error('spawn failed'));

    const manager = new SteamCmdManager(fakeProcessSupervisor, fakeBroadcaster, '/opt/steamcmd/steamcmd.sh', () => [], exec);
    const status = await manager.getStatus();

    expect(status.isInstalled).toBe(true);
    expect(status.version).toBeUndefined();  // 兜底：不抛错
  });
});

describe('SteamCmdManager — BUG-1 修复: checkUpdate 解析', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('checkUpdate 当 SteamCMD 未安装时抛 AppError(steamcmd-not-found, 404)', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const exec = mockAdapter();
    const manager = new SteamCmdManager(fakeProcessSupervisor, fakeBroadcaster, '/nonexistent/steamcmd', () => [], exec);

    await expect(manager.checkUpdate()).rejects.toMatchObject({
      code: 'steamcmd-not-found',
      status: 404,
    });
    expect(exec).not.toHaveBeenCalled();
  });

  it('checkUpdate 解析 +app_info_print 输出: buildid + name + lastChecked', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const fakeStdout = `
"1110390"
{
  "appid"     "1110390"
  "name"     "Unturned Dedicated Server"
  "buildid"     "12345678"
}
    `;
    const exec = mockAdapter();
    exec.mockResolvedValueOnce({ stdout: fakeStdout, stderr: '' });

    const manager = new SteamCmdManager(fakeProcessSupervisor, fakeBroadcaster, '/opt/steamcmd/steamcmd.sh', () => [], exec);
    const result = await manager.checkUpdate();

    expect(result.currentBuildId).toBe('12345678');
    expect(result.latestVersion).toBe('Unturned Dedicated Server');
    expect(result.lastChecked).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('checkUpdate 当输出无 buildid/name 时降级返回 null 和 unknown', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const exec = mockAdapter();
    exec.mockResolvedValueOnce({ stdout: 'no useful output', stderr: '' });

    const manager = new SteamCmdManager(fakeProcessSupervisor, fakeBroadcaster, '/opt/steamcmd/steamcmd.sh', () => [], exec);
    const result = await manager.checkUpdate();

    expect(result.currentBuildId).toBeNull();
    expect(result.latestVersion).toBe('unknown');
  });
});
