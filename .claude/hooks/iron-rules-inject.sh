#!/usr/bin/env bash
# 铁律注入——读 index.json 加载 always 规则，注入到 UserPromptSubmit 上下文
# stdin：UserPromptSubmit 事件 JSON（此处不解析 prompt 本身，只 always 注入）
# stdout：纯文本铁律——UserPromptSubmit 会把纯文本 stdout 直接注入为上下文（官方支持）。
# 不用 JSON additionalContext 是因为 hook 运行时子进程的 stdout 可能被 profile/环境污染，
# 导致首字符非 { 而整体被当纯文本注入（连 JSON 一起注入的 bug）。纯文本绕开 JSON 解析路径。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INDEX="$SCRIPT_DIR/md/index.json"
MD_DIR="$SCRIPT_DIR/md"
THRESHOLD="$SCRIPT_DIR/md/threshold.json"

# 消费 stdin（避免 "cat on closed stdin" 警告），不读内容
cat > /dev/null

# 用 node 读取 index.json + 各 always 规则的 .md 文件，提取 <!-- INJECT --> 标签内的精炼指令，
# 动态替换阈值占位符，最后用 <EXTREMELY_IMPORTANT> 包裹纯文本输出。
# 标签外内容保留给人读，不注入——避免把元信息/长示例灌进上下文。
node -e "
  const fs = require('fs');
  const index = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
  const mdDir = process.argv[2];
  const threshold = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const replacements = {
    '{max_files}': String(threshold.max_files),
    '{max_lines_per_file}': String(threshold.max_lines_per_file),
    '{code_extensions}': threshold.code_extensions.join(' '),
  };
  const replaceAll = (s) => Object.entries(replacements)
    .reduce((acc, [k, v]) => acc.split(k).join(v), s);

  // 提取每个规则的 INJECT 标签段（标签外内容不注入）
  const startMarker = '<!-- INJECT -->';
  const endMarker = '<!-- /INJECT -->';
  const parts = [];
  for (const r of index.always) {
    const content = fs.readFileSync(mdDir + '/' + r.file, 'utf8');
    const start = content.indexOf(startMarker);
    if (start === -1) continue;
    const end = content.indexOf(endMarker, start);
    if (end === -1) continue;
    const inject = content.slice(start + startMarker.length, end).trim();
    parts.push('【' + r.title + '】\n\n' + replaceAll(inject));
  }

  // <EXTREMELY_IMPORTANT> 强调标签 + 极简引导框架
  const intro = '以下铁律必须严格遵守：';
  const ctx = '<EXTREMELY_IMPORTANT>\n' + intro + '\n\n' + parts.join('\n\n') + '\n</EXTREMELY_IMPORTANT>';
  // 直接输出纯文本——UserPromptSubmit 官方支持纯文本 stdout 注入上下文
  process.stdout.write(ctx);
" "$INDEX" "$MD_DIR" "$THRESHOLD"
echo