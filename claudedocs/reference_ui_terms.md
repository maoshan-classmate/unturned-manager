# 界面术语对照表（活参考）

> 行内术语（代码、文档、JSDoc 用）与界面用语（用户可见文案）的权威映射。
> 权威约束在 `.claude/rules/frontend-development.md` §界面文案规范；本表只维护「哪行内部术语 → 界面该怎么说」。

## 术语对照表（可增长）

| 内部术语（代码、文档、JSDoc 用） | 界面用语 |
|---|---|
| U3DS（Unturned Dedicated Server） | Unturned 服务端 |
| ServerID | 实例标识（表单字段）或 实例（叙述语境） |
| SteamCMD | 保留原文（官方工具名，用户装它时会在 SteamCMD 官方文档里看到同样的写法） |
| 创意工坊 / Workshop | 创意工坊（Steam「创意工坊」是其官方中文译名，保留） |
| PTY / 持久终端 / 持久 PTY / 终端 | **统一改为「控制台」**（侧栏导航与页面标题已用；新规则生效后包括错误消息、placeholder、toast 全部统一）。玩家不会知道 pty(7) 是什么，「控制台」是 PC 游戏圈对「服务端后台」的共识说法 |
| AppID / Application ID / Steam 应用 ID | 保留原文——「AppID」是 Steam 玩家用户识别 SteamDB、查询工坊内容归属的通用词，玩家圈层高识别度；改中文反而误读 |
| SteamID64 | Steam ID（去掉 64，玩家不知道 64 是什么；Steam 官方文档也只称 "Steam ID"） |
| WebSocket | 控制台（连接状态/错误文案）——已与 PTY 行统一 |
| Mono | 依赖库（在错误消息里说"运行时环境缺少必要的依赖库"——Linux 部署术语，普通玩家不会知道 Mono 是 Mono 运行时兼容层） |
| cron / Crontab | 执行时间（cron 表达式本身保留，括号里的英文标签去掉） |
| AES-GCM / JWT / Argon2id / 密码学算法 | **不在 SettingsPage 安全卡片显示**（玩家不需要知道算法名称）。卡片只保留「登录有效期」等玩家真正关心的字段 |
| ServerState 枚举（STOPPED/STARTING/RUNNING/STOPPING） | 已停止 / 启动中 / 运行中 / 停止中（后端拼中文，用 `formatServerState`） |
| OperationType 枚举（manual_start/.../mod_apply） | 启动 / 停止 / 重启 / 应用 Mod 变更（后端拼中文，用 `formatOperationType`） |
| Login Token（Config.txt 浏览器列表字段） | Steam 浏览器登录令牌 |
| Loadout | 开局物品 |
| Mode（Commands.dat 难度枚举 Easy/Normal/Hard） | 难度（简单 / 普通 / 困难）——界面用「难度」；未配置时显示「官方默认（普通）」 |
| per-mode 字段值 / 单 section 格式 / `[Items]/[Gameplay]` 段 | 物品与玩法设置（用户不感知配置文件的节结构——只说明「此页面的设置会应用到当前难度」） |
| SkillsetID 0（none） | 无技能 |
| SkillsetID 1（fire） | 消防员 |
| SkillsetID 2（police） | 警察 |
| SkillsetID 3（army） | 军人 |
| SkillsetID 4（farm） | 农民 |
| SkillsetID 5（fishing） | 渔夫 |
| SkillsetID 6（camp） | 露营者 |
| SkillsetID 7（worker） | 工匠 |
| SkillsetID 8（chef） | 厨师 |
| SkillsetID 9（thief） | 盗贼 |
| SkillsetID 10（doctor） | 医生 |
| SkillsetID 255（All Skillsets，对所有技能组生效的基础层） | 所有技能组 |
| item_list / ItemRecord / 物品清单 | 物品清单 |
| builtin（内置种子物品） | 内置（物品清单行徽章；只读不可改） |
| custom（用户自定义物品） | 自定义（物品清单行徽章；可编辑删除） |
| 未知物品（ID 不在清单内） | 未知物品（物品标签名称反查未命中时显示） |
| label（item_list 中文显示名） | 显示名称（可选，中文）——仅前端 UI 显示，不写入 Commands.dat |
| LDM（Legally-Distinct-Missile） | Mod 框架（**保留 LDM 是品牌名，玩家圈层高识别度**—— Steam Workshop 上查询/外链到 GitHub Releases 时直接用 LDM；面板"应用配置"按钮旁的「关于 LDM」徽章可保留；其他界面文案统一「Mod 框架」） |
| Rocket（LDM 子目录名） | Mod 框架配置（内部术语；用户可见文案中**不出现**——只说「Mod 框架」） |
| Rocket.config.xml / Permissions.config.xml | Mod 框架配置 / 权限组配置（**文件名保留原文**——用户去 GitHub 查问题时搜的就是这个名） |
| LDM 插件（.dll） | 插件（叙述语境）或 Mod 框架插件（表单字段/筛选 chip） |
| `Modules/Rocket.Unturned/` | Mod 框架模块（叙述语境；玩家升级 U3DS 时随包附带） |
| `Plugins/<Name>.dll` | 插件文件（玩家从 GitHub 下载后上传到这里） |
| `/rocket` / `/p` 命令 | 在控制台输入（界面文案提及命令时**保留原文**——玩家去社区问问题搜的就是这个字符串） |

## 维护规则

- **新增内部术语时，必须在本表同步加对照**——这条不是建议，是强制（来源：`.claude/rules/frontend-development.md` §界面文案规范）。
- 一行一个内部术语，列为「内部术语 → 界面用语」两列；界面用语不止一个说法时（如 ServerID 分表单字段/叙述语境），写在同一格用「或」连接。
- 改完本表，按 `frontend-development.md` §界面文案规范「自查方式」全局搜索确认改动未落到用户可见位置的遗漏。
