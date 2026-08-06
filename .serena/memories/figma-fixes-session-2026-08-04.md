## 2026-08-04 Figma 全页面整改会话

### 已完成页面

#### Dashboard (2:2)
- 4 个 StatCard → emoji 移除 + INSTANCE_SWAP Icon#12:0 (users/clock/map/package)
- 快捷操作区 → 4 个 Button frame (play/stop-circle/refresh-cw/save)，绿/红/outline/绿色系
- ConfirmDialog component (12:16436) 位于 Components 页 x=300,y=640
- 资源柱状图三柱基线对齐 y=260
- 75% 环 arcData 修复 (endingAngle=0, innerRadius=0.65)，文本居中 (x=108,y=150)
- StatCard 行右缘对齐至 1156 (匹配下方 Card 右缘)
- 最近事件 mock 数据 8 条，• bullet 替代 emoji
- TopBar emoji ●→•，Sidebar "MyServer ● 在线"→"MyServer · 在线"

#### Console (2:3)
- TopBar h=44→64px，新增服务器状态行 (● 已连接 OpenMod :25545 2ms PEI·Normal 运行时间:3h 42m)
- 9 个工具栏按钮 → 全部替换为 ToolbarBtn component (12:16476) instances，INSTANCE_SWAP Icon#12:1
- 发送按钮 → Button=Primary (5:48) instance，text="发送"，w=90
- InputBar chevron stroke 修复 (#94A3B8)
- 终端 textAutoResize=HEIGHT, lineHeight=20px, w=1084, JetBrains Mono，`&gt;`→`>`
- 关机按钮 Danger 红底 + power icon 白线
- Active indicator y=120 对齐 nav
- ToolbarBtn 字体 12→13
- 关机/踢出 ConfirmDialog 实例在 Console v2 右侧独立图层 (x=1500)

#### Mods (2:4)
- 新增 TopBar 64px，"模组管理"标题 + Button=Primary "订阅模组"
- 筛选栏→"按名称 按ID 类型:全部 排序:评分"，位于卡片上方 (y=80)
- 3 张 ModCard 星星统一：12×12 stroke-only，4 琥珀+1 灰，x=78-126/78-126/148-196
- 卡片底部 "[查看详情][×移除]"→"已启用 查看详情 移除"，user-check icon 已删除
- 分页→"显示 1-10 条，共 18 条结果 每页 10 条 第 1/2 页 上一页 下一页"
- Active indicator y=238 对齐"模组" nav
- 移除确认 ConfirmDialog 在右侧 (x=1500)
- Sidebar emoji ●→·

### 新建可复用组件 (Components 页 5:2)
- ConfirmDialog (12:16436): 400×200, 标题+消息+取消(Secondary,outline)+确认(Danger,红)
- ToolbarBtn (12:16476): 28×80, INSTANCE_SWAP Icon#12:1, Preferred: users/save/megaphone/user-x/sun/moon/package/power
- StatCard (5:34): 新增 INSTANCE_SWAP Icon#12:0, label x=24→48 右移

### Sidebar 组件 (5:29)
- 新增 "文件" nav (y=280) + icon/folder (8:4328)
- 权限/服务器设置/系统设置 Divider/管理员 全部下移 40px
- 新增 🎨 Files 页面 (12:16326)

### 待完成
- Players (2:5): 10 项问题已列出，未修
- Config (2:6): 深度表单重构未完成
- Server Setup (3:117): 4 项 Warning 未处理

### 关键教训
- Lucide icon 必须 set_fills visible:false + set_strokes 设色
- Instance 层的 strokeWeight 会产生白边框，必须清空
- Component instance child text 可用 Ixxx;yyy 格式 set_text 覆盖
- 新创建的 instance 默认放在当前活跃页面，必须 reparent
- design_diff 可作为修改前基线存档
