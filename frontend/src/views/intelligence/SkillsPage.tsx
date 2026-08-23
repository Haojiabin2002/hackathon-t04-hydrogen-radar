import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Blocks, Code2, Pencil, Plus, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  apiGet,
  apiMutation,
  SkillDeleteResult,
  SkillsResponse,
  SkillToggleResult,
} from '../../api';
import { ArtPageHead } from '../../components/cards/ArtPageHead';
import { useRouteMeta } from '../../hooks/useRouteMeta';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '请求未能完成';
}

export default function SkillsPage() {
  const meta = useRouteMeta();
  const queryClient = useQueryClient();
  const [deleteKey, setDeleteKey] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const skillsQuery = useQuery({
    queryKey: ['skills'],
    queryFn: () => apiGet<SkillsResponse>('/api/skills'),
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

  return (
    <main className="page">
      <ArtPageHead
        compact
        title={meta?.title ?? '能力技能'}
        description={meta?.description}
        actions={<Link className="btn btn-primary" to="/skills/new"><Plus size={14} />创建自定义技能</Link>}
      />

      {message && <p className="notice" role="status">{message}</p>}
      {(toggleMutation.isError || deleteMutation.isError) && (
        <p className="notice notice-error" role="alert">{errorMessage(toggleMutation.error ?? deleteMutation.error)}</p>
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
          <button className="btn btn-quiet" type="button" onClick={() => skillsQuery.refetch()}>重新加载</button>
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
                <p>启用前必须通过 frontmatter、正文和占位符校验。</p>
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
                        <button className="btn btn-danger" type="button" onClick={() => setDeleteKey(skill.key)}>
                          <Trash2 size={13} />删除
                        </button>
                      </div>
                    </div>
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
