## 会话要点：Mod 管理 v2.4 重构（504 根因 + 单次 QueryFiles + 移除作者/ID）

### 核心根因：稳定 504 = 系统 HTTP_PROXY 代理拦截
- 系统环境变量 `HTTP_PROXY=http://192.168.2.9:7890` 存在时，后端 node fetch（undici）和 Vite http-proxy 都自动走代理访问 Steam → 代理连 Steam 超时 → 稳定 504
- curl 用 `--noproxy` 直连 Steam 0.7s 通，但 node fetch 走代理 10s+ 超时 → 判定是代理不是网络
- **修复**：后端 `index.ts` 启动时 delete 所有代理 env（HTTP_PROXY/HTTPS_PROXY/ALL_PROXY）+ 设 NO_PROXY='*'；前端 `vite.config.ts` 同样删除。两层都要禁，缺一不可

### 浏览链路重构：两阶段 → 单次 QueryFiles
- 旧：QueryFiles → GetDetails → GetPlayerSummaries 三接口串行，叠加超时（冷启动 20-40s 易 504）
- **新（v2.4）**：`browseMods` 只调一次 `QueryFiles`，返回 title/creator/description/preview_url/vote_data 全字段，**不二次调 GetDetails**
- 评分：`vote_data.score`（0-1）× 5 → `voteScore`（0-5）
- 时间：45s timeout（国内网络访问 Steam 冷启动实测 20-40s）

### 移除作者名查询（GetPlayerSummaries）
- 之前调 GetPlayerSummaries 批量查作者昵称，服务环境批量偶发超时降级（部分 SteamID 查不到）→ 不稳定
- **v2.4 决定不查作者名**，作者字段仅内部持有 SteamID，**列表/详情 UI 不展示作者和 ID**
- 详情弹窗优先用列表已有数据渲染（不卡"加载中"），detail 接口补充评分/大小

### 前端 UI 变更
- ModCard 只显示：标题 + 描述 + 订阅数 + 精确评分星（2.7 分 = 2 满星 + 0.7 部分填充，clip 裁剪）+ 下载/详情按钮
- 详情弹窗：大小/更新时间/评分星/完整介绍 + [在 Steam 中打开][下载][关闭]
- 每页默认 12 条，下拉 12/15/30/48
- 详情按钮 variant=outline（有边框，与背景区分）

### 代码注释 vs 文档
- **代码注释不提 DST**；**文档要提 DST**（调研参考）
- 代码注释中所有 DST 字样已清除；`docs/architecture/mod-management-design.md` 保留 DST 引用

### 开发环境注意
- 后端重启会清 refresh_token（内存 DB）→ 前端刷新掉登录需重新登录（admin/123456）
- 有头模式用 Playwright MCP：browser_navigate + snapshot + evaluate 实测
