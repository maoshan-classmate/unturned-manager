import { useState, useCallback, useEffect } from 'react';
import { Save, AlertCircle, Loader2, Check, FileText, Wrench, Cpu, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { TabBar } from '../components/shared/TabBar.js';
import { ConfigSection } from '../components/shared/ConfigSection.js';
import { ConfigField } from '../components/shared/ConfigField.js';
import { ConfigToggle } from '../components/shared/ConfigToggle.js';
import { SearchInput } from '../components/shared/SearchInput.js';
import { DataTable, type DataTableColumn } from '../components/shared/DataTable.js';
import { ConfirmDialog } from '../components/shared/ConfirmDialog.js';
import { useServer } from '../hooks/useServer.js';
import { apiClient } from '../api/client.js';
import { Button } from '../components/ui/button.js';

type ConfigTab = 'commands' | 'txt' | 'workshop';

// ─── Commands.dat fields ───────────────────────────────

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

/** 空白初始值——不预设任何游戏默认值，全部从服务端文件读取 */
const EMPTY_FIELDS: CommandsFields = {
  Name: '', Port: '', MaxPlayers: '', Map: '', Mode: '',
  Owner: '', Perspective: '', Chatrate: '', Cycle: '',
  Timeout: '', Queue_Size: '', GSLT: '', Password: '',
  Cheats: false, Filter: false, Whitelisted: false, Gold: false,
  Hide_Admins: false, Sync: false,
};

// ─── Config.txt fields ─────────────────────────────────

interface ConfigTxtFields {
  Login_Token: string; 完整描述: string; 列表描述: string; 图标URL: string; 缩略图URL: string;
  VAC反作弊: boolean; BattlEye: boolean; 最大Ping: string; 定时关机: boolean; 更新自动关机: boolean;
  生成倍率: string; 物品耐久: boolean; 掉落消失: string; 重生时间: string;
  肩后视角: boolean; 自由建造: boolean; 玩家伤害: boolean; 允许自杀: boolean;
}

/** 空白初始值——全部从服务端 Config.txt 实际内容读取 */
const EMPTY_TXT: ConfigTxtFields = {
  Login_Token: '', 完整描述: '', 列表描述: '', 图标URL: '', 缩略图URL: '',
  VAC反作弊: false, BattlEye: false, 最大Ping: '', 定时关机: false, 更新自动关机: false,
  生成倍率: '', 物品耐久: false, 掉落消失: '', 重生时间: '',
  肩后视角: false, 自由建造: false, 玩家伤害: false, 允许自杀: false,
};

// ─── Workshop row ──────────────────────────────────────

interface WorkshopRow {
  fileId: string; name: string; status: 'enabled' | 'disabled' | 'downloading' | 'error'; selected: boolean;
}

const PAGE_SIZE = 10;

/** Config 页面——Figma 2:6 */
export function ConfigPage() {
  const { servers, loading: serverLoading, error: serverError } = useServer();
  const server = servers[0];

  const [tab, setTab] = useState<ConfigTab>('commands');
  const [fields, setFields] = useState<CommandsFields>(EMPTY_FIELDS);
  const [txtFields, setTxtFields] = useState<ConfigTxtFields>(EMPTY_TXT);
  const [workshopRows, setWorkshopRows] = useState<WorkshopRow[]>([]);
  const [workshopSearch, setWorkshopSearch] = useState('');
  const [workshopStatusFilter] = useState('全部状态');
  const [workshopPage, setWorkshopPage] = useState(1);

  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // v2.2：Workshop 应用变更（重启服务器）二次确认
  const [applyConfirmOpen, setApplyConfirmOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

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
            ...EMPTY_FIELDS,
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
          const b = raw.sections['浏览器'] ?? {}, s = raw.sections['服务器'] ?? {};
          const i = raw.sections['物品'] ?? {}, g = raw.sections['玩法开关'] ?? {};
          setTxtFields({
            ...EMPTY_TXT,
            Login_Token: b.Login_Token ?? '', 完整描述: b['完整描述'] ?? '', 列表描述: b['列表描述'] ?? '',
            图标URL: b['图标URL'] ?? '', 缩略图URL: b['缩略图URL'] ?? '',
            VAC反作弊: s['VAC反作弊'] !== undefined, BattlEye: s.BattlEye !== undefined, 最大Ping: s['最大Ping(ms)'] ?? '',
            定时关机: s['定时关机'] !== undefined, 更新自动关机: s['更新自动关机'] !== undefined,
            生成倍率: i['生成倍率'] ?? '', 物品耐久: i['物品耐久'] !== undefined, 掉落消失: i['掉落消失(s)'] ?? '', 重生时间: i['重生时间(s)'] ?? '',
            肩后视角: g['肩后视角'] !== undefined, 自由建造: g['自由建造'] !== undefined, 玩家伤害: g['玩家伤害'] !== undefined, 允许自杀: g['允许自杀'] !== undefined,
          });
        }
      } else {
        // v2.2：已下载 Mod 列表改走 /mods/downloaded（acf 扫描 + WebAPI 元数据合并）
        const res = await apiClient.get(`/servers/${server.id}/mods/downloaded`);
        const items: Array<{ fileId: string; title?: string; authorName?: string }> = res.data.data ?? [];
        setWorkshopRows(items.map((item) => ({
          fileId: item.fileId,
          name: item.title || item.fileId,
          status: 'enabled' as const,
          selected: false,
        })));
      }
      setDirty(false);
    } catch (err) { setConfigError(err instanceof Error ? err.message : '加载配置失败'); }
    finally { setConfigLoading(false); }
  }, [server, tab]);

  useEffect(() => { fetchConfig(); }, [server?.id, tab]);

  const handleSave = async () => {
    if (!server) return;
    // v2.2：Workshop 分支先弹二次确认（apply 会重启服务器），确认后才执行
    if (tab === 'workshop') {
      setApplyConfirmOpen(true);
      return;
    }
    setSaving(true); setConfigError(null);
    try {
      if (tab === 'commands') {
        const known = new Map<string, string>();
        for (const [key, val] of Object.entries(fields)) {
          if (['Cheats', 'Filter', 'Whitelisted', 'Gold', 'Hide_Admins', 'Sync'].includes(key)) {
            if (val) known.set(key, '');
          } else if (val) known.set(key, String(val));
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
      }
      setDirty(false); setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch (err) { setConfigError(err instanceof Error ? err.message : '保存配置失败'); }
    finally { setSaving(false); }
  };

  /** v2.2：确认后执行 Workshop apply（触发重启流水线） */
  const handleApplyConfirm = async () => {
    if (!server) return;
    setApplyConfirmOpen(false);
    setSaving(true); setConfigError(null);
    try {
      const fileIds = workshopRows.filter((r) => r.status !== 'disabled').map((r) => r.fileId);
      await apiClient.post(`/servers/${server.id}/mods/apply`, { fileIds });
      toast.success('Mod 变更已提交，服务器正在重启应用...');
      setDirty(false);
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : '应用变更失败');
      toast.error(err instanceof Error ? err.message : '应用变更失败');
    } finally {
      setSaving(false);
    }
  };

  /** v2.2：删除 Mod——先确认，确认后调 DELETE 端点（acf + content + File_IDs 同步删） */
  const handleDeleteConfirm = async () => {
    if (!server || !deleteConfirm) return;
    const fileId = deleteConfirm;
    setDeleteConfirm(null);
    try {
      await apiClient.delete(`/servers/${server.id}/mods/${fileId}`);
      setWorkshopRows((prev) => prev.filter((r) => r.fileId !== fileId));
      toast.success('Mod 已删除');
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : '删除 Mod 失败');
      toast.error(err instanceof Error ? err.message : '删除 Mod 失败');
    }
  };

  const handleFieldChange = (key: keyof CommandsFields, value: string | boolean) => { setFields((prev) => ({ ...prev, [key]: value })); setDirty(true); };
  const handleTxtChange = (key: keyof ConfigTxtFields, value: string | boolean) => { setTxtFields((prev) => ({ ...prev, [key]: value })); setDirty(true); };

  const toggleWsSelect = (fileId: string) => setWorkshopRows((prev) => prev.map((r) => (r.fileId === fileId ? { ...r, selected: !r.selected } : r)));
  const toggleWsStatus = (fileId: string) => {
    setWorkshopRows((prev) => { setDirty(true); return prev.map((r) => (r.fileId === fileId ? { ...r, status: r.status === 'enabled' ? 'disabled' as const : 'enabled' as const } : r)); });
  };
  const removeWs = (fileId: string) => { setDeleteConfirm(fileId); };

  const filteredWorkshop = workshopRows.filter((r) => {
    const m = r.name.toLowerCase().includes(workshopSearch.toLowerCase()) || r.fileId.includes(workshopSearch);
    const s = workshopStatusFilter === '全部状态' || (workshopStatusFilter === '已启用' && r.status === 'enabled') || (workshopStatusFilter === '未启用' && r.status === 'disabled') || (workshopStatusFilter === '下载中' && r.status === 'downloading');
    return m && s;
  });
  const wsPaged = filteredWorkshop.slice((workshopPage - 1) * PAGE_SIZE, workshopPage * PAGE_SIZE);

  // ── Loading / Error ──
  if (serverLoading || configLoading) return <Centered><Loader2 className="h-8 w-8 animate-spin text-emerald-500" /><span className="text-sm text-slate-400">加载中...</span></Centered>;
  if (serverError || configError) return <Centered><AlertCircle size={32} className="text-red-500" /><span className="text-sm text-slate-100">无法加载配置</span><span className="text-xs text-slate-500">{serverError || configError}</span><Button onClick={fetchConfig} variant="ghost" size="sm" className="text-slate-400">重试</Button></Centered>;
  // 无服务器时仍然渲染完整页面骨架，仅禁用保存

  return (
    <div className="flex flex-col h-full">
      {/* Header + TabBar */}
      <div className="shrink-0 px-4 md:px-6 pt-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-1">
          <h1 className="text-[15px] font-semibold text-slate-100">服务器配置</h1>
          <div className="flex items-center gap-2">
            {saved && <span className="flex items-center gap-1 text-xs text-emerald-500"><Check size={14} /> 已保存</span>}
            <Button onClick={handleSave} disabled={!dirty || saving || !server} size="sm" className={`h-8 text-xs gap-1.5 ${dirty ? 'bg-emerald-500 text-white' : 'bg-slate-800 text-slate-500'}`}>
              <Save size={14} /> {saving ? '保存中...' : '保存配置'}
            </Button>
          </div>
        </div>
        <TabBar tabs={[
          { key: 'commands', label: 'Commands.dat', icon: FileText },
          { key: 'txt', label: 'Config.txt', icon: Cpu },
          { key: 'workshop', label: 'Workshop', icon: Wrench },
        ]} active={tab} onChange={(k) => { setTab(k as ConfigTab); setDirty(false); }} />
      </div>

      {/* Content: 左侧主表 + 右侧 Tips Panel（小屏隐藏 Tips） */}
      <div className="flex-1 overflow-hidden flex flex-col lg:flex-row gap-4 p-4 md:p-6 pt-4">
        {/* Main */}
        <div className="flex-1 overflow-auto rounded-lg border border-slate-700 bg-slate-950 min-w-0">
          {tab === 'commands' && <CommandsTab fields={fields} onChange={handleFieldChange} />}
          {tab === 'txt' && <ConfigTxtTab fields={txtFields} onChange={handleTxtChange} />}
          {tab === 'workshop' && (
            <WorkshopTab
              rows={filteredWorkshop} paged={wsPaged}
              search={workshopSearch} onSearch={setWorkshopSearch}
              statusFilter={workshopStatusFilter}
              page={workshopPage} onPage={setWorkshopPage}
              onToggleSelect={toggleWsSelect} onToggleStatus={toggleWsStatus} onRemove={removeWs}
            />
          )}
        </div>
        {/* Tips Panel — 小屏隐藏 */}
        <div className="hidden lg:block shrink-0 rounded-lg p-5 border border-slate-700 bg-slate-800 self-start" style={{ width: 292 }}>
          <h3 className="text-sm font-semibold text-slate-100 mb-3">💡 配置提示</h3>
          <div className="space-y-3 text-xs text-slate-400 leading-relaxed">
            <p>修改配置后需点击「保存配置」才会生效。</p>
            <p>部分参数（端口、地图）需重启服务器才能应用。</p>
            <p>GSLT 令牌在 steamcommunity.com/dev/managegameservers 申请，AppID 为 304930。</p>
            <p>未知命令行参数会被保留，不会被面板删除。</p>
          </div>
        </div>
      </div>

      {/* v2.2：Workshop 应用变更确认（会重启服务器） */}
      <ConfirmDialog
        open={applyConfirmOpen}
        title="应用 Mod 变更"
        message="将保存 Mod 列表并重启服务器（RCON Save → 优雅关服 → 应用 Mod → 重启）。确认继续？"
        confirmLabel="确认重启"
        variant="default"
        icon={RefreshCw}
        loading={saving}
        onConfirm={handleApplyConfirm}
        onCancel={() => setApplyConfirmOpen(false)}
      />

      {/* v2.2：删除 Mod 确认（acf + content + File_IDs 同步删） */}
      <ConfirmDialog
        open={!!deleteConfirm}
        title="删除 Mod"
        message={`确定删除 Mod ${deleteConfirm}？将同时移除下载内容与启用列表。`}
        confirmLabel="删除"
        variant="danger"
        icon={AlertCircle}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteConfirm(null)}
      />
    </div>
  );
}

