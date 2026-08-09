/**
 * VDF (Valve Data Format) 解析器 + 序列化器
 *
 * 用于解析 SteamCMD 生成的 `appworkshop_<AppID>.acf` 文件。
 * 零依赖自写。
 *
 * VDF 语法（简化版）：
 *   "key" "value"
 *   "key" { "nested" "value" }
 *   "key" { "nested" { "deep" "value" } }
 *
 * 注释支持（SteamCMD 输出会有）：
 *   // 行注释
 *   slash-star ... star-slash 块注释
 */

// ─── 类型 ────────────────────────────────────────────────

/** VDF 节点：字符串值或嵌套对象 */
export type VdfNode = VdfValue | VdfObject;
export type VdfValue = string;
export interface VdfObject {
  [key: string]: VdfNode;
}

// ─── 解析器 ──────────────────────────────────────────────

/** 词法单元 */
type Token = { type: 'string'; value: string } | { type: 'openBrace' } | { type: 'closeBrace' };

/**
 * 将 VDF 文本解析为嵌套对象
 *
 * @param text - VDF 格式文本
 * @returns 根节点（通常是一个 key 包裹的 VdfObject）
 * @throws 当文本语法错误时（未闭合的引号 / 大括号）
 */
export function parseVdf(text: string): VdfObject {
  const tokens = tokenize(text);
  if (tokens.length === 0) return {};

  // 顶层必须是 "key" { ... } 形式；提取根 key
  const firstString = tokens[0]!;
  if (firstString.type !== 'string') {
    throw new VdfParseError('VDF 文本必须以字符串 key 开头');
  }
  const rootKey = firstString.value;
  if (tokens.length < 2 || tokens[1]!.type !== 'openBrace') {
    throw new VdfParseError(`根 key "${rootKey}" 缺少 { } 块`);
  }

  const rootValue: VdfObject = {};
  parseBlock(tokens, 2, rootValue);

  return { [rootKey]: rootValue };
}

/**
 * 词法分析：文本 → token 流
 */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = text.length;

  while (i < len) {
    // 跳过空白
    while (i < len && /\s/.test(text[i]!)) i++;
    if (i >= len) break;

    const ch = text[i]!;

    // 跳过行注释 //
    if (ch === '/' && text[i + 1] === '/') {
      while (i < len && text[i] !== '\n') i++;
      continue;
    }
    // 跳过块注释 /* ... */
    if (ch === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < len && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }

    if (ch === '{') {
      tokens.push({ type: 'openBrace' });
      i++;
      continue;
    }
    if (ch === '}') {
      tokens.push({ type: 'closeBrace' });
      i++;
      continue;
    }
    if (ch === '"') {
      const { value, next } = readQuotedString(text, i);
      tokens.push({ type: 'string', value });
      i = next;
      continue;
    }

    throw new VdfParseError(`非法字符 '${ch}' at position ${i}`);
  }

  return tokens;
}

/**
 * 从 text[start] 开始读一个引号字符串
 * @returns 解析出的字符串值 + 下一个读取位置
 */
function readQuotedString(text: string, start: number): { value: string; next: number } {
  if (text[start] !== '"') {
    throw new VdfParseError(`期望引号，实际 '${text[start]}' at ${start}`);
  }
  let i = start + 1;
  let value = '';
  const len = text.length;

  while (i < len) {
    const ch = text[i]!;
    if (ch === '\\' && i + 1 < len) {
      // 转义：\" \\ \n \t
      const next = text[i + 1]!;
      if (next === '"' || next === '\\') {
        value += next;
        i += 2;
        continue;
      }
      if (next === 'n') {
        value += '\n';
        i += 2;
        continue;
      }
      if (next === 't') {
        value += '\t';
        i += 2;
        continue;
      }
    }
    if (ch === '"') {
      return { value, next: i + 1 };
    }
    value += ch;
    i++;
  }

  throw new VdfParseError(`字符串未闭合 at ${start}`);
}

/**
 * 递归解析 {...} 块
 * @param tokens - 词法 token 流
 * @param start - 解析起始位置
 * @param out - 输出对象（写入键值对）
 * @returns 消费到的位置（遇到 closeBrace 之后）
 */
function parseBlock(tokens: Token[], start: number, out: VdfObject): number {
  let i = start;

  while (i < tokens.length) {
    const tok = tokens[i]!;
    if (tok.type === 'closeBrace') {
      return i + 1; // 消费 closeBrace
    }
    if (tok.type !== 'string') {
      throw new VdfParseError(`期望字符串 key，实际 ${tok.type} at token ${i}`);
    }
    const key = tok.value;
    i++;

    if (i >= tokens.length) {
      throw new VdfParseError(`key "${key}" 后缺少值或 { }`);
    }
    const next = tokens[i]!;
    if (next.type === 'string') {
      // key "value" 形式
      out[key] = next.value;
      i++;
    } else if (next.type === 'openBrace') {
      // key { ... } 形式
      const nested: VdfObject = {};
      i = parseBlock(tokens, i + 1, nested);
      out[key] = nested;
    } else {
      throw new VdfParseError(`key "${key}" 后的 token 非法`);
    }
  }

  throw new VdfParseError('块未闭合（缺少 }）');
}

// ─── 序列化器 ────────────────────────────────────────────

/**
 * 将嵌套对象序列化为 VDF 文本
 *
 * @param obj - 根 VdfObject（必须只有一个顶层 key，VDF 格式约束）
 * @returns VDF 格式文本
 * @throws 当 obj 有多个顶层 key 或零个 key 时
 */
export function serializeVdf(obj: VdfObject): string {
  const keys = Object.keys(obj);
  if (keys.length !== 1) {
    throw new VdfSerializeError(`VDF 根对象必须恰好 1 个 key，实际 ${keys.length}`);
  }
  const rootKey = keys[0]!;
  const rootValue = obj[rootKey];
  if (typeof rootValue !== 'object' || rootValue === null) {
    throw new VdfSerializeError(`VDF 根值必须是对象`);
  }
  return `"${escapeVdfString(rootKey)}"\n{\n${serializeBlock(rootValue as VdfObject, 1)}}`;
}

function serializeBlock(obj: VdfObject, indent: number): string {
  const pad = '  '.repeat(indent);
  const lines: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      lines.push(`${pad}"${escapeVdfString(key)}"\t\t"${escapeVdfString(value)}"`);
    } else {
      lines.push(`${pad}"${escapeVdfString(key)}"`);
      lines.push(`${pad}{`);
      lines.push(serializeBlock(value, indent + 1));
      lines.push(`${pad}}`);
    }
  }
  return lines.join('\n') + '\n';
}

function escapeVdfString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// ─── 错误 ────────────────────────────────────────────────

export class VdfParseError extends Error {
  override name = 'VdfParseError';
}
export class VdfSerializeError extends Error {
  override name = 'VdfSerializeError';
}
