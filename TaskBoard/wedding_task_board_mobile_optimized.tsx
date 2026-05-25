// ============================================================================
// Wedding Task Board (Multi-Board Version / Mobile Optimized)
// ============================================================================

import React, { useState, useEffect, useCallback, memo, useRef } from 'react';
import { 
  Plus, GripVertical, Trash2, CheckSquare, Square, X, 
  Loader2, Download, Upload, Check, Settings, ChevronDown, ChevronRight, Edit2, RotateCcw,
  Calendar, Filter, Menu, LayoutDashboard, Flag, Lock
} from 'lucide-react';

// Firebase imports
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged, setPersistence, inMemoryPersistence } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, doc, setDoc, deleteDoc } from 'firebase/firestore';

const firebaseConfig = JSON.parse(__firebase_config);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

const TASK_STATUS = {
  TODO: 'todo',
  READY: 'ready',
  IN_PROGRESS: 'in-progress',
  REVIEW: 'review',
  DONE: 'done'
};

// 初期デフォルトのステータス（削除不可の3つ ＋ 削除可の2つ）
const defaultColumns = [
  { id: TASK_STATUS.TODO, title: '未対応 (To Do)', isDeletable: false },
  { id: TASK_STATUS.READY, title: '準備中 (Ready)', isDeletable: true },
  { id: TASK_STATUS.IN_PROGRESS, title: '進行中 (In Progress)', isDeletable: false },
  { id: TASK_STATUS.REVIEW, title: '確認中 (Review)', isDeletable: true },
  { id: TASK_STATUS.DONE, title: '完了 (Done)', isDeletable: false }
];

const getPriorityColorRGB = (priority) => {
  const colors = [
    { p: 0,   rgb: [156, 163, 175] }, 
    { p: 25,  rgb: [52, 211, 153] },  
    { p: 50,  rgb: [250, 204, 21] },  
    { p: 75,  rgb: [249, 115, 22] },  
    { p: 100, rgb: [239, 68, 68] }    
  ];
  
  let c1 = colors[0], c2 = colors[colors.length - 1];
  for (let i = 0; i < colors.length - 1; i++) {
    if (priority >= colors[i].p && priority <= colors[i + 1].p) {
      c1 = colors[i];
      c2 = colors[i + 1];
      break;
    }
  }
  
  if (c1 === c2) return `rgb(${c1.rgb[0]}, ${c1.rgb[1]}, ${c1.rgb[2]})`;
  
  const range = c2.p - c1.p;
  const ratio = (priority - c1.p) / range;
  const r = Math.round(c1.rgb[0] + (c2.rgb[0] - c1.rgb[0]) * ratio);
  const g = Math.round(c1.rgb[1] + (c2.rgb[1] - c1.rgb[1]) * ratio);
  const b = Math.round(c1.rgb[2] + (c2.rgb[2] - c1.rgb[2]) * ratio);
  
  return `rgb(${r}, ${g}, ${b})`;
};

// ============================================================================
// カスタムフック
// ============================================================================

// 1. 認証管理
const useAuth = () => {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const initAuth = async () => {
      try {
        await setPersistence(auth, inMemoryPersistence);
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) { 
        console.error("Auth Error:", error); 
        if (isMounted) setAuthLoading(false);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      if (isMounted) {
        setUser(u);
        setAuthLoading(false);
      }
    });
    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  return { user, authLoading };
};

// 2. ボード一覧の管理
const useBoards = (user) => {
  const [boards, setBoards] = useState([]);
  const [boardsLoading, setBoardsLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const boardsRef = doc(db, 'artifacts', appId, 'public', 'data', 'app-state', 'global');
    const unsubscribe = onSnapshot(boardsRef, (docSnap) => {
      if (docSnap.exists() && docSnap.data().boards) {
        setBoards(docSnap.data().boards);
      } else {
        const defaultBoards = [{ id: 'default', title: 'Wedding Task Board', isDeleted: false }];
        setBoards(defaultBoards);
        setDoc(boardsRef, { boards: defaultBoards }, { merge: true });
      }
      setBoardsLoading(false);
    });
    return () => unsubscribe();
  }, [user]);

  const addBoard = async (title) => {
    if (!user) return;
    const newId = crypto.randomUUID();
    const newBoards = [...boards, { id: newId, title, isDeleted: false }];
    await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'app-state', 'global'), { boards: newBoards }, { merge: true });
    await setDoc(doc(db, 'artifacts', appId, 'public', 'data', `settings-${newId}`, 'config'), {
      title: title,
      assignees: ['ゆうき', 'かりん', 'ふたり'],
      deletedAssignees: [],
      columns: defaultColumns,
      deletedColumns: []
    });
    return newId;
  };

  const updateBoardInList = async (boardId, updates) => {
    if (!user) return;
    const newBoards = boards.map(b => b.id === boardId ? { ...b, ...updates } : b);
    await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'app-state', 'global'), { boards: newBoards }, { merge: true });
  };

  const hardDeleteBoard = async (boardId) => {
    if (!user) return;
    const newBoards = boards.filter(b => b.id !== boardId);
    await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'app-state', 'global'), { boards: newBoards }, { merge: true });
  };

  return { boards, addBoard, updateBoardInList, hardDeleteBoard, boardsLoading };
};

// 3. 現在のボードのタスクと設定の管理
const useTasks = (user, boardId) => {
  const [tasks, setTasks] = useState([]);
  const defaultSettings = { 
    title: 'Wedding Task Board', 
    assignees: ['ゆうき', 'かりん', 'ふたり'], 
    deletedAssignees: [], 
    columns: defaultColumns, 
    deletedColumns: [] 
  };
  const [settings, setSettings] = useState(defaultSettings);
  const [tasksLoading, setTasksLoading] = useState(true);

  const tasksColName = boardId === 'default' ? 'wedding-tasks' : `tasks-${boardId}`;
  const settingsColName = boardId === 'default' ? 'wedding-settings' : `settings-${boardId}`;
  const settingsDocName = boardId === 'default' ? 'app-config' : 'config';

  useEffect(() => {
    if (!user || !boardId) return;
    setTasksLoading(true);
    setTasks([]);

    const tasksRef = collection(db, 'artifacts', appId, 'public', 'data', tasksColName);
    const unsubTasks = onSnapshot(tasksRef, (snapshot) => {
      
      const isFirstLoad = !localStorage.getItem(`seeded-${appId}-${boardId}`);
      if (snapshot.empty && isFirstLoad) {
        localStorage.setItem(`seeded-${appId}-${boardId}`, 'true');
        
        const task1Id = crypto.randomUUID();
        const task2Id = crypto.randomUUID();

        setDoc(doc(tasksRef, task1Id), {
          title: '週末のお買い物',
          status: 'todo',
          assignee: 'ふたり',
          priority: 80,
          dueDate: new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0],
          memo: 'スーパーと薬局に行く\nポイントカードを忘れないこと！',
          subtasks: [
            { id: crypto.randomUUID(), text: '洗剤の詰め替え', completed: false, isDeleted: false },
            { id: crypto.randomUUID(), text: 'トイレットペーパー', completed: false, isDeleted: false }
          ],
          createdAt: Date.now(),
          isDeleted: false
        });

        setDoc(doc(tasksRef, task2Id), {
          title: 'リビングのお掃除',
          status: 'in-progress',
          assignee: 'ゆうき',
          priority: 40,
          dueDate: '',
          memo: '窓拭きも忘れずに！',
          subtasks: [
            { id: crypto.randomUUID(), text: '掃除機をかける', completed: true, isDeleted: false },
            { id: crypto.randomUUID(), text: 'ゴミ捨て', completed: false, isDeleted: false }
          ],
          createdAt: Date.now() - 1000,
          isDeleted: false
        });
      } else if (isFirstLoad) {
        localStorage.setItem(`seeded-${appId}-${boardId}`, 'true');
      }

      const fetchedTasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setTasks(fetchedTasks);
      setTasksLoading(false);
    }, (error) => { console.error(error); setTasksLoading(false); });

    const settingsRef = doc(db, 'artifacts', appId, 'public', 'data', settingsColName, settingsDocName);
    const unsubSettings = onSnapshot(settingsRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        // 古いデータには columns がない場合があるのでマージする
        setSettings({ ...defaultSettings, ...data, columns: data.columns || defaultColumns });
      } else {
        setSettings(defaultSettings);
      }
    });

    return () => { unsubTasks(); unsubSettings(); };
  }, [user, boardId]);

  const updateSettings = useCallback(async (newSettings) => {
    if (!user || !boardId) return;
    try { await setDoc(doc(db, 'artifacts', appId, 'public', 'data', settingsColName, settingsDocName), newSettings, { merge: true }); } 
    catch (error) { console.error(error); }
  }, [user, boardId, settingsColName, settingsDocName]);

  const addTask = useCallback(async (newTaskData) => {
    if (!user || !boardId) return;
    const newTaskId = crypto.randomUUID();
    const newTask = { ...newTaskData, createdAt: Date.now(), isDeleted: false };
    try { await setDoc(doc(db, 'artifacts', appId, 'public', 'data', tasksColName, newTaskId), newTask); } 
    catch (error) { console.error(error); }
  }, [user, boardId, tasksColName]);

  const updateTask = useCallback(async (taskId, updatedFields) => {
    if (!user || !boardId) return;
    try { await setDoc(doc(db, 'artifacts', appId, 'public', 'data', tasksColName, taskId), updatedFields, { merge: true }); } 
    catch (error) { console.error(error); }
  }, [user, boardId, tasksColName]);

  const deleteTask = useCallback(async (taskId) => {
    if (!user || !boardId) return;
    try { await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', tasksColName, taskId)); } 
    catch (error) { console.error(error); }
  }, [user, boardId, tasksColName]);

  const importData = useCallback(async (importedTasks, importedSettings = null) => {
    if (!user || !boardId) return;
    if (importedSettings) {
      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', settingsColName, settingsDocName), importedSettings, { merge: true });
    }
    for (const task of importedTasks) {
      const taskId = task.id;
      if (!taskId) continue;
      const { id, ...taskData } = task;
      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', tasksColName, taskId), taskData, { merge: true });
    }
  }, [user, boardId, settingsColName, settingsDocName, tasksColName]);

  return { tasks, settings, updateSettings, tasksLoading, addTask, updateTask, deleteTask, importData };
};

