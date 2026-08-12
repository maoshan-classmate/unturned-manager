# 待验证项追踪清单（第二稿）

> 从全量调研文档中提取所有"待确认/置信度中低/未验证"条目，逐一核查。  
> 第一稿 → 用户要求二次确认是否真需要实机验证 → 补充搜索后重新分类 → 第二稿。  
> 日期：2026-08-03

---

## 已核查项（通过补充搜索确认，无需实机验证）

| # | 原条目 | 核查结果 | 置信度 | 来源 |
|---|---|---|---|---|
| 1 | Devlog #012 JSON HTTP API 存在？ | ❌ 不存在。Unturned II（4.0）专属，已取消。 | 高 | SDG 官方博客 |
| 2 | Config.txt 含 RCON 段？ | ❌ 不含。 | 高 | SDG 官方 Server Configuration 文档 |
| 3 | Should_Monitor_Updates 精确行为？ | ✅ 已确认：检测→广播→倒计时→强制踢出→关机。SDG 有官方文档页。 | 高 | U3-SDK `WorkshopDownloadConfig.cs` 源码 |
| 4 | 原生 RCON 配置指令存在？ | ✅ 存在（Commands.dat: `RCON Enabled/Port/Password`）。线协议细节仍未知。 | 中 | Zonely 托管面板文档 |
| 5 | Steam WebAPI `IPublishedFileService` 需要 Key？ | ✅ **需要**。`GetDetails/v1` / `QueryFiles/v1` 均要求 `key` 参数（参考仓 DST 管理平台实证）。**原「`GetPublishedFileDetails` 无需 Key」条目作废**（该接口非元数据主路径）。 | 高 | `.research/dst-management-platform-api/app/mod/utils.go`、`claudedocs/research_dst_mod_reference_2026-08-08.md` §5.1 |
| 6 | `?xml=1` 零凭证获取是否可用？ | ❌ **已失效（2026-08-08 实测）**。3 个 Mod ID 全部返回 HTML 而非 XML（46KB 网页），`<title>Steam Community :: Screenshot</title>`。私有 Mod 更早确认需认证。→ 迁移 WebAPI Key 主路径。 | 高 | 实测 + `claudedocs/research_dst_mod_reference_2026-08-08.md` §5.1 |
| 7 | RconBindAddress 在 Commands.dat？ | ❌ **不存在此指令**。全网无一命中。 | 高 | 穷举搜索未命中 |
| 8 | Game Labs / SynUW 是什么？ | ❌ 不存在于 Unturned 生态。 | 高 | 穷举搜索未命中 |
| 9 | Alpine Linux musl 兼容性？ | ❌ 不官方支持。Unity Linux player 仅支持 glibc。直接用 Ubuntu/Debian。 | 高 | 常识 + 搜索确认 |
| 10 | LDM（RocketMod 官方分叉）插件配置 XML vs JSON 比例？ | XML 是绝对主流（FREAKHOSTING：~99% 社区 mods）。JSON 极少数。面板**必支持 XML，JSON 可延后**（2026-08-12 LDM 选型后不变——LDM 继承 RocketMod 的 `Configuration.xml` 约定，真源 `Rocket.Core/Environment.cs`）。 | 中 | FREAKHOSTING、GameServerKings、LDM 源码 |
| 11 | ~~OpenMod reload 历史失败报告？~~ | **已作废（2026-08-12）**——OpenMod 已删（commit `c5f2ac8`），LDM 定死。LDM 全局 reload 官方已删（U3-SDK Issue #1794 + `command_rocket_reload_disabled`），单插件 reload 不保证成功，改配置必须重启。 | — | GitHub Issues 搜索 + LDM 选型决策 |
| 12 | meta.dat 版本比较文档？ | 全网无资料。SDG 官方文档未提及。 | — | 搜索未命中 |
| 13 | 旧 CLI 参数（-port/-map）vs Commands.dat？ | 全网无资料。 | — | 搜索未命中 |

---

## 推翻的原假设

### ❌ "U3DS 不需要 Mono"

**修正**：LinuxGSM 2026 年仍要求 Mono 5。Unity 2020.3 LTS 默认脚本后端是 Mono。`Unturned_Data/Managed/` 存在是因为 Unity **自带** Mono（不是不需要 Mono）。部署建议：安装 `mono-complete` 作为安全基线。

---

## 🔧 真·需实机验证（2 项）

以下两项在互联网上**没有任何文档、Issue、社区帖子能给出答案**。必须在真实 U3DS 环境上测试才能确认。

### 1. 旧 CLI 参数（-port/-map/-pvp）是否仍覆盖 Commands.dat？

**背景**：旧教程大量引用 `-port` `-map` `-pvp` `-password` 等 CLI 参数。当前 SDG 官方文档完全消失，所有配置要求写 Commands.dat。但不知道旧参数是否仍然生效，如果同时存在时谁优先。

**验证方法**：
```bash
# 在 Commands.dat 中设置 Port 27015
# 同时在 ServerHelper.sh 启动参数中加 -port 27016
./ServerHelper.sh +InternetServer/Test -port 27016 -ThreadedConsole
# 查看实际监听端口 → 即知优先级
```

**影响**：如果 CLI 可覆盖，面板需要在两种入口都提供一致设置。

---

### ~~2. OpenMod `reload` 在生产中的实际成功率~~（已作废 2026-08-12）

**作废原因**：OpenMod 已删除（commit `c5f2ac8`），LDM 定死。LDM 的 reload 语义已由源码 + U3-SDK Issue #1794 确定：**全局 `/rocket reload` 官方已删**（`command_rocket_reload_disabled`="Please reload individual plugins instead"），**单插件 `/rocket reload <name>` 不保证成功**，改配置生效必须走重启流水线（ADR-0004 §重启流水线：Save + Shutdown 10 + forceKill + spawn）。面板策略已钉死「改配置 = 重启」——无需再实机验证 reload 成功率。

---

### 3. meta.dat 的版本比较是否被服务端运行时消费

**背景**：57 Studios Wiki 说 "some server admin tools read it"，但游戏自身是否在连接时比对客户端/服务端 mod 版本号未知。如果服务端不比对，面板展示的版本号是纯信息作用；如果比对，错误版本会导致客户端被拒。

**验证方法**：
1. 在服务器上安装一个 Workshop Mod（记下其 meta.dat 中的 Version 字段）
2. 修改 meta.dat 的 Version 为 `999.999.999`
3. 重启服务器
4. 让一个客户端（保持正确版本）尝试连接
5. 观察是否被拒、服务端日志是否有版本不匹配警告

**影响**：决定"面板需要比对客户端版本"还是"只做信息展示"。

---

## 总结

| 类别 | 数量 |
|---|---|
| ✅ 补充搜索已核查 | 13（#11 已作废，有效 12 条） |
| ❌ 推翻的原假设 | 1（Mono） |
| 🔧 真·需实机验证 | **2**（第 2 项 OpenMod reload 2026-08-12 已作废） |

仅两件事真正需要一台测试服务器才能确认。其余已通过各种信息来源闭环。
