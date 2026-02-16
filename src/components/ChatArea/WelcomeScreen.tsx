import { Button, Input, theme } from 'antd';
import { ArrowUpOutlined, GlobalOutlined } from '@ant-design/icons';
import { useState } from 'react';
import styles from './chatUi.module.css';

interface WelcomeScreenProps {
  onSend: (message: string) => void;
  webSearchEnabled: boolean;
  onToggleWebSearch: (checked: boolean) => void;
}

export default function WelcomeScreen({ onSend, webSearchEnabled, onToggleWebSearch }: WelcomeScreenProps) {
  const { token } = theme.useToken();
  const [value, setValue] = useState('');

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (value.trim()) {
        onSend(value.trim());
      }
    }
  };

  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      alignItems: 'center', 
      justifyContent: 'center', 
      height: '100%', 
      width: '100%',
      paddingBottom: '10vh' // Visual center bias
    }}>
      <h1 style={{ 
        fontSize: 'clamp(28px, 4vw, 32px)', 
        fontWeight: 600, 
        color: token.colorTextHeading,
        marginBottom: 32,
        marginTop: 0,
        textAlign: 'center'
      }}>
        我们先从哪里开始呢？
      </h1>
      
      <div className={styles.welcomeShell}>
        <div className={styles.welcomeInputShell}>
          <Input
            size="large"
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="给 Agent 发送消息..."
            bordered={false}
            className={styles.welcomeInput}
          />

          <div className={styles.toolbox}>
            <Button
              type="text"
              shape="circle"
              icon={<GlobalOutlined />}
              onClick={() => onToggleWebSearch(!webSearchEnabled)}
              className={`${styles.toolButton} ${webSearchEnabled ? styles.toolButtonActive : ''}`}
              aria-label="联网搜索"
              aria-pressed={webSearchEnabled}
            />
          </div>

          <div className={styles.welcomeBottomRight}>
            <Button
              type="primary"
              shape="circle"
              icon={<ArrowUpOutlined style={{ fontSize: 16, fontWeight: 'bold' }} />}
              disabled={!value.trim()}
              onClick={() => value.trim() && onSend(value.trim())}
              className={styles.welcomeSendButton}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
