import { Button, Tooltip } from 'antd';
import { CloseOutlined, ExportOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface FilePreviewPanelProps {
  width: number;
  filePreview: MirrorReadFileResult | null;
  setFilePreview: (val: MirrorReadFileResult | null) => void;
  onOpenOriginal?: (mirrorPath: string) => void;
}

export default function FilePreviewPanel({ width, filePreview, setFilePreview, onOpenOriginal }: FilePreviewPanelProps) {
  if (!filePreview) return null;

  const isMarkdown = filePreview.path.toLowerCase().endsWith('.md');
  const lowerPath = filePreview.path.toLowerCase();
  const isImage = (typeof filePreview.mime === 'string' && filePreview.mime.startsWith('image/')) || /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(lowerPath);
  const isVideo = (typeof filePreview.mime === 'string' && filePreview.mime.startsWith('video/')) || /\.(mp4|webm|mov|mkv|avi)$/i.test(lowerPath);
  const content = filePreview.truncated ? `${filePreview.content}\n\n*(Content truncated)*` : filePreview.content;
  const filename = filePreview.path.split(/[\\/]/).pop() || filePreview.path;

  return (
    <div
      style={{
        width,
        minWidth: '300px',
        borderLeft: '1px solid #e5e7eb',
        display: 'flex',
        flexDirection: 'column',
        background: '#fff',
        height: '100%',
        flexShrink: 0,
        boxShadow: '-2px 0 8px rgba(0,0,0,0.05)'
      }}
    >
      <div
        className="mw-file-preview-header"
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          alignItems: 'center',
          background: '#f9fafb',
          flexShrink: 0,
          position: 'relative'
        }}
      >
        <div
          className="mw-file-preview-header-meta"
          style={{
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            minWidth: 0,
            paddingRight: 84
          }}
        >
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: '#1f2937',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
            title={filename}
          >
            {filename}
          </span>
          <span
            style={{
              fontSize: 11,
              color: '#6b7280',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
            title={filePreview.path}
          >
            {filePreview.path}
          </span>
        </div>
        <div className="mw-file-preview-actions">
          {onOpenOriginal && (
            <Tooltip title="Open original file">
              <Button
                size="small"
                type="text"
                onClick={() => onOpenOriginal(filePreview.path)}
                icon={<ExportOutlined />}
                className="mw-file-preview-open-btn"
                aria-label="Open original file"
              />
            </Tooltip>
          )}
          <Tooltip title="Close preview">
            <Button
              size="small"
              type="text"
              onClick={() => setFilePreview(null)}
              icon={<CloseOutlined />}
              aria-label="Close preview"
              className="mw-file-preview-close-btn"
            />
          </Tooltip>
        </div>
      </div>

      <div className="mw-file-preview-content" style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
        {isImage && filePreview.encoding === 'base64' && filePreview.mime ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filePreview.truncated ? <div style={{ fontSize: 12, color: '#b45309' }}>Image content was truncated. Consider raising the read limit.</div> : null}
            <img
              src={`data:${filePreview.mime};base64,${filePreview.content}`}
              alt={filename}
              style={{ maxWidth: '100%', height: 'auto', borderRadius: 6, border: '1px solid #e5e7eb' }}
            />
          </div>
        ) : isVideo && filePreview.encoding === 'base64' && filePreview.mime ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filePreview.truncated ? <div style={{ fontSize: 12, color: '#b45309' }}>Video content was truncated. Consider raising the read limit.</div> : null}
            <video controls style={{ width: '100%', maxHeight: '70vh', borderRadius: 6, border: '1px solid #e5e7eb' }}>
              <source src={`data:${filePreview.mime};base64,${filePreview.content}`} type={filePreview.mime} />
              Your browser does not support the video tag.
            </video>
          </div>
        ) : isMarkdown ? (
          <div className="mw-markdown mw-file-preview-markdown max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        ) : (
          <pre
            style={{
              fontSize: 13,
              margin: 0,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              overflowWrap: 'anywhere',
              color: '#374151',
              lineHeight: 1.6
            }}
          >
            {content}
          </pre>
        )}
      </div>
    </div>
  );
}
