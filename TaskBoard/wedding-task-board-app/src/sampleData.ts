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
  { id: 'partner', name: 'パートナー（サンプル）', color: '#2563eb' },
  { id: 'couple', name: '夫婦（サンプル）', color: '#db2777' },
  { id: 'everyone', name: 'みんな（サンプル）', color: '#16a34a' },
];

export const defaultSettings: BoardSettings = {
  assignees: defaultAssignees,
  statuses: defaultStatuses,
  autoArchiveDone: false,
  defaultCollapsed: false,
};

export const createSampleTasks = (): Omit<Task, 'id'>[] => {
  const now = Date.now();
  const threeDays = new Date(now + 86400000 * 3).toISOString().slice(0, 10);
  const sevenDays = new Date(now + 86400000 * 7).toISOString().slice(0, 10);

  return [
    {
      title: '招待ゲスト一覧を確認する（サンプル）',
      statusId: 'todo',
      assigneeIds: ['couple'],
      priority: 75,
      dueDate: threeDays,
      memo: '必要な情報が揃ったら式場へ共有する',
      subtasks: [
        { id: crypto.randomUUID(), text: '親族リストを確認', completed: false },
        { id: crypto.randomUUID(), text: '友人リストを確認', completed: false },
      ],
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      deletedAt: null,
      archivedAt: null,
    },
    {
      title: '持ち込みアイテムを洗い出す（サンプル）',
      statusId: 'in-progress',
      assigneeIds: ['me'],
      priority: 45,
      dueDate: sevenDays,
      memo: '',
      subtasks: [
        { id: crypto.randomUUID(), text: '受付アイテム', completed: true },
        { id: crypto.randomUUID(), text: '写真・装飾', completed: false },
      ],
      createdAt: now + 1,
      updatedAt: now + 1,
      completedAt: null,
      deletedAt: null,
      archivedAt: null,
    },
  ];
};
