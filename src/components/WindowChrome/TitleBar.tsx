import { useEffect, useState } from 'react';
import { BorderOutlined, CloseOutlined, MinusOutlined, SwitcherOutlined } from '@ant-design/icons';
import mwLogo from '../../assets/mw-logo.svg';
import styles from './TitleBar.module.css';

function getElectronApi() {
  if (typeof window === 'undefined') return undefined;
  return window.electronAPI;
}

export default function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const electronApi = getElectronApi();

  useEffect(() => {
    let disposed = false;
    const syncState = async () => {
      if (!electronApi) return;
      try {
        const current = await electronApi.isWindowMaximized();
        if (!disposed) setIsMaximized(current);
      } catch (_error) {
        // Ignore desktop bridge errors in non-electron contexts.
      }
    };
    syncState();
    const cleanup = electronApi?.onWindowMaximizedChanged((maximized) => {
      setIsMaximized(maximized);
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [electronApi]);

  const handleMinimize = async () => {
    await electronApi?.minimizeWindow();
  };

  const handleToggleMaximize = async () => {
    if (!electronApi) return;
    const next = await electronApi.toggleMaximizeWindow();
    setIsMaximized(next);
  };

  const handleClose = async () => {
    await electronApi?.closeWindow();
  };

  return (
    <header className={styles.titleBar}>
      <div className={styles.brand}>
        <img src={mwLogo} alt="MindWeave Logo" className={styles.logo} />
        <span>MindWeave</span>
      </div>
      <div className={styles.spacer} />
      <div className={styles.windowControls}>
        <button
          type="button"
          className={styles.windowControlBtn}
          onClick={handleMinimize}
          aria-label="最小化窗口"
        >
          <MinusOutlined className={styles.windowControlIcon} />
        </button>
        <button
          type="button"
          className={styles.windowControlBtn}
          onClick={handleToggleMaximize}
          aria-label={isMaximized ? '还原窗口' : '最大化窗口'}
        >
          {isMaximized ? (
            <SwitcherOutlined className={styles.windowControlIcon} />
          ) : (
            <BorderOutlined className={styles.windowControlIcon} />
          )}
        </button>
        <button
          type="button"
          className={`${styles.windowControlBtn} ${styles.windowControlBtnClose}`}
          onClick={handleClose}
          aria-label="关闭窗口"
        >
          <CloseOutlined className={styles.windowControlIcon} />
        </button>
      </div>
    </header>
  );
}
