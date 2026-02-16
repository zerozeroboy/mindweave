import { Button } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface FilePreviewPanelProps {
  filePreview: MirrorReadFileResult | null;
  setFilePreview: (val: MirrorReadFileResult | null) => void;
}

export default function FilePreviewPanel({ filePreview, setFilePreview }: FilePreviewPanelProps) {
  if (!filePreview) return null;

  const isMarkdown = filePreview.path.toLowerCase().endsWith('.md');
  const content = filePreview.truncated ? filePreview.content + "\n\n*(Content truncated)*" : filePreview.content;

  // Extract filename from path
  const filename = filePreview.path.split(/[\\/]/).pop() || filePreview.path;

  return (
    <div style={{ 
      width: '45%', 
      minWidth: '300px',
      maxWidth: '800px',
      borderLeft: '1px solid #e5e7eb', 
      display: 'flex', 
      flexDirection: 'column',
      background: '#fff',
      height: '100%',
      flexShrink: 0,
      boxShadow: '-2px 0 8px rgba(0,0,0,0.05)',
      zIndex: 10
    }}>
      {/* Header */}
      <div style={{ 
        padding: '12px 16px', 
        borderBottom: '1px solid #e5e7eb', 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        background: '#f9fafb',
        flexShrink: 0
      }}>
        <div style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <span style={{ 
            fontSize: 14, 
            fontWeight: 600, 
            color: '#1f2937', 
            overflow: 'hidden', 
            textOverflow: 'ellipsis', 
            whiteSpace: 'nowrap'
          }} title={filename}>
            {filename}
          </span>
          <span style={{ 
            fontSize: 11, 
            color: '#6b7280', 
            overflow: 'hidden', 
            textOverflow: 'ellipsis', 
            whiteSpace: 'nowrap'
          }} title={filePreview.path}>
            {filePreview.path}
          </span>
        </div>
        <Button 
          size="small" 
          type="text" 
          onClick={() => setFilePreview(null)} 
          icon={<CloseOutlined />} 
          style={{ color: '#6b7280', marginLeft: 8 }}
        />
      </div>
      
      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
        {isMarkdown ? (
          <div className="prose prose-sm max-w-none" style={{ fontFamily: 'var(--mw-font-ui)' }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {content}
            </ReactMarkdown>
          </div>
        ) : (
          <pre style={{ 
            fontSize: 13, 
            margin: 0, 
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            color: '#374151',
            lineHeight: 1.6
          }}>
            {content}
          </pre>
        )}
      </div>
    </div>
  );
}
