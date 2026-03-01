import { ArrowUpOutlined, GlobalOutlined, BorderOutlined } from '@ant-design/icons';
import { Button, Input } from 'antd';
import styles from './chatUi.module.css';

interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (message: string) => void;
  onStop?: () => void;
  disabled?: boolean;
  loading?: boolean;
  webSearchEnabled: boolean;
  onToggleWebSearch: (checked: boolean) => void;
  autoFocus?: boolean;
}

export default function ChatComposer({
  value,
  onChange,
  onSubmit,
  onStop,
  disabled = false,
  loading = false,
  webSearchEnabled,
  onToggleWebSearch,
  autoFocus = false,
}: ChatComposerProps) {
  const trimmed = value.trim();
  const submitDisabled = disabled || loading || !trimmed;

  const handleSubmit = () => {
    if (submitDisabled) return;
    onSubmit(trimmed);
  };

  return (
    <div className={styles.composerRoot}>
      <Input.TextArea
        size="large"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
          }
        }}
        placeholder="给 Agent 发送消息..."
        bordered={false}
        autoSize={{ minRows: 1, maxRows: 6 }}
        className={styles.composerInput}
        style={{ resize: 'none' }}
        autoFocus={autoFocus}
        disabled={loading && !onStop} // 避免在没有提供 onStop 的情况下锁死
      />

      <div className={styles.composerActions}>
        <Button
          type="text"
          shape="circle"
          icon={<GlobalOutlined />}
          onClick={() => onToggleWebSearch(!webSearchEnabled)}
          disabled={disabled}
          className={`${styles.toolButton} ${webSearchEnabled ? styles.toolButtonActive : ''}`}
          aria-label="联网搜索"
          aria-pressed={webSearchEnabled}
        />

        {loading ? (
          <Button
            type="primary"
            shape="circle"
            icon={<BorderOutlined style={{ fontSize: 14, fontWeight: 'bold' }} />}
            onClick={onStop}
            className={styles.sendButton}
            aria-label="停止生成"
            danger
          />
        ) : (
          <Button
            type="primary"
            shape="circle"
            icon={<ArrowUpOutlined style={{ fontSize: 16, fontWeight: 'bold' }} />}
            disabled={submitDisabled}
            onClick={handleSubmit}
            className={styles.sendButton}
            aria-label="发送消息"
          />
        )}
      </div>
    </div>
  );
}
