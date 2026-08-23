import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Database, Globe2, Link2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import {
  apiGet,
  apiMutation,
  SourceCreateInput,
  SourceCreateResult,
  SourceDeleteResult,
  SourceProbeReport,
  SourceSummary,
  SourceToggleResult,
} from '../../api';
import { ArtPageHead } from '../../components/cards/ArtPageHead';
import { useRouteMeta } from '../../hooks/useRouteMeta';

type SourceDraft = {
  url: string;
  name: string;
  reason: string;
  quota: string;
  enabled: boolean;
  attachExisting: boolean;
};

const EMPTY_DRAFT: SourceDraft = {
  url: '',
  name: '',
  reason: '',
  quota: '15',
  enabled: true,
  attachExisting: false,
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '请求未能完成';
}

export default function SourcesPage() {
  const meta = useRouteMeta();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState<SourceDraft>(EMPTY_DRAFT);
  const [probe, setProbe] = useState<SourceProbeReport | null>(null);
  const [deleteKey, setDeleteKey] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const sourcesQuery = useQuery({
    queryKey: ['sources'],
    queryFn: () => apiGet<SourceSummary[]>('/api/sources'),
  });

  const probeMutation = useMutation({
    mutationFn: (url: string) =>
      apiMutation<SourceProbeReport>('/api/sources/probe', 'POST', { url }),
    onSuccess: (result) => {
      setProbe(result);
      setMessage('');
      if (result.same_domain_source) {
        setDraft((current) => ({ ...current, attachExisting: true }));
      }
    },
  });

  const createMutation = useMutation({
    mutationFn: (body: SourceCreateInput) =>
      apiMutation<SourceCreateResult>('/api/sources', 'POST', body),
    onSuccess: (result) => {
      setMessage(result.message ?? `数据源「${result.key}」已保存`);
      setDraft(EMPTY_DRAFT);
      setProbe(null);
      setShowCreate(false);
      queryClient.invalidateQueries({ queryKey: ['sources'] });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
      apiMutation<SourceToggleResult>(`/api/sources/${encodeURIComponent(key)}/toggle`, 'POST', { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sources'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (key: string) =>
      apiMutation<SourceDeleteResult>(`/api/sources/${encodeURIComponent(key)}`, 'DELETE'),
    onSuccess: (result) => {
      setDeleteKey(null);
      setMessage(result.message);
      queryClient.invalidateQueries({ queryKey: ['sources'] });
    },
  });

  function changeUrl(url: string) {
    setDraft((current) => ({ ...current, url, attachExisting: false }));
    setProbe(null);
    probeMutation.reset();
  }

  function submitProbe(event: FormEvent) {
    event.preventDefault();
    const url = draft.url.trim();
    if (url) probeMutation.mutate(url);
  }

  function saveSource() {
    if (!probe?.usable || probe.url !== draft.url.trim()) return;
    const attachTo = draft.attachExisting ? probe.same_domain_source ?? '' : '';
    createMutation.mutate({
      url: draft.url.trim(),
      name: attachTo ? probe.same_domain_source ?? draft.name.trim() : draft.name.trim(),
      reason: draft.reason.trim(),
      quota: Math.max(1, Math.min(100, Number.parseInt(draft.quota, 10) || 15)),
      enabled: draft.enabled,
      article_pattern: probe.article_pattern,
      body_selectors: probe.body_selectors,
      attach_to: attachTo,
    });
  }

  const saveDisabled =
    !probe?.usable
    || probe.url !== draft.url.trim()
    || (!draft.attachExisting && !draft.name.trim())
    || !draft.reason.trim()
    || createMutation.isPending;

  return (
    <main className="page">
      <ArtPageHead
        compact
        title={meta?.title ?? '数据源'}
        description={meta?.description}
        actions={<button
            className="btn btn-primary"
            type="button"
            onClick={() => {
              setShowCreate((value) => !value);
              setMessage('');
            }}
          >
            <Plus size={15} />{showCreate ? '收起表单' : '新增数据源'}
          </button>}
      />

      {message && <p className="notice" role="status">{message}</p>}

      {showCreate && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>探测并加入站点</h2>
              <p>探测不会调用大模型；保存时服务端会再次复核，不能绕过。</p>
            </div>
          </div>
          <div className="panel-body">
            <form className="form-grid" onSubmit={submitProbe}>
              <div className="field is-wide">
                <label htmlFor="source-url">公告列表页网址</label>
                <input
                  id="source-url"
                  type="url"
                  required
                  value={draft.url}
                  onChange={(event) => changeUrl(event.target.value)}
                  placeholder="https://example.com/news/hydrogen"
                />
                <small>修改网址后必须重新探测，旧结论不会沿用。</small>
              </div>
              <div className="form-actions">
                <button className="btn btn-secondary" type="submit" disabled={!draft.url.trim() || probeMutation.isPending}>
                  <RefreshCw size={14} />{probeMutation.isPending ? '正在真实探测…' : '探测网址'}
                </button>
              </div>
            </form>

            {probeMutation.isError && (
              <div className="notice notice-error" role="alert">{errorMessage(probeMutation.error)}</div>
            )}

            {probe && (
              <div className={probe.usable ? 'notice' : 'notice notice-warning'} role="status">
                <strong>{probe.verdict}</strong>
                <p>{probe.detail.join('；')}</p>
                <p>同域关键词文章 {probe.keyword_links} 条 · 正文容器 {probe.body_selectors.join('、') || '未识别'}</p>
              </div>
            )}

            {probe?.usable && (
              <div className="form-grid">
                {probe.same_domain_source && (
                  <div className="field is-wide">
                    <label htmlFor="attach-existing">同域归属</label>
                    <select
                      id="attach-existing"
                      value={draft.attachExisting ? 'attach' : 'new'}
                      onChange={(event) => setDraft((current) => ({ ...current, attachExisting: event.target.value === 'attach' }))}
                    >
                      <option value="attach">并入已有数据源「{probe.same_domain_source}」</option>
                      <option value="new">作为新的独立数据源</option>
                    </select>
                    <small>并入已有源时，这个网址会成为该源的新栏目页，不创建重复站点。</small>
                  </div>
                )}
                {!draft.attachExisting && (
                  <>
                    <div className="field">
                      <label htmlFor="source-name">内部名称</label>
                      <input
                        id="source-name"
                        maxLength={40}
                        required
                        value={draft.name}
                        onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                        placeholder="例如：ARENA 项目公告"
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="source-quota">单轮最多新增</label>
                      <input
                        id="source-quota"
                        type="number"
                        min="1"
                        max="100"
                        value={draft.quota}
                        onChange={(event) => setDraft((current) => ({ ...current, quota: event.target.value }))}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="source-enabled">首次采集状态</label>
                      <select
                        id="source-enabled"
                        value={draft.enabled ? 'enabled' : 'disabled'}
                        onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.value === 'enabled' }))}
                      >
                        <option value="enabled">保存后立即启用</option>
                        <option value="disabled">先保存为停用</option>
                      </select>
                    </div>
                  </>
                )}
                <div className="field is-wide">
                  <label htmlFor="source-reason">为什么选择它</label>
                  <textarea
                    id="source-reason"
                    maxLength={500}
                    required
                    value={draft.reason}
                    onChange={(event) => setDraft((current) => ({ ...current, reason: event.target.value }))}
                    placeholder="说明这个来源覆盖什么真实采购或项目信号，以及为什么值得持续监测。"
                  />
                  <small>{draft.reason.length}/500 字；新建或并入栏目都要留下来源判断依据。</small>
                </div>
                <div className="field is-wide">
                  <div className="form-actions">
                    <button className="btn btn-primary" type="button" disabled={saveDisabled} onClick={saveSource}>
                      <Database size={14} />{createMutation.isPending ? '正在复核并保存…' : '保存数据源'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {createMutation.isError && (
              <div className="notice notice-error" role="alert">{errorMessage(createMutation.error)}</div>
            )}
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>在册来源</h2>
            <p>停用后下次采集立即生效；删除默认保留历史信号和原始链接。</p>
          </div>
          <span className="badge badge-neutral">{sourcesQuery.data?.filter((item) => item.key !== '__orphan__').length ?? 0} 个</span>
        </div>

        {sourcesQuery.isLoading && (
          <div className="loading-stack" aria-busy="true" aria-label="正在加载数据源">
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line" />
          </div>
        )}

        {sourcesQuery.isError && (
          <div className="error-state" role="alert">
            <AlertTriangle />
            <h2>数据源没有加载成功</h2>
            <p>{errorMessage(sourcesQuery.error)}</p>
            <button className="btn btn-quiet" type="button" onClick={() => sourcesQuery.refetch()}>重新加载</button>
          </div>
        )}

        {sourcesQuery.data?.length === 0 && (
          <div className="empty-state">
            <Globe2 />
            <h2>还没有配置数据源</h2>
            <p>从真实公告列表页开始，先探测再保存。</p>
          </div>
        )}

        {!!sourcesQuery.data?.length && (
          <div className="source-list panel-body">
            {sourcesQuery.data.map((source) => {
              const orphan = source.key === '__orphan__';
              const deleting = deleteMutation.isPending && deleteKey === source.key;
              return (
                <article className="source-row" key={source.key}>
                  <div className="source-row-head">
                    <div>
                      <div className="toolbar-group">
                        <h3>{source.name}</h3>
                        <span className={source.enabled ? 'badge badge-success' : 'badge badge-neutral'}>
                          {source.enabled ? '采集中' : orphan ? '历史归档' : '已停用'}
                        </span>
                      </div>
                      <p>{source.reason || '未填写来源说明'}</p>
                      <p><Link2 size={12} /> {source.kind} · 单轮配额 {source.quota} · 已入库 {source.signals} 条</p>
                    </div>
                    {!orphan && (
                      <div className="row-actions">
                        <button
                          className={source.enabled ? 'switch is-on' : 'switch'}
                          type="button"
                          role="switch"
                          aria-checked={source.enabled}
                          aria-label={`${source.enabled ? '停用' : '启用'} ${source.name}`}
                          disabled={toggleMutation.isPending}
                          onClick={() => toggleMutation.mutate({ key: source.key, enabled: !source.enabled })}
                        />
                        <button className="btn btn-danger" type="button" onClick={() => setDeleteKey(source.key)}>
                          <Trash2 size={13} />删除
                        </button>
                      </div>
                    )}
                  </div>
                  {deleteKey === source.key && (
                    <div className="inline-confirm" role="group" aria-label={`确认删除 ${source.name}`}>
                      <span>删除来源配置？已抓取的 {source.signals} 条历史信号会保留，并继续可以回源核对。</span>
                      <div>
                        <button className="btn btn-quiet" type="button" disabled={deleting} onClick={() => setDeleteKey(null)}>取消</button>
                        <button className="btn btn-danger" type="button" disabled={deleting} onClick={() => deleteMutation.mutate(source.key)}>
                          {deleting ? '正在删除…' : '确认删除'}
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {(toggleMutation.isError || deleteMutation.isError) && (
        <div className="notice notice-error" role="alert">
          {errorMessage(toggleMutation.error ?? deleteMutation.error)}
        </div>
      )}
    </main>
  );
}
