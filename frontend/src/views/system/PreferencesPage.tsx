import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Plus, RefreshCw, X } from 'lucide-react';
import { apiGet, apiMutation } from '../../api/client';
import type { PreferenceInput, PreferenceKey, PreferencesResponse } from '../../api/types';
import { ArtPageHead } from '../../components/cards/ArtPageHead';
import { useRouteMeta } from '../../hooks/useRouteMeta';

/**
 * 销售偏好 · Agent Harness 的一个部件。
 *
 * 与「销售记忆」的分工：记忆是自由文本、由对话沉淀；偏好是结构化、白名单五项，
 * 直接参与 agent 的检索条件。两者都会在每一轮注入模型上下文。
 */

const LIST_KEYS: Array<{ key: Extract<PreferenceKey, 'focus_regions' | 'focus_products' | 'exclude_regions'>; label: string; placeholder: string }> = [
  { key: 'focus_regions', label: '关注区域', placeholder: '如 广东' },
  { key: 'focus_products', label: '关注产品线', placeholder: '如 撬装式PEM制氢' },
  { key: 'exclude_regions', label: '排除区域', placeholder: '如 新疆' },
];

function TagEditor({
  label, hint, values, placeholder, onAdd, onRemove, disabled,
}: {
  label: string; hint?: string; values: string[]; placeholder: string;
  onAdd: (v: string) => void; onRemove: (v: string) => void; disabled?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const clean = draft.trim();
    if (!clean || values.includes(clean)) { setDraft(''); return; }
    onAdd(clean);
    setDraft('');
  };
  return (
    <div className="pref-row">
      <div><strong>{label}</strong>{hint && <small>{hint}</small>}</div>
      <div>
        <form className="toolbar" onSubmit={submit} style={{ marginBottom: 0 }}>
          <input
            className="search-field"
            aria-label={`添加${label}`}
            placeholder={placeholder}
            value={draft}
            disabled={disabled}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button className="btn btn-quiet" type="submit" disabled={!draft.trim() || disabled}>
            <Plus size={14} aria-hidden="true" />添加
          </button>
        </form>
        {values.length > 0 && (
          <div className="pref-tags">
            {values.map((v) => (
              <span className="pref-tag" key={v}>
                {v}
                <button type="button" aria-label={`移除 ${v}`} disabled={disabled} onClick={() => onRemove(v)}>
                  <X size={11} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function PreferencesPage() {
  const meta = useRouteMeta();
  const queryClient = useQueryClient();

  const prefs = useQuery({
    queryKey: ['preferences'],
    queryFn: () => apiGet<PreferencesResponse>('/api/preferences'),
  });

  const save = useMutation({
    mutationFn: (input: PreferenceInput) => apiMutation('/api/preferences', 'PUT', input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['preferences'] }),
  });

  const p = prefs.data?.preferences;
  const schema = prefs.data?.schema ?? {};

  return (
    <section className="page">
      <ArtPageHead compact title={meta?.title ?? '销售偏好'} description={meta?.description} />

      {prefs.isError && (
        <div className="error-state" role="alert">
          <AlertTriangle size={24} aria-hidden="true" />
          <h2>偏好读取失败</h2>
          <p>{prefs.error instanceof Error ? prefs.error.message : '无法读取偏好。'}</p>
          <button className="btn btn-quiet" onClick={() => void prefs.refetch()}>
            <RefreshCw size={14} aria-hidden="true" />重新加载
          </button>
        </div>
      )}

      {save.isError && (
        <div className="notice notice-error" role="alert">
          保存失败：{save.error instanceof Error ? save.error.message : '未知错误'}
        </div>
      )}

      {prefs.isLoading && (
        <div className="panel loading-stack" aria-busy="true">
          <div className="skeleton skeleton-line" /><div className="skeleton skeleton-line" />
        </div>
      )}

      {p && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>结构化偏好</h2>
              <p>每一轮都会注入 Agent 上下文，直接影响它的检索条件</p>
            </div>
          </div>
          <div className="panel-body pref-list">
            {LIST_KEYS.map(({ key, label, placeholder }) => (
              <TagEditor
                key={key}
                label={label}
                hint={schema[key]}
                placeholder={placeholder}
                values={p[key]}
                disabled={save.isPending}
                onAdd={(v) => save.mutate({ key, value: [...p[key], v] })}
                onRemove={(v) => save.mutate({ key, value: p[key].filter((x) => x !== v) })}
              />
            ))}

            <div className="pref-row">
              <div>
                <strong>最低评分</strong>
                <small>{schema.min_score}</small>
              </div>
              <div className="flex-c" style={{ gap: 12 }}>
                <input
                  className="art-range"
                  type="range"
                  min={0}
                  max={95}
                  step={5}
                  value={p.min_score}
                  disabled={save.isPending}
                  aria-label="最低评分"
                  onChange={(event) => save.mutate({ key: 'min_score', value: Number(event.target.value) })}
                />
                <b className="tnum">{p.min_score === 0 ? '不限' : `≥ ${p.min_score} 分`}</b>
              </div>
            </div>

            <div className="pref-row">
              <div>
                <strong>回答口吻</strong>
                <small>{schema.tone}</small>
              </div>
              <div>
                <input
                  className="search-field"
                  aria-label="回答口吻"
                  placeholder="如 直接给结论，少铺垫"
                  defaultValue={p.tone}
                  disabled={save.isPending}
                  onBlur={(event) => {
                    if (event.target.value !== p.tone) save.mutate({ key: 'tone', value: event.target.value });
                  }}
                />
                <small className="form-hint">失焦即保存</small>
              </div>
            </div>
          </div>
        </section>
      )}
    </section>
  );
}
