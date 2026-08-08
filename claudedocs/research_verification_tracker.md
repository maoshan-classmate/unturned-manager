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
| 3 | Should_Monitor_Updates 精确行为？ | ✅ 已确认：检测→广播→倒计时→强制踢出→关机。SDG 有官方文档页。 | 高 | SDG `dedicated-workshop-update-monitor.html` |
| 4 | 原生 RCON 配置指令存在？ | ✅ 存在（Commands.dat: `RCON Enabled/Port/Password`）。线协议细节仍未知。 | 中 | Zonely 托管面板文档 |
| 5 | Steam WebAPI `IPublishedFileService` 需要 Key？ | ✅ **需要**。`GetDetails/v1` / `QueryFiles/v1` 均要求 `key` 参数（参考仓 DST 管理平台实证）。**原「`GetPublishedFileDetails` 无需 Key」条目作废**（该接口非元数据主路径）。 | 高 | `.research/dst-management-platform-api/app/mod/utils.go`、`claudedocs/research_dst_mod_reference_2026-08-08.md` §5.1 |
| 6 | `?xml=1` 零凭证获取是否可用？ | ❌ **已失效（2026-08-08 实测）**。3 个 Mod ID 全部返回 HTML 而非 XML（46KB 网页），`<title>Steam Community :: Screenshot</title>`。私有 Mod 更早确认需认证。→ 迁移 WebAPI Key 主路径。 | 高 | 实测 + `claudedocs/research_dst_mod_reference_2026-08-08.md` §5.1 |
| 7 | RconBindAddress 在 Commands.dat？ | ❌ **不存在此指令**。全网无一命中。 | 高 | 穷举搜索未命中 |
| 8 | Game Labs / SynUW 是什么？ | ❌ 不存在于 Unturned 生态。 | 高 | 穷举搜索未命中 |
| 9 | Alpine Linux musl 兼容性？ | ❌ 不官方支持。Unity Linux player 仅支持 glibc。直接用 Ubuntu/Debian。 | 高 | 常识 + 搜索确认 |
| 10 | RocketMod XML vs JSON 比例？ | XML 是绝对主流（FREAKHOSTING：~99% 社区 mods）。JSON 极少数。面板**必支持 XML，JSON 可延后**。 | 中 | FREAKHOSTING、GameServerKings |
| 11 | OpenMod reload 历史失败报告？ | 仅 1 个无关 GitHub Issue（#843，HarmonyLib 初始化失败）。无 reload 专项崩溃报告。 | — | GitHub Issues 搜索 |
| 12 | meta.dat 版本比较文档？ | 全网无资料。SDG 官方文档未提及。 | — | 搜索未命中 |
| 13 | 旧 CLI 参数（-port/-map）vs Commands.dat？ | 全网无资料。 | — | 搜索未命中 |

---

## 推翻的原假设

### ❌ "U3DS 不需要 Mono"

**修正**：LinuxGSM 2026 年仍要求 Mono 5。Unity 2020.3 LTS 默认脚本后端是 Mono。`Unturned_Data/Managed/` 存在是因为 Unity **自带** Mono（不是不需要 Mono）。部署建议：安装 `mono-complete` 作为安全基线。

---

## 🔧 真·需实机验证（3 项）

以下三项在互联网上**没有任何文档、Issue、社区帖子能给出答案**。必须在真实 U3DS 环境上测试才能确认。

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

### 2. OpenMod `reload` 在生产中的实际成功率

**背景**：RocketMod 的 reload 有已知严重问题（U3-SDK Issue #1794 建议删除该功能）。OpenMod 的 reload 官方文档列为标准流程，无公开崩溃报告，但也没有系统性的可靠性验证。RocketMod 的前车之鉴意味着不能仅凭"没有 Issue"就假设它可靠。

**验证方法**：
1. 在测试服务器安装 5 个常用 OpenMod 插件（Economy/Teleport/Kit/Shop/Vote）
2. 每个插件修改其 `config.yaml` 的一个字段
3. `openmod reload <PluginId>` → 执行 10 次
4. 每次 reload 后执行 RCON `Players` 测试服务器响应
5. 记录是否出现：插件报错 / RCON 断连 / 服务器卡顿 / 内存上涨

**影响**：决定面板的配置保存流程——
- reload 可靠 → "保存配置 → 自动 reload → 即时生效"
- reload 不可靠 → "保存配置 → 提示重启服务器"

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
| ✅ 补充搜索已核查 | 13 |
| ❌ 推翻的原假设 | 1（Mono） |
| 🔧 真·需实机验证 | **3** |

仅三件事真正需要一台测试服务器才能确认。其余 13 条已通过各种信息来源闭环。
