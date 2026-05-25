import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import {
  Archive,
  CalendarDays,
  Check,
  CheckSquare,
  ChevronDown,
  ClipboardList,
  Download,
  Inbox,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  MessageSquare,
  Plus,
  Search,
  Settings,
  Share2,
  Trash2,
  Upload,
  UserPlus,
  X,
} from 'lucide-react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { auth, googleProvider } from './firebase';
import {
  createBoard,
  createTask,
  deleteBoard,
  ensureUserProfile,
  hardDeleteTask,
  hasAnyBoard,
  listenBoards,
  listenInvites,
  listenSettings,
  listenTasks,
  respondInvite,
  restoreBackup,
  sendInvite,
  submitFeedback,
  updateBoard,
  updateSettings,
  updateTask,
} from './data';
import { defaultSettings } from './sampleData';
import { createLocalBoard, guestUser, loadLocalState, saveLocalState, touchLocalBoard, type LocalState } from './localStore';
import type { AppTab, Assignee, BackupData, Board, BoardSettings, Invite, StatusColumn, Task } from './types';

const today = new Date().toISOString().slice(0, 10);

const priorityColor = (value: number) => {
  if (value >= 80) return '#ef4444';
  if (value >= 60) return '#f97316';
  if (value >= 40) return '#eab308';
  if (value >= 20) return '#22c55e';
  return '#94a3b8';
};

const dateLabel = (value: string) => {
  if (!value) return '期日なし';
  return new Date(`${value}T00:00:00`).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short' });
};

const formatDateTime = (value: number) => new Date(value).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

type CurrentUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  isGuest?: boolean;
};

