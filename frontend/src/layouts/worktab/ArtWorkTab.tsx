import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useWorktab } from '../../hooks/useWorktab';

/** 多标签页 · 标签数据来自 useWorktab，标题来自路由 meta */
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
        <NavLink
          key={tab.path}
          to={tab.path}
          end={tab.path === '/'}
          role="tab"
          aria-selected={tab.path === activePath}
          className={({ isActive }) => `worktab-item ${isActive ? 'is-active' : ''} ${tab.fixed ? 'is-fixed' : ''}`}
        >
          <span>{tab.title}</span>
          {!tab.fixed && (
            <span
              className="worktab-close"
              role="button"
              tabIndex={-1}
              aria-label={`关闭 ${tab.title}`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                closeTab(tab.path);
              }}
            >
              <X size={11} aria-hidden="true" />
            </span>
          )}
        </NavLink>
      ))}
    </div>
  );
}
