import { useState, useCallback, useEffect } from 'react';
import {
  Settings, Save, AlertCircle, Loader2, Check,
  FileText, Package, Wrench, Cpu,
} from 'lucide-react';
import { TabBar } from '../components/shared/TabBar.js';
import { useServer } from '../hooks/useServer.js';
import { apiClient } from '../api/client.js';
import { Button } from '../components/ui/button.js';
import { Input } from '../components/ui/input.js';

type ConfigTab = 'commands' | 'txt' | 'workshop';

interface CommandsFields {
  Name: string;
  Port: string;
  MaxPlayers: string;
  Map: string;
  Mode: string;
  Owner: string;
  Perspective: string;
  Chatrate: string;
  Cycle: string;
  Timeout: string;
  Queue_Size: string;
  GSLT: string;
  Password: string;
  Cheats: boolean;
  Filter: boolean;
  Whitelisted: boolean;
  Gold: boolean;
  Hide_Admins: boolean;
  Sync: boolean;
}

const FIELD_LABELS: Record<keyof CommandsFields, string> = {
  Name: '服务器名称', Port: '端口', MaxPlayers: '最大玩家数', Map: '地图',
  Mode: '难度', Owner: '服主 SteamID64', Perspective: '视角限制',
  Chatrate: '聊天冷却(秒)', Cycle: '昼夜循环(秒)', Timeout: 'Ping 超时(ms)',
  Queue_Size: '排队上限', GSLT: 'Game Server Login Token', Password: '服务器密码',
  Cheats: '启用作弊', Filter: '名称过滤', Whitelisted: '白名单模式',
  Gold: '仅 Gold 会员', Hide_Admins: '隐藏管理员', Sync: '跨服同步',
};

const DEFAULT_FIELDS: CommandsFields = {
  Name: '', Port: '27015', MaxPlayers: '16', Map: 'PEI', Mode: 'Normal',
  Owner: '', Perspective: 'Both', Chatrate: '0.25', Cycle: '3600',
  Timeout: '750', Queue_Size: '0', GSLT: '', Password: '',
  Cheats: false, Filter: false, Whitelisted: false, Gold: false,
  Hide_Admins: false, Sync: false,
};

/**
 * Config 页面——Figma 2:6 🎨 Config。
 *
 * 多 Tab 配置编辑器：Commands.dat / Config.txt / Workshop。
 */
