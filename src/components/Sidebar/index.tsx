import { Layout } from 'antd';
import WorkspaceSelector from './WorkspaceSelector';
import ThreadList from './ThreadList';
import FileTree from './FileTree';
import { ChatThread } from '../../types';

const { Sider } = Layout;

interface SidebarProps {
  width: number;
  workspaces: Workspace[];
  currentWorkspace: Workspace | null;
  setCurrentWorkspace: (w: Workspace) => void;
  isModalOpen: boolean;
  setIsModalOpen: (open: boolean) => void;
  sidebarTab: 'chat' | 'files';
  setSidebarTab: (val: 'chat' | 'files') => void;
  
  // Thread props
  threads: ChatThread[];
  activeThreadId: string;
  setActiveThreadId: (id: string) => void;
  handleRenameThread: (id: string, newTitle: string) => void;
  handleDeleteThread: (e: React.MouseEvent, id: string) => void;
  onClearThreads: () => void;
  onNewChat: () => void;
  
  // File props
  dirCache: Record<string, MirrorDirEntry[]>;
  expandedDirs: Record<string, boolean>;
  toggleDir: (dirPath: string) => void;
  selectedFile: string;
  openFile: (filePath: string) => void;
  onSync: () => void;
}

export default function Sidebar(props: SidebarProps) {
  return (
    <Sider 
      width={props.width}
      theme="light" 
      style={{
        borderRight: '1px solid #f0f0f0',
        flex: '0 0 auto',
        transition: 'none',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <WorkspaceSelector 
          workspaces={props.workspaces}
          currentWorkspace={props.currentWorkspace}
          setCurrentWorkspace={props.setCurrentWorkspace}
          onOpenCreateModal={() => props.setIsModalOpen(true)}
          sidebarTab={props.sidebarTab}
          setSidebarTab={props.setSidebarTab}
          onSync={props.onSync}
          onNewChat={props.onNewChat}
        />

        {props.sidebarTab === 'chat' && (
          <ThreadList 
            threads={props.threads}
            activeThreadId={props.activeThreadId}
            setActiveThreadId={props.setActiveThreadId}
            handleRenameThread={props.handleRenameThread}
            handleDeleteThread={props.handleDeleteThread}
            onClearThreads={props.onClearThreads}
          />
        )}

        {props.sidebarTab === 'files' && (
          <FileTree 
            dirCache={props.dirCache}
            expandedDirs={props.expandedDirs}
            toggleDir={props.toggleDir}
            selectedFile={props.selectedFile}
            openFile={props.openFile}
            currentWorkspaceName={props.currentWorkspace?.name}
          />
        )}
      </div>
    </Sider>
  );
}
