import { useEffect, useId, useState } from 'react';
import { Activity, ChevronDown, Menu, Moon, RadioTower, Settings, Sun } from 'lucide-react';
import { ArtBreadcrumb } from '../../components/layouts/ArtBreadcrumb';
import { useCollectStatus } from '../../hooks/useCollectStatus';
import { useSettings } from '../../hooks/useSettings';
import { RunPanel } from './RunPanel';

/**
 * 顶栏 · 面包屑 + 采集链路状态 + 启动雷达 + 明暗切换 + 设置入口
 * 「启动雷达」是全局主动作，任何页面都能触发，所以留在壳里而不是页面里。
 */
export function ArtHeaderBar({
  onToggleSidebar,
  onOpenSettings,
}: {
  onToggleSidebar: () => void;
  onOpenSettings: () => void;
}) {
  const { settings, resolvedTheme, update } = useSettings();
  // 顶栏是「启动雷达」的归属地，采集结束后重取看板数据的副作用也挂在这里
  const { status, start, isRunning, chainFailed, headline, detail } = useCollectStatus({ watchCompletion: true });
  const [runOpen, setRunOpen] = useState(false);
  const runPanelId = useId();

  useEffect(() => {
    if (!runOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setRunOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [runOpen]);

  return (
    <>
      <div className="header-bar">
        <button
          type="button"
          className="art-tool-btn header-sidebar-toggle"
          onClick={onToggleSidebar}
          aria-label="切换侧栏"
        >
          <Menu size={17} aria-hidden="true" />
        </button>

        <ArtBreadcrumb />
        <div className="header-bar-spacer" />

        <div className="header-actions">
          <button
            type="button"
            className="header-status"
            aria-controls={runPanelId}
            aria-expanded={runOpen}
            aria-label={`${headline}，打开采集链路详情`}
            onClick={() => setRunOpen((value) => !value)}
          >
            <span className={`header-status-icon ${isRunning ? 'is-running' : ''} ${chainFailed ? 'is-error' : ''}`}>
              <Activity size={13} aria-hidden="true" />
            </span>
            <span className="header-status-copy" aria-live="polite">
              <b>{headline}</b>
              <small>{detail}</small>
            </span>
            <ChevronDown size={13} aria-hidden="true" />
          </button>

          <button
            type="button"
            className="art-tool-btn"
            onClick={() => update({ theme: resolvedTheme === 'dark' ? 'light' : 'dark' })}
            aria-label={resolvedTheme === 'dark' ? '切换到亮色' : '切换到暗色'}
            title={settings.theme === 'system' ? '当前跟随系统' : undefined}
          >
            {resolvedTheme === 'dark'
              ? <Sun size={17} aria-hidden="true" />
              : <Moon size={17} aria-hidden="true" />}
          </button>

          <button type="button" className="art-tool-btn" onClick={onOpenSettings} aria-label="打开界面设置">
            <Settings size={17} aria-hidden="true" />
          </button>

          <button
            type="button"
            className={`header-collect-btn ${isRunning ? 'is-running' : ''}`}
            disabled={isRunning || start.isPending}
            onClick={() => { start.mutate(); setRunOpen(true); }}
          >
            <RadioTower size={15} aria-hidden="true" />
            <span>{start.isPending ? '正在启动' : isRunning ? '运行中' : '启动雷达'}</span>
          </button>
        </div>
      </div>

      {start.isError && (
        <div className="global-error" role="alert">
          启动失败：{start.error instanceof Error ? start.error.message : '未知错误'}
          <button type="button" onClick={() => start.reset()}>关闭</button>
        </div>
      )}

      {runOpen && (
        <div id={runPanelId}>
          <RunPanel status={status.data} onClose={() => setRunOpen(false)} />
        </div>
      )}
    </>
  );
}
