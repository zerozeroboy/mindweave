import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Button, Dropdown, Tooltip } from 'antd';
import {
  BorderOutlined,
  CloseOutlined,
  DownOutlined,
  FileTextFilled,
  FileTextOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MinusOutlined,
  PlusOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import styles from './WorkbenchShell.module.css';
import { LAYOUT } from '../../utils/layoutTokens';
import FilesPane from './FilesPane';

type Props = {
  leftWidth: number;
  rightWidth: number;
  treeWidth: number;
  leftHidden: boolean;
  rightHidden: boolean;
  treeHidden: boolean;
  minLeftWidth?: number;
  minCenterWidth?: number;
  minRightWidth?: number;
  minTreeWidth?: number;
  onChangeLeftWidth: (px: number) => void;
  onChangeRightWidth: (px: number) => void;
  onChangeTreeWidth: (px: number) => void;
  onChangeLeftHidden: (hidden: boolean) => void;
  onChangeRightHidden: (hidden: boolean) => void;
  onChangeTreeHidden: (hidden: boolean) => void;
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
  tree: ReactNode;
  workspaces: Workspace[];
  currentWorkspace: Workspace | null;
  onSelectWorkspace: (w: Workspace) => void;
  onOpenFolder: () => void;
  onOpenCreateWorkspace: () => void;
  onSync: () => void;
  onNewTask: () => void;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export default function WorkbenchShell({
  leftWidth,
  rightWidth,
  treeWidth,
  leftHidden,
  rightHidden,
  treeHidden,
  minLeftWidth = LAYOUT.min.left,
  minCenterWidth = LAYOUT.min.center,
  minRightWidth = LAYOUT.min.right,
  minTreeWidth = LAYOUT.min.tree,
  onChangeLeftWidth,
  onChangeRightWidth,
  onChangeTreeWidth,
  onChangeLeftHidden,
  onChangeRightHidden,
  onChangeTreeHidden,
  left,
  center,
  right,
  tree,
  workspaces,
  currentWorkspace,
  onSelectWorkspace,
  onOpenFolder,
  onOpenCreateWorkspace,
  onSync,
  onNewTask,
}: Props) {
  const TITLE_LEFT_WIDTH = 88;
  const TITLE_RIGHT_COLLAPSED_WIDTH = LAYOUT.collapsedRailWidth;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const windowDockRef = useRef<HTMLDivElement | null>(null);
  const hasElectronWindowControls = Boolean(window.electronAPI && typeof window.electronAPI.windowMinimize === 'function');
  const isElectronRuntime = typeof navigator !== 'undefined' && /electron/i.test(navigator.userAgent || '');
  const showMockWindowControls = !hasElectronWindowControls && !isElectronRuntime && import.meta.env.DEV;
  const showWindowControls = hasElectronWindowControls || isElectronRuntime || showMockWindowControls;
  const [activeSplitter, setActiveSplitter] = useState<'left' | 'right' | null>(null);
  const [windowDockWidth, setWindowDockWidth] = useState(showMockWindowControls ? 120 : 0);
  const containerWidth = useContainerWidth(rootRef);

  const leftSplitterWidth = leftHidden ? 0 : LAYOUT.splitterWidth;
  const rightSplitterWidth = rightHidden ? 0 : LAYOUT.splitterWidth;

  const effectiveLeftWidth = leftHidden ? 0 : leftWidth;
  const effectiveRightWidth = rightHidden ? 0 : rightWidth;
  const titleLeftWidth = TITLE_LEFT_WIDTH;
  const titleRightWidth = rightHidden ? TITLE_RIGHT_COLLAPSED_WIDTH : rightWidth;

  useEffect(() => {
    const fixed =
      effectiveLeftWidth +
      leftSplitterWidth +
      effectiveRightWidth +
      rightSplitterWidth;
    const maxFixed = Math.max(0, containerWidth - minCenterWidth);
    if (fixed <= maxFixed) return;

    let overflow = fixed - maxFixed;
    let nextRight = rightWidth;
    let nextLeft = leftWidth;

    if (!rightHidden) {
      const reducible = Math.max(0, nextRight - minRightWidth);
      const delta = Math.min(overflow, reducible);
      if (delta > 0) {
        nextRight -= delta;
        overflow -= delta;
      }
    }

    if (!leftHidden) {
      const reducible = Math.max(0, nextLeft - minLeftWidth);
      const delta = Math.min(overflow, reducible);
      if (delta > 0) {
        nextLeft -= delta;
        overflow -= delta;
      }
    }

    if (nextRight !== rightWidth) onChangeRightWidth(nextRight);
    if (nextLeft !== leftWidth) onChangeLeftWidth(nextLeft);
  }, [
    containerWidth,
    effectiveLeftWidth,
    effectiveRightWidth,
    leftHidden,
    leftWidth,
    minCenterWidth,
    minLeftWidth,
    minRightWidth,
    onChangeLeftWidth,
    onChangeRightWidth,
    rightHidden,
    rightWidth,
    treeHidden,
    treeWidth,
  ]);

  const beginDrag = (which: 'left' | 'right') => (e: React.PointerEvent) => {
    const el = rootRef.current;
    if (!el) return;
    if (which === 'left' && leftHidden) return;
    if (which === 'right' && rightHidden) return;
    setActiveSplitter(which);
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);

    const startX = e.clientX;
    const startLeft = leftWidth;
    const startRight = rightWidth;
    let rafId = 0;
    let latestX = startX;

    const tick = () => {
      rafId = 0;
      const dx = latestX - startX;
      const total = containerWidth;
      const fixedSplitters = leftSplitterWidth + rightSplitterWidth;
      const visibleLeft = leftHidden ? 0 : startLeft;
      const visibleRight = rightHidden ? 0 : startRight;

      if (which === 'left') {
        const maxLeft = total - minCenterWidth - visibleRight - fixedSplitters;
        const next = clamp(startLeft + dx, minLeftWidth, Math.max(minLeftWidth, maxLeft));
        onChangeLeftWidth(next);
      }

      if (which === 'right') {
        const maxRight = total - minCenterWidth - visibleLeft - fixedSplitters;
        const next = clamp(startRight - dx, minRightWidth, Math.max(minRightWidth, maxRight));
        onChangeRightWidth(next);
      }
    };

    const onMove = (ev: PointerEvent) => {
      latestX = ev.clientX;
      if (!rafId) rafId = window.requestAnimationFrame(tick);
    };

    const end = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', end);
      if (rafId) window.cancelAnimationFrame(rafId);
      setActiveSplitter(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', end);
  };

  const noDrag = { WebkitAppRegion: 'no-drag' } as any;

  useEffect(() => {
    if (!showWindowControls) return;
    const el = windowDockRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const next = Math.max(0, el.getBoundingClientRect().width);
      setWindowDockWidth(next);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [showWindowControls]);

  const workspaceMenuItems = useMemo(() => {
    const workspaceItems = workspaces.map((w) => ({
      key: w.name,
      label: w.name,
      onClick: () => onSelectWorkspace(w),
    }));
    const opsItems = [
      {
        key: 'ops-sync',
        label: '同步',
        icon: <SyncOutlined />,
        disabled: !currentWorkspace,
        onClick: onSync,
      },
      {
        key: 'ops-openFolder',
        label: '打开文件夹',
        icon: <FolderOpenOutlined />,
        onClick: onOpenFolder,
      },
      {
        key: 'ops-createWorkspace',
        label: '新建工作区…',
        icon: <PlusOutlined />,
        onClick: onOpenCreateWorkspace,
      },
      {
        key: 'ops-clone',
        label: '克隆 Git 仓库',
        disabled: true,
      },
      {
        key: 'ops-remote',
        label: '连接远程主机',
        disabled: true,
      },
    ];
    if (workspaceItems.length === 0) return opsItems;
    return [
      ...workspaceItems,
      { type: 'divider' as const },
      ...opsItems,
    ];
  }, [currentWorkspace, onOpenCreateWorkspace, onOpenFolder, onSelectWorkspace, onSync, workspaces]);

  const rootVars = {
    ['--mw-left-effective' as any]: `${effectiveLeftWidth}px`,
    ['--mw-right-effective' as any]: `${effectiveRightWidth}px`,
    ['--mw-left-splitter' as any]: `${leftSplitterWidth}px`,
    ['--mw-right-splitter' as any]: `${rightSplitterWidth}px`,
    ['--mw-title-left' as any]: `${titleLeftWidth}px`,
    ['--mw-title-right' as any]: `${titleRightWidth}px`,
    ['--mw-window-dock' as any]: `${windowDockWidth}px`,
    ['--mw-left-divider-visible' as any]: leftHidden ? 0 : 1,
    ['--mw-right-divider-visible' as any]: rightHidden ? 0 : 1,
  };

  return (
    <div ref={rootRef} className={styles.root} style={rootVars as any} data-testid="workbench">
      <div className={styles.titlebar} data-testid="titlebar">
        <div
          className={`${styles.titleSegment} ${styles.titleSegmentLeft} ${leftHidden ? styles.titleSegmentLeftCollapsed : ''}`}
          data-testid="titlebar-left"
        >
          <Tooltip title="MindWeave">
            <div className={styles.logo} style={noDrag}>
              MW
            </div>
          </Tooltip>

          <Tooltip title={leftHidden ? '展开任务栏' : '隐藏任务栏'}>
            <Button
              size="small"
              type="text"
              icon={leftHidden ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => onChangeLeftHidden(!leftHidden)}
              style={noDrag}
            />
          </Tooltip>
        </div>

        <div className={`${styles.titleSegment} ${styles.titleSegmentCenter}`} data-testid="titlebar-center">
          <div className={styles.titleSegmentCenterLeft}>
            <Dropdown menu={{ items: workspaceMenuItems as any }} trigger={['click']} placement="bottomLeft">
              <Button size="small" type="text" className={styles.workspaceButton} style={noDrag}>
                <span className={styles.ellipsis}>{currentWorkspace?.name ?? '选择空间'}</span>
                <DownOutlined className={styles.caret} />
              </Button>
            </Dropdown>
          </div>

          <Tooltip title="新建任务">
            <Button size="small" type="text" icon={<PlusOutlined />} onClick={onNewTask} style={noDrag} />
          </Tooltip>
        </div>

        <div
          className={`${styles.titleSegment} ${styles.titleSegmentRight} ${rightHidden ? styles.titleSegmentRightCollapsed : ''}`}
          data-testid="titlebar-right"
        >
          <Tooltip title={rightHidden ? '展开文件栏' : '收起文件栏'}>
            <Button
              size="small"
              type="text"
              icon={rightHidden ? <FileTextOutlined /> : <FileTextFilled />}
              onClick={() => onChangeRightHidden(!rightHidden)}
              style={noDrag}
            />
          </Tooltip>

          {!rightHidden ? (
            <Tooltip title={treeHidden ? '展开文件树' : '收起文件树'}>
              <Button
                size="small"
                type="text"
                icon={<FolderOutlined />}
                onClick={() => onChangeTreeHidden(!treeHidden)}
                style={noDrag}
              />
            </Tooltip>
          ) : null}

        </div>

        {showWindowControls ? (
          <div ref={windowDockRef} className={styles.windowDock} data-testid="titlebar-window">
            <div className={styles.windowControls} data-testid="titlebar-window-controls">
              <Tooltip title="最小化">
                <Button
                  size="small"
                  type="text"
                  icon={<MinusOutlined />}
                  onClick={hasElectronWindowControls ? () => window.electronAPI?.windowMinimize() : undefined}
                  disabled={!hasElectronWindowControls}
                  style={noDrag}
                />
              </Tooltip>
              <Tooltip title="最大化/还原">
                <Button
                  size="small"
                  type="text"
                  icon={<BorderOutlined />}
                  onClick={hasElectronWindowControls ? () => window.electronAPI?.windowToggleMaximize() : undefined}
                  disabled={!hasElectronWindowControls}
                  style={noDrag}
                />
              </Tooltip>
              <Tooltip title="关闭">
                <Button
                  size="small"
                  type="text"
                  danger
                  icon={<CloseOutlined />}
                  onClick={hasElectronWindowControls ? () => window.electronAPI?.windowClose() : undefined}
                  disabled={!hasElectronWindowControls}
                  style={noDrag}
                />
              </Tooltip>
            </div>
          </div>
        ) : null}
      </div>

      <div className={styles.bodyGrid}>
        <div className={`${styles.cell} ${styles.bodyCell} ${styles.panelCell}`} data-testid="wb-panel-left">
          {!leftHidden ? <div className={styles.panelInner} style={{ width: leftWidth }}>{left}</div> : null}
        </div>

        <div
          className={`${styles.cell} ${styles.splitter} ${leftHidden ? styles.splitterDisabled : ''} ${activeSplitter === 'left' ? styles.splitterActive : ''}`}
          onPointerDown={beginDrag('left')}
          role="separator"
          aria-orientation="vertical"
          aria-label="调整左侧宽度"
          data-testid="wb-splitter-left"
          style={{ position: 'relative', pointerEvents: leftHidden ? 'none' : 'auto' } as any}
        />

        <div className={`${styles.cell} ${styles.bodyCell} ${styles.centerCell}`} data-testid="wb-center">
          {center}
        </div>

        <div
          className={`${styles.cell} ${styles.splitter} ${rightHidden ? styles.splitterDisabled : ''} ${activeSplitter === 'right' ? styles.splitterActive : ''}`}
          onPointerDown={beginDrag('right')}
          role="separator"
          aria-orientation="vertical"
          aria-label="调整右侧宽度"
          data-testid="wb-splitter-right"
          style={{ position: 'relative', pointerEvents: rightHidden ? 'none' : 'auto' } as any}
        />

        <div className={`${styles.cell} ${styles.bodyCell} ${styles.panelCell}`} data-testid="wb-panel-right">
          {!rightHidden ? (
            <FilesPane
              preview={right}
              tree={tree}
              treeWidth={treeWidth}
              treeHidden={treeHidden}
              onChangeTreeWidth={onChangeTreeWidth}
              onChangeTreeHidden={onChangeTreeHidden}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function useContainerWidth(ref: RefObject<HTMLElement>) {
  const [w, setW] = useState(1200);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const next = Math.max(0, el.getBoundingClientRect().width);
      setW(next);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  return w;
}
