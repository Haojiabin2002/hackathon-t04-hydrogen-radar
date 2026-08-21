import { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlarmClock,
  Blocks,
  BookOpenText,
  Brain,
  BriefcaseBusiness,
  ChevronDown,
  CircleDot,
  DatabaseZap,
  Globe2,
  Menu,
  Radar,
  RadioTower,
  Settings2,
  Sparkles,
  X,
} from 'lucide-react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { apiGet, apiMutation } from '../api/client';

type Stats = {
  version: string;
  signals: number;
  leads: number;
  pending: number;
  high: number;
  cards: number;
};

type CollectResult = {
  crawler_added?: number;
  source_errors?: string[];
  pipeline?: string;
  crawler_error?: string;
};

type CollectStatus = {
  running: boolean;
  last_at?: string | null;
  next_at?: string | null;
  last_error?: string | null;
  last_result?: CollectResult | null;
  schedule_enabled: boolean;
  run_hours: number[];
};

const workItems = [
  { to: '/', label: '当日研判', icon: Radar, end: true },
  { to: '/opportunities', label: '商机队列', icon: BriefcaseBusiness },
  { to: '/signals', label: '信号证据', icon: RadioTower },
  { to: '/assistant', label: '研判助手', icon: Sparkles },
];

const utilityGroups = [
  {
    id: 'intelligence',
    label: '情报配置',
    icon: DatabaseZap,
    items: [
      { to: '/sources', label: '数据源', description: '检查海外信源覆盖与状态', icon: Globe2 },
      { to: '/knowledge', label: '知识库', description: '维护产品、区域与评分依据', icon: BookOpenText },
      { to: '/skills', label: '能力技能', description: '配置数据处理与分析能力', icon: Blocks },
    ],
  },
  {
    id: 'settings',
    label: '系统运行',
    icon: Settings2,
    items: [
      { to: '/automation', label: '自动任务', description: '安排采集与研判周期', icon: AlarmClock },
      { to: '/settings/memory', label: '销售记忆', description: '管理可复用的跟进上下文', icon: Brain },
      { to: '/settings/models', label: '模型通道', description: '查看大模型链路与可用性', icon: Settings2 },
    ],
  },
];

function formatTime(value?: string | null) {
  if (!value) return '暂无记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function RunPanel({ status, onClose }: { status?: CollectStatus; onClose: () => void }) {
  const result = status?.last_result;
  const outcome = status?.last_error
    ? '上次运行失败'
    : result?.crawler_error
      ? '采集进程异常'
      : result?.source_errors?.length
        ? '部分数据源未成功'
        : result?.pipeline?.startsWith('blocked')
          ? '采集完成，研判受阻'
          : result
            ? '上次运行已完成'
            : '尚无运行结果';

  return (
    <aside className="run-panel" aria-label="雷达运行详情">
      <div className="run-panel-head">
        <div>
          <span className="command-run-label">采集链路</span>
          <h2>{status?.running ? '雷达正在采集真实信号' : outcome}</h2>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭运行详情"><X size={18} aria-hidden="true" /></button>
      </div>
      {status?.running && (
        <div className="run-live" role="status">
          <span className="run-live-track"><i /></span>
          <p>正在等待后端返回真实结果。当前接口未提供阶段进度，因此不显示虚假百分比。</p>
        </div>
      )}
      <dl className="run-facts">
        <div><dt>上次运行</dt><dd>{formatTime(status?.last_at)}</dd></div>
        <div><dt>下次计划</dt><dd>{status?.schedule_enabled ? formatTime(status?.next_at) : '自动任务未启用'}</dd></div>
        <div><dt>新增信号</dt><dd>{result?.crawler_added ?? '—'}</dd></div>
        <div><dt>异常信源</dt><dd>{result?.source_errors?.length ?? 0}</dd></div>
      </dl>
      {(status?.last_error || result?.crawler_error || result?.pipeline) && (
        <div className="run-result">
          <CircleDot size={16} aria-hidden="true" />
          <p>{status?.last_error || result?.crawler_error || result?.pipeline}</p>
        </div>
      )}
    </aside>
  );
}

