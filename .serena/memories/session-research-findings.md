## 已完成
1. 全面调研：Linux 安装、RCON 协议、Steam Workshop、Mod 管理、竞品面板（全在 claudedocs/）
2. 配置文件完整参数表：claudedocs/reference_config_files.md
3. 控制台指令完整参考：claudedocs/reference_console_commands.md (~64 条)
4. 待验证项追踪：claudedocs/research_verification_tracker.md

## 关键发现
- Mono 依赖：LinuxGSM 2026 仍要求 Mono 5（原"不需要 Mono"假设被推翻）
- Devlog #012 HTTP API 不存在于 3.x（仅 Unturned II）
- Config.txt 无 RCON 段（RCON 全部分散在 Commands.dat/Rocket.config.xml/openmod.yaml）
- ~~Steam WebAPI GetPublishedFileDetails 无需 API Key（Rust 库 steam-workshop-api 确认）~~ 已被作废：IPublishedFileService/GetDetails+QueryFiles 需 WebAPI Key（2026-08 实测）
- 不存在 Unturned 专用开源 Web 管理面板（差异化空间明确）
- AMP (CubeCoders) 是唯一内置 Steam Workshop 浏览器的面板（付费商业产品）

## 真·需实机验证（3 项）
1. 旧 CLI 参数是否覆盖 Commands.dat
2. OpenMod reload 生产成功率
3. meta.dat 版本是否被服务端消费