// ============================================================================
// 汎用UIコンポーネント群
// ============================================================================

const CustomModal = ({ isOpen, title, message, onConfirm, onCancel, confirmText = "はい", cancelText = "キャンセル", isDanger, children, zIndex = "z-[150]" }) => {
  if (!isOpen) return null;
  return (
    <div className={`fixed inset-0 bg-black/50 flex items-center justify-center ${zIndex} p-4`}>
      <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl max-h-[90vh] flex flex-col">
        <h3 className="font-bold text-lg mb-2 text-gray-900 shrink-0 flex items-center gap-2">{title}</h3>
        {message && <p className="text-gray-800 mb-6 text-sm whitespace-pre-wrap shrink-0 leading-relaxed">{message}</p>}
        <div className="overflow-y-auto mb-6 shrink custom-scrollbar pr-2">{children}</div>
        <div className="flex justify-end gap-3 shrink-0">
          {onCancel && <button onClick={onCancel} className="px-5 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors">{cancelText}</button>}
          {onConfirm && <button onClick={onConfirm} className={`px-5 py-2.5 text-sm font-medium text-white rounded-xl shadow-md transition-all active:scale-95 ${isDanger ? 'bg-red-500 hover:bg-red-600' : 'bg-gray-800 hover:bg-gray-700'}`}>{confirmText}</button>}
        </div>
      </div>
    </div>
  );
};

// 汎用：削除確認付きインラインボタン
const DeleteConfirmButton = ({ onConfirm, title = "削除" }) => {
  const [isConfirming, setIsConfirming] = useState(false);
  if (isConfirming) {
    return (
      <div className="flex items-center gap-2 animate-in fade-in duration-200 pl-2">
        <span className="text-[11px] font-bold text-red-600">削除しますか？</span>
        <button onClick={onConfirm} className="bg-red-500 text-white text-[10px] px-2 py-1 rounded hover:bg-red-600 font-medium">はい</button>
        <button onClick={() => setIsConfirming(false)} className="bg-white text-gray-600 text-[10px] px-2 py-1 rounded border border-gray-200 hover:bg-gray-50">戻る</button>
      </div>
    );
  }
  return (
    <button onClick={() => setIsConfirming(true)} className="text-gray-400 hover:text-red-500 p-1.5 rounded-md hover:bg-red-50 transition-colors" title={title}>
      <X size={16} />
    </button>
  );
};

// 汎用：ドラッグ＆ドロップ可能なリストコンポーネント
const SortableList = ({ items, onReorder, renderItem, keyExtractor }) => {
  const [localItems, setLocalItems] = useState(items);
  const [draggedIndex, setDraggedIndex] = useState(null);

  useEffect(() => { setLocalItems(items); }, [items]);

  const handleDragStart = (e, index) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData('text/plain', index);
  };

  const handleDragEnter = (e, index) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    
    const newItems = [...localItems];
    const draggedItem = newItems[draggedIndex];
    newItems.splice(draggedIndex, 1);
    newItems.splice(index, 0, draggedItem);
    
    setDraggedIndex(index);
    setLocalItems(newItems);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    onReorder(localItems);
  };

  return (
    <ul className="space-y-2 bg-gray-50 p-3 rounded-lg border border-gray-200 mb-3">
      {localItems.map((item, index) => (
        <li
          key={keyExtractor(item)}
          draggable
          onDragStart={(e) => handleDragStart(e, index)}
          onDragEnter={(e) => handleDragEnter(e, index)}
          onDragOver={(e) => e.preventDefault()}
          onDragEnd={handleDragEnd}
          className={`flex items-center gap-2 bg-white px-2 py-1.5 rounded-lg shadow-sm border border-gray-100 transition-opacity ${draggedIndex === index ? 'opacity-40' : 'opacity-100'}`}
        >
          <div className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 p-1">
            <GripVertical size={16} />
          </div>
          <div className="flex-1 flex justify-between items-center overflow-hidden">
             {renderItem(item)}
          </div>
        </li>
      ))}
    </ul>
  );
};

