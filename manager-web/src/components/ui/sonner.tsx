import { Toaster as Sonner } from 'sonner';

/**
 * 暗色主题适配版 Toaster——shadcn/ui 标准包装，挂载一次全局可用。
 *
 * 使用：
 * ```tsx
 * // App.tsx 根组件挂一次
 * <Toaster />
 *
 * // 任意组件内
 * import { toast } from 'sonner';
 * toast.success('Hawaii 下载成功');
 * ```
 *
 * 样式对齐 component-abstraction.md 色值：
 * - 背景 #1E293B（卡片）
 * - 边框 #334059
 * - 主文本 #F1F5FB
 */
export function Toaster() {
  return (
    <Sonner
      theme="dark"
      position="top-center"
      toastOptions={{
        style: {
          background: '#1E293B',
          border: '1px solid #334059',
          color: '#F1F5FB',
        },
      }}
    />
  );
}
