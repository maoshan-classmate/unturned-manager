#!/usr/bin/env bash
# 代码注释历史叙述检测 —— PreToolUse hook（Edit|Write）
# 写入工具的代码注释命中关键词表时 → permissionDecision: deny 强制重写。
# 关键词表配置见 KEYWORDS_FILE；快速路径优先于检测。
#
# 输入：stdin JSON（PreToolUse 事件）
# 环境变量：$CLAUDE_PROJECT_DIR

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEYWORDS_FILE="$SCRIPT_DIR/md/comment-history-keywords.json"

# ── 消费 stdin 一次：node 同时提取 tool_name + tool_input（避免多次 read） ──
EVENT=$(node -e "
  let d = '';
  process.stdin.on('data', c => d += c);
  process.stdin.on('end', () => {
    try {
      const ev = JSON.parse(d);
      const input = ev.tool_input || {};
      const text = input.new_string !== undefined ? input.new_string : (input.content !== undefined ? input.content : '');
      process.stdout.write(JSON.stringify({
        tool_name: ev.tool_name || '',
        file_path: input.file_path || '',
        text: text
      }));
    } catch (e) {
      process.stdout.write(JSON.stringify({ tool_name: '', file_path: '', text: '' }));
    }
  });
")

TOOL_NAME=$(echo "$EVENT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(d).tool_name))")
FILE_PATH=$(echo "$EVENT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(d).file_path))")
TEXT=$(echo "$EVENT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(d).text))")

emit_allow() {
  local msg="$1"
  printf '{"systemMessage":"%s","hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}\n' "$msg"
}

emit_deny() {
  local user_msg="$1"
  local claude_reason="$2"
  printf '{"systemMessage":"%s","hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$user_msg" "$claude_reason"
}

# ── 快速路径 1: 工具名必须 Edit|Write ──
if [ "$TOOL_NAME" != "Edit" ] && [ "$TOOL_NAME" != "Write" ]; then
  emit_allow "代码注释历史叙述检测跳过(非 Edit|Write)"
  exit 0
fi

# ── 快速路径 2: 关键词表存在性 ──
if [ ! -f "$KEYWORDS_FILE" ]; then
  echo "代码注释历史叙述检测跳过: 关键词表不存在 $KEYWORDS_FILE" >&2
  emit_allow "代码注释历史叙述检测跳过(配置缺失)"
  exit 0
fi

# ── 快速路径 3: 文件扩展名白名单 ──
case "$FILE_PATH" in
  *.ts|*.tsx|*.js|*.jsx) ;;
  *) emit_allow "代码注释历史叙述检测跳过(非代码文件)"; exit 0 ;;
esac

# ── 快速路径 4: 文本为空 ──
if [ -z "$TEXT" ]; then
  emit_allow "代码注释历史叙述检测跳过(空文本)"
  exit 0
fi

# ── 关键词扫描 ──
KEYWORDS=$(node -e "
  const k = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).keywords;
  process.stdout.write(k.map(x => x.text).join('\n'));
" "$KEYWORDS_FILE")

# 移除字符串字面量避免误报（粗略：双引号 + 单引号字符串替换为空）
STRIPPED=$(printf '%s' "$TEXT" | sed -E 's/"[^"]*"/""/g; s/'\''[^'\'']*'\''/'\'''\''/g')

# 提取注释行：行首 // 或块注释续行 *，加行内尾注释（// 或 /* 紧跟空白）。
# 行内尾注释检测避免「const x = 1; // 修复了之前的 bug」漏检。
COMMENT_LINES=$(printf '%s\n' "$STRIPPED" | grep -nE '(^\s*(//|\*|/\*))|([[:space:]](//|/\*))' || true)

HIT_KW=""
for kw in $KEYWORDS; do
  if printf '%s\n' "$COMMENT_LINES" | grep -qF "$kw"; then
    HIT_KW="$kw"
    break
  fi
done

# ── 结果 ──
if [ -n "$HIT_KW" ]; then
  USER_MSG="❌ 注释含历史叙述：${HIT_KW}"
  CLAUDE_REASON="检测到代码注释含历史叙述（命中关键词：${HIT_KW}）。请删除历史叙述，仅保留最新版本描述。历史信息维护在 docs/ 或 claudedocs/ 或 git log，不进入代码注释。"
  emit_deny "$USER_MSG" "$CLAUDE_REASON"
else
  emit_allow "代码注释历史叙述检测通过"
fi

exit 0