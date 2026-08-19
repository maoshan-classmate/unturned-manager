import { describe, it, expect } from 'vitest';
import { stripBbcode, formatModMeta, formatCompactNumber, formatSize, formatDate } from './utils.js';

// ─── stripBbcode（问题 3）──────────────────────────────

describe('stripBbcode', () => {
  it('移除 [h1]xxx[/h1] 完整对', () => {
    expect(stripBbcode('[h1]Hawaii[/h1]')).toBe('Hawaii');
  });

  it('移除孤立 [EN] 标签', () => {
    expect(stripBbcode('[EN] English')).toBe('English');
  });

  it('移除 [b] [i] 等行内标签', () => {
    expect(stripBbcode('[b]bold[/b] [i]italic[/i]')).toBe('bold italic');
  });

  it('移除带值的标签 [url=http://...]text[/url]', () => {
    expect(stripBbcode('[url=https://steamcommunity.com]Steam[/url]')).toBe('Steam');
  });

  it('处理嵌套标签', () => {
    expect(stripBbcode('[b]bold [i]italic[/i][/b]')).toBe('bold italic');
  });

  it('解码 HTML 实体', () => {
    expect(stripBbcode('A &amp; B')).toBe('A & B');
    expect(stripBbcode('&lt;tag&gt;')).toBe('<tag>');
  });

  it('折叠连续空白', () => {
    expect(stripBbcode('line1\n\n  line2')).toBe('line1 line2');
  });

  it('真实 Steam 描述 fixture（含 [h1] [EN] [img]）', () => {
    const raw =
      '[h1]About[/h1]\n[EN]English description[/EN]\n[img]https://example.com/x.png[/img]\nMore text';
    expect(stripBbcode(raw)).toBe('About English description More text');
  });

  it('空字符串返回空', () => {
    expect(stripBbcode('')).toBe('');
  });

  it('null/undefined 安全（走空串）', () => {
    expect(stripBbcode(undefined as unknown as string)).toBe('');
  });
});

// ─── formatModMeta（问题 2）────────────────────────────

describe('formatModMeta', () => {
  it('authorName 存在时优先显示昵称', () => {
    const items = formatModMeta({ author: '76561198000000001', authorName: 'Renaxon', fileId: '111' });
    expect(items[0]!).toMatchObject({ text: 'Renaxon', className: 'text-slate-400 text-xs' });
    expect(items[0]!.icon).toBe('User');
  });

  it('authorName 缺失时回退 SteamID64', () => {
    const items = formatModMeta({ author: '76561198000000001', fileId: '111' });
    expect(items[0]!.text).toBe('76561198000000001');
  });

  it('订阅数存在时追加 订阅 项', () => {
    const items = formatModMeta({ author: 'A', subscriptions: 12345, fileId: '111' });
    expect(items).toHaveLength(3);
    expect(items[1]).toMatchObject({ icon: 'Users', text: '1.2万 订阅' });
  });

  it('订阅数为 0 或缺失时不显示订阅项', () => {
    const items0 = formatModMeta({ author: 'A', subscriptions: 0, fileId: '111' });
    const itemsUndef = formatModMeta({ author: 'A', fileId: '111' });
    expect(items0).toHaveLength(2);
    expect(itemsUndef).toHaveLength(2);
  });

  it('ID 用 font-mono 弱化显示', () => {
    const items = formatModMeta({ author: 'A', fileId: '111' });
    expect(items[items.length - 1]!).toMatchObject({ icon: 'Hash', text: '111', className: expect.stringContaining('font-mono') });
  });
});

// ─── formatCompactNumber ───────────────────────────────

describe('formatCompactNumber', () => {
  it('1.2 万档', () => {
    expect(formatCompactNumber(12345)).toBe('1.2万');
  });
  it('亿档', () => {
    expect(formatCompactNumber(123_456_789)).toBe('1.2亿');
  });
  it('万以下原样', () => {
    expect(formatCompactNumber(999)).toBe('999');
  });
});

// ─── 既有工具回归 ──────────────────────────────────────

describe('既有工具回归', () => {
  it('formatSize', () => {
    expect(formatSize(1024 * 1024)).toBe('1.0 MB');
    expect(formatSize(undefined)).toBe('—');
  });
  it('formatDate', () => {
    expect(formatDate('2026-08-09T10:00:00Z')).toBe('2026-08-09');
  });
});

// ─── 数字工具函数（P4B 单测——D6 拍板全覆盖）────────────────────────────

import {
  formatBytes,
  formatNumber,
  formatDecimal,
  formatSteamId64,
  formatUptime,
  formatDurationMs,
} from './utils.js';

describe('formatBytes', () => {
  it('0/负数/空值兜底为 —', () => {
    expect(formatBytes(0)).toBe('—');
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(undefined)).toBe('—');
  });
  it('B / KB / MB / GB 自适应', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe('2.0 GB');
  });
});

describe('formatNumber（千分位）', () => {
  it('1234567 → 1,234,567', () => {
    expect(formatNumber(1_234_567)).toBe('1,234,567');
  });
  it('0/负数/小数正常', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(-1234)).toBe('-1,234');
    expect(formatNumber(1234.5)).toBe('1,234.5');
  });
});

describe('formatDecimal', () => {
  it('1.234 → "1.23"', () => {
    expect(formatDecimal(1.234)).toBe('1.23');
  });
  it('1.5 → "1.50"（强制 2 位小数）', () => {
    expect(formatDecimal(1.5)).toBe('1.50');
  });
  it('nullish / NaN 兜底空字符串', () => {
    expect(formatDecimal(undefined as unknown as number)).toBe('');
    expect(formatDecimal(NaN)).toBe('');
  });
});

describe('formatSteamId64', () => {
  it('标准 17 位 SteamID 原样返回', () => {
    expect(formatSteamId64('76561198000000001')).toBe('76561198000000001');
  });
  it('D4 拍板：全展示，不隐藏中间位', () => {
    expect(formatSteamId64('76561198888888888')).toBe('76561198888888888');
  });
  it('trim 前后空白', () => {
    expect(formatSteamId64('  76561198000000001  ')).toBe('76561198000000001');
  });
});

describe('formatUptime', () => {
  it('< 60 秒 → "N 秒"', () => {
    expect(formatUptime(30)).toBe('30 秒');
    expect(formatUptime(0)).toBe('0 秒');
  });
  it('< 60 分 → "X分Y秒"', () => {
    expect(formatUptime(125)).toBe('2分5秒');
  });
  it('≥ 60 分 → "X时Y分"', () => {
    expect(formatUptime(3661)).toBe('1时1分');
  });
  it('负数 / NaN / Infinity 兜底 —', () => {
    expect(formatUptime(-1)).toBe('—');
    expect(formatUptime(NaN)).toBe('—');
    expect(formatUptime(Infinity)).toBe('—');
  });
});

describe('formatDurationMs', () => {
  it('< 1 秒 → "N 毫秒"', () => {
    expect(formatDurationMs(500)).toBe('500 毫秒');
  });
  it('< 1 分 → "X.X 秒"', () => {
    expect(formatDurationMs(3500)).toBe('3.5 秒');
  });
  it('< 1 时 → "X.X 分"', () => {
    expect(formatDurationMs(90_000)).toBe('1.5 分');
  });
  it('≥ 1 时 → "X.X 时"', () => {
    expect(formatDurationMs(3_600_000)).toBe('1.0 时');
  });
  it('负数 / NaN 兜底 —', () => {
    expect(formatDurationMs(-1)).toBe('—');
    expect(formatDurationMs(NaN)).toBe('—');
  });
});
