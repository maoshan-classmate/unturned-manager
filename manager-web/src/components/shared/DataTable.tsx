import type { ReactNode } from 'react';
import { PaginationBar } from './PaginationBar.js';

/**
 * 列定义——key 必须与 data 中的 key 对应。
 */
export interface DataTableColumn<T = Record<string, ReactNode>> {
  key: string;
  label: string;
  /** 列宽 Tailwind class（如 'w-48'），可选 */
  className?: string;
}

/**
 * 分页信息。
 */
export interface DataTablePagination {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

interface DataTableProps<T extends Record<string, ReactNode>> {
  columns: DataTableColumn<T>[];
  data: T[];
  keyField: string;
  emptyText?: string;
  pagination?: DataTablePagination;
}

/**
 * 共享数据表格——Players / Workshop / etc 统一使用此组件。
 * 内置 PaginationBar 复用（对齐 Figma 10:16235）。
 */
export function DataTable<T extends Record<string, ReactNode>>({
  columns,
  data,
  keyField,
  emptyText = '暂无数据',
  pagination,
}: DataTableProps<T>) {
  return (
    <div className="flex flex-col h-full">
      {/* Table — 横向滚动适配小屏 */}
      <div className="flex-1 overflow-auto rounded-lg border border-slate-700">
        <div className="min-w-[640px]">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left bg-slate-950">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={`px-3 md:px-4 py-3 text-xs font-medium text-slate-500 first:pl-6 last:pr-6 ${col.className ?? ''}`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-12 text-center text-xs text-slate-500">
                    {emptyText}
                  </td>
                </tr>
              ) : (
                data.map((row) => (
                  <tr
                    key={String(row[keyField])}
                    className="hover:bg-slate-800/40 transition-colors border-t border-slate-800"
                  >
                    {columns.map((col, i) => (
                      <td
                        key={col.key}
                        className={`px-3 md:px-4 py-3 ${i === 0 ? 'first:pl-6' : ''} ${i === columns.length - 1 ? 'last:pr-6' : ''}`}
                      >
                        {row[col.key]}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination Bar — 复用共享组件，对齐 Figma 10:16235 */}
      {pagination && data.length > 0 && (
        <div className="shrink-0 mt-3 mb-2">
          <PaginationBar
            page={pagination.page}
            pageSize={pagination.pageSize}
            total={pagination.total}
            onPageChange={pagination.onPageChange}
          />
        </div>
      )}
    </div>
  );
}
