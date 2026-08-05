## 2026-08-05 Figma 全页面整改（续昨日）

### 已完成

#### Dashboard ✅
- 4 StatCard: INSTANCE_SWAP Icon#12:0, 右缘对齐1156
- 快捷操作: 4个Button frame (play/stop-circle/refresh-cw/save)
- 资源柱状图三柱基线对齐 y=260
- 75%环 arcData修复 endingAngle=0 innerRadius=0.65, 文本居中 (x=108,y=150)
- TopBar/Sidebar emoji→bullet

#### Console ✅
- TopBar 64px + 状态行
- 9个ToolbarBtn component实例 (INSTANCE_SWAP Icon#12:1)
- 发送按钮 Button=Primary instance
- Terminal JetBrains Mono, >字符修复
- ConfirmDialog关机/踢出独立图层 (x=1500)

#### Mods ✅
- ModCard复用component (17:16695→删除后重建, 14:16695), 5张实例
- 5星统一12×12 stroke-only, x=72-120对齐
- 按钮: 订阅(绿) 查看详情(outline) 移除(红)
- 搜索框+筛选+分页完整
- 移除ConfirmDialog

#### Players ✅
- PlayerTable component (17:17601): auto-layout, DataRow(17:17520)实例×10
- DataRow: 6列固定x位置(12/180/420/560/720/830), 1092px宽
- 10行唯一mock数据, 状态覆盖(在线/离线)
- 分页右对齐: 显示1-10/18条 每页10条 第1/2页 上一页 下一页
- 3个ConfirmDialog(私信/禁言/踢出) + 私信输入框
- Header#1E293B=行背景, 分隔线#334155

#### Toast ✅
- Toast component set (17:17769): Success/Warning/Error
- Success: √(绿#22C55E)+操作成功, Warning: ▲(琥珀#F59E0B)+操作警告, Error: ⓧ(红#EF4444)+操作失败
- Auto-layout HORIZONTAL, icon左+文字右, 无close
- 360×48, 暗底#141E2E, border#334155, radius8

### 新建可复用组件
| Component | ID | 说明 |
|---|---|---|
| ConfirmDialog | 12:16436 | 400×200, 标题+消息+取消(Secondary)+确认(Danger) |
| ToolbarBtn | 12:16476 | 28px高, INSTANCE_SWAP Icon#12:1 |
| StatCard | 5:34 | 含INSTANCE_SWAP Icon#12:0, label x=48 |
| ModCard | 14:16695 | 360×300, 封面+星星+按钮 |
| DataRow | 17:17520 | 1092×40, 6列TEXT固定x |
| PlayerTable | 17:17601 | VERTICAL auto-layout, Header+10DataRow+Pagination |
| Toast | 17:17769 | Success/Warning/Error 三变体, icon+文字 |

### 待完成
- Config (2:6): 表单重构未完成
- Server Setup (3:117): 多项未处理
- Files (12:16326): 框架已建, 内容待补

### 关键教训
- auto-layout HUG会缩frame宽度导致clipsContent裁剪子元素
- 列frame默认白色fill, 必须visible:false
- 空格+比例字体永远不会对齐→用固定x TEXT或auto-layout列frame
- 新instance默认创建在当前活跃页面, 必须reparent
- INSTANCE_SWAP是替代instance child icon的正确方式
