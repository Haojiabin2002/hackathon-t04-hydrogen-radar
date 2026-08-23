import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Settings2, Wrench, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiGet, apiMutation } from '../../api/client';
import type {
  AgentToolsResponse, MemoryItem, PreferenceInput, PreferencesResponse,
} from '../../api/types';

/**
 * Agent 模式的侧栏：让 agent 的"上下文"可见。
 *
 * 模型每轮都会读到偏好、记忆、技能目录和知识目录。这些东西影响它的回答，
 * 却看不见——所以在这里摊开，让销售知道 agent 是带着什么在思考。
 */
export function AgentSidebar() {
  const queryClient = useQueryClient();

  const tools = useQuery({
    queryKey: ['agent-tools'],
    queryFn: () => apiGet<AgentToolsResponse>('/api/agent/tools'),
    staleTime: 5 * 60_000,
  });
  const prefs = useQuery({
    queryKey: ['preferences'],
    queryFn: () => apiGet<PreferencesResponse>('/api/preferences'),
  });
  const memory = useQuery({
    queryKey: ['memory'],
    queryFn: () => apiGet<MemoryItem[]>('/api/memory'),
  });

  const savePref = useMutation({
    mutationFn: (input: PreferenceInput) => apiMutation('/api/preferences', 'PUT', input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['preferences'] }),
  });

  const p = prefs.data?.preferences;
  const activePrefs = p
    ? ([
        ['focus_regions', '关注区域', p.focus_regions],
        ['focus_products', '关注产品', p.focus_products],
        ['exclude_regions', '排除区域', p.exclude_regions],
      ] as const).filter(([, , v]) => v.length > 0)
    : [];

  const dropTag = (key: 'focus_regions' | 'focus_products' | 'exclude_regions', value: string) => {
    if (!p) return;
    savePref.mutate({ key, value: p[key].filter((v) => v !== value) });
  };

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <div><h2>Agent 的上下文</h2><p>每一轮都会读到这些</p></div>
          <Link className="icon-btn" to="/settings/preferences" aria-label="编辑偏好">
            <Settings2 size={16} aria-hidden="true" />
          </Link>
        </div>
        <div className="panel-body">
          {prefs.isLoading ? <div className="skeleton skeleton-line" /> : (
            <>
              <p className="form-hint" style={{ marginBottom: 8 }}>
                <b>偏好</b>
                {p && p.min_score > 0 && <> · 只看 ≥{p.min_score} 分</>}
              </p>
              {activePrefs.length === 0 && p?.min_score === 0 ? (
                <p className="form-hint">
                  尚未设置。<Link className="btn-link" to="/settings/preferences">去设置</Link>
                </p>
              ) : (
                activePrefs.map(([key, label, values]) => (
                  <div key={key} style={{ marginBottom: 8 }}>
                    <small className="form-hint">{label}</small>
                    <div className="pref-tags">
                      {values.map((v) => (
                        <span className="pref-tag" key={v}>
                          {v}
                          <button type="button" aria-label={`移除 ${v}`} onClick={() => dropTag(key, v)}>
                            <X size={11} aria-hidden="true" />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </>
          )}

          <p className="form-hint" style={{ margin: '14px 0 6px' }}>
            <b>记忆</b> · {memory.data?.length ?? 0} 条
          </p>
          {(memory.data ?? []).slice(-4).map((m) => (
            <p className="form-hint" key={m.id}>· {m.content}</p>
          ))}
          {memory.isSuccess && !memory.data?.length && (
            <p className="form-hint">暂无。对话里说「记住…」即可写入。</p>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div><h2>可用工具</h2><p>全部由后端代码执行</p></div>
          <Wrench size={16} aria-hidden="true" />
        </div>
        <div className="panel-body">
          {tools.isLoading && <div className="skeleton skeleton-line" />}
          {(tools.data?.tools ?? []).map((tool) => (
            <div className="source-row" key={tool.name}>
              <div className="source-row-head">
                <code style={{ fontSize: 12, fontWeight: 600 }}>{tool.name}</code>
                {tool.requires_confirm && (
                  <span className="badge badge-inferred">
                    <Lock size={10} aria-hidden="true" /> 需确认
                  </span>
                )}
              </div>
              <small className="form-hint">{tool.description}</small>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
