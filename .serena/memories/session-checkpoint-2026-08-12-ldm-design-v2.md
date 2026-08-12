---
name: session-checkpoint-2026-08-12-ldm-design-v2
description: LDM 设计文档 v0.2 增量（§11 全功能盘点 + §12 多期接入规划），取代 v0.1 「实施阶段 Phase A-F」+ 「调研回填」结构
metadata:
  type: session
  date: 2026-08-12
---

LDM Mod 框架接入设计 v0.2 增量（2026-08-12，commit `379a296` 撤回后重写）：

- **结构变更**：原 `docs/architecture/ldm-integration-design.md` §11「实施阶段（Phase A-F 按生产质量全量交付）」+ §12「调研回填记录（已完成 8 项）」**替换为**正式架构设计章节：
  - §11「LDM 框架全功能盘点」——35 项能力分 10 个维度（A 配置层 / B 插件生命周期 / C 权限系统 / D 控制台命令 / E 多实例隔离 / F 信息查询 / G 插件来源 / H 日志 / I 主框架安装升级 / J 高级能力），每项标注真源 + 接入决策（✅ 必须做 19 / ⚠️ 加警告 3 / ❌ 拒绝 13）
  - §12「多期接入规划」——Phase 1 MVP (10-12 人天, 4 端点) / Phase 2 完整配置 (+12-15 人天, +6 端点) / Phase 3 生态接入 (+5-7 人天, +2 端点) / Phase 4 高级能力 (+3-5 人天, +2 端点)；合计 12 REST 端点 + 1 WS 事件 + 30-39 人天
- **设计动机**：用户反馈「不要写调研回填记录 / 不要展示历史过程 / 文档是架构设计文档不是功能实现文档 / 要写 LDM 框架一共有多少功能 + 每一期接入什么 + 怎么规划」（v0.1 §11/§12 是按 A/B/C/D/E/F Phase 切分的实施任务清单，偏实现文档风格）
- **依赖关系**：§11 是「总目录」，§12 是「切分路径」；Phase 2 必须等 Phase 1 落地，依此类推；升期门控走 §12.7（typecheck / 单测 ≥ 80% / E2E / 接口契约 / 文档同步 / commit 规范）
- **与现有架构边界**：§11.3 列了与 `mod-management-design.md` v2.5（资源包）的边界——两者共用 `ServerManager.applyChangesCore`（`applyModChanges` 变薄壳 + `LdmApplyService` 薄业务层）；这是 backend-development.md「重复 ≥3 模块共用→新建共享」原则的预留位（当前 2 处共用：mod_apply + ldm_apply；未来 modpack_apply 为第三处）
- **同步修补**：
  - ADR-0006 §7「LDM 文档调研回填（已完成）」保留为历史快照，正文改为指向设计文档 §11.1 + §12（而非原 §12 调研回填），并补充 A1/.dll 版本号读取后续在设计文档 §5.5 定为 `pe-library@^2.0.1` PE 元数据方案
  - 设计文档 §10「完成定义」删去旧的「§12 调研回填已完成」条，改为「§11/§12 新结构已与 ADR-0006 §7 + reference_config_files.md §3-5 同步」
- **关联**：[[session-checkpoint-2026-08-12-ldm-design]]（v0.1 旧结构，A-F 实施阶段）；[[session-checkpoint-2026-08-12-ldm-framework]]（LDM 选型定死）；[[session-checkpoint-2026-08-12-pty-race-gsm-parity]]（无直接关联）
- **Sprint 节奏**：30-39 人天 ≈ 3 个 Sprint；Phase 2 建议拆 2a（XML 解析 + 配置读写）+ 2b（重启流水线 + UI）
