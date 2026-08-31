import { ChangeEvent, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, Blocks, Code2, Copy, Pencil, Play, Plus, Trash2, Upload,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  apiGet,
  apiMutation,
  Lead,
  SkillDeleteResult,
  SkillDocument,
  SkillRunResult,
  SkillSaveResult,
  SkillsResponse,
  SkillToggleResult,
} from '../../api';
import { ArtMarkdown } from '../../components/base/ArtMarkdown';
import { ArtPageHead } from '../../components/cards/ArtPageHead';
import { useRouteMeta } from '../../hooks/useRouteMeta';
import './skills.css';

/**
 * 技能面板 —— 内置执行链（只读）+ 自定义分析技能（可增删改、可试跑）
 *
 * 接口（契约来源 radar/api.py，读取公开、写操作要 X-Radar-Local 头）：
 *   GET    /api/skills            清单 + 占位符表 + 新建模板 + key 规则
 *   GET    /api/skills/{key}      完整 Markdown 原文（含 frontmatter）
 *   PUT    /api/skills/{key}      新建 / 覆盖 / 上传（同一个动词，key 不存在即新建）
 *   POST   /api/skills/{key}/toggle
 *   DELETE /api/skills/{key}
 *   POST   /api/skills/{key}/run  在一条真实线索上跑一次，返回模型输出的分析文本
 *
 * 「上传 .md」= 读本地文件内容 → PUT 到 {文件名去掉 .md} 这个 key，
 * 与新建走的是同一个端点。后端保存前做 frontmatter / 占位符校验，
 * 不合法一律 400，理由**原样**显示在这里，不改写、不吞掉。
 *
 * 试跑会真的调模型：通道不通时后端返回 503，界面如实报错，不给假答案。
 */

/** 与后端 key 规则对齐：中文 / 字母 / 数字 / 下划线 / 连字符，不超过 40 字。 */
const KEY_RE = /^[\w一-鿿-]{1,40}$/;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '请求未能完成';
}

/** 复制时找一个没被占用的 key：foo-副本、foo-副本2… */
function freeCopyKey(base: string, taken: Set<string>): string {
  const stem = `${base}-副本`.slice(0, 40);
  if (!taken.has(stem)) return stem;
  for (let i = 2; i < 50; i += 1) {
    const candidate = `${stem}${i}`.slice(0, 40);
    if (!taken.has(candidate)) return candidate;
  }
  return `${stem}${Date.now()}`.slice(0, 40);
}

function leadLabel(lead: Lead): string {
  const who = lead.company || lead.subject || lead.signal_title || `线索 #${lead.id}`;
  const score = lead.score === null ? '未评分' : `${lead.score} 分`;
  return `#${lead.id} ${who.slice(0, 40)} · ${score}`;
}

