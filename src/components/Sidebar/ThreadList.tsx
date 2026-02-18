import { Button, Modal } from 'antd';
import { EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { ChatThread } from '../../types';

interface ThreadListProps {
  threads: ChatThread[];
  activeThreadId: string;
  setActiveThreadId: (id: string) => void;
  handleRenameThread: (id: string, newTitle: string) => void;
  handleDeleteThread: (e: React.MouseEvent, id: string) => void;
  onClearThreads: () => void;
}

export default function ThreadList({
  threads,
  activeThreadId,
  setActiveThreadId,
  handleRenameThread,
  handleDeleteThread,
  onClearThreads
}: ThreadListProps) {

  // Group threads by date
  const groups = (() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterday = today - 86400000;
    
    const groups: Record<string, ChatThread[]> = {
      '今天': [],
      '昨天': [],
      '更早': []
    };

    threads.forEach(t => {
      if (t.updatedAt >= today) {
        groups['今天'].push(t);
      } else if (t.updatedAt >= yesterday) {
        groups['昨天'].push(t);
      } else {
        groups['更早'].push(t);
      }
    });
    return groups;
  })();

  return (
    <div style={{ flex: 1, overflowY: 'auto', borderBottom: '1px solid #f0f0f0' }}>
      <div style={{ padding: '8px 12px', fontSize: 13, color: '#999', fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>对话历史</span>
        {threads.length > 0 && (
           <Button size="small" type="text" danger onClick={() => {
             Modal.confirm({
               title: '清空对话',
               centered: true,
               content: '确定要清空所有对话吗？',
               onOk: onClearThreads
             });
           }} style={{ fontSize: 11 }}>清空</Button>
        )}
      </div>
      
      {Object.entries(groups).map(([label, groupThreads]) => {
        if (groupThreads.length === 0) return null;
        return (
          <div key={label}>
            <div style={{ padding: '4px 12px', fontSize: 12, color: '#bbb', background: '#fafafa' }}>{label}</div>
            {groupThreads.map(t => (
              <div
                key={t.id}
                style={{
                  padding: '8px 12px', cursor: 'pointer',
                  background: activeThreadId === t.id ? '#f3f4f6' : 'transparent',
                  borderRight: activeThreadId === t.id ? '2px solid #111111' : 'none',
                  position: 'relative'
                }}
                className="hover:bg-black/5 group"
                onClick={() => setActiveThreadId(t.id)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '160px' }}>
                    {t.title}
                  </div>
                  <div className="hidden group-hover:flex" style={{ gap: 2 }}>
                     <Button size="small" type="text" icon={<EditOutlined style={{ fontSize: 12 }} />} onClick={(e) => {
                       e.stopPropagation();
                       const newName = prompt("重命名对话", t.title);
                       if (newName) handleRenameThread(t.id, newName);
                     }} />
                     <Button size="small" type="text" danger icon={<DeleteOutlined style={{ fontSize: 12 }} />} onClick={(e) => handleDeleteThread(e, t.id)} />
                  </div>
                </div>
                <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>
                  {new Date(t.updatedAt).toLocaleTimeString()} · {t.messages.length} 条
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
