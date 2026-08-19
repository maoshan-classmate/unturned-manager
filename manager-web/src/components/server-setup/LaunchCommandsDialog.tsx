import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Save, X } from 'lucide-react';
import { Dialog } from '../shared/Dialog.js';
import { Button } from '../ui/button.js';
import { apiClient } from '@/api/client';
import { launchCommandsSchema, type LaunchCommandsForm } from '@/schemas/serverSetup';

interface LaunchCommandsDialogProps {
  open: boolean;
  serverId: string;
  currentCommands: string;
  onClose: () => void;
  onSaved?: (commands: string) => void;
}

/**
 * 启动命令编辑弹窗——单 textarea(Figma 20:19524)+ 取消/保存。
 * 行式命令文本,等宽字体显示。
 */
export function LaunchCommandsDialog({ open, serverId, currentCommands, onClose, onSaved }: LaunchCommandsDialogProps) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<LaunchCommandsForm>({
    resolver: zodResolver(launchCommandsSchema),
    defaultValues: { commands: currentCommands },
  });

  useEffect(() => {
    if (open) reset({ commands: currentCommands });
  }, [open, currentCommands, reset]);

  const onSubmit = async (data: LaunchCommandsForm) => {
    try {
      await apiClient.put(`/servers/${serverId}/config/commands`, { commands: data.commands });
      toast.success('启动命令已保存');
      onSaved?.(data.commands);
      onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      toast.error(msg ?? '保存失败');
    }
  };

  return (
    <Dialog open={open} onClose={onClose} width={500}>
      <form onSubmit={handleSubmit(onSubmit)} className="p-4">
        <Dialog.Title>编辑启动命令</Dialog.Title>

        <div className="space-y-2">
          <label className="block text-sm text-slate-400">启动命令(每行一条)</label>
          <textarea
            {...register('commands')}
            rows={8}
            spellCheck={false}
            placeholder="ServerHelper.sh +InternetServer/MyServer -ThreadedConsole"
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-mono text-slate-100 focus:outline-none focus:ring-1 focus:ring-slate-600"
            aria-invalid={!!errors.commands}
          />
          {errors.commands && (
            <p role="alert" className="text-sm" style={{ color: '#EF4444' }}>{errors.commands.message}</p>
          )}
          <p className="text-sm text-slate-500">此命令会在实例启动时拼到启动命令行末尾。</p>
        </div>

        <Dialog.Footer>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={isSubmitting}>
            <X size={14} /> 取消
          </Button>
          <Button type="submit" size="sm" disabled={isSubmitting}>
            <Save size={14} /> {isSubmitting ? '保存中...' : '保存'}
          </Button>
        </Dialog.Footer>
      </form>
    </Dialog>
  );
}