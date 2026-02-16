import { ProChat } from '@ant-design/pro-chat';
import './App.css'; // Global scrollbar styles
import { Layout, Button, Dropdown, Modal, Input, message, theme, ConfigProvider, Empty, Tooltip, Segmented } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { useState, useEffect, useMemo } from 'react';
import { ChatMessage, ChatThread } from './types';
import { DEFAULT_MODEL } from './utils/constants';
import { uid, threadStorageKey, clampThreads, createEmptyThread } from './utils/chat';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import FilePreviewPanel from './components/ChatArea/FilePreviewPanel';
import { useFilePreview } from './hooks/useFilePreview';
import { getBackend } from './backend';

const { Sider, Content } = Layout;

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

  const activeThread = useMemo(() => {
    return threads.find((t) => t.id === activeThreadId) || threads[0] || null;
  }, [threads, activeThreadId]);

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
        const t = createEmptyThread();
        setThreads([t]);
        setActiveThreadId(t.id);
        return;
      }
      const parsed = clampThreads(JSON.parse(raw));
      if (!parsed) {
        const t = createEmptyThread();
        setThreads([t]);
        setActiveThreadId(t.id);
        return;
      }
      setThreads(parsed.threads);
      setActiveThreadId(
        parsed.threads.some((t) => t.id === parsed.activeThreadId)
          ? parsed.activeThreadId
          : parsed.threads[0]?.id ?? ""
      );
    } catch (_err) {
      const t = createEmptyThread();
      setThreads([t]);
      setActiveThreadId(t.id);
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
    Modal.confirm({
      title: '删除对话',
      centered: true,
      content: '确定要删除这个对话吗？',
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

  return (
    <ConfigProvider theme={{ algorithm: theme.defaultAlgorithm }}>
      <Layout style={{ height: '100vh', background: '#fff', overflow: 'hidden' }}>
        <Sidebar 
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
            const t = createEmptyThread();
            setThreads(prev => [t, ...prev]);
            setActiveThreadId(t.id);
          }}
          dirCache={dirCache}
          expandedDirs={expandedDirs}
          toggleDir={toggleDir}
          selectedFile={selectedFile}
          openFile={openFile}
          onSync={handleSync}
        />

        <Content style={{ display: 'flex', flexDirection: 'row', height: '100vh', overflow: 'hidden' }}>
          {/* Main Chat Area */}
          <ChatArea 
            currentWorkspace={currentWorkspace}
            activeThreadId={activeThreadId}
            activeThread={activeThread}
            setThreads={setThreads}
            onToggleWebSearch={handleToggleWebSearch}
          />
          
          {/* File Preview Panel */}
          <FilePreviewPanel 
            filePreview={filePreview}
            setFilePreview={setFilePreview}
          />
        </Content>
      </Layout>

      {/* Create Workspace Modal */}
      <Modal 
        title="新建工作空间" 
        centered
        open={isModalOpen} 
        onCancel={() => setIsModalOpen(false)}
        onOk={handleCreateWorkspace}
        confirmLoading={loading}
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
