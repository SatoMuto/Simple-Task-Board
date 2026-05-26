import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent, type TouchEvent } from 'react';
import {
  Archive,
  Bell,
  BookOpen,
  CalendarDays,
  Calendar,
  Check,
  CheckSquare,
  Square,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Filter,
  Flag,
  GripVertical,
  Download,
  Inbox,
  LayoutDashboard,
  Loader2,
  Lock,
  LogOut,
  Layers,
  List,
  Menu,
  MessageSquare,
  MoreHorizontal,
  Moon,
  Pencil,
  Plus,
  HelpCircle,
  Repeat,
  RotateCcw,
  Search,
  Settings,
  Share2,
  Trash2,
  Upload,
  UserPlus,
  UserMinus,
  X,
} from 'lucide-react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { auth, googleProvider } from './firebase';
import {
  createBoard,
  createAggregateBoard,
  createTask,
  deleteBoard,
  ensureUserProfile,
  hardDeleteTask,
  hasAnyBoard,
  importLocalStateToFirebase,
  leaveBoard,
  listenBoards,
  listenInvites,
  listenSettings,
  listenTasks,
  removeBoardMember,
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
import type { AppTab, Assignee, BackupData, Board, BoardSettings, Invite, RecurrenceRule, StatusColumn, Task } from './types';

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

const dueDateTone = (value?: string) => {
  if (!value) return 'text-gray-500 bg-gray-50 border-gray-200';
  const currentDate = new Date();
  currentDate.setHours(0, 0, 0, 0);
  const threeDaysLater = new Date(currentDate);
  threeDaysLater.setDate(currentDate.getDate() + 3);
  const taskDate = new Date(`${value}T00:00:00`);
  if (taskDate < currentDate) return 'text-red-600 bg-red-50 border-red-200';
  if (taskDate <= threeDaysLater) return 'text-orange-600 bg-orange-50 border-orange-200';
  return 'text-blue-600 bg-blue-50 border-blue-200';
};

const formatDateTime = (value: number) => new Date(value).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const translucent = (hex: string, alpha = '33') => `${hex}${alpha}`;

const sortOptions = [
  { value: 'priority-desc', label: '優先度が高い順' },
  { value: 'priority-asc', label: '優先度が低い順' },
  { value: 'dueDate-asc', label: '期日が近い順' },
  { value: 'dueDate-desc', label: '期日が遠い順' },
  { value: 'createdAt-desc', label: '追加日時が新しい順' },
  { value: 'createdAt-asc', label: '追加日時が古い順' },
];

const boardStatusLabel = (board: Board | null, user: CurrentUser | null) => {
  if (!board) return '未選択';
  if (user?.isGuest) return '未ログイン';
  if (board.kind === 'aggregate') return 'まとめボード';
  if (board.ownerId !== user?.uid) return '参加中';
  return board.visibility === 'shared' || board.memberIds.length > 0 || board.memberEmails.length > 0 ? '共有中' : '自分だけ';
};

const backupPreview = (data: BackupData | null) => {
  if (!data) return null;
  return {
    boardTitle: data.board?.title || '不明なボード',
    taskCount: data.tasks.length,
    archivedCount: data.tasks.filter((task) => task.archivedAt).length,
    trashCount: data.tasks.filter((task) => task.deletedAt).length,
    assigneeCount: data.settings.assignees.length,
    statusCount: data.settings.statuses.length,
    recurrenceCount: data.settings.recurrenceRules?.length || 0,
  };
};

const dateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const dateTimeFromParts = (date: Date, time: string) => {
  const [hours, minutes] = time.split(':').map(Number);
  const next = new Date(date);
  next.setHours(Number.isFinite(hours) ? hours : 9, Number.isFinite(minutes) ? minutes : 0, 0, 0);
  return next;
};

const nextDay = (date: Date) => {
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  return next;
};

const recurrenceLabel = (rule: RecurrenceRule) => {
  if (rule.scheduleType === 'daily') return `毎日 ${rule.time}`;
  if (rule.scheduleType === 'weekly') {
    const labels = ['日', '月', '火', '水', '木', '金', '土'];
    return `毎週 ${(rule.weekdays || []).map((day) => labels[day]).join('・') || '未設定'} ${rule.time}`;
  }
  return `毎月 ${rule.dayOfMonth || 1}日 ${rule.time}`;
};

const recurrenceOccurrences = (rule: RecurrenceRule, until = Date.now()) => {
  if (!rule.enabled) return [];
  const start = new Date(rule.lastGeneratedAt || rule.createdAt);
  start.setSeconds(0, 0);
  const cursor = nextDay(start);
  cursor.setHours(0, 0, 0, 0);
  const limit = new Date(until);
  const occurrences: Date[] = [];
  let guard = 0;

  while (cursor.getTime() <= limit.getTime() && guard < 730) {
    const candidate = dateTimeFromParts(cursor, rule.time || '09:00');
    const matchesDaily = rule.scheduleType === 'daily';
    const matchesWeekly = rule.scheduleType === 'weekly' && (rule.weekdays || []).includes(candidate.getDay());
    const matchesMonthly = rule.scheduleType === 'monthly' && candidate.getDate() === (rule.dayOfMonth || 1);
    if (candidate.getTime() > (rule.lastGeneratedAt || rule.createdAt) && candidate.getTime() <= until && (matchesDaily || matchesWeekly || matchesMonthly)) {
      occurrences.push(candidate);
    }
    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }

  return occurrences;
};

const taskFromRecurrence = (rule: RecurrenceRule, occurrence: Date): Omit<Task, 'id' | 'createdAt' | 'updatedAt'> => ({
  title: rule.title,
  statusId: rule.statusId,
  assigneeIds: rule.assigneeIds,
  priority: rule.priority,
  dueDate: dateKey(occurrence),
  memo: rule.memo,
  subtasks: rule.subtasks.map((subtask) => ({ ...subtask, id: crypto.randomUUID(), completed: false, deletedAt: null })),
  completedAt: null,
  deletedAt: null,
  archivedAt: null,
  recurrenceRuleId: rule.id,
  recurrenceOccurrenceAt: occurrence.getTime(),
});

const aggregateKeyPart = (value: string) => encodeURIComponent(value.trim()).replace(/%/g, '_');
const aggregateColorPart = (value: string) => value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
const aggregateStatusId = (status: StatusColumn) => `agg-status-${aggregateKeyPart(status.title)}-${aggregateColorPart(status.color)}`;
const aggregateAssigneeId = (assignee: Assignee) => `agg-assignee-${aggregateKeyPart(assignee.name)}-${aggregateColorPart(assignee.color)}`;

const buildAggregateView = (
  sourceBoardIds: string[],
  sourceBoards: Board[],
  settingsByBoard: Record<string, BoardSettings>,
  tasksByBoard: Record<string, Task[]>,
) => {
  const statuses: StatusColumn[] = [];
  const assignees: Assignee[] = [];
  const statusIdMap: Record<string, Record<string, string>> = {};
  const assigneeIdMap: Record<string, Record<string, string>> = {};

  sourceBoardIds.forEach((boardId) => {
    const boardSettings = settingsByBoard[boardId] || defaultSettings;
    statusIdMap[boardId] = {};
    assigneeIdMap[boardId] = {};

    boardSettings.statuses.forEach((status) => {
      const id = aggregateStatusId(status);
      statusIdMap[boardId][status.id] = id;
      if (!statuses.some((item) => item.id === id)) statuses.push({ ...status, id, isDefault: status.isDefault });
    });

    boardSettings.assignees.forEach((assignee) => {
      const id = aggregateAssigneeId(assignee);
      assigneeIdMap[boardId][assignee.id] = id;
      if (!assignees.some((item) => item.id === id)) assignees.push({ ...assignee, id });
    });
  });

  const tasks = sourceBoardIds.flatMap((boardId) => {
    const sourceBoard = sourceBoards.find((board) => board.id === boardId);
    return (tasksByBoard[boardId] || []).map((task) => ({
      ...task,
      statusId: statusIdMap[boardId]?.[task.statusId] || task.statusId,
      assigneeIds: task.assigneeIds.map((id) => assigneeIdMap[boardId]?.[id] || id),
      sourceBoardId: boardId,
      sourceBoardTitle: sourceBoard?.title || '元ボード',
    }));
  });

  return {
    settings: {
      ...defaultSettings,
      statuses: statuses.length ? statuses : defaultSettings.statuses,
      assignees: assignees.length ? assignees : defaultSettings.assignees,
    },
    tasks: tasks.sort((a, b) => b.createdAt - a.createdAt),
  };
};

type CurrentUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  isGuest?: boolean;
};

function GoogleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0">
      <path fill="#4285F4" d="M21.6 12.23c0-.74-.07-1.45-.19-2.14H12v4.05h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.44Z" />
      <path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.62-2.43l-3.24-2.51c-.9.6-2.05.96-3.38.96-2.6 0-4.8-1.76-5.59-4.12H3.07v2.59A9.99 9.99 0 0 0 12 22Z" />
      <path fill="#FBBC05" d="M6.41 13.9A6 6 0 0 1 6.1 12c0-.66.11-1.3.31-1.9V7.51H3.07A9.99 9.99 0 0 0 2 12c0 1.61.39 3.14 1.07 4.49l3.34-2.59Z" />
      <path fill="#EA4335" d="M12 5.98c1.47 0 2.79.51 3.83 1.5l2.86-2.86C16.96 3.01 14.7 2 12 2a9.99 9.99 0 0 0-8.93 5.51l3.34 2.59C7.2 7.74 9.4 5.98 12 5.98Z" />
    </svg>
  );
}

function GuideModal({ onClose }: { onClose: () => void }) {
  const items = [
    ['未ログイン/ログイン', '未ログインでも使えます。共有や端末間同期を使う場合はGoogleログインに切り替えます。'],
    ['ボード一覧', '左上のメニューから、自分のボード、参加中ボード、まとめボードを切り替えます。'],
    ['まとめボード', '複数ボードのタスクをまとめて見るためのビューです。追加や削除は元ボードで行います。'],
    ['ボード設定', '右上の歯車から、今開いているボードの担当者、ステータス、通知、アーカイブ、ゴミ箱を管理します。'],
    ['その他', '招待、ご意見箱、ガイド、アカウント操作は下部のその他にあります。'],
  ];
  return (
    <div className="fixed inset-0 z-[180] flex items-end bg-black/45 p-0 sm:items-center sm:justify-center sm:p-4">
      <div className="w-full rounded-t-2xl bg-white p-5 shadow-2xl sm:max-w-md sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-bold text-gray-800"><BookOpen size={20} className="text-gray-500" />Simple Task Board ガイド</h2>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-800"><X size={18} /></button>
        </div>
        <div className="space-y-2">
          {items.map(([title, body]) => (
            <div key={title} className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
              <div className="text-sm font-bold text-gray-700">{title}</div>
              <div className="mt-1 text-xs leading-5 text-gray-500">{body}</div>
            </div>
          ))}
        </div>
        <button type="button" onClick={onClose} className="mt-4 h-11 w-full rounded-lg bg-gray-800 text-sm font-bold text-white hover:bg-gray-700">閉じる</button>
      </div>
    </div>
  );
}

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
          <h1 className="text-2xl font-light tracking-wider text-gray-900">Simple Task Board</h1>
          <p className="mt-3 text-sm leading-6 text-gray-600">
            <span className="block">一人のタスクも、みんなの予定も。</span>
            <span className="block">シンプルに整理しよう。</span>
          </p>
        </div>
        <button
          onClick={login}
          disabled={loading}
          className="flex h-[42px] w-full items-center justify-center gap-2 rounded-lg bg-gray-800 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-gray-700 active:scale-[0.99] disabled:opacity-60"
        >
          {loading ? (
            <Loader2 className="animate-spin" size={18} />
          ) : (
            <GoogleIcon />
          )}
          Googleでログイン
        </button>
        <button
          onClick={onGuest}
          className="mt-3 flex h-[42px] w-full items-center justify-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 active:scale-[0.99]"
        >
          ログインなしで使う
        </button>
        <p className="mt-3 text-center text-xs leading-5 text-gray-500">
          <span className="block">未ログインの場合、データはこのブラウザ内だけに保存されます。</span>
          <span className="block">共有や端末間同期はできません。</span>
        </p>
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
      <p className="mt-2 text-sm leading-6 text-gray-600">初回作成時はサンプル担当者とサンプルタスクを追加します。</p>
      <button onClick={() => onCreate()} className="mt-6 rounded-lg bg-gray-800 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-gray-700">
        タスクボードを作る
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
  onRenameCurrent,
}: {
  boards: Board[];
  currentBoard: Board | null;
  onSelect: (id: string) => void;
  onCreate: (title?: string) => void;
  onRenameCurrent: (title: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editingCurrent, setEditingCurrent] = useState(false);
  const [draftTitle, setDraftTitle] = useState(currentBoard?.title || '');
  const [newBoardTitle, setNewBoardTitle] = useState('');

  useEffect(() => {
    setDraftTitle(currentBoard?.title || '');
    setEditingCurrent(false);
  }, [currentBoard?.id, currentBoard?.title]);

  const saveCurrentTitle = () => {
    const title = draftTitle.trim();
    if (title && currentBoard && title !== currentBoard.title) onRenameCurrent(title);
    setEditingCurrent(false);
  };

  const createNamedBoard = (event: FormEvent) => {
    event.preventDefault();
    onCreate(newBoardTitle);
    setNewBoardTitle('');
    setOpen(false);
  };

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
                <div
                  key={board.id}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-bold ${
                    board.id === currentBoard?.id ? 'bg-gray-800 text-white' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(board.id);
                      setOpen(false);
                    }}
                    className="min-w-0 flex-1 truncate text-left"
                  >
                    {board.title}
                  </button>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {board.visibility === 'shared' ? <Share2 size={14} /> : null}
                    {board.id === currentBoard?.id ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setEditingCurrent((value) => !value);
                          setDraftTitle(board.title);
                        }}
                        className="rounded-md p-1 text-white/80 hover:bg-white/15 hover:text-white"
                        aria-label="ボード名を変更"
                        title="ボード名を変更"
                      >
                        <Pencil size={14} />
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
            {editingCurrent && currentBoard ? (
              <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50 p-2">
                <div className="mb-1 px-1 text-[10px] font-bold text-gray-500">ボード名を変更</div>
                <div className="flex gap-1.5">
                  <input
                    autoFocus
                    value={draftTitle}
                    onChange={(event) => setDraftTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') saveCurrentTitle();
                      if (event.key === 'Escape') setEditingCurrent(false);
                    }}
                    className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-gray-500"
                  />
                  <button type="button" onClick={saveCurrentTitle} className="rounded-md bg-gray-800 px-2 text-white hover:bg-gray-700"><Check size={15} /></button>
                  <button type="button" onClick={() => setEditingCurrent(false)} className="rounded-md border border-gray-300 bg-white px-2 text-gray-500 hover:bg-gray-50"><X size={15} /></button>
                </div>
              </div>
            ) : null}
            <form onSubmit={createNamedBoard} className="mt-2 rounded-xl border-2 border-dashed border-gray-300 bg-white p-2">
              <div className="mb-1 px-1 text-[10px] font-bold text-gray-500">新しいボード</div>
              <div className="flex gap-1.5">
                <input
                  value={newBoardTitle}
                  onChange={(event) => setNewBoardTitle(event.target.value)}
                  placeholder="ボード名を入力..."
                  className="min-w-0 flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-gray-500"
                />
                <button type="submit" className="flex items-center justify-center rounded-md bg-gray-800 px-2 text-white hover:bg-gray-700" aria-label="新しいボードを作成">
                  <Plus size={16} />
                </button>
              </div>
            </form>
          </div>
        </>
      ) : null}
    </div>
  );
}

