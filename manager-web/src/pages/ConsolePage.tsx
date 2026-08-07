import { useState, useCallback, useRef, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  Terminal,
  Send,
  Trash2,
  AlertTriangle,
  ChevronDown,
} from 'lucide-react';
import { useServer } from '../hooks/useServer.js';
import { useConsole } from '../hooks/useConsole.js';
import { Button } from '../components/ui/button.js';

// ─── 预设命令 ──────────────────────────────────────────

interface PresetCommand {
  label: string;
  command: string;
  dangerous?: boolean;
}

const PRESET_COMMANDS: PresetCommand[] = [
  { label: '广播', command: 'Say ' },
  { label: '存档', command: 'Save' },
  { label: '玩家列表', command: 'Players' },
  { label: '踢出', command: 'Kick ', dangerous: true },
  { label: '白天', command: 'Day' },
  { label: '黑夜', command: 'Night' },
  { label: '关服', command: 'Shutdown ', dangerous: true },
  { label: '帮助', command: 'Help' },
];

// ─── ANSI 着色 ────────────────────────────────────────

/** ANSI color code → CSS color */
const ANSI_COLORS: Record<number, string> = {
  // 常规
  0: '',        // reset
  1: 'font-weight:bold',
  30: '#000',  31: '#EF4444', 32: '#22C55E', 33: '#F59E0B',
  34: '#3B82F6', 35: '#A855F7', 36: '#06B6D4', 37: '#F1F5FB',
  // 亮色
  90: '#64748B', 91: '#FCA5A5', 92: '#86EFAC', 93: '#FDE68A',
  94: '#93C5FD', 95: '#D8B4FE', 96: '#67E8F9', 97: '#FFF',
  // 背景
  40: 'background:#000', 41: 'background:#EF4444', 42: 'background:#22C55E',
};

/** 将 ANSI 转义序列转换为 HTML span 标签，保留颜色 */
function ansiToHtml(text: string): string {
  // 先转义 HTML 实体
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  let result = '';
  let i = 0;
  let currentStyles: string[] = [];

  while (i < html.length) {
    // 匹配 ANSI 转义序列 \x1b[Nm 或 \x1b[N;Nm
    if (html[i] === '\x1b' && html[i + 1] === '[') {
      const end = html.indexOf('m', i);
      if (end === -1) { result += html[i]; i++; continue; }

      const codes = html.slice(i + 2, end).split(';').map(Number);
      i = end + 1;

      // 关闭之前的 span
      if (currentStyles.length > 0) result += '</span>';

      for (const code of codes) {
        if (code === 0) { currentStyles = []; }
        else if (ANSI_COLORS[code]) { currentStyles.push(ANSI_COLORS[code]); }
      }

      // 开启新 span
      if (currentStyles.length > 0) {
        result += `<span style="${currentStyles.join(';')}">`;
      }
    } else {
      result += html[i];
      i++;
    }
  }

  if (currentStyles.length > 0) result += '</span>';
  return result;
}

// ─── Console 页面 ──────────────────────────────────────

/**
 * Console 页面——Figma 2:3 🎨 Console。
 *
 * ServerTabBar + ConsoleToolbar + ConsoleOutput + ConsoleInput。
 */
