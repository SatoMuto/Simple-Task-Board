export type Visibility = 'private' | 'shared';
export type AppTab = 'board' | 'calendar' | 'search' | 'settings';
export type BoardKind = 'board' | 'aggregate';

export type StatusColumn = {
  id: string;
  title: string;
  color: string;
  isDefault?: boolean;
};

export type Assignee = {
  id: string;
  name: string;
  color: string;
};

export type Subtask = {
  id: string;
  text: string;
  completed: boolean;
  deletedAt?: number | null;
};

export type Board = {
  id: string;
  title: string;
  kind?: BoardKind;
  sourceBoardIds?: string[];
  ownerId: string;
  memberIds: string[];
  memberEmails: string[];
  visibility: Visibility;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number | null;
};

export type BoardSettings = {
  assignees: Assignee[];
  statuses: StatusColumn[];
  deletedAssignees?: Assignee[];
  deletedStatuses?: StatusColumn[];
  recurrenceRules?: RecurrenceRule[];
  deletedRecurrenceRules?: RecurrenceRule[];
  autoArchiveDone: boolean;
  defaultCollapsed: boolean;
  darkMode?: boolean;
  notificationsEnabled?: boolean;
  browserNotificationsEnabled?: boolean;
  notifyOverdue?: boolean;
  notifyToday?: boolean;
  notifyTomorrow?: boolean;
};

export type RecurrenceRule = {
  id: string;
  title: string;
  statusId: string;
  assigneeIds: string[];
  priority: number;
  memo: string;
  subtasks: Subtask[];
  scheduleType: 'daily' | 'weekly' | 'monthly';
  time: string;
  weekdays?: number[];
  dayOfMonth?: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastGeneratedAt: number;
};

export type Task = {
  id: string;
  title: string;
  statusId: string;
  assigneeIds: string[];
  priority: number;
  dueDate: string;
  memo: string;
  subtasks: Subtask[];
  createdAt: number;
  updatedAt: number;
  completedAt?: number | null;
  deletedAt?: number | null;
  archivedAt?: number | null;
  recurrenceRuleId?: string;
  recurrenceOccurrenceAt?: number;
  sourceBoardId?: string;
  sourceBoardTitle?: string;
  availableAggregateStatusIds?: string[];
};

export type Invite = {
  id: string;
  boardId: string;
  boardTitle: string;
  email: string;
  createdBy: string;
  createdByName: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: number;
  respondedAt?: number | null;
};

export type BackupData = {
  type: 'wedding-task-board-backup';
  version: 1;
  board: Board;
  settings: BoardSettings;
  tasks: Task[];
  exportedAt: number;
};
