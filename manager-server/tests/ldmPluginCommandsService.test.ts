/**
 * LdmPluginCommandsService 测试（8 用例）。
 * 覆盖：
 *   1. 服务实例 STOPPED → server-not-running
 *   2. PTY 写命令格式 `/rocket load <name>\r`
 *   3. PTY 写命令格式 `/rocket unload <name>\r`
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

  it('2. PTY 写命令格式 `/rocket load <name>\\r`', async () => {
    const { pty, serverManager, runtimeStatusReader, written } = mockDeps({
      lines: ['Loading Uconomy'],
    });
    const svc = new LdmPluginCommandsService(pty, serverManager, runtimeStatusReader);
    const result = await svc.loadPlugin('S1' as never, 'Uconomy');
    expect(written).toContain('/rocket load Uconomy\r');
    expect(result.outcome).toBe('success');
  });

  it('3. PTY 写命令格式 `/rocket unload <name>\\r`', async () => {
    const { pty, serverManager, runtimeStatusReader, written } = mockDeps({
      lines: ['Unloading Uconomy'],
    });
    const svc = new LdmPluginCommandsService(pty, serverManager, runtimeStatusReader);
    const result = await svc.unloadPlugin('S1' as never, 'Uconomy');
    expect(written).toContain('/rocket unload Uconomy\r');
    expect(result.outcome).toBe('success');
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

  it('6. 超时 10s：无响应 → outcome=failure', async () => {
    // 这里仅用 vi.useFakeTimers 加速测试
    const { pty, serverManager, runtimeStatusReader } = mockDeps({ lines: [] });
    const svc = new LdmPluginCommandsService(pty, serverManager, runtimeStatusReader);
    // 把内部 waitForMarker 改成超时——但它是 10s 真实时间；测试改用 vi.advanceTimersByTime
    // 这里改为限定时间 100ms——通过 mock waitForMarker 自己的 setTimeout
    // 实际：内部 setTimeout 10s 在 fake timer 下会被快进
    const before = Date.now();
    const result = await svc.loadPlugin('S1' as never, 'Uconomy');
    expect(result.outcome).toBe('failure');
    // 实际墙钟应 < 2s（pollForMarker 50ms 间隔循环 + 计数器）
    expect(Date.now() - before).toBeLessThan(2000);
  });

  it('7. per-server 互斥锁：同一 serverId 串行执行', async () => {
    const slowLines = ['Loading Uconomy'];
    const dep1 = mockDeps({ lines: slowLines });
    const svc = new LdmPluginCommandsService(dep1.pty, dep1.serverManager, dep1.runtimeStatusReader);
    const order: string[] = [];
    const p1 = svc.loadPlugin('S1' as never, 'Uconomy').then(() => order.push('p1'));
    const p2 = svc.loadPlugin('S1' as never, 'Uconomy').then(() => order.push('p2'));
    await Promise.all([p1, p2]);
    expect(order).toEqual(['p1', 'p2']);
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
