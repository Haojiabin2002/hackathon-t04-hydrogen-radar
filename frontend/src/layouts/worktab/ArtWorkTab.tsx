import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useWorktab } from '../../hooks/useWorktab';

/**
 * 多标签页 · 标签数据来自 useWorktab，标题来自路由 meta
 *
 * 结构上关闭键必须是链接的**兄弟节点**而不是子节点：
 * <button> 套在 <a> 里是非法嵌套，而且键盘用户会完全够不到它。
 */
export function ArtWorkTab() {
  const { tabs, activePath, closeTab } = useWorktab();
  const listRef = useRef<HTMLDivElement>(null);

  // 切换路由后把当前标签滚进可视区
  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>('.worktab-item.is-active');
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activePath]);

  return (
    <div className="worktab" ref={listRef} role="tablist" aria-label="已打开页面">
      {tabs.map((tab) => (
        <span
          key={tab.path}
          className={`worktab-item ${tab.path === activePath ? 'is-active' : ''} ${tab.fixed ? 'is-fixed' : ''}`}
        >
          <NavLink
            to={tab.path}
            end={tab.path === '/'}
            role="tab"
            aria-selected={tab.path === activePath}
            className="worktab-link"
          >
            {tab.title}
          </NavLink>
          {!tab.fixed && (
            <button
              type="button"
              className="worktab-close"
              aria-label={`关闭 ${tab.title}`}
              onClick={() => closeTab(tab.path)}
            >
              <X size={11} aria-hidden="true" />
            </button>
          )}
        </span>
      ))}
    </div>
  );
}
