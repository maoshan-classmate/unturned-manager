# 开发工作流

## 新会话必读顺序

1. `CLAUDE.md`（项目宪法入口）
2. `docs/architecture/architecture-spec.md`（后端模块边界）
3. `docs/architecture/design-system-mapping.md`（前端设计映射）
4. `claudedocs/reference_config_files.md`（配置文件字段权威表）
5. `claudedocs/reference_console_commands.md`（RCON 命令参考）
6. `claudedocs/research_verification_tracker.md`（未验证项清单）

## 提交规范

### Commit Message 格式

```
<操作名>: <简要概括>
```

操作名必须从下表中选用：

| 操作名 | 适用场景 |
|---|---|
| `修复` | bug 修复、错误纠正 |
| `功能实现` | 新功能、新模块、新页面 |
| `功能重构` | 代码重构、结构优化（不改变功能） |
| `架构设计` | 架构决策、ADR、系统设计 |
| `文档规范` | 文档增删改、规范制定 |
| `其他更新` | 依赖更新、配置调整、构建脚本 |

示例：
```
修复: 搜索框占位符文字不显示
功能实现: 用户登录接口 JWT 认证
功能重构: 错误处理从裸 Error 迁移到 AppError 基类
架构设计: 后端正则模块从 7 个合并为 5 个，移除冗余抽象层
文档规范: 新增前端组件抽象铁律
其他更新: ESLint 升级到 v9，同步更新 config
```

### 分支命名

- `feat/<范围>`、`fix/<范围>`、`refactor/<范围>`、`docs/<范围>`、`chore/<范围>`

### 其他

- 每个非平凡的决策写一份 ADR，放在 `docs/adr/NNNN-标题.md`
- 同一个 PR 里更新对应的 Serena 记忆

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