export default function SkillsPage() {
  const meta = useRouteMeta();
  const queryClient = useQueryClient();
  const uploadRef = useRef<HTMLInputElement>(null);
  const [deleteKey, setDeleteKey] = useState<string | null>(null);
  const [runKey, setRunKey] = useState<string | null>(null);
  const [runLead, setRunLead] = useState('');
  const [message, setMessage] = useState('');
  const [localError, setLocalError] = useState('');

  const skillsQuery = useQuery({
    queryKey: ['skills'],
    queryFn: () => apiGet<SkillsResponse>('/api/skills'),
  });

  // 试跑要挑一条真实线索。只有展开试跑面板时才拉，平时不占带宽。
  const leadsQuery = useQuery({
    queryKey: ['leads'],
    queryFn: () => apiGet<Lead[]>('/api/leads'),
    enabled: !!runKey,
  });

  const toggleMutation = useMutation({
    mutationFn: (key: string) =>
      apiMutation<SkillToggleResult>(`/api/skills/${encodeURIComponent(key)}/toggle`, 'POST'),
    onSuccess: (result) => {
      setMessage(`技能已${result.enabled ? '启用' : '停用'}。`);
      queryClient.invalidateQueries({ queryKey: ['skills'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (key: string) =>
      apiMutation<SkillDeleteResult>(`/api/skills/${encodeURIComponent(key)}`, 'DELETE'),
    onSuccess: () => {
      setDeleteKey(null);
      setMessage('自定义技能文件已删除。');
      queryClient.invalidateQueries({ queryKey: ['skills'] });
    },
  });

  const saveMutation = useMutation({
    mutationFn: ({ key, content }: { key: string; content: string }) =>
      apiMutation<SkillSaveResult>(`/api/skills/${encodeURIComponent(key)}`, 'PUT', { content }),
    onSuccess: (result) => {
      setMessage(`已保存技能 ${result.key}（${result.name}）。新技能默认按文件里的 enabled 决定是否启用。`);
      queryClient.invalidateQueries({ queryKey: ['skills'] });
    },
  });

  const runMutation = useMutation({
    mutationFn: ({ key, leadId }: { key: string; leadId: number }) =>
      apiMutation<SkillRunResult>(`/api/skills/${encodeURIComponent(key)}/run`, 'POST', { lead_id: leadId }),
  });

  /** 复制：先取原文，再以一个空闲 key PUT 回去。 */
  const copyMutation = useMutation({
    mutationFn: async (key: string) => {
      const doc = await apiGet<SkillDocument>(`/api/skills/${encodeURIComponent(key)}`);
      const taken = new Set((skillsQuery.data?.custom ?? []).map((skill) => skill.key));
      const target = freeCopyKey(key, taken);
      await apiMutation<SkillSaveResult>(`/api/skills/${encodeURIComponent(target)}`, 'PUT', {
        content: doc.content,
      });
      return target;
    },
    onSuccess: (target) => {
      setMessage(`已复制为 ${target}，进去改完再启用。`);
      queryClient.invalidateQueries({ queryKey: ['skills'] });
    },
  });

  async function onUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';          // 同一个文件连传两次也要触发
    if (!file) return;
    setLocalError('');
    const key = file.name.replace(/\.(md|markdown|txt)$/i, '').trim();
    if (!KEY_RE.test(key)) {
      setLocalError(
        `文件名 ${file.name} 不能当技能标识：${skillsQuery.data?.key_rule
          ?? '只能用中文、字母、数字、下划线或连字符，不超过 40 字'}。改名后再传。`,
      );
      return;
    }
    let content = '';
    try {
      content = await file.text();
    } catch (error) {
      setLocalError(`读取本地文件失败：${errorMessage(error)}`);
      return;
    }
    if (!content.trim()) {
      setLocalError(`${file.name} 是空文件。`);
      return;
    }
    if ((skillsQuery.data?.custom ?? []).some((skill) => skill.key === key)) {
      setLocalError(`已存在技能 ${key}：上传会覆盖它。要覆盖请进「编辑」页粘贴内容保存，避免误删你现有的版本。`);
      return;
    }
    saveMutation.mutate({ key, content });
  }

  const runError = runMutation.isError ? errorMessage(runMutation.error) : '';
  const saveError = saveMutation.isError ? errorMessage(saveMutation.error) : '';

  return (
    <main className="page skills-page">
      <ArtPageHead
        compact
        title={meta?.title ?? '能力技能'}
        description={meta?.description}
        actions={(
          <>
            <button className="btn btn-quiet" type="button" onClick={() => uploadRef.current?.click()}>
              <Upload size={14} />上传 .md 文件
            </button>
            <Link className="btn btn-primary" to="/skills/new"><Plus size={14} />创建自定义技能</Link>
            <input
              ref={uploadRef}
              className="visually-hidden-input"
              type="file"
              accept=".md,.markdown,text/markdown"
              onChange={(event) => void onUpload(event)}
            />
          </>
        )}
      />

      {message && <p className="notice" role="status">{message}</p>}
      {localError && <p className="notice notice-error" role="alert">{localError}</p>}
      {saveError && (
        <div role="alert">
          <p className="notice notice-error">后端拒绝保存这份技能文件，校验结果原文如下：</p>
          <pre className="detail-pre">{saveError}</pre>
        </div>
      )}
      {(toggleMutation.isError || deleteMutation.isError || copyMutation.isError) && (
        <p className="notice notice-error" role="alert">
          {errorMessage(toggleMutation.error ?? deleteMutation.error ?? copyMutation.error)}
        </p>
      )}

      {skillsQuery.isLoading && (
        <section className="panel loading-stack" aria-busy="true" aria-label="正在加载技能">
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line" />
        </section>
      )}

      {skillsQuery.isError && (
        <div className="error-state" role="alert">
          <AlertTriangle />
          <h2>技能列表没有加载成功</h2>
          <p>{errorMessage(skillsQuery.error)}</p>
          <button className="btn btn-quiet" type="button" onClick={() => void skillsQuery.refetch()}>重新加载</button>
        </div>
      )}

      {skillsQuery.data && (
        <div className="stack">
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>内置执行链</h2>
                <p>这些能力对应真实代码路径，界面只展示，不伪装成可编辑 Prompt。</p>
              </div>
              <span className="badge badge-success">{skillsQuery.data.builtin.length} 项</span>
            </div>
            <div className="skill-list panel-body">
              {skillsQuery.data.builtin.map((skill) => (
                <article className="skill-row" key={skill.name}>
                  <div className="skill-row-head">
                    <div>
                      <div className="toolbar-group">
                        <span aria-hidden="true">{skill.icon}</span>
                        <h3>{skill.name}</h3>
                      </div>
                      <p>{skill.description}</p>
                    </div>
                    <span className="badge badge-neutral"><Code2 size={11} />代码实现</span>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>自定义分析技能</h2>
                <p>
                  每个技能是一份 Markdown：frontmatter 是元数据，正文是提示词。
                  点「编辑」看得到完整原文。启用前必须通过 frontmatter、正文和占位符校验。
                </p>
              </div>
              <span className="badge badge-neutral">{skillsQuery.data.custom.length} 项</span>
            </div>

            {!skillsQuery.data.custom.length && (
              <div className="empty-state">
                <Blocks />
                <h2>还没有自定义技能</h2>
                <p>创建后可以在单条线索上运行，模型输出只是一段分析文本。</p>
                <Link className="btn btn-primary" to="/skills/new">创建第一个技能</Link>
              </div>
            )}

            {!!skillsQuery.data.custom.length && (
              <div className="skill-list panel-body">
                {skillsQuery.data.custom.map((skill) => (
                  <article className="skill-row" key={skill.key}>
                    <div className="skill-row-head">
                      <div>
                        <div className="toolbar-group">
                          <span aria-hidden="true">{skill.icon}</span>
                          <h3>{skill.name}</h3>
                          <span className={skill.problems.length ? 'badge badge-danger' : skill.enabled ? 'badge badge-success' : 'badge badge-neutral'}>
                            {skill.problems.length ? '配置有误' : skill.enabled ? '已启用' : '已停用'}
                          </span>
                          <span className="badge badge-neutral">适用：{skill.scope === 'lead' ? '单条线索' : skill.scope}</span>
                          <span className="badge badge-neutral">{skill.key}.md</span>
                        </div>
                        <p>{skill.description || '未填写技能说明'}</p>
                        {!!skill.problems.length && <p className="notice notice-error">{skill.problems.join('；')}</p>}
                      </div>
                      <div className="row-actions">
                        <button
                          className={skill.enabled ? 'switch is-on' : 'switch'}
                          type="button"
                          role="switch"
                          aria-checked={skill.enabled}
                          aria-label={`${skill.enabled ? '停用' : '启用'} ${skill.name}`}
                          disabled={toggleMutation.isPending || !!skill.problems.length}
                          onClick={() => toggleMutation.mutate(skill.key)}
                        />
                        <Link className="btn btn-quiet" to={`/skills/${encodeURIComponent(skill.key)}/edit`}>
                          <Pencil size={13} />编辑
                        </Link>
                        <button
                          className="btn btn-quiet"
                          type="button"
                          disabled={!!skill.problems.length}
                          title={skill.problems.length ? '技能当前不合法，先修好再试跑' : '在一条真实线索上跑一次'}
                          onClick={() => {
                            runMutation.reset();
                            setRunKey(runKey === skill.key ? null : skill.key);
                          }}
                        >
                          <Play size={13} />试跑
                        </button>
                        <button
                          className="btn btn-quiet"
                          type="button"
                          disabled={copyMutation.isPending}
                          onClick={() => copyMutation.mutate(skill.key)}
                        >
                          <Copy size={13} />复制
                        </button>
                        <button className="btn btn-danger" type="button" onClick={() => setDeleteKey(skill.key)}>
                          <Trash2 size={13} />删除
                        </button>
                      </div>
                    </div>

                    {runKey === skill.key && (
                      <div className="skill-run" aria-label={`试跑 ${skill.name}`}>
                        <div className="skill-run-form">
                          <label htmlFor={`run-lead-${skill.key}`} className="section-label">选一条线索</label>
                          <select
                            id={`run-lead-${skill.key}`}
                            value={runLead}
                            disabled={leadsQuery.isLoading}
                            onChange={(event) => setRunLead(event.target.value)}
                          >
                            <option value="">
                              {leadsQuery.isLoading ? '正在加载线索…' : '未选择'}
                            </option>
                            {(leadsQuery.data ?? []).slice(0, 50).map((lead) => (
                              <option key={lead.id} value={String(lead.id)}>{leadLabel(lead)}</option>
                            ))}
                          </select>
                          <button
                            className="btn btn-primary"
                            type="button"
                            disabled={!runLead || runMutation.isPending}
                            onClick={() => runMutation.mutate({ key: skill.key, leadId: Number(runLead) })}
                          >
                            <Play size={13} />{runMutation.isPending ? '模型正在跑…' : '运行'}
                          </button>
                        </div>
                        <p className="skill-run-hint">
                          试跑会真的调一次模型，只读这条线索的受限字段，不写库、不调工具。
                          通道不可用时会如实报错，不会给你一段假答案。
                        </p>
                        {leadsQuery.isError && (
                          <p className="notice notice-error" role="alert">线索列表没加载成功：{errorMessage(leadsQuery.error)}</p>
                        )}
                        {!leadsQuery.isLoading && !leadsQuery.isError && !(leadsQuery.data ?? []).length && (
                          <p className="notice notice-warning">库里还没有线索，先跑一轮采集再来试跑。</p>
                        )}
                        {runError && (
                          <div role="alert">
                            <p className="notice notice-error">这次试跑没有成功，后端原文如下：</p>
                            <pre className="detail-pre">{runError}</pre>
                          </div>
                        )}
                        {runMutation.data && runMutation.data.key === skill.key && (
                          <div className="skill-run-answer">
                            <span className="section-label">
                              {runMutation.data.name} · 线索 #{runMutation.data.lead_id} 的模型输出
                            </span>
                            <ArtMarkdown source={runMutation.data.answer} />
                          </div>
                        )}
                      </div>
                    )}

                    {deleteKey === skill.key && (
                      <div className="inline-confirm" role="group" aria-label={`确认删除技能 ${skill.name}`}>
                        <span>删除后对应 Markdown 文件会移除，无法从界面恢复。</span>
                        <div>
                          <button className="btn btn-quiet" type="button" disabled={deleteMutation.isPending} onClick={() => setDeleteKey(null)}>取消</button>
                          <button className="btn btn-danger" type="button" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate(skill.key)}>
                            {deleteMutation.isPending ? '正在删除…' : '确认删除'}
                          </button>
                        </div>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
