import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Save, X } from 'lucide-react';
import { Dialog } from '../shared/Dialog.js';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';
import { apiClient } from '@/api/client';
import { steamcmdPathSchema, type SteamcmdPathForm } from '@/schemas/serverSetup';

interface SteamCmdPathDialogProps {
  open: boolean;
  currentPath: string;
  onClose: () => void;
  onSaved?: (newPath: string) => void;
}

/**
 * SteamCMD 安装路径编辑弹窗——单 Input + 取消/保存。
 * 走 react-hook-form + zod(项目铁律强制)。
 */
export function SteamCmdPathDialog({ open, currentPath, onClose, onSaved }: SteamCmdPathDialogProps) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SteamcmdPathForm>({
    resolver: zodResolver(steamcmdPathSchema),
    defaultValues: { installPath: currentPath },
  });

  // 打开时重置初值(避免显示旧路径)
  useEffect(() => {
    if (open) reset({ installPath: currentPath });
  }, [open, currentPath, reset]);

  const onSubmit = async (data: SteamcmdPathForm) => {
    try {
      await apiClient.patch('/steamcmd/install-path', { installPath: data.installPath });
      toast.success('SteamCMD 路径已保存');
      onSaved?.(data.installPath);
      onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      toast.error(msg ?? '保存失败');
    }
  };

  return (
    <Dialog open={open} onClose={onClose} width={450}>
      <form onSubmit={handleSubmit(onSubmit)} className="p-4">
        <Dialog.Title>SteamCMD 安装路径</Dialog.Title>

        <div className="space-y-2">
          <label className="block text-sm text-slate-400">安装目录</label>
          <Input
            {...register('installPath')}
            placeholder="/opt/steamcmd"
            className="h-9 text-sm"
            aria-invalid={!!errors.installPath}
          />
          {errors.installPath && (
            <p role="alert" className="text-sm" style={{ color: '#EF4444' }}>{errors.installPath.message}</p>
          )}
          <p className="text-sm text-slate-500">首次安装会自动创建该目录。</p>
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