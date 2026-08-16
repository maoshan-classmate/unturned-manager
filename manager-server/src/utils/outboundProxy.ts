/**
 * 出站代理工厂——遵循 Docker 标准环境变量 HTTP_PROXY/HTTPS_PROXY（opt-in）。
 *
 * 配置了 HTTP_PROXY/HTTPS_PROXY 就全局走代理；未配置保持直连。
 * 运行时所有外部 API 调用只有三类宿主——Steam WebAPI（api.steampowered.com）、
 * GitHub API（api.github.com）、GitHub Pages（ldm-community.github.io），
 * 无内部/localhost 调用，全局切换安全，不会误代理内部流量。
 *
 * NO_PROXY：未配置时默认兜底 localhost/127.0.0.1/::1（本地调用不走代理）。
 * 容器健康检查 curl 自带 --noproxy '*'（见 Dockerfile），不依赖 NO_PROXY 环境变量。
 */

import { Agent, ProxyAgent, type Dispatcher } from 'undici';
import { logger } from './logger.js';

// ─── 常量 ────────────────────────────────────────────────

/** 直连 Agent 的 timeout */
const DIRECT_TIMEOUTS = {
  connectTimeout: 30_000,
  headersTimeout: 30_000,
  bodyTimeout: 30_000,
} as const;

// ─── 单例缓存 ────────────────────────────────────────────

let directAgent: Agent | undefined;
let proxyAgent: ProxyAgent | undefined;

// ─── 实现 ────────────────────────────────────────────────

/**
 * 解析出站代理地址（标准 Docker 变量，https 优先——Steam/GitHub 调用均为 https）。
 * @returns 代理 URL 字符串；未配置返回 undefined
 */
function resolveProxyEnv(): string | undefined {
  return (
    process.env.HTTPS_PROXY?.trim() ||
    process.env.https_proxy?.trim() ||
    process.env.HTTP_PROXY?.trim() ||
    process.env.http_proxy?.trim()
  );
}

/**
 * 获取全局出站 dispatcher。
 *
 * 配置了 HTTP_PROXY/HTTPS_PROXY 时返回 ProxyAgent（惰性单例），否则返回直连 Agent。
 * 返回值交给 index.ts 的 `setGlobalDispatcher`——所有 fetch()（Steam/GitHub API）统一生效。
 *
 * @returns undici Dispatcher——ProxyAgent（走代理）或 Agent（直连）
 *
 * @example
 * ```typescript
 * setGlobalDispatcher(getOutboundAgent());
 * ```
 */
export function getOutboundAgent(): Dispatcher {
  // NO_PROXY 默认值：兜住本地地址——即使 compose 没写 NO_PROXY，本地/内部调用也不会走代理。
  if (!process.env.NO_PROXY) process.env.NO_PROXY = 'localhost,127.0.0.1,::1';
  if (!process.env.no_proxy) process.env.no_proxy = 'localhost,127.0.0.1,::1';
  const proxy = resolveProxyEnv();
  if (proxy) {
    if (!proxyAgent) {
      proxyAgent = new ProxyAgent(proxy);
      // 只打 host:port，不透出 URL 内嵌凭证（user:pass@）
      const { host } = new URL(proxy);
      logger.info({ proxy: host }, '出站代理已启用（Steam/GitHub API 走代理连接）');
    }
    return proxyAgent;
  }
  if (!directAgent) {
    directAgent = new Agent(DIRECT_TIMEOUTS);
  }
  return directAgent;
}

/**
 * 测试钩子：重置单例缓存。
 * 仅供 vitest 在 beforeEach 调用——避免用例间代理配置残留。
 */
export function __resetProxyAgentsForTest(): void {
  directAgent = undefined;
  proxyAgent = undefined;
}
