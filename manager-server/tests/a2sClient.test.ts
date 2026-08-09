import { describe, it, expect, vi } from 'vitest';
import type { ServerId } from '@unturned-manager/shared';
import { A2SClient, type A2SServerFactory } from '../src/modules/a2s/A2SClient.js';

/**
 * A2SClient 单测（BUG-3/7 最终根因回归）。
 *
 * 背景：此前代码解构不存在的 `queryA2SInfo` → 运行时 TypeError: queryA2SInfo is not a function，
 * U3DS 能启动后 pollA2S 第一次真实 A2S 查询即崩（启动失败）。修复走官方 API
 * `Server({ip,port,timeout})` → `server.getInfo()`。
 *
 * mock 策略：A2SClient 通过 createRequire 加载库（vi.mock 拦不住），故把 Server 工厂做成
 * 构造器注入（A2SServerFactory）——测试注入 mock 工厂，锁死调用形态与字段映射。
 */
describe('A2SClient — query 官方 API 回归', () => {
  it('query: 工厂收到 {ip, port: gamePort+1, timeout}，getInfo 字段映射 players.online/max', async () => {
    const getInfo = vi.fn(async () => ({
      players: { online: 3, max: 16, bots: 0 },
      map: 'PEI',
      version: '3.25',
    }));
    const factory = vi.fn(async () => ({ getInfo })) as unknown as A2SServerFactory;

    const client = new A2SClient(factory);
    client.register('S1' as ServerId, '127.0.0.1', 27015);

    const info = await client.query('S1' as ServerId);

    expect(info).toEqual({
      players: 3,
      maxPlayers: 16,
      map: 'PEI',
      version: '3.25',
      latency: expect.any(Number),
    });
    // 官方形态：Server({ ip, port, timeout }) —— 不是 (host, port, timeout) 直传
    expect(factory).toHaveBeenCalledWith({
      ip: '127.0.0.1',
      port: 27016,
      timeout: 3000,
    });
    expect(getInfo).toHaveBeenCalled();
  });

  it('query: players 字段缺失时降级 0（容错）', async () => {
    const factory = vi.fn(async () => ({
      getInfo: vi.fn(async () => ({ map: 'PEI' })),
    })) as unknown as A2SServerFactory;

    const client = new A2SClient(factory);
    client.register('S2' as ServerId, '10.0.0.1', 27015);

    const info = await client.query('S2' as ServerId);
    expect(info.players).toBe(0);
    expect(info.maxPlayers).toBe(0);
  });

  it('query: 未注册 serverId → 抛错（不触工厂）', async () => {
    const factory = vi.fn() as unknown as A2SServerFactory;
    const client = new A2SClient(factory);
    await expect(client.query('NONE' as ServerId)).rejects.toThrow(/未注册/);
    expect(factory).not.toHaveBeenCalled();
  });

  it('query: 工厂连接失败（超时）→ 抛错', async () => {
    const factory = vi.fn(async () => {
      throw new Error('Response timeout');
    }) as unknown as A2SServerFactory;
    const client = new A2SClient(factory);
    client.register('S3' as ServerId, '10.0.0.2', 27015);
    await expect(client.query('S3' as ServerId)).rejects.toThrow(
      'Response timeout',
    );
  });
});
