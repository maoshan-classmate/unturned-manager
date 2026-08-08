# 开发工作流

## 新会话必读顺序

1. `CLAUDE.md`（项目宪法入口）
2. `docs/architecture/architecture-spec.md`（后端模块边界）
3. `docs/architecture/design-system-mapping.md`（前端设计映射）
4. `claudedocs/reference_config_files.md`（配置文件字段权威表）
5. `claudedocs/reference_console_commands.md`（RCON 命令参考）
6. `claudedocs/research_verification_tracker.md`（未验证项清单）

## 提交规范

- **Commit message 格式**：参见 `CLAUDE.md` §4——`<操作名>: <简要概括>`
- **分支命名**：`feat/<范围>`、`fix/<范围>`、`refactor/<范围>`、`docs/<范围>`、`chore/<范围>`
- 每个非平凡的决策写一份 ADR，放在 `docs/adr/NNNN-标题.md`
- 同一个 PR 里更新对应的 Serena 记忆

### ⚠️ git add 和 git commit 必须分两次 Bash 调用

PreToolUse hook 在 Bash 命令执行**前**触发。`git add && git commit` 合并在一个调用里时，
`git add` 还没执行——`git diff --cached` 为空，`check-doc-outdated.sh` 快速路径直接跳过检查。

```
❌ git add . && git commit -m "..."   # hook 看不见 staged 变更
✅ git add <files>                     # 第一步：stage
   git commit -m "..."                 # 第二步：commit（hook 正常拦截）
```

### git commit 前文档过时检测流程

先 `git diff --cached --name-only`，**仅当 staged 含 `.md` 文件时**才执行以下三步（无 .md 则直接 commit）：

```
① git add <files>
② git diff --cached --name-only | grep '\.md$'
   → 有结果: 调 doc-outdated-guard subagent + 输出 🔍 提示
   → 无结果: 直接跳到 ③
③ git commit -m "..."
```

subagent 发现问题的处理方式：

| subagent 返回 | 处理方式 |
|---|---|
| 无输出 | → 继续 commit |
| 🗑️ DELETE_SUGGESTION | AskUserQuestion 确认后删除 |
| ✏️ FIX_SUGGESTION | 直接派 subagent 修，不打断用户 |
| ⚠️ REVIEW_NEEDED | 展示给用户等拍板 |

## 验证门槛

每个 PR 必须通过：

| 门槛 | 工具 | 通过标准 |
|---|---|---|
| 类型检查 | `tsc --noEmit` | 零错误 |
| 代码风格 | eslint + prettier | 零警告 |
| 单元测试 | 前端 vitest、后端 jest | 改到的文件行覆盖率 ≥ 80% |
| E2E 冒烟 | playwright（每个改到的功能至少一个用例） | 跑通主流程 |
| 接口契约校验 | ajv 加在所有 API 边界 | 通过 |

## 每个功能 PR 必须带的 5 件套

- [ ] 在 `shared/schemas/` 里加 Zod schema（如涉及 API 边界）
- [ ] 如动了数据库 schema，加迁移脚本
- [ ] RCON 助手**用录制回放来测**（不是连真服务）
- [ ] UI 组件加 Storybook 或截图测试
- [ ] 如加了新的字段/命令，去更新 `claudedocs/` 里对应的参考文档

## 完成定义（Definition of Done）

- [ ] 代码读起来像普通英语，注释只在"意图不那么显然"的地方加
- [ ] 没引入 `any`
- [ ] 没提交任何密钥（`.env*` 已加 git 忽略，配置从 compose 环境变量来）
- [ ] `.research/` 下任何文件都没动过
- [ ] 本文档规定的任何一条红线都没违反
