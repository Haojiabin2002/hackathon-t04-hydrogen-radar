import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, FileText, Lock, Pencil, Plus, ShieldCheck, Trash2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  apiGet,
  apiMutation,
  KnowledgeFileDeleteResult,
  KnowledgeFileEntry,
  KnowledgeFilesResponse,
} from '../../api';
import { ArtPageHead } from '../../components/cards/ArtPageHead';
import { useRouteMeta } from '../../hooks/useRouteMeta';
import './knowledge.css';

/**
 * 知识库文件清单页 · 一个主文件 + 若干附加文档
 *
 * 数据来自 GET /api/knowledge/files（读取公开，不需要口令）。后端保证
 * files[0] 是 kind:"main" 的 knowledge.md，剩下的是 kind:"doc" 的附加文档。
 *
 * 两类文件走的是**两套不同的编辑通道**，这里刻意不混：
 *  · 主文件 → /knowledge/main，保存打 PUT /api/knowledge，后端做 parse_kb + validate_kb；
 *    它的 frontmatter 与四个必需小节被打分链路直接消费，改错了整条管线会失效。
 *  · 附加文档 → /knowledge/files/:docName/edit，保存打 PUT /api/knowledge/files/{name}，
 *    只做文件名与体积校验；这些文档不进提示词，是给 agent 用 read_knowledge 按需取用的资料。
 */

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '请求未能完成';
}

/** 后端给的是字节数，列表里显示成人看的量级。 */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '空文件';
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/** mtime 是 ISO 本地时间串（如 2026-08-30T00:51:32），只取到分钟。 */
function formatMtime(mtime: string): string {
  if (!mtime) return '时间未知';
  return mtime.replace('T', ' ').slice(0, 16);
}

