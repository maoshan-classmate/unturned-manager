# 铁律与小功能判定配置教程

> 本目录是 `UserPromptSubmit` 和 `PostToolUse` 两个 hook 的数据层。所有可调参数都在这里，**改配置不需要动 `.claude/hooks/*.sh` 脚本**。

---

## 目录结构

```
md/
├── README.md                       ← 你正在读这个
├── index.json                      ← 铁律清单（每轮 UserPromptSubmit 注入哪些）
├── threshold.json                  ← 小功能判定阈值（PostToolUse 用 git diff 累计检测）
└── always/
    ├── no-code-name-jargon.md      ← 铁律 1：禁止代码名+中文描述
    └── small-feature-validation.md ← 铁律 2：小功能走最小验证（量化版）
```

---

## 快速操作指引

### ① 调小功能阈值（最常用）

改 `threshold.json`：

```json
{
  "max_files": 3,           // ← 改成 5 表示允许改 5 个文件还是小功能
  "max_lines_per_file": 50, // ← 改成 80 表示单文件改 80 行还算小功能
  "code_extensions": [...], // ← 代码文件白名单（按扩展名匹配）
  "exclude_paths": [...]    // ← 不计入的路径前缀（如 docs/、.research/）
}
```

改完即时生效——下次 `PostToolUse` 触发就用新阈值。

### ② 加新铁律（每轮对话都注入的规则）

**两步**：

**第一步**——在 `always/` 下新建一个 `.md` 文件，写规则内容：

```bash
# 例：加一条「禁止 console.log 输出敏感信息」铁律
cat > always/no-sensitive-log.md <<'EOF'
# 禁止 console.log 输出敏感信息

## 总原则
所有日志输出严禁包含密码、token、API Key、GSLT、Steam WebAPI Key 等凭证。

## 正确示例
logger.info({ ctx }, '用户登录成功')

## 反面示例
console.log('登录成功 token=', token)
EOF
```

**第二步**——在 `index.json` 的 `always` 数组里加一项：

```json
{
  "always": [
    { "id": "no-code-name-jargon", "title": "...", "file": "always/no-code-name-jargon.md", "tags": [...] },
    { "id": "small-feature-validation", "title": "...", "file": "always/small-feature-validation.md", "tags": [...] },
    { "id": "no-sensitive-log", "title": "禁止日志输出凭证", "file": "always/no-sensitive-log.md", "tags": ["security", "logging"] }
  ]
}
```

下次用户提问时，新铁律自动注入。

### ③ 改代码文件白名单

比如想让 `.json`（如 schema 文件）也算代码改动：

```json
{
  "code_extensions": [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".sh", ".bash", ".py", ".json"]
}
```

### ④ 加更多排除路径

比如不想把 `experiments/` 下的临时实验代码计入：

```json
{
  "exclude_paths": ["docs/", "claudedocs/", ".claude/rules/", ".research/", "experiments/"]
}
```

排除路径以**路径前缀**匹配（用 `^` 锚定开头），所以写 `experiments/` 会排除所有 `experiments/` 开头的文件。

### ⑤ 临时关闭某条铁律

两种做法：

- **临时**：在 `index.json` 里把那条规则的整段注释掉（JSON 不支持注释，可以临时删掉那一项，或加 `"_disabled": true` 字段等后续支持）
- **永久**：从 `always/` 删掉对应 `.md` + 从 `index.json` 的 `always` 数组里删掉对应项

### ⑥ 临时关闭 PostToolUse 报警

直接注释掉 `.claude/settings.local.json` 里 `PostToolUse` 那段：

```jsonc
"PostToolUse": [
  // {
  //   "matcher": "Edit|Write|MultiEdit",
  //   "hooks": [{ "type": "command", "command": ".../small-feature-detect.sh" }]
  // }
]
```

---

## 手动测试 hook

### 测 UserPromptSubmit（铁律注入）

```bash
echo '{"prompt":"test"}' | bash .claude/hooks/iron-rules-inject.sh | jq
```

期望看到 JSON 里有 `hookSpecificOutput.additionalContext` 字段，含所有 always 规则的内容。

### 测 PostToolUse（小功能判定）

**无改动场景**（应该 silent）：

```bash
echo '{"tool_name":"Edit"}' | bash .claude/hooks/small-feature-detect.sh; echo "[EXIT=$?]"
```

期望：无输出（hook 看到工作区干净，silent），`exit=0`。

**超阈值场景**（应该报警）：

```bash
# 临时建 4 个 .ts 文件
for n in a b c d; do echo "// test" > /tmp/test-$n.ts; done
# 模拟改动（写文件到 git 仓库内，让 git diff HEAD 能看到）
# 然后触发 hook
echo '{"tool_name":"Edit"}' | bash .claude/hooks/small-feature-detect.sh
```

期望：`{"systemMessage":"⚠️ ...代码文件数 4 > 3..."}`。

**Read 工具跳过**：

```bash
echo '{"tool_name":"Read"}' | bash .claude/hooks/small-feature-detect.sh
```

期望：silent（不追踪非编辑类工具）。

---

## 故障排查

| 现象 | 原因 | 修复 |
|---|---|---|
| 铁律没注入 | `index.json` 路径错或格式坏 | `node -e "JSON.parse(require('fs').readFileSync('.claude/hooks/md/index.json'))"` 验证 |
| 每次都说超阈值 | 阈值设太低 / 工作区有遗留改动 | 跑 `git status --short` 看当前改动文件数 |
| PostToolUse 没报警 | 工具名不匹配 / git diff 空 | 确认 `tool_name` 是 `Edit`/`Write`/`MultiEdit` |
| hook 报错 | 脚本无执行权限 | `chmod +x .claude/hooks/*.sh` |
| JSON 输出被截断 | `.md` 文件有未转义字符 | 用 `JSON.stringify` 拼装（脚本已经这样做，不会有这问题） |

---

## 进阶：自定义 schema

当前 `index.json` 用 `$schema: iron-rules-v1` 标记。如果你将来想加新字段（如 `tags` 用于按场景筛选、`enabled` 用于远程开关），加字段时同步更新 `$schema` 版本号——loader 选最新版本。

---

## 关联文档

- 铁律内容来源：`CLAUDE.md §2`（Claude Code开发、输出内容铁律）
- Hook 注册位置：`.claude/settings.local.json` 的 `hooks.hooks` 块
- 现有 hook 参考实现：`.claude/hooks/check-doc-outdated.sh`