// 左からスライドインするドロワー（サイドメニュー）
const BoardDrawer = ({ isOpen, onClose, boards, currentBoardId, onSelectBoard, onAddBoard, onRequestDelete }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [newBoardTitle, setNewBoardTitle] = useState('');
  const [isDeleteMode, setIsDeleteMode] = useState(false);

  const activeBoards = boards.filter(b => !b.isDeleted);

  return (
    <>
      <div 
        className={`fixed inset-0 bg-black/40 z-[130] transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={() => { onClose(); setIsDeleteMode(false); }}
      />
      <div className={`fixed top-0 left-0 w-80 h-full bg-white z-[140] shadow-2xl transition-transform duration-300 transform ${isOpen ? 'translate-x-0' : '-translate-x-full'} flex flex-col`}>
        <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <h2 className="font-bold text-gray-800 tracking-wide text-lg flex items-center gap-2">
            <LayoutDashboard size={20} className="text-gray-500"/> タスクボード一覧
          </h2>
          <button onClick={() => { onClose(); setIsDeleteMode(false); }} className="p-2 text-gray-400 hover:text-gray-800 hover:bg-gray-200 rounded-full transition-colors"><X size={20}/></button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5 custom-scrollbar bg-white">
          {activeBoards.map(b => (
            <div 
              key={b.id} 
              className={`rounded-xl border shadow-sm flex flex-col transition-all ${b.id === currentBoardId ? 'bg-gray-800 text-white shadow-md border-gray-800' : 'bg-white text-gray-600 border-gray-200'}`}
            >
              <div className="flex items-center justify-between p-1.5 min-h-[48px]">
                <button 
                  onClick={() => { onSelectBoard(b.id); onClose(); setIsAdding(false); setIsDeleteMode(false); }}
                  className="flex-1 text-left px-3 py-2 text-sm font-bold flex items-center justify-between"
                >
                  <span className="truncate pr-2">{b.title}</span>
                  {b.id === currentBoardId && <Check size={16} strokeWidth={3} className="shrink-0" />}
                </button>
                
                {/* 削除モード時かつ最後の1つでない場合のみ削除アイコンを表示 */}
                {isDeleteMode && activeBoards.length > 1 && (
                  <div className="pr-1 flex items-center shrink-0">
                    <button 
                      onClick={(e) => { e.stopPropagation(); onRequestDelete(b); }} 
                      className={`p-2 rounded-lg transition-colors ${b.id === currentBoardId ? 'text-gray-300 hover:text-red-400 hover:bg-gray-700' : 'text-gray-400 hover:text-red-500 hover:bg-red-50'}`}
                      title="ボードを削除"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-gray-100 bg-gray-50/50 flex flex-col gap-3">
          {isAdding ? (
            <form onSubmit={(e) => { e.preventDefault(); if(newBoardTitle.trim()){ onAddBoard(newBoardTitle.trim()); setIsAdding(false); setNewBoardTitle(''); } }} className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm animate-in fade-in slide-in-from-bottom-2">
              <label className="block text-xs font-bold text-gray-500 mb-1.5">新しいタスクボードの名前</label>
              <input autoFocus type="text" value={newBoardTitle} onChange={e=>setNewBoardTitle(e.target.value)} placeholder="例: 新居探し" className="w-full text-sm border border-gray-300 px-3 py-2.5 rounded-lg mb-3 focus:outline-none focus:border-gray-500 bg-gray-50 focus:bg-white" />
              <div className="flex gap-2">
                <button type="button" onClick={() => { setIsAdding(false); setNewBoardTitle(''); }} className="flex-1 py-2 text-xs font-bold text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">キャンセル</button>
                <button type="submit" className="flex-1 py-2 text-xs font-bold text-white bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors shadow-sm">作成</button>
              </div>
            </form>
          ) : (
            <button onClick={() => { setIsAdding(true); setIsDeleteMode(false); }} className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-gray-300 text-gray-600 bg-white rounded-xl hover:border-gray-400 hover:bg-gray-50 transition-all text-sm font-bold shadow-sm">
              <Plus size={18} /> タスクボードを新規作成
            </button>
          )}

          <button 
            onClick={() => { setIsDeleteMode(!isDeleteMode); setIsAdding(false); }} 
            disabled={activeBoards.length <= 1}
            className={`w-full flex items-center justify-center gap-2 py-3 border rounded-xl transition-all text-sm font-bold shadow-sm 
              ${activeBoards.length <= 1 
                ? 'border-gray-200 text-gray-300 bg-gray-50 cursor-not-allowed opacity-50' 
                : isDeleteMode 
                  ? 'border-red-200 text-red-600 bg-red-50 hover:bg-red-100' 
                  : 'border-gray-200 text-gray-600 bg-white hover:bg-gray-50'}`}
          >
            {isDeleteMode ? <><X size={16} /> 削除モードを終了</> : <><Trash2 size={16} /> タスクボードを削除</>}
          </button>
        </div>
      </div>
    </>
  );
};

const DataManagementButtons = ({ onBackupClick, onRestoreClick, onTrashClick }) => (
  <div className="flex flex-wrap sm:flex-nowrap gap-2 justify-center sm:justify-end">
    <button onClick={onTrashClick} className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 sm:py-2.5 text-xs sm:text-sm bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 shadow-sm font-medium"><Trash2 size={16} /> <span>ゴミ箱</span></button>
    <button onClick={onBackupClick} className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 sm:py-2.5 text-xs sm:text-sm bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 shadow-sm font-medium"><Download size={16} /> <span>バックアップ</span></button>
    <button onClick={onRestoreClick} className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 sm:py-2.5 text-xs sm:text-sm bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 shadow-sm font-medium"><Upload size={16} /> <span>復元</span></button>
  </div>
);

// ============================================================================
// 個別のタスクカードコンポーネント
// ============================================================================
const TaskCard = memo(({ task, assignees, columns, onUpdate, onDragStart }) => {
  const [newSubtaskText, setNewSubtaskText] = useState('');
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  
  // 各テキスト項目の編集状態
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState(task.title);
  
  const [isEditingMemo, setIsEditingMemo] = useState(false);
  const [localMemo, setLocalMemo] = useState(task.memo || '');
  const textareaRef = useRef(null);

  const [editingSubtaskId, setEditingSubtaskId] = useState(null);
  const [editedSubtaskText, setEditedSubtaskText] = useState('');

  const [isEditingPriority, setIsEditingPriority] = useState(false);
  const [tempPriority, setTempPriority] = useState(task.priority !== undefined ? task.priority : 50);

  const currentPriority = task.priority !== undefined ? task.priority : 50;

  useEffect(() => { setLocalMemo(task.memo || ''); }, [task.memo]);

  // メモ欄の高さ自動調整
  useEffect(() => {
    if (isEditingMemo && textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [localMemo, isEditingMemo]);

  const displayAssignees = Array.from(new Set([...assignees, task.assignee]));

  const handleAddSubtask = (e) => {
    e.preventDefault();
    if (!newSubtaskText.trim()) return;
    const newSubtask = { id: crypto.randomUUID(), text: newSubtaskText, completed: false, isDeleted: false };
    onUpdate(task.id, { subtasks: [...(task.subtasks || []), newSubtask] });
    setNewSubtaskText('');
  };

  const handleDeleteSubtask = (subtaskId) => {
    onUpdate(task.id, { subtasks: task.subtasks.map(st => st.id === subtaskId ? { ...st, isDeleted: true, deletedAt: Date.now() } : st) });
  };

  const handleToggleSubtask = (subtaskId) => {
    onUpdate(task.id, { subtasks: task.subtasks.map(st => st.id === subtaskId ? { ...st, completed: !st.completed } : st) });
  };

  const handleTitleSave = () => {
    setIsEditingTitle(false);
    if (editedTitle.trim() && editedTitle !== task.title) onUpdate(task.id, { title: editedTitle.trim() });
    else setEditedTitle(task.title);
  };

  const handleSubtaskSave = (subtaskId, originalText) => {
    setEditingSubtaskId(null);
    if (editedSubtaskText.trim() && editedSubtaskText !== originalText) {
      onUpdate(task.id, { subtasks: task.subtasks.map(st => st.id === subtaskId ? { ...st, text: editedSubtaskText.trim() } : st) });
    }
  };

  let dateColor = 'text-gray-500 bg-gray-50 border-gray-200';
  if (task.dueDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const threeDaysLater = new Date(today);
    threeDaysLater.setDate(today.getDate() + 3);
    
    const taskDate = new Date(task.dueDate);
    taskDate.setHours(0, 0, 0, 0);
    
    if (taskDate < today) dateColor = 'text-red-600 bg-red-50 border-red-200';
    else if (taskDate <= threeDaysLater) dateColor = 'text-orange-600 bg-orange-50 border-orange-200';
    else dateColor = 'text-blue-600 bg-blue-50 border-blue-200';
  }

  const activeSubtasks = (task.subtasks || []).filter(st => !st.isDeleted);
  const completedSubtasksCount = activeSubtasks.filter(st => st.completed).length;
  const totalSubtasksCount = activeSubtasks.length;
  const progressPercent = totalSubtasksCount === 0 ? 0 : Math.round((completedSubtasksCount / totalSubtasksCount) * 100);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex flex-col gap-3 relative">
      
      {/* 1. ヘッダー部分 */}
      <div className="flex justify-between items-start gap-2 relative">
        <div draggable onDragStart={(e) => onDragStart(e, task.id)} className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 p-1 -ml-1 -mt-1 rounded hidden md:block" title="ドラッグして移動">
          <GripVertical size={20} />
        </div>
        <div className="flex-1 relative">
          {!isEditingTitle ? (
            <h3 onClick={() => { setIsEditingTitle(true); setEditedTitle(task.title); }} className="font-bold text-gray-800 leading-tight text-base cursor-text hover:bg-gray-50 rounded px-1 -mx-1">
              {task.title}
            </h3>
          ) : (
            <>
              <div className="fixed inset-0 z-[50]" onClick={handleTitleSave}></div>
              <div className="absolute top-0 left-0 w-[calc(100%+16px)] -ml-2 -mt-2 bg-white p-3 rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.15)] border border-gray-200 flex flex-col gap-3 z-[60] animate-in zoom-in-95 duration-200">
                <input 
                  autoFocus 
                  value={editedTitle} 
                  onChange={(e) => setEditedTitle(e.target.value)} 
                  onKeyDown={(e) => { if (e.key === 'Enter') handleTitleSave(); }} 
                  className="w-full text-base font-bold text-gray-800 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-gray-400 focus:bg-white transition-colors" 
                  placeholder="タスクのタイトル" 
                />
                <div className="flex justify-end gap-1.5">
                  <button onClick={handleTitleSave} className="p-1.5 bg-gray-800 text-white rounded-md hover:bg-gray-700 shadow-sm"><Check size={16} strokeWidth={3} /></button>
                  <button onClick={() => { setIsEditingTitle(false); setEditedTitle(task.title); }} className="p-1.5 bg-white border border-gray-300 text-gray-500 rounded-md hover:bg-gray-50 shadow-sm"><X size={16} strokeWidth={3} /></button>
                </div>
              </div>
            </>
          )}
        </div>
        {isConfirmingDelete ? (
          <div className="flex items-center gap-2 bg-red-50 p-1 rounded-lg border border-red-100 -mt-1 -mr-1 animate-in fade-in duration-200">
            <span className="text-[11px] font-bold text-red-600 pl-1">削除しますか？</span>
            <button onClick={() => onUpdate(task.id, { isDeleted: true, deletedAt: Date.now() })} className="bg-red-500 text-white text-[10px] px-2 py-1 rounded hover:bg-red-600 font-medium">はい</button>
            <button onClick={() => setIsConfirmingDelete(false)} className="bg-white text-gray-600 text-[10px] px-2 py-1 rounded border border-gray-200 hover:bg-gray-50">戻る</button>
          </div>
        ) : (
          <button onClick={() => setIsConfirmingDelete(true)} className="text-gray-400 hover:text-red-500 transition-colors p-2 -mr-2 -mt-2 rounded-full active:bg-red-50" title="ゴミ箱へ移動"><Trash2 size={18} /></button>
        )}
      </div>

      {/* 2. メタ情報 */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 sm:gap-2 mt-1">
        <select 
          value={task.assignee} 
          onChange={(e) => onUpdate(task.id, { assignee: e.target.value })} 
          className="h-[32px] w-[70px] sm:w-[76px] shrink-0 bg-gray-100 text-gray-700 px-1 rounded-md text-xs font-semibold border border-transparent hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-200 cursor-pointer text-center"
          style={{ textAlignLast: 'center' }}
        >
          {displayAssignees.map(a => <option key={a} value={a}>{a}</option>)}
        </select>

        <div className={`relative flex items-center justify-center gap-1 h-[32px] w-[76px] sm:w-[80px] shrink-0 rounded-md text-xs font-semibold border cursor-pointer shadow-sm transition-colors group ${dateColor}`}>
          <Calendar size={13} strokeWidth={2.5} />
          <span>{task.dueDate ? new Date(task.dueDate).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' }) : '期日'}</span>
          <input type="date" value={task.dueDate || ''} onChange={(e) => onUpdate(task.id, { dueDate: e.target.value })} className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" title="期日を設定" />
        </div>

        <div className="flex-1 min-w-[90px] h-[32px] bg-white border border-gray-300 rounded-md px-2 flex items-center gap-1.5 relative shadow-sm">
          <span className="text-[10px] sm:text-xs font-bold text-gray-400 shrink-0 hidden sm:block">優先度</span>
          <div className="flex-1 h-2.5 bg-gray-200 rounded-full overflow-hidden cursor-pointer hover:ring-2 hover:ring-gray-300 transition-all" onClick={() => { setIsEditingPriority(true); setTempPriority(currentPriority); }} title={`優先度: ${currentPriority}`}>
            <div className="h-full transition-all duration-300 ease-out" style={{ width: `${currentPriority}%`, backgroundColor: getPriorityColorRGB(currentPriority) }} />
          </div>
          <span className="text-[10px] sm:text-xs font-bold w-5 sm:w-6 shrink-0 text-right" style={{ color: getPriorityColorRGB(currentPriority) }}>{currentPriority}</span>

          {isEditingPriority && (
            <>
              <div className="fixed inset-0 z-[50]" onClick={() => setIsEditingPriority(false)}></div>
              <div className="absolute top-[120%] left-1/2 -translate-x-1/2 w-[260px] max-w-[80vw] bg-white p-2.5 rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-gray-200 flex items-center gap-2 sm:gap-3 z-[60] animate-in zoom-in-95 duration-200">
                <input 
                  type="range" min="0" max="100" value={tempPriority} onChange={(e) => setTempPriority(parseInt(e.target.value))} className="custom-slider flex-1 min-w-0"
                  style={{ '--slider-color': getPriorityColorRGB(tempPriority), '--slider-bg': `linear-gradient(to right, ${getPriorityColorRGB(tempPriority)} ${tempPriority}%, #E5E7EB ${tempPriority}%)` }}
                />
                <span className="text-[11px] sm:text-xs font-bold w-5 sm:w-6 shrink-0 text-right" style={{ color: getPriorityColorRGB(tempPriority) }}>{tempPriority}</span>
                <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
                  <button onClick={() => { onUpdate(task.id, { priority: tempPriority }); setIsEditingPriority(false); }} className="p-1.5 bg-gray-800 text-white rounded-md hover:bg-gray-700 shadow-sm"><Check size={16} strokeWidth={3} /></button>
                  <button onClick={() => setIsEditingPriority(false)} className="p-1.5 bg-white border border-gray-300 text-gray-500 rounded-md hover:bg-gray-50 shadow-sm"><X size={16} strokeWidth={3} /></button>
                </div>
              </div>
            </>
          )}
        </div>

        <select 
          value={task.status} 
          onChange={(e) => onUpdate(task.id, { status: e.target.value })} 
          className="h-[32px] w-[86px] sm:w-[92px] shrink-0 bg-white border border-gray-300 text-gray-700 rounded-md px-1 text-[11px] sm:text-xs font-semibold shadow-sm focus:outline-none focus:ring-2 focus:ring-gray-200 cursor-pointer text-center"
          style={{ textAlignLast: 'center' }}
        >
          {columns.map(col => <option key={col.id} value={col.id}>{col.title.split(' ')[0]}</option>)}
        </select>
      </div>

      {/* 3. メモ欄 (ポップアップ入力形式) */}
      <div className="mt-1 relative">
        {!isEditingMemo ? (
          <div 
            onClick={() => { setLocalMemo(task.memo || ''); setIsEditingMemo(true); }}
            className={`w-full text-xs rounded-lg px-2 py-1.5 cursor-text min-h-[32px] transition-colors border border-transparent hover:bg-gray-50 ${task.memo ? 'text-gray-600 whitespace-pre-wrap leading-relaxed' : 'text-gray-400'}`}
          >
            {task.memo || 'メモを追加…'}
          </div>
        ) : (
          <>
            <div className="fixed inset-0 z-[50]" onClick={() => { setLocalMemo(task.memo || ''); setIsEditingMemo(false); }}></div>
            <div className="absolute top-0 left-0 w-[calc(100%+16px)] -ml-2 -mt-2 bg-white p-3 rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.15)] border border-gray-200 flex flex-col gap-3 z-[60] animate-in zoom-in-95 duration-200">
              <textarea
                ref={textareaRef}
                autoFocus
                value={localMemo} 
                onChange={(e) => setLocalMemo(e.target.value)} 
                placeholder="メモを追加…"
                className="w-full text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-gray-400 focus:bg-white transition-colors overflow-hidden leading-relaxed"
                rows={3}
                style={{ minHeight: '64px' }}
              />
              <div className="flex justify-end mt-2">
                <div className="flex justify-end gap-1.5">
                  <button onClick={() => { onUpdate(task.id, { memo: localMemo }); setIsEditingMemo(false); }} className="p-1.5 bg-gray-800 text-white rounded-md hover:bg-gray-700 shadow-sm"><Check size={16} strokeWidth={3} /></button>
                  <button onClick={() => { setLocalMemo(task.memo || ''); setIsEditingMemo(false); }} className="p-1.5 bg-white border border-gray-300 text-gray-500 rounded-md hover:bg-gray-50 shadow-sm"><X size={16} strokeWidth={3} /></button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* 4. サブタスク一覧 (ポップアップ入力形式) */}
      <div className="mt-0.5 pt-2 border-t border-gray-100 space-y-2 relative">
        <div className="flex items-center px-1 mb-1 gap-2">
          <span className="text-[10px] font-bold text-gray-400 shrink-0">サブタスク</span>
          {totalSubtasksCount > 0 && (
            <>
              <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-green-400 transition-all duration-300 ease-out" 
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <span className="text-[10px] font-bold text-gray-500 shrink-0">
                {completedSubtasksCount}/{totalSubtasksCount}
              </span>
            </>
          )}
        </div>

        {activeSubtasks.map(subtask => (
          <div key={subtask.id} className="flex items-start gap-2.5 group relative">
            <button onClick={() => handleToggleSubtask(subtask.id)} className="text-gray-400 hover:text-gray-600 focus:outline-none flex-shrink-0 mt-[1px]">
              {subtask.completed ? <CheckSquare size={18} className="text-gray-800" /> : <Square size={18} />}
            </button>
            {editingSubtaskId === subtask.id ? (
              <>
                <div className="fixed inset-0 z-[50]" onClick={() => handleSubtaskSave(subtask.id, subtask.text)}></div>
                <div className="absolute top-0 left-6 w-[calc(100%-24px)] bg-white p-2 rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.15)] border border-gray-200 flex flex-col gap-2 z-[60] animate-in zoom-in-95 duration-200 -mt-2 -ml-2">
                  <input 
                    autoFocus 
                    value={editedSubtaskText} 
                    onChange={(e) => setEditedSubtaskText(e.target.value)} 
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSubtaskSave(subtask.id, subtask.text); }} 
                    className="w-full text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-gray-400 focus:bg-white transition-colors" 
                    placeholder="サブタスク内容" 
                  />
                  <div className="flex justify-end gap-1.5">
                    <button onClick={() => handleSubtaskSave(subtask.id, subtask.text)} className="p-1 bg-gray-800 text-white rounded hover:bg-gray-700 shadow-sm"><Check size={14} strokeWidth={3} /></button>
                    <button onClick={() => setEditingSubtaskId(null)} className="p-1 bg-white border border-gray-300 text-gray-500 rounded hover:bg-gray-50 shadow-sm"><X size={14} strokeWidth={3} /></button>
                  </div>
                </div>
              </>
            ) : (
              <span onClick={() => { setEditingSubtaskId(subtask.id); setEditedSubtaskText(subtask.text); }} className={`text-sm flex-1 mt-[1px] break-words cursor-text hover:bg-gray-50 rounded px-1 -mx-1 ${subtask.completed ? 'text-gray-400 line-through' : 'text-gray-700'}`}>{subtask.text}</span>
            )}
            {!editingSubtaskId && <button onClick={() => handleDeleteSubtask(subtask.id)} className="text-gray-400 hover:text-red-500 focus:outline-none p-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"><X size={16} /></button>}
          </div>
        ))}
        
        <form onSubmit={handleAddSubtask} className="flex items-center gap-2 mt-2">
          <input type="text" value={newSubtaskText} onChange={(e) => setNewSubtaskText(e.target.value)} placeholder="＋ サブタスクを追加..." className="w-full text-sm border border-gray-200 bg-gray-50 focus:bg-white rounded-lg px-3 py-2 focus:outline-none focus:border-gray-400 transition-colors" />
        </form>
      </div>
    </div>
  );
});

