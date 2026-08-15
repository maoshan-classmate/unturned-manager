#!/usr/bin/env bash
# 小功能判定——读 git diff 累计改动，超阈值时 systemMessage 提醒
# stdin：PostToolUse 事件 JSON（含 tool_name）
# stdout：超阈值时输出 {systemMessage} JSON；否则 silent
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
THRESHOLD="$SCRIPT_DIR/md/threshold.json"

# 读 stdin → 拿 tool_name（参考 check-doc-outdated.sh 风格）
TOOL_NAME=$(cat | node -e "process.stdin.on('data', d => { try { process.stdout.write(JSON.parse(d).tool_name || ''); } catch (e) {} })")

# 只追踪 Edit/Write/MultiEdit
case "$TOOL_NAME" in
  Edit|Write|MultiEdit) ;;
  *) exit 0 ;;
esac

# 已修改文件的 numstat（HEAD 比工作区，含已暂存 + 未暂存）
MODIFIED_NUMSTAT=$(git diff HEAD --numstat 2>/dev/null || true)

# 未跟踪文件列表——按 wc -l 算行数（agent 用 Write 新建的文件）
UNTRACKED_FILES=$(git ls-files --others --exclude-standard 2>/dev/null || true)
UNTRACKED_NUMSTAT=""
if [ -n "$UNTRACKED_FILES" ]; then
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    [ -f "$f" ] || continue
    LINES=$(wc -l < "$f" 2>/dev/null | tr -d ' ' || echo 0)
    UNTRACKED_NUMSTAT+="${LINES}"$'\t'"0"$'\t'"${f}"$'\n'
  done <<< "$UNTRACKED_FILES"
fi

# 合并 modified + untracked
ALL_NUMSTAT="${MODIFIED_NUMSTAT}"$'\n'"${UNTRACKED_NUMSTAT}"

# 用 node 解析阈值 + 过滤 numstat + 判定 + 拼 JSON
node -e "
  const fs = require('fs');
  const threshold = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
  const numstat = process.argv[2];

  if (!numstat.trim()) { process.exit(0); }

  // 扩展名正则：(\.ts|\.tsx|\.js|...)\$
  const extPattern = new RegExp(
    '(' + threshold.code_extensions.map(e => e.replace(/\./g, '\\\\.')).join('|') + ')\$'
  );
  // 排除路径正则：^(docs/|claudedocs/|...)
  const excludePattern = new RegExp(
    threshold.exclude_paths.map(p => '^' + p.replace(/\//g, '\\\\/')).join('|')
  );

  const lines = numstat.split('\n').filter(Boolean);
  const codeFiles = [];
  let maxChanged = 0;

  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const added = parts[0], removed = parts[1];
    const file = parts.slice(2).join('\t');
    if (added === '-') continue; // 二进制文件跳过
    if (!extPattern.test(file)) continue;
    if (excludePattern.test(file)) continue;
    const total = parseInt(added, 10) + parseInt(removed, 10);
    codeFiles.push(file);
    if (total > maxChanged) maxChanged = total;
  }

  if (codeFiles.length > threshold.max_files) {
    const msg = '⚠️ 本次累计改动超出小功能阈值：代码文件数 ' + codeFiles.length + ' > ' + threshold.max_files + '。建议走完整验证（typecheck + 单测 + e2e）';
    process.stdout.write(JSON.stringify({ systemMessage: msg }));
  } else if (maxChanged > threshold.max_lines_per_file) {
    const msg = '⚠️ 本次累计改动超出小功能阈值：单文件改动 ' + maxChanged + ' 行 > ' + threshold.max_lines_per_file + '。建议走完整验证（typecheck + 单测 + e2e）';
    process.stdout.write(JSON.stringify({ systemMessage: msg }));
  }
" "$THRESHOLD" "$ALL_NUMSTAT"