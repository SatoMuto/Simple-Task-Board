import { createSampleTasks, defaultSettings } from './sampleData';
import type { Board, BoardSettings, Task } from './types';

const STORAGE_KEY = 'wedding-task-board-local-v1';
const LOCAL_USER_ID = 'local-user';

export type LocalState = {
  boards: Board[];
  settingsByBoard: Record<string, BoardSettings>;
  tasksByBoard: Record<string, Task[]>;
};

export const guestUser = {
  uid: LOCAL_USER_ID,
  email: '',
  displayName: '未ログインユーザー',
  photoURL: '',
  isGuest: true,
};

const now = () => Date.now();

const emptyState = (): LocalState => ({
  boards: [],
  settingsByBoard: {},
  tasksByBoard: {},
});

export const loadLocalState = (): LocalState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as LocalState;
    return {
      boards: parsed.boards || [],
      settingsByBoard: parsed.settingsByBoard || {},
      tasksByBoard: parsed.tasksByBoard || {},
    };
  } catch {
    return emptyState();
  }
};

export const saveLocalState = (state: LocalState) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};

export const createLocalBoard = (state: LocalState, title: string, seedSamples: boolean): { state: LocalState; boardId: string } => {
  const boardId = crypto.randomUUID();
  const createdAt = now();
  const board: Board = {
    id: boardId,
    title,
    kind: 'board',
    sourceBoardIds: [],
    ownerId: LOCAL_USER_ID,
    memberIds: [],
    memberEmails: [],
    visibility: 'private',
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
  };
  const tasks = seedSamples
    ? createSampleTasks().map((task) => ({
        id: crypto.randomUUID(),
        ...task,
      }))
    : [];

  return {
    boardId,
    state: {
      boards: [board, ...state.boards],
      settingsByBoard: { ...state.settingsByBoard, [boardId]: defaultSettings },
      tasksByBoard: { ...state.tasksByBoard, [boardId]: tasks },
    },
  };
};

export const touchLocalBoard = (board: Board): Board => ({
  ...board,
  updatedAt: now(),
});
