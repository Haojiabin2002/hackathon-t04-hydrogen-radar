import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Cpu, KeyRound, Play, ScanSearch, Search, ShieldCheck } from 'lucide-react';
import {
  apiGet,
  apiMutation,
  ChannelTestResult,
  LlmChannel,
  LlmChannelInput,
  LlmChannelKey,
  LlmChannelsResponse,
  ReachStatus,
} from '../../api';
import { ArtPageHead } from '../../components/cards/ArtPageHead';
import { useRouteMeta } from '../../hooks/useRouteMeta';

type ApiDraft = {
  baseUrl: string;
  model: string;
  apiKey: string;
  style: string;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '请求未能完成';
}

function isolationLabel(channel: LlmChannel) {
  if (channel.isolation === 'passed') return '隔离已通过';
  if (channel.isolation === 'failed') return '隔离未通过';
  return '隔离待实测';
}

export default function ModelsPage() {
  const meta = useRouteMeta();
  const [apiDraft, setApiDraft] = useState<ApiDraft>({ baseUrl: '', model: '', apiKey: '', style: '' });
  const [tests, setTests] = useState<Partial<Record<LlmChannelKey, ChannelTestResult>>>({});

  const channelsQuery = useQuery({
    queryKey: ['llm-channels'],
    queryFn: () => apiGet<LlmChannelsResponse>('/api/llm/channels'),
  });

  /**
   * 博查搜索的余额在受控触网那本账里（GET /api/reach/status），不在 LLM 通道里。
   * 那个接口任何一块读失败都会把该字段置 null 并在 errors 里写原因——
   * 所以下面一律判 `typeof x === 'number'`，**不许用 `?? 0` 把读不到画成 0**。
   */
  const reachQuery = useQuery({
    queryKey: ['reach-status'],
    queryFn: () => apiGet<ReachStatus>('/api/reach/status'),
    retry: false,
  });

  const apiChannel = channelsQuery.data?.channels.find((channel) => channel.key === 'api');
  const routes = apiChannel?.routes ?? [];
  useEffect(() => {
    if (apiChannel) {
      setApiDraft((current) => ({
        ...current,
        baseUrl: current.baseUrl || apiChannel.base_url || '',
        model: current.model || apiChannel.model || '',
        style: current.style || apiChannel.style || '',
      }));
    }
  }, [apiChannel]);

  const testMutation = useMutation({
    mutationFn: (body: LlmChannelInput) =>
      apiMutation<ChannelTestResult>('/api/llm/channels/test', 'POST', body),
    onSuccess: (result, variables) => {
      setTests((current) => ({ ...current, [variables.channel]: result }));
      channelsQuery.refetch();
    },
  });

  function testChannel(channel: LlmChannelKey) {
    if (channel === 'api') {
      testMutation.mutate({
        channel,
        base_url: apiDraft.baseUrl.trim(),
        model: apiDraft.model.trim(),
        api_key: apiDraft.apiKey,
        style: apiDraft.style,
      });
      return;
    }
    testMutation.mutate({ channel });
  }

  const testingKey = testMutation.isPending ? testMutation.variables?.channel : null;

  return (
    <main className="page">
      <ArtPageHead
        compact
        title={meta?.title ?? '模型通道'}
        description={meta?.description}
        actions={<button className="btn btn-quiet" type="button" disabled={channelsQuery.isFetching} onClick={() => channelsQuery.refetch()}>
            <ScanSearch size={14} />{channelsQuery.isFetching ? '正在扫描…' : '重新扫描本机'}
          </button>}
      />

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>赞助线路与检索额度</h2>
            <p>只显示线路状态与掩码尾号。接口从不回传密钥明文，页面上也没有能看到明文的地方。</p>
          </div>
          <KeyRound size={16} aria-hidden="true" />
        </div>
        <div className="panel-body stack">
          <div>
            <span className="section-label">LLM 线路（api 通道）</span>
            <div className="table-shell">
              <table className="data-table">
                <thead>
                  <tr><th>线路</th><th>额度</th><th>Key</th><th>状态</th><th>备注</th></tr>
                </thead>
                <tbody>
                  {routes.map((route) => (
                    <tr key={route.id}>
                      <td>{route.name}</td>
                      <td>${route.quota_usd}</td>
                      <td>{route.imported ? <code>{route.key_tail || '（后端未给掩码）'}</code> : <span className="cell-muted">未导入</span>}</td>
                      <td>
                        {route.active
                          ? <span className="badge badge-success">当前生效</span>
                          : <span className="badge badge-neutral">未启用</span>}
                      </td>
                      <td className="cell-muted">{route.note}</td>
                    </tr>
                  ))}
                  {routes.length === 0 && (
                    <tr>
                      <td colSpan={5} className="cell-muted">
                        {channelsQuery.isLoading ? '正在读取本机通道配置…' : '本机通道扫描没有返回线路清单（后端未提供）。'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {apiChannel && (
              <small className="form-hint">
                模型 {apiChannel.model || '后端未提供'} · 接口风格 {apiChannel.style || '后端未提供'}
                {apiChannel.thinking ? ` · 思考档 ${apiChannel.thinking}` : ''}
                {' · '}密钥是否已存：{apiChannel.key_set ? '已存（不回显）' : '未存'}
              </small>
            )}
          </div>

          <div>
            <span className="section-label"><Search size={12} aria-hidden="true" /> 博查搜索</span>
            {reachQuery.isLoading && <div className="skeleton skeleton-line" />}
            {reachQuery.isError && (
              <p className="notice notice-error" role="alert">
                读不到检索额度：{errorMessage(reachQuery.error)}
              </p>
            )}
            {reachQuery.isSuccess && (
              <>
                <p>
                  余额{' '}
                  {typeof reachQuery.data.bocha_remaining === 'number'
                    ? <b>{reachQuery.data.bocha_remaining}</b>
                    : <b className="cell-muted">读不到</b>}
                  {' / '}
                  {typeof reachQuery.data.bocha_total === 'number' ? reachQuery.data.bocha_total : '读不到'}
                  {typeof reachQuery.data.bocha_used === 'number' && ` · 已用 ${reachQuery.data.bocha_used}`}
                </p>
                <small className="form-hint">
                  今日抓取{' '}
                  {typeof reachQuery.data.fetch_today === 'number' ? reachQuery.data.fetch_today : '读不到'}
                  {' / '}
                  {typeof reachQuery.data.fetch_daily_cap === 'number' ? reachQuery.data.fetch_daily_cap : '读不到'}
                  {' 页 · 博查 Key 由后端本地保管，接口不回传，页面也不提供输入框。'}
                </small>
                {Object.keys(reachQuery.data.errors ?? {}).length > 0 && (
                  <div className="notice notice-warning" role="status">
                    <AlertTriangle size={13} aria-hidden="true" />
                    {' '}这几项读失败了：
                    {Object.entries(reachQuery.data.errors).map(([field, why]) => `${field}（${why}）`).join('；')}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      <div className="notice notice-warning">
        <strong>真实测试会消耗模型额度。</strong> CLI 首次测试及隔离探针可能需要 10–30 秒，测试期间按钮会锁定；关闭页面不会中断后端请求。
      </div>

      {channelsQuery.isLoading && (
        <section className="panel loading-stack" aria-busy="true" aria-label="正在扫描模型通道">
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line" />
        </section>
      )}

      {channelsQuery.isError && (
        <div className="error-state" role="alert">
          <AlertTriangle />
          <h2>本机通道扫描失败</h2>
          <p>{errorMessage(channelsQuery.error)}</p>
          <button className="btn btn-quiet" type="button" onClick={() => channelsQuery.refetch()}>重新扫描</button>
        </div>
      )}

      {channelsQuery.data && (
        <section className="channel-list">
          {channelsQuery.data.channels.map((channel) => {
            const result = tests[channel.key];
            const testing = testingKey === channel.key;
            const apiReady = channel.key !== 'api' || (!!apiDraft.baseUrl.trim() && !!apiDraft.model.trim() && !!apiDraft.apiKey);
            return (
              <article className="channel-card" key={channel.key}>
                <div className="channel-card-head">
                  <div>
                    <div className="toolbar-group">
                      <h3>{channel.name}</h3>
                      {channel.current && <span className="badge badge-success">当前配置</span>}
                      <span className={channel.installed && channel.configured ? 'badge badge-info' : 'badge badge-neutral'}>
                        {channel.installed ? channel.configured ? '已检测到配置' : '需要配置' : '本机未安装'}
                      </span>
                      <span className={channel.isolation === 'passed' ? 'badge badge-success' : channel.isolation === 'failed' ? 'badge badge-danger' : 'badge badge-warning'}>
                        {isolationLabel(channel)}
                      </span>
                    </div>
                    <p>{channel.detail}</p>
                    {channel.path && <p>CLI 路径：{channel.path}</p>}
                    {channel.isolation_detail && <p><ShieldCheck size={12} /> {channel.isolation_detail}</p>}
                  </div>
                  <button
                    className="btn btn-secondary"
                    type="button"
                    disabled={testMutation.isPending || !channel.installed || !apiReady}
                    onClick={() => testChannel(channel.key)}
                  >
                    <Play size={13} />{testing ? '正在真实测试…' : '测试通道'}
                  </button>
                </div>

                {channel.key === 'api' && (
                  <form className="form-grid" onSubmit={(event: FormEvent) => { event.preventDefault(); testChannel('api'); }}>
                    <div className="field">
                      <label htmlFor="llm-base-url">兼容 API Base URL</label>
                      <input id="llm-base-url" type="url" value={apiDraft.baseUrl} onChange={(event) => setApiDraft((current) => ({ ...current, baseUrl: event.target.value }))} placeholder="https://api.example.com/v1" />
                    </div>
                    <div className="field">
                      <label htmlFor="llm-model">模型名称</label>
                      <input id="llm-model" value={apiDraft.model} onChange={(event) => setApiDraft((current) => ({ ...current, model: event.target.value }))} placeholder="model-name" />
                    </div>
                    <div className="field">
                      <label htmlFor="llm-style">接口风格</label>
                      <select id="llm-style" value={apiDraft.style} onChange={(event) => setApiDraft((current) => ({ ...current, style: event.target.value }))}>
                        <option value="">根据地址自动判断</option>
                        <option value="responses">Responses API</option>
                        <option value="chat_completions">Chat Completions</option>
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="llm-api-key">本次测试 API Key</label>
                      <input id="llm-api-key" type="password" autoComplete="off" value={apiDraft.apiKey} onChange={(event) => setApiDraft((current) => ({ ...current, apiKey: event.target.value }))} placeholder={channel.key_set ? '已存密钥不会回显；测试请重新输入' : '输入本次测试密钥'} />
                      <small><KeyRound size={11} /> 只会随本次测试请求发送，扫描接口不会返回已保存密钥。</small>
                    </div>
                  </form>
                )}

                {result && (
                  <div className={result.ok ? 'notice' : 'notice notice-error'} role="status">
                    {result.ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                    <strong>{result.ok ? '真实调用通过' : `测试未通过${result.stage ? `（${result.stage}）` : ''}`}</strong>
                    <p>{result.ok ? `响应 ${result.latency_s ?? '—'} 秒：${result.reply ?? '通道已回应'}` : result.reason ?? '通道没有返回可用结果'}</p>
                    {result.isolation_detail && <p>隔离：{result.isolation_detail}</p>}
                  </div>
                )}
                {testing && (
                  <div className="notice notice-warning" role="status">
                    <Cpu size={14} /> 正在等待真实连接和隔离探针，请勿重复点击。
                  </div>
                )}
              </article>
            );
          })}
        </section>
      )}

      {testMutation.isError && <p className="notice notice-error" role="alert">{errorMessage(testMutation.error)}</p>}
    </main>
  );
}
