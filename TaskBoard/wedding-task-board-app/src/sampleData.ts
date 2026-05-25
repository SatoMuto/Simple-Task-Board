import type { Assignee, BoardSettings, StatusColumn, Task } from './types';

export const defaultStatuses: StatusColumn[] = [
  { id: 'todo', title: '未対応', color: '#94a3b8', isDefault: true },
  { id: 'ready', title: '準備中', color: '#38bdf8' },
  { id: 'in-progress', title: '進行中', color: '#f59e0b', isDefault: true },
  { id: 'review', title: '確認中', color: '#a78bfa' },
  { id: 'done', title: '完了', color: '#22c55e', isDefault: true },
];

export const defaultAssignees: Assignee[] = [
  { id: 'me', name: 'わたし（サンプル）', color: '#111827' },
  { id: 'partner', name: '家族（サンプル）', color: '#2563eb' },
  { id: 'couple', name: '一緒に（サンプル）', color: '#db2777' },
  { id: 'everyone', name: 'みんな（サンプル）', color: '#16a34a' },
];

export const defaultSettings: BoardSettings = {
  assignees: defaultAssignees,
  statuses: defaultStatuses,
  deletedAssignees: [],
  deletedStatuses: [],
  recurrenceRules: [],
  deletedRecurrenceRules: [],
  autoArchiveDone: false,
  defaultCollapsed: true,
  darkMode: false,
  notificationsEnabled: true,
  browserNotificationsEnabled: false,
  notifyOverdue: true,
  notifyToday: true,
  notifyTomorrow: true,
};

export const createSampleTasks = (): Omit<Task, 'id'>[] => {
  const now = Date.now();
  const threeDays = new Date(now + 86400000 * 3).toISOString().slice(0, 10);
  const sevenDays = new Date(now + 86400000 * 7).toISOString().slice(0, 10);

  return [
    {
      title: '週末の買い物リストを作る（サンプル）',
      statusId: 'todo',
      assigneeIds: ['couple'],
      priority: 75,
      dueDate: threeDays,
      memo: '冷蔵庫の中を見て、足りないものをメモする',
      subtasks: [
        { id: crypto.randomUUID(), text: '牛乳・卵・野菜を確認', completed: false },
        { id: crypto.randomUUID(), text: '日用品の残りを確認', completed: false },
      ],
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      deletedAt: null,
      archivedAt: null,
    },
    {
      title: 'リビングを掃除する（サンプル）',
      statusId: 'in-progress',
      assigneeIds: ['me'],
      priority: 45,
      dueDate: sevenDays,
      memo: '',
      subtasks: [
        { id: crypto.randomUUID(), text: '床のものを片付ける', completed: true },
        { id: crypto.randomUUID(), text: '掃除機をかける', completed: false },
      ],
      createdAt: now + 1,
      updatedAt: now + 1,
      completedAt: null,
      deletedAt: null,
      archivedAt: null,
    },
    {
      title: '今月の支払い予定を確認する（サンプル）',
      statusId: 'review',
      assigneeIds: ['me'],
      priority: 60,
      dueDate: sevenDays,
      memo: '引き落とし日と残高を確認する',
      subtasks: [
        { id: crypto.randomUUID(), text: 'クレジットカード明細を見る', completed: false },
        { id: crypto.randomUUID(), text: '公共料金の引き落とし日を確認', completed: false },
      ],
      createdAt: now + 2,
      updatedAt: now + 2,
      completedAt: null,
      deletedAt: null,
      archivedAt: null,
    },
  ];
};
