import { Button, Dropdown, Segmented, Tooltip } from 'antd';
import { 
  PlusOutlined, 
  DownOutlined,
  SyncOutlined,
  FolderOpenOutlined,
  MessageOutlined
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
  const primaryActionStyle = {
    borderRadius: '8px',
    boxShadow: '0 2px 0 rgba(17, 17, 17, 0.15)'
  } as const;

  return (
    <>
      <div style={{ padding: '12px 16px 16px', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Dropdown
            menu={{
              items: [
                {
                  key: '__create_workspace__',
                  label: (
                    <span style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6 }}>
                      <PlusOutlined />
                      新建工作空间
                    </span>
                  ),
                  onClick: onOpenCreateModal
                },
                ...(workspaces.length > 0 ? [{ type: 'divider' as const }] : []),
                ...workspaces.map(w => ({
                  key: w.name,
                  label: <span style={{ display: 'block', width: '100%', textAlign: 'center' }}>{w.name}</span>,
                  onClick: () => setCurrentWorkspace(w)
                }))
              ]
            }}
            trigger={['click']}
            placement="bottom"
            overlayStyle={{ width: 248 }}
          >
            <Button
              size="large"
              style={{
                width: 248,
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                gap: 8
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 'calc(100% - 20px)' }}>
                {currentWorkspace?.name || "选择工作空间"}
              </span>
              <DownOutlined style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }} />
            </Button>
          </Dropdown>
        </div>
        
        {currentWorkspace && (
          <div style={{ marginTop: 16 }}>
            <Segmented
              className="mw-sidebar-tab-segmented"
              block
              value={sidebarTab}
              onChange={(val) => setSidebarTab(val as 'chat' | 'files')}
              options={[
                { label: '任务', value: 'chat', icon: <MessageOutlined /> },
                { label: '文件', value: 'files', icon: <FolderOpenOutlined /> }
              ]}
            />
            <div style={{ marginTop: 16 }}>
              {sidebarTab === 'files' && (
                <Tooltip title="同步文件">
                  <Button
                    type="primary"
                    size="large"
                    icon={<SyncOutlined />}
                    onClick={onSync}
                    block
                    style={primaryActionStyle}
                  >
                    同步文件
                  </Button>
                </Tooltip>
              )}
              {sidebarTab === 'chat' && (
                <Button 
                  type="primary" 
                  size="large"
                  icon={<PlusOutlined />} 
                  onClick={onNewChat} 
                  block 
                  style={primaryActionStyle}
                >
                  新建任务
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
