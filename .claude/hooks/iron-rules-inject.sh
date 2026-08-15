#!/usr/bin/env bash
# 铁律注入——读 index.json 加载 always 规则，注入到 UserPromptSubmit 上下文
# stdin：UserPromptSubmit 事件 JSON（此处不解析 prompt 本身，只 always 注入）
# stdout：{hookSpecificOutput:{hookEventName, additionalContext}} JSON
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INDEX="$SCRIPT_DIR/md/index.json"
MD_DIR="$SCRIPT_DIR/md"

# 消费 stdin（避免 "cat on closed stdin" 警告），不读内容
cat > /dev/null

# 用 node 读取 index.json + 各 always 规则的 .md 文件 + 拼成 additionalContext
# JSON.stringify 自动处理转义（双引号、反斜杠、换行符）
node -e "
  const fs = require('fs');
  const index = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
  const mdDir = process.argv[2];
  const parts = [];
  for (const r of index.always) {
    const content = fs.readFileSync(mdDir + '/' + r.file, 'utf8');
    parts.push('【' + r.title + '】\n\n' + content);
  }
  const ctx = parts.join('\n\n');
  const out = {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: ctx,
    },
  };
  process.stdout.write(JSON.stringify(out));
" "$INDEX" "$MD_DIR"
echo