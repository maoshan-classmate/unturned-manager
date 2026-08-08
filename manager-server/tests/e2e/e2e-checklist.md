# E2E 验证清单（卡 D §5 — playwright）

> 以下 9 条需在真实 U3DS + RCON + A2S 环境下运行（Sprint 5 实机验证）。
> 对应 spec 文件（`d1-d9.spec.ts`）将在 Sprint 5 创建。
> 
> **当前可用**：`api-e2e.spec.ts`——无需 U3DS，10 条 API 冒烟测试。
> ```bash
> cd manager-server && npx playwright test --config=playwright.config.ts tests/e2e/api-e2e.spec.ts
> ```

| # | 验收项 | 预期结果 | 前置条件 |
|---|---|---|---|
| D1 | Dashboard 启动按钮不再卡 STARTING（30s 后报错回滚） | `state_change: STOPPED→STARTING→RUNNING` | U3DS ServerHelper.sh 可用 |
| D2 | Console 输入命令，输出实时出现 | WS `console_line` 事件在页面渲染 | LogStreamer 已接线 + RCON 可通 |
| D3 | WS 重连后订阅不丢 | 断开 2s 后重连，再次收 console_line | WS subscribe 协议已实现 |
| D4 | Config·Commands 读取正确、保存不报错 | GET/PUT 200，`known.Name/Port` 正确 | test-server 有默认 Commands.dat |
| D5 | Config·Txt 读取正确、保存不报错 | GET/PUT 200，`sections.Browser` 有数据 | test-server 有 Config.txt |
| D6 | Mods "应用变更" 真正触发重启流水线 | POST /apply → 202 → 等待 → 服务器重新 RUNNING | 至少 1 个 Workshop Mod 可下载 |
| D7 | Files 上传 .unity3d 不被破坏 | 上传 5MB 文件 → 下载 → SHA256 一致 | multipart 端点可用 |
| D8 | Players 表格非空（数据来自 GET /players） | 返回 `{ players: [...] }` + `fetchedAt` | U3DS 有玩家在线 |
| D9 | Settings 改密码真正写到 DB | 改密码后旧密码失效，新密码可用 | DB 中有 users 行 |

## 冒烟测试脚本（无 U3DS 情况下验证 API）

```bash
# 启动后端（需要 test-servers 目录下的 U3DS 安装）
cd manager-server
node --env-file=.env --import tsx src/index.ts &

# 等 3 秒，跑 curl 冒烟
curl -s -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin"}' | jq .data.accessToken >/dev/null \
  && echo "✅ login" || echo "❌ login"

curl -s http://localhost:3001/api/health | jq .status \
  && echo "✅ health" || echo "❌ health"

# 杀死后端
kill %1
```

## Playwright spec 示例（D1 单条，Sprint 5 创建）

```typescript
// tests/e2e/d1-start.spec.ts（将在 Sprint 5 创建）
import { test, expect } from '@playwright/test';
test('D1: 启动服务器', async ({ page }) => {
  await page.goto('http://localhost:5173/login');
  await page.fill('[name=username]', 'admin');
  await page.fill('[name=password]', 'admin');
  await page.click('button[type=submit]');
  await page.waitForURL('**/dashboard');
  await page.click('text=启动');
  await expect(page.locator('text=运行中')).toBeVisible({ timeout: 35000 });
});
```

> **注意**：本文件是卡 D §5 的交付物。U3DS 实机验证放到 Sprint 5（见 `claudedocs/research_verification_tracker.md` §🔧）。