export function AppShell() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const [navOpen, setNavOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [runOpen, setRunOpen] = useState(false);
  const runPanelId = useId();
  const commandBarRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  const stats = useQuery({
    queryKey: ['stats'],
    queryFn: () => apiGet<Stats>('/api/stats'),
    staleTime: 15_000,
  });
  const collectStatus = useQuery({
    queryKey: ['collect-status'],
    queryFn: () => apiGet<CollectStatus>('/api/collect/status'),
    refetchInterval: (query) => query.state.data?.running ? 2500 : 15_000,
  });
  const startCollect = useMutation({
    mutationFn: () => apiMutation<{ started: boolean; reason?: string }>('/api/collect', 'POST'),
    onSuccess: () => {
      setRunOpen(true);
      void queryClient.invalidateQueries({ queryKey: ['collect-status'] });
    },
  });

  useEffect(() => {
    setNavOpen(false);
    setMenuOpen(null);
    mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!commandBarRef.current?.contains(event.target as Node)) setMenuOpen(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(null);
        setNavOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!collectStatus.data?.running) return;
    const previous = collectStatus.data.running;
    return () => {
      if (previous) {
        void queryClient.invalidateQueries({ queryKey: ['stats'] });
        void queryClient.invalidateQueries({ queryKey: ['signals'] });
        void queryClient.invalidateQueries({ queryKey: ['leads'] });
      }
    };
  }, [collectStatus.data?.running, queryClient]);

  const isRunning = Boolean(collectStatus.data?.running);
  const result = collectStatus.data?.last_result;
  const lastError = collectStatus.data?.last_error?.trim() ?? '';
  const crawlerError = result?.crawler_error?.trim() ?? '';
  const pipelineStatus = result?.pipeline?.trim() ?? '';
  const sourceErrorCount = result?.source_errors?.length ?? 0;
  const pipelineBlocked = /blocked|阻塞|模型|通道|llm/i.test(pipelineStatus)
    || /\brc=(?!0\b)-?\d+\b/i.test(pipelineStatus);
  const chainBlocked = collectStatus.isError || Boolean(lastError || crawlerError) || pipelineBlocked;
  const chainFailed = !isRunning && (chainBlocked || sourceErrorCount > 0);
  const chainHeadline = isRunning
    ? '雷达运行中'
    : collectStatus.isError
      ? '链路状态不可用'
      : lastError
        ? '采集链路失败'
        : crawlerError
          ? '采集链路阻断'
          : pipelineBlocked
            ? '研判链路阻断'
            : sourceErrorCount > 0
              ? '部分来源异常'
              : `${stats.data?.signals ?? '—'} 条信号`;
  const chainDetail = isRunning
    ? '正在等待真实结果'
    : collectStatus.isError
      ? collectStatus.error instanceof Error ? collectStatus.error.message : '无法读取采集状态'
      : lastError
        ? lastError
        : crawlerError
          ? `采集异常：${crawlerError}`
          : pipelineBlocked
            ? pipelineStatus
            : sourceErrorCount > 0
              ? `${sourceErrorCount} 个数据源采集失败`
              : `上次 ${formatTime(collectStatus.data?.last_at)}`;

  return (
    <div className="app-shell app-shell-command">
      <a className="command-skip-link" href="#command-main-content">跳到主要内容</a>
      <header className="command-bar" ref={commandBarRef}>
        <div className="command-bar-inner">
          <button
            type="button"
            className="command-mobile-toggle"
            onClick={() => setNavOpen((value) => !value)}
            aria-label={navOpen ? '关闭导航' : '打开导航'}
            aria-expanded={navOpen}
            aria-controls="mobile-command-nav"
          >
            {navOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>

          <NavLink className="command-brand" to="/" aria-label="氢能商机雷达首页">
            <span className="command-brand-mark"><span>H</span><sub>2</sub></span>
            <span className="command-brand-copy">
              <strong>氢能商机雷达</strong>
              <small>出口商情终端 · v{stats.data?.version ?? '0.4.0'}</small>
            </span>
          </NavLink>

          <nav className="command-primary-nav" aria-label="核心工作导航">
            {workItems.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) => `command-nav-link ${isActive ? 'is-active' : ''}`}
              >
                <Icon size={16} strokeWidth={1.9} aria-hidden="true" />
                <span>{label}</span>
              </NavLink>
            ))}

            {utilityGroups.map((group) => {
              const GroupIcon = group.icon;
              const groupActive = group.items.some(({ to }) => location.pathname === to || location.pathname.startsWith(`${to}/`));
              const open = menuOpen === group.id;
              const menuId = `command-menu-${group.id}`;
              return (
                <div className={`command-nav-menu ${open ? 'is-open' : ''}`} key={group.id}>
                  <button
                    type="button"
                    className={`command-menu-trigger ${groupActive ? 'is-active' : ''}`}
                    onClick={() => setMenuOpen((value) => value === group.id ? null : group.id)}
                    aria-expanded={open}
                    aria-controls={menuId}
                  >
                    <GroupIcon size={16} strokeWidth={1.9} aria-hidden="true" />
                    <span>{group.label}</span>
                    <ChevronDown size={14} aria-hidden="true" />
                  </button>
                  {open && (
                    <div className="command-menu-popover" id={menuId} role="menu">
                      {group.items.map(({ to, label, description, icon: Icon }) => (
                        <NavLink
                          key={to}
                          to={to}
                          role="menuitem"
                          onClick={() => setMenuOpen(null)}
                          className={({ isActive }) => `command-menu-link ${isActive ? 'is-active' : ''}`}
                        >
                          <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
                          <span className="command-menu-link-copy">
                            <strong>{label}</strong>
                            <small>{description}</small>
                          </span>
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>

          <div className="command-actions">
            <button
              type="button"
              className="command-status"
              aria-controls={runPanelId}
              aria-expanded={runOpen}
              aria-label={`${chainHeadline}，打开采集链路详情`}
              onClick={() => setRunOpen((value) => !value)}
            >
              <span className={`command-status-icon ${isRunning ? 'is-running' : ''} ${chainFailed ? 'is-error' : ''}`}>
                <Activity size={15} aria-hidden="true" />
              </span>
              <span className="command-status-copy" aria-live="polite">
                <b>{chainHeadline}</b>
                <small>{chainDetail}</small>
              </span>
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`command-collect-button ${isRunning ? 'is-running' : ''}`}
              disabled={isRunning || startCollect.isPending}
              onClick={() => startCollect.mutate()}
            >
              <RadioTower size={16} aria-hidden="true" />
              <span>{startCollect.isPending ? '正在启动' : isRunning ? '运行中' : '启动雷达'}</span>
            </button>
          </div>
        </div>

        <nav
          id="mobile-command-nav"
          className={`command-mobile-nav ${navOpen ? 'is-open' : ''}`}
          aria-label="移动端主导航"
          aria-hidden={!navOpen}
        >
          <div className="command-mobile-nav-head">
            <span>出口商情终端</span>
            <span className="command-mobile-version">RADAR / v{stats.data?.version ?? '0.4.0'}</span>
          </div>
          <div className="command-mobile-groups">
            <div className="command-mobile-group">
              <p>销售工作</p>
              {workItems.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  tabIndex={navOpen ? 0 : -1}
                  onClick={() => setNavOpen(false)}
                  className={({ isActive }) => `command-mobile-link ${isActive ? 'is-active' : ''}`}
                >
                  <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
                  <span>{label}</span>
                </NavLink>
              ))}
            </div>
            {utilityGroups.map((group) => (
              <div className="command-mobile-group" key={group.id}>
                <p>{group.label}</p>
                {group.items.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    tabIndex={navOpen ? 0 : -1}
                    onClick={() => setNavOpen(false)}
                    className={({ isActive }) => `command-mobile-link ${isActive ? 'is-active' : ''}`}
                  >
                    <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
                    <span>{label}</span>
                  </NavLink>
                ))}
              </div>
            ))}
          </div>
          <div className="command-mobile-foot">
            <button
              type="button"
              className="command-mobile-status"
              onClick={() => {
                setRunOpen(true);
                setNavOpen(false);
              }}
              aria-controls={runPanelId}
            >
              <span className={`command-local-state ${chainFailed ? 'is-error' : ''}`}><i /><b>{chainHeadline}</b></span>
              <small>真实数据 · 查看链路</small>
            </button>
          </div>
        </nav>
      </header>

      {navOpen && <button type="button" className="command-nav-scrim" onClick={() => setNavOpen(false)} aria-label="关闭导航" />}

      <div className="command-workspace">

        {startCollect.isError && (
          <div className="global-error" role="alert">
            启动失败：{startCollect.error instanceof Error ? startCollect.error.message : '未知错误'}
            <button type="button" onClick={() => startCollect.reset()}>关闭</button>
          </div>
        )}

        {runOpen && <div id={runPanelId}><RunPanel status={collectStatus.data} onClose={() => setRunOpen(false)} /></div>}

        <main
          id="command-main-content"
          className={`route-stage command-content ${location.pathname === '/' ? 'is-desk-route' : ''}`}
          ref={mainRef}
          tabIndex={-1}
        >
          <div className="page-transition" key={`${location.pathname}${location.search}`}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
