#!/usr/bin/env bash
# 文档过时检测 —— 机械层（阻断级）
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

echo " 文档检查..."

# ── 必检文件：与 .claude/rules/document-organization.md §Command 层 严格对齐 ──
# 每个条目格式："目录|通配模式或文件名|分类标签"
# 通配模式（如 reference_*.md）→ 该分类下所有匹配文件自动纳入检查，新增文件无需修改脚本
# 精确文件名 → 仅检查该文件

REQUIRED_DOCS=(
  "docs/architecture|architecture-spec.md design-system-mapping.md|架构规格"
  "docs|external-resources.md|外部资源索引"
  "claudedocs|reference_*.md|活参考文档"
  "claudedocs|research_verification_tracker.md|核心调研报告"
)

# 检查 1: CLAUDE.md 的 @path 死引用
ERRS=$(check_at_refs "$PROJECT_DIR/CLAUDE.md" "CLAUDE.md")
ERRORS=$((ERRORS + ERRS))

# 检查 2: .claude/rules/*.md 的 @path 死引用
for rule in "$PROJECT_DIR"/.claude/rules/*.md; do
  [ -f "$rule" ] || continue
  ERRS=$(check_at_refs "$rule" ".claude/rules/$(basename "$rule")")
  ERRORS=$((ERRORS + ERRS))
done

# 检查 3: 必检文件（按上述 REQUIRED_DOCS 定义，逐分类检查）
for entry in "${REQUIRED_DOCS[@]}"; do
  IFS='|' read -r dir pattern label <<< "$entry"
  # 通配模式：展开后逐一检查；精确文件名：直接检查
  for pat in $pattern; do
    if [[ "$pat" == *"*"* ]]; then
      # 通配模式——该分类下所有匹配文件都必须存在
      found_any=false
      for f in "$PROJECT_DIR/$dir"/$pat; do
        [ -f "$f" ] && found_any=true
      done
      if [ "$found_any" = false ]; then
        echo "  缺失${label}: $dir/$pat (无匹配文件)" >&2
        ERRORS=$((ERRORS + 1))
      fi
    else
      # 精确文件名
      if [ ! -f "$PROJECT_DIR/$dir/$pat" ]; then
        echo "  缺失${label}: $dir/$pat" >&2
        ERRORS=$((ERRORS + 1))
      fi
    fi
  done
done

# ── 结果 ──
if [ "$ERRORS" -gt 0 ]; then
  echo "❌ 文档检查失败 ($ERRORS 项问题)" >&2
  echo "💡 修复上述问题后再 commit" >&2
  exit 2
fi


SYSTEM_MSG="文档检查通过"
printf '{"systemMessage":"%s","hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}\n' "$SYSTEM_MSG"
exit 0
