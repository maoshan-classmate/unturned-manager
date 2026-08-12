# 仓库缺少 ESLint 配置文件

`manager-web` 与 `manager-server` 的 `package.json` 都声明了 `npm run lint`（eslint src/），但仓库根目录和各子目录均无 `eslint.config.js`（ESLint v9 必需）。执行 `npm run lint` 报 "ESLint couldn't find an eslint.config.(js|mjs|cjs) file"。

影响：`development.md` 验证门槛中的「eslint + prettier 零警告」无法通过脚本达成；当前用 `prettier --check` 覆盖格式校验部分。

状态：2026-08-12 发现，未修复（配置缺失是既有现状，非代码改动引入）。
