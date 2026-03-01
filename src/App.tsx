import './App.css'; // Global scrollbar styles
import { Layout, Button, Modal, Input, message, theme, ConfigProvider } from 'antd';
import { useState, useEffect, useMemo, useRef } from 'react';
import { ChatMessage, ChatThread } from './types';
import { DEFAULT_MODEL } from './utils/constants';
import { uid, threadStorageKey, clampThreads } from './utils/chat';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import FilePreviewPanel from './components/ChatArea/FilePreviewPanel';
import { useFilePreview } from './hooks/useFilePreview';
import { getBackend } from './backend';
import TitleBar from './components/WindowChrome/TitleBar';

const { Content } = Layout;

// --- Types & Constants moved to ./types and ./utils ---

export default function App() {
  // --- State ---
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [currentWorkspace, setCurrentWorkspace] = useState<Workspace | null>(null);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string>("");

  const backend = useMemo(() => getBackend(), []);
  
  // File Tree State
  const [dirCache, setDirCache] = useState<Record<string, MirrorDirEntry[]>>({});
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({ ".": true });
  
  const { 
    selectedFile, 
    // setSelectedFile, // Not used directly in App.tsx anymore
    filePreview, 
    setFilePreview, 
    openFile 
  } = useFilePreview(currentWorkspace);
  
  // UI State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [newWorkspacePath, setNewWorkspacePath] = useState("");
  const [newWorkspaceModel] = useState(DEFAULT_MODEL);
  const [loading, setLoading] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'chat' | 'files'>('chat');
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const raw = localStorage.getItem('mw.sidebar.width');
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) ? parsed : 280;
  });
  const [previewWidth, setPreviewWidth] = useState<number>(() => {
    const raw = localStorage.getItem('mw.preview.width');
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) ? parsed : 520;
  });
  const [dragging, setDragging] = useState<'sidebar' | 'preview' | null>(null);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(0);

  const activeThread = useMemo(() => {
    return threads.find((t) => t.id === activeThreadId) || null;
  }, [threads, activeThreadId]);

  const suggestedPrompts = useMemo(() => {
    const rootEntries = dirCache['.'] || [];
    const files = rootEntries.filter((e) => e.kind === 'file').map((e) => e.name.toLowerCase());
    const hasMd = files.some((f) => f.endsWith('.md'));
    const hasData = files.some((f) => f.endsWith('.xlsx') || f.endsWith('.csv'));
    const prompts: string[] = [];
    if (hasMd) prompts.push('先总结一下这个工作区里文档的关键结论。');
    if (hasData) prompts.push('请从数据文件中提取关键指标并做简要分析。');
    prompts.push('请列出当前工作区最值得优先处理的 3 件事。');
    return prompts.slice(0, 3);
  }, [dirCache]);

  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  const getSidebarBounds = () => {
    const min = 220;
    const max = Math.max(min, Math.min(520, Math.floor(window.innerWidth * 0.45)));
    return { min, max };
  };
  const getPreviewBounds = () => {
    const min = 320;
    const max = Math.max(min, Math.min(980, Math.floor(window.innerWidth * 0.7)));
    return { min, max };
  };

  // --- Effects ---

  // Initial Load
  useEffect(() => {
    loadWorkspaces();
  }, []);

  // Load Threads from LocalStorage when Workspace changes
  useEffect(() => {
    if (!currentWorkspace) {
      setThreads([]);
      setActiveThreadId("");
      return;
    }
    const key = threadStorageKey(currentWorkspace.name);
    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        setThreads([]);
        setActiveThreadId("");
        return;
      }
      const parsed = clampThreads(JSON.parse(raw));
      if (!parsed) {
        setThreads([]);
        setActiveThreadId("");
        return;
      }
      setThreads(parsed.threads);
      setActiveThreadId(
        parsed.threads.some((t) => t.id === parsed.activeThreadId)
          ? parsed.activeThreadId
          : parsed.threads[0]?.id ?? ""
      );
    } catch (_err) {
      setThreads([]);
      setActiveThreadId("");
    }
  }, [currentWorkspace?.name]);

  // Persist Threads to LocalStorage
  useEffect(() => {
    if (!currentWorkspace) return;
    if (threads.length === 0) return;
    const key = threadStorageKey(currentWorkspace.name);
    const handle = window.setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify({ activeThreadId, threads }));
      } catch (_err) { }
    }, 500);
    return () => window.clearTimeout(handle);
  }, [currentWorkspace?.name, threads, activeThreadId]);

  // Reset File Tree on Workspace Change
  useEffect(() => {
    setDirCache({});
    setExpandedDirs({ ".": true });
    // filePreview reset is handled in useFilePreview hook
    if (currentWorkspace) {
      loadMirrorDir(".");
    }
  }, [currentWorkspace?.name]);

  useEffect(() => {
    localStorage.setItem('mw.sidebar.width', String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    localStorage.setItem('mw.preview.width', String(previewWidth));
  }, [previewWidth]);

  useEffect(() => {
    const onResize = () => {
      const sidebarBounds = getSidebarBounds();
      const previewBounds = getPreviewBounds();
      setSidebarWidth((prev) => clamp(prev, sidebarBounds.min, sidebarBounds.max));
      setPreviewWidth((prev) => clamp(prev, previewBounds.min, previewBounds.max));
    };
    window.addEventListener('resize', onResize);
    onResize();
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // --- Logic Helpers ---

  const loadWorkspaces = async () => {
    try {
      const list = await backend.getWorkspaces();
      setWorkspaces(list);
      if (!currentWorkspace && list.length > 0) {
        setCurrentWorkspace(list[0]);
      }
    } catch (error) {
      message.error(`Failed to load workspaces: ${(error as Error).message}`);
    }
  };

  const handleOpenOriginalFile = async (mirrorPath: string) => {
    if (!currentWorkspace) return;
    try {
      await backend.openSourceFile(currentWorkspace.name, mirrorPath);
    } catch (error) {
      message.error(`打开原文件失败: ${(error as Error).message}`);
    }
  };

  const loadMirrorDir = async (relativeDir: string) => {
    if (!currentWorkspace) return;
    try {
      const result = await backend.listMirrorDir(currentWorkspace.name, relativeDir);
      setDirCache((prev) => ({ ...prev, [result.directory || "."]: result.entries }));
    } catch (error) {
      console.error("Load dir failed", error);
    }
  };

  const toggleDir = (dirPath: string) => {
    setExpandedDirs((prev) => ({ ...prev, [dirPath]: !prev[dirPath] }));
    if (!dirCache[dirPath]) {
      loadMirrorDir(dirPath);
    }
  };

  // openFile moved to hook

  const handleCreateWorkspace = async () => {
    if (!newWorkspaceName || !newWorkspacePath) {
      message.warning("请输入名称和路径");
      return;
    }
    setLoading(true);
    try {
      const created = await backend.createWorkspace({
        name: newWorkspaceName,
        source_path: newWorkspacePath,
        model: newWorkspaceModel,
        enableWebSearch: false
      });
      setWorkspaces(prev => [...prev, created]);
      setCurrentWorkspace(created);
      setIsModalOpen(false);
      setNewWorkspaceName("");
      setNewWorkspacePath("");
      message.success("工作空间创建成功");
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleWebSearch = async (checked: boolean) => {
    if (!currentWorkspace) return;
    try {
      const updated = await backend.updateWorkspace(currentWorkspace.name, { enableWebSearch: checked });
      setWorkspaces(prev => prev.map(w => w.name === updated.name ? updated : w));
      setCurrentWorkspace(updated);
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const handleSync = async () => {
    if (!currentWorkspace) return;
    const hide = message.loading("正在同步...", 0);
    try {
      const res = await backend.syncWorkspace(currentWorkspace.name);
      hide();
      message.success(res.message);
      // Add system message to current thread
      if (activeThreadId) {
        const msg: ChatMessage = {
          id: uid(),
          role: 'system',
          content: `同步完成: ${res.message}`,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        setThreads(prev => prev.map(t => t.id === activeThreadId ? { ...t, messages: [...t.messages, msg] } : t));
      }
    } catch (e) {
      hide();
      message.error("同步失败");
    }
  };

  // --- Thread Management ---
  const handleDeleteThread = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const title = threads.find(t => t.id === id)?.title?.trim() || '该任务';
    Modal.confirm({
      title: '删除任务',
      centered: true,
      content: `确定要删除任务「${title}」吗？`,
      okText: '删除',
      cancelText: '取消',
      onOk: () => {
        setThreads(prev => {
          const next = prev.filter(t => t.id !== id);
          if (activeThreadId === id) {
             setActiveThreadId(next[0]?.id || "");
          }
          return next;
        });
      }
    });
  };

  const handleRenameThread = (id: string, newTitle: string) => {
    setThreads(prev => prev.map(t => t.id === id ? { ...t, title: newTitle } : t));
  };

  // --- ProChat Integration ---
  // (Moved to ChatArea)

  // --- Render Helpers ---

  const startSidebarResize = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragStartXRef.current = event.clientX;
    dragStartWidthRef.current = sidebarWidth;
    setDragging('sidebar');
  };

  const startPreviewResize = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragStartXRef.current = event.clientX;
    dragStartWidthRef.current = previewWidth;
    setDragging('preview');
  };

  useEffect(() => {
    if (!dragging) return;
    const onMouseMove = (event: MouseEvent) => {
      if (dragging === 'sidebar') {
        const delta = event.clientX - dragStartXRef.current;
        const next = dragStartWidthRef.current + delta;
        const bounds = getSidebarBounds();
        setSidebarWidth(clamp(next, bounds.min, bounds.max));
        return;
      }
      const delta = dragStartXRef.current - event.clientX;
      const next = dragStartWidthRef.current + delta;
      const bounds = getPreviewBounds();
      setPreviewWidth(clamp(next, bounds.min, bounds.max));
    };
    const onMouseUp = () => setDragging(null);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [dragging]);

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#111111',
          colorLink: '#111111'
        }
      }}
    >
      <div className="mw-shell">
        <TitleBar />
        <Layout className="mw-main-layout" style={{ background: '#fff', overflow: 'hidden' }}>
          <Sidebar
            width={sidebarWidth}
            workspaces={workspaces}
            currentWorkspace={currentWorkspace}
            setCurrentWorkspace={setCurrentWorkspace}
            isModalOpen={isModalOpen}
            setIsModalOpen={setIsModalOpen}
            sidebarTab={sidebarTab}
            setSidebarTab={setSidebarTab}
            threads={threads}
            activeThreadId={activeThreadId}
            setActiveThreadId={setActiveThreadId}
            handleRenameThread={handleRenameThread}
            handleDeleteThread={handleDeleteThread}
            onClearThreads={() => {
              setThreads([]);
              setActiveThreadId("");
            }}
            onNewChat={() => {
              setActiveThreadId("");
            }}
            dirCache={dirCache}
            expandedDirs={expandedDirs}
            toggleDir={toggleDir}
            selectedFile={selectedFile}
            openFile={openFile}
            onSync={handleSync}
          />
          <div
            className={`mw-resize-handle mw-resize-handle-sidebar${dragging === 'sidebar' ? ' is-dragging' : ''}`}
            onMouseDown={startSidebarResize}
            role="separator"
            aria-orientation="vertical"
            aria-label="调整左侧栏宽度"
          />

          <Content style={{ display: 'flex', flexDirection: 'row', height: '100%', overflow: 'hidden' }}>
            {/* Main Chat Area */}
            <ChatArea
              currentWorkspace={currentWorkspace}
              activeThreadId={activeThreadId}
              activeThread={activeThread}
              threads={threads}
              setActiveThreadId={setActiveThreadId}
              setThreads={setThreads}
              onToggleWebSearch={handleToggleWebSearch}
              onOpenSourceFile={openFile}
              suggestedPrompts={suggestedPrompts}
            />

            {/* File Preview Panel */}
            {filePreview && (
              <>
                <div
                  className={`mw-resize-handle mw-resize-handle-preview${dragging === 'preview' ? ' is-dragging' : ''}`}
                  onMouseDown={startPreviewResize}
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="调整文件预览宽度"
                />
                <FilePreviewPanel
                  width={previewWidth}
                  filePreview={filePreview}
                  setFilePreview={setFilePreview}
                  onOpenOriginal={handleOpenOriginalFile}
                />
              </>
            )}
          </Content>
        </Layout>
      </div>

      {/* Create Workspace Modal */}
      <Modal 
        title="新建工作空间" 
        centered
        open={isModalOpen} 
        onCancel={() => setIsModalOpen(false)}
        onOk={handleCreateWorkspace}
        confirmLoading={loading}
        okText="创建"
        cancelText="取消"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Input placeholder="工作空间名称" value={newWorkspaceName} onChange={e => setNewWorkspaceName(e.target.value)} />
          <div style={{ display: 'flex', gap: 8 }}>
            <Input placeholder="源目录路径" value={newWorkspacePath} onChange={e => setNewWorkspacePath(e.target.value)} />
            <Button onClick={async () => {
              const p = await backend.selectDirectory();
              if (p) setNewWorkspacePath(p);
            }}>选择...</Button>
          </div>
        </div>
      </Modal>
    </ConfigProvider>
  );
}
