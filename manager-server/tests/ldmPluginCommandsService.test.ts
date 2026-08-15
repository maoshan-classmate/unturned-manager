/**
 * LdmPluginCommandsService 测试（8 用例）。
 * 覆盖：
 *   1. 服务实例 STOPPED → server-not-running
 *   2. PTY 写命令格式 `/rocket load <name>\n`
 *   3. PTY 写命令格式 `/rocket unload <name>\n`
 *   4. 成功：收到 "Loading Uconomy" → outcome=success
 *   5. 失败：收到 "Unable to load plugin" → outcome=failure
 *   6. 超时：10s 内无响应 → outcome=failure（timeout 路径）
 *   7. per-server 互斥锁：同一 serverId 串行执行
 *   8. 不同 serverId 并行执行
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { LdmPluginCommandsService } = await import(
  '../src/modules/ldm/LdmPluginCommandsService.js'
);
const { ServerState } = await import('@unturned-manager/shared');

/** 构造 mock PtyManager + ServerManager */
function mockDeps(opts: {
  state?: ServerState;
  lines?: string[];
  immediateOff?: boolean;
} = {}) {
  const state = opts.state ?? ServerState.RUNNING;
  const lines = opts.lines ?? [];
  const written: string[] = [];
  let dataCb: ((line: string) => void) | null = null;
  const offData = () => {
    dataCb = null;
  };
  const onData = (_serverId: string, cb: (line: string) => void) => {
    dataCb = cb;
    queueMicrotask(() => {
      if (opts.immediateOff) {
        cb(''); // 触发 0 数据立即返回
      } else {
        for (const ln of lines) cb(ln);
      }
    });
    return offData;
  };
  const pty = {
    write: (id: string, data: string) => {
      written.push(data);
      // 模拟 U3DS 异步回显（在 write 后 1ms 触发响应）
      if (dataCb && !opts.immediateOff) {
        queueMicrotask(() => {
          if (dataCb) dataCb('');
        });
      }
    },
    waitForMarker: async () => {
      // 内部 waitForMarker 走的是 race——在这里立即 resolve（外部 pollForMarker 决定胜负）
    },
    onData,
  };
  const serverManager = { getState: () => state };
  const runtimeStatusReader = async () => ({});
  return { pty: pty as never, serverManager: serverManager as never, runtimeStatusReader: runtimeStatusReader as never, written };
}

