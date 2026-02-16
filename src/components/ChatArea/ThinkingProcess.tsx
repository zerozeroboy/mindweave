import { useState, useEffect, useRef } from 'react';
import { CaretRightOutlined, CaretDownOutlined, LoadingOutlined, CheckCircleOutlined, FileSearchOutlined, EditOutlined, CodeOutlined, ToolOutlined } from '@ant-design/icons';
import { theme } from 'antd';
import { motion, AnimatePresence } from 'framer-motion';
import { ThinkingEvent } from '../../types';

interface ThinkingProcessProps {
  events: ThinkingEvent[];
  status?: 'active' | 'completed';
}

// Helper to determine icon based on tool name
const getToolIcon = (toolName: string) => {
  const lower = toolName.toLowerCase();
  if (lower.includes('read') || lower.includes('search') || lower.includes('glob') || lower.includes('ls')) return <FileSearchOutlined />;
  if (lower.includes('write') || lower.includes('edit') || lower.includes('replace') || lower.includes('delete')) return <EditOutlined />;
  if (lower.includes('command') || lower.includes('run')) return <CodeOutlined />;
  return <ToolOutlined />;
};

export default function ThinkingProcess({ events, status = 'active' }: ThinkingProcessProps) {
  const { token } = theme.useToken();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-collapse when completed
  useEffect(() => {
    if (status === 'completed') {
      setIsCollapsed(true);
    } else {
      setIsCollapsed(false);
    }
  }, [status]);

  // Auto-scroll to bottom when active and expanded
  useEffect(() => {
    if (status === 'active' && !isCollapsed && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events, status, isCollapsed]);

  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  if (!events || events.length === 0) return null;

  return (
    <div 
      className="thinking-process-container"
      style={{
        border: `1px solid ${status === 'active' ? token.colorPrimaryBorder : 'rgba(0,0,0,0.06)'}`,
        borderRadius: 8,
        backgroundColor: status === 'active' ? 'rgba(24, 144, 255, 0.02)' : 'transparent',
        marginBottom: 16,
        overflow: 'hidden',
        transition: 'all 0.3s',
      }}
    >
      {/* Header */}
      <div 
        onClick={toggleCollapse}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '8px 12px',
          cursor: 'pointer',
          userSelect: 'none',
          backgroundColor: status === 'active' ? 'rgba(24, 144, 255, 0.05)' : 'rgba(0,0,0,0.02)',
          borderBottom: isCollapsed ? 'none' : `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <div style={{ marginRight: 8, display: 'flex', alignItems: 'center', color: token.colorTextSecondary }}>
           {isCollapsed ? <CaretRightOutlined style={{ fontSize: 12 }} /> : <CaretDownOutlined style={{ fontSize: 12 }} />}
        </div>
        
        <div style={{ flex: 1, fontWeight: 600, fontSize: '13px', color: token.colorText, fontFamily: 'var(--mw-font-ui)' }}>
          {status === 'active' ? 'Thinking Process...' : 'Thinking Process'}
        </div>

        <div style={{ color: token.colorTextSecondary, fontSize: '12px', display: 'flex', alignItems: 'center' }}>
          {status === 'active' ? (
            <LoadingOutlined spin style={{ color: token.colorPrimary }} />
          ) : (
            <span style={{ fontSize: 12, opacity: 0.8 }}>{events.length} steps</span>
          )}
        </div>
      </div>

      {/* Body */}
      <AnimatePresence initial={false}>
        {!isCollapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div 
              ref={scrollRef}
              style={{ 
                padding: '12px',
                maxHeight: '300px', // Limit height for long thoughts
                overflowY: 'auto',
                fontSize: '13px',
                lineHeight: 1.6,
                color: token.colorTextSecondary,
                fontFamily: 'var(--mw-font-ui)',
              }}
            >
              {events.map((event, index) => {
                if (event.type === 'thought') {
                  return (
                    <div key={event.id || index} style={{ marginBottom: 12, paddingLeft: 12, borderLeft: '2px solid #e5e7eb' }}>
                      {event.content.split('\n').map((line, i) => (
                        <div key={i} style={{ minHeight: '1.2em' }}>{line}</div>
                      ))}
                    </div>
                  );
                }

                // If we changed the type to be consolidated:
                if (event.type === 'tool') {
                   return (
                     <div key={event.id || index} style={{ marginBottom: 8, display: 'flex', flexDirection: 'column' }}>
                        <div style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          padding: '6px 8px', 
                          borderRadius: 6, 
                          background: 'rgba(0,0,0,0.03)',
                          border: '1px solid rgba(0,0,0,0.05)'
                        }}>
                          <span style={{ marginRight: 8, display: 'flex', color: token.colorTextSecondary }}>
                            {getToolIcon(event.toolName || 'tool')}
                          </span>
                          <span style={{ fontWeight: 600, color: token.colorText, marginRight: 8 }}>
                            {event.toolName}
                          </span>
                          {event.toolStatus && (
                            <span style={{ 
                              fontSize: 11, 
                              padding: '1px 6px', 
                              borderRadius: 4, 
                              background: event.toolStatus === 'success' ? '#f6ffed' : '#fff1f0',
                              border: `1px solid ${event.toolStatus === 'success' ? '#b7eb8f' : '#ffa39e'}`,
                              color: event.toolStatus === 'success' ? '#52c41a' : '#f5222d'
                            }}>
                              {event.toolStatus}
                            </span>
                          )}
                        </div>
                        {/* Details/Preview */}
                        {(event.toolDetails || event.toolPreview) && (
                          <div style={{ paddingLeft: 28, marginTop: 4, fontSize: 12 }}>
                             {event.toolDetails && event.toolDetails.map((d, i) => (
                               <div key={i} style={{ opacity: 0.8 }}>- {d}</div>
                             ))}
                             {event.toolPreview && (
                               <pre style={{ 
                                 marginTop: 4, 
                                 padding: 8, 
                                 background: '#f8fafc', 
                                 border: '1px solid #e2e8f0', 
                                 borderRadius: 4,
                                 overflowX: 'auto',
                                 fontFamily: 'monospace'
                               }}>
                                 {event.toolPreview}
                               </pre>
                             )}
                          </div>
                        )}
                     </div>
                   );
                }
                return null;
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
