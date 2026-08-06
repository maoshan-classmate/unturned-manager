## Files 页面 + System Settings 页面 Figma 设计 (2026-08-05)

### Files 页面 (🎨 Files, 12:16326) — GSM3 风格改造

#### 页面结构
- **TopBar**: icon/folder (蓝色) + "文件管理器" h2 24px
- **Toolbar**: [↻刷新] + [🔍搜索文件名... 递归] + [+ 新建](绿) + [上传](outline) + [🗑删除](红)
- **Path Bar**: 面包屑 "/ opt / unturned / Servers / MyServer" (只读，不可搜索)
- **File Grid**: 5×2 网格，每格 208×120
  - Row1: 文件夹 (Config/Mods/Logs/Maps/Plugins) — 蓝色 icon/folder
  - Row2: 文件 — icon/file-text(深蓝) / icon/code(靛) / icon/archive(橙)
- **Status Bar**: "10 个项目"
- **右键菜单** (x=1460): 打开/重命名/复制/剪切/删除(红)/权限管理(绿)/下载/复制路径
- **PermissionsDialog** (x=1660): 权限矩阵 读取|写入|执行 (☑绿勾=checked, ☐灰=unchecked), 递归开关, 取消/保存
- **FileCard 组件** (21:19780): auto-layout VERTICAL CENTER, 4属性(Name/Size/Date TEXT + Icon INSTANCE_SWAP)

#### 关键决策
- 无目录树(侧边栏), 用面包屑导航 (1:1 复刻 GSM3)
- 无驱动选择器/前进后退 (Unturned 单一服务器目录)
- 路径栏纯展示, 搜索框专搜文件名 (递归子文件夹)
- 右键菜单无分隔线
- PermissionsDialog 无所有者/组输入框, 无八进制显示

#### 图标颜色体系 (GSM3)
- 文件夹: #3B82F6 (蓝) | 文本: #2563EB (深蓝) | 代码: #6366F1 (靛) | 压缩包: #F97316 (橙)

### System Settings 页面 (🎨 System Settings, 23:19917) — 新建

#### 页面结构 (5 Cards)
| Card | 内容 | 组件复用 |
|------|------|---------|
| 账户安全 | 当前密码/新密码/确认 Input + 保存 | Input×3 |
| 安全配置 | JWT过期 Select + 会话超时 Select + 保存 | Select×2 |
| 网页设置 | 低功耗 Switch + 资源监控 Switch | Switch/ON×2 |
| 面板日志 | 日志流预览区域 | Rectangle |
| 终端默认用户 | Select + 保存 | Select×1 |

#### 基于 GSM3 调研的裁剪
- ✅ 保留: 账户安全、安全配置、网页设置、面板日志
- ❌ 移除: 主题切换(仅暗色)、壁纸、赞助者、SteamCMD设置(已在Server Setup)
- 🟡 简化: 终端默认用户(单Select)
- 🟡 移出: SteamCMD/U3DS路径 → Server Setup 页面加✏️编辑图标

#### Server Setup 路径编辑
- SteamCMD Card: "路径: /opt/steamcmd" + icon/pencil (14×14)
- U3DS Card: "路径: /opt/unturned 模组: 12" + icon/pencil

**Why:** Files 页面按 GSM3 1:1 复刻, System Settings 基于调研裁剪精简
**How to apply:** 所有新组件和页面结构供后续前端实现参考
