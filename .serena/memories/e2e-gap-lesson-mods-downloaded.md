教训：e2e 断言过弱导致 BUG-5/6 缺口未被发现——`GET /mods/downloaded` 只断言"是数组"，空数组也通过。

根因：acf 有主目录（`Workshop/steamapps/workshop/`）和 staging 目录（`Workshop/staging/steamapps/workshop/`）两个来源，下载到 staging 的内容主 acf 扫不到。且 `test-server.ts` 挂载 `createModsRouter` 时漏传 `configService` 导致 e2e 后端跑的不是新代码。

修复：`WorkshopAcfService.listStagingItems` + `/mods/downloaded` 合并双源 + Steam WebAPI 不可达容错（降级返回不含 503）。新增回归用例：单测「staging mod 可见 + applied=false」+ e2e「staging 可见性」。