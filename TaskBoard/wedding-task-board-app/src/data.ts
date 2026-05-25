import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from './firebase';
import { createSampleTasks, defaultSettings } from './sampleData';
import type { BackupData, Board, BoardSettings, Invite, Task } from './types';
import type { LocalState } from './localStore';

const now = () => Date.now();

export const boardRef = (boardId: string) => doc(db, 'boards', boardId);
export const settingsRef = (boardId: string) => doc(db, 'boards', boardId, 'settings', 'config');
export const tasksRef = (boardId: string) => collection(db, 'boards', boardId, 'tasks');

export const ensureUserProfile = async (user: User) => {
  await setDoc(
    doc(db, 'users', user.uid),
    {
      uid: user.uid,
      email: user.email ?? '',
      displayName: user.displayName ?? '',
      photoURL: user.photoURL ?? '',
      updatedAt: now(),
    },
    { merge: true },
  );
};

export const listenBoards = (userId: string, onChange: (boards: Board[]) => void) => {
  const ownedQuery = query(collection(db, 'boards'), where('ownerId', '==', userId));
  const memberQuery = query(collection(db, 'boards'), where('memberIds', 'array-contains', userId));
  const map = new Map<string, Board>();

  const emit = () => onChange([...map.values()].sort((a, b) => b.updatedAt - a.updatedAt));
  const unsubOwned = onSnapshot(ownedQuery, (snapshot) => {
    snapshot.docs.forEach((item) => map.set(item.id, { id: item.id, ...item.data() } as Board));
    emit();
  });
  const unsubMember = onSnapshot(memberQuery, (snapshot) => {
    snapshot.docs.forEach((item) => map.set(item.id, { id: item.id, ...item.data() } as Board));
    emit();
  });

  return () => {
    unsubOwned();
    unsubMember();
  };
};

export const listenSettings = (boardId: string, onChange: (settings: BoardSettings) => void) =>
  onSnapshot(settingsRef(boardId), (snapshot) => {
    onChange(snapshot.exists() ? ({ ...defaultSettings, ...snapshot.data() } as BoardSettings) : defaultSettings);
  });

export const listenTasks = (boardId: string, onChange: (tasks: Task[]) => void) => {
  const tasksQuery = query(tasksRef(boardId), orderBy('createdAt', 'asc'));
  return onSnapshot(tasksQuery, (snapshot) => {
    onChange(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Task));
  });
};

export const listenInvites = (email: string, onChange: (invites: Invite[]) => void) => {
  const invitesQuery = query(collection(db, 'invites'), where('email', '==', email), where('status', '==', 'pending'));
  return onSnapshot(invitesQuery, (snapshot) => {
    onChange(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Invite));
  });
};

export const createBoard = async (user: User, title: string, seedSamples = false) => {
  const createdAt = now();
  const newBoard: Omit<Board, 'id'> = {
    title,
    kind: 'board',
    sourceBoardIds: [],
    ownerId: user.uid,
    memberIds: [],
    memberEmails: [],
    visibility: 'private',
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
  };
  const created = await addDoc(collection(db, 'boards'), newBoard);
  const batch = writeBatch(db);
  batch.set(settingsRef(created.id), defaultSettings);
  if (seedSamples) {
    createSampleTasks().forEach((task) => batch.set(doc(tasksRef(created.id)), task));
  }
  await batch.commit();
  return created.id;
};

export const createAggregateBoard = async (user: User, title: string, sourceBoardIds: string[]) => {
  const createdAt = now();
  const newBoard: Omit<Board, 'id'> = {
    title,
    kind: 'aggregate',
    sourceBoardIds,
    ownerId: user.uid,
    memberIds: [],
    memberEmails: [],
    visibility: 'private',
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
  };
  const created = await addDoc(collection(db, 'boards'), newBoard);
  await setDoc(settingsRef(created.id), defaultSettings);
  return created.id;
};

export const updateBoard = async (boardId: string, updates: Partial<Board>) => {
  await updateDoc(boardRef(boardId), { ...updates, updatedAt: now() });
};

export const deleteBoard = async (boardId: string) => {
  const batch = writeBatch(db);
  const taskDocs = await getDocs(tasksRef(boardId));
  taskDocs.forEach((item) => batch.delete(item.ref));
  batch.delete(settingsRef(boardId));
  batch.delete(boardRef(boardId));
  await batch.commit();
};

export const updateSettings = async (boardId: string, settings: Partial<BoardSettings>) => {
  await setDoc(settingsRef(boardId), settings, { merge: true });
  await updateBoard(boardId, {});
};

export const createTask = async (boardId: string, task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>) => {
  const createdAt = now();
  await addDoc(tasksRef(boardId), {
    ...task,
    createdAt,
    updatedAt: createdAt,
  });
  await updateBoard(boardId, {});
};

export const updateTask = async (boardId: string, taskId: string, updates: Partial<Task>) => {
  const completedAt = updates.statusId === 'done' ? now() : updates.statusId && updates.statusId !== 'done' ? null : updates.completedAt;
  await updateDoc(doc(tasksRef(boardId), taskId), {
    ...updates,
    ...(completedAt !== undefined ? { completedAt } : {}),
    updatedAt: now(),
  });
  await updateBoard(boardId, {});
};

