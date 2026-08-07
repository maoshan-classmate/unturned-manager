import { useState, useCallback, useEffect } from 'react';
import { Save, AlertCircle, Loader2, Check, FileText, Package, Wrench, Cpu, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { TabBar } from '../components/shared/TabBar.js';
import { useServer } from '../hooks/useServer.js';
import { apiClient } from '../api/client.js';
import { Button } from '../components/ui/button.js';
import { Input } from '../components/ui/input.js';

type ConfigTab = 'commands' | 'txt' | 'workshop';

// ─── Commands.dat ──────────────────────────────────────

interface CommandsFields {
  Name: string; Port: string; MaxPlayers: string; Map: string; Mode: string;
  Owner: string; Perspective: string; Chatrate: string; Cycle: string;
  Timeout: string; Queue_Size: string; GSLT: string; Password: string;
  Cheats: boolean; Filter: boolean; Whitelisted: boolean; Gold: boolean;
  Hide_Admins: boolean; Sync: boolean;
}

const FIELD_LABELS: Record<keyof CommandsFields, string> = {
  Name: '服务器名称', Port: '端口', MaxPlayers: '最大玩家数', Map: '地图',
  Mode: '难度', Owner: '服主 SteamID64', Perspective: '视角限制',
  Chatrate: '聊天冷却(秒)', Cycle: '昼夜循环(秒)', Timeout: 'Ping 超时(ms)',
  Queue_Size: '排队上限', GSLT: '游戏服务器登录令牌', Password: '服务器密码',
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

// ─── Config.txt ────────────────────────────────────────

interface ConfigTxtFields {
  // 浏览器
  Login_Token: string; 完整描述: string; 列表描述: string; 图标URL: string; 缩略图URL: string;
  // 服务器
  VAC反作弊: boolean; BattlEye: boolean; 最大Ping: string; 定时关机: boolean; 更新自动关机: boolean;
  // 物品
  生成倍率: string; 物品耐久: boolean; 掉落消失: string; 重生时间: string;
  // 玩法开关
  肩后视角: boolean; 自由建造: boolean; 玩家伤害: boolean; 允许自杀: boolean;
}

const DEFAULT_TXT: ConfigTxtFields = {
  Login_Token: '', 完整描述: '', 列表描述: '', 图标URL: '', 缩略图URL: '',
  VAC反作弊: false, BattlEye: false, 最大Ping: '750', 定时关机: false, 更新自动关机: false,
  生成倍率: '', 物品耐久: false, 掉落消失: '', 重生时间: '',
  肩后视角: false, 自由建造: false, 玩家伤害: false, 允许自杀: false,
};

// ─── Workshop ──────────────────────────────────────────

interface WorkshopRow {
  fileId: string; name: string; status: 'enabled' | 'disabled' | 'downloading' | 'error'; selected: boolean;
}

/** Config 页面——Figma 2:6 🎨 Config。
 *  多 Tab：Commands.dat / Config.txt / Workshop
 *  左侧主表 796px + 右侧 Tips Panel 292px */
export function ConfigPage() {
  const { servers, loading: serverLoading, error: serverError } = useServer();
  const server = servers[0];

  const [tab, setTab] = useState<ConfigTab>('commands');
  // Commands
  const [fields, setFields] = useState<CommandsFields>(DEFAULT_FIELDS);
  // Config.txt
  const [txtFields, setTxtFields] = useState<ConfigTxtFields>(DEFAULT_TXT);
  // Workshop
  const [workshopRows, setWorkshopRows] = useState<WorkshopRow[]>([]);
  const [workshopSearch, setWorkshopSearch] = useState('');
  const [workshopStatusFilter, setWorkshopStatusFilter] = useState('全部状态');
  const [workshopPage, setWorkshopPage] = useState(0);

  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const fetchConfig = useCallback(async () => {
    if (!server) return;
    setConfigLoading(true); setConfigError(null);
    try {
      if (tab === 'commands') {
        const res = await apiClient.get(`/servers/${server.id}/config/commands`);
        const data = res.data.data;
        if (data) {
          const known = data.known ?? {};
          setFields({
            ...DEFAULT_FIELDS,
            ...Object.fromEntries(Object.entries(known).map(([k, v]) => [k, String(v)])),
            Cheats: known.Cheats !== undefined, Filter: known.Filter !== undefined,
            Whitelisted: known.Whitelisted !== undefined, Gold: known.Gold !== undefined,
            Hide_Admins: known.Hide_Admins !== undefined, Sync: known.Sync !== undefined,
          });
        }
      } else if (tab === 'txt') {
        const res = await apiClient.get(`/servers/${server.id}/config/txt`);
        const raw = res.data.data;
        if (raw?.sections) {
          const browser = raw.sections['浏览器'] ?? {};
          const sv = raw.sections['服务器'] ?? {};
          const item = raw.sections['物品'] ?? {};
          const gameplay = raw.sections['玩法开关'] ?? {};
          setTxtFields({
            ...DEFAULT_TXT,
            Login_Token: browser.Login_Token ?? '', 完整描述: browser['完整描述'] ?? '', 列表描述: browser['列表描述'] ?? '',
            图标URL: browser['图标URL'] ?? '', 缩略图URL: browser['缩略图URL'] ?? '',
            VAC反作弊: sv['VAC反作弊'] !== undefined, BattlEye: sv.BattlEye !== undefined, 最大Ping: sv['最大Ping(ms)'] ?? '750',
            定时关机: sv['定时关机'] !== undefined, 更新自动关机: sv['更新自动关机'] !== undefined,
            生成倍率: item['生成倍率'] ?? '', 物品耐久: item['物品耐久'] !== undefined, 掉落消失: item['掉落消失(s)'] ?? '', 重生时间: item['重生时间(s)'] ?? '',
            肩后视角: gameplay['肩后视角'] !== undefined, 自由建造: gameplay['自由建造'] !== undefined, 玩家伤害: gameplay['玩家伤害'] !== undefined, 允许自杀: gameplay['允许自杀'] !== undefined,
          });
        }
      } else {
        const res = await apiClient.get(`/servers/${server.id}/config/workshop`);
        const ids: string[] = res.data.data?.File_IDs ?? [];
        setWorkshopRows(ids.map(id => ({ fileId: id, name: id, status: 'enabled' as const, selected: false })));
      }
      setDirty(false);
    } catch (err) { setConfigError(err instanceof Error ? err.message : '加载配置失败'); }
    finally { setConfigLoading(false); }
  }, [server, tab]);

  useEffect(() => { fetchConfig(); }, [server?.id, tab]);

  const handleSave = async () => {
    if (!server) return;
    setSaving(true); setConfigError(null);
    try {
      if (tab === 'commands') {
        const known = new Map<string, string>();
        for (const [key, val] of Object.entries(fields)) {
          if (['Cheats', 'Filter', 'Whitelisted', 'Gold', 'Hide_Admins', 'Sync'].includes(key)) {
            if (val) known.set(key, '');
          } else if (val) { known.set(key, String(val)); }
        }
        await apiClient.put(`/servers/${server.id}/config/commands`, { known, unknown: {}, comments: [] });
      } else if (tab === 'txt') {
        await apiClient.put(`/servers/${server.id}/config/txt`, {
          sections: {
            '浏览器': { Login_Token: txtFields.Login_Token, '完整描述': txtFields.完整描述, '列表描述': txtFields.列表描述, '图标URL': txtFields.图标URL, '缩略图URL': txtFields.缩略图URL },
            '服务器': { 'VAC反作弊': txtFields.VAC反作弊, BattlEye: txtFields.BattlEye, '最大Ping(ms)': txtFields.最大Ping, '定时关机': txtFields.定时关机, '更新自动关机': txtFields.更新自动关机 },
            '物品': { '生成倍率': txtFields.生成倍率, '物品耐久': txtFields.物品耐久, '掉落消失(s)': txtFields.掉落消失, '重生时间(s)': txtFields.重生时间 },
            '玩法开关': { '肩后视角': txtFields.肩后视角, '自由建造': txtFields.自由建造, '玩家伤害': txtFields.玩家伤害, '允许自杀': txtFields.允许自杀 },
          },
        });
      } else {
        await apiClient.put(`/servers/${server.id}/config/workshop`, { fileIds: workshopRows.filter(r => r.status !== 'disabled').map(r => r.fileId) });
      }
      setDirty(false); setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch (err) { setConfigError(err instanceof Error ? err.message : '保存配置失败'); }
    finally { setSaving(false); }
  };

  const handleFieldChange = (key: keyof CommandsFields, value: string | boolean) => { setFields(prev => ({ ...prev, [key]: value })); setDirty(true); };
  const handleTxtChange = (key: keyof ConfigTxtFields, value: string | boolean) => { setTxtFields(prev => ({ ...prev, [key]: value })); setDirty(true); };

  const toggleWsSelect = (fileId: string) => {
    setWorkshopRows(prev => prev.map(r => r.fileId === fileId ? { ...r, selected: !r.selected } : r));
  };
  const toggleWsStatus = (fileId: string) => {
    setWorkshopRows(prev => { setDirty(true); return prev.map(r => r.fileId === fileId ? { ...r, status: r.status === 'enabled' ? 'disabled' : 'enabled' as const } : r); });
  };
  const removeWs = (fileId: string) => {
    setWorkshopRows(prev => { setDirty(true); return prev.filter(r => r.fileId !== fileId); });
  };

  const filteredWorkshop = workshopRows.filter(r => {
    const m = r.name.toLowerCase().includes(workshopSearch.toLowerCase()) || r.fileId.includes(workshopSearch);
    const s = workshopStatusFilter === '全部状态' || (workshopStatusFilter === '已启用' && r.status === 'enabled') || (workshopStatusFilter === '未启用' && r.status === 'disabled') || (workshopStatusFilter === '下载中' && r.status === 'downloading');
    return m && s;
  });
  const PAGE_SIZE = 10;
  const wsTotalPages = Math.max(1, Math.ceil(filteredWorkshop.length / PAGE_SIZE));
  const wsPaged = filteredWorkshop.slice(workshopPage * PAGE_SIZE, (workshopPage + 1) * PAGE_SIZE);

  const statusBadge = (s: WorkshopRow['status']) => {
    const map = { enabled: { bg: '#22C55E', text: '已启用' }, disabled: { bg: '#64748B', text: '未启用' }, downloading: { bg: '#EA960C', text: '下载中' }, error: { bg: '#64748B', text: '未启用' } };
    const v = map[s];
    return <span className="inline-flex px-2.5 py-0.5 rounded text-[10px] font-medium text-white" style={{ backgroundColor: v.bg }}>{v.text}</span>;
  };

  // ── Loading / Error / Empty ──
  if (serverLoading || configLoading) {
    return <div className="flex items-center justify-center h-full"><div className="flex flex-col items-center gap-3"><Loader2 className="h-8 w-8 animate-spin" style={{ color: '#22C55E' }} /><span className="text-sm" style={{ color: '#94A3B8' }}>加载中...</span></div></div>;
  }
  if (serverError || configError) {
    return <div className="flex items-center justify-center h-full"><div className="flex flex-col items-center gap-3 max-w-md text-center"><AlertCircle size={32} style={{ color: '#EF4444' }} /><span className="text-sm" style={{ color: '#F1F5FB' }}>无法加载配置</span><span className="text-xs" style={{ color: '#64748B' }}>{serverError || configError}</span><Button onClick={fetchConfig} className="h-8 text-xs" style={{ backgroundColor: '#1E293B', color: '#94A3B8' }}>重试</Button></div></div>;
  }
  if (!server) {
    return <div className="flex items-center justify-center h-full"><div className="flex flex-col items-center gap-3"><Package size={32} style={{ color: '#64748B' }} /><span className="text-sm" style={{ color: '#64748B' }}>还没有服务器</span></div></div>;
  }

  return (
    <div className="flex flex-col h-full gap-0">
      {/* Header + Tab Bar */}
      <div className="shrink-0" style={{ padding: '24px 24px 0' }}>
        <div className="flex items-center justify-between mb-1" style={{ height: 40 }}>
          <h1 className="text-[15px] font-semibold" style={{ color: '#F1F5FB' }}>服务器配置</h1>
          <div className="flex items-center gap-2">
            {saved && <span className="flex items-center gap-1 text-xs" style={{ color: '#22C55E' }}><Check size={14} /> 已保存</span>}
            <Button onClick={handleSave} disabled={!dirty || saving} className="h-8 text-xs gap-1.5" style={{ backgroundColor: dirty ? '#22C55E' : '#1E293B', color: dirty ? '#fff' : '#64748B' }}>
              <Save size={14} /> {saving ? '保存中...' : '保存配置'}
            </Button>
          </div>
        </div>
        <TabBar
          tabs={[
            { key: 'commands', label: 'Commands.dat', icon: FileText },
            { key: 'txt', label: 'Config.txt', icon: Cpu },
            { key: 'workshop', label: 'Workshop', icon: Wrench },
          ]}
          active={tab}
          onChange={(k) => { setTab(k as ConfigTab); setDirty(false); }}
        />
      </div>

      {/* Content: left table + right tips panel */}
      <div className="flex-1 overflow-hidden flex gap-6" style={{ padding: '16px 24px 24px' }}>
        {/* Left: Main Table */}
        <div className="flex-1 overflow-auto rounded-lg" style={{ maxWidth: 796, backgroundColor: '#0F172A', border: '1px solid #334059' }}>
          {tab === 'commands' && renderCommands()}
          {tab === 'txt' && renderConfigTxt()}
          {tab === 'workshop' && renderWorkshop()}
        </div>

        {/* Right: Tips Panel — Figma */}
        <div className="shrink-0 rounded-lg p-5" style={{ width: 292, backgroundColor: '#1E293B', border: '1px solid #334059', alignSelf: 'flex-start' }}>
          <h3 className="text-sm font-semibold mb-3" style={{ color: '#F1F8FB' }}>💡 配置提示</h3>
          <div className="space-y-3 text-xs" style={{ color: '#94A3B8', lineHeight: 1.6 }}>
            <p>修改配置后需要点击右下角「保存配置」才会生效。</p>
            <p>部分参数（如端口、地图）需要重启服务器才能应用。</p>
            <p>GSLT 令牌在 steamcommunity.com/dev/managegameservers 申请，AppID 为 304930。</p>
            <p>未知的命令行参数会被保留而不会被面板删除。</p>
          </div>
        </div>
      </div>
    </div>
  );

  // ── Commands.dat ──
  function renderCommands() {
    return (
      <div className="p-6">
        <div className="grid grid-cols-2 gap-4">
          <Section title="身份">
            {(['Name', 'Owner', 'Password'] as const).map(k => <Field key={k} label={FIELD_LABELS[k]} value={String(fields[k])} onChange={v => handleFieldChange(k, v)} type={k === 'Password' ? 'password' : 'text'} />)}
          </Section>
          <Section title="地图与模式">
            {(['Map', 'Mode', 'Perspective'] as const).map(k => <Field key={k} label={FIELD_LABELS[k]} value={String(fields[k])} onChange={v => handleFieldChange(k, v)} />)}
          </Section>
          <Section title="网络">
            {(['Port', 'MaxPlayers', 'Timeout', 'Queue_Size'] as const).map(k => <Field key={k} label={FIELD_LABELS[k]} value={String(fields[k])} onChange={v => handleFieldChange(k, v)} />)}
          </Section>
          <Section title="安全与权限">
            {(['Whitelisted', 'Gold', 'Hide_Admins', 'Cheats', 'Filter', 'Sync'] as const).map(k => <Toggle key={k} label={FIELD_LABELS[k]} checked={fields[k]} onChange={v => handleFieldChange(k, v)} />)}
          </Section>
          <div className="col-span-2">
            <Section title="游戏参数">
              <div className="grid grid-cols-2 gap-3">
                {(['Chatrate', 'Cycle', 'GSLT'] as const).map(k => <Field key={k} label={FIELD_LABELS[k]} value={String(fields[k])} onChange={v => handleFieldChange(k, v)} type={k === 'GSLT' ? 'password' : 'text'} />)}
              </div>
            </Section>
          </div>
        </div>
      </div>
    );
  }

  // ── Config.txt ──
  function renderConfigTxt() {
    return (
      <div className="p-6 space-y-6">
        {/* 浏览器 */}
        <div>
          <h3 className="text-[15px] font-semibold mb-3" style={{ color: '#64748B' }}>浏览器</h3>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            <Field label="Login Token" value={txtFields.Login_Token} onChange={v => handleTxtChange('Login_Token', v)} />
            <Field label="完整描述" value={txtFields.完整描述} onChange={v => handleTxtChange('完整描述', v)} />
            <Field label="列表描述" value={txtFields.列表描述} onChange={v => handleTxtChange('列表描述', v)} />
            <Field label="图标URL" value={txtFields.图标URL} onChange={v => handleTxtChange('图标URL', v)} />
            <Field label="缩略图URL" value={txtFields.缩略图URL} onChange={v => handleTxtChange('缩略图URL', v)} />
          </div>
        </div>
        {/* 服务器 */}
        <div>
          <h3 className="text-[15px] font-semibold mb-3" style={{ color: '#64748B' }}>服务器</h3>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            <Toggle label="VAC反作弊" checked={txtFields.VAC反作弊} onChange={v => handleTxtChange('VAC反作弊', v)} />
            <Toggle label="BattlEye" checked={txtFields.BattlEye} onChange={v => handleTxtChange('BattlEye', v)} />
            <Field label="最大Ping(ms)" value={txtFields.最大Ping} onChange={v => handleTxtChange('最大Ping', v)} />
            <Toggle label="定时关机" checked={txtFields.定时关机} onChange={v => handleTxtChange('定时关机', v)} />
            <Toggle label="更新自动关机" checked={txtFields.更新自动关机} onChange={v => handleTxtChange('更新自动关机', v)} />
          </div>
        </div>
        {/* 物品 */}
        <div>
          <h3 className="text-[15px] font-semibold mb-3" style={{ color: '#64748B' }}>物品</h3>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            <Field label="生成倍率" value={txtFields.生成倍率} onChange={v => handleTxtChange('生成倍率', v)} />
            <Toggle label="物品耐久" checked={txtFields.物品耐久} onChange={v => handleTxtChange('物品耐久', v)} />
            <Field label="掉落消失(s)" value={txtFields.掉落消失} onChange={v => handleTxtChange('掉落消失', v)} />
            <Field label="重生时间(s)" value={txtFields.重生时间} onChange={v => handleTxtChange('重生时间', v)} />
          </div>
        </div>
        {/* 玩法开关 */}
        <div>
          <h3 className="text-[15px] font-semibold mb-3" style={{ color: '#64748B' }}>玩法开关</h3>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            <Toggle label="肩后视角" checked={txtFields.肩后视角} onChange={v => handleTxtChange('肩后视角', v)} />
            <Toggle label="自由建造" checked={txtFields.自由建造} onChange={v => handleTxtChange('自由建造', v)} />
            <Toggle label="玩家伤害" checked={txtFields.玩家伤害} onChange={v => handleTxtChange('玩家伤害', v)} />
            <Toggle label="允许自杀" checked={txtFields.允许自杀} onChange={v => handleTxtChange('允许自杀', v)} />
          </div>
        </div>
      </div>
    );
  }

  // ── Workshop ──
  function renderWorkshop() {
    return (
      <div className="flex flex-col h-full">
        {/* Filter bar inside Workshop tab */}
        <div className="shrink-0 p-4 pb-2 flex items-center gap-3">
          <div className="flex items-center rounded-md px-3" style={{ height: 36, width: 240, backgroundColor: '#0F172A', border: '1px solid #334059' }}>
            <Search size={14} style={{ color: '#64748B' }} />
            <input value={workshopSearch} onChange={e => setWorkshopSearch(e.target.value)} placeholder="筛选Mod..." className="bg-transparent border-none outline-none text-sm ml-2 w-full" style={{ color: '#94A3B8' }} />
          </div>
          <div className="flex items-center rounded-md px-3" style={{ height: 36, width: 140, backgroundColor: '#0F172A', border: '1px solid #334059' }}>
            <span className="text-sm" style={{ color: '#94A3B8' }}>{workshopStatusFilter}</span>
          </div>
          <div className="flex-1" />
          <Button className="h-9 text-xs gap-1" style={{ backgroundColor: '#22C55E', color: '#fff' }}>一键更新</Button>
          <Button className="h-9 text-xs gap-1" style={{ backgroundColor: 'transparent', color: '#94A3B8', border: '1px solid #334059' }}>批量更新</Button>
        </div>

        {/* Separator */}
        <div className="shrink-0 mx-4" style={{ height: 1, backgroundColor: '#1E293B' }} />

        {/* Table header */}
        <div className="shrink-0 flex items-center px-4 py-2 text-xs" style={{ color: '#64748B' }}>
          <span style={{ width: 24 }} />
          <span style={{ width: 200 }}>Mod名称</span>
          <span style={{ width: 180 }}>Workshop ID</span>
          <span style={{ width: 80 }}>状态</span>
          <span>操作</span>
        </div>

        {/* Table rows */}
        <div className="flex-1 overflow-auto px-4">
          {wsPaged.length === 0 ? (
            <div className="text-center py-8 text-xs" style={{ color: '#64748B' }}>暂无 Workshop Mod</div>
          ) : wsPaged.map(r => (
            <div key={r.fileId} className="flex items-center py-2.5 text-sm" style={{ borderTop: '1px solid #1E293B' }}>
              <input type="checkbox" checked={r.selected} onChange={() => toggleWsSelect(r.fileId)} className="w-4 h-4 rounded accent-emerald-500 mr-2" />
              <span style={{ width: 200, color: '#CBD5E1' }}>{r.name}</span>
              <span style={{ width: 180, color: '#94A3B8' }} className="text-xs font-mono">{r.fileId}</span>
              <span style={{ width: 80 }}>{statusBadge(r.status)}</span>
              <div className="flex items-center gap-2">
                <button onClick={() => toggleWsStatus(r.fileId)} className="px-2.5 py-0.5 rounded text-[11px] text-white" style={{ backgroundColor: r.status === 'enabled' ? '#EF4444' : '#22C55E' }}>{r.status === 'enabled' ? '禁用' : '启用'}</button>
                <button onClick={() => removeWs(r.fileId)} className="px-2.5 py-0.5 rounded text-[11px]" style={{ backgroundColor: '#EF4444', color: '#000' }}>移除</button>
              </div>
            </div>
          ))}
        </div>

        {/* Pagination */}
        <div className="shrink-0 flex items-center justify-between px-4 py-3 text-xs" style={{ color: '#64748B' }}>
          <span>共 {filteredWorkshop.length} 条</span>
          <div className="flex items-center gap-4" style={{ color: '#94A3B8' }}>
            <button onClick={() => setWorkshopPage(p => Math.max(0, p - 1))} disabled={workshopPage === 0} className="disabled:opacity-30">← 上一页</button>
            <span>第 {workshopPage + 1}/{wsTotalPages} 页</span>
            <button onClick={() => setWorkshopPage(p => Math.min(wsTotalPages - 1, p + 1))} disabled={workshopPage >= wsTotalPages - 1} className="disabled:opacity-30">下一页 →</button>
          </div>
        </div>
      </div>
    );
  }
}

// ── Reusable field components ──
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="p-4 rounded-lg" style={{ backgroundColor: '#1E293B', border: '1px solid #334155' }}>
      <legend className="text-xs font-medium px-1" style={{ color: '#64748B' }}>{title}</legend>
      <div className="space-y-3">{children}</div>
    </fieldset>
  );
}

function Field({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="block">
      <span className="text-xs" style={{ color: '#94A3B8' }}>{label}</span>
      <Input value={value} onChange={e => onChange(e.target.value)} className="mt-1 h-8 text-sm" type={type} />
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="w-4 h-4 rounded accent-emerald-500" />
      <span className="text-sm" style={{ color: '#94A3B8' }}>{label}</span>
    </label>
  );
}