// ── Centered state ──
function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-center h-full"><div className="flex flex-col items-center gap-3">{children}</div></div>;
}

// ── Commands.dat tab ──
function CommandsTab({ fields, onChange }: { fields: CommandsFields; onChange: (k: keyof CommandsFields, v: string | boolean) => void }) {
  return (
    <div className="p-4 md:p-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ConfigSection title="身份">
          {(['Name', 'Owner', 'Password'] as const).map((k) => <ConfigField key={k} label={FIELD_LABELS[k]} value={String(fields[k])} onChange={(v) => onChange(k, v)} type={k === 'Password' ? 'password' : 'text'} />)}
        </ConfigSection>
        <ConfigSection title="地图与模式">
          {(['Map', 'Mode', 'Perspective'] as const).map((k) => <ConfigField key={k} label={FIELD_LABELS[k]} value={String(fields[k])} onChange={(v) => onChange(k, v)} />)}
        </ConfigSection>
        <ConfigSection title="网络">
          {(['Port', 'MaxPlayers', 'Timeout', 'Queue_Size'] as const).map((k) => <ConfigField key={k} label={FIELD_LABELS[k]} value={String(fields[k])} onChange={(v) => onChange(k, v)} />)}
        </ConfigSection>
        <ConfigSection title="安全与权限">
          {(['Whitelisted', 'Gold', 'Hide_Admins', 'Cheats', 'Filter', 'Sync'] as const).map((k) => <ConfigToggle key={k} label={FIELD_LABELS[k]} checked={fields[k]} onChange={(v) => onChange(k, v)} />)}
        </ConfigSection>
        <div className="md:col-span-2">
          <ConfigSection title="游戏参数">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(['Chatrate', 'Cycle', 'GSLT'] as const).map((k) => <ConfigField key={k} label={FIELD_LABELS[k]} value={String(fields[k])} onChange={(v) => onChange(k, v)} type={k === 'GSLT' ? 'password' : 'text'} />)}
            </div>
          </ConfigSection>
        </div>
      </div>
    </div>
  );
}