export function ConfigPage() {
  const { servers, loading: serverLoading, error: serverError } = useServer();
  const server = servers[0];

  const [tab, setTab] = useState<ConfigTab>('commands');
  const [fields, setFields] = useState<CommandsFields>(DEFAULT_FIELDS);
  const [configTxt, setConfigTxt] = useState('');
  const [workshopIds, setWorkshopIds] = useState<string[]>([]);
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const fetchConfig = useCallback(async () => {
    if (!server) return;
    setConfigLoading(true);
    setConfigError(null);
    try {
      if (tab === 'commands') {
        const res = await apiClient.get(`/servers/${server.id}/config/commands`);
        const data = res.data.data;
        if (data) {
          const known = data.known ?? {};
          setFields({
            ...DEFAULT_FIELDS,
            ...Object.fromEntries(Object.entries(known).map(([k, v]) => [k, String(v)])),
            Cheats: known.Cheats !== undefined,
            Filter: known.Filter !== undefined,
            Whitelisted: known.Whitelisted !== undefined,
            Gold: known.Gold !== undefined,
            Hide_Admins: known.Hide_Admins !== undefined,
            Sync: known.Sync !== undefined,
          });
        }
      } else if (tab === 'txt') {
        const res = await apiClient.get(`/servers/${server.id}/config/txt`);
        setConfigTxt(JSON.stringify(res.data.data, null, 2));
      } else {
        const res = await apiClient.get(`/servers/${server.id}/config/workshop`);
        setWorkshopIds(res.data.data?.File_IDs ?? []);
      }
      setDirty(false);
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : '加载配置失败');
    } finally {
      setConfigLoading(false);
    }
  }, [server, tab]);

  useEffect(() => { fetchConfig(); }, [server?.id, tab]);

  const handleSave = async () => {
    if (!server) return;
    setSaving(true);
    setConfigError(null);
    try {
      if (tab === 'commands') {
        const known = new Map<string, string>();
        for (const [key, val] of Object.entries(fields)) {
          if (['Cheats', 'Filter', 'Whitelisted', 'Gold', 'Hide_Admins', 'Sync'].includes(key)) {
            if (val) known.set(key, '');
          } else if (val) {
            known.set(key, String(val));
          }
        }
        await apiClient.put(`/servers/${server.id}/config/commands`, { known, unknown: {}, comments: [] });
      } else if (tab === 'txt') {
        const parsed = JSON.parse(configTxt);
        await apiClient.put(`/servers/${server.id}/config/txt`, parsed);
      } else {
        await apiClient.put(`/servers/${server.id}/config/workshop`, { fileIds: workshopIds });
      }
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : '保存配置失败');
    } finally {
      setSaving(false);
    }
  };

  const handleFieldChange = (key: keyof CommandsFields, value: string | boolean) => {
    setFields((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  // ── Loading / Error / Empty ──
  if (serverLoading || configLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin" style={{ color: '#22C55E' }} />
          <span className="text-sm" style={{ color: '#94A3B8' }}>加载中...</span>
        </div>
      </div>
    );
  }

  if (serverError || configError) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3 max-w-md text-center">
          <AlertCircle size={32} style={{ color: '#EF4444' }} />
          <span className="text-sm" style={{ color: '#F1F5FB' }}>无法加载配置</span>
          <span className="text-xs" style={{ color: '#64748B' }}>{serverError || configError}</span>
          <Button onClick={fetchConfig} className="h-8 text-xs"
            style={{ backgroundColor: '#1E293B', color: '#94A3B8' }}>重试</Button>
        </div>
      </div>
    );
  }

  if (!server) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <Settings size={32} style={{ color: '#64748B' }} />
          <span className="text-sm" style={{ color: '#64748B' }}>还没有服务器</span>
        </div>
      </div>
    );
  }

  const renderCommandsForm = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* 身份 */}
      <fieldset className="p-4 rounded-lg" style={{ backgroundColor: '#1E293B', border: '1px solid #334155' }}>
        <legend className="text-xs font-medium px-1" style={{ color: '#64748B' }}>身份</legend>
        <div className="space-y-3">
          {(['Name', 'Owner', 'Password'] as const).map((key) => (
            <label key={key} className="block">
              <span className="text-xs" style={{ color: '#94A3B8' }}>{FIELD_LABELS[key]}</span>
              <Input value={String(fields[key])} onChange={(e) => handleFieldChange(key, e.target.value)}
                className="mt-1 h-8 text-sm" type={key === 'Password' ? 'password' : 'text'} />
            </label>
          ))}
        </div>
      </fieldset>

      {/* 地图与模式 */}
      <fieldset className="p-4 rounded-lg" style={{ backgroundColor: '#1E293B', border: '1px solid #334155' }}>
        <legend className="text-xs font-medium px-1" style={{ color: '#64748B' }}>地图与模式</legend>
        <div className="space-y-3">
          {(['Map', 'Mode', 'Perspective'] as const).map((key) => (
            <label key={key} className="block">
              <span className="text-xs" style={{ color: '#94A3B8' }}>{FIELD_LABELS[key]}</span>
              <Input value={String(fields[key])} onChange={(e) => handleFieldChange(key, e.target.value)}
                className="mt-1 h-8 text-sm" />
            </label>
          ))}
        </div>
      </fieldset>

      {/* 网络 */}
      <fieldset className="p-4 rounded-lg" style={{ backgroundColor: '#1E293B', border: '1px solid #334155' }}>
        <legend className="text-xs font-medium px-1" style={{ color: '#64748B' }}>网络</legend>
        <div className="space-y-3">
          {(['Port', 'MaxPlayers', 'Timeout', 'Queue_Size'] as const).map((key) => (
            <label key={key} className="block">
              <span className="text-xs" style={{ color: '#94A3B8' }}>{FIELD_LABELS[key]}</span>
              <Input value={String(fields[key])} onChange={(e) => handleFieldChange(key, e.target.value)}
                className="mt-1 h-8 text-sm" />
            </label>
          ))}
        </div>
      </fieldset>

      {/* 安全与权限 */}
      <fieldset className="p-4 rounded-lg" style={{ backgroundColor: '#1E293B', border: '1px solid #334155' }}>
        <legend className="text-xs font-medium px-1" style={{ color: '#64748B' }}>安全与权限</legend>
        <div className="space-y-2">
          {([
            ['Whitelisted', '白名单模式'],
            ['Gold', '仅 Gold 会员'],
            ['Hide_Admins', '隐藏管理员'],
            ['Cheats', '启用作弊'],
            ['Filter', '名称过滤'],
            ['Sync', '跨服同步'],
          ] as const).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={fields[key]} onChange={(e) => handleFieldChange(key, e.target.checked)}
                className="w-4 h-4 rounded accent-emerald-500" />
              <span className="text-sm" style={{ color: '#94A3B8' }}>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* 游戏参数 */}
      <fieldset className="p-4 rounded-lg md:col-span-2" style={{ backgroundColor: '#1E293B', border: '1px solid #334155' }}>
        <legend className="text-xs font-medium px-1" style={{ color: '#64748B' }}>游戏参数</legend>
        <div className="grid grid-cols-2 gap-3">
          {(['Chatrate', 'Cycle', 'GSLT'] as const).map((key) => (
            <label key={key} className="block">
              <span className="text-xs" style={{ color: '#94A3B8' }}>{FIELD_LABELS[key]}</span>
              <Input value={String(fields[key])} onChange={(e) => handleFieldChange(key, e.target.value)}
                className="mt-1 h-8 text-sm" type={key === 'GSLT' ? 'password' : 'text'} />
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );

  const renderWorkshopForm = () => (
    <div className="space-y-3">
      {workshopIds.length === 0 ? (
        <div className="text-center py-8">
          <Package size={24} style={{ color: '#64748B' }} />
          <p className="text-sm mt-2" style={{ color: '#64748B' }}>暂无 Mod。前往 Mods 页面添加。</p>
        </div>
      ) : (
        <div className="space-y-2">
          {workshopIds.map((id, idx) => (
            <div key={id} className="flex items-center gap-3 p-2 rounded"
              style={{ backgroundColor: '#0F172A' }}>
              <span className="text-xs font-mono" style={{ color: '#64748B' }}>#{idx + 1}</span>
              <span className="text-sm flex-1 font-mono" style={{ color: '#F1F5FB' }}>{id}</span>
              <Button onClick={() => { setWorkshopIds((prev) => prev.filter((x) => x !== id)); setDirty(true); }}
                className="h-6 text-xs px-2" style={{ backgroundColor: 'transparent', color: '#EF4444' }}>
                移除
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold" style={{ color: '#F1F5FB' }}>Config</h1>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="flex items-center gap-1 text-xs" style={{ color: '#22C55E' }}>
              <Check size={14} /> 已保存
            </span>
          )}
          <Button onClick={handleSave} disabled={!dirty || saving}
            className="h-8 text-xs gap-1.5"
            style={{ backgroundColor: dirty ? '#22C55E' : '#1E293B', color: dirty ? '#fff' : '#64748B' }}>
            <Save size={14} /> {saving ? '保存中...' : '保存'}
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <TabBar
        tabs={[
          { key: 'commands', label: 'Commands.dat', icon: FileText },
          { key: 'txt', label: 'Config.txt', icon: Cpu },
          { key: 'workshop', label: 'Workshop', icon: Wrench },
        ]}
        active={tab}
        onChange={(k) => { setTab(k as ConfigTab); setDirty(false); }}
      />

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {tab === 'commands' && renderCommandsForm()}
        {tab === 'txt' && (
          <textarea value={configTxt} onChange={(e) => { setConfigTxt(e.target.value); setDirty(true); }}
            className="w-full h-64 p-4 rounded-lg text-sm font-mono resize-none"
            style={{ backgroundColor: '#0F172A', color: '#F1F5FB', border: '1px solid #334155' }}
            placeholder="粘贴 Config.txt 内容..." />
        )}
        {tab === 'workshop' && renderWorkshopForm()}
      </div>
    </div>
  );
}
