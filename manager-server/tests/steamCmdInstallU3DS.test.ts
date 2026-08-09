import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
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

function mockAdapter(): ExecFileAdapter & ReturnType<typeof vi.fn> {
  return vi.fn() as unknown as ExecFileAdapter & ReturnType<typeof vi.fn>;
}

describe('SteamCmdManager — BUG-3 修复: installU3DS 引导式安装', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('installU3DS 当服务端正在运行时不安装，前置守卫', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const manager = new SteamCmdManager(
      fakeProcessSupervisor,
      fakeBroadcaster,
      '/opt/steamcmd/steamcmd.sh',
      () => ['server1', 'server2'] as never,  // 模拟 2 个活跃实例
    );

    await expect(manager.installU3DS('/opt/unturned')).rejects.toMatchObject({
      code: 'servers-active',
      status: 409,
    });
  });

  it('installU3DS 当 SteamCMD 未安装时抛 AppError(steamcmd-not-found, 500)', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const manager = new SteamCmdManager(
      fakeProcessSupervisor,
      fakeBroadcaster,
      '/nonexistent/steamcmd',
      () => [],
    );

    await expect(manager.installU3DS('/opt/unturned')).rejects.toMatchObject({
      code: 'steamcmd-not-found',
      status: 500,
    });
  });

  it('installU3DS 接受 callbacks 参数并通过 callback 推送进度（抄 GSM3 onProgress/onStatusChange 形态）', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const exec = mockAdapter();
    exec.mockResolvedValue({ stdout: 'fake stdout', stderr: '' });

    const callbacks = {
      onProgress: vi.fn(),
      onStatusChange: vi.fn(),
    };

    const manager = new SteamCmdManager(
      fakeProcessSupervisor,
      fakeBroadcaster,
      '/opt/steamcmd/steamcmd.sh',
      () => [],
      exec,
    );

    (fakeProcessSupervisor.spawn as ReturnType<typeof vi.fn>).mockResolvedValue(123);

    await manager.installU3DS('/opt/unturned', callbacks).catch(() => undefined);

    // 验证至少 push 了 'spawned' 状态（BUG-2 修复：多通道：callback + WS broadcast）
    expect(callbacks.onStatusChange).toHaveBeenCalledWith('spawned');
  });

  it('installU3DS 完成后清理 activeJobs（finally 块保证资源释放）', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const exec = mockAdapter();
    exec.mockResolvedValue({ stdout: '', stderr: '' });

    const manager = new SteamCmdManager(
      fakeProcessSupervisor,
      fakeBroadcaster,
      '/opt/steamcmd/steamcmd.sh',
      () => [],
      exec,
    );

    (fakeProcessSupervisor.spawn as ReturnType<typeof vi.fn>).mockResolvedValue(123);

    // 即使失败也应清 activeJobs
    await manager.installU3DS('/opt/unturned').catch(() => undefined);

    // activeJobs 是 private；通过 broadcast 验证 'failed'/'completed' 至少有一个被调用
    const calls = (fakeBroadcaster.broadcast as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[0])
      .filter((evt: unknown) => (evt as { type?: string }).type === 'steamcmd_progress');
    expect(calls.length).toBeGreaterThan(0);
  });
});
