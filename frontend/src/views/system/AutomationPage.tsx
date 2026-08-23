import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, Play, Save, TimerReset } from 'lucide-react';
import {
  apiGet,
  apiMutation,
  CollectStartResult,
  CollectStatus,
  ScheduleConfig,
  ScheduleUpdateResult,
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
    </main>
  );
}
