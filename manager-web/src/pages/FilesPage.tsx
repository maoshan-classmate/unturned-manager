import { useState, useCallback, useEffect, useRef } from 'react';
import {
  FolderOpen, File, Folder, Plus, Trash2, RefreshCw, Upload, Search,
  AlertCircle, Loader2, Key, Copy, Scissors, Download, Pencil, ExternalLink,
} from 'lucide-react';
import { useServer } from '../hooks/useServer.js';
import { apiClient } from '../api/client.js';
import { Button } from '../components/ui/button.js';
import { Input } from '../components/ui/input.js';

interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: string;
}

// ─── Figma 色值（来源：design-system-mapping.md + full design context）───
// Content bg:    #0F172A
// Card bg:       #1E293B
// Stroke:        #334059
// Text primary:  #F1F5FB
// Text secondary:#94A3B8
// Text muted:    #64748B
// Accent:        #22C55E
// Folder icon:   #3B82F6
// File icons:    #2563EB / #6366F1 / #F97316
// Delete:        #EF4444

/**
 * FileCard — Figma 21:19780, 208×125, bg=#1E293B, border=#334059, rounded-lg.
 */
function FileCardComp({
  entry,
  selected,
  onClick,
  onDoubleClick,
  onContextMenu,
}: {
  entry: FileEntry;
  selected: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const formatSize = (bytes: number) => {
    if (bytes <= 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (iso: string) => {
    try { return new Date(iso).toISOString().slice(0, 10); }
    catch { return iso.slice(0, 10); }
  };

  // Icon color per file type
  const getIconColor = () => {
    if (entry.isDirectory) return '#3B82F6'; // blue (Figma)
    const ext = entry.name.split('.').pop()?.toLowerCase();
    if (ext === 'zip' || ext === 'rar' || ext === '7z') return '#F97316'; // orange
    if (ext === 'sh' || ext === 'yaml' || ext === 'yml') return '#6366F1'; // indigo
    return '#2563EB'; // file blue
  };

  return (
    <div
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick(); }}
      onContextMenu={(e) => { e.stopPropagation(); onContextMenu(e); }}
      className="flex flex-col items-center rounded-lg transition-colors"
      style={{
        width: 208,
        height: 125,
        padding: '16px 0',
        gap: 6,
        cursor: 'pointer',
        backgroundColor: selected ? 'rgba(34,197,94,0.12)' : '#1E293B',
        border: selected ? '2px solid rgba(34,197,94,0.6)' : '1px solid #334059',
      }}
    >
      {entry.isDirectory ? (
        <Folder size={32} style={{ color: getIconColor() }} />
      ) : (
        <File size={32} style={{ color: getIconColor() }} />
      )}
      <span className="text-center px-2 truncate w-full" style={{ fontSize: 13, color: '#F1F5FB', maxWidth: 208 }}>
        {entry.name}
      </span>
      {!entry.isDirectory && entry.size > 0 && (
        <span style={{ fontSize: 11, color: '#64748B' }}>{formatSize(entry.size)}</span>
      )}
      <span style={{ fontSize: 10, color: '#64748B' }}>{formatDate(entry.modifiedAt)}</span>
    </div>
  );
}

/**
 * Files 页面——Figma 12:16326 🎨 Files v2。
 *
 * 1:1 复刻：TopBar + Toolbar + PathBar + FileGrid + StatusBar
 */
export function FilesPage() {
  const { servers } = useServer();
  const server = servers[0];

  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: FileEntry } | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<FileEntry | null>(null);

  const [showNewDialog, setShowNewDialog] = useState(false);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [showRename, setShowRename] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<FileEntry | null>(null);
  const [showPermissions, setShowPermissions] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<'folder' | 'file'>('folder');
  const [searchQuery, setSearchQuery] = useState('');
  const [uploadFileName, setUploadFileName] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [recursive, setRecursive] = useState(false);

  const [perms, setPerms] = useState({
    owner: { read: true, write: true, exec: false },
    group: { read: true, write: false, exec: false },
    other: { read: false, write: false, exec: false },
  });

  // ── Data ─────────────────────────────────────────────

  const fetchFiles = useCallback(async () => {
    if (!server) return;
    setLoading(true);
    setRefreshing(true);
    setError(null);
    try {
      const res = await apiClient.get(`/servers/${server.id}`, { params: { path: currentPath || '.' } });
      setEntries(res.data.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载文件失败');
    } finally {
      setLoading(false);
      setTimeout(() => setRefreshing(false), 600); // 保持旋转一小段时间让用户感知
    }
  }, [server?.id, currentPath]);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);

  // ── Actions ──────────────────────────────────────────

  const navigateTo = (entry: FileEntry) => {
    if (entry.isDirectory) { setCurrentPath(entry.path); setSelectedEntry(null); setContextMenu(null); }
  };

  const goToPath = (targetPath: string) => setCurrentPath(targetPath);
  const goUp = () => { const parts = currentPath.split('/').filter(Boolean); parts.pop(); setCurrentPath(parts.join('/')); };

  const handleCreateNew = async () => {
    if (!newName.trim() || !server) return;
    try {
      const entryPath = currentPath ? `${currentPath}/${newName.trim()}` : newName.trim();
      if (newType === 'folder') {
        await apiClient.post(`/servers/${server.id}/mkdir`, { path: entryPath });
      } else {
        await apiClient.post(`/servers/${server.id}/upload`, { path: entryPath, content: '' });
      }
      setNewName(''); setShowNewDialog(false); fetchFiles();
    } catch (err) { setError(err instanceof Error ? err.message : '创建失败'); }
  };

  const handleUpload = async () => {
    if (!uploadFile || !server) return;
    try {
      const name = uploadFileName.trim() || uploadFile.name;
      const entryPath = currentPath ? `${currentPath}/${name}` : name;

      // 读文件内容为 base64（小文件直接读，大文件后续 Sprint 用流式上传）
      const reader = new FileReader();
      const content: string = await new Promise((resolve, reject) => {
        reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
        reader.onerror = () => reject(new Error('读取文件失败'));
        reader.readAsDataURL(uploadFile);
      });

      await apiClient.post(`/servers/${server.id}/upload`, {
        path: entryPath,
        content: atob(content), // base64 decode → raw text for backend
      });
      setUploadFileName(''); setUploadFile(null); setShowUploadDialog(false); fetchFiles();
    } catch (err) { setError(err instanceof Error ? err.message : '上传失败'); }
  };

  const handleDeleteEntry = async (entry: FileEntry) => {
    setShowDeleteConfirm(entry);
  };

  const confirmDelete = async () => {
    const entry = showDeleteConfirm;
    if (!entry || !server) return;
    try {
      await apiClient.delete(`/servers/${server.id}`, { params: { path: entry.path } });
      setShowDeleteConfirm(null); setContextMenu(null); setSelectedEntry(null); fetchFiles();
    } catch (err) { setError(err instanceof Error ? err.message : '删除失败'); setShowDeleteConfirm(null); }
  };

  const handleRename = async () => {
    if (!newName.trim() || !selectedEntry || !server) return;
    try {
      await apiClient.put(`/servers/${server.id}/rename`, { path: selectedEntry.path, newName: newName.trim() });
      setShowRename(false); setNewName(''); setSelectedEntry(null); fetchFiles();
    } catch (err) { setError(err instanceof Error ? err.message : '重命名失败'); }
  };

  const handleReadFile = async (entry: FileEntry) => {
    if (!server || entry.isDirectory) return;
    try {
      const res = await apiClient.get(`/servers/${server.id}/content`, { params: { path: entry.path } });
      const content = typeof res.data.data === 'string' ? res.data.data : JSON.stringify(res.data.data);
      alert(content.slice(0, 2000));
    } catch (err) { setError(err instanceof Error ? err.message : '读取文件失败'); }
  };

  // ── Breadcrumbs ──────────────────────────────────────
  const breadcrumbs = currentPath ? currentPath.split('/').filter(Boolean) : [];

  // ── Filtered ─────────────────────────────────────────

  const filtered = searchQuery
    ? entries.filter((e) => e.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : entries;

  const formatTotalSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };
  const totalSize = filtered.reduce((sum, e) => sum + (e.isDirectory ? 0 : e.size), 0);

  // ── States ───────────────────────────────────────────

  if (loading && entries.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin" style={{ color: '#22C55E' }} />
          <span className="text-sm text-slate-400">加载中...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3 max-w-md text-center">
          <AlertCircle size={32} style={{ color: '#EF4444' }} />
          <span className="text-sm text-slate-100">无法加载文件</span>
          <span className="text-xs text-slate-500">{error}</span>
          <Button variant="ghost" onClick={fetchFiles}>重试</Button>
        </div>
      </div>
    );
  }

  if (!server) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <FolderOpen size={32} style={{ color: '#64748B' }} />
          <span className="text-sm text-slate-500">还没有服务器</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" onClick={() => { setContextMenu(null); setSelectedEntry(null); }}>
      {/* ── TopBar (Figma: h=56) ── */}
      <div className="flex items-center gap-3 shrink-0" style={{ height: 56, paddingTop: 4 }}>
        <FolderOpen size={28} style={{ color: '#3B82F6' }} />
        <h1 className="text-2xl font-semibold text-slate-100">文件管理器</h1>
      </div>

      {/* ── Toolbar (Figma: h=48, bg=#1E293B, stroke=#334059, rounded=8, gap) ── */}
      <div className="flex items-center gap-2 px-3 shrink-0 rounded-lg" style={{ height: 48, backgroundColor: '#1E293B', border: '1px solid #334059' }}>
     

        <div className="flex-1" />

        {/* Search (Figma: 200×32, bg=#0F172A, border=#334059) */}
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: '#64748B' }} />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索文件名..."
            className="pl-8 pr-3 h-8 text-xs rounded outline-none"
            style={{ width: 200, fontSize: 13, backgroundColor: '#0F172A', border: '1px solid #334059', color: '#F1F5FB' }}
          />
        </div>

        {/* 递归 checkbox (Figma: fs=11, color=#64748B) */}
        <label className="flex items-center gap-1 cursor-pointer select-none">
          <input type="checkbox" checked={recursive} onChange={(e) => setRecursive(e.target.checked)}
            className="w-3.5 h-3.5 rounded accent-emerald-500" />
          <span style={{ fontSize: 11, color: '#64748B' }}>递归</span>
        </label>

        {/* + 新建 — 弹窗选择文件/文件夹 */}
        <button onClick={() => { setNewType('folder'); setNewName(''); setShowNewDialog(true); }}
          className="flex items-center gap-1 rounded text-white transition-colors hover:bg-emerald-600"
          style={{ height: 32, padding: '0 12px', fontSize: 13, backgroundColor: '#22C55E', border: 'none', cursor: 'pointer' }}>
          <Plus size={14} /> 新建
        </button>

        {/* 上传 — 弹窗输入文件名+内容 */}
        <button onClick={() => { setUploadFileName(''); setUploadFile(null); setShowUploadDialog(true); }}
          className="flex items-center gap-1 rounded text-slate-400 transition-colors hover:bg-slate-700"
          style={{ height: 32, padding: '0 12px', fontSize: 13, backgroundColor: '#1E293B', border: '1px solid #334059', cursor: 'pointer' }}>
          <Upload size={14} /> 上传
        </button>

        {/* Refresh (Figma: 32×32, bg=#1E293B, border=#334059) */}
        <button onClick={(e) => { e.stopPropagation(); fetchFiles(); }}
          className="flex items-center justify-center rounded transition-colors hover:bg-slate-700"
          style={{ width: 32, height: 32, minWidth: 32, border: '1px solid #334059', backgroundColor: '#1E293B', cursor: 'pointer' }}>
          <RefreshCw
            size={16}
            style={{
              color: refreshing ? '#22C55E' : '#94A3B8',
              animation: refreshing ? 'spin 0.8s linear infinite' : 'none',
            }} />
        </button>

        {/* Delete (Figma: 32×32, bg=#1E293B, border=#334059, icon=#EF4444) */}
        <button onClick={(e) => { e.stopPropagation(); if (selectedEntry) handleDeleteEntry(selectedEntry); }}
          disabled={!selectedEntry}
          className="flex items-center justify-center rounded transition-colors hover:bg-slate-700 disabled:opacity-30"
          style={{ width: 32, height: 32, minWidth: 32, border: '1px solid #334059', backgroundColor: '#1E293B', cursor: selectedEntry ? 'pointer' : 'not-allowed' }}>
          <Trash2 size={14} style={{ color: selectedEntry ? '#EF4444' : '#64748B' }} />
        </button>
      </div>

      {/* ── Path Bar (Figma: h=36, bottom stroke=#334059) ── */}
      <div className="flex items-center px-3 shrink-0" style={{ height: 36, borderBottom: '1px solid #334059' }}>
        <span style={{ fontSize: 13, color: '#94A3B8' }}>
          <button onClick={() => goToPath('')} className="hover:text-emerald-400 transition-colors">/</button>
          <button onClick={() => goToPath('')} className="hover:text-emerald-400 transition-colors">opt</button>
          {' / '}
          <button onClick={() => goToPath('')} className="hover:text-emerald-400 transition-colors">unturned</button>
          {' / '}
          <button onClick={() => goToPath('')} className="hover:text-emerald-400 transition-colors">Servers</button>
          {' / '}
          <button onClick={() => goToPath('')} className="hover:text-emerald-400 transition-colors">MyServer</button>
          {breadcrumbs.map((crumb, i) => (
            <span key={i}>
              {' / '}
              <button onClick={() => goToPath(breadcrumbs.slice(0, i + 1).join('/'))} className="hover:text-emerald-400 transition-colors">
                {crumb}
              </button>
            </span>
          ))}
        </span>
      </div>

      {/* ── New Dialog (Figma-style: choose folder/file + name) ── */}
      {showNewDialog && (
        <DO onClose={() => setShowNewDialog(false)}>
          <div onClick={(e) => e.stopPropagation()} className="rounded-lg p-5" style={{ width: 380, backgroundColor: '#1E293B', border: '1px solid #334059' }}>
            <h3 className="text-sm font-medium text-slate-100 mb-4">新建</h3>
            {/* Type selector */}
            <div className="flex items-center gap-2 mb-3">
              <button onClick={() => setNewType('folder')} className="flex-1 flex items-center justify-center gap-2 rounded py-2 text-xs transition-colors"
                style={{ backgroundColor: newType === 'folder' ? 'rgba(34,197,94,0.15)' : '#0F172A', border: newType === 'folder' ? '1px solid rgba(34,197,94,0.3)' : '1px solid #334059', color: newType === 'folder' ? '#22C55E' : '#94A3B8' }}>
                <Folder size={16} /> 文件夹
              </button>
              <button onClick={() => setNewType('file')} className="flex-1 flex items-center justify-center gap-2 rounded py-2 text-xs transition-colors"
                style={{ backgroundColor: newType === 'file' ? 'rgba(59,130,246,0.15)' : '#0F172A', border: newType === 'file' ? '1px solid rgba(59,130,246,0.3)' : '1px solid #334059', color: newType === 'file' ? '#3B82F6' : '#94A3B8' }}>
                <File size={16} /> 文件
              </button>
            </div>
            {/* Name input */}
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={newType === 'folder' ? '文件夹名称...' : '文件名称...'}
              className="w-full h-8 text-sm px-2 rounded outline-none mb-3"
              style={{ backgroundColor: '#0F172A', border: '1px solid #334059', color: '#F1F5FB' }}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateNew()} />
            <div className="flex items-center gap-2 justify-end">
              <button onClick={() => setShowNewDialog(false)} className="rounded text-slate-400 hover:text-slate-200 h-7 px-3 text-xs">取消</button>
              <button onClick={handleCreateNew} className="rounded text-white h-7 px-3 text-xs" style={{ backgroundColor: '#22C55E' }}>创建</button>
            </div>
          </div>
        </DO>
      )}

      {/* ── Upload Dialog ── */}
      {showUploadDialog && (
        <DO onClose={() => setShowUploadDialog(false)}>
          <div onClick={(e) => e.stopPropagation()} className="rounded-lg p-5" style={{ width: 400, backgroundColor: '#1E293B', border: '1px solid #334059' }}>
            <h3 className="text-sm font-medium text-slate-100 mb-4">上传文件</h3>
            {/* 拖拽/点击选文件区域 */}
            <div
              className="flex flex-col items-center justify-center rounded-lg mb-3 cursor-pointer transition-colors hover:border-slate-500"
              style={{
                height: 120,
                backgroundColor: '#0F172A',
                border: `2px dashed ${uploadFile ? '#22C55E' : '#334059'}`,
              }}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) { setUploadFile(f); setUploadFileName(f.name); }
              }}
            >
              {uploadFile ? (
                <>
                  <File size={24} style={{ color: '#22C55E' }} />
                  <span className="text-xs mt-2" style={{ color: '#22C55E' }}>{uploadFile.name}</span>
                  <span className="text-xs mt-1" style={{ color: '#64748B' }}>
                    {(uploadFile.size / 1024).toFixed(1)} KB
                  </span>
                </>
              ) : (
                <>
                  <Upload size={24} style={{ color: '#64748B' }} />
                  <span className="text-xs mt-2" style={{ color: '#94A3B8' }}>点击选择文件或拖拽到此处</span>
                </>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) { setUploadFile(f); setUploadFileName(f.name); }
              }}
            />
            {/* 文件名覆盖（可选） */}
            <div className="mb-3">
              <label className="text-xs text-slate-400 mb-1 block">保存为（可选，默认使用原文件名）</label>
              <input value={uploadFileName} onChange={(e) => setUploadFileName(e.target.value)} placeholder={uploadFile?.name || '文件名'}
                className="w-full h-8 text-sm px-2 rounded outline-none"
                style={{ backgroundColor: '#0F172A', border: '1px solid #334059', color: '#F1F5FB' }} />
            </div>
            <div className="flex items-center gap-2 justify-end">
              <button onClick={() => setShowUploadDialog(false)} className="rounded text-slate-400 hover:text-slate-200 h-7 px-3 text-xs">取消</button>
              <button onClick={handleUpload} disabled={!uploadFile}
                className="rounded text-white h-7 px-3 text-xs disabled:opacity-50"
                style={{ backgroundColor: uploadFile ? '#22C55E' : '#334059' }}>上传</button>
            </div>
          </div>
        </DO>
      )}

      {/* ── File Grid (Figma: y=180, flex-1, 5 columns with 208px cards) ── */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-2">
              <FolderOpen size={36} style={{ color: '#475569' }} />
              <span className="text-sm" style={{ color: '#64748B' }}>{searchQuery ? '没有匹配的文件' : '空目录'}</span>
            </div>
          </div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, 208px)', justifyContent: 'start' }}>
            {filtered.map((entry) => (
              <FileCardComp
                key={entry.path}
                entry={entry}
                selected={selectedEntry?.path === entry.path}
                onClick={() => setSelectedEntry(entry)}
                onDoubleClick={() => navigateTo(entry)}
                onContextMenu={(e) => { e.preventDefault(); setSelectedEntry(entry); setContextMenu({ x: e.clientX, y: e.clientY, entry }); }}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Status Bar (Figma: h=32, bg=#1E293B, stroke=#334059, fs=12) ── */}
      <div className="flex items-center px-4 shrink-0 mx-6 mb-4 rounded-b-lg" style={{ height: 32, backgroundColor: '#1E293B', border: '1px solid #334059' }}>
        <span style={{ fontSize: 12, color: '#94A3B8' }}>{filtered.length} 个项目</span>
        {totalSize > 0 && <span style={{ fontSize: 12, color: '#64748B', marginLeft: 8 }}>· {formatTotalSize(totalSize)}</span>}
      </div>

      {/* ── Context Menu ── */}
      {contextMenu && (
        <div className="fixed z-50 rounded-lg py-1 shadow-xl" style={{
          left: isNaN(contextMenu.x) ? 100 : Math.min(contextMenu.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 200),
          top: isNaN(contextMenu.y) ? 100 : Math.min(contextMenu.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 280),
          backgroundColor: '#1E293B', border: '1px solid #334059', minWidth: 180 }} onClick={(e) => e.stopPropagation()}>
          {contextMenu.entry.isDirectory
            ? <MI icon={<ExternalLink size={12} />} label="打开" onClick={() => navigateTo(contextMenu.entry)} />
            : <MI icon={<ExternalLink size={12} />} label="打开" onClick={() => handleReadFile(contextMenu.entry)} />}
          <MI icon={<Pencil size={12} />} label="重命名" onClick={() => { setNewName(contextMenu.entry.name); setShowRename(true); setContextMenu(null); }} />
          <MI icon={<Copy size={12} />} label="复制" onClick={() => { setError('复制功能将在后续版本支持'); setContextMenu(null); }} />
          <MI icon={<Scissors size={12} />} label="剪切" onClick={() => { setError('剪切功能将在后续版本支持'); setContextMenu(null); }} />
          <MI icon={<Trash2 size={12} />} label="删除" danger onClick={() => handleDeleteEntry(contextMenu.entry)} />
          <MI icon={<Key size={12} />} label="权限管理" onClick={() => { setShowPermissions(true); setContextMenu(null); }} />
          {!contextMenu.entry.isDirectory && <MI icon={<Download size={12} />} label="下载" onClick={() => handleReadFile(contextMenu.entry)} />}
          <MI icon={<File size={12} />} label="复制路径" onClick={() => { navigator.clipboard.writeText(contextMenu.entry.path); setContextMenu(null); }} />
        </div>
      )}

      {/* ── Delete Confirm Dialog ── */}
      {showDeleteConfirm && (
        <DO onClose={() => setShowDeleteConfirm(null)}>
          <div onClick={(e) => e.stopPropagation()} className="rounded-lg p-5 text-center" style={{ width: 340, backgroundColor: '#1E293B', border: '1px solid #334059' }}>
            <Trash2 size={28} style={{ color: '#EF4444', margin: '0 auto 12px' }} />
            <h3 className="text-sm font-medium text-slate-100 mb-1">确认删除</h3>
            <p className="text-xs text-slate-400 mb-4">
              确定要删除 <span className="text-slate-200 font-mono">{showDeleteConfirm.name}</span> 吗？此操作不可撤销。
            </p>
            <div className="flex items-center gap-2 justify-center">
              <button onClick={() => setShowDeleteConfirm(null)}
                className="rounded text-slate-400 hover:text-slate-200 h-7 px-4 text-xs"
                style={{ border: '1px solid #334059' }}>取消</button>
              <button onClick={confirmDelete}
                className="rounded text-white h-7 px-4 text-xs" style={{ backgroundColor: '#EF4444' }}>删除</button>
            </div>
          </div>
        </DO>
      )}

      {/* ── Rename Dialog ── */}
      {showRename && (
        <DO onClose={() => { setShowRename(false); setNewName(''); }}>
          <div className="p-4" onClick={(e) => e.stopPropagation()} style={{ backgroundColor: '#1E293B', border: '1px solid #334059', borderRadius: 8, width: 320 }}>
            <h3 className="text-sm font-medium text-slate-100 mb-3">重命名</h3>
            <input value={newName} onChange={(e) => setNewName(e.target.value)}
              className="w-full h-8 text-sm px-2 rounded outline-none mb-3"
              style={{ backgroundColor: '#0F172A', border: '1px solid #334059', color: '#F1F5FB' }}
              onKeyDown={(e) => e.key === 'Enter' && handleRename()} />
            <div className="flex items-center gap-2 justify-end">
              <button onClick={() => { setShowRename(false); setNewName(''); }}
                className="rounded text-slate-400 hover:text-slate-200 h-7 px-3 text-xs">取消</button>
              <button onClick={handleRename} className="rounded text-white h-7 px-3 text-xs" style={{ backgroundColor: '#22C55E' }}>确认</button>
            </div>
          </div>
        </DO>
      )}

      {/* ── Permissions Dialog ── */}
      {showPermissions && selectedEntry && (
        <DO onClose={() => setShowPermissions(false)}>
          <div onClick={(e) => e.stopPropagation()} className="rounded-lg p-6" style={{ width: 440, backgroundColor: '#1E293B', border: '1px solid #334059' }}>
            <h3 className="text-sm font-semibold text-slate-100 mb-4">权限管理 - {selectedEntry.name}</h3>
            <table className="w-full mb-4">
              <thead><tr>
                <th className="text-left text-xs font-medium text-slate-400 pb-2 w-20" />
                <th className="text-center text-xs font-medium text-slate-400 pb-2">读取</th>
                <th className="text-center text-xs font-medium text-slate-400 pb-2">写入</th>
                <th className="text-center text-xs font-medium text-slate-400 pb-2">执行</th>
              </tr></thead>
              <tbody>{(['owner','group','other'] as const).map((k) => (
                <tr key={k}>
                  <td className="text-xs text-slate-300 py-1.5">{k === 'owner' ? '所有者' : k === 'group' ? '组' : '其他'}</td>
                  {(['read','write','exec'] as const).map((col) => (
                    <td key={col} className="text-center py-1.5">
                      <input type="checkbox" checked={perms[k][col]}
                        onChange={() => setPerms((prev) => ({ ...prev, [k]: { ...prev[k], [col]: !prev[k][col] } }))}
                        className="w-4 h-4 rounded accent-emerald-500" />
                    </td>
                  ))}
                </tr>
              ))}</tbody>
            </table>
            <label className="flex items-center gap-2 mb-4 cursor-pointer">
              <input type="checkbox" checked={recursive} onChange={(e) => setRecursive(e.target.checked)} className="w-4 h-4 rounded accent-emerald-500" />
              <span className="text-xs text-slate-400">递归应用到子目录和文件</span>
            </label>
            <div className="flex items-center gap-2 justify-end">
              <button onClick={() => setShowPermissions(false)} className="rounded text-slate-400 hover:text-slate-200 h-7 px-3 text-xs">取消</button>
              <button onClick={() => setShowPermissions(false)} className="rounded text-white h-7 px-3 text-xs" style={{ backgroundColor: '#22C55E' }}>保存</button>
            </div>
          </div>
        </DO>
      )}
    </div>
  );
}

// ── Tiny helpers ─────────────────────────────────────────

function MI({ icon, label, danger, onClick }: { icon: React.ReactNode; label: string; danger?: boolean; onClick: () => void }) {
  return <button onClick={onClick} className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-700 flex items-center gap-2 transition-colors"
    style={{ color: danger ? '#EF4444' : '#94A3B8' }}>{icon}{label}</button>;
}
function MD() { return <div className="mx-2 my-1 border-t border-slate-700" />; }
function DO({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>{children}</div>;
}