export function ConsolePage() {
  const { serverId } = useParams<{ serverId: string }>();
  const activeServerId = serverId ?? '_default';
  const { servers } = useServer();
  const { lines, sendCommand, clearLines, connected } = useConsole(activeServerId);

  const [input, setInput] = useState('');
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [showConfirm, setShowConfirm] = useState('');
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const commandHistory = useRef<string[]>([]);

  // 自动滚底
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [lines]);

  // 发送命令
  const handleSend = useCallback(
    async (cmd?: string) => {
      const command = (cmd ?? input).trim();
      if (!command) return;

      // 危险指令确认
      const cmdName = command.split(/\s+/)[0]?.toLowerCase() ?? '';
      const isDangerous = ['shutdown', 'ban', 'slay', 'resetconfig', 'unadmin', 'unban', 'cheats'].includes(cmdName);

      if (isDangerous && showConfirm !== command) {
        setShowConfirm(command);
        return;
      }

      setShowConfirm('');
      commandHistory.current.push(command);
      setInput('');
      setHistoryIdx(-1);

      await sendCommand(command, isDangerous);
    },
    [input, sendCommand, showConfirm],
  );

  // 键盘处理
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        if (showConfirm) {
          // 再按一次 Enter 确认执行
          handleSend(showConfirm);
        } else {
          handleSend();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const next = Math.min(historyIdx + 1, commandHistory.current.length - 1);
        setHistoryIdx(next);
        if (commandHistory.current.length > 0) {
          setInput(commandHistory.current[commandHistory.current.length - 1 - next] ?? '');
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = Math.max(historyIdx - 1, -1);
        setHistoryIdx(next);
        setInput(next === -1 ? '' : (commandHistory.current[commandHistory.current.length - 1 - next] ?? ''));
      } else if (e.key === 'Escape') {
        setShowConfirm('');
      }
    },
    [handleSend, historyIdx, showConfirm],
  );

  return (
    <div className="flex flex-col h-full gap-4">
      {/* ── TopBar ── */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Terminal size={20} style={{ color: '#22C55E' }} />
          <h1 className="text-xl font-semibold m-0" style={{ color: '#F1F5FB' }}>
            控制台
          </h1>
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: connected ? '#22C55E' : '#64748B' }}
            />
            <span className="text-xs" style={{ color: '#64748B' }}>
              {connected ? 'WebSocket 已连接' : 'WebSocket 未连接'}
            </span>
          </div>
        </div>

        {/* Server switcher */}
        <div className="flex items-center gap-1">
          {servers.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                // Navigate to new serverId (handled by parent)
                window.location.hash = `/${s.id}/console`;
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs transition-colors"
              style={{
                backgroundColor: s.id === serverId ? '#22C55E20' : 'transparent',
                color: s.id === serverId ? '#22C55E' : '#94A3B8',
                border: `1px solid ${s.id === serverId ? '#22C55E40' : '#334155'}`,
              }}
            >
              {s.name || s.id}
            </button>
          ))}
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
        {PRESET_COMMANDS.map(({ label, command, dangerous }) => (
          <button
            key={label}
            onClick={() => {
              setInput(command);
              inputRef.current?.focus();
            }}
            className="flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors"
            style={{
              backgroundColor: dangerous ? '#EF444420' : '#1E293B',
              color: dangerous ? '#EF4444' : '#94A3B8',
              border: `1px solid ${dangerous ? '#EF444440' : '#334155'}`,
            }}
            title={dangerous ? '危险指令，需二次确认' : undefined}
          >
            {dangerous && <AlertTriangle size={11} />}
            {label}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={clearLines}
          className="flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors"
          style={{ backgroundColor: '#1E293B', color: '#64748B', border: '1px solid #334155' }}
          title="清空输出"
        >
          <Trash2 size={12} />
          清空
        </button>
      </div>

      {/* ── Output ── */}
      <div
        ref={outputRef}
        className="flex-1 overflow-auto rounded-lg p-3 font-mono text-xs leading-relaxed"
        style={{ backgroundColor: '#020617', border: '1px solid #1E293B' }}
      >
        {lines.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-2">
              <ChevronDown size={16} style={{ color: '#334155' }} />
              <span style={{ color: '#334155' }}>等待控制台输出...</span>
            </div>
          </div>
        ) : (
          lines.map((line) => (
            <div
              key={line.id}
              className="whitespace-pre-wrap break-all"
              style={{
                color:
                  line.source === 'input'
                    ? '#22C55E'
                    : line.text.startsWith('[错误]')
                      ? '#EF4444'
                      : '#94A3B8',
              }}
              dangerouslySetInnerHTML={{ __html: ansiToHtml(line.text) }}
            />
          ))
        )}
      </div>

      {/* ── Input ── */}
      <div className="flex items-center gap-2 shrink-0">
        {showConfirm && (
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded text-xs"
            style={{
              backgroundColor: '#EF444420',
              border: '1px solid #EF444440',
              color: '#EF4444',
            }}
          >
            <AlertTriangle size={14} />
            确认执行 "{showConfirm}"？按 Enter 确认，Esc 取消
          </div>
        )}
        <div className="flex-1 flex items-center gap-2">
          <span style={{ color: '#22C55E' }}>&gt;</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent border-none outline-none text-xs font-mono"
            style={{ color: '#F1F5FB' }}
            placeholder="输入 RCON 命令..."
            aria-label="控制台命令输入"
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <Button
          onClick={() => handleSend()}
          disabled={!input.trim()}
          className="h-7 gap-1 text-xs"
          style={{ backgroundColor: '#22C55E', color: '#F1F5FB' }}
        >
          <Send size={12} />
          发送
        </Button>
      </div>
    </div>
  );
}
