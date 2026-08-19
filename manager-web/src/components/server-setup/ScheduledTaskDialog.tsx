import { useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Save, X, Plus } from 'lucide-react';
import { Dialog } from '../shared/Dialog.js';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.js';
import { Switch } from '../ui/switch.js';
import { apiClient } from '@/api/client';
import { scheduledTaskSchema, CRON_FIELDS, type ScheduledTaskForm } from '@/schemas/serverSetup';

/** 单字段选项构造(min..max 数字串) */
const minuteOpts = Array.from({ length: 60 }, (_, i) => i.toString());
const hourOpts = Array.from({ length: 24 }, (_, i) => i.toString());
const dayOpts = Array.from({ length: 31 }, (_, i) => (i + 1).toString());
const monthOpts = Array.from({ length: 12 }, (_, i) => (i + 1).toString());
const weekdayOpts = ['0', '1', '2', '3', '4', '5', '6']; // 周日=0
const OPTION_MAP = { minute: minuteOpts, hour: hourOpts, day: dayOpts, month: monthOpts, weekday: weekdayOpts } as const;

interface ScheduledTaskDialogProps {
  open: boolean;
  serverId: string;
  /** 编辑模式:传入已有任务;新增模式不传 */
  task?: { id?: string; name: string; minute: string; hour: string; day: string; month: string; weekday: string; shellCommand: string; enabled: boolean } | null;
  onClose: () => void;
  onSaved?: () => void;
}

/**
 * 计划任务编辑弹窗(Figma 20:19523)— 任务名称 + cron 5 字段 + shell 命令 + enabled。
 */
export function ScheduledTaskDialog({ open, serverId, task, onClose, onSaved }: ScheduledTaskDialogProps) {
  const isEdit = !!task?.id;
  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors, isSubmitting },
  } = useForm<ScheduledTaskForm>({
    resolver: zodResolver(scheduledTaskSchema),
    defaultValues: {
      name: task?.name ?? '',
      minute: task?.minute ?? '0',
      hour: task?.hour ?? '4',
      day: task?.day ?? '*',
      month: task?.month ?? '*',
      weekday: task?.weekday ?? '*',
      shellCommand: task?.shellCommand ?? '',
      enabled: task?.enabled ?? true,
    },
  });

  useEffect(() => {
    if (open && task) {
      reset({
        name: task.name,
        minute: task.minute,
        hour: task.hour,
        day: task.day,
        month: task.month,
        weekday: task.weekday,
        shellCommand: task.shellCommand,
        enabled: task.enabled,
      });
    } else if (open) {
      reset({ name: '', minute: '0', hour: '4', day: '*', month: '*', weekday: '*', shellCommand: '', enabled: true });
    }
  }, [open, task, reset]);

  const onSubmit = async (data: ScheduledTaskForm) => {
    try {
      const url = isEdit
        ? `/servers/${serverId}/scheduled-tasks/${task!.id}`
        : `/servers/${serverId}/scheduled-tasks`;
      if (isEdit) await apiClient.put(url, data);
      else await apiClient.post(url, data);
      toast.success(isEdit ? '任务已更新' : '任务已创建');
      onSaved?.();
      onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      toast.error(msg ?? '保存失败');
    }
  };

  return (
    <Dialog open={open} onClose={onClose} width={450}>
      <form onSubmit={handleSubmit(onSubmit)} className="p-4 space-y-3">
        <Dialog.Title>{isEdit ? '编辑计划任务' : '添加计划任务'}</Dialog.Title>

        <div>
          <label className="block text-sm text-slate-400 mb-1">任务名称</label>
          <Input {...register('name')} placeholder="每日重启" className="h-9 text-sm" aria-invalid={!!errors.name} />
          {errors.name && <p role="alert" className="text-sm mt-1" style={{ color: '#EF4444' }}>{errors.name.message}</p>}
        </div>

        <div>
          <label className="block text-sm text-slate-400 mb-1">执行时间</label>
          <div className="grid grid-cols-5 gap-2">
            {CRON_FIELDS.map((field) => (
              <Controller
                key={field}
                control={control}
                name={field}
                render={({ field: f }) => (
                  <Select value={f.value} onValueChange={(v) => f.onChange(v ?? '')}>
                    <SelectTrigger className="h-9 w-full text-sm" aria-invalid={!!errors[field]}>
                      <SelectValue placeholder={field} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="*">* (每)</SelectItem>
                      {OPTION_MAP[field].map((opt) => (
                        <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            ))}
          </div>
          <p className="text-sm text-slate-500 mt-1">从左到右:分 / 时 / 日 / 月 / 周</p>
        </div>

        <div>
          <label className="block text-sm text-slate-400 mb-1">通知方式</label>
          <Controller
            control={control}
            name="shellCommand"
            render={({ field: f }) => (
              <Input
                {...f}
                placeholder="游戏内广播: Server restart in 5 min"
                className="h-9 text-sm"
                aria-invalid={!!errors.shellCommand}
              />
            )}
          />
          {errors.shellCommand && <p role="alert" className="text-sm mt-1" style={{ color: '#EF4444' }}>{errors.shellCommand.message}</p>}
        </div>

        <div className="flex items-center justify-between rounded-md border border-slate-700 px-3 py-2">
          <span className="text-sm text-slate-400">启用此任务</span>
          <Controller
            control={control}
            name="enabled"
            render={({ field: f }) => <Switch checked={f.value} onCheckedChange={f.onChange} />}
          />
        </div>

        <Dialog.Footer>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={isSubmitting}>
            <X size={14} /> 取消
          </Button>
          <Button type="submit" size="sm" disabled={isSubmitting}>
            {isEdit ? <Save size={14} /> : <Plus size={14} />}
            {isSubmitting ? '保存中...' : isEdit ? '保存' : '添加'}
          </Button>
        </Dialog.Footer>
      </form>
    </Dialog>
  );
}