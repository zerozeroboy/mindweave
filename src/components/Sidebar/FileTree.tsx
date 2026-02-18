import { FolderOpenOutlined, FileOutlined } from '@ant-design/icons';
import { Empty } from 'antd';

interface FileTreeProps {
  dirCache: Record<string, MirrorDirEntry[]>;
  expandedDirs: Record<string, boolean>;
  toggleDir: (dirPath: string) => void;
  selectedFile: string;
  openFile: (filePath: string) => void;
  currentWorkspaceName?: string;
}

export default function FileTree({
  dirCache,
  expandedDirs,
  toggleDir,
  selectedFile,
  openFile,
  currentWorkspaceName
}: FileTreeProps) {
  
  const renderFileTree = (dirPath: string, depth: number) => {
    const entries = dirCache[dirPath] ?? [];
    const isRoot = dirPath === ".";
    const expanded = expandedDirs[dirPath] ?? isRoot;
    
    // Simple inline styles for tree
    const indent = depth * 12 + 12;

    return (
      <div key={dirPath}>
        <div 
          style={{
            display: 'flex', alignItems: 'center', padding: '4px 8px', cursor: 'pointer',
            paddingLeft: indent,
          }}
          className="mw-filetree-row hover:bg-black/5"
          onClick={() => toggleDir(dirPath)}
        >
          <span style={{ marginRight: 4, fontSize: 10, color: '#999' }}>{expanded ? '▼' : '▶'}</span>
          <FolderOpenOutlined className="mw-filetree-icon mw-filetree-icon-folder" style={{ marginRight: 6 }} />
          <span style={{ fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {isRoot ? 'Root' : dirPath.split('/').pop()}
          </span>
        </div>
        
        {expanded && entries.map(ent => {
          if (ent.kind === 'dir') {
            return renderFileTree(ent.path, depth + 1);
          }
          const isActive = selectedFile === ent.path;
          return (
            <div 
              key={ent.path}
              style={{
                display: 'flex', alignItems: 'center', padding: '4px 8px', cursor: 'pointer',
                paddingLeft: indent + 12,
              }}
              className={`mw-filetree-row hover:bg-black/5 ${isActive ? 'mw-filetree-item-active' : ''}`}
              onClick={() => openFile(ent.path)}
            >
              <FileOutlined className="mw-filetree-icon mw-filetree-icon-file" style={{ marginRight: 6, fontSize: 12 }} />
              <span style={{ fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {ent.name}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  if (!currentWorkspaceName) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未加载" />;

  return (
    <div className="mw-filetree" style={{ flex: 1, overflowY: 'auto' }}>
      <div className="mw-filetree-header" style={{ padding: '8px 12px', fontSize: 13, color: '#999', fontWeight: 600, position: 'sticky', top: 0, zIndex: 1 }}>
        文件浏览
      </div>
      {renderFileTree(".", 0)}
    </div>
  );
}
