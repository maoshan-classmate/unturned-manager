import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Save, X, Plus } from 'lucide-react';
import { Dialog } from '../shared/Dialog.js';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';
import type { ServerInfo } from '@/hooks/useServer';

interface CreateServerForm {
  id: string;
  name: string;
  gamePort: number;
  ownerSteamId: string;
  installDir: string;
  rconPassword?: string;
}

/**
 * 创建新实例弹窗——6 字段表单 + 取消/添加。
 * 走 react-hook-form(项目铁律)。
 * 纯前端本地效果:提交后把新实例数据回传给父组件,不调用任何后端接口。
 * 后端「扫描/创建 Servers/<id> 目录」实现后,再改为调用真实创建接口。
 */
export function CreateServerDialog({ open, onClose, onCreated }: {
  open: boolean;
  onClose: () => void;
  onCreated?: (server: ServerInfo) => void;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateServerForm>({
    defaultValues: {
      id: '',
      name: '',
      gamePort: 27015,
      ownerSteamId: '76561198000000000',
      installDir: '/opt/unturned',
      rconPassword: '',
    },
  });

  const onSubmit = (data: CreateServerForm) => {
    // 纯前端本地新建——构造实例数据回传给父组件,不调后端、不写 DB。
    const newServer: ServerInfo = {
      id: data.id,
      name: data.name || data.id,
      gamePort: Number(data.gamePort),
      ownerSteamId: data.ownerSteamId,
      installDir: data.installDir,
      state: 'STOPPED',
    };
    onCreated?.(newServer);
    toast.success(`实例「${data.id}」已创建`);
    reset();
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} width={520}>
      <form onSubmit={handleSubmit(onSubmit)} className="p-5 space-y-3">
        <Dialog.Title>创建新实例</Dialog.Title>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-slate-400 mb-1">ServerID</label>
            <Input
              {...register('id', { required: '请输入 ServerID' })}
              placeholder="MyServer"
              className="h-9 text-sm"
            />
            {errors.id && <p role="alert" className="text-sm mt-1" style={{ color: '#EF4444' }}>{errors.id.message}</p>}
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">名称</label>
            <Input
              {...register('name')}
              placeholder="我的 Unturned 服务器"
              className="h-9 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">游戏端口</label>
            <Input
              type="number"
              {...register('gamePort', { valueAsNumber: true, required: '请输入端口' })}
              className="h-9 text-sm"
            />
            {errors.gamePort && <p role="alert" className="text-sm mt-1" style={{ color: '#EF4444' }}>{errors.gamePort.message}</p>}
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Owner SteamID64</label>
            <Input
              {...register('ownerSteamId', { required: '请输入 Owner SteamID64' })}
              placeholder="76561198000000000"
              className="h-9 text-sm font-mono"
            />
            {errors.ownerSteamId && <p role="alert" className="text-sm mt-1" style={{ color: '#EF4444' }}>{errors.ownerSteamId.message}</p>}
          </div>
          <div className="col-span-2">
            <label className="block text-sm text-slate-400 mb-1">安装目录</label>
            <Input
              {...register('installDir', { required: '请输入安装目录' })}
              placeholder="/opt/unturned"
              className="h-9 text-sm font-mono"
            />
            {errors.installDir && <p role="alert" className="text-sm mt-1" style={{ color: '#EF4444' }}>{errors.installDir.message}</p>}
          </div>
          <div className="col-span-2">
            <label className="block text-sm text-slate-400 mb-1">RCON 密码(可选)</label>
            <Input
              type="password"
              {...register('rconPassword')}
              placeholder="留空则自动生成"
              className="h-9 text-sm"
            />
          </div>
        </div>

        <Dialog.Footer>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={isSubmitting}>
            <X size={14} /> 取消
          </Button>
          <Button type="submit" size="sm" disabled={isSubmitting}>
            {isSubmitting ? <Save size={14} className="animate-pulse" /> : <Plus size={14} />}
            {isSubmitting ? '创建中...' : '创建'}
          </Button>
        </Dialog.Footer>
      </form>
    </Dialog>
  );
}