export default function KnowledgePage() {
  const meta = useRouteMeta();
  const queryClient = useQueryClient();
  const [deleteName, setDeleteName] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const filesQuery = useQuery({
    queryKey: ['knowledge-files'],
    queryFn: () => apiGet<KnowledgeFilesResponse>('/api/knowledge/files'),
  });

  const deleteMutation = useMutation({
    mutationFn: (name: string) =>
      apiMutation<KnowledgeFileDeleteResult>(`/api/knowledge/files/${encodeURIComponent(name)}`, 'DELETE'),
    onSuccess: (result) => {
      setDeleteName(null);
      setMessage(`知识文档 ${result.deleted} 已从 knowledge/ 目录删除。`);
      queryClient.invalidateQueries({ queryKey: ['knowledge-files'] });
    },
  });

  const files = filesQuery.data?.files ?? [];
  const main = files.find((file): file is KnowledgeFileEntry => file.kind === 'main');
  const docs = files.filter((file) => file.kind === 'doc');

  return (
    <main className="page">
      <ArtPageHead
        compact
        title={meta?.title ?? '知识库'}
        description={meta?.description}
        actions={<Link className="btn btn-primary" to="/knowledge/files/new"><Plus size={14} />新建知识文档</Link>}
      />

      {message && <p className="notice" role="status">{message}</p>}
      {deleteMutation.isError && (
        <p className="notice notice-error" role="alert">{errorMessage(deleteMutation.error)}</p>
      )}

      {filesQuery.isLoading && (
        <section className="panel loading-stack" aria-busy="true" aria-label="正在加载知识库文件">
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line" />
        </section>
      )}

      {filesQuery.isError && (
        <div className="error-state" role="alert">
          <AlertTriangle />
          <h2>知识库文件清单没有加载成功</h2>
          <p>{errorMessage(filesQuery.error)}</p>
          <button className="btn btn-quiet" type="button" onClick={() => void filesQuery.refetch()}>重新加载</button>
        </div>
      )}

      {filesQuery.data && (
        <div className="stack">
          {!!filesQuery.data.problems.length && (
            <div className="notice notice-warning" role="alert">
              <strong>目录级问题：</strong>{filesQuery.data.problems.join('；')}
            </div>
          )}

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>契约主文件</h2>
                <p>只有这一份进管线提示词。它的结构由后端校验把关，不是普通文档。</p>
              </div>
              <span className="badge badge-warning"><Lock size={11} />受校验保护</span>
            </div>
            <div className="skill-list panel-body">
              {main ? (
                <article className="skill-row kb-file-row">
                  <div className="skill-row-head">
                    <div>
                      <div className="toolbar-group">
                        <ShieldCheck size={14} aria-hidden="true" />
                        <h3>{main.title}</h3>
                        <span className="badge badge-info">knowledge.md</span>
                      </div>
                      <p>{main.purpose}</p>
                      <p className="form-hint">
                        正文里的「产品谱系 / 区域优先级 / 商机判定规则 / 评分口径」四节，
                        以及 frontmatter 里的评分权重与行业分类，被抽取、打分、配型三段提示词直接消费。
                        保存走 PUT /api/knowledge，后端会先解析再校验，不合法的内容不会覆盖现有知识。
                      </p>
                      {main.problem && <p className="notice notice-error">{main.problem}</p>}
                      <p className="kb-file-meta">
                        {formatBytes(main.bytes)} · 修改于 {formatMtime(main.mtime)}
                      </p>
                    </div>
                    <div className="row-actions">
                      <Link className="btn btn-primary" to="/knowledge/main">
                        <Pencil size={13} />编辑
                      </Link>
                    </div>
                  </div>
                </article>
              ) : (
                <p className="notice notice-error">后端没有返回主文件条目，请检查 radar/knowledge.md 是否存在。</p>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>附加知识文档</h2>
                <p>
                  存放在 radar/{filesQuery.data.dir}/ 目录。它们不参与提示词装配，
                  agent 需要时用 read_knowledge 按需取用，人也可以直接翻阅。
                </p>
              </div>
              <span className="badge badge-neutral">{docs.length} 篇</span>
            </div>

            {!docs.length && (
              <div className="empty-state">
                <FileText />
                <h2>还没有附加知识文档</h2>
                <p>把调研结论、合作资源、行业背景这类资料拆成单篇存进来，便于按需引用。</p>
                <Link className="btn btn-primary" to="/knowledge/files/new">新建第一篇文档</Link>
              </div>
            )}

            {!!docs.length && (
              <div className="skill-list panel-body">
                {docs.map((doc) => (
                  <article className="skill-row kb-file-row" key={doc.name}>
                    <div className="skill-row-head">
                      <div>
                        <div className="toolbar-group">
                          <FileText size={14} aria-hidden="true" />
                          <h3>{doc.title}</h3>
                          <span className="badge badge-neutral">{doc.name}</span>
                          {doc.updated && <span className="badge badge-info">更新于 {doc.updated}</span>}
                        </div>
                        <p>{doc.purpose || '这篇文档没有写 purpose，建议在 frontmatter 里补一句用途。'}</p>
                        {doc.problem && <p className="notice notice-error">{doc.problem}</p>}
                        <p className="kb-file-meta">
                          {formatBytes(doc.bytes)} · 修改于 {formatMtime(doc.mtime)}
                        </p>
                      </div>
                      <div className="row-actions">
                        <Link className="btn btn-quiet" to={`/knowledge/files/${encodeURIComponent(doc.name)}/edit`}>
                          <Pencil size={13} />编辑
                        </Link>
                        <button className="btn btn-danger" type="button" onClick={() => setDeleteName(doc.name)}>
                          <Trash2 size={13} />删除
                        </button>
                      </div>
                    </div>
                    {deleteName === doc.name && (
                      <div className="inline-confirm" role="group" aria-label={`确认删除知识文档 ${doc.name}`}>
                        <span>删除后 knowledge/{doc.name} 会从磁盘移除，无法从界面恢复。</span>
                        <div>
                          <button className="btn btn-quiet" type="button" disabled={deleteMutation.isPending} onClick={() => setDeleteName(null)}>取消</button>
                          <button className="btn btn-danger" type="button" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate(doc.name)}>
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
