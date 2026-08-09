import { useState } from 'react';
import { toast } from 'sonner';
import { Download, RefreshCw, Pencil, AlertCircle } from 'lucide-react';
import { Card } from '../shared/Card.js';
import { Button } from '../ui/button.js';
import { ConfirmDialog } from '../shared/ConfirmDialog.js';
import { apiClient } from '@/api/client';
import { SteamCmdPathDialog } from './SteamCmdPathDialog.js';

interface SteamCmdStatus {
  isInstalled: boolean;
  installPath?: string;
  version?: string;
  lastChecked?: string;
}

interface SteamCmdCardProps {
  status: SteamCmdStatus | null;
  onStatusChange: (next: SteamCmdStatus) => void;
}

/**
 * Card - SteamCMD:Figma 9:15562 — 版本/状态/路径/上次检查 + 重装/检查更新按钮。
 * 路径旁 pencil icon 触发路径编辑 Dialog。
 */
export function SteamCmdCard({ status, onStatusChange }: SteamCmdCardProps) {
  const [pathDialogOpen, setPathDialogOpen] = useState(false);
  const [reinstallConfirmOpen, setReinstallConfirmOpen] = useState(false);
  const [reinstalling, setReinstalling] = useState(false);
  const [checking, setChecking] = useState(false);

  const handleReinstall = async () => {
    setReinstalling(true);
    try {
      await apiClient.post('/steamcmd/reinstall');
      toast.success('SteamCMD 重装已提交');
      setReinstallConfirmOpen(false);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      toast.error(msg ?? '重装失败');
    } finally {
      setReinstalling(false);
    }
  };

  const handleCheckUpdate = async () => {
    setChecking(true);
    try {
      const res = await apiClient.post<{ data: { latestVersion?: string } }>('/steamcmd/check-update');
      toast.success(res.data.data?.latestVersion ? `已是最新版本:${res.data.data.latestVersion}` : '已是最新版本');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      toast.error(msg ?? '检查更新失败');
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <Card icon={Download} title="SteamCMD">
        {!status ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <AlertCircle size={14} /> 加载中...
          </div>
        ) : (
          <>
            <div className="space-y-2 text-sm text-slate-400">
              <div className="flex items-center gap-2">
                <span className="w-20 text-slate-500 shrink-0">版本</span>
                <span className="text-slate-100">{status.version ?? '—'}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-20 text-slate-500 shrink-0">状态</span>
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: status.isInstalled ? '#22C55E' : '#EF4444' }}
                />
                <span style={{ color: status.isInstalled ? '#22C55E' : '#EF4444' }}>
                  {status.isInstalled ? '已安装' : '未安装'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-20 text-slate-500 shrink-0">路径</span>
                <span className="text-slate-100 font-mono truncate flex-1">{status.installPath ?? '—'}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setPathDialogOpen(true)}
                  className="h-6 w-6 text-slate-500 hover:text-slate-300"
                  aria-label="编辑安装路径"
                >
                  <Pencil size={14} />
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-20 text-slate-500 shrink-0">上次检查</span>
                <span className="text-slate-100">
                  {status.lastChecked ? new Date(status.lastChecked).toLocaleString('zh-CN') : '—'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 mt-4">
              <Button variant="secondary" size="sm" onClick={() => setReinstallConfirmOpen(true)} className="h-8 text-sm gap-1">
                <Download size={12} /> {status.isInstalled ? '重装 SteamCMD' : '安装 SteamCMD'}
              </Button>
              {status.isInstalled && (
                <Button variant="secondary" size="sm" onClick={handleCheckUpdate} disabled={checking} className="h-8 text-sm gap-1">
                  <RefreshCw size={12} className={checking ? 'animate-spin' : ''} /> 检查更新
                </Button>
              )}
            </div>
          </>
        )}
      </Card>

      <SteamCmdPathDialog
        open={pathDialogOpen}
        currentPath={status?.installPath ?? ''}
        onClose={() => setPathDialogOpen(false)}
        onSaved={(newPath) => onStatusChange({ ...(status ?? { isInstalled: false }), installPath: newPath })}
      />

      <ConfirmDialog
        open={reinstallConfirmOpen}
        title="重装 SteamCMD"
        message="将删除现有 SteamCMD 并重新下载,期间无法使用 SteamCMD 相关功能。是否继续?"
        confirmLabel="重装"
        variant="danger"
        icon={AlertCircle}
        loading={reinstalling}
        onConfirm={handleReinstall}
        onCancel={() => setReinstallConfirmOpen(false)}
      />
    </>
  );
}