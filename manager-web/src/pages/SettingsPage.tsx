import { useState, useEffect } from 'react';
import {
  Shuffle, Shield, Key, Globe, FileText, Gamepad2, Wrench,
  AlertCircle, Save, Check, Trash2,
} from 'lucide-react';
import { Button } from '../components/ui/button.js';
import { Input } from '../components/ui/input.js';
import { PasswordInput } from '../components/shared/PasswordInput.js';
import { Card } from '../components/shared/Card.js';
import { apiClient } from '../api/client.js';

/**
 * Settings 页面——Figma 23:19917 🎨 System Settings (P1)。
 *
 * 5 张设置卡片：账户安全 / 安全配置 / 网页设置 / 面板日志 / 游戏默认值。
 */
export function SettingsPage() {
  const [passwordForm, setPasswordForm] = useState({ current: '', newPass: '', confirm: '' });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Steam WebAPI Key
  const [webApiKey, setWebApiKey] = useState('');
  const [webApiKeyExists, setWebApiKeyExists] = useState(false);
  const [keyLoading, setKeyLoading] = useState(false);
  const [keySaving, setKeySaving] = useState(false);
  const [keySaved, setKeySaved] = useState(false);

  /** 加载 WebAPI Key 配置状态 */
  const fetchKeyStatus = async () => {
    setKeyLoading(true);
    try {
      const res = await apiClient.get('/settings/webapi-key');
      setWebApiKeyExists(res.data.data?.exists ?? false);
    } catch { /* ignore */ }
    finally { setKeyLoading(false); }
  };

  useEffect(() => { fetchKeyStatus(); }, []);

  /** 保存 WebAPI Key */
  const handleSaveKey = async () => {
    if (!webApiKey.trim() || webApiKey.trim().length < 32) {
      setError('Steam WebAPI Key 至少需要 32 个字符');
      return;
    }
    setKeySaving(true); setError(null);
    try {
      await apiClient.post('/settings/webapi-key', { apiKey: webApiKey.trim() });
      setWebApiKeyExists(true);
      setWebApiKey('');
      setKeySaved(true);
      setTimeout(() => setKeySaved(false), 2000);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      setError(msg ?? '保存 WebAPI Key 失败');
    } finally { setKeySaving(false); }
  };

  /** 删除 WebAPI Key */
  const handleDeleteKey = async () => {
    setKeySaving(true); setError(null);
    try {
      await apiClient.delete('/settings/webapi-key');
      setWebApiKeyExists(false);
      setKeySaved(true);
      setTimeout(() => setKeySaved(false), 2000);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      setError(msg ?? '删除 WebAPI Key 失败');
    } finally { setKeySaving(false); }
  };

  const handleChangePassword = async () => {
    if (passwordForm.newPass !== passwordForm.confirm) {
      setError('两次输入的新密码不一致');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiClient.post('/auth/change-password', {
        current: passwordForm.current,
        newPass: passwordForm.newPass,
        confirm: passwordForm.confirm,
      });
      setSaved(true);
      setPasswordForm({ current: '', newPass: '', confirm: '' });
      setTimeout(() => setSaved(false), 2000);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      setError(msg ?? '修改密码失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full gap-4 overflow-auto">
      <h1 className="text-2xl font-semibold" style={{ color: '#F1F5FB' }}>系统设置</h1>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg text-xs"
          style={{ backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#EF4444' }}>
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {saved && (
        <div className="flex items-center gap-2 p-3 rounded-lg text-xs"
          style={{ backgroundColor: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: '#22C55E' }}>
          <Check size={14} /> 设置已保存
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 账户安全 */}
        <Card icon={Key} title="账户安全">
          <div className="space-y-3">
            {[
              ['current', '当前密码'],
              ['newPass', '新密码'],
              ['confirm', '确认新密码'],
            ].map(([key, label]) => (
              <label key={key as string} className="block">
                <span className="text-xs" style={{ color: '#64748B' }}>{label as string}</span>
                <PasswordInput
                  value={String(passwordForm[key as keyof typeof passwordForm] ?? '')}
                  onChange={(e) => setPasswordForm((prev) => ({ ...prev, [key as string]: e.target.value }))}
                  className="mt-1 h-8 text-sm"
                />
              </label>
            ))}
            <Button onClick={handleChangePassword} disabled={saving}
              className="h-7 text-xs" style={{ backgroundColor: '#22C55E', color: '#fff' }}>
              <Save size={12} className="mr-1" /> {saving ? '保存中...' : '修改密码'}
            </Button>
          </div>
        </Card>

        {/* 安全配置 —— 简化版：玩家无需了解算法名称，只看登录有效期 */}
        <Card icon={Shield} title="安全配置">
          <div className="space-y-2 text-sm" style={{ color: '#94A3B8' }}>
            <div className="flex items-center justify-between">
              <span>登录有效期</span>
              <span style={{ color: '#F1F5FB' }}>15 分钟</span>
            </div>
            <div className="text-xs" style={{ color: '#64748B' }}>
              凭据加密与密码哈希已启用行业标准算法，无需手动配置。
            </div>
          </div>
        </Card>

        {/* 网页设置 */}
        <Card icon={Globe} title="网页设置">
          <div className="space-y-2 text-sm" style={{ color: '#94A3B8' }}>
            <div className="flex items-center justify-between">
              <span>主题</span>
              <span style={{ color: '#64748B' }}>深色（固定）</span>
            </div>
            <div className="flex items-center justify-between">
              <span>语言</span>
              <span style={{ color: '#64748B' }}>中文（固定）</span>
            </div>
            <div className="flex items-center justify-between">
              <span>默认页面</span>
              <span style={{ color: '#64748B' }}>仪表盘</span>
            </div>
          </div>
        </Card>

        {/* 面板日志 */}
        <Card icon={FileText} title="面板日志">
          <div className="space-y-2 text-sm" style={{ color: '#94A3B8' }}>
            <div className="flex items-center justify-between">
              <span>日志级别</span>
              <span>info</span>
            </div>
            <div className="flex items-center justify-between">
              <span>日志滚动</span>
              <span>自动（pino）</span>
            </div>
            <div className="flex items-center justify-between">
              <span>输出格式</span>
              <span>结构化 JSON</span>
            </div>
          </div>
        </Card>

        {/* 游戏默认值 */}
        <Card icon={Gamepad2} title="游戏默认值" className="md:col-span-2">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm" style={{ color: '#94A3B8' }}>
            {[
              ['默认端口', '27015'],
              ['默认难度', 'Normal'],
              ['默认视角', 'FIRST'],
              ['默认地图', 'PEI'],
              ['默认 PvP/PvE', 'PvP（开启）'],
              ['最大玩家', '8'],
              ['昼夜循环', '3600s'],
              ['Ping 超时', '750ms'],
              ['排队上限', '8'],
              ['聊天冷却', '0.25s'],
              ['服务器密码', '无（开放）'],
              ['监听地址', '0.0.0.0'],
            ].map(([label, value]) => (
              <div key={label} className="p-2 rounded" style={{ backgroundColor: '#0F172A' }}>
                <div className="text-xs" style={{ color: '#64748B' }}>{label}</div>
                <div className="text-sm font-mono mt-0.5" style={{ color: '#F1F5FB' }}>{value}</div>
              </div>
            ))}
          </div>
        </Card>

        {/* Steam WebAPI Key — 模组页面依赖此项 */}
        <Card icon={Wrench} title="Steam WebAPI Key" className="md:col-span-2">
          <div className="space-y-3">
            <p className="text-xs" style={{ color: '#94A3B8' }}>
              用于从 Steam 创意工坊获取 Mod 元数据（名称、作者、预览图等）。
              {!webApiKeyExists && (
                <span style={{ color: '#F59E0B' }}> 未配置——模组页面将无法浏览创意工坊。</span>
              )}
            </p>

            {keyLoading ? (
              <span className="text-xs text-slate-500">加载中...</span>
            ) : webApiKeyExists ? (
              <div className="flex items-center gap-3">
                <span className="text-sm" style={{ color: '#22C55E' }}>✓ 已配置</span>
                <Button onClick={handleDeleteKey} disabled={keySaving} variant="outline" size="sm"
                  className="h-7 text-xs gap-1 text-red-500 border-red-500/30">
                  <Trash2 size={12} /> 删除
                </Button>
                {keySaved && <span className="text-xs text-emerald-500"><Check size={12} className="inline" /> 已更新</span>}
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <Input
                  value={webApiKey}
                  onChange={(e) => setWebApiKey(e.target.value)}
                  placeholder="粘贴 Steam WebAPI Key（32 位 hex）"
                  className="flex-1 h-8 text-sm"
                  style={{ backgroundColor: '#0F172A', borderColor: '#334059', color: '#F1F5FB' }}
                />
                <Button onClick={handleSaveKey} disabled={keySaving || webApiKey.trim().length < 32}
                  size="sm" className="h-8 text-xs gap-1 bg-emerald-500 text-white">
                  <Save size={12} /> 保存
                </Button>
              </div>
            )}

            <p className="text-xs" style={{ color: '#64748B' }}>
              在{' '}
              <a href="https://steamcommunity.com/dev/apikey" target="_blank" rel="noopener noreferrer"
                className="underline" style={{ color: '#3B82F6' }}>
                steamcommunity.com/dev/apikey
              </a>{' '}
              免费申请（需要 Steam 账号，任意域名均可）。密钥存储在服务端加密保存。
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