describe('LdmPluginCommandsService', () => {
  beforeEach(() => vi.useRealTimers());

  it('1. 服务实例 STOPPED → server-not-running', async () => {
    const { pty, serverManager, runtimeStatusReader } = mockDeps({ state: ServerState.STOPPED });
    const svc = new LdmPluginCommandsService(pty, serverManager, runtimeStatusReader);
    await expect(svc.loadPlugin('S1' as never, 'Uconomy')).rejects.toMatchObject({
      code: 'server-not-running',
    });
  });

  it('2. PTY 写命令格式 `/rocket load <name>\\n`', async () => {
    const { pty, serverManager, runtimeStatusReader, written } = mockDeps({
      lines: ['Loading Uconomy'],
    });
    const svc = new LdmPluginCommandsService(pty, serverManager, runtimeStatusReader);
    const result = await svc.loadPlugin('S1' as never, 'Uconomy');
    expect(written).toContain('/rocket load Uconomy\n');
    expect(result.outcome).toBe('success');
  });

  it('3. PTY 写命令格式 `/rocket unload <name>\\n`', async () => {
    const { pty, serverManager, runtimeStatusReader, written } = mockDeps({
      lines: ['Unloading Uconomy'],
    });
    const svc = new LdmPluginCommandsService(pty, serverManager, runtimeStatusReader);
    const result = await svc.unloadPlugin('S1' as never, 'Uconomy');
    expect(written).toContain('/rocket unload Uconomy\n');
    expect(result.outcome).toBe('success');
  });

  it('4a. 成功 reload：PTY stdout 含 "Reloading" → outcome=success', async () => {
    const { pty, serverManager, runtimeStatusReader } = mockDeps({
      lines: ['[LDM] Reloading plugin Uconomy'],
    });
    const svc = new LdmPluginCommandsService(pty, serverManager, runtimeStatusReader);
    const result = await svc.reloadPlugin('S1' as never, 'Uconomy');
    expect(result.outcome).toBe('success');
  });

  it('4b. reload 插件不存在：PTY stdout 含 "Plugin X not found" → 抛 plugin-not-found', async () => {
    const { pty, serverManager, runtimeStatusReader } = mockDeps({
      lines: ['Plugin MissingPlugin not found'],
    });
    const svc = new LdmPluginCommandsService(pty, serverManager, runtimeStatusReader);
    await expect(svc.reloadPlugin('S1' as never, 'MissingPlugin')).rejects.toMatchObject({
      code: 'plugin-not-found',
      status: 404,
    });
  });

  it('4d. reload 未加载插件：PTY stdout 含 "The plugin X is not loaded" → 抛 plugin-not-found', async () => {
    const { pty, serverManager, runtimeStatusReader } = mockDeps({
      lines: ['The plugin Uconomy is not loaded'],
    });
    const svc = new LdmPluginCommandsService(pty, serverManager, runtimeStatusReader);
    await expect(svc.reloadPlugin('S1' as never, 'Uconomy')).rejects.toMatchObject({
      code: 'plugin-not-found',
      status: 404,
    });
  });

  it('4c. failure reload：PTY stdout 含 "Failed to load" → outcome=failure', async () => {
    const { pty, serverManager, runtimeStatusReader } = mockDeps({
      lines: ['Failed to load plugin Uconomy, unloading now...'],
    });
    const svc = new LdmPluginCommandsService(pty, serverManager, runtimeStatusReader);
    const result = await svc.reloadPlugin('S1' as never, 'Uconomy');
    expect(result.outcome).toBe('failure');
  });

  it('4. 成功：收到 "Loading Uconomy" → outcome=success', async () => {
    const { pty, serverManager, runtimeStatusReader } = mockDeps({
      lines: ['[LDM] Loading Uconomy', 'Loaded plugin Uconomy'],
    });
    const svc = new LdmPluginCommandsService(pty, serverManager, runtimeStatusReader);
    const result = await svc.loadPlugin('S1' as never, 'Uconomy');
    expect(result.outcome).toBe('success');
  });

  it('5. 失败：收到 "Unable to load plugin" → outcome=failure', async () => {
    const { pty, serverManager, runtimeStatusReader } = mockDeps({
      lines: ['Unable to load plugin: UnknownPlugin'],
    });
    const svc = new LdmPluginCommandsService(pty, serverManager, runtimeStatusReader);
    const result = await svc.loadPlugin('S1' as never, 'UnknownPlugin');
    expect(result.outcome).toBe('failure');
  });

  it('6. 超时 10s：无响应 → 抛 pty-timeout', async () => {
    const { pty, serverManager, runtimeStatusReader } = mockDeps({ lines: [] });
    const svc = new LdmPluginCommandsService(pty, serverManager, runtimeStatusReader);
    await expect(svc.loadPlugin('S1' as never, 'Uconomy')).rejects.toMatchObject({
      code: 'pty-timeout',
      status: 500,
    });
  });

  it('7. per-server 互斥锁：同 serverId 并发 → 第二个抛 operation-conflict', async () => {
    const dep1 = mockDeps({ lines: ['Loading Uconomy'] });
    const svc = new LdmPluginCommandsService(dep1.pty, dep1.serverManager, dep1.runtimeStatusReader);
    // 第一个任务先占用锁——用 waitForMarker 挂起模拟任务未完成
    const p1 = svc.loadPlugin('S1' as never, 'Uconomy');
    // 第二个立即调用——锁被占 → 抛 operation-conflict
    await expect(svc.loadPlugin('S1' as never, 'Uconomy')).rejects.toMatchObject({
      code: 'operation-conflict',
      status: 409,
    });
    // 等待 p1 完成后锁释放，后续调用可再执行
    await p1;
    const p2 = await svc.loadPlugin('S1' as never, 'Uconomy');
    expect(p2.outcome).toBe('success');
  });

  it('8. 不同 serverId 并行执行', async () => {
    const dep1 = mockDeps({ lines: ['Loading Uconomy'] });
    const svc = new LdmPluginCommandsService(dep1.pty, dep1.serverManager, dep1.runtimeStatusReader);
    const start = Date.now();
    const [r1, r2] = await Promise.all([
      svc.loadPlugin('S1' as never, 'Uconomy'),
      svc.loadPlugin('S2' as never, 'Uconomy'),
    ]);
    expect(r1.outcome).toBe('success');
    expect(r2.outcome).toBe('success');
  });
});
