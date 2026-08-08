#!/usr/bin/env bash
# 文档新鲜度守卫 —— 机械层（阻断级）
# 检查死引用、核心文档缺失。发现致命问题 → exit 2 阻断 commit。
#
# 输入：stdin JSON（PreToolUse 事件）
# 环境变量：$CLAUDE_PROJECT_DIR

set -euo pipefail

# ── 快速路径 1: 只拦截 git commit / git push ──
CMD=$(node -e "process.stdin.on('data',d=>{process.stdout.write(JSON.parse(d).tool_input.command||'')})")
if ! echo "$CMD" | grep -qE '\bgit\s+(commit|push)\b'; then
  exit 0
fi

# ── 快速路径 2: 无文档变更则跳过 ──
DOC_CHANGES=$(git diff --cached --name-only | grep -E '\.(md|ya?ml|json)$' || true)
if [ -z "$DOC_CHANGES" ]; then
  exit 0
fi

# ── 机械检查 ──
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
ERRORS=0

# 辅助函数：提取文件中的 @path 引用并验证
# 通过 stdout 返回发现的错误数，避免管道 subshell 问题
check_at_refs() {
  local file="$1"
  local label="$2"
  local errs=0
  [ ! -f "$file" ] && { echo 0; return; }
  local refs
  refs=$(grep -oP '@([a-zA-Z0-9_/.\\-]+)' "$file" 2>/dev/null || true)
  refs=$(echo "$refs" | grep -E '\.(md|ya?ml|json|ts|tsx|sh)$' || true)
  [ -z "$refs" ] && { echo 0; return; }
  while IFS= read -r ref; do
    local path="${ref#@}"
    [ "$path" = "$file" ] && continue
    if [ ! -f "$PROJECT_DIR/$path" ]; then
      echo "  死引用: $label → $ref (文件不存在: $path)" >&2
      errs=$((errs + 1))
    fi
  done <<< "$refs"
  echo "$errs"
}

echo "📋 文档新鲜度检查..."

# 检查 1: CLAUDE.md 的死引用
ERRS=$(check_at_refs "$PROJECT_DIR/CLAUDE.md" "CLAUDE.md")
ERRORS=$((ERRORS + ERRS))

# 检查 2: .claude/rules/*.md 的死引用
for rule in "$PROJECT_DIR"/.claude/rules/*.md; do
  [ -f "$rule" ] || continue
  ERRS=$(check_at_refs "$rule" ".claude/rules/$(basename "$rule")")
  ERRORS=$((ERRORS + ERRS))
done

# 检查 3: 核心架构文档
for doc in \
  "docs/architecture/architecture-spec.md" \
  "docs/architecture/design-system-mapping.md"; do
  if [ ! -f "$PROJECT_DIR/$doc" ]; then
    echo "  缺失核心文档: $doc" >&2
    ERRORS=$((ERRORS + 1))
  fi
done

# 检查 4: 活参考文档
for doc in \
  "claudedocs/reference_config_files.md" \
  "claudedocs/reference_console_commands.md" \
  "claudedocs/research_verification_tracker.md"; do
  if [ ! -f "$PROJECT_DIR/$doc" ]; then
    echo "  缺失活参考文档: $doc" >&2
    ERRORS=$((ERRORS + 1))
  fi
done

# ── 结果 ──
if [ "$ERRORS" -gt 0 ]; then
  echo "❌ 文档新鲜度检查失败 ($ERRORS 项问题)" >&2
  echo "💡 修复上述问题后再 commit" >&2
  exit 2
fi

echo "✅ 文档新鲜度检查通过"
exit 0