// ============================================================================
// メインアプリケーションコンポーネント (App)
// ============================================================================
export default function App() {
  const { user, authLoading } = useAuth();
  const { boards, addBoard, updateBoardInList, hardDeleteBoard, boardsLoading } = useBoards(user);
  
  const [currentBoardId, setCurrentBoardId] = useState('default');
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const { tasks, settings, updateSettings, tasksLoading, addTask, updateTask, deleteTask, importData } = useTasks(user, currentBoardId);

  const currentColumns = settings.columns || defaultColumns;

  const [isAddTaskCollapsed, setIsAddTaskCollapsed] = useState(false);
  const [isFilterCollapsed, setIsFilterCollapsed] = useState(true);

  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskAssignee, setNewTaskAssignee] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState(50);
  const [newTaskDueDate, setNewTaskDueDate] = useState(''); 
  const [newTaskStatus, setNewTaskStatus] = useState('');

  const [isEditingAppTitle, setIsEditingAppTitle] = useState(false);
  const [appTitleInput, setAppTitleInput] = useState('');

  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [newAssigneeInput, setNewAssigneeInput] = useState('');
  const [newColumnInput, setNewColumnInput] = useState('');

  const [collapsedColumns, setCollapsedColumns] = useState({});
  const toggleCollapse = (id) => setCollapsedColumns(prev => ({ ...prev, [id]: !prev[id] }));
  
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
  const [isRestoreModalOpen, setIsRestoreModalOpen] = useState(false);
  const [isTrashModalOpen, setIsTrashModalOpen] = useState(false);
  const [restoreText, setRestoreText] = useState('');

  const [modalConfig, setModalConfig] = useState({ isOpen: false });

  // フィルター関連のステート
  const [filterAssignee, setFilterAssignee] = useState(null);
  const [filterDueDateFrom, setFilterDueDateFrom] = useState('');
  const [filterDueDateTo, setFilterDueDateTo] = useState('');
  const [filterPriorityFrom, setFilterPriorityFrom] = useState('');
  const [filterPriorityTo, setFilterPriorityTo] = useState('');

  const [editingFilterPriorityType, setEditingFilterPriorityType] = useState(null); 
  const [tempFilterPriority, setTempFilterPriority] = useState(50);

  const [columnSorts, setColumnSorts] = useState({});

  const showModal = (title, message, onConfirm, onCancel, confirmText = "OK", cancelText = "キャンセル", isDanger = false) => {
    setModalConfig({ isOpen: true, title, message, onConfirm, onCancel, confirmText, cancelText, isDanger });
  };
  const closeModal = () => setModalConfig({ ...modalConfig, isOpen: false });

  const activeTasks = tasks.filter(t => !t.isDeleted);
  let processedTasks = [...activeTasks];
  
  if (filterAssignee) processedTasks = processedTasks.filter(t => t.assignee === filterAssignee);
  if (filterDueDateFrom) processedTasks = processedTasks.filter(t => t.dueDate && t.dueDate >= filterDueDateFrom);
  if (filterDueDateTo) processedTasks = processedTasks.filter(t => t.dueDate && t.dueDate <= filterDueDateTo);
  if (filterPriorityFrom !== '') processedTasks = processedTasks.filter(t => (t.priority || 0) >= parseInt(filterPriorityFrom));
  if (filterPriorityTo !== '') processedTasks = processedTasks.filter(t => (t.priority || 0) <= parseInt(filterPriorityTo));

  const isFilterActive = filterAssignee || filterDueDateFrom || filterDueDateTo || filterPriorityFrom !== '' || filterPriorityTo !== '';

  const clearFilters = () => {
    setFilterAssignee(null);
    setFilterDueDateFrom('');
    setFilterDueDateTo('');
    setFilterPriorityFrom('');
    setFilterPriorityTo('');
  };

  const handleSelectBoard = (id) => {
    setCurrentBoardId(id);
    clearFilters(); 
  };

  const handleAddBoard = async (title) => {
    const newId = await addBoard(title);
    if (newId) handleSelectBoard(newId);
  };

  const handleDeleteBoardRequest = (board) => {
    showModal(
      "タスクボードの削除",
      `「${board.title}」を完全に削除しますか？\n※復元はできません`,
      async () => {
        await hardDeleteBoard(board.id);
        // カレントボードが削除された場合、別の有効なボードに切り替える
        if (board.id === currentBoardId) {
          const remainingActiveBoards = boards.filter(b => !b.isDeleted && b.id !== board.id);
          if (remainingActiveBoards.length > 0) {
            setCurrentBoardId(remainingActiveBoards[0].id);
          }
        }
        closeModal();
      },
      closeModal,
      "削除する",
      "戻る",
      true // isDangerフラグを立ててボタンを赤くする
    );
  };

  const handleFilterDueDateFromChange = (e) => {
    const val = e.target.value;
    setFilterDueDateFrom(val);
    if (val && filterDueDateTo && val > filterDueDateTo) setFilterDueDateTo(val);
  };

  const handleFilterDueDateToChange = (e) => {
    const val = e.target.value;
    setFilterDueDateTo(val);
    if (val && filterDueDateFrom && val < filterDueDateFrom) setFilterDueDateFrom(val);
  };

  const handleFilterPrioritySave = () => {
    if (editingFilterPriorityType === 'from') {
      const newFromStr = tempFilterPriority.toString();
      setFilterPriorityFrom(newFromStr);
      if (filterPriorityTo !== '' && tempFilterPriority > parseInt(filterPriorityTo)) setFilterPriorityTo(newFromStr);
    } else {
      const newToStr = tempFilterPriority.toString();
      setFilterPriorityTo(newToStr);
      if (filterPriorityFrom !== '' && tempFilterPriority < parseInt(filterPriorityFrom)) setFilterPriorityFrom(newToStr);
    }
    setEditingFilterPriorityType(null);
  };

  useEffect(() => {
    if (settings.assignees.length > 0 && (!newTaskAssignee || !settings.assignees.includes(newTaskAssignee))) {
      setNewTaskAssignee(settings.assignees[0]);
    }
  }, [settings.assignees, newTaskAssignee]);

  useEffect(() => {
    if (currentColumns.length > 0 && (!newTaskStatus || !currentColumns.find(c => c.id === newTaskStatus))) {
      setNewTaskStatus(currentColumns[0].id);
    }
  }, [currentColumns, newTaskStatus]);


  const saveAppTitle = () => {
    setIsEditingAppTitle(false);
    if (appTitleInput.trim() && appTitleInput !== settings.title) {
      updateSettings({ title: appTitleInput.trim() });
      updateBoardInList(currentBoardId, { title: appTitleInput.trim() }); 
    }
  };

  const handleAddAssignee = (e) => {
    e.preventDefault();
    if (!newAssigneeInput.trim() || settings.assignees.includes(newAssigneeInput.trim())) return;
    updateSettings({ assignees: [...settings.assignees, newAssigneeInput.trim()] });
    setNewAssigneeInput('');
  };

  const handleDeleteAssignee = (targetAssignee) => {
    if (settings.assignees.length <= 1) return;
    
    const newAssignees = settings.assignees.filter(a => a !== targetAssignee);
    const newDeleted = [...(settings.deletedAssignees || []), targetAssignee];
    updateSettings({ assignees: newAssignees, deletedAssignees: newDeleted });
    if (filterAssignee === targetAssignee) setFilterAssignee(null);
  };

  const handleAddColumn = (e) => {
    e.preventDefault();
    if (!newColumnInput.trim() || currentColumns.some(c => c.title === newColumnInput.trim())) return;
    const newColumn = { id: crypto.randomUUID(), title: newColumnInput.trim(), isDeletable: true };
    updateSettings({ columns: [...currentColumns, newColumn] });
    setNewColumnInput('');
  };

  const handleDeleteColumn = (colId) => {
    const colToDelete = currentColumns.find(c => c.id === colId);
    if (!colToDelete || !colToDelete.isDeletable) return;
    
    // 対象カラムのタスクを「未対応」に移動
    const fallbackColId = currentColumns[0]?.id || 'todo';
    tasks.forEach(task => {
      if (task.status === colId) {
        updateTask(task.id, { status: fallbackColId });
      }
    });

    const newColumns = currentColumns.filter(c => c.id !== colId);
    const newDeleted = [...(settings.deletedColumns || []), colToDelete];
    updateSettings({ columns: newColumns, deletedColumns: newDeleted });
  };

  const handleAddTask = (e) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;
    addTask({
      title: newTaskTitle,
      status: newTaskStatus || currentColumns[0].id,
      assignee: newTaskAssignee || settings.assignees[0],
      priority: newTaskPriority,
      subtasks: [],
      memo: '',
      dueDate: newTaskDueDate 
    });
    setNewTaskTitle('');
    setNewTaskDueDate(''); 
  };

  const handleDragStart = useCallback((e, taskId) => { e.dataTransfer.setData('taskId', taskId); e.dataTransfer.effectAllowed = 'move'; }, []);
  const handleDragOver = useCallback((e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }, []);
  const handleDrop = useCallback((e, status) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('taskId');
    if (taskId) updateTask(taskId, { status });
  }, [updateTask]);

  const executeRestore = async (jsonString) => {
    try {
      const parsedData = JSON.parse(jsonString);
      let importedTasks = [];
      let importedSettings = null;

      if (Array.isArray(parsedData)) { importedTasks = parsedData; } 
      else if (parsedData.type === 'wedding-board-backup') {
        importedTasks = parsedData.tasks || [];
        importedSettings = parsedData.settings;
      } else throw new Error('Invalid format');

      showModal("データの復元", "タスクや設定データを読み込みますか？\n（既存のタスクは上書きされ、新しいタスクは追加されます）",
        async () => {
          closeModal();
          try {
            await importData(importedTasks, importedSettings);
            setIsRestoreModalOpen(false);
            setRestoreText('');
            showModal("完了", "データの復元が完了しました！", closeModal, null, "OK");
          } catch(e) { showModal("エラー", "データベースへの保存に失敗しました。", closeModal, null, "OK"); }
        },
        closeModal, "はい、復元します", "キャンセル"
      );
    } catch (error) { showModal("エラー", "データの読み込みに失敗しました。\n正しい形式か確認してください。", closeModal, null, "OK"); }
  };

  const handleFileImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => executeRestore(event.target.result);
    reader.readAsText(file);
    e.target.value = null;
  };

  const handleBackupClick = () => {
    if (tasks.length === 0) showModal("エラー", "出力するタスクがありません。", closeModal, null, "OK");
    else setIsBackupModalOpen(true);
  };

  const getExportDataString = () => JSON.stringify({ type: 'wedding-board-backup', settings: settings, tasks: tasks }, null, 2);

  const deletedTasks = tasks.filter(t => t.isDeleted);
  const deletedSubtasks = tasks.flatMap(t => 
    (t.subtasks || []).filter(st => st.isDeleted).map(st => ({ 
      ...st, 
      parentTaskId: t.id, 
      parentTitle: t.title,
      parentIsDeleted: t.isDeleted
    }))
  );
  const deletedAssignees = settings.deletedAssignees || [];
  const deletedColumnsList = settings.deletedColumns || [];

  const restoreDeletedTask = (taskId) => updateTask(taskId, { isDeleted: false });
  const hardDeleteDeletedTask = (taskId) => deleteTask(taskId);

  const restoreDeletedSubtask = (parentTaskId, subtaskId) => {
    const parentTask = tasks.find(t => t.id === parentTaskId);
    if (!parentTask || parentTask.isDeleted) return; 
    
    updateTask(parentTaskId, { subtasks: parentTask.subtasks.map(st => st.id === subtaskId ? { ...st, isDeleted: false } : st) });
  };
  const hardDeleteDeletedSubtask = (parentTaskId, subtaskId) => {
    const parentTask = tasks.find(t => t.id === parentTaskId);
    if (!parentTask) return;
    updateTask(parentTaskId, { subtasks: parentTask.subtasks.filter(st => st.id !== subtaskId) });
  };

  const restoreDeletedAssignee = (assignee) => {
    updateSettings({ assignees: [...settings.assignees, assignee], deletedAssignees: (settings.deletedAssignees || []).filter(a => a !== assignee) });
  };
  const hardDeleteDeletedAssignee = (assignee) => {
    updateSettings({ deletedAssignees: (settings.deletedAssignees || []).filter(a => a !== assignee) });
  };

  const restoreDeletedColumn = (col) => {
    updateSettings({ 
      columns: [...currentColumns, col], 
      deletedColumns: (settings.deletedColumns || []).filter(c => c.id !== col.id) 
    });
  };
  const hardDeleteDeletedColumn = (colId) => {
    updateSettings({ 
      deletedColumns: (settings.deletedColumns || []).filter(c => c.id !== colId) 
    });
  };

  if (authLoading || boardsLoading || (tasksLoading && tasks.length === 0 && !appTitleInput)) {
    return <div className="min-h-screen bg-[#fafafa] flex items-center justify-center"><Loader2 className="animate-spin text-gray-400" size={32} /></div>;
  }

  return (
    <div className="min-h-screen bg-[#fafafa] p-3 sm:p-6 font-sans text-gray-800 pb-24 sm:pb-6 relative">
      
      <style>{`
        .custom-slider { -webkit-appearance: none; appearance: none; background: transparent; outline: none; }
        .custom-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 20px; height: 20px; border-radius: 50%; background: #ffffff; border: 3px solid var(--slider-color, #999); cursor: pointer; box-shadow: 0 1px 4px rgba(0,0,0,0.3); margin-top: -4px; }
        .custom-slider::-moz-range-thumb { width: 20px; height: 20px; border-radius: 50%; background: #ffffff; border: 3px solid var(--slider-color, #999); cursor: pointer; box-shadow: 0 1px 4px rgba(0,0,0,0.3); }
        .custom-slider::-webkit-slider-runnable-track { height: 12px; border-radius: 9999px; background: var(--slider-bg, #e5e7eb); }
        .custom-slider::-moz-range-track { height: 12px; border-radius: 9999px; background: var(--slider-bg, #e5e7eb); }
        
        .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #9ca3af; }
        
        input[type=number]::-webkit-inner-spin-button, 
        input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        input[type=number] { -moz-appearance: textfield; }
      `}</style>

      <CustomModal {...modalConfig} zIndex="z-[150]" />

      {/* マルチボード切替ドロワー */}
      <BoardDrawer 
        isOpen={isDrawerOpen} 
        onClose={() => setIsDrawerOpen(false)} 
        boards={boards} 
        currentBoardId={currentBoardId} 
        onSelectBoard={handleSelectBoard} 
        onAddBoard={handleAddBoard} 
        onRequestDelete={handleDeleteBoardRequest}
      />

      {/* 設定モーダル */}
      <CustomModal isOpen={isSettingsModalOpen} title={<><Settings size={20} className="text-gray-500"/>タスクボード設定</>} onCancel={() => setIsSettingsModalOpen(false)} cancelText="閉じる">
        <div className="space-y-8">
          <div>
            <h4 className="font-bold text-gray-700 text-sm mb-3">担当者の設定</h4>
            <SortableList
              items={settings.assignees}
              onReorder={(newAssignees) => updateSettings({ assignees: newAssignees })}
              keyExtractor={(a) => a}
              renderItem={(assignee) => {
                const disabled = settings.assignees.length <= 1;
                return (
                  <>
                    <span className="font-medium text-gray-700 text-sm">{assignee}</span>
                    {!disabled && <DeleteConfirmButton onConfirm={() => handleDeleteAssignee(assignee)} />}
                  </>
                );
              }}
            />
            <form onSubmit={handleAddAssignee} className="flex gap-2">
              <input type="text" value={newAssigneeInput} onChange={(e) => setNewAssigneeInput(e.target.value)} placeholder="新しい担当者..." className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-gray-500" />
              <button type="submit" className="bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors whitespace-nowrap">追加</button>
            </form>
          </div>

          <div className="border-t border-gray-200 pt-6">
            <h4 className="font-bold text-gray-700 text-sm mb-1">進捗ステータスの設定</h4>
            <p className="text-[10px] text-gray-500 mb-3 leading-relaxed">※ステータスを削除すると、そこにあったタスクは安全のため「未対応」に自動移動します。</p>
            <SortableList
              items={currentColumns}
              onReorder={(newCols) => updateSettings({ columns: newCols })}
              keyExtractor={(c) => c.id}
              renderItem={(column) => (
                <>
                  <span className="font-medium text-gray-700 text-sm truncate">{column.title}</span>
                  {column.isDeletable ? (
                    <DeleteConfirmButton onConfirm={() => handleDeleteColumn(column.id)} />
                  ) : (
                    <Lock size={14} className="text-gray-400 mr-1" />
                  )}
                </>
              )}
            />
            <form onSubmit={handleAddColumn} className="flex gap-2">
              <input type="text" value={newColumnInput} onChange={(e) => setNewColumnInput(e.target.value)} placeholder="新しいステータス..." className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-gray-500" />
              <button type="submit" className="bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors whitespace-nowrap">追加</button>
            </form>
          </div>
        </div>
      </CustomModal>

      <CustomModal isOpen={isTrashModalOpen} title={<><Trash2 size={20} className="text-red-500"/>ゴミ箱</>} onCancel={() => setIsTrashModalOpen(false)} cancelText="閉じる">
        <div className="space-y-6 min-w-[280px]">
          <div>
            <h4 className="font-bold text-gray-700 text-sm mb-2 flex items-center gap-1.5"><Square size={16} className="text-gray-400"/> タスク</h4>
            <ul className="space-y-2">
              {deletedTasks.length === 0 && <p className="text-xs text-gray-400 bg-gray-50 p-3 rounded text-center border border-gray-100">ゴミ箱が空です</p>}
              {deletedTasks.map(t => (
                <li key={t.id} className="flex justify-between items-center bg-gray-50 px-3 py-2 rounded border border-gray-200 gap-3">
                  <span className="text-sm text-gray-600 line-through truncate">{t.title}</span>
                  <div className="flex gap-1.5 shrink-0">
                    <button onClick={() => restoreDeletedTask(t.id)} className="flex items-center gap-1 text-xs bg-white border border-gray-300 text-gray-600 px-2 py-1.5 rounded hover:bg-gray-100 shadow-sm" title="復元"><RotateCcw size={12}/>復元</button>
                    <button onClick={() => hardDeleteDeletedTask(t.id)} className="text-xs bg-red-50 text-red-600 border border-red-200 px-2 py-1.5 rounded hover:bg-red-100 hover:text-red-700 shadow-sm" title="完全に削除"><Trash2 size={12}/></button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="font-bold text-gray-700 text-sm mb-2 flex items-center gap-1.5"><CheckSquare size={16} className="text-gray-400"/> サブタスク</h4>
            <ul className="space-y-2">
              {deletedSubtasks.length === 0 && <p className="text-xs text-gray-400 bg-gray-50 p-3 rounded text-center border border-gray-100">ゴミ箱が空です</p>}
              {deletedSubtasks.map(st => (
                <li key={st.id} className="flex justify-between items-center bg-gray-50 px-3 py-2 rounded border border-gray-200 gap-3">
                  <div className="flex flex-col overflow-hidden">
                    <span className="text-sm text-gray-600 line-through truncate">{st.text}</span>
                    <span className="text-[10px] text-gray-400 truncate">親タスク: {st.parentTitle}</span>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button 
                      onClick={() => !st.parentIsDeleted && restoreDeletedSubtask(st.parentTaskId, st.id)} 
                      className={`flex items-center gap-1 text-xs px-2 py-1.5 rounded shadow-sm transition-colors ${st.parentIsDeleted ? 'bg-gray-200 text-gray-400 border border-gray-200 cursor-not-allowed' : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-100'}`} 
                      title={st.parentIsDeleted ? "先に親タスクを復元してください" : "復元"}
                      disabled={st.parentIsDeleted}
                    >
                      <RotateCcw size={12}/>復元
                    </button>
                    <button onClick={() => hardDeleteDeletedSubtask(st.parentTaskId, st.id)} className="text-xs bg-red-50 text-red-600 border border-red-200 px-2 py-1.5 rounded hover:bg-red-100 hover:text-red-700 shadow-sm" title="完全に削除"><Trash2 size={12}/></button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="font-bold text-gray-700 text-sm mb-2 flex items-center gap-1.5"><Settings size={16} className="text-gray-400"/> 担当者</h4>
            <ul className="space-y-2">
              {deletedAssignees.length === 0 && <p className="text-xs text-gray-400 bg-gray-50 p-3 rounded text-center border border-gray-100">ゴミ箱が空です</p>}
              {deletedAssignees.map(a => (
                <li key={a} className="flex justify-between items-center bg-gray-50 px-3 py-2 rounded border border-gray-200 gap-3">
                  <span className="text-sm text-gray-600 line-through truncate">{a}</span>
                  <div className="flex gap-1.5 shrink-0">
                    <button onClick={() => restoreDeletedAssignee(a)} className="flex items-center gap-1 text-xs bg-white border border-gray-300 text-gray-600 px-2 py-1.5 rounded hover:bg-gray-100 shadow-sm" title="復元"><RotateCcw size={12}/>復元</button>
                    <button onClick={() => hardDeleteDeletedAssignee(a)} className="text-xs bg-red-50 text-red-600 border border-red-200 px-2 py-1.5 rounded hover:bg-red-100 hover:text-red-700 shadow-sm" title="完全に削除"><Trash2 size={12}/></button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="font-bold text-gray-700 text-sm mb-2 flex items-center gap-1.5"><LayoutDashboard size={16} className="text-gray-400"/> ステータス</h4>
            <ul className="space-y-2">
              {deletedColumnsList.length === 0 && <p className="text-xs text-gray-400 bg-gray-50 p-3 rounded text-center border border-gray-100">ゴミ箱が空です</p>}
              {deletedColumnsList.map(col => (
                <li key={col.id} className="flex justify-between items-center bg-gray-50 px-3 py-2 rounded border border-gray-200 gap-3">
                  <span className="text-sm text-gray-600 line-through truncate">{col.title}</span>
                  <div className="flex gap-1.5 shrink-0">
                    <button onClick={() => restoreDeletedColumn(col)} className="flex items-center gap-1 text-xs bg-white border border-gray-300 text-gray-600 px-2 py-1.5 rounded hover:bg-gray-100 shadow-sm" title="復元"><RotateCcw size={12}/>復元</button>
                    <button onClick={() => hardDeleteDeletedColumn(col.id)} className="text-xs bg-red-50 text-red-600 border border-red-200 px-2 py-1.5 rounded hover:bg-red-100 hover:text-red-700 shadow-sm" title="完全に削除"><Trash2 size={12}/></button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </CustomModal>

      {/* バックアップ用モーダル */}
      {isBackupModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="font-bold text-lg mb-2 text-gray-900">データのバックアップ</h3>
            <p className="text-gray-600 mb-5 text-xs leading-relaxed">
              ブラウザの設定によってはファイル保存がブロックされる場合があります。<br/><br/>
              ダウンロードが反応しない場合は、「テキストをコピー」して、スマホのメモ帳やLINEのKeepなどに貼り付けて保存してください。
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => {
                  const blob = new Blob([getExportDataString()], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `tasks-backup-${new Date().toISOString().slice(0, 10)}.json`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                }}
                className="w-full py-2.5 bg-gray-800 text-white text-sm font-medium rounded-lg hover:bg-gray-700 flex items-center justify-center gap-2 transition-colors"
              >
                <Download size={16} /> ファイルとしてダウンロード
              </button>

              <button
                onClick={() => {
                  const textarea = document.createElement('textarea');
                  textarea.value = getExportDataString();
                  document.body.appendChild(textarea);
                  textarea.select();
                  document.execCommand('copy');
                  document.body.removeChild(textarea);
                  setIsBackupModalOpen(false);
                  showModal("コピー完了", "タスクデータをコピーしました！\nメモアプリなどに貼り付けて保存してください。", closeModal, null, "OK");
                }}
                className="w-full py-2.5 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 flex items-center justify-center gap-2 transition-colors"
              >
                📋 テキストとしてコピー
              </button>
              <button onClick={() => setIsBackupModalOpen(false)} className="w-full py-2 mt-2 text-gray-500 text-sm hover:text-gray-700">閉じる</button>
            </div>
          </div>
        </div>
      )}

      {/* 復元用モーダル */}
      {isRestoreModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="font-bold text-lg mb-2 text-gray-900">データの復元</h3>
            <p className="text-gray-600 mb-4 text-xs leading-relaxed">
              バックアップしたデータを復元します。<br/>ファイルを選択するか、コピーしたテキストを貼り付けてください。
            </p>
            <div className="flex flex-col gap-4">
              <div>
                <label className="w-full py-2.5 bg-gray-800 text-white text-sm font-medium rounded-lg hover:bg-gray-700 flex items-center justify-center gap-2 transition-colors cursor-pointer">
                  <Upload size={16} /> ファイルを選択して復元
                  <input type="file" accept=".json" onChange={handleFileImport} className="hidden" />
                </label>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-px bg-gray-200"></div><span className="text-xs text-gray-400 font-medium">または</span><div className="flex-1 h-px bg-gray-200"></div>
              </div>
              <div className="flex flex-col gap-2">
                <textarea
                  value={restoreText} onChange={(e) => setRestoreText(e.target.value)}
                  placeholder="ここにバックアップテキストを貼り付け..."
                  className="w-full h-24 text-xs text-gray-600 bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-gray-500 focus:bg-white transition-colors"
                />
                <button
                  onClick={() => { if (restoreText.trim()) executeRestore(restoreText); else showModal("エラー", "テキストが入力されていません。", closeModal, null, "OK"); }}
                  className="w-full py-2.5 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 flex items-center justify-center gap-2 transition-colors"
                >
                  📋 貼り付けたテキストで復元
                </button>
              </div>
              <button onClick={() => { setIsRestoreModalOpen(false); setRestoreText(''); }} className="w-full py-2 mt-1 text-gray-500 text-sm hover:text-gray-700">閉じる</button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto">
        <div className="relative mb-6 flex justify-center items-center h-10">
          
          <button 
            onClick={() => setIsDrawerOpen(true)}
            className="absolute left-0 p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-200 rounded-lg transition-colors z-10"
            title="メニューを開く"
          >
            <Menu size={24} />
          </button>

          {/* タイトルの表示とポップアップ編集機能 */}
          <div className="w-full flex justify-center max-w-[60%] sm:max-w-[50%] relative">
            <h1 onClick={() => { setAppTitleInput(settings.title); setIsEditingAppTitle(true); }} className="text-2xl sm:text-3xl font-light tracking-wider text-gray-900 m-0 text-center cursor-text hover:bg-gray-50 rounded py-1 px-3 flex justify-center items-center gap-2 group transition-colors" title="タイトルを編集">
              <span className="truncate">{settings.title}</span><Edit2 size={16} className="text-gray-400 opacity-60 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0" />
            </h1>

            {/* タイトル編集用のポップアップ */}
            {isEditingAppTitle && (
              <>
                <div className="fixed inset-0 z-[50]" onClick={() => setIsEditingAppTitle(false)}></div>
                <div className="absolute top-[110%] left-1/2 -translate-x-1/2 w-[90vw] sm:w-[400px] max-w-[400px] bg-white p-3 rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.15)] border border-gray-200 flex items-center gap-2 z-[60] animate-in zoom-in-95 duration-200">
                  <input 
                    autoFocus value={appTitleInput} onChange={(e) => setAppTitleInput(e.target.value)} 
                    onKeyDown={(e) => { if (e.key === 'Enter') saveAppTitle(); }} 
                    className="flex-1 font-bold text-gray-800 text-sm sm:text-base border-b border-gray-400 focus:outline-none px-1 py-1" 
                  />
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={saveAppTitle} className="p-1.5 bg-gray-800 text-white rounded-md hover:bg-gray-700 shadow-sm" title="保存"><Check size={16} strokeWidth={3} /></button>
                    <button onClick={() => setIsEditingAppTitle(false)} className="p-1.5 bg-white border border-gray-300 text-gray-500 rounded-md hover:bg-gray-50 shadow-sm" title="キャンセル"><X size={16} strokeWidth={3} /></button>
                  </div>
                </div>
              </>
            )}
          </div>
          
          <div className="absolute right-0 flex items-center gap-2">
            <div className="hidden sm:block">
              <DataManagementButtons onBackupClick={handleBackupClick} onRestoreClick={() => setIsRestoreModalOpen(true)} onTrashClick={() => setIsTrashModalOpen(true)} />
            </div>
            <button 
              onClick={() => setIsSettingsModalOpen(true)} 
              className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-200 rounded-lg transition-colors z-10"
              title="タスクボード設定"
            >
              <Settings size={24} />
            </button>
          </div>
        </div>

        {/* タスク追加フォーム (アコーディオン) */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-4 relative z-10">
          <div 
            onClick={() => setIsAddTaskCollapsed(!isAddTaskCollapsed)}
            className={`bg-gray-50 px-4 sm:px-5 py-3.5 flex items-center justify-between cursor-pointer hover:bg-gray-100 transition-colors select-none ${isAddTaskCollapsed ? 'rounded-xl' : 'rounded-t-xl'}`}
          >
            <div className="flex items-center gap-2 font-bold text-gray-700 text-sm sm:text-base">
              <Plus size={18} className="text-gray-500" />
              新しいタスクを追加
            </div>
            {isAddTaskCollapsed ? <ChevronRight size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
          </div>
          
          {!isAddTaskCollapsed && (
            <div className="p-4 sm:p-5 border-t border-gray-200 animate-in slide-in-from-top-2 fade-in duration-200 rounded-b-xl">
              <form onSubmit={handleAddTask} className="flex flex-col gap-3 sm:gap-4">
                
                {/* 1行目: タイトル + ステータス */}
                <div className="flex items-end gap-2 sm:gap-4">
                  <div className="flex-1 min-w-0">
                    <input type="text" value={newTaskTitle} onChange={(e) => setNewTaskTitle(e.target.value)} placeholder="タスクのタイトルを入力..." className="w-full h-[42px] border border-gray-300 rounded-lg px-3 focus:outline-none focus:border-gray-500 focus:ring-1 focus:ring-gray-500 text-sm" />
                  </div>
                  <div className="w-[100px] sm:w-[120px] shrink-0">
                    <label className="block text-[10px] font-bold text-gray-500 mb-1 ml-1">ステータス</label>
                    <select value={newTaskStatus} onChange={(e) => setNewTaskStatus(e.target.value)} className="w-full h-[42px] border border-gray-300 rounded-lg px-2 text-sm focus:outline-none focus:border-gray-500 bg-white text-left">
                      {currentColumns.map(col => <option key={col.id} value={col.id}>{col.title.split(' ')[0]}</option>)}
                    </select>
                  </div>
                  <div className="hidden sm:block shrink-0">
                    <button type="submit" className="h-[42px] bg-gray-800 text-white px-5 rounded-lg hover:bg-gray-700 transition-colors flex items-center justify-center gap-1.5 font-medium text-sm">
                      <Plus size={18} /> 追加
                    </button>
                  </div>
                </div>
                
                {/* 2行目: 担当者 + 期日 + 優先度 */}
                <div className="flex flex-wrap gap-2 sm:gap-4">
                  <div className="w-[85px] sm:w-[100px] shrink-0">
                    <label className="block text-[10px] font-bold text-gray-500 mb-1 ml-1">担当者</label>
                    <select value={newTaskAssignee} onChange={(e) => setNewTaskAssignee(e.target.value)} className="w-full h-[42px] border border-gray-300 rounded-lg px-2 text-sm focus:outline-none focus:border-gray-500 bg-white text-left">
                      {settings.assignees.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>

                  <div className="w-[110px] sm:w-[130px] shrink-0">
                    <label className="block text-[10px] font-bold text-gray-500 mb-1 ml-1">期日</label>
                    <div className="relative w-full h-[42px] bg-white border border-gray-300 rounded-lg flex items-center px-2 shadow-sm cursor-pointer">
                      <Calendar size={14} className="text-gray-400 mr-1.5 shrink-0"/>
                      <span className={`text-xs font-medium truncate ${newTaskDueDate ? 'text-gray-700' : 'text-gray-400'}`}>
                        {newTaskDueDate ? new Date(newTaskDueDate).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' }) : '設定しない'}
                      </span>
                      <input type="date" value={newTaskDueDate} onChange={(e) => setNewTaskDueDate(e.target.value)} className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />
                    </div>
                  </div>

                  <div className="flex-1 min-w-[120px]">
                    <label className="block text-[10px] font-bold text-gray-500 mb-1 ml-1">優先度</label>
                    <div className="w-full h-[42px] border border-gray-300 rounded-lg px-2 sm:px-3 bg-white flex items-center gap-2 overflow-hidden">
                      <input type="range" min="0" max="100" value={newTaskPriority} onChange={(e) => setNewTaskPriority(parseInt(e.target.value))} className="custom-slider flex-1 min-w-0" style={{ '--slider-color': getPriorityColorRGB(newTaskPriority), '--slider-bg': `linear-gradient(to right, ${getPriorityColorRGB(newTaskPriority)} ${newTaskPriority}%, #E5E7EB ${newTaskPriority}%)` }} />
                      <span className="text-xs font-bold w-6 shrink-0 text-right" style={{ color: getPriorityColorRGB(newTaskPriority) }}>{newTaskPriority}</span>
                    </div>
                  </div>
                </div>

                <div className="sm:hidden mt-2">
                  <button type="submit" className="w-full h-[42px] bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition-colors flex items-center justify-center gap-2 font-medium text-sm">
                    <Plus size={18} /> 追加
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>

        {/* フィルターエリア (アコーディオン) */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6 relative z-20">
          <div 
            onClick={() => setIsFilterCollapsed(!isFilterCollapsed)}
            className={`bg-gray-50 px-4 sm:px-5 py-3.5 flex items-center justify-between cursor-pointer hover:bg-gray-100 transition-colors select-none ${isFilterCollapsed ? 'rounded-xl' : 'rounded-t-xl'}`}
          >
            <div className="flex items-center gap-2 font-bold text-gray-700 text-sm sm:text-base">
              <Filter size={18} className="text-gray-500" />
              タスクの絞り込み
            </div>
            <div className="flex items-center gap-3">
              {isFilterActive && (
                <span className="bg-blue-100 text-blue-700 text-[10px] px-2 py-0.5 rounded-full font-bold">適用中</span>
              )}
              {isFilterCollapsed ? <ChevronRight size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
            </div>
          </div>

          {!isFilterCollapsed && (
            <div className="p-3 sm:p-4 border-t border-gray-200 animate-in slide-in-from-top-2 fade-in duration-200 flex flex-col gap-3 rounded-b-xl relative">
              
              {/* 上段：担当者フィルター */}
              <div className="flex items-center gap-2 px-1 overflow-x-auto custom-scrollbar pb-1">
                <span className="font-semibold text-gray-500 text-sm shrink-0 mr-1 hidden sm:block">担当者</span>
                <button onClick={() => setFilterAssignee(null)} className={`shrink-0 px-4 py-2 rounded-full text-sm font-bold transition-all border shadow-sm ${!filterAssignee ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-500 border-gray-300 hover:bg-gray-50'}`}>
                  すべて
                </button>
                {settings.assignees.map(a => (
                  <button key={a} onClick={() => setFilterAssignee(a)} className={`shrink-0 px-4 py-2 rounded-full text-sm font-bold transition-all border shadow-sm ${filterAssignee === a ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-500 border-gray-300 hover:bg-gray-50'}`}>
                    {a}
                  </button>
                ))}
              </div>

              {/* 中段：分断線とリセットボタン */}
              <div className="flex items-center w-full px-1 py-1">
                <div className="flex-1 border-t border-gray-200"></div>
                <button 
                  onClick={clearFilters} 
                  className="flex items-center gap-1.5 text-gray-500 hover:text-gray-800 bg-white px-4 py-1.5 rounded-full border border-gray-200 shadow-sm transition-colors ml-3 shrink-0"
                  title="すべてのフィルターをリセット"
                >
                  <RotateCcw size={14} /> <span className="font-bold text-xs sm:text-sm">条件リセット</span>
                </button>
              </div>

              {/* 下段：期日・優先度フィルター */}
              <div className="flex flex-col gap-2.5 px-1 pb-1 w-full">
                
                {/* 期日 */}
                <div className="flex items-center bg-white px-3 py-2.5 rounded-lg border border-gray-200 shadow-sm w-full">
                  <div className="flex items-center gap-1.5 shrink-0 w-[72px]">
                    <Calendar size={14} className="text-gray-400" />
                    <span className="font-semibold text-gray-500 text-xs">期日</span>
                  </div>
                  
                  <div className="flex-1 flex items-center">
                    <div className="relative flex items-center justify-center flex-1 border-b border-dashed border-gray-300 px-1 pb-0.5">
                      <span className={`text-xs font-medium truncate ${filterDueDateFrom ? 'text-gray-700' : 'text-gray-300'}`}>
                        {filterDueDateFrom ? new Date(filterDueDateFrom).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' }) : '未指定'}
                      </span>
                      <input type="date" value={filterDueDateFrom} onChange={handleFilterDueDateFromChange} className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" />
                    </div>
                    <span className="text-gray-400 text-xs mx-2 shrink-0">〜</span>
                    <div className="relative flex items-center justify-center flex-1 border-b border-dashed border-gray-300 px-1 pb-0.5">
                      <span className={`text-xs font-medium truncate ${filterDueDateTo ? 'text-gray-700' : 'text-gray-300'}`}>
                        {filterDueDateTo ? new Date(filterDueDateTo).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' }) : '未指定'}
                      </span>
                      <input type="date" value={filterDueDateTo} onChange={handleFilterDueDateToChange} className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" />
                    </div>
                  </div>
                </div>

                {/* 優先度 */}
                <div className="flex items-center bg-white px-3 py-2.5 rounded-lg border border-gray-200 shadow-sm w-full relative">
                  <div className="flex items-center gap-1.5 shrink-0 w-[72px]">
                    <Flag size={14} className="text-gray-400" />
                    <span className="font-semibold text-gray-500 text-xs">優先度</span>
                  </div>
                  
                  <div className="flex-1 flex items-center">
                    <div 
                      className="flex items-center justify-center flex-1 cursor-pointer hover:bg-gray-50 rounded border-b border-dashed border-gray-300 px-1 py-0.5" 
                      onClick={() => { setEditingFilterPriorityType('from'); setTempFilterPriority(filterPriorityFrom !== '' ? parseInt(filterPriorityFrom) : 0); }}
                    >
                      <span className={`text-xs font-bold ${filterPriorityFrom !== '' ? '' : 'text-gray-300'}`} style={filterPriorityFrom !== '' ? { color: getPriorityColorRGB(filterPriorityFrom) } : {}}>
                        {filterPriorityFrom !== '' ? filterPriorityFrom : '0'}
                      </span>
                    </div>
                    
                    <span className="text-gray-400 text-xs mx-2 shrink-0">〜</span>
                    
                    <div 
                      className="flex items-center justify-center flex-1 cursor-pointer hover:bg-gray-50 rounded border-b border-dashed border-gray-300 px-1 py-0.5" 
                      onClick={() => { setEditingFilterPriorityType('to'); setTempFilterPriority(filterPriorityTo !== '' ? parseInt(filterPriorityTo) : 100); }}
                    >
                      <span className={`text-xs font-bold ${filterPriorityTo !== '' ? '' : 'text-gray-300'}`} style={filterPriorityTo !== '' ? { color: getPriorityColorRGB(filterPriorityTo) } : {}}>
                        {filterPriorityTo !== '' ? filterPriorityTo : '100'}
                      </span>
                    </div>
                  </div>

                  {/* 優先度フィルター用ポップアップ */}
                  {editingFilterPriorityType && (
                    <>
                      <div className="fixed inset-0 z-[50]" onClick={() => setEditingFilterPriorityType(null)}></div>
                      <div className={`absolute top-[115%] ${editingFilterPriorityType === 'to' ? 'right-0' : 'left-0'} w-[280px] max-w-[calc(100vw-32px)] bg-white p-3 rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-gray-200 flex items-center gap-2 sm:gap-3 z-[60] animate-in zoom-in-95 duration-200`}>
                        <input 
                          type="range" min="0" max="100" value={tempFilterPriority} onChange={(e) => setTempFilterPriority(parseInt(e.target.value))} className="custom-slider flex-1 min-w-0"
                          style={{ '--slider-color': getPriorityColorRGB(tempFilterPriority), '--slider-bg': `linear-gradient(to right, ${getPriorityColorRGB(tempFilterPriority)} ${tempFilterPriority}%, #E5E7EB ${tempFilterPriority}%)` }}
                        />
                        <span className="text-xs font-bold w-6 shrink-0 text-right" style={{ color: getPriorityColorRGB(tempFilterPriority) }}>{tempFilterPriority}</span>
                        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
                          <button onClick={handleFilterPrioritySave} className="p-2 bg-gray-800 text-white rounded-md hover:bg-gray-700 shadow-sm"><Check size={16} strokeWidth={3} /></button>
                          <button onClick={() => setEditingFilterPriorityType(null)} className="p-2 bg-white border border-gray-300 text-gray-500 rounded-md hover:bg-gray-50 shadow-sm"><X size={16} strokeWidth={3} /></button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* カンバンボードエリア */}
        <div className="flex flex-col md:flex-row gap-4 sm:gap-6 overflow-x-auto pb-4 items-start relative z-0">
          {currentColumns.map(column => {
            const isCollapsed = collapsedColumns[column.id] || false;
            
            const sortOrder = columnSorts[column.id] || 'createdAt-asc';
            const columnTasks = processedTasks.filter(t => t.status === column.id).sort((a, b) => {
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
              if (sortOrder === 'createdAt-asc') return (a.createdAt || 0) - (b.createdAt || 0);
              return 0;
            });

            return (
              <div key={column.id} className="w-full md:w-auto flex-1 md:min-w-[360px] bg-gray-50/50 border border-gray-200 rounded-xl p-2.5 sm:p-4" onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, column.id)}>
                
                <h2 className="mb-2 pb-2 border-b border-gray-200 flex items-center justify-between">
                  <div 
                    onClick={() => toggleCollapse(column.id)}
                    className="flex items-center gap-1.5 font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 rounded px-1 py-1 transition-colors select-none"
                    title="タップして折りたたむ"
                  >
                    {isCollapsed ? <ChevronRight size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
                    {column.title}
                    <span className="bg-white border border-gray-200 text-gray-600 text-xs px-2 py-0.5 rounded-full shadow-sm ml-1">
                      {columnTasks.length}
                    </span>
                  </div>

                  {!isCollapsed && (
                    <select 
                      value={sortOrder}
                      onChange={(e) => setColumnSorts(prev => ({ ...prev, [column.id]: e.target.value }))}
                      className="text-[11px] sm:text-xs bg-transparent text-gray-500 font-medium focus:outline-none cursor-pointer hover:text-gray-800 w-[110px] sm:w-[130px] truncate"
                      style={{ textAlignLast: 'right' }}
                      title="並び替え"
                    >
                      <option value="priority-desc">優先度が高い順</option>
                      <option value="priority-asc">優先度が低い順</option>
                      <option value="dueDate-asc">期日が近い順</option>
                      <option value="dueDate-desc">期日が遠い順</option>
                      <option value="createdAt-desc">追加日時が新しい順</option>
                      <option value="createdAt-asc">追加日時が古い順</option>
                    </select>
                  )}
                </h2>

                {!isCollapsed && (
                  <div className="space-y-3 sm:space-y-4 min-h-[100px] mt-3 animate-in slide-in-from-top-2 fade-in duration-200">
                    {columnTasks.map(task => (
                      <TaskCard 
                        key={task.id} 
                        task={task} 
                        assignees={settings.assignees}
                        columns={currentColumns}
                        onUpdate={updateTask} 
                        onDragStart={handleDragStart} 
                      />
                    ))}
                    {columnTasks.length === 0 && (
                      <div className="text-center text-gray-400 text-sm py-8 border-2 border-dashed border-gray-200 rounded-lg bg-gray-50/50">タスクはありません</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        
        <div className="sm:hidden mt-8 pt-6 border-t border-gray-200 pb-4">
          <p className="text-xs text-gray-500 text-center mb-3">データ管理</p>
          <DataManagementButtons onBackupClick={handleBackupClick} onRestoreClick={() => setIsRestoreModalOpen(true)} onTrashClick={() => setIsTrashModalOpen(true)} />
        </div>
      </div>
    </div>
  );
}