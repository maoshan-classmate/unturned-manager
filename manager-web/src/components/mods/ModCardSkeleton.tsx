/**
 * ModCard 骨架屏——loading 时替代 ModCard 展示（问题 8：只 loading 列表不 loading 整页）。
 * 与 ModCard 等高，animate-pulse 脉冲动画。
 *
 * @example
 * ```tsx
 * {Array.from({ length: 6 }).map((_, i) => <ModCardSkeleton key={i} />)}
 * ```
 */
export function ModCardSkeleton() {
  return (
    <div className="rounded-lg overflow-hidden border border-slate-700 bg-slate-800">
      {/* 封面占位 */}
      <div className="h-[140px] bg-slate-700 animate-pulse" />
      <div className="p-4 pt-3 space-y-2">
        {/* 标题占位 */}
        <div className="h-4 w-3/4 bg-slate-700 rounded animate-pulse" />
        {/* 作者/订阅/ID 占位 */}
        <div className="flex gap-3">
          <div className="h-3 w-16 bg-slate-700 rounded animate-pulse" />
          <div className="h-3 w-12 bg-slate-700 rounded animate-pulse" />
          <div className="h-3 w-14 bg-slate-700 rounded animate-pulse" />
        </div>
        {/* 描述占位 */}
        <div className="h-3 w-full bg-slate-700 rounded animate-pulse" />
        {/* 按钮占位 */}
        <div className="flex gap-2 mt-3">
          <div className="h-7 w-16 bg-slate-700 rounded animate-pulse" />
          <div className="h-7 w-16 bg-slate-700 rounded animate-pulse" />
        </div>
      </div>
    </div>
  );
}
