import { useState } from 'react';
import {
  Shuffle, Shield, Key, Globe, FileText, Gamepad2,
  AlertCircle, Save, Check,
} from 'lucide-react';
import { Button } from '../components/ui/button.js';
import { Input } from '../components/ui/input.js';
import { PasswordInput } from '../components/shared/PasswordInput.js';
import { Card } from '../components/shared/Card.js';

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

  const handleChangePassword = async () => {
    if (passwordForm.newPass !== passwordForm.confirm) {
      setError('两次输入的新密码不一致');
      return;
    }
    setSaving(true);
    setError(null);
    // Sprint 2: 改密码 API 留到后续实现
    setTimeout(() => {
      setSaving(false);
      setSaved(true);
      setPasswordForm({ current: '', newPass: '', confirm: '' });
      setTimeout(() => setSaved(false), 2000);
    }, 500);
  };

  return (
    <div className="flex flex-col h-full gap-4 overflow-auto">
      <h1 className="text-2xl font-semibold" style={{ color: '#F1F5FB' }}>Settings</h1>

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

        {/* 安全配置 */}
        <Card icon={Shield} title="安全配置">
          <div className="space-y-2 text-sm" style={{ color: '#94A3B8' }}>
            <div className="flex items-center justify-between">
              <span>凭据加密</span>
              <span style={{ color: '#22C55E' }}>AES-GCM</span>
            </div>
            <div className="flex items-center justify-between">
              <span>JWT 有效期</span>
              <span>15 分钟</span>
            </div>
            <div className="flex items-center justify-between">
              <span>密码哈希</span>
              <span style={{ color: '#22C55E' }}>Argon2id</span>
            </div>
            <div className="flex items-center justify-between">
              <span>速率限制</span>
              <span style={{ color: '#64748B' }}>暂未配置</span>
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
              <span style={{ color: '#64748B' }}>Dashboard</span>
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
              ['默认视角', 'Both'],
              ['默认地图', 'PEI'],
              ['最大玩家', '16'],
              ['昼夜循环', '3600s'],
              ['Ping 超时', '750ms'],
              ['排队上限', '0（关闭）'],
            ].map(([label, value]) => (
              <div key={label} className="p-2 rounded" style={{ backgroundColor: '#0F172A' }}>
                <div className="text-xs" style={{ color: '#64748B' }}>{label}</div>
                <div className="text-sm font-mono mt-0.5" style={{ color: '#F1F5FB' }}>{value}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
