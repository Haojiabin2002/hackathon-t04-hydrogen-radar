import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, BookOpenText, CheckCircle2, Save } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiGet, apiMutation, KnowledgeDocument, KnowledgeSaveResult } from '../../api';
import { apiGetText } from '../../api/client';
import { ArtMarkdown } from '../../components/base/ArtMarkdown';
import { ArtPageHead } from '../../components/cards/ArtPageHead';
import { useRouteMeta } from '../../hooks/useRouteMeta';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '请求未能完成';
}

/**
 * 契约主文件 knowledge.md 的编辑页。
 *
 * 这一页的行为**刻意与多文件改造之前逐字一致**：读 GET /api/knowledge（解析后）
 * 与 GET /api/knowledge/raw（文件原文），保存走 PUT /api/knowledge。
 * 后端在那个端点上做 parse_kb + validate_kb —— 它是保护打分链路的闸，
 * 校验失败时把后端 detail 原样显示出来，不要在前端加任何"重试/降级"包装。
 *
 * 附加文档（knowledge/*.md）走的是另一套接口，不经这里。
 */
export default function KnowledgeMainPage() {
  const meta = useRouteMeta();
  const queryClient = useQueryClient();
  const [content, setContent] = useState('');
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState<'read' | 'edit' | 'structure'>('read');
  const [savedNote, setSavedNote] = useState('');

  const knowledgeQuery = useQuery({
    queryKey: ['knowledge'],
    queryFn: () => apiGet<KnowledgeDocument>('/api/knowledge'),
  });

  /**
   * 阅读态读的是 GET /api/knowledge/raw —— knowledge.md 的**文件原文**，
   * 而不是 /api/knowledge 解析后的 content。两者当下同源，但接口契约不同：
   * raw 保证一字不改（含 frontmatter），阅读态要的就是这个。
   */
  const rawQuery = useQuery({
    queryKey: ['knowledge-raw'],
    queryFn: () => apiGetText('/api/knowledge/raw'),
  });

  useEffect(() => {
    if (knowledgeQuery.data && !dirty) setContent(knowledgeQuery.data.content);
  }, [dirty, knowledgeQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () => apiMutation<KnowledgeSaveResult>('/api/knowledge', 'PUT', { content }),
    onSuccess: (result) => {
      setDirty(false);
      setSavedNote(result.note);
      queryClient.invalidateQueries({ queryKey: ['knowledge'] });
      queryClient.invalidateQueries({ queryKey: ['knowledge-raw'] });
    },
  });

  const sections = useMemo(
    () => Object.keys(knowledgeQuery.data?.sections ?? {}),
    [knowledgeQuery.data?.sections],
  );
  const taxonomy = 'industry_taxonomy' in (knowledgeQuery.data?.meta ?? {})
    ? knowledgeQuery.data?.meta.industry_taxonomy ?? []
    : [];
  const weights = 'scoring_weights' in (knowledgeQuery.data?.meta ?? {})
    ? knowledgeQuery.data?.meta.scoring_weights ?? {}
    : {};

  return (
    <main className="page">
      <ArtPageHead
        compact
        back={<Link className="btn btn-link" to="/knowledge"><ArrowLeft size={14} />返回知识库文件</Link>}
        title={meta?.title ?? '主知识库 knowledge.md'}
        description={meta?.description}
        actions={<button className="btn btn-primary" type="button" disabled={!dirty || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            <Save size={14} />{saveMutation.isPending ? '正在校验并保存…' : dirty ? '保存知识库' : '内容已保存'}
          </button>}
      />

      {knowledgeQuery.isLoading && (
        <section className="panel loading-stack" aria-busy="true" aria-label="正在加载知识库">
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line" />
        </section>
      )}

      {knowledgeQuery.isError && (
        <div className="error-state" role="alert">
          <AlertTriangle />
          <h2>知识库没有加载成功</h2>
          <p>{errorMessage(knowledgeQuery.error)}</p>
          <button className="btn btn-quiet" type="button" onClick={() => knowledgeQuery.refetch()}>重新加载</button>
        </div>
      )}

      {knowledgeQuery.data && (
        <>
          {!!knowledgeQuery.data.problems.length && (
            <div className="notice notice-warning" role="alert">
              <strong>当前知识存在 {knowledgeQuery.data.problems.length} 个问题：</strong>
              {knowledgeQuery.data.problems.join('；')}
            </div>
          )}
          {savedNote && <p className="notice" role="status"><CheckCircle2 size={14} /> {savedNote}</p>}
          {saveMutation.isError && <p className="notice notice-error" role="alert">{errorMessage(saveMutation.error)}</p>}

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>知识正文</h2>
                <p>{dirty ? '有尚未保存的本地改动' : '当前展示来自服务器文件'}</p>
              </div>
              <div className="toolbar-group" role="tablist" aria-label="知识库查看模式">
                <button className={mode === 'read' ? 'filter-chip is-active' : 'filter-chip'} type="button" role="tab" aria-selected={mode === 'read'} onClick={() => setMode('read')}>阅读原文</button>
                <button className={mode === 'edit' ? 'filter-chip is-active' : 'filter-chip'} type="button" role="tab" aria-selected={mode === 'edit'} onClick={() => setMode('edit')}>Markdown 编辑</button>
                <button className={mode === 'structure' ? 'filter-chip is-active' : 'filter-chip'} type="button" role="tab" aria-selected={mode === 'structure'} onClick={() => setMode('structure')}>结构检查</button>
              </div>
            </div>

            {mode === 'read' ? (
              <div className="panel-body">
                {rawQuery.isLoading && (
                  <div className="loading-stack" aria-busy="true" aria-label="正在加载知识库原文">
                    <div className="skeleton skeleton-line" />
                    <div className="skeleton skeleton-line" />
                  </div>
                )}
                {rawQuery.isError && (
                  <div className="notice notice-error" role="alert">
                    读取 knowledge.md 原文失败：{errorMessage(rawQuery.error)}
                    <button className="btn btn-quiet" type="button" onClick={() => void rawQuery.refetch()}>重新加载</button>
                  </div>
                )}
                {rawQuery.isSuccess && (
                  rawQuery.data.trim()
                    ? <ArtMarkdown source={rawQuery.data} />
                    : <div className="notice notice-warning">GET /api/knowledge/raw 返回了空内容——文件是空的，或者后端没读到它。</div>
                )}
                {dirty && (
                  <p className="form-hint">
                    编辑区里有尚未保存的改动。这里显示的是服务器上的文件原文，看到的不是你正在改的那一版。
                  </p>
                )}
              </div>
            ) : mode === 'edit' ? (
              <div className="panel-body">
                <div className="field">
                  <label htmlFor="knowledge-content">Markdown 原文</label>
                  <textarea
                    id="knowledge-content"
                    className="markdown-editor"
                    spellCheck={false}
                    value={content}
                    onChange={(event) => {
                      setContent(event.target.value);
                      setDirty(event.target.value !== knowledgeQuery.data.content);
                      setSavedNote('');
                    }}
                  />
                  <small>保存会影响之后新研判的线索，不会自动重算已入库分数。</small>
                </div>
              </div>
            ) : (
              <div className="panel-body stack">
                <div>
                  <span className="section-label">章节</span>
                  <div className="toolbar-group">
                    {sections.length
                      ? sections.map((section) => <span className="badge badge-info" key={section}>{section}</span>)
                      : <span className="badge badge-warning">没有可识别章节</span>}
                  </div>
                </div>
                <div>
                  <span className="section-label">评分权重</span>
                  <div className="table-shell">
                    <table className="data-table">
                      <thead><tr><th>维度</th><th>权重</th></tr></thead>
                      <tbody>
                        {Object.entries(weights).map(([key, value]) => <tr key={key}><td>{key}</td><td>{value}</td></tr>)}
                        {!Object.keys(weights).length && <tr><td colSpan={2} className="cell-muted">未解析出评分权重</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div>
                  <span className="section-label">行业分类</span>
                  <div className="toolbar-group">
                    {taxonomy.length
                      ? taxonomy.map((item) => <span className="badge badge-neutral" key={item}>{item}</span>)
                      : <span className="badge badge-warning">未解析出行业分类</span>}
                  </div>
                </div>
              </div>
            )}
          </section>
        </>
      )}

      {!knowledgeQuery.isLoading && !knowledgeQuery.isError && !knowledgeQuery.data && (
        <div className="empty-state">
          <BookOpenText />
          <h2>没有可读取的知识库</h2>
          <p>服务器没有返回知识内容。</p>
        </div>
      )}
    </main>
  );
}
