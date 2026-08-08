/**
 * 分页信息栏——对齐 Figma 10:16235 Pagination Bar。
 * 显示范围、总数、每页条数、当前页、上/下一页导航。
 *
 * @param props - 组件属性
 * @param props.page - 当前页码（从 1 开始）
 * @param props.pageSize - 每页条数
 * @param props.total - 总条数
 * @param props.onPageChange - 翻页回调
 * @returns 分页栏 React 元素
 *
 * @example
 * ```tsx
 * <PaginationBar page={1} pageSize={12} total={45} onPageChange={setPage} />
 * ```
 */
export function PaginationBar({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  /** 当前页码（1-based） */
  page: number;
  /** 每页条数 */
  pageSize: number;
  /** 总条数 */
  total: number;
  /** 翻页回调 */
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div
      className="flex items-center justify-center h-11 px-4 rounded-lg"
      style={{ backgroundColor: '#172133' }}
    >
      <span className="text-sm text-slate-400">
        显示 {start}-{end} 条，共 {total} 条结果
        &nbsp;&nbsp;&nbsp;每页 {pageSize} 条
        &nbsp;&nbsp;&nbsp;第 {page}/{totalPages} 页
        &nbsp;&nbsp;&nbsp;
      </span>
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        className="text-sm text-slate-400 hover:text-slate-200 disabled:opacity-30"
      >
        上一页
      </button>
      <span className="text-sm text-slate-400">&nbsp;&nbsp;&nbsp;</span>
      <button
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        className="text-sm text-slate-400 hover:text-slate-200 disabled:opacity-30"
      >
        下一页
      </button>
    </div>
  );
}
