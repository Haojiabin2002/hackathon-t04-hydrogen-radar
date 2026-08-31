import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, Play, Save, Sparkles, TimerReset } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  apiGet,
  apiMutation,
  CollectStartResult,
  CollectStatus,
  ScheduleConfig,
  ScheduleUpdateResult,
  WeeklyReviewStatus,
  WeeklyRunResult,
  WeeklyScheduleConfig,
  WeeklyScheduleUpdateResult,
} from '../../api';
import { ArtPageHead } from '../../components/cards/ArtPageHead';
import { useRouteMeta } from '../../hooks/useRouteMeta';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '请求未能完成';
}

function formatTime(value: string | null) {
  if (!value) return '暂无';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

function parseHours(raw: string) {
  const values = raw.split(/[，,\s]+/).filter(Boolean).map((item) => Number(item));
  if (!values.length || values.some((hour) => !Number.isInteger(hour) || hour < 0 || hour > 23)) return null;
  return Array.from(new Set(values)).sort((a, b) => a - b);
}

/** 周复盘只有一个小时位，和上面的多小时输入分开解析。 */
function parseHour(raw: string) {
  const value = Number(raw.trim());
  if (!raw.trim() || !Number.isInteger(value) || value < 0 || value > 23) return null;
  return value;
}

// ISO 口径：1=周一 … 7=周日，与后端 datetime.isoweekday 一致
const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function weekdayLabel(value: number) {
  return WEEKDAYS[value - 1] ?? `第 ${value} 天`;
}

export default function AutomationPage() {
  const meta = useRouteMeta();
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(true);
  const [hours, setHours] = useState('9, 14');
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');

  const statusQuery = useQuery({
    queryKey: ['collect-status'],
    queryFn: () => apiGet<CollectStatus>('/api/collect/status'),
    refetchInterval: (query) => query.state.data?.running ? 1500 : 10000,
  });

  useEffect(() => {
    if (statusQuery.data && !dirty) {
      setEnabled(statusQuery.data.schedule_enabled);
      setHours(statusQuery.data.run_hours.join(', '));
    }
  }, [dirty, statusQuery.data]);

  const parsedHours = useMemo(() => parseHours(hours), [hours]);

  const scheduleMutation = useMutation({
    mutationFn: (body: ScheduleConfig) => apiMutation<ScheduleUpdateResult>('/api/schedule', 'PUT', body),
    onSuccess: (result) => {
      setDirty(false);
      setEnabled(result.schedule_enabled);
      setHours(result.run_hours.join(', '));
      setMessage(`定时任务已保存，下次运行：${formatTime(result.next_at)}`);
      queryClient.invalidateQueries({ queryKey: ['collect-status'] });
    },
  });

  const collectMutation = useMutation({
    mutationFn: () => apiMutation<CollectStartResult>('/api/collect', 'POST'),
    onSuccess: (result) => {
      setMessage(result.started ? '手动采集已启动，页面会根据真实状态自动更新。' : result.reason ?? '本轮没有启动。');
      queryClient.invalidateQueries({ queryKey: ['collect-status'] });
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!parsedHours) return;
    scheduleMutation.mutate({ schedule_enabled: enabled, run_hours: parsedHours });
  }

  const status = statusQuery.data;
  const result = status?.last_result;

  return (
    <main className="page">
      <ArtPageHead
        compact
        title={meta?.title ?? '自动任务'}
        description={meta?.description}
        actions={<button className="btn btn-primary" type="button" disabled={status?.running || collectMutation.isPending} onClick={() => collectMutation.mutate()}>
            <Play size={14} />{status?.running ? '采集正在进行' : collectMutation.isPending ? '正在启动…' : '立即采集'}
          </button>}
      />

      {message && <p className="notice" role="status">{message}</p>}
      {(collectMutation.isError || scheduleMutation.isError) && (
        <p className="notice notice-error" role="alert">{errorMessage(collectMutation.error ?? scheduleMutation.error)}</p>
      )}

      {statusQuery.isLoading && (
        <section className="panel loading-stack" aria-busy="true" aria-label="正在加载自动任务状态">
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line" />
        </section>
      )}

      {statusQuery.isError && (
        <div className="error-state" role="alert">
          <AlertTriangle />
          <h2>任务状态没有加载成功</h2>
          <p>{errorMessage(statusQuery.error)}</p>
          <button className="btn btn-quiet" type="button" onClick={() => statusQuery.refetch()}>重新加载</button>
        </div>
      )}

      {status && (
        <div className="dashboard-grid">
          <div className="stack">
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>定时采集计划</h2>
                  <p>按本机时区执行；机器休眠期间不会伪造已完成记录。</p>
                </div>
                <span className={enabled ? 'badge badge-success' : 'badge badge-neutral'}>{enabled ? '已启用' : '已停用'}</span>
              </div>
              <form className="panel-body" onSubmit={submit}>
                <div className="form-grid">
                  <div className="field">
                    <label htmlFor="schedule-enabled">任务状态</label>
                    <select
                      id="schedule-enabled"
                      value={enabled ? 'enabled' : 'disabled'}
                      onChange={(event) => {
                        setEnabled(event.target.value === 'enabled');
                        setDirty(true);
                        setMessage('');
                      }}
                    >
                      <option value="enabled">每天自动运行</option>
                      <option value="disabled">暂停定时运行</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="schedule-hours">运行小时</label>
                    <input
                      id="schedule-hours"
                      value={hours}
                      onChange={(event) => {
                        setHours(event.target.value);
                        setDirty(true);
                        setMessage('');
                      }}
                      placeholder="9, 14"
                      aria-invalid={!parsedHours}
                    />
                    <small>{parsedHours ? `每天 ${parsedHours.map((hour) => `${hour}:00`).join('、')}` : '请输入 0–23 的整数，用逗号或空格分隔。'}</small>
                  </div>
                </div>
                <div className="form-actions">
                  <button className="btn btn-primary" type="submit" disabled={!dirty || !parsedHours || scheduleMutation.isPending}>
                    <Save size={14} />{scheduleMutation.isPending ? '正在保存…' : '保存运行计划'}
                  </button>
                </div>
              </form>
            </section>

            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>最近一次运行结果</h2>
                  <p>{status.last_at ? formatTime(status.last_at) : '尚未完成过采集'}</p>
                </div>
                <span className={status.last_error || result?.crawler_error ? 'badge badge-danger' : result?.source_errors.length ? 'badge badge-warning' : result ? 'badge badge-success' : 'badge badge-neutral'}>
                  {status.last_error || result?.crawler_error ? '失败' : result?.source_errors.length ? '部分完成' : result ? '已完成' : '暂无'}
                </span>
              </div>
              {!result && !status.last_error ? (
                <div className="empty-state">
                  <TimerReset />
                  <h2>还没有运行结果</h2>
                  <p>点击“立即采集”后，这里会显示后端真实返回的新增量和异常。</p>
                </div>
              ) : (
                <div className="panel-body stack">
                  {status.last_error && <p className="notice notice-error">{status.last_error}</p>}
                  {result && (
                    <>
                      <div className="metric-grid">
                        <div className="metric-card"><span>本轮新增信号</span><strong>{result.crawler_added}</strong><small>来自采集器真实结果</small></div>
                        <div className="metric-card"><span>来源异常</span><strong>{result.source_errors.length}</strong><small>单个来源失败不代表整轮伪装成功</small></div>
                      </div>
                      <p className="notice">研判管线：{result.pipeline || '未返回结果'}</p>
                      {result.crawler_error && <p className="notice notice-error">采集器：{result.crawler_error}</p>}
                      {!!result.source_errors.length && <p className="notice notice-warning">来源异常：{result.source_errors.join('；')}</p>}
                    </>
                  )}
                </div>
              )}
            </section>
          </div>

          <aside className="stack">
            <section className="panel">
              <div className="panel-head"><h2>运行状态</h2></div>
              <div className="panel-body stack">
                <div className={status.running ? 'notice notice-warning' : 'notice'} role="status">
                  {status.running ? '一轮真实采集正在后台运行。系统不会同时启动第二轮。' : '当前没有采集任务占用写入链路。'}
                </div>
                <dl className="run-facts">
                  <div><dt>下次计划</dt><dd>{formatTime(status.next_at)}</dd></div>
                  <div><dt>最近完成</dt><dd>{formatTime(status.last_at)}</dd></div>
                </dl>
                {status.last_skip && <p className="notice notice-warning">上次顺延：{status.last_skip}</p>}
              </div>
            </section>
            <section className="panel">
              <div className="panel-head"><h2>任务规则</h2></div>
              <div className="panel-body">
                <p className="page-intro"><CalendarClock size={15} /> 每轮最多新增 25 条；上一轮仍在运行时不会并发写入 SQLite；错过太久的定时任务不会在恢复后追跑。</p>
              </div>
            </section>
          </aside>
        </div>
      )}

      <WeeklyReviewPanel />
    </main>
  );
}

/**
 * 每周复盘 · 独立一块，不挂在采集状态下面
 *
 * 挂上去的话采集状态读失败就连带看不见复盘配置，那两件事其实互不相干。
 * 「立即运行一次」会真的调模型烧额度，所以按钮上写明、点之前再确认一次；
 * 本周已经跑过时后端默认跳过，确认框里会说清这次是强制重跑。
 */
function WeeklyReviewPanel() {
  const queryClient = useQueryClient();
  const [weeklyEnabled, setWeeklyEnabled] = useState(true);
  const [weekday, setWeekday] = useState(1);
  const [hour, setHour] = useState('9');
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');

  const weeklyQuery = useQuery({
    queryKey: ['weekly-review-status'],
    queryFn: () => apiGet<WeeklyReviewStatus>('/api/weekly-review/status'),
    refetchInterval: (query) => query.state.data?.running ? 2000 : 30000,
  });

  useEffect(() => {
    if (weeklyQuery.data && !dirty) {
      setWeeklyEnabled(weeklyQuery.data.weekly_enabled);
      setWeekday(weeklyQuery.data.weekly_weekday);
      setHour(String(weeklyQuery.data.weekly_hour));
    }
  }, [dirty, weeklyQuery.data]);

  const parsedHour = useMemo(() => parseHour(hour), [hour]);

  const scheduleMutation = useMutation({
    mutationFn: (body: WeeklyScheduleConfig) =>
      apiMutation<WeeklyScheduleUpdateResult>('/api/schedule/weekly', 'PUT', body),
    onSuccess: (result) => {
      setDirty(false);
      setWeeklyEnabled(result.weekly_enabled);
      setWeekday(result.weekly_weekday);
      setHour(String(result.weekly_hour));
      setMessage(result.weekly_enabled
        ? `周复盘档期已保存，下次触发：${formatTime(result.next_at)}`
        : '周复盘已停用，调度器不会再自动触发。');
      queryClient.invalidateQueries({ queryKey: ['weekly-review-status'] });
    },
  });

  const runMutation = useMutation({
    mutationFn: (force: boolean) =>
      apiMutation<WeeklyRunResult>('/api/weekly-review/run', 'POST', { force }),
    onSuccess: (result) => {
      setMessage(result.started
        ? '周复盘已启动，正在真实调用模型；跑完后提案会出现在审批页。'
        : result.reason ?? '本轮没有启动。');
      queryClient.invalidateQueries({ queryKey: ['weekly-review-status'] });
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (parsedHour === null) return;
    scheduleMutation.mutate({
      weekly_enabled: weeklyEnabled, weekly_weekday: weekday, weekly_hour: parsedHour,
    });
  }

  const data = weeklyQuery.data;
  const last = data?.last_result;
  // 本周已跑过时后端默认跳过，只有 force 才会真跑。这里把这层意思摆到确认框里。
  const forceRun = data?.done_this_week === true;

  function runNow() {
    const confirmText = forceRun
      ? `本周（${data?.week ?? '当前周'}）已经产出过复盘了。再跑一轮会强制重跑并再消耗一次模型额度，确定继续？`
      // 别写「一次」：循环本身最多 AGENT_MAX_STEPS 次调用，中途还可能调
      // 会烧额度的只读工具（run_skill）。写上限比写理想值诚实。
      : '周复盘会真实调用模型（最多几次，本机通道每次约十几秒），消耗额度。确定现在就跑一轮？';
    if (!window.confirm(confirmText)) return;
    setMessage('');
    runMutation.mutate(forceRun);
  }

  const runDisabled = data?.running || runMutation.isPending;

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>每周复盘</h2>
          <p>
            每周固定时刻跑一轮：先用代码统计本周真实数据（新增公告 / 线索 / 作战卡、判非比例、
            各来源产出、撞墙与额度、本周新增记忆），再让 agent 据此提优化点。
            提案一律进<Link className="btn-link" to="/approvals">审批队列</Link>，
            批准也只是标记「已采纳」，系统不会自动改知识库或偏好。
          </p>
        </div>
        <span className={weeklyEnabled ? 'badge badge-success' : 'badge badge-neutral'}>
          {weeklyEnabled ? '已启用' : '已停用'}
        </span>
      </div>

      {weeklyQuery.isLoading && (
        <div className="panel-body loading-stack" aria-busy="true" aria-label="正在加载周复盘状态">
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line" />
        </div>
      )}

      {weeklyQuery.isError && (
        <div className="panel-body">
          <p className="notice notice-error" role="alert">
            周复盘状态没有加载成功：{errorMessage(weeklyQuery.error)}
          </p>
          <button className="btn btn-quiet" type="button" onClick={() => weeklyQuery.refetch()}>重新加载</button>
        </div>
      )}

      {data && (
        <div className="panel-body stack">
          {message && <p className="notice" role="status">{message}</p>}
          {(scheduleMutation.isError || runMutation.isError) && (
            <p className="notice notice-error" role="alert">
              {errorMessage(scheduleMutation.error ?? runMutation.error)}
            </p>
          )}

          <form className="stack" onSubmit={submit}>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="weekly-enabled">任务状态</label>
                <select
                  id="weekly-enabled"
                  value={weeklyEnabled ? 'enabled' : 'disabled'}
                  onChange={(event) => {
                    setWeeklyEnabled(event.target.value === 'enabled');
                    setDirty(true);
                    setMessage('');
                  }}
                >
                  <option value="enabled">每周自动复盘</option>
                  <option value="disabled">暂停自动复盘</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="weekly-weekday">星期</label>
                <select
                  id="weekly-weekday"
                  value={weekday}
                  onChange={(event) => {
                    setWeekday(Number(event.target.value));
                    setDirty(true);
                    setMessage('');
                  }}
                >
                  {WEEKDAYS.map((label, index) => (
                    <option value={index + 1} key={label}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="weekly-hour">触发小时</label>
                <input
                  id="weekly-hour"
                  value={hour}
                  onChange={(event) => {
                    setHour(event.target.value);
                    setDirty(true);
                    setMessage('');
                  }}
                  placeholder="9"
                  aria-invalid={parsedHour === null}
                />
                <small>
                  {parsedHour === null
                    ? '请输入 0–23 的整数。'
                    : `每${weekdayLabel(weekday)} ${String(parsedHour).padStart(2, '0')}:00 触发，同一周只跑一次。`}
                </small>
              </div>
            </div>
            <div className="form-actions">
              <button className="btn btn-primary" type="submit"
                      disabled={!dirty || parsedHour === null || scheduleMutation.isPending}>
                <Save size={14} />{scheduleMutation.isPending ? '正在保存…' : '保存复盘档期'}
              </button>
              <button className="btn btn-quiet" type="button" disabled={runDisabled} onClick={runNow}>
                <Sparkles size={14} />
                {data.running
                  ? '复盘正在进行'
                  : runMutation.isPending
                    ? '正在启动…'
                    : forceRun
                      ? '强制再跑一次（会再消耗一轮模型额度）'
                      : '立即运行一次（消耗模型额度）'}
              </button>
            </div>
          </form>

          <dl className="run-facts">
            <div><dt>下次触发</dt><dd>{weeklyEnabled ? formatTime(data.next_at) : '已停用'}</dd></div>
            <div>
              <dt>本周（{data.week ?? '未知'}）</dt>
              <dd>
                {/* null 是「后端读不出来」，不是「没跑过」——这两件事不许混为一谈 */}
                {data.done_this_week === null
                  ? '状态读不出来'
                  : data.done_this_week ? '已产出复盘' : '尚未产出'}
              </dd>
            </div>
            <div><dt>最近一次运行</dt><dd>{formatTime(data.last_at)}</dd></div>
            <div>
              <dt>待审复盘提案</dt>
              <dd>
                {data.proposals_pending === null
                  ? '读不出来'
                  : <Link className="btn-link" to="/approvals">{data.proposals_pending} 条</Link>}
              </dd>
            </div>
          </dl>

          {data.done_reason && <p className="form-hint">{data.done_reason}</p>}

          <div className={data.running ? 'notice notice-warning' : 'notice'} role="status">
            {data.running
              ? '一轮复盘正在后台运行，模型调用已经发出。系统不会同时启动第二轮。'
              : '当前没有复盘任务在跑。复盘只归纳、不改任何文件，产出全部进审批队列。'}
          </div>

          {data.last_skip && <p className="notice notice-warning">上次顺延：{data.last_skip}</p>}
          {data.last_error && <p className="notice notice-error">上次失败：{data.last_error}</p>}
          {Object.entries(data.errors ?? {}).map(([key, value]) => (
            <p className="notice notice-warning" key={key}>状态读取异常（{key}）：{value}</p>
          ))}

          {!last ? (
            <div className="empty-state">
              <TimerReset />
              <h2>还没有复盘记录</h2>
              <p>到点自动跑，或点上面的按钮跑一轮。这里只显示后端真实返回的结果，不会预置样例。</p>
            </div>
          ) : (
            <WeeklyLastRun last={last} />
          )}
        </div>
      )}
    </section>
  );
}

/** 上一轮复盘的真实结果。跑不成就写跑不成，不用「0 条提案」冒充成功。 */
function WeeklyLastRun({ last }: { last: NonNullable<WeeklyReviewStatus['last_result']> }) {
  const validation = last.validation;
  const digest = last.material_digest;
  const materialErrors = Object.entries(last.material_errors ?? {});

  if (!last.ok) {
    return (
      <div className="stack">
        <p className="notice notice-error" role="alert">
          <AlertTriangle size={13} aria-hidden="true" />
          {' '}上一轮复盘没跑成（{last.week ?? '未知周'}
          {last.trigger ? ` · ${last.trigger}触发` : ''}）：{last.error ?? '后端未给出原因'}
        </p>
        <p className="form-hint">这一轮没有产出任何提案。模型通道不通时系统不会用兜底文本凑数。</p>
      </div>
    );
  }

  if (last.skipped) {
    return (
      <p className="notice" role="status">
        上一轮跳过未跑：{last.reason ?? '后端未给出原因'}
      </p>
    );
  }

  return (
    <div className="stack">
      <div className="metric-grid">
        <div className="metric-card">
          <span>产出提案</span>
          <strong>{last.proposal_ids?.length ?? 0}</strong>
          <small>已进审批队列，等人裁决</small>
        </div>
        <div className="metric-card">
          <span>校验丢弃</span>
          <strong>{validation?.dropped ?? 0}</strong>
          <small>不合规的条目直接丢，不截断凑数</small>
        </div>
        <div className="metric-card">
          <span>agent 步数</span>
          <strong>{last.steps ?? '—'}</strong>
          <small>{last.trigger ? `${last.trigger}触发` : '触发方式未知'}</small>
        </div>
      </div>

      <p className="form-hint">
        {last.week ?? '未知周'} · {formatTime(last.finished_at ?? null)} 完成
        {validation ? ` · 模型给了 ${validation.received} 条，采纳 ${validation.accepted} 条` : ''}
      </p>

      {digest && (
        <p className="form-hint">
          本周素材：新增公告 {digest.new_signals ?? '读不出来'} · 新增线索 {digest.new_leads ?? '读不出来'}
          {' '}· 新增作战卡 {digest.new_cards ?? '读不出来'}
          {' '}· 判非商机占比 {typeof digest.rejected_ratio === 'number'
            ? `${(digest.rejected_ratio * 100).toFixed(1)}%` : '读不出来'}
          {' '}· 撞墙 {digest.dead_end_total ?? '读不出来'} · 新增记忆 {digest.new_memories ?? '读不出来'}
        </p>
      )}

      {!!validation?.reasons.length && (
        <p className="notice notice-warning">丢弃原因：{validation.reasons.join('；')}</p>
      )}
      {!!validation?.flags.length && (
        <p className="notice notice-warning">校验提示：{validation.flags.join('；')}</p>
      )}
      {!!last.propose_errors?.length && (
        <p className="notice notice-error">写入队列失败：{last.propose_errors.join('；')}</p>
      )}
      {materialErrors.map(([key, value]) => (
        <p className="notice notice-warning" key={key}>素材缺口（{key}）：{value}</p>
      ))}
    </div>
  );
}
