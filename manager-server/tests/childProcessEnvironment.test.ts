import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildChildProcessEnvironment } from '../src/utils/childProcessEnvironment.js';

describe('buildChildProcessEnvironment — T6 环境剥离 secret', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('剥离面板 secret：JWT_SECRET / ENCRYPTION_KEY', () => {
    vi.stubEnv('JWT_SECRET', 'jwt-secret');
    vi.stubEnv('ENCRYPTION_KEY', 'enc-key');
    const env = buildChildProcessEnvironment();
    expect(env.JWT_SECRET).toBeUndefined();
    expect(env.ENCRYPTION_KEY).toBeUndefined();
  });

  it('保留普通环境变量 + 合并 overrides（overrides 优先）', () => {
    vi.stubEnv('HOME', '/root');
    vi.stubEnv('PATH', '/usr/bin');
    const env = buildChildProcessEnvironment({ EXTRA: 'x', PATH: '/custom' });
    expect(env.HOME).toBe('/root');
    expect(env.EXTRA).toBe('x');
    expect(env.PATH).toBe('/custom'); // overrides 覆盖
  });
});
