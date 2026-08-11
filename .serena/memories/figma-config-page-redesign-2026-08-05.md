## Config 页面 Figma 重构完成 (2026-08-05)

5 个 Tab 全部设计完成，每个 Tab 独立一个 Config v2 克隆帧，不重叠排列在页面上。

### Tab 内容总结

| Tab | 内容 | 控件类型 |
|-----|------|----------|
| Commands.dat | 13行×6区域双列表单 + 保存/重置按钮 | Input, Select, Switch |
| Config.txt | 4区域(浏览器/服务器/物品/玩法开关) Key-Value表单 + 按钮 | Input, Select, Switch |
| Workshop | 10条下载管理 + 筛选 + 分页 + 启用禁用/移除 | Input, Select, Checkbox, Button矩形, 状态Badge |
| OpenMod | 框架RCON(openmod.yaml) + 3插件列表 + 配置按钮 + 分页 | Switch, Input, Button矩形 |
| RocketMod | 框架RCON(Rocket.config.xml) + 2插件列表 + 配置按钮 + 分页 | Switch, Input, Button矩形 |
| ConfigDialog | 可复用组件，YAML结构化配置弹窗 | Input, Switch, 取消/保存按钮 |

### 设计规范
- **颜色**: Sidebar #020617, Content #0F172A, Card #1E293B, 强调 #22C55E
- **文字**: primary #F1F5F9, secondary #94A3B8 (标签/表头), muted #64748B (Section标题), 值 #CBD5E1
- **排版**: 标题 15px SemiBold, Section头 15px SemiBold, 标签 13px Regular, 值 14px Regular, 表头 12px
- **间距**: 行高 48px, Section头到下个Section 12px gap, 操作按钮间距 8px(同类) 16px(不同类)
- **卡片**: bg #0F172A, border #334059 1px, radius 8

### 组件体系 (🧩 Components 页面)
- 暗色组件: Input(带TEXT属性), Select(带TEXT属性), Switch/ON, Switch/OFF, Checkbox(带Label属性)
- Button variants: Primary(#22C55E), Secondary(outline), Danger(#EF4444), Ghost
- ConfigDialog(带Title属性)

### 业务关系
- Workshop 管"装不装": 下载/更新/启用/禁用/移除，状态: 已启用/未启用/下载中
- OpenMod/RocketMod 管"怎么用": 框架RCON + 每个插件的YAML/XML业务配置
- Workshop "配置"按钮已删除，统一入口在 OpenMod/RocketMod Tab
- Commands.dat 中的远程控制台开关：⛔ 原标注「实验性，面板通过 OpenMod 远程控制台通信」已失效——ADR-0004 Phase 6 后面板不再走该通道，命令统一经持久终端；该开关仅作为服务端自身配置项展示
- 一个服务器只能装 OpenMod 或 RocketMod 之一，两个Tab同时存在供用户选择

### 关键设计决策
- 框架配置(openmod.yaml/Rocket.config.xml) + 插件列表表格 + 配置弹窗
- 插件列表扫描为后台操作，不在UI展示
- 配置弹窗为YAML/XML解析后的结构化表单，动态渲染控件
- ConfigDialog已转为可复用COMPONENT，2个实例分别放在OpenMod和RocketMod旁边