// ── Config.txt tab ──
function ConfigTxtTab({ fields, onChange }: { fields: ConfigTxtFields; onChange: (k: keyof ConfigTxtFields, v: string | boolean) => void }) {
  return (
    <div className="p-4 md:p-6 space-y-6">
      <TxtSection title="浏览器" fields={[
        ['Login_Token', 'Login Token', 'text'], ['完整描述', '完整描述', 'text'], ['列表描述', '列表描述', 'text'], ['图标URL', '图标URL', 'text'], ['缩略图URL', '缩略图URL', 'text'],
      ] as const} txtFields={fields} onChange={onChange} />
      <TxtSection title="服务器" fields={[
        ['VAC反作弊', 'VAC反作弊', 'toggle'], ['BattlEye', 'BattlEye', 'toggle'], ['最大Ping', '最大Ping(ms)', 'text'],
        ['定时关机', '定时关机', 'toggle'], ['更新自动关机', '更新自动关机', 'toggle'],
      ] as const} txtFields={fields} onChange={onChange} />
      <TxtSection title="物品" fields={[
        ['生成倍率', '生成倍率', 'text'], ['物品耐久', '物品耐久', 'toggle'], ['掉落消失', '掉落消失(s)', 'text'], ['重生时间', '重生时间(s)', 'text'],
      ] as const} txtFields={fields} onChange={onChange} />
      <TxtSection title="玩法开关" fields={[
        ['肩后视角', '肩后视角', 'toggle'], ['自由建造', '自由建造', 'toggle'], ['玩家伤害', '玩家伤害', 'toggle'], ['允许自杀', '允许自杀', 'toggle'],
      ] as const} txtFields={fields} onChange={onChange} />
    </div>
  );
}

