import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Clock, Plus, Pencil, Trash2, AlertCircle } from 'lucide-react';
import { Card } from '../shared/Card.js';
import { Button } from '../ui/button.js';
import { ConfirmDialog } from '../shared/ConfirmDialog.js';
import { PaginationBar } from '../shared/PaginationBar.js';
import { Switch } from '../ui/switch.js';
import { apiClient } from '@/api/client';
import { ScheduledTaskDialog } from './ScheduledTaskDialog.js';

interface ScheduledTask {
  id: string;
  name: string;
  minute: string;
  hour: string;
  day: string;
  month: string;
  weekday: string;
  shellCommand: string;
  enabled: boolean;
}

interface ScheduledTasksCardProps {
  serverId: string;
}

const PAGE_SIZE = 4;

/**
 * Card - Scheduled Tasks:Figma 9:15565 — 表格 + 添加按钮 + 编辑/删除 + 启停 Switch + 分页。
 * 后端暂无 /scheduled-tasks 端点 ——fallback 空数组 + UI 完整可用,等后端就绪自动生效。
 */
export function ScheduledTasksCard({ serverId }: ScheduledTasksCardProps) {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<ScheduledTask | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<ScheduledTask | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<{ data: ScheduledTask[] }>(`/servers/${serverId}/scheduled-tasks`);
      setTasks(res.data.data ?? []);
    } catch {
      setTasks([]); // 后端暂未实现,空态
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const total = tasks.length;
  const start = (page - 1) * PAGE_SIZE;
  const pageRows = tasks.slice(start, start + PAGE_SIZE);

  const handleToggleEnabled = async (task: ScheduledTask, next: boolean) => {
    // 乐观更新
    const prev = tasks;
    setTasks((cur) => cur.map((t) => (t.id === task.id ? { ...t, enabled: next } : t)));
    try {
      await apiClient.patch(`/servers/${serverId}/scheduled-tasks/${task.id}`, { enabled: next });
    } catch (err: unknown) {
      setTasks(prev); // 回滚
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      toast.error(msg ?? '更新状态失败');
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    try {
      await apiClient.delete(`/servers/${serverId}/scheduled-tasks/${deleteConfirm.id}`);
      toast.success('任务已删除');
      setDeleteConfirm(null);
      fetchTasks();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      toast.error(msg ?? '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  const cronExpr = (t: ScheduledTask) =>
    `${t.minute} ${t.hour} ${t.day} ${t.month} ${t.weekday}`;

  return (
    <>
      <Card icon={Clock} title="计划任务">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-slate-500">共 {total} 个任务</span>
          {/* 添加任务按钮——计划任务功能未完成，临时隐藏 */}
          {/* <Button size="sm" onClick={() => { setEditingTask(null); setDialogOpen(true); }} className="h-9 text-sm gap-1 bg-emerald-500 text-white hover:bg-emerald-600">
            <Plus size={12} /> 添加任务
          </Button> */}
        </div>

        <div className="rounded-md border border-slate-700 overflow-hidden">
          <div className="grid grid-cols-[1fr_90px_1fr_60px_90px] gap-2 px-3 py-2 bg-slate-900/50 text-sm text-slate-500">
            <span>任务名称</span>
            <span>执行时间</span>
            <span>通知方式</span>
            <span>启用</span>
            <span>操作</span>
          </div>
          <div className="divide-y divide-slate-700">
            {loading ? (
              <div className="px-3 py-6 text-center text-sm text-slate-500">加载中...</div>
            ) : pageRows.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-slate-500">
                {total === 0 ? '暂无任务,点击「添加任务」创建' : '当前页无数据'}
              </div>
            ) : (
              pageRows.map((t) => (
                <div key={t.id} className="grid grid-cols-[1fr_90px_1fr_60px_90px] gap-2 px-3 py-2 text-sm items-center">
                  <span className="text-slate-100 truncate">{t.name}</span>
                  <span className="text-slate-400 font-mono text-xs">{cronExpr(t)}</span>
                  <span className="text-slate-400 truncate">{t.shellCommand}</span>
                  <Switch checked={t.enabled} onCheckedChange={(v) => handleToggleEnabled(t, v)} />
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => { setEditingTask(t); setDialogOpen(true); }}
                      className="text-slate-400 hover:text-slate-200"
                      aria-label="编辑"
                    >
                      <Pencil size={12} />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => setDeleteConfirm(t)}
                      className="text-red-500 hover:text-red-400"
                      aria-label="删除"
                    >
                      <Trash2 size={12} />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {total > PAGE_SIZE && (
          <div className="mt-3">
            <PaginationBar page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
          </div>
        )}
      </Card>

      <ScheduledTaskDialog
        open={dialogOpen}
        serverId={serverId}
        task={editingTask}
        onClose={() => { setDialogOpen(false); setEditingTask(null); }}
        onSaved={fetchTasks}
      />

      <ConfirmDialog
        open={!!deleteConfirm}
        title="删除任务"
        message={`确定删除任务「${deleteConfirm?.name}」吗?该操作不可撤销。`}
        confirmLabel="删除"
        variant="danger"
        icon={AlertCircle}
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteConfirm(null)}
      />
    </>
  );
}