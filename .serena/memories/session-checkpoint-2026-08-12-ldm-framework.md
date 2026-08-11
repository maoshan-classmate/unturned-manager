# Session Checkpoint 2026-08-12 — Mod 框架定死 LDM + 全栈收敛 + U3-SDK 查阅放宽

2026-08-12 会话完成「Mod 框架选型定死 LDM + 代码/文档全栈收敛 + U3-SDK 查阅规则放宽」。从 404 链接修复起，用户连拍 4 个板最终收敛为「只有 LDM」。

## 触发链（用户逐级决策）

1. `docs/external-resources.md` §1.4 的 `SmartlyDressedGames/Rocket` 链接 404 → 用户：直接标注已过期
2. 用户要求比较 LDM 与 OpenMod → 我调研后倾向 OpenMod（活跃开发）→ **用户以「官方维护优先」否决，改推 LDM**
3. 用户拍板 1：**改用 LDM 主推**（unturned-sop/CLAUDE.md 目录标注 LDM 推荐、OpenMod 可选）
4. 用户拍板 2：**U3-SDK 放宽为可查任意类**（prohibitions.md 原写死「仅 WorkshopDownloadConfig.cs 可查」）
5. 用户拍板 3：**代码一并删除（彻底）**（契约 4 接口 + ConfigService 实现 + js-yaml/fast-xml-parser 依赖 + 单测）
6. 用户拍板 4：**「定死用 LDM，不需要说 RocketMod OpenMod 兼容，只有 LDM」** → 文档里不再出现 OpenMod/RocketMod 兼容表述

## 关键事实：LDM 确实是官方维护

- 仓库 `SmartlyDressedGames/Legally-Distinct-Missile`（SDG 组织下）
- 官方描述 "Fork of Rocket for Unturned maintained by the game developers"
- 原 RocketMod 团队 2019-12 停维并 MIT 开源，SDG 接手分叉、2020-06 更名 LDM，随游戏同步兼容性维护
- **项目定位**：LDM = 官方维护、唯一采用的 Mod 框架；插件配置走 `Rocket/` 目录（`Rocket.config.xml` + `Plugins/<Name>/Configuration.xml`）

## 代码层删除（commit `c5f2ac8`）

| 文件 | 改动 |
|---|---|
| `shared/contracts/config.ts` | 删 4 接口：readOpenModConfig / writeOpenModConfig / readRocketModConfig / writeRocketModConfig |
| `manager-server/src/modules/config/ConfigService.ts` | 删 OpenMod YAML 段 + RocketMod XML 段（约 70 行）+ 对应 import |
| `manager-server/src/modules/files/FilesService.ts` | 路径白名单 `openmod/` → 移除（保留 `Rocket/`——LDM 用） |
| `manager-server/package.json` + `package-lock.json` | 删 `js-yaml` / `fast-xml-parser` / `@types/js-yaml` |
| `manager-server/tests/configService.test.ts` | 删 OpenMod/RocketMod 用例 |
| `manager-server/tests/serverManager.test.ts` | 删 4 个 mock |
| `manager-server/tests/utilities.test.ts` | 脱敏用例文件名 `openmod.yaml` → `config.txt`（根目录，原 `openmod.yaml` 是根文件非 openmod/ 目录） |

**依赖残留确认**：`js-yaml` 剩 5 处为 eslint/cosmiconfig 的传递依赖（应保留），manager-server 直接依赖已清干净。

**验证**：前后端 typecheck 0 错误、后端单测 197/197、前端单测 33/33 全绿。

## 文档层收敛（commit `68730b9`）

| 文件 | 改动 |
|---|---|
| `CLAUDE.md` | 术语表加 `LDM` 定义；U3-SDK 改「可查阅任意类（真源行号引用依据）」；技术栈移除 fast-xml-parser/js-yaml |
| `.claude/rules/prohibitions.md` | U3-SDK「唯一可查」→「可查任意类（如 Provider.cs / CommandLoadout.cs）但绝不能导入/编译/复制」；rocket reload 行改「LDM 插件 reload 无热重载支持」 |
| `.claude/rules/unturned-sop.md` | 目录布局 Rocket/ 改「LDM（官方 Mod 框架）」、删 openmod/ 目录行 |
| `docs/architecture/architecture-spec.md` | 技术栈「配置解析」行、ConfigService 职责、ConfigPage Tab、方法清单、YAML/XML 输入校验行 全部移除 OpenMod/RocketMod |
| `docs/external-resources.md` | §1.4 只剩 LDM 一行；§2.4 配置解析节删除（编号 2.5/2.6 顺延）；U3-SDK 行放宽 |
| `claudedocs/reference_config_files.md` | 标题去「完整」；头部加「字段细节自行溯源」指引 |

## 顺带完成：字段细节自行溯源指引（reference_config_files.md 头部）

用户要求「在文档中标注设计到具体的内容自行再到 U3-SDK 源码中查找」→ 头部加指引：
「本文档只收录面板已实现字段的权威表，**不穷举所有配置项**。凡设计到具体字段名/枚举值/取值范围/解析/写入逻辑，直接到 U3-SDK 源码（`.research/U3-SDK/Assets/Runtime/Assembly-CSharp/Unturned/`）中查找对应类」。

同时用户拍板：reference_config_files.md 删掉的 §2.3–§7（238 行：Items/Gameplay/WorkshopDownloadConfig 全字段表/RocketMod/OpenMod/名单文件/优先级）**保持删除**——字段细节随用随从 U3-SDK 提取，避免维护过时清单。archive 无备份（有意收敛，非误删）。

## 未做

- git 提交后的后续会话记忆（本文件即本次存档）
- Linux 实机 UAT（宪法要求 Sprint 5 实机验证）
- 若未来需恢复 OpenMod/RocketMod 配置读写：契约、ConfigService、依赖、单测都需按本 checkpoint 反向重建（已删干净）

## 测试覆盖现状

- 后端 197/197 单测（删了 2 个 OpenMod/RocketMod 用例后仍全绿）
- 前端 typecheck 0 错误 + 单测 33/33
- 前后端 typecheck 均零错误