function LoginScreen({ onGuest }: { onGuest: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const login = async () => {
    setLoading(true);
    setError('');
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ログインに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#fafafa] px-5 py-10 flex items-center justify-center">
      <section className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-7 text-center">
          <div className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gray-800 text-white shadow-sm">
            <ClipboardList size={24} />
          </div>
          <h1 className="text-2xl font-light tracking-wider text-gray-900">Wedding Task Board</h1>
          <p className="mt-3 text-sm leading-6 text-gray-600">夫婦・家族で使える共有タスクボード</p>
        </div>
        <button
          onClick={login}
          disabled={loading}
          className="flex h-[42px] w-full items-center justify-center gap-2 rounded-lg bg-gray-800 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-gray-700 active:scale-[0.99] disabled:opacity-60"
        >
          {loading ? <Loader2 className="animate-spin" size={18} /> : null}
          Googleでログイン
        </button>
        <button
          onClick={onGuest}
          className="mt-3 flex h-[42px] w-full items-center justify-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 active:scale-[0.99]"
        >
          ログインなしで使う
        </button>
        <p className="mt-3 text-xs leading-5 text-gray-500">ログインなしの場合、データはこのブラウザ内だけに保存されます。共有や端末間同期はできません。</p>
        {error ? <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      </section>
    </main>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-5 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gray-800 text-white shadow-sm">
        <Plus size={24} />
      </div>
      <h2 className="text-lg font-bold text-gray-800">最初のボードを作成</h2>
      <p className="mt-2 text-sm leading-6 text-gray-600">ボード作成者がオーナーになります。初回だけサンプル担当者とサンプルタスクを追加します。</p>
      <button onClick={onCreate} className="mt-6 rounded-lg bg-gray-800 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-gray-700">
        Weddingボードを作る
      </button>
    </div>
  );
}

function InvitePanel({ invites, onAccept, onDecline }: { invites: Invite[]; onAccept: (invite: Invite) => void; onDecline: (invite: Invite) => void }) {
  if (invites.length === 0) return null;
  return (
    <div className="mb-4 space-y-2">
      {invites.map((invite) => (
        <div key={invite.id} className="rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-800 shadow-sm">
          <div className="font-bold">{invite.boardTitle} に招待されています</div>
          <div className="mt-1 text-xs text-gray-500">招待者: {invite.createdByName}</div>
          <div className="mt-3 flex gap-2">
            <button onClick={() => onAccept(invite)} className="rounded-md bg-gray-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700">
              参加する
            </button>
            <button onClick={() => onDecline(invite)} className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
              辞退
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function BoardSwitcher({
  boards,
  currentBoard,
  onSelect,
  onCreate,
}: {
  boards: Board[];
  currentBoard: Board | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button onClick={() => setOpen((value) => !value)} className="flex min-w-0 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700 shadow-sm hover:bg-gray-50">
        {currentBoard?.ownerId ? <LayoutDashboard size={16} /> : <Inbox size={16} />}
        <span className="max-w-[170px] truncate">{currentBoard?.title || 'ボードを選択'}</span>
        <ChevronDown size={15} />
      </button>
      {open ? (
        <>
          <button className="fixed inset-0 z-20 cursor-default" onClick={() => setOpen(false)} aria-label="閉じる" />
          <div className="absolute left-0 top-12 z-30 w-72 rounded-xl border border-gray-200 bg-white p-2 shadow-lg">
            <div className="max-h-72 overflow-y-auto custom-scrollbar">
              {boards.map((board) => (
                <button
                  key={board.id}
                  onClick={() => {
                    onSelect(board.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-bold ${
                    board.id === currentBoard?.id ? 'bg-gray-800 text-white' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <span className="truncate">{board.title}</span>
                  {board.visibility === 'shared' ? <Share2 size={14} /> : null}
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                onCreate();
                setOpen(false);
              }}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-600 hover:bg-gray-50"
            >
              <Plus size={16} />
              新しいボード
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function BottomTabs({ active, onChange }: { active: AppTab; onChange: (tab: AppTab) => void }) {
  const tabs: { id: AppTab; label: string; icon: typeof LayoutDashboard }[] = [
    { id: 'board', label: 'ボード', icon: LayoutDashboard },
    { id: 'calendar', label: 'カレンダー', icon: CalendarDays },
    { id: 'search', label: '検索', icon: Search },
    { id: 'settings', label: '設定', icon: Settings },
  ];
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white/95 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <div className="mx-auto grid max-w-lg grid-cols-4">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const selected = active === tab.id;
          return (
            <button key={tab.id} onClick={() => onChange(tab.id)} className={`flex flex-col items-center gap-1 rounded-lg px-2 py-2 text-[11px] font-bold transition-colors ${selected ? 'bg-gray-100 text-gray-800' : 'text-gray-400'}`}>
              <Icon size={20} strokeWidth={selected ? 2.5 : 2} />
              {tab.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function TaskCard({
  task,
  settings,
  onUpdate,
  onTrash,
}: {
  task: Task;
  settings: BoardSettings;
  onUpdate: (taskId: string, updates: Partial<Task>) => void;
  onTrash: (taskId: string) => void;
}) {
  const assignees = settings.assignees.filter((assignee) => task.assigneeIds.includes(assignee.id));
  const doneSubtasks = task.subtasks.filter((subtask) => subtask.completed && !subtask.deletedAt).length;
  const liveSubtasks = task.subtasks.filter((subtask) => !subtask.deletedAt);
  const progress = liveSubtasks.length ? Math.round((doneSubtasks / liveSubtasks.length) * 100) : 0;
  const isNew = Date.now() - task.createdAt < 86400000;
  const dateColor = task.dueDate && task.dueDate < today ? 'text-red-600 bg-red-50 border-red-100' : 'text-gray-500 bg-gray-50 border-gray-200';

  return (
    <article className={`bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex flex-col gap-3 relative ${isNew ? 'ring-1 ring-gray-200' : ''}`}>
      <div className="flex items-start gap-2 relative">
        <div className="min-w-0 flex-1">
          <input
            value={task.title}
            onChange={(event) => onUpdate(task.id, { title: event.target.value })}
            className="w-full rounded px-1 -mx-1 border-0 bg-transparent text-base font-bold leading-tight text-gray-800 outline-none hover:bg-gray-50 focus:bg-gray-50"
          />
          {isNew ? <div className="mt-1 inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-500">追加したて</div> : null}
        </div>
        <button onClick={() => onTrash(task.id)} className="text-gray-400 hover:text-red-500 transition-colors p-2 -mr-2 -mt-2 rounded-full active:bg-red-50" aria-label="ゴミ箱へ">
          <Trash2 size={18} />
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-1.5 sm:gap-2">
        <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
          <SelectSheet
            label="ステータス"
            value={task.statusId}
            options={settings.statuses.map((status) => ({ value: status.id, label: status.title }))}
            onChange={(value) => onUpdate(task.id, { statusId: value })}
          />
          <SelectSheet
            label="担当"
            value={task.assigneeIds[0] || ''}
            options={settings.assignees.map((assignee) => ({ value: assignee.id, label: assignee.name }))}
            onChange={(value) => onUpdate(task.id, { assigneeIds: value ? [value] : [] })}
          />
        </div>
        <div className="flex flex-1 min-w-[190px] items-center gap-1.5 sm:gap-2">
          <div className={`relative flex h-[32px] w-[92px] shrink-0 items-center justify-center rounded-md border px-1 text-xs font-semibold shadow-sm ${dateColor}`}>
            <span className="truncate">{task.dueDate ? dateLabel(task.dueDate).replace(/\(.+\)/, '') : '期日'}</span>
            <input type="date" value={task.dueDate} onChange={(event) => onUpdate(task.id, { dueDate: event.target.value })} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
          </div>
          <div className="flex h-[32px] flex-1 min-w-[92px] items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2 shadow-sm">
            <span className="hidden shrink-0 text-[10px] font-bold text-gray-400 sm:block">優先度</span>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-gray-200">
              <div className="h-full transition-all duration-300 ease-out" style={{ width: `${task.priority}%`, backgroundColor: priorityColor(task.priority) }} />
            </div>
            <span className="w-5 shrink-0 text-right text-[10px] font-bold sm:w-6 sm:text-xs" style={{ color: priorityColor(task.priority) }}>{task.priority}</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={task.priority}
            onChange={(event) => onUpdate(task.id, { priority: Number(event.target.value) })}
            className="range h-[32px] w-20 shrink-0 sm:w-24"
            style={{ '--range-color': priorityColor(task.priority), '--range-bg': `linear-gradient(to right, ${priorityColor(task.priority)} ${task.priority}%, #e5e7eb ${task.priority}%)` } as CSSProperties}
          />
        </div>
      </div>

      {assignees.length ? (
        <div className="flex flex-wrap gap-1">
          {assignees.map((assignee) => (
            <span key={assignee.id} className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-600">
              {assignee.name}
            </span>
          ))}
        </div>
      ) : null}

      {task.memo || liveSubtasks.length ? (
        <div className="space-y-2 border-t border-gray-100 pt-2">
          {task.memo ? (
            <textarea
              value={task.memo}
              onChange={(event) => onUpdate(task.id, { memo: event.target.value })}
              rows={2}
              className="w-full min-h-[32px] resize-none rounded-lg border border-transparent px-2 py-1.5 text-xs leading-relaxed text-gray-600 outline-none hover:bg-gray-50 focus:border-gray-200 focus:bg-gray-50"
            />
          ) : null}
          {liveSubtasks.length ? (
            <div>
              <div className="mb-1 flex items-center justify-between px-1 text-[10px] font-bold text-gray-400">
                <span>サブタスク {doneSubtasks}/{liveSubtasks.length}</span>
                <span>{progress}%</span>
              </div>
              <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-gray-100">
                <div className="h-full rounded-full bg-green-400 transition-all duration-300 ease-out" style={{ width: `${progress}%` }} />
              </div>
              <div className="space-y-1">
                {liveSubtasks.map((subtask) => (
                  <button
                    key={subtask.id}
                    onClick={() =>
                      onUpdate(task.id, {
                        subtasks: task.subtasks.map((item) => (item.id === subtask.id ? { ...item, completed: !item.completed } : item)),
                      })
                    }
                    className="flex w-full items-start gap-2 rounded-lg px-1 py-1 text-left text-sm text-gray-700 hover:bg-gray-50"
                  >
                    {subtask.completed ? <CheckSquare size={18} className="mt-[1px] text-gray-800" /> : <Check size={18} className="mt-[1px] text-gray-300" />}
                    <span className={`mt-[1px] flex-1 break-words ${subtask.completed ? 'line-through text-gray-400' : ''}`}>{subtask.text}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function SelectSheet({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value)?.label || '未設定';
  return (
    <div className="relative">
      <button onClick={() => setOpen(true)} className="flex h-[32px] w-full min-w-[84px] items-center justify-between rounded-md border border-transparent bg-gray-100 px-2 text-left text-xs font-semibold text-gray-700 shadow-sm hover:border-gray-300">
        <span className="min-w-0">
          <span className="hidden text-[10px] font-bold text-gray-400 sm:block">{label}</span>
          <span className="block truncate">{current}</span>
        </span>
        <ChevronDown size={14} className="text-gray-400" />
      </button>
      {open ? (
        <>
          <button className="fixed inset-0 z-40 bg-black/20 md:bg-transparent" onClick={() => setOpen(false)} aria-label="閉じる" />
          <div className="fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl bg-white p-3 shadow-lg md:absolute md:bottom-auto md:left-0 md:right-auto md:top-9 md:w-56 md:rounded-xl md:border md:border-gray-200">
            <div className="mb-2 px-2 text-xs font-bold text-gray-500">{label}</div>
            <div className="max-h-72 overflow-y-auto custom-scrollbar">
              {options.map((option) => (
                <button
                  key={option.value}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium ${option.value === value ? 'bg-gray-800 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
                >
                  {option.label}
                  {option.value === value ? <Check size={15} /> : null}
                </button>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function AddTaskForm({ settings, onAdd }: { settings: BoardSettings; onAdd: (task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>) => void }) {
  const [title, setTitle] = useState('');
  const [statusId, setStatusId] = useState(settings.statuses[0]?.id || 'todo');
  const [assigneeId, setAssigneeId] = useState(settings.assignees[0]?.id || '');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState(50);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!settings.statuses.some((status) => status.id === statusId)) setStatusId(settings.statuses[0]?.id || 'todo');
    if (!settings.assignees.some((assignee) => assignee.id === assigneeId)) setAssigneeId(settings.assignees[0]?.id || '');
  }, [settings, statusId, assigneeId]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    onAdd({
      title: title.trim(),
      statusId,
      assigneeIds: assigneeId ? [assigneeId] : [],
      priority,
      dueDate,
      memo: '',
      subtasks: [],
      completedAt: null,
      deletedAt: null,
      archivedAt: null,
    });
    setTitle('');
    setDueDate('');
    setPriority(50);
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm relative z-10">
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        className={`flex w-full cursor-pointer select-none items-center justify-between bg-gray-50 px-4 py-3.5 transition-colors hover:bg-gray-100 sm:px-5 ${collapsed ? 'rounded-xl' : 'rounded-t-xl'}`}
      >
        <div className="flex items-center gap-2 text-sm font-bold text-gray-700 sm:text-base">
          <Plus size={18} className="text-gray-500" />
          新しいタスクを追加
        </div>
        {collapsed ? <ChevronDown size={18} className="text-gray-400" /> : <ChevronDown size={18} className="rotate-180 text-gray-400" />}
      </button>
      {!collapsed ? (
        <form onSubmit={submit} className="rounded-b-xl border-t border-gray-200 p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:gap-4">
            <div className="flex items-end gap-2 sm:gap-4">
              <div className="min-w-0 flex-1">
                <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="タスクのタイトルを入力..." className="h-[42px] w-full rounded-lg border border-gray-300 px-3 text-sm outline-none focus:border-gray-500 focus:ring-1 focus:ring-gray-500" />
              </div>
              <div className="w-[110px] shrink-0 sm:w-[130px]">
                <label className="mb-1 ml-1 block text-[10px] font-bold text-gray-500">ステータス</label>
                <SelectSheet label="ステータス" value={statusId} options={settings.statuses.map((status) => ({ value: status.id, label: status.title }))} onChange={setStatusId} />
              </div>
              <div className="hidden shrink-0 sm:block">
                <button className="flex h-[42px] items-center justify-center gap-1.5 rounded-lg bg-gray-800 px-5 text-sm font-medium text-white transition-colors hover:bg-gray-700">
                  <Plus size={18} />追加
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 sm:gap-4">
              <div className="w-[110px] shrink-0 sm:w-[130px]">
                <label className="mb-1 ml-1 block text-[10px] font-bold text-gray-500">担当者</label>
                <SelectSheet label="担当" value={assigneeId} options={settings.assignees.map((assignee) => ({ value: assignee.id, label: assignee.name }))} onChange={setAssigneeId} />
              </div>
              <div className="w-[130px] shrink-0">
                <label className="mb-1 ml-1 block text-[10px] font-bold text-gray-500">期日</label>
                <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="h-[42px] w-full rounded-lg border border-gray-300 bg-white px-3 text-sm outline-none focus:border-gray-500" />
              </div>
              <div className="min-w-[130px] flex-1">
                <label className="mb-1 ml-1 block text-[10px] font-bold text-gray-500">優先度</label>
                <div className="flex h-[42px] items-center gap-2 overflow-hidden rounded-lg border border-gray-300 bg-white px-2 sm:px-3">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={priority}
                    onChange={(event) => setPriority(Number(event.target.value))}
                    className="range min-w-0 flex-1"
                    style={{ '--range-color': priorityColor(priority), '--range-bg': `linear-gradient(to right, ${priorityColor(priority)} ${priority}%, #e5e7eb ${priority}%)` } as CSSProperties}
                  />
                  <span className="w-6 shrink-0 text-right text-xs font-bold" style={{ color: priorityColor(priority) }}>{priority}</span>
                </div>
              </div>
            </div>
            <button className="mt-1 flex h-[42px] w-full items-center justify-center gap-2 rounded-lg bg-gray-800 text-sm font-medium text-white transition-colors hover:bg-gray-700 sm:hidden">
              <Plus size={18} />追加
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function BoardView({ board, settings, tasks, onAddTask, onUpdateTask, onTrashTask }: {
  board: Board;
  settings: BoardSettings;
  tasks: Task[];
  onAddTask: (task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onUpdateTask: (taskId: string, updates: Partial<Task>) => void;
  onTrashTask: (taskId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const visibleTasks = tasks.filter((task) => !task.deletedAt && !task.archivedAt);

  return (
    <div className="space-y-4">
      <AddTaskForm settings={settings} onAdd={onAddTask} />
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {settings.statuses.map((status) => {
          const columnTasks = visibleTasks.filter((task) => task.statusId === status.id).sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
          const isCollapsed = collapsed[status.id] ?? settings.defaultCollapsed;
          return (
            <section key={status.id} className="w-full rounded-xl border border-gray-200 bg-gray-50/50 p-2.5 sm:p-4">
              <button onClick={() => setCollapsed((value) => ({ ...value, [status.id]: !isCollapsed }))} className="mb-2 flex w-full items-center justify-between border-b border-gray-200 pb-2 text-left">
                <span className="flex items-center gap-1.5 rounded px-1 py-1 font-semibold text-gray-700 transition-colors hover:bg-gray-100">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: status.color }} />
                  {status.title}
                </span>
                <span className="ml-1 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-xs font-semibold text-gray-600 shadow-sm">{columnTasks.length}</span>
              </button>
              {!isCollapsed ? (
                <div className="mt-3 space-y-3 sm:space-y-4">
                  {columnTasks.map((task) => (
                    <TaskCard key={task.id} task={task} settings={settings} onUpdate={onUpdateTask} onTrash={onTrashTask} />
                  ))}
                  {columnTasks.length === 0 ? <div className="rounded-xl border border-dashed border-gray-200 bg-white py-8 text-center text-sm text-gray-400">タスクはありません</div> : null}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
      <div className="text-center text-xs text-gray-400">{board.title}</div>
    </div>
  );
}

function CalendarView({ boards, currentBoardId, selectedBoardIds, setSelectedBoardIds, tasks }: {
  boards: Board[];
  currentBoardId: string;
  selectedBoardIds: string[];
  setSelectedBoardIds: (ids: string[]) => void;
  tasks: Task[];
}) {
  const dueTasks = tasks.filter((task) => !task.deletedAt && !task.archivedAt && task.dueDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const noDueTasks = tasks.filter((task) => !task.deletedAt && !task.archivedAt && !task.dueDate);
  const grouped = dueTasks.reduce<Record<string, Task[]>>((acc, task) => {
    acc[task.dueDate] = [...(acc[task.dueDate] || []), task];
    return acc;
  }, {});

  const toggleBoard = (boardId: string) => {
    const next = selectedBoardIds.includes(boardId) ? selectedBoardIds.filter((id) => id !== boardId) : [...selectedBoardIds, boardId];
    setSelectedBoardIds(next.length ? next : [currentBoardId]);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
        <div className="mb-2 text-sm font-semibold text-gray-800">カレンダー表示ボード</div>
        <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
          {boards.map((board) => (
            <button key={board.id} onClick={() => toggleBoard(board.id)} className={`shrink-0 rounded-full border px-3 py-2 text-xs font-bold shadow-sm ${selectedBoardIds.includes(board.id) ? 'border-gray-800 bg-gray-800 text-white' : 'border-gray-300 bg-white text-gray-500 hover:bg-gray-50'}`}>
              {board.title}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3">
        {Object.entries(grouped).map(([date, items]) => (
          <section key={date} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 font-bold text-gray-800">{dateLabel(date)}</h3>
            <div className="space-y-2">
              {items.map((task) => (
                <div key={task.id} className="rounded-xl bg-gray-50 px-3 py-2 text-sm">
                  <div className="font-semibold text-gray-800">{task.title}</div>
                  <div className="mt-1 text-xs text-gray-500">優先度 {task.priority}</div>
                </div>
              ))}
            </div>
          </section>
        ))}
        {dueTasks.length === 0 ? <div className="rounded-xl border-2 border-dashed border-gray-200 bg-white py-10 text-center text-sm text-gray-400">期日ありタスクはありません</div> : null}
      </div>
      <details className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <summary className="cursor-pointer font-semibold text-gray-800">期日なしタスク {noDueTasks.length}件</summary>
        <div className="mt-3 space-y-2">
          {noDueTasks.map((task) => (
            <div key={task.id} className="rounded-xl bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-700">{task.title}</div>
          ))}
        </div>
      </details>
    </div>
  );
}

function SearchView({ tasks }: { tasks: Task[] }) {
  const [query, setQuery] = useState('');
  const filtered = tasks.filter((task) => !task.deletedAt && [task.title, task.memo, ...task.subtasks.map((subtask) => subtask.text)].join(' ').toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="space-y-4">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="タスクを文字列検索..." className="h-[42px] w-full rounded-lg border border-gray-300 bg-white px-3 text-sm shadow-sm outline-none focus:border-gray-500 focus:ring-1 focus:ring-gray-500" />
      <div className="space-y-2">
        {filtered.map((task) => (
          <div key={task.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="font-bold text-gray-800">{task.title}</div>
            <div className="mt-1 text-xs text-gray-500">{dateLabel(task.dueDate)} ・ 優先度 {task.priority}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SettingsView({
  user,
  board,
  settings,
  tasks,
  isOwner,
  onUpdateSettings,
  onInvite,
  onDeleteBoard,
  onRestore,
  onFeedback,
  onEmptyDone,
  onEmptyTrash,
  isGuest,
}: {
  user: CurrentUser;
  board: Board;
  settings: BoardSettings;
  tasks: Task[];
  isOwner: boolean;
  onUpdateSettings: (settings: Partial<BoardSettings>) => void;
  onInvite: (email: string) => void;
  onDeleteBoard: () => void;
  onRestore: (data: BackupData, mode: 'append' | 'replace') => void;
  onFeedback: (message: string) => void;
  onEmptyDone: () => void;
  onEmptyTrash: () => void;
  isGuest: boolean;
}) {
  const [inviteEmail, setInviteEmail] = useState('');
  const [feedback, setFeedback] = useState('');
  const [restoreText, setRestoreText] = useState('');
  const exportData: BackupData = { type: 'wedding-task-board-backup', version: 1, board, settings, tasks, exportedAt: Date.now() };
  const trashed = tasks.filter((task) => task.deletedAt);
  const done = tasks.filter((task) => task.statusId === 'done' && !task.deletedAt);

  const downloadBackup = () => {
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `task-board-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const parseRestore = (mode: 'append' | 'replace') => {
    const parsed = JSON.parse(restoreText) as BackupData;
    if (parsed.type !== 'wedding-task-board-backup') throw new Error('Invalid backup');
    onRestore(parsed, mode);
    setRestoreText('');
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 flex items-center gap-2 font-bold text-gray-700"><Share2 size={18} className="text-gray-500" />共有設定</h2>
        {isGuest ? <div className="mb-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-800">ログインなしモードでは共有できません。共有したい場合はGoogleログインに切り替えてください。</div> : null}
        <div className="mb-3 text-sm text-gray-600">オーナー: {isOwner ? 'あなた' : board.ownerId}</div>
        <div className="mb-3 flex flex-wrap gap-2">
          {board.memberEmails.map((email) => <span key={email} className="rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-600">{email}</span>)}
          {board.memberEmails.length === 0 ? <span className="text-sm text-gray-400">まだ共有されていません</span> : null}
        </div>
        {isOwner && !isGuest ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!inviteEmail.trim()) return;
              onInvite(inviteEmail);
              setInviteEmail('');
            }}
            className="flex gap-2"
          >
            <input value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="招待するGoogleメール" className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-500" />
            <button className="rounded-lg bg-gray-800 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700"><UserPlus size={16} /></button>
          </form>
        ) : null}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 flex items-center gap-2 font-bold text-gray-700"><Settings size={18} className="text-gray-500" />ボード設定</h2>
        <label className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm">
          ステータスを初期状態で折りたたむ
          <input type="checkbox" checked={settings.defaultCollapsed} disabled={!isOwner} onChange={(event) => onUpdateSettings({ defaultCollapsed: event.target.checked })} />
        </label>
        <div className="mt-3 text-xs text-gray-500">担当者・ステータスの詳細編集は次フェーズで専用画面化します。</div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 flex items-center gap-2 font-bold text-gray-700"><Archive size={18} className="text-gray-500" />データ管理</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <button onClick={downloadBackup} className="flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"><Download size={16} />バックアップ</button>
          <button onClick={onEmptyDone} disabled={!done.length} className="flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-40"><Trash2 size={16} />完了をゴミ箱へ</button>
          <button onClick={onEmptyTrash} disabled={!trashed.length || !isOwner} className="flex items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-600 shadow-sm hover:bg-red-100 disabled:opacity-40"><Trash2 size={16} />ゴミ箱を空にする</button>
        </div>
        <textarea value={restoreText} onChange={(event) => setRestoreText(event.target.value)} placeholder="バックアップJSONを貼り付け" className="mt-3 h-24 w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-xs outline-none focus:border-gray-500 focus:bg-white" />
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <button onClick={() => parseRestore('append')} disabled={!restoreText.trim()} className="flex items-center justify-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-40"><Upload size={16} />追加で復元</button>
          <button onClick={() => parseRestore('replace')} disabled={!restoreText.trim() || !isOwner} className="flex items-center justify-center gap-2 rounded-lg bg-gray-800 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40"><Upload size={16} />上書き復元</button>
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 flex items-center gap-2 font-bold text-gray-700"><MessageSquare size={18} className="text-gray-500" />ご意見箱</h2>
        <textarea value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="改善案や気づいたこと" className="h-24 w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-gray-500 focus:bg-white" />
        <button
          onClick={() => {
            if (!feedback.trim()) return;
            onFeedback(feedback.trim());
            setFeedback('');
          }}
          className="mt-2 rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
        >
          送信
        </button>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 font-bold text-gray-700">アカウント</h2>
        <div className="mb-3 text-sm text-gray-600">{user.displayName || user.email}</div>
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            onClick={() => {
              if (isGuest) {
                localStorage.removeItem('wedding-task-board-guest-mode');
                window.location.reload();
              } else {
                signOut(auth);
              }
            }}
            className="flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
          >
            <LogOut size={16} />{isGuest ? 'ログイン画面へ' : 'ログアウト'}
          </button>
          <button onClick={onDeleteBoard} disabled={!isOwner} className="flex items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-600 shadow-sm hover:bg-red-100 disabled:opacity-40"><Trash2 size={16} />ボード削除</button>
        </div>
      </section>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isGuestMode, setIsGuestMode] = useState(() => localStorage.getItem('wedding-task-board-guest-mode') === '1');
  const [localState, setLocalState] = useState<LocalState>(() => loadLocalState());
  const [authLoading, setAuthLoading] = useState(true);
  const [boards, setBoards] = useState<Board[]>([]);
  const [currentBoardId, setCurrentBoardId] = useState('');
  const [settings, setSettings] = useState<BoardSettings>(defaultSettings);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [calendarTaskMap, setCalendarTaskMap] = useState<Record<string, Task[]>>({});
  const [tab, setTab] = useState<AppTab>('board');
  const [online, setOnline] = useState(navigator.onLine);
  const [selectedCalendarBoardIds, setSelectedCalendarBoardIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setAuthLoading(false);
      if (nextUser) {
        localStorage.removeItem('wedding-task-board-guest-mode');
        setIsGuestMode(false);
        await ensureUserProfile(nextUser);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    if (!user || isGuestMode) return undefined;
    return listenBoards(user.uid, (nextBoards) => {
      setBoards(nextBoards);
      setCurrentBoardId((current) => current || nextBoards[0]?.id || '');
      setSelectedCalendarBoardIds((current) => (current.length ? current : nextBoards[0]?.id ? [nextBoards[0].id] : []));
    });
  }, [user, isGuestMode]);

  useEffect(() => {
    if (!user?.email || isGuestMode) return undefined;
    return listenInvites(user.email.toLowerCase(), setInvites);
  }, [user?.email, isGuestMode]);

  useEffect(() => {
    if (isGuestMode) return undefined;
    if (!currentBoardId) {
      setTasks([]);
      setSettings(defaultSettings);
      return undefined;
    }
    const unsubSettings = listenSettings(currentBoardId, setSettings);
    const unsubTasks = listenTasks(currentBoardId, setTasks);
    return () => {
      unsubSettings();
      unsubTasks();
    };
  }, [currentBoardId, isGuestMode]);

  useEffect(() => {
    if (isGuestMode) return undefined;
    if (selectedCalendarBoardIds.length === 0) {
      setCalendarTaskMap({});
      return undefined;
    }
    const unsubscribes = selectedCalendarBoardIds.map((boardId) =>
      listenTasks(boardId, (nextTasks) => {
        setCalendarTaskMap((current) => ({ ...current, [boardId]: nextTasks }));
      }),
    );
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [selectedCalendarBoardIds, isGuestMode]);

  useEffect(() => {
    if (!isGuestMode) return;
    const nextBoards = [...localState.boards].sort((a, b) => b.updatedAt - a.updatedAt);
    setBoards(nextBoards);
    setInvites([]);
    setCurrentBoardId((current) => current || nextBoards[0]?.id || '');
    setSelectedCalendarBoardIds((current) => (current.length ? current : nextBoards[0]?.id ? [nextBoards[0].id] : []));
    setSettings(currentBoardId ? localState.settingsByBoard[currentBoardId] || defaultSettings : defaultSettings);
    setTasks(currentBoardId ? localState.tasksByBoard[currentBoardId] || [] : []);
    setCalendarTaskMap(
      selectedCalendarBoardIds.reduce<Record<string, Task[]>>((acc, boardId) => {
        acc[boardId] = localState.tasksByBoard[boardId] || [];
        return acc;
      }, {}),
    );
  }, [isGuestMode, localState, currentBoardId, selectedCalendarBoardIds]);

  const currentBoard = boards.find((board) => board.id === currentBoardId) || null;
  const currentUser: CurrentUser | null = user || (isGuestMode ? guestUser : null);
  const isOwner = !!currentUser && !!currentBoard && currentBoard.ownerId === currentUser.uid;
  const calendarTasks = selectedCalendarBoardIds.flatMap((boardId) => calendarTaskMap[boardId] || []);

  const persistLocalState = (updater: (state: LocalState) => LocalState) => {
    setLocalState((current) => {
      const next = updater(current);
      saveLocalState(next);
      return next;
    });
  };

  const startGuestMode = () => {
    localStorage.setItem('wedding-task-board-guest-mode', '1');
    setIsGuestMode(true);
    setAuthLoading(false);
  };

  const createDefaultBoard = async () => {
    if (!currentUser) return;
    setBusy(true);
    try {
      if (isGuestMode) {
        const result = createLocalBoard(localState, localState.boards.length ? '新しいタスクボード' : 'Wedding Task Board', localState.boards.length === 0);
        saveLocalState(result.state);
        setLocalState(result.state);
        setCurrentBoardId(result.boardId);
        return;
      }
      if (!user) return;
      const exists = await hasAnyBoard(user.uid);
      const id = await createBoard(user, exists ? '新しいタスクボード' : 'Wedding Task Board', !exists);
      setCurrentBoardId(id);
    } finally {
      setBusy(false);
    }
  };

  const updateLocalBoard = (boardId: string, updates: Partial<Board>) => {
    persistLocalState((state) => ({
      ...state,
      boards: state.boards.map((board) => (board.id === boardId ? touchLocalBoard({ ...board, ...updates }) : board)),
    }));
  };

  const addLocalTask = (boardId: string, task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>) => {
    const createdAt = Date.now();
    const newTask: Task = {
      id: crypto.randomUUID(),
      ...task,
      createdAt,
      updatedAt: createdAt,
    };
    persistLocalState((state) => ({
      ...state,
      boards: state.boards.map((board) => (board.id === boardId ? touchLocalBoard(board) : board)),
      tasksByBoard: {
        ...state.tasksByBoard,
        [boardId]: [...(state.tasksByBoard[boardId] || []), newTask],
      },
    }));
  };

  const updateLocalTask = (boardId: string, taskId: string, updates: Partial<Task>) => {
    persistLocalState((state) => ({
      ...state,
      boards: state.boards.map((board) => (board.id === boardId ? touchLocalBoard(board) : board)),
      tasksByBoard: {
        ...state.tasksByBoard,
        [boardId]: (state.tasksByBoard[boardId] || []).map((task) =>
          task.id === taskId
            ? {
                ...task,
                ...updates,
                completedAt: updates.statusId === 'done' ? Date.now() : updates.statusId && updates.statusId !== 'done' ? null : updates.completedAt ?? task.completedAt,
                updatedAt: Date.now(),
              }
            : task,
        ),
      },
    }));
  };

  const hardDeleteLocalTask = (boardId: string, taskId: string) => {
    persistLocalState((state) => ({
      ...state,
      tasksByBoard: {
        ...state.tasksByBoard,
        [boardId]: (state.tasksByBoard[boardId] || []).filter((task) => task.id !== taskId),
      },
    }));
  };

  const updateLocalSettings = (boardId: string, updates: Partial<BoardSettings>) => {
    persistLocalState((state) => ({
      ...state,
      settingsByBoard: {
        ...state.settingsByBoard,
        [boardId]: { ...(state.settingsByBoard[boardId] || defaultSettings), ...updates },
      },
    }));
  };

  const deleteLocalBoard = (boardId: string) => {
    persistLocalState((state) => {
      const { [boardId]: _settings, ...settingsByBoard } = state.settingsByBoard;
      const { [boardId]: _tasks, ...tasksByBoard } = state.tasksByBoard;
      const boards = state.boards.filter((board) => board.id !== boardId);
      setCurrentBoardId(boards[0]?.id || '');
      return { boards, settingsByBoard, tasksByBoard };
    });
  };

  const restoreLocalBackup = (boardId: string, data: BackupData, mode: 'append' | 'replace') => {
    persistLocalState((state) => ({
      ...state,
      settingsByBoard: {
        ...state.settingsByBoard,
        [boardId]: mode === 'append' ? { ...(state.settingsByBoard[boardId] || defaultSettings), ...data.settings } : data.settings,
      },
      tasksByBoard: {
        ...state.tasksByBoard,
        [boardId]: [
          ...(mode === 'append' ? state.tasksByBoard[boardId] || [] : []),
          ...data.tasks.map((task) => ({ ...task, id: mode === 'append' ? crypto.randomUUID() : task.id, updatedAt: Date.now() })),
        ],
      },
    }));
  };

  const activeTitle = useMemo(() => currentBoard?.title || 'Wedding Task Board', [currentBoard?.title]);

  if (authLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-[#fafafa]"><Loader2 className="animate-spin text-gray-400" size={32} /></div>;
  }
  if (!currentUser) return <LoginScreen onGuest={startGuestMode} />;

  return (
    <main className="min-h-screen bg-[#fafafa] pb-20 text-gray-800 md:pb-6">
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-[#fafafa]/95 px-3 py-3 backdrop-blur md:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1 text-[10px] font-bold tracking-wide text-gray-400">TASK BOARD</div>
            <div className="flex items-center gap-2">
              <BoardSwitcher boards={boards} currentBoard={currentBoard} onSelect={setCurrentBoardId} onCreate={createDefaultBoard} />
              {busy ? <Loader2 className="animate-spin text-gray-400" size={18} /> : null}
            </div>
          </div>
          <div className="hidden items-center gap-2 md:flex">
            {(['board', 'calendar', 'search', 'settings'] as AppTab[]).map((item) => (
              <button key={item} onClick={() => setTab(item)} className={`rounded-lg px-3 py-2 text-sm font-bold transition-colors ${tab === item ? 'bg-gray-800 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'}`}>
                {item === 'board' ? 'ボード' : item === 'calendar' ? 'カレンダー' : item === 'search' ? '検索' : '設定'}
              </button>
            ))}
          </div>
          <button onClick={() => setTab('settings')} className="rounded-lg bg-white p-2 text-gray-500 shadow-sm md:hidden" aria-label="設定">
            <Menu size={20} />
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-3 py-4 md:px-6">
        {!online ? <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">オフラインです。接続が戻るまで保存できない場合があります。</div> : null}
        <InvitePanel invites={invites} onAccept={(invite) => user && respondInvite(invite, user, true)} onDecline={(invite) => user && respondInvite(invite, user, false)} />

        {boards.length === 0 ? (
          <EmptyState onCreate={createDefaultBoard} />
        ) : !currentBoard ? (
          <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500 shadow-sm">ボードを選択してください</div>
        ) : (
          <>
            <div className="relative mb-6 flex min-h-10 flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h1 className="truncate text-2xl font-light tracking-wider text-gray-900 sm:text-3xl">{activeTitle}</h1>
                <p className="mt-1 text-xs text-gray-500">{isOwner ? 'オーナーボード' : '参加中ボード'} ・ {currentBoard.visibility === 'shared' ? '共有中' : 'プライベート'}</p>
              </div>
              {isOwner ? (
                <input
                  value={currentBoard.title}
                  onChange={(event) => (isGuestMode ? updateLocalBoard(currentBoard.id, { title: event.target.value }) : updateBoard(currentBoard.id, { title: event.target.value }))}
                  className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm shadow-sm outline-none focus:border-gray-500"
                  aria-label="ボード名"
                />
              ) : null}
            </div>

            {tab === 'board' ? (
              <BoardView
                board={currentBoard}
                settings={settings}
                tasks={tasks}
                onAddTask={(task) => (isGuestMode ? addLocalTask(currentBoard.id, task) : createTask(currentBoard.id, task))}
                onUpdateTask={(taskId, updates) => (isGuestMode ? updateLocalTask(currentBoard.id, taskId, updates) : updateTask(currentBoard.id, taskId, updates))}
                onTrashTask={(taskId) => (isGuestMode ? updateLocalTask(currentBoard.id, taskId, { deletedAt: Date.now() }) : updateTask(currentBoard.id, taskId, { deletedAt: Date.now() }))}
              />
            ) : null}
            {tab === 'calendar' ? (
              <CalendarView boards={boards} currentBoardId={currentBoard.id} selectedBoardIds={selectedCalendarBoardIds} setSelectedBoardIds={setSelectedCalendarBoardIds} tasks={calendarTasks} />
            ) : null}
            {tab === 'search' ? <SearchView tasks={tasks} /> : null}
            {tab === 'settings' ? (
              <SettingsView
                user={currentUser}
                board={currentBoard}
                settings={settings}
                tasks={tasks}
                isOwner={isOwner}
                isGuest={isGuestMode}
                onUpdateSettings={(updates) => (isGuestMode ? updateLocalSettings(currentBoard.id, updates) : updateSettings(currentBoard.id, updates))}
                onInvite={(email) => user && sendInvite(currentBoard, email, user)}
                onDeleteBoard={() => {
                  if (confirm('このボードを完全に削除しますか？')) {
                    if (isGuestMode) deleteLocalBoard(currentBoard.id);
                    else deleteBoard(currentBoard.id);
                  }
                }}
                onRestore={(data, mode) => (isGuestMode ? restoreLocalBackup(currentBoard.id, data, mode) : restoreBackup(currentBoard.id, data, mode))}
                onFeedback={(message) => (isGuestMode ? alert('ログインなしモードではご意見箱の送信はできません。内容は端末内には保存されません。') : user && submitFeedback(user, message))}
                onEmptyDone={() => tasks.filter((task) => task.statusId === 'done' && !task.deletedAt).forEach((task) => (isGuestMode ? updateLocalTask(currentBoard.id, task.id, { deletedAt: Date.now() }) : updateTask(currentBoard.id, task.id, { deletedAt: Date.now() })))}
                onEmptyTrash={() => tasks.filter((task) => task.deletedAt).forEach((task) => (isGuestMode ? hardDeleteLocalTask(currentBoard.id, task.id) : hardDeleteTask(currentBoard.id, task.id)))}
              />
            ) : null}
          </>
        )}
      </div>

      <BottomTabs active={tab} onChange={setTab} />
    </main>
  );
}
