import { Button, Dropdown, Segmented, Tooltip } from 'antd';
import { 
  PlusOutlined, 
  DownOutlined,
  SyncOutlined,
  FolderOpenOutlined,
  MessageOutlined,
  RobotOutlined
} from '@ant-design/icons';

interface WorkspaceSelectorProps {
  workspaces: Workspace[];
  currentWorkspace: Workspace | null;
  setCurrentWorkspace: (w: Workspace) => void;
  onOpenCreateModal: () => void;
  sidebarTab: 'chat' | 'files';
  setSidebarTab: (val: 'chat' | 'files') => void;
  onSync: () => void;
  onNewChat: () => void;
}

export default function WorkspaceSelector({
  workspaces,
  currentWorkspace,
  setCurrentWorkspace,
  onOpenCreateModal,
  sidebarTab,
  setSidebarTab,
  onSync,
  onNewChat
}: WorkspaceSelectorProps) {
  return (
    <>
      <div style={{ padding: '20px 16px 0 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 18, display: 'flex', alignItems: 'center', gap: 8, color: '#1677ff' }}>
          <RobotOutlined style={{ fontSize: 20 }} /> MindWeave
        </div>
        <Tooltip title="创建新工作空间">
          <Button type="text" icon={<PlusOutlined />} onClick={onOpenCreateModal} />
        </Tooltip>
      </div>

      <div style={{ padding: '16px', flexShrink: 0 }}>
        <Dropdown
          menu={{
            items: workspaces.map(w => ({
              key: w.name,
              label: w.name,
              onClick: () => setCurrentWorkspace(w)
            }))
          }}
        >
          <Button block size="large" style={{ textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {currentWorkspace?.name || "选择工作空间"}
            </span>
            <DownOutlined style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }} />
          </Button>
        </Dropdown>
        
        {currentWorkspace && (
          <div style={{ marginTop: 16 }}>
            <Segmented
              block
              value={sidebarTab}
              onChange={(val) => setSidebarTab(val as 'chat' | 'files')}
              options={[
                { label: '对话', value: 'chat', icon: <MessageOutlined /> },
                { label: '文件', value: 'files', icon: <FolderOpenOutlined /> }
              ]}
            />
            <div style={{ marginTop: 16 }}>
              {sidebarTab === 'files' && (
                <Tooltip title="同步文件">
                  <Button size="large" icon={<SyncOutlined />} onClick={onSync} block>同步文件</Button>
                </Tooltip>
              )}
              {sidebarTab === 'chat' && (
                <Button 
                  type="primary" 
                  size="large"
                  icon={<PlusOutlined />} 
                  onClick={onNewChat} 
                  block 
                  style={{ borderRadius: '8px', boxShadow: '0 2px 0 rgba(5, 145, 255, 0.1)' }}
                >
                  新建对话
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
