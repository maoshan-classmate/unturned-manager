Linux UAT bug 修复闭环（2026-08-10），含上一轮 5 commit + 本轮新增。

修复清单（最终状态）：
- BUG-1/9：SteamCMD `STEAMCMD_DIR` 是目录被直接 spawn 报 EACCES → `resolveExecutable` 从目录解析 `steamcmd.sh`/`linux32/steamcmd`，所有 execFile/spawn 走解析后的可执行路径；版本正则 `/i`（真实输出小写 `version`）
- BUG-2：`install-u3ds` 异步化（202 + jobId + WS 进度）；前端 toast 带 id 替换 loading（接口报错不再残留 spawned 进度）
- BUG-3/7：`waitForExit` 返回退出码（steamcmd 失败报真实错误，不再误报"装完但没脚本"）；`spawnU3DS` 未装时 409 引导安装；统一传 `+InternetServer/<id>`（对齐 GSM3 docs）
- BUG-4：docker-compose 改宿主 bind mount（./data ./opt/unturned ./steamcmd），entrypoint 从镜像 `/opt/steamcmd-bootstrap` 初始化 SteamCMD 空目录
- BUG-5/6：Mod 下载异步化（202 + jobId + WS）；`/mods/downloaded` 合并主 acf + staging acf
- BUG-10：Dockerfile 换清华 apt/npm 镜像源 + mono-complete
- 补丁：`PATCH /steamcmd/install-path` 补通（前端路径编辑 dialog 原 404）

BUG-8（计划任务）用户暂缓未修。

验证：typecheck 0 错，单测 112/112，前端 build ✓。
