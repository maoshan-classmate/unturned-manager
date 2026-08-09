import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { ConfigService } from '../src/modules/config/ConfigService.js';
import { FileLockProvider } from '../src/modules/filelock/FileLockProvider.js';
import { resolveInstallDir } from '../src/modules/server/pathResolver.js';
import type { ServerId } from '@unturned-manager/shared';

describe('ConfigService — 5 种格式往返', () => {
  let svc: ConfigService;
  // serverId 唯一（并行 forks pool 下各文件目录隔离，避免互踩 .test-install）
  const serverId: ServerId = 'CfgServer' as ServerId;
  /** fixture 根 = config.installDir（ADR-0003 / T2：真源全局，测试 fixture 必须写到同一处） */
  const serverDir = path.join(resolveInstallDir(), 'Servers', serverId);

  beforeEach(async () => {
    // 清理 + 重建本测试的 Servers/<id> 目录（避免跨用例残留）
    await fs.rm(serverDir, { recursive: true, force: true });
    await fs.mkdir(path.join(serverDir, 'Server'), { recursive: true });

    // T2 后构造器单参（fileLock）——不再依赖 db
    svc = new ConfigService(new FileLockProvider());
  });

  it('Commands.dat: read → write → read 等价', async () => {
    const input = 'Name MyServer\nPort 27015\nCheats\n# comment\nUnknownKey customValue\n';
    await fs.writeFile(path.join(serverDir, 'Server', 'Commands.dat'), input);

    const first = await svc.readCommandsDat(serverId);
    expect(first.known.Name).toBe('MyServer');
    expect(first.known.Port).toBe('27015');
    expect(first.known.Cheats).toBe('');
    expect(first.unknown.UnknownKey).toBe('customValue');
    expect(first.comments).toContain('# comment');

    await svc.writeCommandsDat(serverId, first);
    const second = await svc.readCommandsDat(serverId);
    expect(second.known.Name).toBe(first.known.Name);
    expect(second.known.Port).toBe(first.known.Port);
    expect(second.known.Cheats).toBe(first.known.Cheats);
    expect(second.unknown.UnknownKey).toBe('customValue');
  });

  it('Commands.dat: 乐观锁 mtime 冲突抛 config_conflict(409)', async () => {
    const absPath = path.join(serverDir, 'Server', 'Commands.dat');
    await fs.writeFile(absPath, 'Name A\n');
    const st = await fs.stat(absPath);
    const expectedMtime = Math.floor(st.mtimeMs);

    // 用当前 mtime 写 → 成功（mtime 未变）
    await svc.writeCommandsDat(serverId, {
      known: { Name: 'A' },
      unknown: {},
      comments: [],
    }, expectedMtime);

    // 外部改文件 → mtime 变化 → 再用旧 mtime 写 → 冲突
    await new Promise((r) => setTimeout(r, 20));
    await fs.writeFile(absPath, 'Name C\n');
    await expect(
      svc.writeCommandsDat(serverId, { known: { Name: 'B' }, unknown: {}, comments: [] }, expectedMtime),
    ).rejects.toMatchObject({ code: 'config_conflict', status: 409 });
  });

  it('Config.txt: sections Record 往返', async () => {
    // ConfigService parseConfigTxt 只认 '=' 或 ':' 分隔（当前实现），所以测试用等号
    const input = '[Browser]\nLogin_Token=abc123\nDesc_Full=hello\n\n[Server]\nVAC_Secure=true\n';
    await fs.writeFile(path.join(serverDir, 'Config.txt'), input);

    const first = await svc.readConfigTxt(serverId);
    expect(first.sections.Browser?.entries).toContainEqual(
      expect.objectContaining({ key: 'Login_Token', value: 'abc123' }),
    );
    expect(first.sections.Server?.entries[0]?.key).toBe('VAC_Secure');

    await svc.writeConfigTxt(serverId, first);
    const second = await svc.readConfigTxt(serverId);
    expect(Object.keys(second.sections).sort()).toEqual(['Browser', 'Server']);
  });

  it('Workshop.json: 只写 File_IDs，其他字段不动', async () => {
    const input = JSON.stringify({
      File_IDs: ['1', '2'],
      Should_Monitor_Updates: true,
      Query_Cache_Max_Age_Seconds: 600,
      Max_Query_Retries: 2,
      Use_Cached_Downloads: true,
      Shutdown_Update_Detected_Timer: 600,
      Shutdown_Update_Detected_Message: 'msg1',
      Shutdown_Kick_Message: 'msg2',
    });
    await fs.writeFile(path.join(serverDir, 'Server', 'WorkshopDownloadConfig.json'), input);

    await svc.writeWorkshopFileIds(serverId, ['3', '4']);
    const content = await fs.readFile(path.join(serverDir, 'Server', 'WorkshopDownloadConfig.json'), 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.File_IDs).toEqual(['3', '4']);
    expect(parsed.Should_Monitor_Updates).toBe(true);
    expect(parsed.Shutdown_Update_Detected_Message).toBe('msg1');  // 未被改写
  });

  it('OpenMod YAML: 写入+读回等价', async () => {
    await fs.mkdir(path.join(serverDir, 'openmod', 'plugins', 'Economy'), { recursive: true });

    const input = { Rate: 100, Enabled: true, Name: 'economy' };
    await svc.writeOpenModConfig(serverId, 'Economy', input);
    const back = await svc.readOpenModConfig(serverId, 'Economy');
    expect(back.Rate).toBe(100);
    expect(back.Enabled).toBe(true);
    expect(back.Name).toBe('economy');
  });

  it('Rocket XML: 写入+读回关键字段', async () => {
    await fs.mkdir(path.join(serverDir, 'Rocket', 'Plugins', 'BasicChat'), { recursive: true });
    const input = { PluginSettings: { MaxMessageLength: 200, AllowLinks: false } };
    await svc.writeRocketModConfig(serverId, 'BasicChat', input);
    const back = await svc.readRocketModConfig(serverId, 'BasicChat');
    expect(back.PluginSettings).toBeDefined();
  });
});
