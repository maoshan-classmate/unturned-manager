用户明确要求：SteamCMD 和 U3DS 都不应该自动安装，可以引导用户安装，但不能自作主张。

落实方式：后端提供 `/steamcmd/install-u3ds` 等端点供前端引导按钮调用；`ServerManager.spawnU3DS` 启动脚本缺失时只抛 `start-script-not-found`，**不**自动触发安装。实机测试时必须先手动装 U3DS 再点启动。