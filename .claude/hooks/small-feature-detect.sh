#!/usr/bin/env bash
# 小功能判定——Stop 事件触发（Claude 收尾时判定一次），读 git diff 累计改动；属小功能时经 additionalContext 提醒最小验证
# stdin：Stop 事件 JSON（含 prompt_id）
# stdout：JSON { hookSpecificOutput: { hookEventName: "Stop", additionalContext } }——非 block 决策，不阻止停止
# 判定依据：git diff HEAD --numstat + 未跟踪文件，按 threshold.json 过滤（代码扩展名白名单 + 排除路径）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
THRESHOLD="$SCRIPT_DIR/md/threshold.json"
TMP_INPUT="/tmp/small-feature-detect.input.json"
STATE_FILE="/tmp/small-feature-detect.state"

# 消费 stdin 落盘——避免 data 事件分块导致 JSON.parse 失败
cat > "$TMP_INPUT"

# 读 prompt_id（用于同轮去重：Claude 补跑 typecheck 后再收尾时不重复注入）
PROMPT_ID=$(node -e "
  const fs = require('fs');
  try {
    const d = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
    process.stdout.write(d.prompt_id || '');
  } catch (e) {}
" "$TMP_INPUT")

# 同轮已注入过 → 放行
if [ -n "$PROMPT_ID" ] && [ -f "$STATE_FILE" ] && [ "$(cat "$STATE_FILE")" = "$PROMPT_ID" ]; then
  exit 0
fi

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

# 解析阈值 + 过滤 numstat + 判定；小功能 → stdout 输出 additionalContext JSON；否则静默
OUTPUT=$(node -e "
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

  // 0 个代码文件 → 静默（纯文档/聊天收尾）
  if (codeFiles.length === 0) { process.exit(0); }

  // 判定小功能：代码文件数 ≤ 阈值 且 单文件改动 ≤ 阈值 → additionalContext 提醒最小验证；任一超出 → 静默
  const isSmall = codeFiles.length <= threshold.max_files && maxChanged <= threshold.max_lines_per_file;
  if (isSmall) {
    const msg = '本轮改动属小功能（' + codeFiles.length + ' 个代码文件，单文件最多 ' + maxChanged + ' 行），走最小验证即可：跑 typecheck 通过即可，不需要跑单测/e2e。';
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'Stop',
        additionalContext: msg
      }
    }));
  }
" "$THRESHOLD" "$ALL_NUMSTAT")

# 注入成功 → 记录本轮 prompt_id（同轮去重，避免补跑 typecheck 后再收尾重复注入）
if [ -n "$OUTPUT" ]; then
  printf '%s\n' "$OUTPUT"
  [ -n "$PROMPT_ID" ] && echo "$PROMPT_ID" > "$STATE_FILE"
fi