function BoardSidebar({
  open,
  boards,
  currentBoard,
  currentUser,
  onClose,
  onSelect,
  onCreate,
  onCreateAggregate,
  onRenameBoard,
  onUpdateAggregateSources,
}: {
  open: boolean;
  boards: Board[];
  currentBoard: Board | null;
  currentUser: CurrentUser;
  onClose: () => void;
  onSelect: (id: string) => void;
  onCreate: (title?: string) => void;
  onCreateAggregate: (title: string, sourceBoardIds: string[]) => void;
  onRenameBoard: (boardId: string, title: string) => void;
  onUpdateAggregateSources: (boardId: string, sourceBoardIds: string[]) => void;
}) {
  const [newBoardTitle, setNewBoardTitle] = useState('');
  const [newViewTitle, setNewViewTitle] = useState('');
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [editingBoardId, setEditingBoardId] = useState<string | null>(null);
  const [editingAggregateId, setEditingAggregateId] = useState<string | null>(null);
  const [draftAggregateSources, setDraftAggregateSources] = useState<string[]>([]);
  const [draftTitle, setDraftTitle] = useState('');
  const [aggregateHelpOpen, setAggregateHelpOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEditingBoardId(null);
    setEditingAggregateId(null);
    setDraftAggregateSources([]);
    setDraftTitle('');
    setAggregateHelpOpen(false);
  }, [open]);

  const normalBoards = boards.filter((board) => (board.kind || 'board') === 'board');
  const ownerBoards = normalBoards.filter((board) => board.ownerId === currentUser.uid);
  const memberBoards = normalBoards.filter((board) => board.ownerId !== currentUser.uid);
  const aggregateBoards = boards.filter((board) => board.kind === 'aggregate');

  const saveTitle = () => {
    const title = draftTitle.trim();
    if (editingBoardId && title) onRenameBoard(editingBoardId, title);
    setEditingBoardId(null);
    setDraftTitle('');
  };

  const openAggregateEditor = (board: Board) => {
    setEditingAggregateId(board.id);
    setDraftAggregateSources(board.sourceBoardIds || []);
  };

  const saveAggregateSources = (boardId: string) => {
    if (draftAggregateSources.length === 0) return;
    onUpdateAggregateSources(boardId, draftAggregateSources);
    setEditingAggregateId(null);
    setDraftAggregateSources([]);
  };

  return (
    <>
      <button type="button" className={`fixed inset-0 z-[120] bg-black/35 transition-opacity ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`} onClick={onClose} aria-label="ボードメニューを閉じる" />
      <aside className={`fixed bottom-0 left-0 top-0 z-[130] flex w-[86vw] max-w-sm flex-col border-r border-gray-200 bg-white shadow-2xl transition-transform duration-200 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div>
            <div className="flex items-center gap-1.5 text-sm font-bold text-gray-800"><List size={16} className="text-gray-500" />ボード一覧</div>
            <div className="text-[11px] text-gray-400">{currentUser.isGuest ? '未ログイン・ローカル保存' : currentUser.email || 'ログイン済み'}</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><X size={18} /></button>
        </div>

        <div className="custom-scrollbar flex-1 space-y-5 overflow-y-auto p-4">
          <section>
            <h3 className="mb-2 text-xs font-bold text-gray-400">自分のボード</h3>
            <div className="space-y-1.5">
              {ownerBoards.map((board) => (
                <div key={board.id} className={`rounded-lg ${board.id === currentBoard?.id ? 'bg-gray-800 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>
                  <div className="flex items-center gap-2 px-3 py-2">
                    <button type="button" onClick={() => { onSelect(board.id); onClose(); }} className="min-w-0 flex flex-1 items-center gap-2 text-left text-sm font-bold">
                      <LayoutDashboard size={15} />
                      <span className="truncate">{board.title}</span>
                    </button>
                    {!currentUser.isGuest ? <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] font-bold text-gray-500">{boardStatusLabel(board, currentUser)}</span> : null}
                    {board.visibility === 'shared' ? <Share2 size={14} /> : null}
                    <button type="button" onClick={() => { setEditingBoardId(board.id); setDraftTitle(board.title); }} className="rounded-md p-1 opacity-80 hover:bg-black/10" aria-label="ボード名を変更"><Pencil size={14} /></button>
                  </div>
                  {editingBoardId === board.id ? (
                    <div className="flex gap-1.5 px-2 pb-2">
                      <input autoFocus value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') saveTitle(); if (event.key === 'Escape') setEditingBoardId(null); }} className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-700 outline-none" />
                      <button type="button" onClick={saveTitle} className="rounded-md bg-gray-700 px-2 text-white"><Check size={14} /></button>
                    </div>
                  ) : null}
                </div>
              ))}
              {ownerBoards.length === 0 ? <div className="rounded-lg border border-dashed border-gray-200 py-4 text-center text-xs text-gray-400">ボードはありません</div> : null}
              <form onSubmit={(event) => { event.preventDefault(); onCreate(newBoardTitle); setNewBoardTitle(''); }} className="mt-2 rounded-xl border-2 border-dashed border-gray-300 bg-white p-2">
                <div className="mb-1 text-[10px] font-bold text-gray-400">新しいボード</div>
                <div className="flex gap-1.5">
                  <input value={newBoardTitle} onChange={(event) => setNewBoardTitle(event.target.value)} placeholder="ボード名を入力..." className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-500" />
                  <button type="submit" className="rounded-lg bg-gray-800 px-3 text-white"><Plus size={17} /></button>
                </div>
              </form>
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-bold text-gray-400">参加中</h3>
            <div className="space-y-1.5">
              {memberBoards.map((board) => (
                <button key={board.id} type="button" onClick={() => { onSelect(board.id); onClose(); }} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-bold ${board.id === currentBoard?.id ? 'bg-gray-800 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>
                  <Inbox size={15} />
                  <span className="min-w-0 flex-1 truncate">{board.title}</span>
                  <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] font-bold text-gray-500">参加中</span>
                  <Share2 size={14} />
                </button>
              ))}
              {memberBoards.length === 0 ? <div className="rounded-lg border border-dashed border-gray-200 py-3 text-center text-xs text-gray-400">参加中ボードはありません</div> : null}
            </div>
          </section>

          <section>
            <div className="relative mb-2 flex items-center gap-1.5">
              <h3 className="text-xs font-bold text-gray-400">まとめボード</h3>
              <button type="button" onClick={() => setAggregateHelpOpen((value) => !value)} className="rounded-full p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700" aria-label="まとめボードの説明">
                <HelpCircle size={14} />
              </button>
              {aggregateHelpOpen ? (
                <>
                  <button type="button" className="fixed inset-0 z-[135] cursor-default" onClick={() => setAggregateHelpOpen(false)} aria-label="まとめボードの説明を閉じる" />
                  <div className="absolute left-0 top-6 z-[140] w-64 rounded-xl border border-gray-200 bg-white p-3 text-xs leading-5 text-gray-600 shadow-xl">
                    <div className="mb-1 font-bold text-gray-700">まとめボードとは</div>
                    <p>複数ボードのタスクをまとめて見ることができます。</p>
                    <p className="mt-1">タスク追加・削除や各種設定は元のボードで行います。</p>
                  </div>
                </>
              ) : null}
            </div>
            <div className="space-y-1.5">
              {aggregateBoards.map((board) => (
                <div key={board.id} className={`rounded-lg ${board.id === currentBoard?.id ? 'bg-gray-800 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>
                  <div className="flex items-center gap-2 px-3 py-2">
                    <button type="button" onClick={() => { onSelect(board.id); onClose(); }} className="min-w-0 flex flex-1 items-center gap-2 text-left text-sm font-bold">
                      <Layers size={15} />
                      <span className="min-w-0 flex-1 truncate">{board.title}</span>
                    </button>
                    <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] font-bold text-gray-500">まとめ</span>
                    <span className="text-[10px] opacity-70">{board.sourceBoardIds?.length || 0}</span>
                    <button type="button" onClick={() => openAggregateEditor(board)} className="rounded-md p-1 opacity-80 hover:bg-black/10" aria-label="まとめ対象を管理"><Pencil size={14} /></button>
                  </div>
                  {editingAggregateId === board.id ? (
                    <div className="mx-2 mb-2 rounded-xl border border-gray-200 bg-white p-2 text-gray-700 shadow-sm">
                      <div className="mb-2 text-[10px] font-bold text-gray-400">まとめ対象</div>
                      <div className="max-h-36 space-y-1 overflow-y-auto pr-1">
                        {normalBoards.map((sourceBoard) => (
                          <label key={sourceBoard.id} className="flex items-center gap-2 rounded-md bg-gray-50 px-2 py-1.5 text-xs font-medium text-gray-600">
                            <input
                              type="checkbox"
                              checked={draftAggregateSources.includes(sourceBoard.id)}
                              onChange={(event) => setDraftAggregateSources((current) => (
                                event.target.checked ? [...current, sourceBoard.id] : current.filter((id) => id !== sourceBoard.id)
                              ))}
                            />
                            <span className="min-w-0 flex-1 truncate">{sourceBoard.title}</span>
                          </label>
                        ))}
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-1.5">
                        <button type="button" onClick={() => { setEditingAggregateId(null); setDraftAggregateSources([]); }} className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs font-bold text-gray-500">キャンセル</button>
                        <button type="button" disabled={draftAggregateSources.length === 0} onClick={() => saveAggregateSources(board.id)} className="rounded-lg bg-gray-800 px-2 py-1.5 text-xs font-bold text-white disabled:opacity-40">保存</button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
            <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50 p-2">
              <input value={newViewTitle} onChange={(event) => setNewViewTitle(event.target.value)} placeholder="まとめボード名..." className="mb-2 h-9 w-full rounded-lg border border-gray-300 px-2 text-sm outline-none focus:border-gray-500" />
              <div className="max-h-32 space-y-1 overflow-y-auto pr-1">
                {normalBoards.map((board) => (
                  <label key={board.id} className="flex items-center gap-2 rounded-md bg-white px-2 py-1.5 text-xs font-medium text-gray-600">
                    <input type="checkbox" checked={selectedSources.includes(board.id)} onChange={(event) => setSelectedSources((current) => event.target.checked ? [...current, board.id] : current.filter((id) => id !== board.id))} />
                    <span className="min-w-0 flex-1 truncate">{board.title}</span>
                  </label>
                ))}
                {normalBoards.length === 0 ? <div className="rounded-lg border border-dashed border-gray-200 bg-white px-3 py-3 text-center text-xs leading-5 text-gray-400">まとめ対象にできるボードがありません。<br />先に自分のボードを作成してください。</div> : null}
              </div>
              <button type="button" disabled={!newViewTitle.trim() || selectedSources.length === 0} onClick={() => { onCreateAggregate(newViewTitle.trim(), selectedSources); setNewViewTitle(''); setSelectedSources([]); }} className="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-gray-800 text-sm font-bold text-white disabled:opacity-40"><Layers size={15} />まとめを作成</button>
            </div>
          </section>
        </div>

      </aside>
    </>
  );
}

function BottomTabs({ active, onChange }: { active: AppTab; onChange: (tab: AppTab) => void }) {
  const tabs: { id: AppTab; label: string; icon: typeof LayoutDashboard }[] = [
    { id: 'board', label: 'ボード', icon: LayoutDashboard },
    { id: 'calendar', label: 'カレンダー', icon: CalendarDays },
    { id: 'search', label: '検索', icon: Search },
    { id: 'settings', label: 'その他', icon: MoreHorizontal },
  ];
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white/95 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <div className="mx-auto grid max-w-lg grid-cols-[1fr_1fr_1fr_48px] gap-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const selected = active === tab.id;
          return (
            <button key={tab.id} onClick={() => onChange(tab.id)} className={`flex flex-col items-center gap-1 rounded-lg py-2 text-[11px] font-bold transition-colors ${tab.id === 'settings' ? 'px-0' : 'px-2'} ${selected ? 'bg-gray-100 text-gray-800' : 'text-gray-400'}`}>
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
  onArchive,
  onCreateRecurrence,
  onDragStart,
  onOpenSourceTask,
  highlighted,
  readOnly = false,
  disableStatus = false,
  disableDelete = false,
}: {
  task: Task;
  settings: BoardSettings;
  onUpdate: (taskId: string, updates: Partial<Task>) => void;
  onTrash: (taskId: string) => void;
  onArchive: (taskId: string) => void;
  onCreateRecurrence: (rule: RecurrenceRule) => void;
  onDragStart: (taskId: string) => void;
  onOpenSourceTask?: (task: Task) => void;
  highlighted?: boolean;
  readOnly?: boolean;
  disableStatus?: boolean;
  disableDelete?: boolean;
}) {
  const [newSubtaskText, setNewSubtaskText] = useState('');
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false);
  const [recurrenceFromTaskOpen, setRecurrenceFromTaskOpen] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState(task.title);
  const [isEditingMemo, setIsEditingMemo] = useState(false);
  const [localMemo, setLocalMemo] = useState(task.memo || '');
  const [editingSubtaskId, setEditingSubtaskId] = useState<string | null>(null);
  const [editedSubtaskText, setEditedSubtaskText] = useState('');
  const [isEditingPriority, setIsEditingPriority] = useState(false);
  const [tempPriority, setTempPriority] = useState(task.priority ?? 50);
  const [taskRecurrenceType, setTaskRecurrenceType] = useState<RecurrenceRule['scheduleType']>('weekly');
  const [taskRecurrenceTime, setTaskRecurrenceTime] = useState('09:00');
  const [taskRecurrenceWeekdays, setTaskRecurrenceWeekdays] = useState<number[]>([new Date().getDay()]);
  const [taskRecurrenceDayOfMonth, setTaskRecurrenceDayOfMonth] = useState(new Date().getDate());
  const dueDateInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setEditedTitle(task.title);
    setLocalMemo(task.memo || '');
  }, [task.title, task.memo]);

  const currentAssigneeId = task.assigneeIds[0] || '';
  const currentAssignee = settings.assignees.find((assignee) => assignee.id === currentAssigneeId);
  const currentStatus = settings.statuses.find((status) => status.id === task.statusId);
  const currentPriority = task.priority ?? 50;
  const activeSubtasks = (task.subtasks || []).filter((subtask) => !subtask.deletedAt);
  const completedSubtasksCount = activeSubtasks.filter((subtask) => subtask.completed).length;
  const progressPercent = activeSubtasks.length === 0 ? 0 : Math.round((completedSubtasksCount / activeSubtasks.length) * 100);

  const dateColor = dueDateTone(task.dueDate);

  const handleAddSubtask = (event: FormEvent) => {
    event.preventDefault();
    if (readOnly || !newSubtaskText.trim()) return;
    onUpdate(task.id, {
      subtasks: [
        ...(task.subtasks || []),
        { id: crypto.randomUUID(), text: newSubtaskText.trim(), completed: false, deletedAt: null },
      ],
    });
    setNewSubtaskText('');
  };

  const handleTitleSave = () => {
    setIsEditingTitle(false);
    if (readOnly) return;
    if (editedTitle.trim() && editedTitle.trim() !== task.title) onUpdate(task.id, { title: editedTitle.trim() });
    else setEditedTitle(task.title);
  };

  const handleSubtaskSave = (subtaskId: string, originalText: string) => {
    setEditingSubtaskId(null);
    if (readOnly) return;
    if (editedSubtaskText.trim() && editedSubtaskText.trim() !== originalText) {
      onUpdate(task.id, {
        subtasks: task.subtasks.map((subtask) => (subtask.id === subtaskId ? { ...subtask, text: editedSubtaskText.trim() } : subtask)),
      });
    }
  };

  const openDueDatePicker = () => {
    if (readOnly) return;
    const input = dueDateInputRef.current;
    if (input?.showPicker) input.showPicker();
    else input?.click();
    input?.focus();
  };

  const createRecurrenceFromTask = () => {
    if (taskRecurrenceType === 'weekly' && taskRecurrenceWeekdays.length === 0) return;
    const now = Date.now();
    onCreateRecurrence({
      id: crypto.randomUUID(),
      title: task.title,
      statusId: task.statusId,
      assigneeIds: task.assigneeIds,
      priority: currentPriority,
      memo: task.memo || '',
      subtasks: activeSubtasks.map((subtask) => ({ id: crypto.randomUUID(), text: subtask.text, completed: false, deletedAt: null })),
      scheduleType: taskRecurrenceType,
      time: taskRecurrenceTime,
      weekdays: taskRecurrenceType === 'weekly' ? taskRecurrenceWeekdays : undefined,
      dayOfMonth: taskRecurrenceType === 'monthly' ? taskRecurrenceDayOfMonth : undefined,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      lastGeneratedAt: now,
    });
    setRecurrenceFromTaskOpen(false);
    setIsActionMenuOpen(false);
  };

  return (
    <article id={`task-${task.id}`} className={`bg-white border border-gray-200 rounded-xl p-3 shadow-sm flex flex-col gap-2.5 relative transition-shadow ${highlighted ? 'ring-2 ring-gray-500 ring-offset-2' : ''}`}>
      <div className="flex justify-between items-start gap-2 relative">
        <div draggable={!readOnly && !disableStatus} onDragStart={() => !readOnly && !disableStatus && onDragStart(task.id)} className={`p-1 -ml-1 -mt-1 rounded hidden md:block ${readOnly || disableStatus ? 'text-gray-200' : 'cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500'}`} title={readOnly || disableStatus ? 'この画面ではステータス移動できません' : 'ドラッグして移動'}>
          <GripVertical size={20} />
        </div>
        <div className="flex-1 relative">
          {!isEditingTitle ? (
            <h3 onClick={() => { if (!readOnly) { setIsEditingTitle(true); setEditedTitle(task.title); } }} className={`font-bold text-gray-800 leading-snug text-base rounded px-1 -mx-1 ${readOnly ? '' : 'cursor-text hover:bg-gray-50'}`}>
              {task.title}
            </h3>
          ) : (
            <>
              <button className="fixed inset-0 z-[50] cursor-default" onClick={handleTitleSave} aria-label="タイトル編集を閉じる" />
              <div className="absolute top-0 left-0 w-[calc(100%+16px)] -ml-2 -mt-2 bg-white p-3 rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.15)] border border-gray-200 flex flex-col gap-3 z-[60] animate-in zoom-in-95 duration-200">
                <input autoFocus value={editedTitle} onChange={(event) => setEditedTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') handleTitleSave(); }} className="w-full text-base font-bold text-gray-800 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-gray-400 focus:bg-white transition-colors" placeholder="タスクのタイトル" />
                <div className="flex justify-end gap-1.5">
                  <button type="button" onClick={handleTitleSave} className="p-1.5 bg-gray-800 text-white rounded-md hover:bg-gray-700 shadow-sm"><Check size={16} strokeWidth={3} /></button>
                  <button type="button" onClick={() => { setIsEditingTitle(false); setEditedTitle(task.title); }} className="p-1.5 bg-white border border-gray-300 text-gray-500 rounded-md hover:bg-gray-50 shadow-sm"><X size={16} strokeWidth={3} /></button>
                </div>
              </div>
            </>
          )}
        </div>
        <button type="button" onClick={() => setIsActionMenuOpen(true)} className="-mt-1 -mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 active:bg-gray-100" title="タスクメニュー" aria-label="タスクメニュー">
          <MoreHorizontal size={18} />
        </button>
      </div>

      {task.sourceBoardTitle ? (
        <button type="button" onClick={() => onOpenSourceTask?.(task)} className="-mt-1 w-fit rounded px-1 py-0.5 text-left text-[10px] font-bold text-gray-400 hover:bg-gray-50 hover:text-gray-700">
          元ボード: {task.sourceBoardTitle}
        </button>
      ) : null}

      {isActionMenuOpen ? (
        <div className="fixed inset-0 z-[190] flex items-center justify-center bg-black/40 p-4">
          <button type="button" className="absolute inset-0 cursor-default" onClick={() => setIsActionMenuOpen(false)} aria-label="タスクメニューを閉じる" />
          <div className="custom-scrollbar relative max-h-[84vh] w-full max-w-sm overflow-y-auto rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="break-words text-base font-bold leading-snug text-gray-800">{task.title}</div>
                <div className="mt-1 text-[11px] text-gray-400">追加: {task.createdAt ? formatDateTime(task.createdAt) : '-'}</div>
              </div>
              <button type="button" onClick={() => setIsActionMenuOpen(false)} className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><X size={17} /></button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-gray-50 px-3 py-2">
                <div className="mb-1 font-bold text-gray-400">ステータス</div>
                <div className="flex items-center gap-1.5 font-semibold text-gray-700">
                  {currentStatus?.color ? <span className="h-2.5 w-2.5 rounded-full border border-black/10" style={{ backgroundColor: currentStatus.color }} /> : null}
                  {currentStatus?.title || '未設定'}
                </div>
              </div>
              <div className="rounded-lg bg-gray-50 px-3 py-2">
                <div className="mb-1 font-bold text-gray-400">担当</div>
                <div className="flex items-center gap-1.5 font-semibold text-gray-700">
                  {currentAssignee?.color ? <span className="h-2.5 w-2.5 rounded-full border border-black/10" style={{ backgroundColor: currentAssignee.color }} /> : null}
                  {currentAssignee?.name || '未設定'}
                </div>
              </div>
              <div className="rounded-lg bg-gray-50 px-3 py-2">
                <div className="mb-1 font-bold text-gray-400">期日</div>
                <div className="font-semibold text-gray-700">{task.dueDate ? dateLabel(task.dueDate) : '未設定'}</div>
              </div>
              <div className="rounded-lg bg-gray-50 px-3 py-2">
                <div className="mb-1 font-bold text-gray-400">優先度</div>
                <div className="flex items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-200"><div className="h-full" style={{ width: `${currentPriority}%`, backgroundColor: priorityColor(currentPriority) }} /></div>
                  <span className="w-6 text-right font-bold" style={{ color: priorityColor(currentPriority) }}>{currentPriority}</span>
                </div>
              </div>
              <div className="rounded-lg bg-gray-50 px-3 py-2">
                <div className="mb-1 font-bold text-gray-400">サブタスク</div>
                <div className="font-semibold text-gray-700">{completedSubtasksCount}/{activeSubtasks.length}</div>
              </div>
              <div className="rounded-lg bg-gray-50 px-3 py-2">
                <div className="mb-1 font-bold text-gray-400">更新</div>
                <div className="font-semibold text-gray-700">{task.updatedAt ? formatDateTime(task.updatedAt) : '-'}</div>
              </div>
            </div>

            {disableDelete ? (
              <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs leading-5 text-gray-500">
                まとめボード上では削除できません。
                <br />
                削除する場合は元のタスクボードで操作してください。
              </div>
            ) : null}
            {!readOnly && !disableDelete ? <button
              type="button"
              onClick={() => setRecurrenceFromTaskOpen(true)}
              className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white text-sm font-bold text-gray-600 hover:bg-gray-50"
            >
              <Repeat size={17} />繰り返しタスクにする
            </button> : null}
            {!readOnly && !disableDelete ? <button
              type="button"
              onClick={() => {
                onArchive(task.id);
                setIsActionMenuOpen(false);
              }}
              className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white text-sm font-bold text-gray-600 hover:bg-gray-50"
            >
              <Archive size={17} />アーカイブする
            </button> : null}
            {!readOnly && !disableDelete ? <button
              type="button"
              onClick={() => {
                onTrash(task.id);
                setIsActionMenuOpen(false);
              }}
              className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 text-sm font-bold text-red-600 hover:bg-red-100"
            >
              <Trash2 size={17} />ゴミ箱へ移動
            </button> : null}
            {recurrenceFromTaskOpen ? (
              <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/45 p-4">
                <button type="button" className="absolute inset-0 cursor-default" onClick={() => setRecurrenceFromTaskOpen(false)} aria-label="繰り返し設定を閉じる" />
                <div className="custom-scrollbar relative max-h-[84vh] w-full max-w-sm overflow-y-auto rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="flex items-center gap-2 text-base font-bold text-gray-800"><Repeat size={18} className="text-gray-500" />繰り返しタスクにする</h3>
                    <button type="button" onClick={() => setRecurrenceFromTaskOpen(false)} className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><X size={17} /></button>
                  </div>
                  <div className="mb-3 rounded-lg bg-gray-50 px-3 py-2 text-sm font-bold text-gray-700">{task.title}</div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      ['daily', '毎日'],
                      ['weekly', '毎週'],
                      ['monthly', '毎月'],
                    ].map(([value, label]) => (
                      <button key={value} type="button" onClick={() => setTaskRecurrenceType(value as RecurrenceRule['scheduleType'])} className={`h-10 rounded-lg border text-sm font-bold ${taskRecurrenceType === value ? 'border-gray-800 bg-gray-800 text-white' : 'border-gray-300 bg-white text-gray-600'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <label className="mt-3 block text-xs font-bold text-gray-500">時刻</label>
                  <input type="time" value={taskRecurrenceTime} onChange={(event) => setTaskRecurrenceTime(event.target.value)} className="mt-1 h-[42px] w-full rounded-lg border border-gray-300 px-3 text-sm outline-none focus:border-gray-500" />
                  {taskRecurrenceType === 'weekly' ? (
                    <div className="mt-3">
                      <div className="mb-1 text-xs font-bold text-gray-500">曜日</div>
                      <div className="grid grid-cols-7 gap-1">
                        {['日', '月', '火', '水', '木', '金', '土'].map((label, index) => {
                          const selected = taskRecurrenceWeekdays.includes(index);
                          return (
                            <button key={label} type="button" onClick={() => setTaskRecurrenceWeekdays((current) => selected ? current.filter((item) => item !== index) : [...current, index].sort())} className={`h-9 rounded-lg border text-xs font-bold ${selected ? 'border-gray-800 bg-gray-800 text-white' : 'border-gray-300 bg-white text-gray-500'}`}>
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                  {taskRecurrenceType === 'monthly' ? (
                    <label className="mt-3 block text-xs font-bold text-gray-500">
                      毎月の日付
                      <input type="number" min="1" max="31" value={taskRecurrenceDayOfMonth} onChange={(event) => setTaskRecurrenceDayOfMonth(Number(event.target.value))} className="mt-1 h-[42px] w-full rounded-lg border border-gray-300 px-3 text-sm outline-none focus:border-gray-500" />
                    </label>
                  ) : null}
                  <button type="button" onClick={createRecurrenceFromTask} disabled={taskRecurrenceType === 'weekly' && taskRecurrenceWeekdays.length === 0} className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-gray-800 text-sm font-bold text-white hover:bg-gray-700 disabled:opacity-40">
                    <Repeat size={16} />繰り返し設定を作成
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <SelectSheet label="ステータス" value={task.statusId} options={settings.statuses.map((status) => ({ value: status.id, label: status.title, color: status.color }))} onChange={(nextValue) => !readOnly && !disableStatus && onUpdate(task.id, { statusId: nextValue })} disabled={readOnly || disableStatus} />

      <div className="grid grid-cols-[minmax(96px,1.25fr)_76px_minmax(88px,1fr)] gap-1.5">
        <div className="min-w-0">
          <SelectSheet label="担当" value={currentAssigneeId} options={[{ value: '', label: '未設定' }, ...settings.assignees.map((assignee) => ({ value: assignee.id, label: assignee.name, color: assignee.color }))]} onChange={(nextValue) => !readOnly && onUpdate(task.id, { assigneeIds: nextValue ? [nextValue] : [] })} disabled={readOnly} />
        </div>

        <div>
          <button type="button" onClick={openDueDatePicker} disabled={readOnly} className={`relative flex h-[30px] w-full items-center justify-center gap-1 rounded-md border text-xs font-semibold shadow-sm transition-colors group disabled:cursor-default ${dateColor}`}>
          <Calendar size={13} strokeWidth={2.5} />
          <span>{task.dueDate ? new Date(`${task.dueDate}T00:00:00`).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' }) : '未設定'}</span>
          {!readOnly ? <input ref={dueDateInputRef} type="date" value={task.dueDate || ''} onChange={(event) => onUpdate(task.id, { dueDate: event.target.value })} className="pointer-events-none absolute h-px w-px opacity-0" tabIndex={-1} title="期日を設定" /> : null}
          </button>
        </div>

        <div className="relative min-w-0">
          <div className="flex h-[30px] items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2 shadow-sm">
          <button type="button" disabled={readOnly} className="flex-1 h-2.5 bg-gray-200 rounded-full overflow-hidden cursor-pointer hover:ring-2 hover:ring-gray-300 transition-all text-left disabled:cursor-default disabled:hover:ring-0" onClick={() => { if (!readOnly) { setIsEditingPriority(true); setTempPriority(currentPriority); } }} title={`優先度: ${currentPriority}`}>
            <div className="h-full transition-all duration-300 ease-out" style={{ width: `${currentPriority}%`, backgroundColor: priorityColor(currentPriority) }} />
          </button>
          <span className="text-[10px] sm:text-xs font-bold w-5 sm:w-6 shrink-0 text-right" style={{ color: priorityColor(currentPriority) }}>{currentPriority}</span>
          </div>
          {isEditingPriority ? (
            <>
              <button className="fixed inset-0 z-[190] cursor-default bg-black/40" onClick={() => setIsEditingPriority(false)} aria-label="優先度編集を閉じる" />
              <div className="fixed left-1/2 top-1/2 z-[200] w-[min(calc(100vw-2rem),22rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl">
                <div className="mb-3 text-sm font-bold text-gray-700">優先度</div>
                <div className="flex items-center gap-3">
                  <input type="range" min="0" max="100" value={tempPriority} onChange={(event) => setTempPriority(Number(event.target.value))} className="range flex-1 min-w-0" style={{ '--range-color': priorityColor(tempPriority), '--range-bg': `linear-gradient(to right, ${priorityColor(tempPriority)} ${tempPriority}%, #e5e7eb ${tempPriority}%)` } as CSSProperties} />
                  <span className="w-7 text-right text-xs font-bold" style={{ color: priorityColor(tempPriority) }}>{tempPriority}</span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setIsEditingPriority(false)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-bold text-gray-500 hover:bg-gray-50">戻る</button>
                  <button type="button" onClick={() => { onUpdate(task.id, { priority: tempPriority }); setIsEditingPriority(false); }} className="rounded-lg bg-gray-800 px-3 py-2 text-xs font-bold text-white hover:bg-gray-700">決定</button>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>

      <div className="relative">
        {!isEditingMemo ? (
          <div onClick={() => { if (!readOnly) { setLocalMemo(task.memo || ''); setIsEditingMemo(true); } }} className={`w-full text-xs rounded-lg px-2 py-1.5 min-h-[32px] transition-colors border border-transparent ${readOnly ? '' : 'cursor-text hover:bg-gray-50'} ${task.memo ? 'text-gray-600 whitespace-pre-wrap leading-relaxed' : 'text-gray-400'}`}>
            {task.memo || 'メモを追加...'}
          </div>
        ) : (
          <>
            <button className="fixed inset-0 z-[50] cursor-default" onClick={() => { setLocalMemo(task.memo || ''); setIsEditingMemo(false); }} aria-label="メモ編集を閉じる" />
            <div className="absolute top-0 left-0 w-[calc(100%+16px)] -ml-2 -mt-2 bg-white p-3 rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.15)] border border-gray-200 flex flex-col gap-3 z-[60] animate-in zoom-in-95 duration-200">
              <textarea autoFocus value={localMemo} onChange={(event) => setLocalMemo(event.target.value)} placeholder="メモを追加..." className="w-full text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-gray-400 focus:bg-white transition-colors overflow-hidden leading-relaxed" rows={3} style={{ minHeight: '64px' }} />
              <div className="flex justify-end gap-1.5">
                <button type="button" onClick={() => { onUpdate(task.id, { memo: localMemo }); setIsEditingMemo(false); }} className="p-1.5 bg-gray-800 text-white rounded-md hover:bg-gray-700 shadow-sm"><Check size={16} strokeWidth={3} /></button>
                <button type="button" onClick={() => { setLocalMemo(task.memo || ''); setIsEditingMemo(false); }} className="p-1.5 bg-white border border-gray-300 text-gray-500 rounded-md hover:bg-gray-50 shadow-sm"><X size={16} strokeWidth={3} /></button>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="pt-2 border-t border-gray-100 space-y-2 relative">
        <div className="flex items-center px-1 mb-1 gap-2">
          <span className="text-[10px] font-bold text-gray-400 shrink-0">サブタスク</span>
          {activeSubtasks.length > 0 ? (
            <>
              <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden"><div className="h-full bg-green-400 transition-all duration-300 ease-out" style={{ width: `${progressPercent}%` }} /></div>
              <span className="text-[10px] font-bold text-gray-500 shrink-0">{completedSubtasksCount}/{activeSubtasks.length}</span>
            </>
          ) : null}
        </div>

        {activeSubtasks.map((subtask) => (
          <div key={subtask.id} className="flex items-start gap-2.5 group relative">
            <button type="button" disabled={readOnly} onClick={() => onUpdate(task.id, { subtasks: task.subtasks.map((item) => (item.id === subtask.id ? { ...item, completed: !item.completed } : item)) })} className="text-gray-400 hover:text-gray-600 focus:outline-none flex-shrink-0 mt-[1px] disabled:hover:text-gray-400">
              {subtask.completed ? <CheckSquare size={18} className="text-gray-800" /> : <Square size={18} />}
            </button>
            {editingSubtaskId === subtask.id ? (
              <>
                <button className="fixed inset-0 z-[50] cursor-default" onClick={() => handleSubtaskSave(subtask.id, subtask.text)} aria-label="サブタスク編集を閉じる" />
                <div className="absolute top-0 left-6 w-[calc(100%-24px)] bg-white p-2 rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.15)] border border-gray-200 flex flex-col gap-2 z-[60] animate-in zoom-in-95 duration-200 -mt-2 -ml-2">
                  <input autoFocus value={editedSubtaskText} onChange={(event) => setEditedSubtaskText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') handleSubtaskSave(subtask.id, subtask.text); }} className="w-full text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-gray-400 focus:bg-white transition-colors" placeholder="サブタスク内容" />
                  <div className="flex justify-end gap-1.5">
                    <button type="button" onClick={() => handleSubtaskSave(subtask.id, subtask.text)} className="p-1 bg-gray-800 text-white rounded hover:bg-gray-700 shadow-sm"><Check size={14} strokeWidth={3} /></button>
                    <button type="button" onClick={() => setEditingSubtaskId(null)} className="p-1 bg-white border border-gray-300 text-gray-500 rounded hover:bg-gray-50 shadow-sm"><X size={14} strokeWidth={3} /></button>
                  </div>
                </div>
              </>
            ) : (
              <span onClick={() => { if (!readOnly) { setEditingSubtaskId(subtask.id); setEditedSubtaskText(subtask.text); } }} className={`text-sm flex-1 mt-[1px] break-words rounded px-1 -mx-1 ${readOnly ? '' : 'cursor-text hover:bg-gray-50'} ${subtask.completed ? 'text-gray-400 line-through' : 'text-gray-700'}`}>{subtask.text}</span>
            )}
            {!editingSubtaskId && !readOnly ? <button type="button" onClick={() => onUpdate(task.id, { subtasks: task.subtasks.map((item) => (item.id === subtask.id ? { ...item, deletedAt: Date.now() } : item)) })} className="text-gray-400 hover:text-red-500 focus:outline-none p-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"><X size={16} /></button> : null}
          </div>
        ))}

        {!readOnly ? <form onSubmit={handleAddSubtask} className="flex items-center gap-2 mt-2">
          <button type="submit" disabled={!newSubtaskText.trim()} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-500 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-40" aria-label="サブタスクを追加">
            <Plus size={17} />
          </button>
          <input type="text" value={newSubtaskText} onChange={(event) => setNewSubtaskText(event.target.value)} placeholder="サブタスクを追加..." className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm transition-colors focus:border-gray-400 focus:bg-white focus:outline-none" />
        </form> : null}
      </div>
    </article>
  );
}


function SelectSheet({ label, value, options, onChange, size = 'sm', disabled = false }: { label: string; value: string; options: { value: string; label: string; color?: string }[]; onChange: (value: string) => void; size?: 'sm' | 'md'; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const currentOption = options.find((option) => option.value === value);
  const current = currentOption?.label || '未設定';
  const buttonHeight = size === 'md' ? 'h-[42px]' : 'h-[30px]';
  return (
    <div className="relative">
      <button type="button" disabled={disabled} onClick={() => setOpen(true)} className={`flex ${buttonHeight} w-full min-w-[84px] items-center justify-between rounded-lg border border-gray-300 bg-white px-3 text-left text-sm font-medium text-gray-600 shadow-sm hover:bg-gray-50 disabled:cursor-default disabled:bg-gray-50`}>
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 truncate">
            {currentOption?.color ? <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-black/10" style={{ backgroundColor: currentOption.color }} /> : null}
            <span className="truncate">{current}</span>
          </span>
        </span>
        <ChevronDown size={14} className="text-gray-400" />
      </button>
      {open ? (
        <>
          <button type="button" className="fixed inset-0 z-[190] cursor-default bg-black/40" onClick={() => setOpen(false)} aria-label="閉じる" />
          <div className="fixed left-1/2 top-1/2 z-[200] w-[min(calc(100vw-2rem),22rem)] max-h-[80vh] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl">
            <div className="mb-2 px-2 text-xs font-bold text-gray-500">{label}</div>
            <div className="custom-scrollbar max-h-[64vh] overflow-y-auto">
              {options.map((option) => (
                <button
                  type="button"
                  key={option.value}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium ${option.value === value ? 'bg-gray-800 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {option.color ? <span className="h-3 w-3 shrink-0 rounded-full border border-black/10" style={{ backgroundColor: option.color }} /> : null}
                    <span className="truncate">{option.label}</span>
                  </span>
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

function SortSheetTrigger({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const current = sortOptions.find((option) => option.value === value)?.label || '追加日時が新しい順';
  return (
    <div className="relative w-[142px] shrink-0 sm:w-[150px]" onClick={(event) => event.stopPropagation()}>
      <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center justify-end gap-1 bg-transparent text-[10px] font-medium text-gray-500 hover:text-gray-800 sm:text-[11px]" title="並び替え">
        <span className="min-w-0 truncate text-right">{current}</span>
        <ChevronDown size={13} className="shrink-0 text-gray-400" />
      </button>
      {open ? (
        <>
          <button type="button" className="fixed inset-0 z-[190] cursor-default bg-black/40" onClick={() => setOpen(false)} aria-label="閉じる" />
          <div className="fixed left-1/2 top-1/2 z-[200] w-[min(calc(100vw-2rem),22rem)] max-h-[80vh] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl">
            <div className="mb-2 px-2 text-xs font-bold text-gray-500">並び替え</div>
            <div className="custom-scrollbar max-h-[64vh] overflow-y-auto">
              {sortOptions.map((option) => (
                <button
                  type="button"
                  key={option.value}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium ${option.value === value ? 'bg-gray-800 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
                >
                  <span className="truncate">{option.label}</span>
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

function DateFilterButton({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <label className="mb-1 ml-1 block text-[10px] font-bold text-gray-500">{label}</label>
      <div className="relative flex h-[42px] w-full items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-2 text-sm font-medium text-gray-600 shadow-sm">
        <Calendar size={15} className="text-gray-400" />
        <span>{value ? dateLabel(value).replace(/\(.+\)/, '') : '未設定'}</span>
        <input type="date" value={value} onChange={(event) => onChange(event.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label={label} />
      </div>
    </div>
  );
}

function PriorityFilterButton({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const current = value === '' ? null : Number(value);
  const [tempPriority, setTempPriority] = useState(current ?? 50);
  useEffect(() => {
    if (!open) setTempPriority(current ?? 50);
  }, [current, open]);
  return (
    <div className="relative">
      <label className="mb-1 ml-1 block text-[10px] font-bold text-gray-500">{label}</label>
      <button type="button" onClick={() => { setTempPriority(current ?? 50); setOpen(true); }} className="flex h-[42px] w-full items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 shadow-sm hover:bg-gray-50">
        <Flag size={15} className="shrink-0 text-gray-400" />
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-200">
          <div className="h-full" style={{ width: `${current ?? 0}%`, backgroundColor: current === null ? '#d1d5db' : priorityColor(current) }} />
        </div>
        <span className="w-10 shrink-0 text-right text-xs font-bold text-gray-500" style={current === null ? undefined : { color: priorityColor(current) }}>
          {current === null ? '未設定' : current}
        </span>
      </button>
      {open ? (
        <>
          <button className="fixed inset-0 z-[190] cursor-default bg-black/40" onClick={() => setOpen(false)} aria-label={`${label}編集を閉じる`} />
          <div className="fixed left-1/2 top-1/2 z-[200] w-[min(calc(100vw-2rem),22rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl">
            <div className="mb-3 text-sm font-bold text-gray-700">{label}</div>
            <div className="flex items-center gap-3">
              <input type="range" min="0" max="100" value={tempPriority} onChange={(event) => setTempPriority(Number(event.target.value))} className="range min-w-0 flex-1" style={{ '--range-color': priorityColor(tempPriority), '--range-bg': `linear-gradient(to right, ${priorityColor(tempPriority)} ${tempPriority}%, #e5e7eb ${tempPriority}%)` } as CSSProperties} />
              <span className="w-7 text-right text-xs font-bold" style={{ color: priorityColor(tempPriority) }}>{tempPriority}</span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <button type="button" onClick={() => { onChange(''); setOpen(false); }} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-bold text-gray-500 hover:bg-gray-50">未設定</button>
              <button type="button" onClick={() => { onChange(String(tempPriority)); setOpen(false); }} className="rounded-lg bg-gray-800 px-3 py-2 text-xs font-bold text-white hover:bg-gray-700">決定</button>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-bold text-gray-500 hover:bg-gray-50">戻る</button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function AddTaskForm({ settings, onAdd, onCreateRecurrence, prefillDueDate, focusSignal }: { settings: BoardSettings; onAdd: (task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>) => void; onCreateRecurrence: (rule: RecurrenceRule) => void; prefillDueDate?: { value: string; id: number } | null; focusSignal?: number }) {
  const [title, setTitle] = useState('');
  const [statusId, setStatusId] = useState(settings.statuses[0]?.id || 'todo');
  const [assigneeId, setAssigneeId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState(50);
  const [collapsed, setCollapsed] = useState(false);
  const [recurrenceOpen, setRecurrenceOpen] = useState(false);
  const [recurrenceMemo, setRecurrenceMemo] = useState('');
  const [recurrenceSubtasks, setRecurrenceSubtasks] = useState('');
  const [scheduleType, setScheduleType] = useState<RecurrenceRule['scheduleType']>('weekly');
  const [recurrenceTime, setRecurrenceTime] = useState('09:00');
  const [weekdays, setWeekdays] = useState<number[]>([new Date().getDay()]);
  const [dayOfMonth, setDayOfMonth] = useState(new Date().getDate());
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const dueDateInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!settings.statuses.some((status) => status.id === statusId)) setStatusId(settings.statuses[0]?.id || 'todo');
    if (assigneeId && !settings.assignees.some((assignee) => assignee.id === assigneeId)) setAssigneeId('');
  }, [settings, statusId, assigneeId]);

  useEffect(() => {
    if (!prefillDueDate) return;
    setDueDate(prefillDueDate.value);
    setCollapsed(false);
    window.setTimeout(() => titleInputRef.current?.focus(), 120);
  }, [prefillDueDate]);

  useEffect(() => {
    if (!focusSignal) return;
    setCollapsed(false);
    window.setTimeout(() => titleInputRef.current?.focus(), 120);
  }, [focusSignal]);

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

  const openDueDatePicker = () => {
    const input = dueDateInputRef.current;
    if (input?.showPicker) input.showPicker();
    else input?.click();
    input?.focus();
  };

  const saveRecurrence = () => {
    const now = Date.now();
    const rule: RecurrenceRule = {
      id: crypto.randomUUID(),
      title: title.trim() || '繰り返しタスク',
      statusId,
      assigneeIds: assigneeId ? [assigneeId] : [],
      priority,
      memo: recurrenceMemo,
      subtasks: recurrenceSubtasks
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean)
        .map((text) => ({ id: crypto.randomUUID(), text, completed: false, deletedAt: null })),
      scheduleType,
      time: recurrenceTime,
      weekdays,
      dayOfMonth,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      lastGeneratedAt: now,
    };
    onCreateRecurrence(rule);
    setRecurrenceOpen(false);
    setRecurrenceMemo('');
    setRecurrenceSubtasks('');
  };

  return (
    <div id="add-task-form" className="rounded-xl border border-gray-300 bg-white shadow-md">
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        className={`flex w-full cursor-pointer select-none items-center justify-between bg-white px-4 py-3.5 transition-colors hover:bg-gray-50 sm:px-5 ${collapsed ? 'rounded-xl' : 'rounded-t-xl'}`}
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
                <label className="mb-1 ml-1 block text-[10px] font-bold text-gray-500">タイトル</label>
                <input ref={titleInputRef} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="タスクのタイトルを入力..." className="h-[42px] w-full rounded-lg border border-gray-300 px-3 text-sm outline-none focus:border-gray-500 focus:ring-1 focus:ring-gray-500" />
              </div>
              <div className="w-[110px] shrink-0 sm:w-[130px]">
                <label className="mb-1 ml-1 block text-[10px] font-bold text-gray-500">ステータス</label>
                <SelectSheet label="ステータス" value={statusId} options={settings.statuses.map((status) => ({ value: status.id, label: status.title, color: status.color }))} onChange={setStatusId} size="md" />
              </div>
              <div className="hidden shrink-0 sm:block">
                <button className="flex h-[42px] items-center justify-center gap-1.5 rounded-lg bg-gray-800 px-5 text-sm font-medium text-white transition-colors hover:bg-gray-700">
                  <Plus size={18} />追加
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 sm:gap-4">
              <div className="w-[150px] shrink-0 sm:w-[170px]">
                <label className="mb-1 ml-1 block text-[10px] font-bold text-gray-500">担当者</label>
                <SelectSheet label="担当" value={assigneeId} options={[{ value: '', label: '未設定' }, ...settings.assignees.map((assignee) => ({ value: assignee.id, label: assignee.name, color: assignee.color }))]} onChange={setAssigneeId} size="md" />
              </div>
              <div className="w-[104px] shrink-0 sm:w-[112px]">
                <label className="mb-1 ml-1 block text-[10px] font-bold text-gray-500">期日</label>
                <button type="button" onClick={openDueDatePicker} className="relative flex h-[42px] w-full items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-2 text-sm font-medium text-gray-600 shadow-sm hover:bg-gray-50">
                  <Calendar size={15} className="text-gray-400" />
                  <span>{dueDate ? dateLabel(dueDate).replace(/\(.+\)/, '') : '未設定'}</span>
                  <input ref={dueDateInputRef} type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="pointer-events-none absolute h-px w-px opacity-0" tabIndex={-1} aria-label="期日" />
                </button>
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
            <div className="mt-1 grid grid-cols-[max-content_1fr] gap-2 sm:flex sm:justify-end">
              <button type="button" onClick={() => setRecurrenceOpen(true)} className="box-border flex h-[42px] min-h-[42px] w-max items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium leading-none text-gray-600 shadow-sm hover:bg-gray-50">
                <Repeat size={18} />繰り返し設定
              </button>
              <button className="flex h-[42px] items-center justify-center gap-2 rounded-lg bg-gray-800 px-4 text-sm font-medium text-white transition-colors hover:bg-gray-700 sm:hidden">
                <Plus size={18} />追加
              </button>
            </div>
          </div>
        </form>
      ) : null}
      {recurrenceOpen ? (
        <div className="fixed inset-0 z-[190] flex items-center justify-center bg-black/45 p-4">
          <div className="custom-scrollbar max-h-[84vh] w-full max-w-md overflow-y-auto rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-lg font-bold text-gray-800"><Repeat size={20} className="text-gray-500" />繰り返し設定</h3>
              <button type="button" onClick={() => setRecurrenceOpen(false)} className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-800"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 ml-1 block text-[10px] font-bold text-gray-500">タスク名</label>
                <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="繰り返しタスク名..." className="h-[42px] w-full rounded-lg border border-gray-300 px-3 text-sm outline-none focus:border-gray-500" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  ['daily', '毎日'],
                  ['weekly', '毎週'],
                  ['monthly', '毎月'],
                ].map(([value, label]) => (
                  <button key={value} type="button" onClick={() => setScheduleType(value as RecurrenceRule['scheduleType'])} className={`h-10 rounded-lg border text-sm font-bold ${scheduleType === value ? 'border-gray-800 bg-gray-800 text-white' : 'border-gray-300 bg-white text-gray-600'}`}>
                    {label}
                  </button>
                ))}
              </div>
              {scheduleType === 'weekly' ? (
                <div className="grid grid-cols-7 gap-1">
                  {['日', '月', '火', '水', '木', '金', '土'].map((label, index) => (
                    <button key={label} type="button" onClick={() => setWeekdays((current) => current.includes(index) ? current.filter((item) => item !== index) : [...current, index])} className={`h-9 rounded-lg border text-xs font-bold ${weekdays.includes(index) ? 'border-gray-800 bg-gray-800 text-white' : 'border-gray-300 bg-white text-gray-500'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              ) : null}
              {scheduleType === 'monthly' ? (
                <div>
                  <label className="mb-1 ml-1 block text-[10px] font-bold text-gray-500">毎月の日付</label>
                  <input type="number" min={1} max={31} value={dayOfMonth} onChange={(event) => setDayOfMonth(Math.max(1, Math.min(31, Number(event.target.value) || 1)))} className="h-[42px] w-full rounded-lg border border-gray-300 px-3 text-sm outline-none focus:border-gray-500" />
                </div>
              ) : null}
              <div>
                <label className="mb-1 ml-1 block text-[10px] font-bold text-gray-500">生成時刻</label>
                <input type="time" value={recurrenceTime} onChange={(event) => setRecurrenceTime(event.target.value)} className="h-[42px] w-full rounded-lg border border-gray-300 px-3 text-sm outline-none focus:border-gray-500" />
              </div>
              <textarea value={recurrenceMemo} onChange={(event) => setRecurrenceMemo(event.target.value)} rows={2} placeholder="説明・メモ..." className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-500" />
              <textarea value={recurrenceSubtasks} onChange={(event) => setRecurrenceSubtasks(event.target.value)} rows={3} placeholder="サブタスクを1行ずつ入力..." className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-500" />
              <button type="button" onClick={saveRecurrence} disabled={scheduleType === 'weekly' && weekdays.length === 0} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-gray-800 text-sm font-bold text-white hover:bg-gray-700 disabled:opacity-40">
                <Repeat size={17} />繰り返しを保存
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BoardView({ board, settings, tasks, sourceBoards = [], onAddTask, onUpdateTask, onTrashTask, onArchiveTask, onCreateRecurrence, onOpenSourceBoard, onOpenSourceTask, highlightedTaskId, prefillDueDate, disableAdd = false, disableDelete = false, disableStatus = false }: {
  board: Board;
  settings: BoardSettings;
  tasks: Task[];
  sourceBoards?: Board[];
  onAddTask: (task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onUpdateTask: (task: Task, updates: Partial<Task>) => void;
  onTrashTask: (task: Task) => void;
  onArchiveTask: (task: Task) => void;
  onCreateRecurrence: (rule: RecurrenceRule) => void;
  onOpenSourceBoard?: (boardId: string) => void;
  onOpenSourceTask?: (task: Task) => void;
  highlightedTaskId?: string | null;
  prefillDueDate?: { value: string; id: number } | null;
  disableAdd?: boolean;
  disableDelete?: boolean;
  disableStatus?: boolean;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);
  const [columnSorts, setColumnSorts] = useState<Record<string, string>>({});
  const [addTaskFocusSignal, setAddTaskFocusSignal] = useState(0);
  const visibleTasks = tasks.filter((task) => !task.deletedAt && !task.archivedAt);

  useEffect(() => {
    if (!highlightedTaskId) return;
    const targetTask = visibleTasks.find((task) => task.id === highlightedTaskId);
    if (!targetTask) return;
    setCollapsed((current) => (current[targetTask.statusId] === false ? current : { ...current, [targetTask.statusId]: false }));
    window.setTimeout(() => {
      document.getElementById(`task-${highlightedTaskId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
  }, [highlightedTaskId, tasks]);

  const sortedColumnTasks = (statusId: string) => {
    const sortOrder = columnSorts[statusId] || 'createdAt-desc';
    return visibleTasks.filter((task) => task.statusId === statusId).sort((a, b) => {
      if (sortOrder === 'priority-desc') return (b.priority || 0) - (a.priority || 0);
      if (sortOrder === 'priority-asc') return (a.priority || 0) - (b.priority || 0);
      if (sortOrder === 'dueDate-asc') {
        if (!a.dueDate && !b.dueDate) return (a.createdAt || 0) - (b.createdAt || 0);
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate.localeCompare(b.dueDate);
      }
      if (sortOrder === 'dueDate-desc') {
        if (!a.dueDate && !b.dueDate) return (a.createdAt || 0) - (b.createdAt || 0);
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return b.dueDate.localeCompare(a.dueDate);
      }
      if (sortOrder === 'createdAt-desc') return (b.createdAt || 0) - (a.createdAt || 0);
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
  };

  return (
    <div className="relative space-y-4">
      {disableAdd ? (
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm leading-6 text-gray-500 shadow-sm">
          <div className="font-bold text-gray-700">まとめボード</div>
          <div>まとめボードでは複数ボードのタスクを表示します。</div>
          <div>タスク追加・削除は元のボードで行います。</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {sourceBoards.length ? sourceBoards.map((sourceBoard) => (
              <button type="button" key={sourceBoard.id} onClick={() => onOpenSourceBoard?.(sourceBoard.id)} className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-bold text-gray-500 hover:bg-gray-100 hover:text-gray-700">
                <LayoutDashboard size={12} />{sourceBoard.title}
              </button>
            )) : <span className="text-xs text-gray-400">まとめ対象のボードがありません</span>}
          </div>
        </div>
      ) : (
        <AddTaskForm settings={settings} onAdd={onAddTask} onCreateRecurrence={onCreateRecurrence} prefillDueDate={prefillDueDate} focusSignal={addTaskFocusSignal} />
      )}

      {!disableAdd && visibleTasks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white px-4 py-6 text-center shadow-sm">
          <div className="text-sm font-bold text-gray-700">タスクがありません</div>
          <div className="mt-1 text-xs text-gray-400">最初のタスクを追加して、ボードを使い始めましょう。</div>
          <button type="button" onClick={() => setAddTaskFocusSignal(Date.now())} className="mt-3 rounded-lg bg-gray-800 px-4 py-2 text-sm font-bold text-white hover:bg-gray-700">新しいタスクを追加</button>
        </div>
      ) : null}

      <div className="flex flex-col items-start gap-4 overflow-x-auto pb-4 sm:gap-6 md:flex-row">
        {settings.statuses.map((status) => {
          const columnTasks = sortedColumnTasks(status.id);
          const isCollapsed = collapsed[status.id] ?? (settings.defaultCollapsed ?? false);
          const sortOrder = columnSorts[status.id] || 'createdAt-desc';
          return (
            <section key={status.id} style={{ borderColor: translucent(status.color, '55'), boxShadow: `inset 3px 0 0 ${translucent(status.color, '66')}` }} className="w-full md:w-auto flex-1 md:min-w-[360px] bg-gray-50/50 border rounded-xl p-2.5 sm:p-4" onDragOver={(event) => event.preventDefault()} onDrop={() => { if (!disableStatus && draggedTask) onUpdateTask(draggedTask, { statusId: status.id }); setDraggedTask(null); }}>
              <h2 onClick={() => setCollapsed((value) => ({ ...value, [status.id]: !isCollapsed }))} className="mb-2 flex cursor-pointer items-center justify-between border-b border-gray-200 pb-2">
                <button type="button" onClick={(event) => { event.stopPropagation(); setCollapsed((value) => ({ ...value, [status.id]: !isCollapsed })); }} className="flex items-center gap-1.5 font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 rounded px-1 py-1 transition-colors select-none">
                  {isCollapsed ? <ChevronRight size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-black/10" style={{ backgroundColor: status.color }} />
                  {status.title}
                  <span className="bg-white border border-gray-200 text-gray-600 text-xs px-2 py-0.5 rounded-full shadow-sm ml-1">{columnTasks.length}</span>
                </button>
                {!isCollapsed ? (
                  <SortSheetTrigger
                    value={sortOrder}
                    onChange={(nextValue) => setColumnSorts((current) => ({ ...current, [status.id]: nextValue }))}
                  />
                ) : null}
              </h2>
              {!isCollapsed ? (
                <div className="space-y-3 sm:space-y-4 min-h-[100px] mt-3 animate-in slide-in-from-top-2 fade-in duration-200">
                  {columnTasks.map((task) => <TaskCard key={`${task.sourceBoardId || board.id}-${task.id}`} task={task} settings={settings} onUpdate={(_, updates) => onUpdateTask(task, updates)} onTrash={() => onTrashTask(task)} onArchive={() => onArchiveTask(task)} onCreateRecurrence={onCreateRecurrence} onDragStart={() => !disableStatus && setDraggedTask(task)} onOpenSourceTask={onOpenSourceTask} highlighted={highlightedTaskId === task.id} disableDelete={disableDelete} disableStatus={disableStatus} />)}
                  {columnTasks.length === 0 ? (
                    <div className="rounded-lg border-2 border-dashed border-gray-200 bg-gray-50/50 px-3 py-6 text-center">
                      <div className="text-sm text-gray-400">タスクはありません</div>
                      {!disableAdd ? <button type="button" onClick={() => setAddTaskFocusSignal(Date.now())} className="mt-2 text-xs font-bold text-gray-600 underline underline-offset-2">新しいタスクを追加</button> : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      <div className="text-center text-xs text-gray-400">Simple Task Board</div>
      {!disableAdd ? <button
        type="button"
        onClick={() => {
          setAddTaskFocusSignal(Date.now());
          document.getElementById('add-task-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}
        className="fixed bottom-[calc(env(safe-area-inset-bottom)+88px)] right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-gray-800 text-white shadow-xl transition-transform hover:bg-gray-700 active:scale-95 md:bottom-6 md:right-6"
        aria-label="新しいタスクを追加"
      >
        <Plus size={26} strokeWidth={2.5} />
      </button> : null}
    </div>
  );
}


function TaskListItem({ task, settings, onOpenTask }: { task: Task; settings: BoardSettings; onOpenTask: (task: Task) => void }) {
  const status = settings.statuses.find((item) => item.id === task.statusId);
  const assignees = settings.assignees.filter((assignee) => task.assigneeIds.includes(assignee.id));
  return (
    <button type="button" onClick={() => onOpenTask(task)} className="block w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-left shadow-sm transition-colors hover:bg-gray-50">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 break-words text-sm font-bold text-gray-800">{task.title}</div>
        <div className="shrink-0 pt-0.5 text-[10px] leading-none text-gray-400">
          追加: {task.createdAt ? formatDateTime(task.createdAt) : '-'}
        </div>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-medium text-gray-500">
        {status ? <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5"><span className="h-2 w-2 rounded-full border border-black/10" style={{ backgroundColor: status.color }} />{status.title}</span> : null}
        {assignees.map((assignee) => <span key={assignee.id} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5"><span className="h-2 w-2 rounded-full border border-black/10" style={{ backgroundColor: assignee.color }} />{assignee.name}</span>)}
      </div>
      <div className="mt-2 grid grid-cols-[92px_1fr] gap-2">
        <div className={`flex h-[30px] items-center justify-center gap-1 rounded-md border text-xs font-semibold ${dueDateTone(task.dueDate)}`}>
          <Calendar size={13} />
          <span>{task.dueDate ? dateLabel(task.dueDate).replace(/\(.+\)/, '') : '未設定'}</span>
        </div>
        <div className="flex h-[30px] items-center gap-2 rounded-md border border-gray-200 bg-white px-2">
          <Flag size={13} className="shrink-0 text-gray-400" />
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-200">
            <div className="h-full" style={{ width: `${task.priority}%`, backgroundColor: priorityColor(task.priority) }} />
          </div>
          <span className="w-6 text-right text-[10px] font-bold" style={{ color: priorityColor(task.priority) }}>{task.priority}</span>
        </div>
      </div>
    </button>
  );
}

function CalendarView({ tasks, settings, onOpenTask, onCreateTaskForDate }: {
  tasks: Task[];
  settings: BoardSettings;
  onOpenTask: (task: Task) => void;
  onCreateTaskForDate: (date: string) => void;
}) {
  const [viewMode, setViewMode] = useState<'month' | 'week' | 'list'>('month');
  const [selectedDate, setSelectedDate] = useState(today);
  const [focusedCalendarTaskId, setFocusedCalendarTaskId] = useState<string | null>(null);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const dueTasks = tasks.filter((task) => !task.deletedAt && !task.archivedAt && task.dueDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const noDueTasks = tasks.filter((task) => !task.deletedAt && !task.archivedAt && !task.dueDate);
  const grouped = dueTasks.reduce<Record<string, Task[]>>((acc, task) => {
    acc[task.dueDate] = [...(acc[task.dueDate] || []), task];
    return acc;
  }, {});
  const groupedByMonth = dueTasks.reduce<Record<string, Record<string, Task[]>>>((acc, task) => {
    const monthKey = task.dueDate.slice(0, 7);
    acc[monthKey] = acc[monthKey] || {};
    acc[monthKey][task.dueDate] = [...(acc[monthKey][task.dueDate] || []), task];
    return acc;
  }, {});
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const base = dueTasks[0]?.dueDate ? new Date(`${dueTasks[0].dueDate}T00:00:00`) : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const startDate = new Date(year, month, 1 - firstDay.getDay());
  const calendarDays = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + index);
    return date;
  });
  const todayKey = today;
  const dateKey = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };
  const selected = new Date(`${selectedDate}T00:00:00`);
  const weekStart = new Date(selected);
  weekStart.setDate(selected.getDate() - selected.getDay());
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);
    return date;
  });
  const moveWeek = (amount: number) => {
    const next = new Date(`${selectedDate}T00:00:00`);
    next.setDate(next.getDate() + amount * 7);
    setSelectedDate(dateKey(next));
    setVisibleMonth(new Date(next.getFullYear(), next.getMonth(), 1));
  };

  const moveMonth = (amount: number) => {
    setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1));
  };

  const jumpToThisMonth = () => {
    const now = new Date();
    setSelectedDate(today);
    setVisibleMonth(new Date(now.getFullYear(), now.getMonth(), 1));
  };

  const jumpToThisWeek = () => {
    const now = new Date();
    setSelectedDate(today);
    setVisibleMonth(new Date(now.getFullYear(), now.getMonth(), 1));
  };

  const startSwipe = (event: PointerEvent<HTMLDivElement>) => {
    if (viewMode === 'list') return;
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
    if ((event.target as HTMLElement).closest('input,select,textarea,a')) return;
    swipeStartRef.current = { x: event.clientX, y: event.clientY };
  };

  const endSwipe = (event: PointerEvent<HTMLDivElement>) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start || viewMode === 'list') return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    if (viewMode === 'month') moveMonth(dx > 0 ? -1 : 1);
    if (viewMode === 'week') moveWeek(dx > 0 ? -1 : 1);
  };

  const startTouchSwipe = (event: TouchEvent<HTMLDivElement>) => {
    if (viewMode === 'list') return;
    if ((event.target as HTMLElement).closest('input,select,textarea,a')) return;
    const touch = event.touches[0];
    if (!touch) return;
    swipeStartRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const endTouchSwipe = (event: TouchEvent<HTMLDivElement>) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start || viewMode === 'list') return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 54 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
    event.preventDefault();
    event.stopPropagation();
    if (viewMode === 'month') moveMonth(dx > 0 ? -1 : 1);
    if (viewMode === 'week') moveWeek(dx > 0 ? -1 : 1);
  };

  const focusMonthTask = (task: Task) => {
    setSelectedDate(task.dueDate);
    setFocusedCalendarTaskId(task.id);
    window.setTimeout(() => {
      document.getElementById(`calendar-task-${task.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
  };

  return (
    <div className="space-y-4">
      <section className="touch-pan-y overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm" onPointerDown={startSwipe} onPointerUp={endSwipe} onPointerCancel={() => { swipeStartRef.current = null; }} onTouchStart={startTouchSwipe} onTouchEnd={endTouchSwipe} onTouchCancel={() => { swipeStartRef.current = null; }}>
        <div className="border-b border-gray-200 bg-gray-50 px-3 py-3 sm:px-4">
          <div className="mb-3 grid grid-cols-3 rounded-lg bg-gray-200 p-1">
            {[
              { id: 'month', label: '月' },
              { id: 'week', label: '週' },
              { id: 'list', label: '一覧' },
            ].map((item) => (
              <button key={item.id} type="button" onClick={() => setViewMode(item.id as 'month' | 'week' | 'list')} className={`rounded-md px-2 py-1.5 text-xs font-bold transition-colors ${viewMode === item.id ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'}`}>
                {item.label}
              </button>
            ))}
          </div>
          {viewMode === 'month' ? (
            <div className="grid grid-cols-[44px_1fr_44px] items-center gap-2">
              <button type="button" onClick={() => moveMonth(-1)} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-bold text-gray-600 shadow-sm hover:bg-gray-50">‹</button>
              <div className="relative min-w-0 text-center">
                <h2 className="text-base font-bold text-gray-800 sm:text-lg">{year}年 {month + 1}月</h2>
                <button type="button" onClick={jumpToThisMonth} className="absolute left-[calc(50%+58px)] top-1/2 -translate-y-1/2 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[11px] font-bold text-gray-500 shadow-sm hover:bg-gray-50">今月</button>
              </div>
              <button type="button" onClick={() => moveMonth(1)} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-bold text-gray-600 shadow-sm hover:bg-gray-50">›</button>
            </div>
          ) : null}
          {viewMode === 'week' ? (
            <div className="grid grid-cols-[72px_1fr_72px] items-center gap-2">
              <button type="button" onClick={() => moveWeek(-1)} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-bold text-gray-600 shadow-sm">前の週</button>
              <div className="relative min-w-0 text-center">
                <div className="min-w-0 text-center text-xs font-bold leading-5 text-gray-700 sm:text-sm">{dateLabel(dateKey(weekDays[0]))} 〜 {dateLabel(dateKey(weekDays[6]))}</div>
                <button type="button" onClick={jumpToThisWeek} className="absolute left-[calc(50%+78px)] top-1/2 -translate-y-1/2 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[11px] font-bold text-gray-500 shadow-sm hover:bg-gray-50">今週</button>
              </div>
              <button type="button" onClick={() => moveWeek(1)} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-bold text-gray-600 shadow-sm">次の週</button>
            </div>
          ) : null}
        </div>

        {viewMode === 'month' ? (
          <>
            <div className="grid grid-cols-7 border-b border-gray-200 bg-white text-center text-[11px] font-bold text-gray-400">
              {['日', '月', '火', '水', '木', '金', '土'].map((day) => <div key={day} className="py-2">{day}</div>)}
            </div>
            <div className="grid grid-cols-7 bg-gray-200 gap-px">
              {calendarDays.map((date) => {
                const key = dateKey(date);
                const items = grouped[key] || [];
                const inMonth = date.getMonth() === month;
                return (
                  <div key={key} onClick={() => setSelectedDate(key)} className={`min-h-[92px] bg-white p-1.5 text-left sm:min-h-[124px] sm:p-2 ${inMonth ? '' : 'bg-gray-50 text-gray-300'} ${key === selectedDate ? 'ring-2 ring-inset ring-gray-700' : ''}`}>
                    <button type="button" onClick={(event) => { event.stopPropagation(); setSelectedDate(key); onCreateTaskForDate(key); }} className={`mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${key === todayKey ? 'bg-gray-800 text-white' : inMonth ? 'text-gray-700 hover:bg-gray-100' : 'text-gray-300 hover:bg-gray-100'}`} title={`${dateLabel(key)}のタスクを作成`}>
                      {date.getDate()}
                    </button>
                    <div className="space-y-1">
                      {items.slice(0, 3).map((task) => (
                        <button key={task.id} type="button" onClick={(event) => { event.stopPropagation(); focusMonthTask(task); }} className="block w-full truncate rounded-md border border-gray-200 bg-gray-50 px-1.5 py-1 text-left text-[10px] font-bold text-gray-700 hover:bg-white sm:text-xs" title={task.title}>
                          {task.title}
                        </button>
                      ))}
                      {items.length > 3 ? <div className="px-1 text-[10px] font-bold text-gray-400">+{items.length - 3}件</div> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : null}

        {viewMode === 'week' ? (
          <div className="p-3">
            <div className="space-y-2">
              {weekDays.map((date) => {
                const key = dateKey(date);
                const items = grouped[key] || [];
                return (
                  <section key={key} className={`rounded-xl border p-3 ${key === todayKey ? 'border-gray-800 bg-gray-50' : 'border-gray-200 bg-white'}`}>
                    <div className="mb-2 flex items-center justify-between">
                      <button type="button" onClick={() => onCreateTaskForDate(key)} className="rounded-md px-1 py-0.5 text-left text-sm font-bold text-gray-800 hover:bg-gray-100">{dateLabel(key)}</button>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-500">{items.length}件</span>
                    </div>
                    <div className="space-y-2">
                      {items.map((task) => (
                        <TaskListItem key={task.id} task={task} settings={settings} onOpenTask={onOpenTask} />
                      ))}
                      {items.length === 0 ? <div className="rounded-lg border border-dashed border-gray-200 py-3 text-center text-xs text-gray-400">予定なし</div> : null}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        ) : null}

        {viewMode === 'list' ? (
          <div className="space-y-3 p-3">
            {Object.entries(groupedByMonth).map(([monthKey, days]) => (
              <section key={monthKey} className="rounded-xl border border-gray-200 bg-white p-3">
                <h3 className="mb-3 border-b border-gray-100 pb-2 font-bold text-gray-800">{Number(monthKey.slice(0, 4))}年 {Number(monthKey.slice(5, 7))}月</h3>
                <div className="space-y-3">
                  {Object.entries(days).map(([date, items]) => (
                    <div key={date}>
                      <h4 className="mb-2 text-sm font-bold text-gray-600">{dateLabel(date)}</h4>
                      <div className="space-y-2">
                        {items.map((task) => (
                          <TaskListItem key={task.id} task={task} settings={settings} onOpenTask={onOpenTask} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : null}
        {dueTasks.length === 0 ? (
          <div className="border-t border-gray-200 px-4 py-8 text-center text-sm text-gray-400">
            <div className="font-bold text-gray-600">期日ありタスクはありません</div>
            <div className="mt-1 text-xs">日付を押すと、その日付でタスクを作成できます。</div>
            <button type="button" onClick={() => onCreateTaskForDate(today)} className="mt-3 rounded-lg bg-gray-800 px-4 py-2 text-xs font-bold text-white hover:bg-gray-700">今日のタスクを作る</button>
          </div>
        ) : null}
      </section>

      {viewMode === 'month' ? <div className="grid gap-3 sm:grid-cols-2">
        {Object.entries(grouped)
          .filter(([date]) => new Date(`${date}T00:00:00`).getMonth() === month && new Date(`${date}T00:00:00`).getFullYear() === year)
          .map(([date, items]) => (
            <section key={date} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <h3 className="mb-3 font-bold text-gray-800">{dateLabel(date)}</h3>
              <div className="space-y-2">
                {items.map((task) => (
                  <div id={`calendar-task-${task.id}`} key={task.id} className={focusedCalendarTaskId === task.id ? 'rounded-xl ring-2 ring-gray-500 ring-offset-2' : ''}>
                    <TaskListItem task={task} settings={settings} onOpenTask={onOpenTask} />
                  </div>
                ))}
              </div>
            </section>
          ))}
      </div> : null}
      <details className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <summary className="cursor-pointer font-semibold text-gray-800">期日なしタスク {noDueTasks.length}件</summary>
        <div className="mt-3 space-y-2">
          {noDueTasks.map((task) => (
            <TaskListItem key={task.id} task={task} settings={settings} onOpenTask={onOpenTask} />
          ))}
          {noDueTasks.length === 0 ? <div className="rounded-lg border border-dashed border-gray-200 py-4 text-center text-xs text-gray-400">期日なしタスクはありません</div> : null}
        </div>
      </details>
    </div>
  );
}

function SearchView({ tasks, settings, onOpenTask }: { tasks: Task[]; settings: BoardSettings; onOpenTask: (task: Task) => void }) {
  const [query, setQuery] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [dueDateFrom, setDueDateFrom] = useState('');
  const [dueDateTo, setDueDateTo] = useState('');
  const [priorityFrom, setPriorityFrom] = useState('');
  const [priorityTo, setPriorityTo] = useState('');
  const [sortOrder, setSortOrder] = useState('createdAt-desc');
  const [filtersOpen, setFiltersOpen] = useState(true);
  const filtered = tasks
    .filter((task) => !task.deletedAt && !task.archivedAt)
    .filter((task) => [task.title, task.memo, ...task.subtasks.map((subtask) => subtask.text)].join(' ').toLowerCase().includes(query.toLowerCase()))
    .filter((task) => !assigneeId || task.assigneeIds.includes(assigneeId))
    .filter((task) => !dueDateFrom || (!!task.dueDate && task.dueDate >= dueDateFrom))
    .filter((task) => !dueDateTo || (!!task.dueDate && task.dueDate <= dueDateTo))
    .filter((task) => priorityFrom === '' || task.priority >= Number(priorityFrom))
    .filter((task) => priorityTo === '' || task.priority <= Number(priorityTo))
    .sort((a, b) => {
      if (sortOrder === 'priority-desc') return b.priority - a.priority;
      if (sortOrder === 'priority-asc') return a.priority - b.priority;
      if (sortOrder === 'dueDate-asc') {
        if (!a.dueDate && !b.dueDate) return b.createdAt - a.createdAt;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate.localeCompare(b.dueDate);
      }
      if (sortOrder === 'createdAt-asc') return a.createdAt - b.createdAt;
      return b.createdAt - a.createdAt;
    });
  const clearFilters = () => {
    setQuery('');
    setAssigneeId('');
    setDueDateFrom('');
    setDueDateTo('');
    setPriorityFrom('');
    setPriorityTo('');
    setSortOrder('createdAt-desc');
  };
  return (
    <div className="space-y-4">
      <section className={`rounded-xl border border-gray-300 bg-white shadow-md ${filtersOpen ? 'p-3' : 'px-3 py-2.5'}`}>
        <div onClick={() => setFiltersOpen((value) => !value)} className={`flex cursor-pointer items-center justify-between gap-2 ${filtersOpen ? 'mb-3' : ''}`}>
          <button type="button" onClick={(event) => { event.stopPropagation(); setFiltersOpen((value) => !value); }} className="flex items-center gap-2 text-sm font-bold text-gray-700">
            <Filter size={16} className="text-gray-500" />絞り込み
            {filtersOpen ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
          </button>
          <div className="flex items-center gap-1.5" onClick={(event) => event.stopPropagation()}>
            {filtersOpen ? <button type="button" onClick={() => setFiltersOpen(false)} className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-gray-700">適用</button> : null}
            <button type="button" onClick={() => { clearFilters(); setFiltersOpen(true); }} className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs font-bold text-gray-500 shadow-sm hover:bg-gray-50"><RotateCcw size={13} />リセット</button>
          </div>
        </div>
        {filtersOpen ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="mb-1 ml-1 block text-[10px] font-bold text-gray-500">並び順</label>
              <SelectSheet label="並び順" value={sortOrder} options={sortOptions} onChange={setSortOrder} size="md" />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 ml-1 block text-[10px] font-bold text-gray-500">キーワード</label>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onBlur={() => query && setFiltersOpen(false)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') setFiltersOpen(false);
                }}
                placeholder="タスクを文字列検索..."
                className="h-[42px] w-full rounded-lg border border-gray-300 bg-white px-3 text-sm shadow-sm outline-none focus:border-gray-500 focus:ring-1 focus:ring-gray-500"
              />
            </div>
            <div>
              <label className="mb-1 ml-1 block text-[10px] font-bold text-gray-500">担当者</label>
              <SelectSheet label="担当" value={assigneeId} options={[{ value: '', label: 'すべて' }, ...settings.assignees.map((assignee) => ({ value: assignee.id, label: assignee.name, color: assignee.color }))]} onChange={setAssigneeId} size="md" />
            </div>
            <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
              <DateFilterButton label="期日 開始" value={dueDateFrom} onChange={setDueDateFrom} />
              <span className="pb-3 text-xs font-bold text-gray-400">〜</span>
              <DateFilterButton label="期日 終了" value={dueDateTo} onChange={setDueDateTo} />
            </div>
            <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2 sm:col-span-2">
              <PriorityFilterButton label="優先度 下限" value={priorityFrom} onChange={setPriorityFrom} />
              <span className="pb-3 text-xs font-bold text-gray-400">〜</span>
              <PriorityFilterButton label="優先度 上限" value={priorityTo} onChange={setPriorityTo} />
            </div>
          </div>
        ) : null}
      </section>
      <div className="space-y-2">
        {filtered.map((task) => (
          <TaskListItem key={task.id} task={task} settings={settings} onOpenTask={onOpenTask} />
        ))}
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-400">
            <div className="font-bold text-gray-600">条件に合うタスクはありません</div>
            <div className="mt-1 text-xs">条件を変えるか、リセットして探してみましょう。</div>
            <button type="button" onClick={() => { clearFilters(); setFiltersOpen(true); }} className="mt-3 rounded-lg border border-gray-300 bg-white px-4 py-2 text-xs font-bold text-gray-600 shadow-sm hover:bg-gray-50">条件をリセット</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function BoardSettingsModal({
  open,
  board,
  sourceBoards = [],
  settings,
  isOwner,
  isGuest,
  onClose,
  onRenameBoard,
  onUpdateSettings,
  onInvite,
  onRemoveMember,
  onLeaveBoard,
  onUpdateTask,
  onOpenSourceBoard,
  onGenerateRecurrence,
  onRestore,
  onRestoreTask,
  onHardDeleteTask,
  onEmptyDone,
  onEmptyTrash,
  onDeleteBoard,
  tasks,
}: {
  open: boolean;
  board: Board;
  sourceBoards?: Board[];
  settings: BoardSettings;
  isOwner: boolean;
  isGuest: boolean;
  onClose: () => void;
  onRenameBoard: (title: string) => void;
  onUpdateSettings: (settings: Partial<BoardSettings>) => void;
  onInvite: (email: string) => void;
  onRemoveMember: (uid: string, email: string) => void;
  onLeaveBoard: () => void;
  onUpdateTask: (taskId: string, updates: Partial<Task>) => void;
  onOpenSourceBoard?: (boardId: string) => void;
  onGenerateRecurrence: (rule: RecurrenceRule) => void;
  onRestore: (data: BackupData, mode: 'append' | 'replace') => void;
  onRestoreTask: (taskId: string) => void;
  onHardDeleteTask: (taskId: string) => void;
  onEmptyDone: () => void;
  onEmptyTrash: () => void;
  onDeleteBoard: () => void;
  tasks: Task[];
}) {
  const [boardTitle, setBoardTitle] = useState(board.title);
  const [inviteEmail, setInviteEmail] = useState('');
  const [newAssigneeName, setNewAssigneeName] = useState('');
  const [newStatusName, setNewStatusName] = useState('');
  const [editingAssigneeId, setEditingAssigneeId] = useState<string | null>(null);
  const [editingStatusId, setEditingStatusId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [dragItem, setDragItem] = useState<{ kind: 'assignee' | 'status'; id: string } | null>(null);
  const dragTimerRef = useRef<number | null>(null);
  const [activeTab, setActiveTab] = useState<'settings' | 'archive' | 'trash'>('settings');
  const [selectedArchiveIds, setSelectedArchiveIds] = useState<string[]>([]);
  const [confirmEmptyTrash, setConfirmEmptyTrash] = useState(false);
  const [confirmBoardDelete, setConfirmBoardDelete] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreData, setRestoreData] = useState<BackupData | null>(null);
  const [restoreFileName, setRestoreFileName] = useState('');
  const [restoreError, setRestoreError] = useState('');
  const isAggregate = board.kind === 'aggregate';

  useEffect(() => {
    setBoardTitle(board.title);
    setInviteEmail('');
    setActiveTab('settings');
    setEditingAssigneeId(null);
    setEditingStatusId(null);
    setDraftName('');
    setDragItem(null);
    setSelectedArchiveIds([]);
    setConfirmEmptyTrash(false);
    setConfirmBoardDelete(false);
    setRestoreOpen(false);
    setRestoreData(null);
    setRestoreFileName('');
    setRestoreError('');
  }, [board.title, open]);

  if (!open) return null;

  const deletedAssignees = settings.deletedAssignees || [];
  const deletedStatuses = settings.deletedStatuses || [];
  const deletedRecurrenceRules = settings.deletedRecurrenceRules || [];
  const trashedTasks = tasks.filter((task) => task.deletedAt);
  const archivedTasks = tasks.filter((task) => task.archivedAt && !task.deletedAt);
  const doneTasks = tasks.filter((task) => task.statusId === 'done' && !task.deletedAt && !task.archivedAt);
  const deletedSubtasks = tasks.flatMap((task) =>
    (task.subtasks || [])
      .filter((subtask) => subtask.deletedAt)
      .map((subtask) => ({
        ...subtask,
        parentTaskId: task.id,
        parentTitle: task.title,
        parentDeletedAt: task.deletedAt,
      })),
  );
  const trashCount = trashedTasks.length + deletedSubtasks.length + deletedAssignees.length + deletedStatuses.length + deletedRecurrenceRules.length;
  const restorePreview = backupPreview(restoreData);
  const exportData: BackupData = { type: 'wedding-task-board-backup', version: 1, board, settings, tasks, exportedAt: Date.now() };
  const lockedStatusIds = new Set(['todo', 'in-progress', 'done']);

  const downloadBackup = () => {
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `task-board-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRestoreFile = (file: File | null) => {
    setRestoreData(null);
    setRestoreFileName(file?.name || '');
    setRestoreError('');
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as BackupData;
        if (parsed.type !== 'wedding-task-board-backup') throw new Error('Invalid backup');
        setRestoreData(parsed);
      } catch {
        setRestoreError('バックアップファイルを読み込めませんでした。正しいJSONファイルを選択してください。');
        setRestoreFileName('');
      }
    };
    reader.onerror = () => {
      setRestoreError('ファイルの読み込みに失敗しました。');
      setRestoreFileName('');
    };
    reader.readAsText(file);
  };

  const parseRestore = (mode: 'append' | 'replace') => {
    if (!restoreData) return;
    onRestore(restoreData, mode);
    setRestoreData(null);
    setRestoreFileName('');
    setRestoreError('');
    setRestoreOpen(false);
  };

  const saveBoardTitle = () => {
    const title = boardTitle.trim();
    if (title && title !== board.title) onRenameBoard(title);
  };

  const addAssignee = (event: FormEvent) => {
    event.preventDefault();
    const name = newAssigneeName.trim();
    if (!name || !isOwner) return;
    onUpdateSettings({ assignees: [...settings.assignees, { id: crypto.randomUUID(), name, color: '#6b7280' }] });
    setNewAssigneeName('');
  };

  const renameAssignee = (assigneeId: string, name: string) => {
    if (!isOwner) return;
    onUpdateSettings({ assignees: settings.assignees.map((assignee) => (assignee.id === assigneeId ? { ...assignee, name } : assignee)) });
  };

  const changeAssigneeColor = (assigneeId: string, color: string) => {
    if (!isOwner) return;
    onUpdateSettings({ assignees: settings.assignees.map((assignee) => (assignee.id === assigneeId ? { ...assignee, color } : assignee)) });
  };

  const trashAssignee = (assignee: Assignee) => {
    if (!isOwner || settings.assignees.length <= 1) return;
    onUpdateSettings({
      assignees: settings.assignees.filter((item) => item.id !== assignee.id),
      deletedAssignees: [...deletedAssignees.filter((item) => item.id !== assignee.id), assignee],
    });
  };

  const addStatus = (event: FormEvent) => {
    event.preventDefault();
    const title = newStatusName.trim();
    if (!title || !isOwner) return;
    onUpdateSettings({ statuses: [...settings.statuses, { id: crypto.randomUUID(), title, color: '#94a3b8' }] });
    setNewStatusName('');
  };

  const renameStatus = (statusId: string, title: string) => {
    if (!isOwner || lockedStatusIds.has(statusId)) return;
    onUpdateSettings({ statuses: settings.statuses.map((status) => (status.id === statusId ? { ...status, title } : status)) });
  };

  const changeStatusColor = (statusId: string, color: string) => {
    if (!isOwner) return;
    onUpdateSettings({ statuses: settings.statuses.map((status) => (status.id === statusId ? { ...status, color } : status)) });
  };

  const openNameEditor = (kind: 'assignee' | 'status', id: string, name: string) => {
    setDraftName(name);
    setEditingAssigneeId(kind === 'assignee' ? id : null);
    setEditingStatusId(kind === 'status' ? id : null);
  };

  const saveNameEditor = () => {
    const name = draftName.trim();
    if (!name) return;
    if (editingAssigneeId) renameAssignee(editingAssigneeId, name);
    if (editingStatusId) renameStatus(editingStatusId, name);
    setEditingAssigneeId(null);
    setEditingStatusId(null);
    setDraftName('');
  };

  const trashStatus = (status: StatusColumn) => {
    if (!isOwner || settings.statuses.length <= 1 || status.isDefault) return;
    const fallbackStatusId = settings.statuses.find((item) => item.id !== status.id)?.id || settings.statuses[0]?.id;
    tasks.filter((task) => task.statusId === status.id && !task.deletedAt).forEach((task) => fallbackStatusId && onUpdateTask(task.id, { statusId: fallbackStatusId }));
    onUpdateSettings({
      statuses: settings.statuses.filter((item) => item.id !== status.id),
      deletedStatuses: [...deletedStatuses.filter((item) => item.id !== status.id), status],
    });
  };

  const restoreSubtask = (parentTaskId: string, subtaskId: string) => {
    const parentTask = tasks.find((task) => task.id === parentTaskId);
    if (!parentTask || parentTask.deletedAt) return;
    onUpdateTask(parentTaskId, {
      subtasks: parentTask.subtasks.map((subtask) => (subtask.id === subtaskId ? { ...subtask, deletedAt: null } : subtask)),
    });
  };

  const hardDeleteSubtask = (parentTaskId: string, subtaskId: string) => {
    const parentTask = tasks.find((task) => task.id === parentTaskId);
    if (!parentTask) return;
    onUpdateTask(parentTaskId, {
      subtasks: parentTask.subtasks.filter((subtask) => subtask.id !== subtaskId),
    });
  };

  const clearDragTimer = () => {
    if (dragTimerRef.current !== null) {
      window.clearTimeout(dragTimerRef.current);
      dragTimerRef.current = null;
    }
  };

  const reorderById = <T extends { id: string }>(items: T[], activeId: string, overId: string) => {
    const from = items.findIndex((item) => item.id === activeId);
    const to = items.findIndex((item) => item.id === overId);
    if (from < 0 || to < 0 || from === to) return items;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
  };

  const startReorder = (event: PointerEvent<HTMLButtonElement>, kind: 'assignee' | 'status', id: string) => {
    if (!isOwner) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    clearDragTimer();
    if (event.pointerType === 'touch' || event.pointerType === 'pen') {
      dragTimerRef.current = window.setTimeout(() => {
        setDragItem({ kind, id });
        dragTimerRef.current = null;
      }, 350);
      return;
    }
    setDragItem({ kind, id });
  };

  const stopReorder = () => {
    clearDragTimer();
    setDragItem(null);
  };

  const moveReorder = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragItem) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-reorder-kind][data-reorder-id]');
    const overKind = target?.dataset.reorderKind as 'assignee' | 'status' | undefined;
    const overId = target?.dataset.reorderId;
    if (!overId || overId === dragItem.id || overKind !== dragItem.kind) return;

    if (dragItem.kind === 'assignee') {
      const next = reorderById(settings.assignees, dragItem.id, overId);
      if (next !== settings.assignees) onUpdateSettings({ assignees: next });
      return;
    }

    const next = reorderById(settings.statuses, dragItem.id, overId);
    if (next !== settings.statuses) onUpdateSettings({ statuses: next });
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-2xl bg-white p-5 shadow-2xl sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900"><Settings size={20} className="text-gray-500" />ボード設定</h2>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-800"><X size={18} /></button>
        </div>
        {!isAggregate ? <div className="mb-4 grid grid-cols-3 rounded-xl bg-gray-100 p-1">
          <button type="button" onClick={() => setActiveTab('settings')} className={`rounded-lg px-3 py-2 text-sm font-bold transition-colors ${activeTab === 'settings' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'}`}>
            ボード設定
          </button>
          <button type="button" onClick={() => setActiveTab('archive')} className={`rounded-lg px-3 py-2 text-sm font-bold transition-colors ${activeTab === 'archive' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'}`}>
            アーカイブ {archivedTasks.length ? `(${archivedTasks.length})` : ''}
          </button>
          <button type="button" onClick={() => setActiveTab('trash')} className={`rounded-lg px-3 py-2 text-sm font-bold transition-colors ${activeTab === 'trash' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'}`}>
            ゴミ箱 {trashCount ? `(${trashCount})` : ''}
          </button>
        </div> : null}
        <div className="custom-scrollbar space-y-5 overflow-y-auto pr-1" onPointerMove={moveReorder} onPointerUp={stopReorder} onPointerCancel={stopReorder} onPointerLeave={clearDragTimer}>
          {activeTab === 'settings' ? (
            <>
              <section>
                <h3 className="mb-2 text-sm font-bold text-gray-700">ボード名</h3>
                <div className="flex gap-2">
                  <input value={boardTitle} disabled={!isOwner} onChange={(event) => setBoardTitle(event.target.value)} onBlur={saveBoardTitle} onKeyDown={(event) => { if (event.key === 'Enter') saveBoardTitle(); }} className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-gray-500 disabled:bg-gray-100" />
                  <button type="button" disabled={!isOwner || !boardTitle.trim()} onClick={saveBoardTitle} className="rounded-lg bg-gray-800 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40">保存</button>
                </div>
              </section>

              {isAggregate ? (
                <section className="border-t border-gray-200 pt-4">
                  <h3 className="mb-2 text-sm font-bold text-gray-700">まとめ対象</h3>
                  <div className="space-y-1.5">
                    {(board.sourceBoardIds || []).length ? (board.sourceBoardIds || []).map((sourceBoardId) => {
                      const sourceBoard = sourceBoards.find((item) => item.id === sourceBoardId);
                      return (
                      <button type="button" key={sourceBoardId} onClick={() => sourceBoard && onOpenSourceBoard?.(sourceBoard.id)} disabled={!sourceBoard} className="flex w-full items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-left text-sm font-bold text-gray-600 hover:bg-gray-100 hover:text-gray-800 disabled:cursor-default disabled:hover:bg-gray-50 disabled:hover:text-gray-600">
                        <LayoutDashboard size={14} className="text-gray-400" />
                        <span className="min-w-0 flex-1 truncate">{sourceBoard?.title || '不明なボード'}</span>
                        {sourceBoard ? <ChevronRight size={14} className="text-gray-400" /> : null}
                      </button>
                    );
                    }) : <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-3 text-center text-xs text-gray-400">まとめ対象がありません</div>}
                  </div>
                  <p className="mt-3 text-xs leading-5 text-gray-500">
                    担当者・ステータス・通知などは元のボード側での操作が必要です。
                  </p>
                </section>
              ) : (
              <>
              <section className="border-t border-gray-200 pt-4">
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-gray-700"><Share2 size={16} className="text-gray-400" />共有設定</h3>
                {isGuest ? (
                  <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm leading-6 text-gray-500">
                    未ログインモードでは共有できません。
                    <br />
                    共有したい場合はGoogleログインに切り替えてください。
                  </div>
                ) : null}
                <div className="mb-3 text-sm text-gray-600">オーナー: {isOwner ? 'あなた' : board.ownerId}</div>
                <div className="mb-3 space-y-2">
                  {board.memberEmails.map((email, index) => (
                    <div key={email} className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2">
                      <span className="min-w-0 truncate text-xs font-semibold text-gray-600">{email}</span>
                      {isOwner ? (
                        <button type="button" onClick={() => onRemoveMember(board.memberIds[index] || '', email)} className="rounded-md p-1 text-gray-400 hover:bg-red-50 hover:text-red-500" title="メンバーを削除"><UserMinus size={15} /></button>
                      ) : null}
                    </div>
                  ))}
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
                {!isOwner && !isGuest ? (
                  <button type="button" onClick={onLeaveBoard} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-600 shadow-sm hover:bg-gray-50">
                    <UserMinus size={16} />このボードから退出
                  </button>
                ) : null}
              </section>

              <section className="border-t border-gray-200 pt-4">
                <label className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm">
                  ステータスを初期状態で折りたたむ
                  <input type="checkbox" checked={settings.defaultCollapsed ?? false} disabled={!isOwner} onChange={(event) => onUpdateSettings({ defaultCollapsed: event.target.checked })} />
                </label>
                <div className="mt-2 rounded-lg bg-gray-50 px-3 py-2">
                  <label className="flex items-center justify-between text-sm">
                    期日通知
                    <input type="checkbox" checked={settings.notificationsEnabled !== false} disabled={!isOwner} onChange={(event) => onUpdateSettings({ notificationsEnabled: event.target.checked })} />
                  </label>
                  <div className="mt-2 grid grid-cols-3 gap-1.5 text-[11px] text-gray-500">
                    <label className={`flex items-center justify-center gap-1 rounded-md bg-white px-2 py-1 ${settings.notificationsEnabled === false ? 'opacity-40' : ''}`}><input type="checkbox" checked={settings.notifyOverdue !== false} disabled={!isOwner || settings.notificationsEnabled === false} onChange={(event) => onUpdateSettings({ notifyOverdue: event.target.checked })} />期限切れ</label>
                    <label className={`flex items-center justify-center gap-1 rounded-md bg-white px-2 py-1 ${settings.notificationsEnabled === false ? 'opacity-40' : ''}`}><input type="checkbox" checked={settings.notifyToday !== false} disabled={!isOwner || settings.notificationsEnabled === false} onChange={(event) => onUpdateSettings({ notifyToday: event.target.checked })} />今日</label>
                    <label className={`flex items-center justify-center gap-1 rounded-md bg-white px-2 py-1 ${settings.notificationsEnabled === false ? 'opacity-40' : ''}`}><input type="checkbox" checked={settings.notifyTomorrow !== false} disabled={!isOwner || settings.notificationsEnabled === false} onChange={(event) => onUpdateSettings({ notifyTomorrow: event.target.checked })} />明日</label>
                  </div>
                  <button
                    type="button"
                    disabled={!isOwner || settings.notificationsEnabled === false || !('Notification' in window)}
                    onClick={async () => {
                      if (!('Notification' in window)) return;
                      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
                      if (permission === 'granted') onUpdateSettings({ browserNotificationsEnabled: true });
                    }}
                    className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-gray-300 bg-white text-xs font-bold text-gray-600 shadow-sm hover:bg-gray-50 disabled:opacity-40"
                  >
                    <Bell size={14} />ブラウザ通知を許可
                  </button>
                </div>
              </section>

              <section className="border-t border-gray-200 pt-4">
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-gray-700"><Repeat size={16} className="text-gray-400" />繰り返しタスク</h3>
                <div className="space-y-2">
                  {(settings.recurrenceRules || []).map((rule) => (
                    <div key={rule.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold text-gray-800">{rule.title}</div>
                          <div className="mt-1 text-xs text-gray-500">{recurrenceLabel(rule)}</div>
                        </div>
                        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${rule.enabled ? 'border-gray-200 bg-white text-gray-600' : 'border-gray-200 bg-gray-100 text-gray-400'}`}>{rule.enabled ? '有効' : '停止中'}</span>
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-1.5">
                        <button type="button" disabled={!isOwner} onClick={() => onGenerateRecurrence(rule)} className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-40">今すぐ生成</button>
                        <button type="button" disabled={!isOwner} onClick={() => onUpdateSettings({ recurrenceRules: (settings.recurrenceRules || []).map((item) => item.id === rule.id ? { ...item, enabled: !item.enabled, updatedAt: Date.now() } : item) })} className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-40">{rule.enabled ? '停止' : '再開'}</button>
                        <button type="button" disabled={!isOwner} onClick={() => onUpdateSettings({ recurrenceRules: (settings.recurrenceRules || []).filter((item) => item.id !== rule.id), deletedRecurrenceRules: [...deletedRecurrenceRules.filter((item) => item.id !== rule.id), { ...rule, enabled: false, updatedAt: Date.now() }] })} className="rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-xs font-bold text-red-600 hover:bg-red-100 disabled:opacity-40">削除</button>
                      </div>
                    </div>
                  ))}
                  {(settings.recurrenceRules || []).length === 0 ? (
                    <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-center text-xs leading-5 text-gray-400">
                      繰り返しタスクはまだありません。
                      <br />
                      新しいタスク追加から設定できます。
                    </div>
                  ) : null}
                </div>
              </section>

              <section className="border-t border-gray-200 pt-4">
                <h3 className="mb-2 text-sm font-bold text-gray-700">担当者の管理</h3>
                <div className="space-y-2">
                  {settings.assignees.map((assignee) => (
                    <div
                      key={assignee.id}
                      data-reorder-kind="assignee"
                      data-reorder-id={assignee.id}
                      className={`relative flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2 py-2 transition-all ${dragItem?.kind === 'assignee' && dragItem.id === assignee.id ? 'scale-[0.99] border-gray-400 bg-white shadow-md' : ''}`}
                    >
                      <button
                        type="button"
                        disabled={!isOwner}
                        onPointerDown={(event) => startReorder(event, 'assignee', assignee.id)}
                        onPointerUp={stopReorder}
                        onPointerCancel={stopReorder}
                        className="touch-none rounded-md p-1.5 text-gray-300 hover:bg-white hover:text-gray-500 disabled:opacity-30"
                        title="ドラッグ/長押しで並び替え"
                        aria-label={`${assignee.name}を並び替え`}
                      >
                        <GripVertical size={16} />
                      </button>
                      <label className="relative h-5 w-5 shrink-0 cursor-pointer rounded-full border border-black/10 shadow-sm" style={{ backgroundColor: assignee.color }} title="色を変更">
                        <input type="color" value={assignee.color} disabled={!isOwner} onChange={(event) => changeAssigneeColor(assignee.id, event.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed" />
                      </label>
                      <button type="button" disabled={!isOwner} onClick={() => openNameEditor('assignee', assignee.id, assignee.name)} className="min-w-0 flex-1 truncate rounded px-1 py-1 text-left text-sm font-medium text-gray-700 hover:bg-white disabled:text-gray-500">
                        {assignee.name}
                      </button>
                      <button type="button" disabled={!isOwner || settings.assignees.length <= 1} onClick={() => trashAssignee(assignee)} className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-30" title="担当者をゴミ箱へ"><Trash2 size={15} /></button>
                      {editingAssigneeId === assignee.id ? (
                        <>
                          <button type="button" className="fixed inset-0 z-[160] cursor-default" onClick={() => setEditingAssigneeId(null)} aria-label="担当者名編集を閉じる" />
                          <div className="absolute left-8 right-2 top-1 z-[170] rounded-xl border border-gray-200 bg-white p-2 shadow-2xl">
                            <input autoFocus value={draftName} onChange={(event) => setDraftName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') saveNameEditor(); if (event.key === 'Escape') setEditingAssigneeId(null); }} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-gray-500" />
                            <div className="mt-2 flex justify-end gap-1.5">
                              <button type="button" onClick={saveNameEditor} className="rounded-md bg-gray-800 px-2 py-1 text-white"><Check size={14} /></button>
                              <button type="button" onClick={() => setEditingAssigneeId(null)} className="rounded-md border border-gray-300 bg-white px-2 py-1 text-gray-500"><X size={14} /></button>
                            </div>
                          </div>
                        </>
                      ) : null}
                    </div>
                  ))}
                </div>
                <form onSubmit={addAssignee} className="mt-2 flex gap-2">
                  <input value={newAssigneeName} onChange={(event) => setNewAssigneeName(event.target.value)} disabled={!isOwner} placeholder="新しい担当者..." className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-500 disabled:bg-gray-100" />
                  <button disabled={!isOwner || !newAssigneeName.trim()} className="rounded-lg bg-gray-800 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40">追加</button>
                </form>
              </section>

              <section className="border-t border-gray-200 pt-4">
                <h3 className="mb-1 text-sm font-bold text-gray-700">ステータス管理</h3>
                <p className="mb-2 text-[10px] leading-relaxed text-gray-500">ステータスを削除すると、その列のタスクは安全のため別のステータスへ移動します。</p>
                <div className="space-y-2">
                  {settings.statuses.map((status) => (
                    (() => {
                      const isNameLocked = lockedStatusIds.has(status.id);
                      return (
                    <div
                      key={status.id}
                      data-reorder-kind="status"
                      data-reorder-id={status.id}
                      className={`relative flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2 py-2 transition-all ${dragItem?.kind === 'status' && dragItem.id === status.id ? 'scale-[0.99] border-gray-400 bg-white shadow-md' : ''}`}
                    >
                      <button
                        type="button"
                        disabled={!isOwner}
                        onPointerDown={(event) => startReorder(event, 'status', status.id)}
                        onPointerUp={stopReorder}
                        onPointerCancel={stopReorder}
                        className="touch-none rounded-md p-1.5 text-gray-300 hover:bg-white hover:text-gray-500 disabled:opacity-30"
                        title="ドラッグ/長押しで並び替え"
                        aria-label={`${status.title}を並び替え`}
                      >
                        <GripVertical size={16} />
                      </button>
                      <label className="relative h-5 w-5 shrink-0 cursor-pointer rounded-full border border-black/10 shadow-sm" style={{ backgroundColor: status.color }} title="色を変更">
                        <input type="color" value={status.color} disabled={!isOwner} onChange={(event) => changeStatusColor(status.id, event.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed" />
                      </label>
                      <button type="button" disabled={!isOwner || isNameLocked} onClick={() => openNameEditor('status', status.id, status.title)} className="min-w-0 flex-1 truncate rounded px-1 py-1 text-left text-sm font-medium text-gray-700 hover:bg-white disabled:cursor-default disabled:text-gray-500" title={isNameLocked ? 'このステータス名は変更できません' : '名称を変更'}>
                        {status.title}
                      </button>
                      {status.isDefault ? (
                        <span className="rounded-md p-1.5 text-gray-400" title="固定ステータス"><Lock size={15} /></span>
                      ) : (
                        <button type="button" disabled={!isOwner || settings.statuses.length <= 1} onClick={() => trashStatus(status)} className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-30" title="ステータスをゴミ箱へ"><Trash2 size={15} /></button>
                      )}
                      {editingStatusId === status.id ? (
                        <>
                          <button type="button" className="fixed inset-0 z-[160] cursor-default" onClick={() => setEditingStatusId(null)} aria-label="ステータス名編集を閉じる" />
                          <div className="absolute left-8 right-2 top-1 z-[170] rounded-xl border border-gray-200 bg-white p-2 shadow-2xl">
                            <input autoFocus value={draftName} onChange={(event) => setDraftName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') saveNameEditor(); if (event.key === 'Escape') setEditingStatusId(null); }} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-gray-500" />
                            <div className="mt-2 flex justify-end gap-1.5">
                              <button type="button" onClick={saveNameEditor} className="rounded-md bg-gray-800 px-2 py-1 text-white"><Check size={14} /></button>
                              <button type="button" onClick={() => setEditingStatusId(null)} className="rounded-md border border-gray-300 bg-white px-2 py-1 text-gray-500"><X size={14} /></button>
                            </div>
                          </div>
                        </>
                      ) : null}
                    </div>
                      );
                    })()
                  ))}
                </div>
                <form onSubmit={addStatus} className="mt-2 flex gap-2">
                  <input value={newStatusName} onChange={(event) => setNewStatusName(event.target.value)} disabled={!isOwner} placeholder="新しいステータス..." className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-500 disabled:bg-gray-100" />
                  <button disabled={!isOwner || !newStatusName.trim()} className="rounded-lg bg-gray-800 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40">追加</button>
                </form>
              </section>
              </>
              )}

              <section className="border-t border-gray-200 pt-4">
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-gray-700"><Archive size={16} className="text-gray-400" />データ管理</h3>
                {isAggregate ? (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 text-sm leading-6 text-gray-500">
                    バックアップ・復元は元のボード側での操作が必要です。
                  </div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button type="button" onClick={downloadBackup} className="flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"><Download size={16} />バックアップ</button>
                    <button type="button" onClick={() => setRestoreOpen(true)} className="flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"><Upload size={16} />データを復元</button>
                  </div>
                )}
              </section>

              <section className="border-t border-gray-200 pt-4">
                <button
                  type="button"
                  onClick={() => setConfirmBoardDelete(true)}
                  disabled={!isOwner}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-600 shadow-sm hover:bg-red-100 disabled:opacity-40"
                >
                  <Trash2 size={16} />ボードを削除
                </button>
                <p className="mt-2 text-xs leading-5 text-gray-500">
                  {board.kind === 'aggregate'
                    ? 'このまとめボードだけを削除します。元のタスクボードやタスクは削除されません。'
                    : 'このボードと中のタスクを削除します。共有中の場合、参加者からも見えなくなります。'}
                </p>
              </section>
            </>
          ) : activeTab === 'archive' ? (
            <>
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                <label className="flex items-center gap-2 text-sm font-bold text-gray-600">
                  <input
                    type="checkbox"
                    disabled={archivedTasks.length === 0}
                    checked={archivedTasks.length > 0 && selectedArchiveIds.length === archivedTasks.length}
                    onChange={(event) => setSelectedArchiveIds(event.target.checked ? archivedTasks.map((task) => task.id) : [])}
                  />
                  全選択
                </label>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <button type="button" disabled={selectedArchiveIds.length === 0} onClick={() => { selectedArchiveIds.forEach((id) => onUpdateTask(id, { archivedAt: null })); setSelectedArchiveIds([]); }} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-40">選択を復元</button>
                <button type="button" disabled={selectedArchiveIds.length === 0} onClick={() => { selectedArchiveIds.forEach((id) => onUpdateTask(id, { deletedAt: Date.now(), archivedAt: null })); setSelectedArchiveIds([]); }} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-600 shadow-sm hover:bg-red-100 disabled:opacity-40">選択をゴミ箱へ</button>
              </div>
              <button type="button" disabled={!doneTasks.length} onClick={() => doneTasks.forEach((task) => onUpdateTask(task.id, { archivedAt: Date.now() }))} className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-40"><Archive size={16} />完了タスクをアーカイブへ</button>

              <section className="border-t border-gray-200 pt-4">
                <div className="space-y-2">
                  {archivedTasks.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-3 py-8 text-center text-sm text-gray-400">
                      アーカイブされたタスクはありません。
                    </div>
                  ) : null}
                  {archivedTasks.map((task) => (
                    <div key={task.id} className="rounded-xl border border-gray-200 bg-white p-2 shadow-sm">
                      <label className="mb-2 flex items-center gap-2 px-1 text-xs font-bold text-gray-500">
                        <input type="checkbox" checked={selectedArchiveIds.includes(task.id)} onChange={(event) => setSelectedArchiveIds((current) => event.target.checked ? [...current, task.id] : current.filter((id) => id !== task.id))} />
                        選択
                      </label>
                      <TaskListItem task={task} settings={settings} onOpenTask={() => undefined} />
                    </div>
                  ))}
                </div>
              </section>
            </>
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                <button type="button" onClick={onEmptyDone} disabled={!doneTasks.length} className="flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-40"><Trash2 size={16} />完了タスクをゴミ箱へ</button>
                <button type="button" onClick={() => setConfirmEmptyTrash(true)} disabled={!trashCount || !isOwner} className="flex items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-600 shadow-sm hover:bg-red-100 disabled:opacity-40"><Trash2 size={16} />ゴミ箱を空にする</button>
              </div>

              <section className="border-t border-gray-200 pt-4">
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-gray-700"><Square size={16} className="text-gray-400" />タスク</h3>
                <div className="space-y-2">
                  {trashedTasks.length === 0 ? <p className="rounded border border-gray-100 bg-gray-50 p-3 text-center text-xs text-gray-400">ゴミ箱が空です</p> : null}
                  {trashedTasks.map((task) => (
                    <div key={task.id} className="flex items-center justify-between gap-3 rounded border border-gray-200 bg-gray-50 px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm text-gray-600 line-through">{task.title}</div>
                        <div className="text-[10px] text-gray-400">削除日時: {task.deletedAt ? formatDateTime(task.deletedAt) : '-'}</div>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <button type="button" onClick={() => onRestoreTask(task.id)} className="flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-600 shadow-sm hover:bg-gray-100"><RotateCcw size={12} />復元</button>
                        <button type="button" onClick={() => { if (confirm('このタスクを完全に削除しますか？')) onHardDeleteTask(task.id); }} className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-600 shadow-sm hover:bg-red-100" title="完全に削除"><Trash2 size={12} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="border-t border-gray-200 pt-4">
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-gray-700"><CheckSquare size={16} className="text-gray-400" />サブタスク</h3>
                <div className="space-y-2">
                  {deletedSubtasks.length === 0 ? <p className="rounded border border-gray-100 bg-gray-50 p-3 text-center text-xs text-gray-400">ゴミ箱が空です</p> : null}
                  {deletedSubtasks.map((subtask) => (
                    <div key={`${subtask.parentTaskId}-${subtask.id}`} className="flex items-center justify-between gap-3 rounded border border-gray-200 bg-gray-50 px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm text-gray-600 line-through">{subtask.text}</div>
                        <div className="truncate text-[10px] text-gray-400">親タスク: {subtask.parentTitle}</div>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <button type="button" onClick={() => restoreSubtask(subtask.parentTaskId, subtask.id)} disabled={!!subtask.parentDeletedAt} className={`flex items-center gap-1 rounded px-2 py-1.5 text-xs shadow-sm ${subtask.parentDeletedAt ? 'cursor-not-allowed border border-gray-200 bg-gray-200 text-gray-400' : 'border border-gray-300 bg-white text-gray-600 hover:bg-gray-100'}`} title={subtask.parentDeletedAt ? '先に親タスクを復元してください' : '復元'}><RotateCcw size={12} />復元</button>
                        <button type="button" onClick={() => { if (confirm('このサブタスクを完全に削除しますか？')) hardDeleteSubtask(subtask.parentTaskId, subtask.id); }} className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-600 shadow-sm hover:bg-red-100" title="完全に削除"><Trash2 size={12} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="border-t border-gray-200 pt-4">
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-gray-700"><Settings size={16} className="text-gray-400" />担当者</h3>
                <div className="space-y-2">
                  {deletedAssignees.length === 0 ? <p className="rounded border border-gray-100 bg-gray-50 p-3 text-center text-xs text-gray-400">ゴミ箱が空です</p> : null}
                  {deletedAssignees.map((assignee) => (
                    <div key={assignee.id} className="flex items-center justify-between gap-3 rounded border border-gray-200 bg-gray-50 px-3 py-2">
                      <span className="truncate text-sm text-gray-600 line-through">{assignee.name}</span>
                      <div className="flex shrink-0 gap-1.5">
                        <button type="button" onClick={() => onUpdateSettings({ assignees: [...settings.assignees, assignee], deletedAssignees: deletedAssignees.filter((item) => item.id !== assignee.id) })} className="flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-600 shadow-sm hover:bg-gray-100"><RotateCcw size={12} />復元</button>
                        <button type="button" onClick={() => { if (confirm('この担当者を完全に削除しますか？')) onUpdateSettings({ deletedAssignees: deletedAssignees.filter((item) => item.id !== assignee.id) }); }} className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-600 shadow-sm hover:bg-red-100" title="完全に削除"><Trash2 size={12} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="border-t border-gray-200 pt-4">
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-gray-700"><Repeat size={16} className="text-gray-400" />繰り返し設定</h3>
                <div className="space-y-2">
                  {deletedRecurrenceRules.length === 0 ? <p className="rounded border border-gray-100 bg-gray-50 p-3 text-center text-xs text-gray-400">ゴミ箱が空です</p> : null}
                  {deletedRecurrenceRules.map((rule) => (
                    <div key={rule.id} className="flex items-center justify-between gap-3 rounded border border-gray-200 bg-gray-50 px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm text-gray-600 line-through">{rule.title}</div>
                        <div className="truncate text-[10px] text-gray-400">{recurrenceLabel(rule)}</div>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <button type="button" onClick={() => onUpdateSettings({ recurrenceRules: [...(settings.recurrenceRules || []), { ...rule, enabled: true, updatedAt: Date.now() }], deletedRecurrenceRules: deletedRecurrenceRules.filter((item) => item.id !== rule.id) })} className="flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-600 shadow-sm hover:bg-gray-100"><RotateCcw size={12} />復元</button>
                        <button type="button" onClick={() => { if (confirm('この繰り返し設定を完全に削除しますか？')) onUpdateSettings({ deletedRecurrenceRules: deletedRecurrenceRules.filter((item) => item.id !== rule.id) }); }} className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-600 shadow-sm hover:bg-red-100" title="完全に削除"><Trash2 size={12} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="border-t border-gray-200 pt-4">
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-gray-700"><LayoutDashboard size={16} className="text-gray-400" />ステータス</h3>
                <div className="space-y-2">
                  {deletedStatuses.length === 0 ? <p className="rounded border border-gray-100 bg-gray-50 p-3 text-center text-xs text-gray-400">ゴミ箱が空です</p> : null}
                  {deletedStatuses.map((status) => (
                    <div key={status.id} className="flex items-center justify-between gap-3 rounded border border-gray-200 bg-gray-50 px-3 py-2">
                      <span className="truncate text-sm text-gray-600 line-through">{status.title}</span>
                      <div className="flex shrink-0 gap-1.5">
                        <button type="button" onClick={() => onUpdateSettings({ statuses: [...settings.statuses, status], deletedStatuses: deletedStatuses.filter((item) => item.id !== status.id) })} className="flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-600 shadow-sm hover:bg-gray-100"><RotateCcw size={12} />復元</button>
                        <button type="button" onClick={() => { if (confirm('このステータスを完全に削除しますか？')) onUpdateSettings({ deletedStatuses: deletedStatuses.filter((item) => item.id !== status.id) }); }} className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-600 shadow-sm hover:bg-red-100" title="完全に削除"><Trash2 size={12} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
      {confirmEmptyTrash ? (
        <div className="fixed inset-0 z-[170] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-red-100 bg-white p-5 shadow-2xl">
            <div className="mb-3 flex items-center gap-2 text-red-600">
              <Trash2 size={22} />
              <h3 className="text-lg font-bold">ゴミ箱を空にしますか？</h3>
            </div>
            <p className="text-sm leading-6 text-gray-600">
              ゴミ箱内のタスク、サブタスク、削除済みの担当者・ステータス・繰り返し設定を完全に削除します。この操作は元に戻せません。
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setConfirmEmptyTrash(false)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-600 shadow-sm hover:bg-gray-50">
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => {
                  onEmptyTrash();
                  setConfirmEmptyTrash(false);
                }}
                className="rounded-lg bg-red-600 px-3 py-2 text-sm font-bold text-white shadow-sm hover:bg-red-700"
              >
                完全に空にする
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {restoreOpen && !isAggregate ? (
        <div className="fixed inset-0 z-[170] flex items-end bg-black/45 p-0 sm:items-center sm:justify-center sm:p-4">
          <div className="w-full rounded-t-2xl bg-white p-5 shadow-2xl sm:max-w-md sm:rounded-2xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-lg font-bold text-gray-800"><Upload size={20} className="text-gray-500" />データを復元</h3>
              <button type="button" onClick={() => setRestoreOpen(false)} className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-800"><X size={18} /></button>
            </div>
            <p className="mb-3 text-sm leading-6 text-gray-600">バックアップファイルを選択して、現在のデータに追加するか、上書きするかを選んでください。</p>
            <label className="flex min-h-[58px] cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 px-3 py-3 text-sm font-bold text-gray-700 hover:bg-gray-100">
              <Upload size={18} />
              <span className="truncate">{restoreFileName || 'バックアップファイル選択'}</span>
              <input
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(event) => handleRestoreFile(event.target.files?.[0] || null)}
              />
            </label>
            {restoreError ? <div className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs font-medium text-red-600">{restoreError}</div> : null}
            {restorePreview ? (
              <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
                <div className="mb-2 font-bold text-gray-700">復元プレビュー: {restorePreview.boardTitle}</div>
                <div className="grid grid-cols-2 gap-1.5">
                  <div>タスク: {restorePreview.taskCount}件</div>
                  <div>アーカイブ: {restorePreview.archivedCount}件</div>
                  <div>ゴミ箱: {restorePreview.trashCount}件</div>
                  <div>担当者: {restorePreview.assigneeCount}件</div>
                  <div>ステータス: {restorePreview.statusCount}件</div>
                  <div>繰り返し: {restorePreview.recurrenceCount}件</div>
                </div>
                <div className="mt-2 leading-5 text-gray-500">
                  追加で復元: 現在のデータを残して追加します。
                  <br />
                  上書き復元: 現在のタスクを削除して置き換えます。
                </div>
              </div>
            ) : null}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => parseRestore('append')} disabled={!restoreData} className="flex items-center justify-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-40"><Upload size={16} />追加で復元</button>
              <button type="button" onClick={() => parseRestore('replace')} disabled={!restoreData || !isOwner} className="flex items-center justify-center gap-2 rounded-lg bg-gray-800 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40"><Upload size={16} />上書き復元</button>
            </div>
          </div>
        </div>
      ) : null}
      {confirmBoardDelete ? (
        <div className="fixed inset-0 z-[170] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-red-100 bg-white p-5 shadow-2xl">
            <div className="mb-3 flex items-center gap-2 text-red-600">
              <Trash2 size={22} />
              <h3 className="text-lg font-bold">ボードを削除しますか？</h3>
            </div>
            <p className="text-sm leading-6 text-gray-600">
              {board.kind === 'aggregate'
                ? `「${board.title}」だけを削除します。元のタスクボードやタスクは残ります。`
                : `「${board.title}」と、このボード内のタスクを削除します。この操作は元に戻せません。`}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setConfirmBoardDelete(false)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-600 shadow-sm hover:bg-gray-50">
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmBoardDelete(false);
                  onDeleteBoard();
                }}
                className="rounded-lg bg-red-600 px-3 py-2 text-sm font-bold text-white shadow-sm hover:bg-red-700"
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SettingsView({
  user,
  boards,
  invites,
  onAcceptInvite,
  onDeclineInvite,
  onSendInvite,
  onFeedback,
  onShowGuide,
  darkMode,
  onToggleDarkMode,
  isGuest,
}: {
  user: CurrentUser;
  boards: Board[];
  invites: Invite[];
  onAcceptInvite: (invite: Invite) => void;
  onDeclineInvite: (invite: Invite) => void;
  onSendInvite: (board: Board, email: string) => void;
  onFeedback: (message: string) => void;
  onShowGuide: () => void;
  darkMode: boolean;
  onToggleDarkMode: (enabled: boolean) => void;
  isGuest: boolean;
}) {
  const [feedback, setFeedback] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteBoardId, setInviteBoardId] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');

  const ownedBoards = boards.filter((board) => (board.kind || 'board') === 'board' && board.ownerId === user.uid);

  useEffect(() => {
    if (!inviteModalOpen) return;
    setInviteBoardId((current) => (current && ownedBoards.some((board) => board.id === current) ? current : ownedBoards[0]?.id || ''));
    setInviteEmail('');
  }, [inviteModalOpen, ownedBoards.length]);

  const loginWithGoogle = async () => {
    setLoginLoading(true);
    setLoginError('');
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'ログインに失敗しました');
    } finally {
      setLoginLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-bold text-gray-700"><Bell size={18} className="text-gray-500" />招待</h2>
          <button type="button" onClick={() => setInviteModalOpen(true)} disabled={isGuest || ownedBoards.length === 0} className="flex h-8 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-2.5 text-xs font-bold text-gray-600 shadow-sm hover:bg-gray-50 disabled:opacity-40">
            <UserPlus size={14} />招待を送る
          </button>
        </div>
        {invites.length ? (
          <div className="space-y-2">
            {invites.map((invite) => (
              <div key={invite.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="text-sm font-bold text-gray-700">{invite.boardTitle}</div>
                <div className="mt-1 text-xs text-gray-400">招待者: {invite.createdByName}</div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => onAcceptInvite(invite)} className="rounded-lg bg-gray-800 px-3 py-2 text-xs font-bold text-white">参加</button>
                  <button type="button" onClick={() => onDeclineInvite(invite)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-bold text-gray-500">辞退</button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-5 text-center text-sm text-gray-400">
            現在の招待はありません。
            <div className="mt-1 text-xs">{isGuest ? '招待を送るにはGoogleログインが必要です。' : '自分のボードから招待を送れます。'}</div>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 flex items-center gap-2 font-bold text-gray-700"><Moon size={18} className="text-gray-500" />表示</h2>
        <label className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">
          ダークモード
          <input type="checkbox" checked={darkMode} onChange={(event) => onToggleDarkMode(event.target.checked)} />
        </label>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 flex items-center gap-2 font-bold text-gray-700"><MessageSquare size={18} className="text-gray-500" />ご意見箱</h2>
        <div className="flex items-end gap-2">
          <textarea value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="ご意見を入力..." rows={1} className="min-h-[42px] min-w-0 flex-1 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-gray-500 focus:bg-white" />
          <button
            onClick={() => {
              if (!feedback.trim()) return;
              onFeedback(feedback.trim());
              setFeedback('');
            }}
            className="h-[42px] shrink-0 rounded-lg bg-gray-800 px-4 text-sm font-medium text-white hover:bg-gray-700"
          >
            送信
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 flex items-center gap-2 font-bold text-gray-700"><BookOpen size={18} className="text-gray-500" />ガイド</h2>
        <button type="button" onClick={onShowGuide} className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50">
          <BookOpen size={16} />ガイドを見る
        </button>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 font-bold text-gray-700">アカウント</h2>
        <div className="mb-3 text-sm text-gray-600">{user.displayName || user.email}</div>
        <div className="grid gap-2">
          {isGuest ? (
            <button
              onClick={loginWithGoogle}
              disabled={loginLoading}
              className="flex items-center justify-center gap-2 rounded-lg bg-gray-800 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-gray-700 disabled:opacity-60"
            >
              {loginLoading ? <Loader2 className="animate-spin" size={16} /> : <GoogleIcon />}
              Googleでログイン
            </button>
          ) : null}
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
          {loginError ? <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{loginError}</div> : null}
        </div>
      </section>

      {inviteModalOpen ? (
        <div className="fixed inset-0 z-[190] flex items-center justify-center bg-black/45 p-4">
          <button type="button" className="absolute inset-0 cursor-default" onClick={() => setInviteModalOpen(false)} aria-label="招待送信を閉じる" />
          <div className="relative w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-lg font-bold text-gray-800"><UserPlus size={19} className="text-gray-500" />招待を送る</h3>
              <button type="button" onClick={() => setInviteModalOpen(false)} className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><X size={18} /></button>
            </div>
            {isGuest ? (
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 text-sm leading-6 text-gray-500">
                招待を送るにはGoogleログインが必要です。
              </div>
            ) : ownedBoards.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-5 text-center text-sm text-gray-400">
                招待できる自分のボードがありません。
              </div>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const board = ownedBoards.find((item) => item.id === inviteBoardId);
                  if (!board || !inviteEmail.trim()) return;
                  onSendInvite(board, inviteEmail.trim());
                  setInviteEmail('');
                  setInviteModalOpen(false);
                }}
                className="space-y-3"
              >
                <label className="block">
                  <span className="mb-1 ml-1 block text-[10px] font-bold text-gray-500">招待するボード</span>
                  <SelectSheet label="招待するボード" value={inviteBoardId} options={ownedBoards.map((board) => ({ value: board.id, label: board.title }))} onChange={setInviteBoardId} size="md" />
                </label>
                <label className="block">
                  <span className="mb-1 ml-1 block text-[10px] font-bold text-gray-500">Googleメール</span>
                  <input value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="example@gmail.com" className="h-[42px] w-full rounded-lg border border-gray-300 px-3 text-sm outline-none focus:border-gray-500" />
                </label>
                <button className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-gray-800 text-sm font-bold text-white hover:bg-gray-700 disabled:opacity-40" disabled={!inviteBoardId || !inviteEmail.trim()}>
                  <UserPlus size={16} />招待を送信
                </button>
              </form>
            )}
          </div>
        </div>
      ) : null}
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
  const [tab, setTab] = useState<AppTab>('board');
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(null);
  const [prefillTaskDueDate, setPrefillTaskDueDate] = useState<{ value: string; id: number } | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [boardSettingsOpen, setBoardSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [migrationPromptOpen, setMigrationPromptOpen] = useState(false);
  const [migrationSuccess, setMigrationSuccess] = useState(false);
  const [guideOpen, setGuideOpen] = useState(() => localStorage.getItem('task-board-guide-seen-v1') !== '1');
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notifiedTaskKeys, setNotifiedTaskKeys] = useState<Set<string>>(() => new Set(JSON.parse(localStorage.getItem('task-board-notified-v1') || '[]') as string[]));
  const [busy, setBusy] = useState(false);
  const recurrenceRunRef = useRef('');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setAuthLoading(false);
      if (nextUser) {
        localStorage.removeItem('wedding-task-board-guest-mode');
        setIsGuestMode(false);
        await ensureUserProfile(nextUser);
        if (loadLocalState().boards.length > 0 && localStorage.getItem('task-board-local-migration-dismissed') !== '1') setMigrationPromptOpen(true);
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
    const selectedBoard = boards.find((board) => board.id === currentBoardId);
    if (selectedBoard?.kind === 'aggregate') {
      const sourceIds = selectedBoard.sourceBoardIds || [];
      if (sourceIds.length === 0) {
        setTasks([]);
        setSettings(defaultSettings);
        return undefined;
      }
      const taskMap = new Map<string, Task[]>();
      const settingsMap: Record<string, BoardSettings> = {};
      const emitAggregate = () => {
        const view = buildAggregateView(sourceIds, boards, settingsMap, Object.fromEntries(taskMap));
        setSettings(view.settings);
        setTasks(view.tasks);
      };
      const unsubs = sourceIds.flatMap((boardId) => [
        listenSettings(boardId, (nextSettings) => {
          settingsMap[boardId] = nextSettings;
          emitAggregate();
        }),
        listenTasks(boardId, (nextTasks) => {
          taskMap.set(boardId, nextTasks);
          emitAggregate();
        }),
      ]);
      return () => {
        unsubs.forEach((unsubscribe) => unsubscribe());
      };
    }
    const unsubSettings = listenSettings(currentBoardId, setSettings);
    const unsubTasks = listenTasks(currentBoardId, setTasks);
    return () => {
      unsubSettings();
      unsubTasks();
    };
  }, [currentBoardId, isGuestMode, boards]);

  useEffect(() => {
    if (!isGuestMode) return;
    const nextBoards = [...localState.boards].sort((a, b) => b.updatedAt - a.updatedAt);
    setBoards(nextBoards);
    setInvites([]);
    setCurrentBoardId((current) => current || nextBoards[0]?.id || '');
    const selectedBoard = nextBoards.find((board) => board.id === currentBoardId);
    if (selectedBoard?.kind === 'aggregate') {
      const sourceIds = selectedBoard.sourceBoardIds || [];
      const view = buildAggregateView(sourceIds, nextBoards, localState.settingsByBoard, localState.tasksByBoard);
      setSettings(view.settings);
      setTasks(view.tasks);
    } else {
      setSettings(currentBoardId ? localState.settingsByBoard[currentBoardId] || defaultSettings : defaultSettings);
      setTasks(currentBoardId ? localState.tasksByBoard[currentBoardId] || [] : []);
    }
  }, [isGuestMode, localState, currentBoardId]);

  const currentBoard = boards.find((board) => board.id === currentBoardId) || null;
  const currentUser: CurrentUser | null = user || (isGuestMode ? guestUser : null);
  const isOwner = !!currentUser && !!currentBoard && currentBoard.ownerId === currentUser.uid;
  const isAggregateBoard = currentBoard?.kind === 'aggregate';
  const aggregateSourceBoards = isAggregateBoard ? boards.filter((board) => currentBoard?.sourceBoardIds?.includes(board.id)) : [];
  const localMigrationTaskCount = localState.boards.reduce((count, board) => count + (localState.tasksByBoard[board.id]?.length || 0), 0);
  const todayKey = new Date().toISOString().slice(0, 10);
  const tomorrowKey = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const dueNotificationTasks = tasks.filter((task) => {
    if (!settings.notificationsEnabled || task.deletedAt || task.archivedAt || !task.dueDate || task.statusId === 'done') return false;
    if (settings.notifyOverdue !== false && task.dueDate < todayKey) return true;
    if (settings.notifyToday !== false && task.dueDate === todayKey) return true;
    if (settings.notifyTomorrow !== false && task.dueDate === tomorrowKey) return true;
    return false;
  });

  useEffect(() => {
    if (!settings.notificationsEnabled || dueNotificationTasks.length === 0) return;
    const todayStamp = new Date().toISOString().slice(0, 10);
    const freshTasks = dueNotificationTasks.filter((task) => !notifiedTaskKeys.has(`${todayStamp}:${task.sourceBoardId || currentBoardId}:${task.id}`));
    if (freshTasks.length === 0) return;
    setNotificationOpen(true);
    const nextKeys = new Set(notifiedTaskKeys);
    freshTasks.forEach((task) => nextKeys.add(`${todayStamp}:${task.sourceBoardId || currentBoardId}:${task.id}`));
    setNotifiedTaskKeys(nextKeys);
    localStorage.setItem('task-board-notified-v1', JSON.stringify([...nextKeys]));
    if (settings.browserNotificationsEnabled && 'Notification' in window && Notification.permission === 'granted') {
      new Notification('期限が近いタスクがあります', {
        body: `${freshTasks.length}件のタスクを確認してください`,
      });
    }
  }, [settings.notificationsEnabled, settings.browserNotificationsEnabled, settings.notifyOverdue, settings.notifyToday, settings.notifyTomorrow, dueNotificationTasks.length, currentBoardId]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && dueNotificationTasks.length > 0) setNotificationOpen(true);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [dueNotificationTasks.length]);

  useEffect(() => {
    if (!currentBoard || isAggregateBoard) return;
    const rules = settings.recurrenceRules || [];
    const due = rules.flatMap((rule) => recurrenceOccurrences(rule).map((occurrence) => ({ rule, occurrence })));
    if (due.length === 0) return;
    const runKey = `${currentBoard.id}:${due.map((item) => `${item.rule.id}-${item.occurrence.getTime()}`).join('|')}`;
    if (recurrenceRunRef.current === runKey) return;
    recurrenceRunRef.current = runKey;

    const nextRules = rules.map((rule) => {
      const generated = due.filter((item) => item.rule.id === rule.id).map((item) => item.occurrence.getTime());
      return generated.length ? { ...rule, lastGeneratedAt: Math.max(...generated, rule.lastGeneratedAt || 0), updatedAt: Date.now() } : rule;
    });

    const generate = async () => {
      for (const item of due) {
        const task = taskFromRecurrence(item.rule, item.occurrence);
        if (isGuestMode) addLocalTask(currentBoard.id, task);
        else await createTask(currentBoard.id, task);
      }
      if (isGuestMode) updateLocalSettings(currentBoard.id, { recurrenceRules: nextRules });
      else await updateSettings(currentBoard.id, { recurrenceRules: nextRules });
    };

    void generate();
  }, [currentBoardId, settings.recurrenceRules, isAggregateBoard]);

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

  const createDefaultBoard = async (title?: string) => {
    if (!currentUser) return;
    setBusy(true);
    try {
      const requestedTitle = title?.trim();
      if (isGuestMode) {
        const result = createLocalBoard(localState, requestedTitle || (localState.boards.length ? '新しいタスクボード' : 'Simple Task Board'), localState.boards.length === 0);
        saveLocalState(result.state);
        setLocalState(result.state);
        setCurrentBoardId(result.boardId);
        return;
      }
      if (!user) return;
      const exists = await hasAnyBoard(user.uid);
      const id = await createBoard(user, requestedTitle || (exists ? '新しいタスクボード' : 'Simple Task Board'), !exists);
      setCurrentBoardId(id);
    } finally {
      setBusy(false);
    }
  };

  const createAggregate = async (title: string, sourceBoardIds: string[]) => {
    if (!currentUser || !title.trim() || sourceBoardIds.length === 0) return;
    setBusy(true);
    try {
      if (isGuestMode) {
        const boardId = crypto.randomUUID();
        const createdAt = Date.now();
        persistLocalState((state) => ({
          ...state,
          boards: [
            {
              id: boardId,
              title: title.trim(),
              kind: 'aggregate',
              sourceBoardIds,
              ownerId: guestUser.uid,
              memberIds: [],
              memberEmails: [],
              visibility: 'private',
              createdAt,
              updatedAt: createdAt,
              archivedAt: null,
            },
            ...state.boards,
          ],
          settingsByBoard: { ...state.settingsByBoard, [boardId]: defaultSettings },
          tasksByBoard: { ...state.tasksByBoard, [boardId]: [] },
        }));
        setCurrentBoardId(boardId);
        return;
      }
      if (!user) return;
      const id = await createAggregateBoard(user, title.trim(), sourceBoardIds);
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

  const createRecurrenceRule = (rule: RecurrenceRule) => {
    if (!currentBoard || isAggregateBoard) return;
    const nextRules = [...(settings.recurrenceRules || []), rule];
    if (isGuestMode) updateLocalSettings(currentBoard.id, { recurrenceRules: nextRules });
    else updateSettings(currentBoard.id, { recurrenceRules: nextRules });
  };

  const generateRecurrenceTask = async (rule: RecurrenceRule, occurrence = new Date()) => {
    if (!currentBoard || isAggregateBoard) return;
    const task = taskFromRecurrence(rule, occurrence);
    const nextRules = (settings.recurrenceRules || []).map((item) => (
      item.id === rule.id ? { ...item, lastGeneratedAt: Math.max(item.lastGeneratedAt || 0, occurrence.getTime()), updatedAt: Date.now() } : item
    ));
    if (isGuestMode) {
      addLocalTask(currentBoard.id, task);
      updateLocalSettings(currentBoard.id, { recurrenceRules: nextRules });
      return;
    }
    await createTask(currentBoard.id, task);
    await updateSettings(currentBoard.id, { recurrenceRules: nextRules });
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

  const renameCurrentBoard = (title: string) => {
    if (!currentBoard || !title.trim()) return;
    if (isGuestMode) updateLocalBoard(currentBoard.id, { title: title.trim() });
    else updateBoard(currentBoard.id, { title: title.trim() });
  };

  const renameBoardById = (boardId: string, title: string) => {
    if (!title.trim()) return;
    if (isGuestMode) updateLocalBoard(boardId, { title: title.trim() });
    else updateBoard(boardId, { title: title.trim() });
  };

  const updateAggregateSources = (boardId: string, sourceBoardIds: string[]) => {
    if (sourceBoardIds.length === 0) return;
    if (isGuestMode) updateLocalBoard(boardId, { sourceBoardIds });
    else updateBoard(boardId, { sourceBoardIds });
  };

  const migrateLocalData = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const createdIds = await importLocalStateToFirebase(user, localState);
      localStorage.setItem('task-board-local-migration-dismissed', '1');
      setMigrationPromptOpen(false);
      setMigrationSuccess(true);
      if (createdIds[0]) setCurrentBoardId(createdIds[0]);
    } finally {
      setBusy(false);
    }
  };

  const dismissMigration = () => {
    localStorage.setItem('task-board-local-migration-dismissed', '1');
    setMigrationPromptOpen(false);
  };

  const closeGuide = () => {
    localStorage.setItem('task-board-guide-seen-v1', '1');
    setGuideOpen(false);
  };

  const openSourceBoard = (boardId: string) => {
    setCurrentBoardId(boardId);
    setHighlightedTaskId(null);
    setPrefillTaskDueDate(null);
    setBoardSettingsOpen(false);
    setTab('board');
  };

  const openTaskOnBoard = (task: Task) => {
    setBoardSettingsOpen(false);
    if (task.sourceBoardId) setCurrentBoardId(task.sourceBoardId);
    setHighlightedTaskId(task.id);
    setTab('board');
    window.setTimeout(() => setHighlightedTaskId(null), 2600);
  };

  const createTaskForDate = (date: string) => {
    setBoardSettingsOpen(false);
    setHighlightedTaskId(null);
    setPrefillTaskDueDate({ value: date, id: Date.now() });
    setTab('board');
  };

  const changeTab = (nextTab: AppTab) => {
    setBoardSettingsOpen(false);
    if (nextTab !== 'board') setHighlightedTaskId(null);
    if (nextTab !== 'board') setPrefillTaskDueDate(null);
    setTab(nextTab);
  };

  if (authLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-[#fafafa]"><Loader2 className="animate-spin text-gray-400" size={32} /></div>;
  }
  if (!currentUser) return <LoginScreen onGuest={startGuestMode} />;

  return (
    <main className={`min-h-screen bg-[#fafafa] pb-20 text-gray-800 md:pb-6 ${settings.darkMode ? 'app-dark' : ''}`}>
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-[#fafafa]/95 px-3 py-3 backdrop-blur md:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <button type="button" onClick={() => setSidebarOpen(true)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 shadow-sm hover:bg-gray-50" aria-label="ボードメニュー">
                <Menu size={20} />
              </button>
              <button type="button" onClick={() => setSidebarOpen(true)} className="flex h-10 min-w-0 max-w-[210px] items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-left text-sm font-bold text-gray-700 shadow-sm hover:bg-gray-50 sm:max-w-[320px] sm:text-base">
                {isAggregateBoard ? <Layers size={15} className="mr-1 inline-block" /> : <LayoutDashboard size={15} className="mr-1 inline-block" />}
                <span className="min-w-0 truncate">{currentBoard?.title || 'ボードを選択'}</span>
              </button>
              <span className="inline-flex shrink-0 rounded-full border border-gray-200 bg-white px-2 py-1 text-[10px] font-bold text-gray-500">
                {boardStatusLabel(currentBoard, currentUser)}
              </span>
              {invites.length ? <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-gray-800 px-1.5 text-[10px] font-bold text-white"><Bell size={12} />{invites.length}</span> : null}
              {busy ? <Loader2 className="animate-spin text-gray-400" size={18} /> : null}
            </div>
          </div>
          <div className="hidden items-center gap-2 md:flex">
            {(['board', 'calendar', 'search'] as AppTab[]).map((item) => (
              <button key={item} onClick={() => changeTab(item)} className={`rounded-lg px-3 py-2 text-sm font-bold transition-colors ${tab === item ? 'bg-gray-800 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'}`}>
                {item === 'board' ? 'ボード' : item === 'calendar' ? 'カレンダー' : '検索'}
              </button>
            ))}
            <button key="settings" onClick={() => changeTab('settings')} className={`ml-1 flex h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-bold transition-colors ${tab === 'settings' ? 'bg-gray-800 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'}`} title="その他">
              <MoreHorizontal size={16} />その他
            </button>
          </div>
          <button onClick={() => setBoardSettingsOpen(true)} disabled={!currentBoard} className="rounded-lg bg-white p-2 text-gray-500 shadow-sm hover:text-gray-800 disabled:opacity-40" aria-label="ボード設定">
            <Settings size={20} />
          </button>
        </div>
      </header>

      <BoardSidebar
        open={sidebarOpen}
        boards={boards}
        currentBoard={currentBoard}
        currentUser={currentUser}
        onClose={() => setSidebarOpen(false)}
        onSelect={setCurrentBoardId}
        onCreate={createDefaultBoard}
        onCreateAggregate={createAggregate}
        onRenameBoard={renameBoardById}
        onUpdateAggregateSources={updateAggregateSources}
      />

      <div className="mx-auto max-w-6xl px-3 py-4 md:px-6">
        {!online ? <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">オフラインです。接続が戻るまで保存できない場合があります。</div> : null}
        {migrationSuccess ? (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-700 shadow-sm">
            未ログインデータをGoogleアカウントへ引き継ぎました。
            <button type="button" onClick={() => setMigrationSuccess(false)} className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><X size={14} /></button>
          </div>
        ) : null}
        {boards.length === 0 ? (
          <EmptyState onCreate={createDefaultBoard} />
        ) : !currentBoard ? (
          <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500 shadow-sm">ボードを選択してください</div>
        ) : (
          <>
            {tab === 'board' ? (
              <BoardView
                board={currentBoard}
                settings={settings}
                tasks={tasks}
                sourceBoards={aggregateSourceBoards}
                onAddTask={(task) => (isGuestMode ? addLocalTask(currentBoard.id, task) : createTask(currentBoard.id, task))}
                onUpdateTask={(task, updates) => {
                  const targetBoardId = task.sourceBoardId || currentBoard.id;
                  if (isGuestMode) updateLocalTask(targetBoardId, task.id, updates);
                  else updateTask(targetBoardId, task.id, updates);
                }}
                onTrashTask={(task) => {
                  const targetBoardId = task.sourceBoardId || currentBoard.id;
                  if (isGuestMode) updateLocalTask(targetBoardId, task.id, { deletedAt: Date.now() });
                  else updateTask(targetBoardId, task.id, { deletedAt: Date.now() });
                }}
                onArchiveTask={(task) => {
                  const targetBoardId = task.sourceBoardId || currentBoard.id;
                  if (isGuestMode) updateLocalTask(targetBoardId, task.id, { archivedAt: Date.now() });
                  else updateTask(targetBoardId, task.id, { archivedAt: Date.now() });
                }}
                onCreateRecurrence={createRecurrenceRule}
                onOpenSourceBoard={openSourceBoard}
                onOpenSourceTask={openTaskOnBoard}
                highlightedTaskId={highlightedTaskId}
                prefillDueDate={prefillTaskDueDate}
                disableAdd={isAggregateBoard}
                disableDelete={isAggregateBoard}
                disableStatus={isAggregateBoard}
              />
            ) : null}
            {tab === 'calendar' ? (
              <CalendarView tasks={tasks} settings={settings} onOpenTask={openTaskOnBoard} onCreateTaskForDate={isAggregateBoard ? () => undefined : createTaskForDate} />
            ) : null}
            {tab === 'search' ? <SearchView tasks={tasks} settings={settings} onOpenTask={openTaskOnBoard} /> : null}
            {tab === 'settings' ? (
              <SettingsView
                user={currentUser}
                boards={boards}
                isGuest={isGuestMode}
                invites={invites}
                onAcceptInvite={(invite) => user && respondInvite(invite, user, true)}
                onDeclineInvite={(invite) => user && respondInvite(invite, user, false)}
                onSendInvite={(board, email) => user && sendInvite(board, email, user)}
                onFeedback={(message) => (isGuestMode ? alert('未ログインモードではご意見箱の送信はできません。内容は端末内には保存されません。') : user && submitFeedback(user, message))}
                onShowGuide={() => setGuideOpen(true)}
                darkMode={!!settings.darkMode}
                onToggleDarkMode={(enabled) => currentBoard && (isGuestMode ? updateLocalSettings(currentBoard.id, { darkMode: enabled }) : updateSettings(currentBoard.id, { darkMode: enabled }))}
              />
            ) : null}
          </>
        )}
      </div>

      {currentBoard ? (
        <BoardSettingsModal
          open={boardSettingsOpen}
          board={currentBoard}
          sourceBoards={aggregateSourceBoards}
          settings={settings}
          isOwner={isOwner}
          isGuest={isGuestMode}
          onClose={() => setBoardSettingsOpen(false)}
          onRenameBoard={renameCurrentBoard}
          onUpdateSettings={(updates) => (isGuestMode ? updateLocalSettings(currentBoard.id, updates) : updateSettings(currentBoard.id, updates))}
          onInvite={(email) => user && sendInvite(currentBoard, email, user)}
          onRemoveMember={(uid, email) => removeBoardMember(currentBoard, uid, email)}
          onLeaveBoard={() => {
            if (!user) return;
            leaveBoard(currentBoard, user);
            setCurrentBoardId(boards.find((board) => board.id !== currentBoard.id)?.id || '');
            setBoardSettingsOpen(false);
          }}
          onUpdateTask={(taskId, updates) => (isGuestMode ? updateLocalTask(currentBoard.id, taskId, updates) : updateTask(currentBoard.id, taskId, updates))}
          onOpenSourceBoard={openSourceBoard}
          onGenerateRecurrence={generateRecurrenceTask}
          onRestore={(data, mode) => (isGuestMode ? restoreLocalBackup(currentBoard.id, data, mode) : restoreBackup(currentBoard.id, data, mode))}
          onRestoreTask={(taskId) => (isGuestMode ? updateLocalTask(currentBoard.id, taskId, { deletedAt: null }) : updateTask(currentBoard.id, taskId, { deletedAt: null }))}
          onHardDeleteTask={(taskId) => (isGuestMode ? hardDeleteLocalTask(currentBoard.id, taskId) : hardDeleteTask(currentBoard.id, taskId))}
          onEmptyDone={() => tasks.filter((task) => task.statusId === 'done' && !task.deletedAt).forEach((task) => (isGuestMode ? updateLocalTask(currentBoard.id, task.id, { deletedAt: Date.now() }) : updateTask(currentBoard.id, task.id, { deletedAt: Date.now() })))}
          onDeleteBoard={() => {
            if (isGuestMode) deleteLocalBoard(currentBoard.id);
            else deleteBoard(currentBoard.id);
            setBoardSettingsOpen(false);
          }}
          onEmptyTrash={() => {
            tasks.filter((task) => task.deletedAt).forEach((task) => (isGuestMode ? hardDeleteLocalTask(currentBoard.id, task.id) : hardDeleteTask(currentBoard.id, task.id)));
            tasks
              .filter((task) => !task.deletedAt && task.subtasks.some((subtask) => subtask.deletedAt))
              .forEach((task) => {
                const subtasks = task.subtasks.filter((subtask) => !subtask.deletedAt);
                if (isGuestMode) updateLocalTask(currentBoard.id, task.id, { subtasks });
                else updateTask(currentBoard.id, task.id, { subtasks });
              });
            const hasDeletedSettings = (settings.deletedAssignees?.length || 0) > 0 || (settings.deletedStatuses?.length || 0) > 0 || (settings.deletedRecurrenceRules?.length || 0) > 0;
            if (hasDeletedSettings) {
              if (isGuestMode) updateLocalSettings(currentBoard.id, { deletedAssignees: [], deletedStatuses: [], deletedRecurrenceRules: [] });
              else updateSettings(currentBoard.id, { deletedAssignees: [], deletedStatuses: [], deletedRecurrenceRules: [] });
            }
          }}
          tasks={tasks}
        />
      ) : null}

      {guideOpen ? <GuideModal onClose={closeGuide} /> : null}

      {migrationPromptOpen ? (
        <div className="fixed inset-0 z-[170] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
            <h2 className="text-lg font-bold text-gray-800">未ログインデータを引き継ぎますか？</h2>
            <p className="mt-2 text-sm leading-6 text-gray-600">このブラウザ内に保存されているデータを、Googleアカウントへコピーできます。</p>
            <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs leading-5 text-gray-600">
              ボード: {localState.boards.length}件 / タスク: {localMigrationTaskCount}件
              <br />
              引き継がない場合も、未ログインデータはこのブラウザ内に残ります。
            </div>
            <div className="mt-5 grid gap-2">
              <button type="button" onClick={migrateLocalData} className="flex h-11 items-center justify-center gap-2 rounded-lg bg-gray-800 text-sm font-bold text-white hover:bg-gray-700">
                {busy ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />}Googleに引き継ぐ
              </button>
              <button type="button" onClick={dismissMigration} className="h-10 rounded-lg border border-gray-300 bg-white text-sm font-bold text-gray-600 hover:bg-gray-50">今回は引き継がない</button>
            </div>
          </div>
        </div>
      ) : null}

      {notificationOpen && dueNotificationTasks.length > 0 ? (
        <div className="fixed inset-x-3 bottom-20 z-[120] mx-auto max-w-md rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl md:bottom-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-bold text-gray-800"><Bell size={16} />期限が近いタスク</h2>
              <p className="mt-1 text-xs text-gray-500">期限切れ/今日/明日のタスクがあります。</p>
            </div>
            <button type="button" onClick={() => setNotificationOpen(false)} className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><X size={16} /></button>
          </div>
          <div className="mt-3 max-h-52 space-y-2 overflow-y-auto pr-1">
            {dueNotificationTasks.slice(0, 5).map((task) => (
              <button key={`${task.sourceBoardId || currentBoardId}-${task.id}`} type="button" onClick={() => { setNotificationOpen(false); openTaskOnBoard(task); }} className="flex w-full items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-left">
                <span className="min-w-0 truncate text-sm font-bold text-gray-700">{task.title}</span>
                <span className={`shrink-0 rounded-md border px-2 py-1 text-xs font-bold ${dueDateTone(task.dueDate)}`}>{task.dueDate ? dateLabel(task.dueDate).replace(/\(.+\)/, '') : '-'}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <BottomTabs active={tab} onChange={changeTab} />
    </main>
  );
}



