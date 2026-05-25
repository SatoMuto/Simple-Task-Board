export type Visibility = 'private' | 'shared';
export type AppTab = 'board' | 'calendar' | 'search' | 'settings';

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
  autoArchiveDone: boolean;
  defaultCollapsed: boolean;
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
