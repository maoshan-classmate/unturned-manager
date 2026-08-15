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
  // 引导框架——让注入内容成为一段完整的、有明确指令语义的提示词，
  const intro = '你是本项目的开发助手。以下铁律对你的一切输出生效——终端输出、文档输出、架构设计输出、工作流输出、测试输出、任务清单输出——必须严格遵守：';
  const ctx = intro + '\n\n' + parts.join('\n\n');
  // 直接输出纯文本——UserPromptSubmit 官方支持纯文本 stdout 注入上下文
  process.stdout.write(ctx);
" "$INDEX" "$MD_DIR"
echo