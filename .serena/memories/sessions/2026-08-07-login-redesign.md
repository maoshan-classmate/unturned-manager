# 登录页改造 (2026-08-07)

## 执行摘要
将 LoginPage 从手写 Tailwind CSS (80行) 重写为 shadcn/ui + Motion 专业设计 (180行)。同步完成 Tailwind v3→v4 升级。

## 关键技术决策
1. **动画**: Motion v13，从 `motion/react` 导入 (非顶层 `motion`)
2. **Tailwind**: v4 CSS-first (@theme inline)，移除 tailwind.config.ts
3. **shadcn**: v4，基于 @base-ui/react 原语
4. **表单**: react-hook-form + zod (项目已安装)
5. **Input**: 添加 forwardRef 支持 RHF register()
6. **聚焦**: focus:border-transparent + ring-2 + emerald-500/50 + scale-[1.01]

## 新增文件
- src/components/ui/ (5 个 shadcn 组件: button/card/input/label/alert)
- src/components/shared/PasswordInput.tsx (Input 增强: Eye 切换)
- src/pages/loginSchema.ts (Zod 校验)
- src/lib/utils.ts (cn 工具)
- src/vite-env.d.ts (图片类型声明)
- components.json (shadcn 注册)
- docs/adr/0001-adopt-motion-animation-library.md

## 移除
- tailwind.config.ts

## 注意事项
- motion v13 React API 在 `motion/react` 子路径
- shadcn v4 init 覆盖 index.css，需手动恢复暗色主题
- 后端用 npm run start (不能用 watch 模式，会导致端口冲突)
