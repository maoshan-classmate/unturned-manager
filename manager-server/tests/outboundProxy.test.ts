/**
 * outboundProxy 工厂单测（未配置→直连 / HTTPS_PROXY、HTTP_PROXY→ProxyAgent / 单例缓存）。
 * 覆盖 6 组行为：
 *   1. 未配置代理 → 返回直连 Agent（非 ProxyAgent）
 *   2. 配置 HTTPS_PROXY → 返回 ProxyAgent
 *   3. 未配置 HTTPS 时回落 HTTP_PROXY → 返回 ProxyAgent
 *   4. 代理配置变化后单例重置生效
 *   5. 未配置时重复调用返回同一直连实例
 *   6. 配置时重复调用返回同一代理实例
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Agent, ProxyAgent } from 'undici';

vi.mock('../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const { getOutboundAgent, __resetProxyAgentsForTest } = await import(
  '../src/utils/outboundProxy.js'
);

describe('outboundProxy', () => {
  beforeEach(() => {
    __resetProxyAgentsForTest();
    delete process.env.HTTPS_PROXY;
    delete process.env.HTTP_PROXY;
    delete process.env.https_proxy;
    delete process.env.http_proxy;
    delete process.env.NO_PROXY;
    delete process.env.no_proxy;
  });

  it('未配置代理时返回直连 Agent', () => {
    const agent = getOutboundAgent();
    expect(agent).toBeInstanceOf(Agent);
    expect(agent).not.toBeInstanceOf(ProxyAgent);
  });

  it('配置 HTTPS_PROXY 时返回 ProxyAgent', () => {
    process.env.HTTPS_PROXY = 'http://192.168.2.9:7890';
    expect(getOutboundAgent()).toBeInstanceOf(ProxyAgent);
  });

  it('未配置 NO_PROXY 时自动补默认值', () => {
    delete process.env.NO_PROXY;
    delete process.env.no_proxy;
    getOutboundAgent();
    expect(process.env.NO_PROXY).toBe('localhost,127.0.0.1,::1');
  });

  it('已配置 NO_PROXY 时保留用户值', () => {
    process.env.NO_PROXY = '127.0.0.1';
    getOutboundAgent();
    expect(process.env.NO_PROXY).toBe('127.0.0.1');
  });

  it('未配置 HTTPS 时回落 HTTP_PROXY', () => {
    process.env.HTTP_PROXY = 'http://192.168.2.9:7890';
    expect(getOutboundAgent()).toBeInstanceOf(ProxyAgent);
  });

  it('代理配置变化后单例重置生效', () => {
    process.env.HTTPS_PROXY = 'http://192.168.2.9:7890';
    expect(getOutboundAgent()).toBeInstanceOf(ProxyAgent);

    __resetProxyAgentsForTest();
    delete process.env.HTTPS_PROXY;
    expect(getOutboundAgent()).toBeInstanceOf(Agent);
  });

  it('未配置时重复调用返回同一直连实例', () => {
    expect(getOutboundAgent()).toBe(getOutboundAgent());
  });

  it('配置时重复调用返回同一代理实例', () => {
    process.env.HTTPS_PROXY = 'http://192.168.2.9:7890';
    expect(getOutboundAgent()).toBe(getOutboundAgent());
  });
});
