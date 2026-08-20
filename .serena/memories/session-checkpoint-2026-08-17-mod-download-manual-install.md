# Session Checkpoint 2026-08-17 — Mod 下载失败排查 + 手动安装闭环

## 根因确诊
服务器到 Steam 内容 CDN `steamcontent.com` 被 GFW 阻断（curl HTTP 000 / TLS connection reset）。其他 Steam 域名通：`api.steampowered.com`（404）、`steamcdn-a.akamaihd.net`（200）、`cdn.steamusercontent.com`（404）。SteamCMD 下载 UGC 内容走 steamcontent.com → `BytesDownloaded: 0` 全失败；查询走 api 域名（通）→ 列表正常。8月16 能下 5 个 mod、8月17 全挂 = CDN 节点分配/网络变化。

## 手动安装闭环（实机验证通过）
手动放文件到 `Servers/<ID>/Workshop/Steam/content/304930/<fileId>/` → 面板自动扫描识别 + 自动登记 acf（manifest 从 staging acf 抄，否则 WebAPI size/timeupdated）→ 勾选启用 → 重启 → U3DS 加载 → 客户端服务器信息可见。

**manifest 非 U3DS 加载必需**：`DedicatedUGC.GetItemInstallInfo` 只读 path/size；manifest 仅用于自动更新检测（NeedsUpdate）。无 manifest 的纯手动 mod 也能被 U3DS 识别，但不能自动更新（作者更新后需手动替换文件）。

## SteamCMD 事实
新版（1785799152）不支持 `workshop_item_info` 查询命令（Command not found）。下载失败（CDN 不通）时 SteamCMD 会把 manifest 写进 staging acf 的 `WorkshopItemDetails`（3560661136 实证）。

## 5 commit
- e2cb591 功能实现: Steam 工坊 Mod 元数据查询默认返回中文版本（X-I18n-Lang + language=6）
- b567b2b 修复: 下载失败透传 SteamCMD 真实错误并清理下载残留
- a00a9bf 功能实现: 模组页添加下载失败手动安装指引
- 83e2ff6 功能实现: 手动放置的 Mod 自动识别并登记到已下载列表
- f53f264 功能实现: 手动放置的 Mod 加标记并提示无自动更新

## 架构变更
- `IWorkshopAcfService` 加 `scanContentDir`（扫 content 目录）+ `readStagingDetail`（读 staging acf WorkshopItemDetails 含 manifest）
- `routes/mods.ts` GET /downloaded 三源合并（content ∪ 主acf ∪ staging acf）+ 未登记 mod 自动补 acf（staging 优先 → WebAPI）
- `ProcessSupervisor` 加 `onStderr`（SteamCMD ERROR! 行走 stderr，原来永远兜底文案）
- 前端：`utils/lang.ts`（reqLangToSteam）；ModsPage 手动安装 TIPS；ConfigPage Workshop 列表「手动」徽标

## 遗留
- 服务器自动下载仍受 steamcontent.com 阻断——手动安装已兜底；彻底解决需网络层（Clash TUN / 换线路 / hosts 子域 IP）
- 后端测试历史 backlog 4 个（steamCmdManager 时序 3 + gateway pty 1），与本次改动无关
