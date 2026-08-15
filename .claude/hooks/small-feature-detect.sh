#!/usr/bin/env bash
# 小功能判定——读 git diff 累计改动，属于小功能（未超阈值）时 stderr 提醒最小验证 + exit 2 喂给 Claude
# stdin：PostToolUse 事件 JSON（含 tool_name）
# stderr + exit 2：PostToolUse 场景 exit 2 不阻断工具，仅把提醒文本喂给 Claude 上下文；超阈值时静默
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
THRESHOLD="$SCRIPT_DIR/md/threshold.json"

# 读 stdin → 拿 tool_name
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

# 用 node 解析阈值 + 过滤 numstat + 判定；小功能（未超阈值）stderr 提醒最小验证 + exit 2，超阈值静默
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

  // 判定小功能：代码文件数 ≤ 阈值 且 单文件改动 ≤ 阈值 → 提醒最小验证；任一超出 → 静默
  const isSmall = codeFiles.length <= threshold.max_files && maxChanged <= threshold.max_lines_per_file;
  if (isSmall) {
    const msg = '✅ 当前累计改动属于小功能（' + codeFiles.length + ' 个代码文件，单文件最多 ' + maxChanged + ' 行）。走最小验证即可：跑 typecheck 通过即可，不跑单测/e2e。';
    process.stderr.write(msg + '\n');
    process.exit(2);
  }
" "$THRESHOLD" "$ALL_NUMSTAT"