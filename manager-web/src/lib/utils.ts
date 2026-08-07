import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ─── 通用工具（P0 提取自各页面的重复代码）───────────────

/** 文件大小格式化：B → KB → MB */
export function formatSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** ISO 日期 → YYYY-MM-DD */
export function formatDate(iso: string): string {
  try { return new Date(iso).toISOString().slice(0, 10) }
  catch { return iso.slice(0, 10) }
}

/** 服务端状态 → 中文标签 */
export function stateLabel(state: string): string {
  const labels: Record<string, string> = {
    STOPPED: '已停止', STARTING: '启动中', RUNNING: '运行中',
    DEGRADED: '降级运行', STOPPING: '停止中',
  }
  return labels[state] ?? state
}

/** 服务端状态 → 颜色 */
export function stateColor(state: string): string {
  const colors: Record<string, string> = {
    STOPPED: '#64748B', STARTING: '#F59E0B', RUNNING: '#22C55E',
    DEGRADED: '#F59E0B', STOPPING: '#F59E0B',
  }
  return colors[state] ?? '#64748B'
}

/** 统一错误消息提取 */
export function errorMessage(err: unknown, fallback = '操作失败'): string {
  return err instanceof Error ? err.message : fallback
}
