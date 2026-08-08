# 文档存放规范

> 所有文档按类型存入固定位置。文档新鲜度守卫 hook 依赖这些约定做腐坏检测。

## 文档类型 → 位置映射

| 文档类型 | 位置 | 命名规范 | 示例 |
|---|---|---|---|
| 架构决策记录 | `docs/adr/` | `NNNN-简短标题.md`（4 位序号） | `docs/adr/0001-adopt-motion.md` |
| 架构规格 | `docs/architecture/` | `kebab-case.md` | `docs/architecture/architecture-spec.md` |
| 调研报告 | `claudedocs/` | `research_<主题>_YYYY-MM-DD.md` | `claudedocs/research_rcon_2026-08-03.md` |
| 活参考文档 | `claudedocs/` | `reference_<主题>.md` | `claudedocs/reference_config_files.md` |
| Sprint 工作流 | `claudedocs/` | `workflow_sprintN_<内容>.md` | `claudedocs/workflow_sprint4_config.md` |
| 已归档文档 | `claudedocs/archive/` | 保留原名 | `claudedocs/archive/research_xxx.md` |
| 铁律规则 | `.claude/rules/` | `kebab-case.md` | `.claude/rules/prohibitions.md` |
| Agent 定义 | `.claude/agents/` | `kebab-case.md` | `.claude/agents/doc-freshness-guard.md` |
| Hook 脚本 | `.claude/hooks/` | `kebab-case.sh` | `.claude/hooks/check-doc-freshness.sh` |

## 生命周期

```
创建 → 活跃维护 → 归档/删除
```

| 阶段 | 触发条件 | 操作 |
|---|---|---|
| **创建** | 调研完成 / Sprint 规划 / ADR 决策 / 新规范 | 写入对应位置，命名遵循上表 |
| **活跃** | 外部事实未变 / Sprint 未完成 / 决策未推翻 | 随代码变更同步更新 |
| **归档** | 调研结论已吸收到 CLAUDE.md / Sprint 已完成 | 调研→`archive/`；Sprint 工作流→**删除**（不归档） |
| **删除** | Sprint 工作流对应的 Sprint 已完成；ADR 被新 ADR 推翻 | `git rm`，commit message 注明原因 |

## 与 Hook 的对齐

文档新鲜度守卫在 `git commit` 时自动运行，分为两层：

### Command 层（机械检查，阻断级）

| 检查项 | 方法 | 失败后果 |
|---|---|---|
| `CLAUDE.md` 中的 `@path` 引用指向不存在文件 | 正则提取 `@path` → `test -f` 逐一验证 | exit 2 阻断 commit |
| `.claude/rules/*.md` 中的 `@path` 引用指向不存在文件 | 同上 | exit 2 阻断 |
| `docs/architecture/architecture-spec.md` 缺失 | `test -f` | exit 2 阻断 |
| `docs/architecture/design-system-mapping.md` 缺失 | `test -f` | exit 2 阻断 |
| `claudedocs/reference_config_files.md` 缺失 | `test -f` | exit 2 阻断 |
| `claudedocs/reference_console_commands.md` 缺失 | `test -f` | exit 2 阻断 |
| `claudedocs/research_verification_tracker.md` 缺失 | `test -f` | exit 2 阻断 |

### Agent 层（语义检查，提醒级）

只检查 `git diff --cached` 中变更的 `.md` 文件：

| 检查项 | 触发器 | 输出 |
|---|---|---|
| Sprint 文件腐坏 | 变更文件含 "sprint"/"workflow" → 读 sprint-roadmap 记忆判断 | `🗑️ DELETE_SUGGESTION` |
| 规则交叉矛盾 | 变更文件在 `.claude/rules/` 下且改了技术决策 → Grep 其他规则文件 | `✏️ FIX_SUGGESTION` 或 `⚠️ REVIEW_NEEDED` |
| 归档文件被引用 | 变更文件引用了 `claudedocs/archive/` 路径 | `✏️ FIX_SUGGESTION` |
| MEMORY.md 不同步 | 变更含 `MEMORY.md` → 对比实际记忆文件列表 | `✏️ FIX_SUGGESTION` |
| 变更文件中的死引用 | Grep 变更文件中的 `@path` → `test -f` 验证 | `✏️ FIX_SUGGESTION` |

## 禁止

- ❌ 调研文档和 Sprint 工作流混放——Sprint 完成必须立即删除工作流文件
- ❌ 归档文件保留在非 archive 目录
- ❌ 在非 `.claude/rules/` 位置创建铁律文件
- ❌ 在 `claudedocs/` 根目录长期保留已完成使命的调研报告
