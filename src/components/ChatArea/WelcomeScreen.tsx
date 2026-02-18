import { theme } from 'antd';
import styles from './chatUi.module.css';
import ChatComposer from './ChatComposer';

interface WelcomeScreenProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (message: string) => void;
  disabled?: boolean;
  loading?: boolean;
  webSearchEnabled: boolean;
  onToggleWebSearch: (checked: boolean) => void;
}

export default function WelcomeScreen({
  value,
  onChange,
  onSend,
  disabled = false,
  loading = false,
  webSearchEnabled,
  onToggleWebSearch
}: WelcomeScreenProps) {
  const { token } = theme.useToken();

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
          <ChatComposer
            value={value}
            onChange={onChange}
            onSubmit={onSend}
            disabled={disabled}
            loading={loading}
            webSearchEnabled={webSearchEnabled}
            onToggleWebSearch={onToggleWebSearch}
            autoFocus
          />
        </div>
      </div>
    </div>
  );
}
