import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ─── 通用工具（P0 提取自各页面的重复代码）───────────────

/** 文件大小格式化：B → KB → MB */
export function formatSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 字节数自适应：B / KB / MB / GB——大文件场景（下载进度、Mod 大小）展示用 */
export function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 100 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

/** 千分位格式化——仅展示型，StatCard / 表格 / 卡片用；输入框不格式化 */
export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

/** ISO 日期 → YYYY-MM-DD */
export function formatDate(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso.slice(0, 10);
  }
}

/** 服务端状态 → 中文标签（ADR-0004 Phase 6：4 态，去 DEGRADED） */
export function stateLabel(state: string): string {
  const labels: Record<string, string> = {
    STOPPED: "已停止",
    STARTING: "启动中",
    RUNNING: "运行中",
    STOPPING: "停止中",
  };
  return labels[state] ?? state;
}

/** 服务端状态 → 颜色（ADR-0004 Phase 6：4 态，去 DEGRADED） */
export function stateColor(state: string): string {
  const colors: Record<string, string> = {
    STOPPED: "#64748B",
    STARTING: "#F59E0B",
    RUNNING: "#22C55E",
    STOPPING: "#F59E0B",
  };
  return colors[state] ?? "#64748B";
}

/** 统一错误消息提取 */
export function errorMessage(err: unknown, fallback = "操作失败"): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * 生成 RFC 4122 v4 UUID。
 * 优先 `crypto.randomUUID()`（安全上下文可用）；HTTP 非安全上下文下
 * `randomUUID` 不可用，fallback 到 `crypto.getRandomValues()` 手写 v4——
 * `getRandomValues` 在 HTTP/HTTPS 均可用且是 CSPRNG，不降级安全性。
 *
 * @returns 36 字符的 UUID v4 字符串（如 '9c1b5e4a-...'）
 *
 * @example
 * ```ts
 * generateUUID() // '9c1b5e4a-7a3f-4b5c-8d9e-0f1a2b3c4d5e'
 * ```
 */
export function generateUUID(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.getRandomValues === "function"
  ) {
    return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
      (
        +c ^
        (crypto.getRandomValues(new Uint8Array(1))[0]! & (15 >> (+c / 4)))
      ).toString(16),
    );
  }
  // 双 API 均不可用（理论不会触达）——非安全关键用途的兜底
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

// ─── Mod 工具（v2.2 新增）────────────────────────────

/**
 * 剥离 Steam Workshop BBCode（问题 3——后端 strip_description_bbcode 可能不生效时前端兜底）。
 * 移除 [tag]...[/tag] 对、孤立标签、解码 HTML 实体、折叠空白。
 *
 * @param text - 原始 BBCode 文本（Steam GetDetails 的 file_description）
 * @returns 纯文本
 *
 * @example
 * ```ts
 * stripBbcode('[h1]Hawaii[/h1] [EN]English[/EN]') // 'Hawaii English'
 * ```
 */
export function stripBbcode(text: string): string {
  if (!text) return "";
  return (
    text
      // 0. 特殊处理 [img]url[/img]——整对移除（URL 是内容不是属性，纯文本场景不需要图片）
      .replace(/\[img\]([\s\S]*?)\[\/img\]/gi, "")
      // 1. 移除 [tag=value]...[/tag] 完整对（含值，如 [color=red]...[/color]）
      .replace(/\[(\w+)(?:=[^\]]*)?\]([\s\S]*?)\[\/\1\]/g, "$2")
      // 2. 移除孤立开/闭标签（[b]、[/i]、[EN] 等）
      .replace(/\[\/?\w+(?:=[^\]]*)?\]/g, "")
      // 3. 解码常见 HTML 实体
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      // 4. 折叠连续空白
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * 格式化 Mod 元数据为带图标的前缀展示数组（问题 2——作者/订阅数/ID 视觉分层）。
 * 不直接渲染——返回数据由调用方用 <flex> + lucide 图标渲染，避免重复 JSX。
 *
 * @param meta - Mod 元数据
 * @param meta.author - 作者 SteamID64（fallback 显示）
 * @param meta.authorName - 作者昵称（GetPlayerSummaries 补全，优先显示）
 * @param meta.subscriptions - 订阅数（可选，有则显示）
 * @param meta.fileId - Workshop File ID
 * @returns 展示项数组：{ icon, text, className }
 *
 * @example
 * ```ts
 * formatModMeta({ author: '76561198...', authorName: 'Renaxon', subscriptions: 12345, fileId: '111' })
 * // [{ icon: User, text: 'Renaxon', className: 'text-slate-400 text-xs' },
 * //  { icon: Users, text: '1.2万 订阅', className: 'text-slate-500 text-xs' },
 * //  { icon: Hash, text: '111', className: 'text-slate-500 text-[11px] font-mono' }]
 * ```
 */
export function formatModMeta(meta: {
  author: string;
  authorName?: string;
  subscriptions?: number;
  fileId: string;
}): Array<{ icon: string; text: string; className: string }> {
  const items: Array<{ icon: string; text: string; className: string }> = [
    {
      icon: "User",
      text: meta.authorName || meta.author,
      className: "text-slate-400 text-xs",
    },
  ];
  if (meta.subscriptions != null && meta.subscriptions > 0) {
    items.push({
      icon: "Users",
      text: `${formatCompactNumber(meta.subscriptions)} 订阅`,
      className: "text-slate-500 text-xs",
    });
  }
  items.push({
    icon: "Hash",
    text: meta.fileId,
    className: "text-slate-500 text-[11px] font-mono",
  });
  return items;
}

/**
 * 大数紧凑格式化：12345 → 1.2万；1200 → 1200。
 * 订阅数等大数字展示用。
 *
 * @param n - 数字
 * @returns 紧凑格式字符串
 *
 * @example
 * ```ts
 * formatCompactNumber(12345) // '1.2万'
 * ```
 */
export function formatCompactNumber(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}亿`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}万`;
  return String(n);
}