function TxtSection({ title, fields: fieldDefs, txtFields, onChange }: {
  title: string;
  fields: readonly (readonly [keyof ConfigTxtFields, string, 'text' | 'toggle'])[];
  txtFields: ConfigTxtFields;
  onChange: (k: keyof ConfigTxtFields, v: string | boolean) => void;
}) {
  return (
    <ConfigSection title={title}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
        {fieldDefs.map(([k, label, type]) =>
          type === 'toggle' ? <ConfigToggle key={k} label={label} checked={!!txtFields[k]} onChange={(v) => onChange(k, v)} /> : <ConfigField key={k} label={label} value={String(txtFields[k] ?? '')} onChange={(v) => onChange(k, v)} />
        )}
      </div>
    </ConfigSection>
  );
}

// ── Workshop tab ──

const WS_COLUMNS: DataTableColumn[] = [
  { key: 'name', label: 'Mod名称' },
  { key: 'fileId', label: 'Workshop ID' },
  { key: 'status', label: '状态' },
  { key: 'actions', label: '操作' },
];

function WorkshopTab({ rows, paged, search, onSearch, statusFilter, page, onPage, onToggleSelect, onToggleStatus, onRemove }: {
  rows: WorkshopRow[]; paged: WorkshopRow[]; search: string; onSearch: (v: string) => void;
  statusFilter: string; page: number; onPage: (p: number) => void;
  onToggleSelect: (id: string) => void; onToggleStatus: (id: string) => void; onRemove: (id: string) => void;
}) {
  const rowData = paged.map((r) => ({
    _key: r.fileId,
    name: (
      <div className="flex items-center gap-2">
        <input type="checkbox" checked={r.selected} onChange={() => onToggleSelect(r.fileId)} className="w-4 h-4 rounded accent-emerald-500" />
        <span className="text-slate-200 truncate">{r.name}</span>
      </div>
    ),
    fileId: <span className="font-mono text-xs text-slate-400">{r.fileId}</span>,
    status: <StatusBadge status={r.status} />,
    actions: (
      <div className="flex items-center gap-2">
        <button onClick={() => onToggleStatus(r.fileId)} className={`px-2.5 py-0.5 rounded text-[11px] text-white ${r.status === 'enabled' ? 'bg-red-500' : 'bg-emerald-500'}`}>
          {r.status === 'enabled' ? '禁用' : '启用'}
        </button>
        <button onClick={() => onRemove(r.fileId)} className="px-2.5 py-0.5 rounded text-[11px] bg-red-500 text-black">移除</button>
      </div>
    ),
  }));

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <div className="shrink-0 p-4 pb-2 flex flex-wrap items-center gap-3">
        <SearchInput value={search} onChange={onSearch} placeholder="筛选Mod..." width={200} />
        <div className="flex items-center rounded-md px-3 h-9 text-sm text-slate-400 border border-slate-700 bg-slate-950" style={{ width: 120 }}>{statusFilter}</div>
        <div className="flex-1" />
        <Button size="sm" className="h-9 text-xs gap-1 bg-emerald-500 text-white">一键更新</Button>
        <Button size="sm" variant="outline" className="h-9 text-xs gap-1">批量更新</Button>
      </div>
      <div className="shrink-0 mx-4 border-t border-slate-800" />
      <div className="flex flex-col flex-1 px-4">
        <DataTable columns={WS_COLUMNS} data={rowData} keyField="_key" emptyText="暂无 Workshop Mod"
          pagination={{ page, pageSize: PAGE_SIZE, total: rows.length, onPageChange: onPage }} />
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: WorkshopRow['status'] }) {
  const map: Record<WorkshopRow['status'], string> = { enabled: 'bg-emerald-500', disabled: 'bg-slate-500', downloading: 'bg-amber-500', error: 'bg-slate-500' };
  const text: Record<WorkshopRow['status'], string> = { enabled: '已启用', disabled: '未启用', downloading: '下载中', error: '未启用' };
  return <span className={`inline-flex px-2.5 py-0.5 rounded text-[10px] font-medium text-white ${map[status]}`}>{text[status]}</span>;
}
