/**
 * LdmDiscoveryService 测试（7 用例）。
 * 覆盖：
 *   1. LDM 未激活（Modules/Rocket.Unturned/.module 缺失）→ ldmNotDetected=true, plugins=[]
 *   2. LDM 激活 + 0 插件 → ldmNotDetected=false, plugins=[]
 *   3. LDM 激活 + 1 插件（无 config） → 字段完整（runtimeStatus=unknown）
 *   4. LDM 激活 + 1 插件（有 config） → hasConfig=true
 *   5. runtimeStatusReader 注入 loaded/unloaded 映射 → 正确填入
 *   6. runtimeStatusReader 抛错 → 仍返回 plugins（fallback unknown）
 *   7. .dll 文件 stat 失败 → 跳过该插件（warn 日志）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

// JWT_SECRET/INSTALL_DIR 必须在 `import config` 之前设置
process.env.JWT_SECRET ||= 'test-jwt-secret-do-not-use-in-prod-min-32-chars';
process.env.ENCRYPTION_KEY ||= 'dGVzdC1lbmNyeXB0aW9uLWtleS0zMi1ieXRlcy1sb25n';

const { config: serverConfig } = await import('../src/config.js');
const { LdmDiscoveryService } = await import(
  '../src/modules/ldm/LdmDiscoveryService.js'
);

vi.mock('../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('LdmDiscoveryService', () => {
  let testRoot: string;
  let serverId: string;

  beforeEach(async () => {
    testRoot = await mkdtemp(join(tmpdir(), 'ldm-discovery-'));
    serverId = 'TestServer';
    // 临时把 installDir 改到 testRoot
    (serverConfig as { installDir: string }).installDir = testRoot;
  });

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true });
  });

  it('1. LDM 未激活（Module 标记缺失） → ldmNotDetected=true', async () => {
    // 仅有 Servers/<id>/Rocket/，无 Modules/Rocket.Unturned/
    await mkdir(join(testRoot, 'Servers', serverId, 'Rocket'), { recursive: true });
    const svc = new LdmDiscoveryService(
      { readVersion: async () => null },
      async () => ({}),
    );
    const result = await svc.listInstalledPlugins(serverId as never);
    expect(result.ldmNotDetected).toBe(true);
    expect(result.plugins).toEqual([]);
  });

  it('2. LDM 激活 + 0 插件 → ldmNotDetected=false, plugins=[]', async () => {
    await mkdir(join(testRoot, 'Modules', 'Rocket.Unturned'), { recursive: true });
    await writeFile(join(testRoot, 'Modules', 'Rocket.Unturned', 'Rocket.Unturned.module'), '');
    await mkdir(join(testRoot, 'Servers', serverId, 'Rocket', 'Plugins'), { recursive: true });
    const svc = new LdmDiscoveryService(
      { readVersion: async () => null },
      async () => ({}),
    );
    const result = await svc.listInstalledPlugins(serverId as never);
    expect(result.ldmNotDetected).toBe(false);
    expect(result.plugins).toEqual([]);
  });

  it('3. LDM 激活 + 1 插件（无 config） → 字段完整（runtimeStatus=unknown）', async () => {
    await mkdir(join(testRoot, 'Modules', 'Rocket.Unturned'), { recursive: true });
    await writeFile(join(testRoot, 'Modules', 'Rocket.Unturned', 'Rocket.Unturned.module'), '');
    const pluginsDir = join(testRoot, 'Servers', serverId, 'Rocket', 'Plugins');
    await mkdir(pluginsDir, { recursive: true });
    const dllPath = join(pluginsDir, 'Uconomy.dll');
    await writeFile(dllPath, Buffer.alloc(1024, 0));

    const svc = new LdmDiscoveryService(
      { readVersion: async () => '1.0.0' },
      async () => ({}),
    );
    const result = await svc.listInstalledPlugins(serverId as never);
    expect(result.plugins.length).toBe(1);
    const p = result.plugins[0];
    expect(p?.name).toBe('Uconomy');
    expect(p?.version).toBe('1.0.0');
    expect(p?.sizeBytes).toBe(1024);
    expect(p?.hasConfig).toBe(false);
    expect(p?.runtimeStatus).toBe('unknown');
  });

  it('4. LDM 激活 + 1 插件（有 config） → hasConfig=true', async () => {
    await mkdir(join(testRoot, 'Modules', 'Rocket.Unturned'), { recursive: true });
    await writeFile(join(testRoot, 'Modules', 'Rocket.Unturned', 'Rocket.Unturned.module'), '');
    const pluginsDir = join(testRoot, 'Servers', serverId, 'Rocket', 'Plugins');
    await mkdir(join(pluginsDir, 'Uconomy'), { recursive: true });
    await writeFile(join(pluginsDir, 'Uconomy.dll'), Buffer.alloc(512, 0));
    await writeFile(
      join(pluginsDir, 'Uconomy', 'Uconomy.configuration.xml'),
      '<configuration/>',
    );
    const svc = new LdmDiscoveryService(
      { readVersion: async () => null },
      async () => ({}),
    );
    const result = await svc.listInstalledPlugins(serverId as never);
    expect(result.plugins[0]?.hasConfig).toBe(true);
  });

  it('5. runtimeStatusReader 注入 loaded/unloaded 映射 → 正确填入', async () => {
    await mkdir(join(testRoot, 'Modules', 'Rocket.Unturned'), { recursive: true });
    await writeFile(join(testRoot, 'Modules', 'Rocket.Unturned', 'Rocket.Unturned.module'), '');
    const pluginsDir = join(testRoot, 'Servers', serverId, 'Rocket', 'Plugins');
    await mkdir(pluginsDir, { recursive: true });
    await writeFile(join(pluginsDir, 'A.dll'), '');
    await writeFile(join(pluginsDir, 'B.dll'), '');
    const svc = new LdmDiscoveryService(
      { readVersion: async () => null },
      async () => ({ A: 'loaded', B: 'unloaded' }) as never,
    );
    const result = await svc.listInstalledPlugins(serverId as never);
    const a = result.plugins.find((p) => p.name === 'A');
    const b = result.plugins.find((p) => p.name === 'B');
    expect(a?.runtimeStatus).toBe('loaded');
    expect(b?.runtimeStatus).toBe('unloaded');
  });

  it('6. runtimeStatusReader 抛错 → fallback "unknown" 不中断', async () => {
    await mkdir(join(testRoot, 'Modules', 'Rocket.Unturned'), { recursive: true });
    await writeFile(join(testRoot, 'Modules', 'Rocket.Unturned', 'Rocket.Unturned.module'), '');
    const pluginsDir = join(testRoot, 'Servers', serverId, 'Rocket', 'Plugins');
    await mkdir(pluginsDir, { recursive: true });
    await writeFile(join(pluginsDir, 'A.dll'), '');
    const svc = new LdmDiscoveryService(
      { readVersion: async () => null },
      async () => { throw new Error('PTY timeout'); },
    );
    const result = await svc.listInstalledPlugins(serverId as never);
    expect(result.plugins[0]?.runtimeStatus).toBe('unknown');
  });

  it('7. version reader 抛错 → 跳过该插件（warn 日志）', async () => {
    await mkdir(join(testRoot, 'Modules', 'Rocket.Unturned'), { recursive: true });
    await writeFile(join(testRoot, 'Modules', 'Rocket.Unturned', 'Rocket.Unturned.module'), '');
    const pluginsDir = join(testRoot, 'Servers', serverId, 'Rocket', 'Plugins');
    await mkdir(pluginsDir, { recursive: true });
    // 一个正常，一个 readVersion 抛错
    await writeFile(join(pluginsDir, 'Good.dll'), Buffer.alloc(50, 0));
    await writeFile(join(pluginsDir, 'Bad.dll'), Buffer.alloc(50, 0));
    const svc = new LdmDiscoveryService(
      {
        readVersion: async (p: string) => {
          if (p.endsWith('Bad.dll')) throw new Error('fail');
          return '1.0.0';
        },
      },
      async () => ({}),
    );
    const result = await svc.listInstalledPlugins(serverId as never);
    expect(result.plugins.length).toBe(1);
    expect(result.plugins[0]?.name).toBe('Good');
  });

  // ─── Phase 4b：searchPlugins（内存过滤）──────────────────────────

  async function setupPlugins(files: Array<{ name: string; version: string }>) {
    await mkdir(join(testRoot, 'Modules', 'Rocket.Unturned'), { recursive: true });
    await writeFile(join(testRoot, 'Modules', 'Rocket.Unturned', 'Rocket.Unturned.module'), '');
    const pluginsDir = join(testRoot, 'Servers', serverId, 'Rocket', 'Plugins');
    await mkdir(pluginsDir, { recursive: true });
    for (const f of files) {
      await writeFile(join(pluginsDir, `${f.name}.dll`), Buffer.alloc(512, 0));
    }
    const versionMap: Record<string, string> = {};
    for (const f of files) versionMap[f.name] = f.version;
    return new LdmDiscoveryService(
      { readVersion: async (p: string) => versionMap[p.split('\\').pop()!.split('/').pop()!.replace('.dll', '')] ?? null },
      async () => ({}),
    );
  }

  it('8. searchPlugins 插件名子串匹配（不区分大小写）', async () => {
    const svc = await setupPlugins([
      { name: 'Uconomy', version: '3.0.0.0' },
      { name: 'Kits', version: '1.0.0.0' },
    ]);
    const result = await svc.searchPlugins(serverId as never, { query: 'ucon' });
    expect(result.length).toBe(1);
    expect(result[0]?.name).toBe('Uconomy');
  });

  it('9. searchPlugins 版本前缀匹配（startsWith 语义：查 "3" 命中 3.0.0.0 不命中 13.0.0.0）', async () => {
    const svc = await setupPlugins([
      { name: 'Uconomy', version: '3.0.0.0' },
      { name: 'Kits', version: '13.0.0.0' },
    ]);
    const result = await svc.searchPlugins(serverId as never, { query: '3' });
    expect(result.map((p) => p.name)).toEqual(['Uconomy']);
  });

  it('10. searchPlugins 状态筛选', async () => {
    const svc = await setupPlugins([
      { name: 'A', version: '1.0.0.0' },
      { name: 'B', version: '1.0.0.0' },
    ]);
    // 注入运行时状态
    (svc as unknown as { runtimeStatusReader: unknown }).runtimeStatusReader = async () => ({ A: 'loaded', B: 'unloaded' });
    const result = await svc.searchPlugins(serverId as never, { status: 'loaded' });
    expect(result.map((p) => p.name)).toEqual(['A']);
  });

  it('11. searchPlugins 空 query + null status → 返回全部', async () => {
    const svc = await setupPlugins([
      { name: 'A', version: '1.0.0.0' },
      { name: 'B', version: '1.0.0.0' },
    ]);
    const result = await svc.searchPlugins(serverId as never, {});
    expect(result.length).toBe(2);
  });

  // ─── Phase 3：getStatus（统一状态）──────────────────────────

  it('12. getStatus：LDM 激活 + 2 插件 → ldmInstalled=true + pluginCount=2', async () => {
    const svc = await setupPlugins([
      { name: 'A', version: '1.0.0.0' },
      { name: 'B', version: '1.0.0.0' },
    ]);
    const status = await svc.getStatus(serverId as never);
    expect(status.ldmInstalled).toBe(true);
    expect(status.rocketDirExists).toBe(true);
    expect(status.pluginCount).toBe(2);
  });

  it('13. getStatus：LDM 未激活（无 .module）→ ldmInstalled=false', async () => {
    // 只有 Servers/<id>/Rocket/，无 Modules/Rocket.Unturned/.module
    await mkdir(join(testRoot, 'Servers', serverId, 'Rocket'), { recursive: true });
    const svc = new LdmDiscoveryService(
      { readVersion: async () => null },
      async () => ({}),
    );
    const status = await svc.getStatus(serverId as never);
    expect(status.ldmInstalled).toBe(false);
    expect(status.rocketDirExists).toBe(true);
    expect(status.pluginCount).toBe(0);
  });

  it('14. getStatus：Rocket/ 目录不存在 → rocketDirExists=false', async () => {
    // 什么都不建——目录不存在
    const svc = new LdmDiscoveryService(
      { readVersion: async () => null },
      async () => ({}),
    );
    const status = await svc.getStatus(serverId as never);
    expect(status.rocketDirExists).toBe(false);
    expect(status.ldmInstalled).toBe(false);
    expect(status.pluginCount).toBe(0);
    expect(status.serverId).toBe(serverId);
    expect(status.detectedAtIso).toBeTruthy();
  });

  it('15. getStatus：Plugins/ 空目录 → pluginCount=0', async () => {
    await mkdir(join(testRoot, 'Modules', 'Rocket.Unturned'), { recursive: true });
    await writeFile(join(testRoot, 'Modules', 'Rocket.Unturned', 'Rocket.Unturned.module'), '');
    await mkdir(join(testRoot, 'Servers', serverId, 'Rocket', 'Plugins'), { recursive: true });
    const svc = new LdmDiscoveryService(
      { readVersion: async () => null },
      async () => ({}),
    );
    const status = await svc.getStatus(serverId as never);
    expect(status.ldmInstalled).toBe(true);
    expect(status.pluginCount).toBe(0);
  });
});