export const hardDeleteTask = async (boardId: string, taskId: string) => {
  await deleteDoc(doc(tasksRef(boardId), taskId));
  await updateBoard(boardId, {});
};

export const removeBoardMember = async (board: Board, uid: string, email: string) => {
  const memberIds = (board.memberIds || []).filter((item) => item !== uid);
  const memberEmails = (board.memberEmails || []).filter((item) => item !== email.toLowerCase());
  await updateBoard(board.id, {
    memberIds,
    memberEmails,
    visibility: memberIds.length || memberEmails.length ? 'shared' : 'private',
  });
};

export const leaveBoard = async (board: Board, user: User) => {
  const uid = user.uid;
  const email = (user.email || '').toLowerCase();
  const memberIds = (board.memberIds || []).filter((item) => item !== uid);
  const memberEmails = (board.memberEmails || []).filter((item) => item !== email);
  await updateBoard(board.id, {
    memberIds,
    memberEmails,
    visibility: memberIds.length || memberEmails.length ? 'shared' : 'private',
  });
};

export const sendInvite = async (board: Board, email: string, user: User) => {
  const normalizedEmail = email.trim().toLowerCase();
  await addDoc(collection(db, 'invites'), {
    boardId: board.id,
    boardTitle: board.title,
    email: normalizedEmail,
    createdBy: user.uid,
    createdByName: user.displayName || user.email || 'ボードオーナー',
    status: 'pending',
    createdAt: now(),
    respondedAt: null,
  });
  await updateBoard(board.id, {
    visibility: 'shared',
    memberEmails: [...new Set([...(board.memberEmails || []), normalizedEmail])],
  });
};

export const respondInvite = async (invite: Invite, user: User, accept: boolean) => {
  await runTransaction(db, async (transaction) => {
    const boardSnap = await transaction.get(boardRef(invite.boardId));
    if (!boardSnap.exists()) throw new Error('Board not found');
    const board = boardSnap.data() as Board;
    const memberIds = accept ? [...new Set([...(board.memberIds || []), user.uid])] : board.memberIds || [];
    const memberEmails = accept ? [...new Set([...(board.memberEmails || []), (user.email || '').toLowerCase()])] : board.memberEmails || [];
    transaction.update(boardRef(invite.boardId), {
      memberIds,
      memberEmails,
      visibility: memberIds.length > 0 ? 'shared' : board.visibility,
      updatedAt: now(),
    });
    transaction.update(doc(db, 'invites', invite.id), {
      status: accept ? 'accepted' : 'declined',
      respondedAt: now(),
    });
  });
};

export const submitFeedback = async (user: User, message: string) => {
  await addDoc(collection(db, 'feedback'), {
    userId: user.uid,
    email: user.email ?? '',
    displayName: user.displayName ?? '',
    message,
    createdAt: now(),
  });
};

export const restoreBackup = async (boardId: string, data: BackupData, mode: 'append' | 'replace') => {
  const batch = writeBatch(db);
  if (mode === 'replace') {
    const existing = await getDocs(tasksRef(boardId));
    existing.forEach((item) => batch.delete(item.ref));
  }
  batch.set(settingsRef(boardId), data.settings, { merge: mode === 'append' });
  data.tasks.forEach((task) => {
    const { id, ...taskData } = task;
    batch.set(doc(tasksRef(boardId), mode === 'append' ? crypto.randomUUID() : id), {
      ...taskData,
      updatedAt: now(),
    });
  });
  await batch.commit();
  await updateBoard(boardId, {});
};

export const importLocalStateToFirebase = async (user: User, localState: LocalState) => {
  const createdIds: string[] = [];
  for (const localBoard of localState.boards.filter((board) => (board.kind || 'board') === 'board')) {
    const createdAt = now();
    const { id: _localBoardId, ...localBoardData } = localBoard;
    const newBoard: Omit<Board, 'id'> = {
      ...localBoardData,
      kind: 'board',
      sourceBoardIds: [],
      ownerId: user.uid,
      memberIds: [],
      memberEmails: [],
      visibility: 'private',
      createdAt,
      updatedAt: createdAt,
      archivedAt: localBoard.archivedAt ?? null,
    };
    const created = await addDoc(collection(db, 'boards'), newBoard);
    createdIds.push(created.id);
    const batch = writeBatch(db);
    batch.set(settingsRef(created.id), localState.settingsByBoard[localBoard.id] || defaultSettings);
    (localState.tasksByBoard[localBoard.id] || []).forEach((task) => {
      const { id, sourceBoardId, sourceBoardTitle, ...taskData } = task;
      batch.set(doc(tasksRef(created.id), id || crypto.randomUUID()), {
        ...taskData,
        updatedAt: now(),
      });
    });
    await batch.commit();
  }
  return createdIds;
};

export const hasAnyBoard = async (userId: string) => {
  const existing = await getDocs(query(collection(db, 'boards'), where('ownerId', '==', userId), limit(1)));
  return !existing.empty;
};
