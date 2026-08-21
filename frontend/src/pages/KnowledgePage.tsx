import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BookOpenText, CheckCircle2, Save } from 'lucide-react';
import { apiGet, apiMutation, KnowledgeDocument, KnowledgeSaveResult } from '../api';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '请求未能完成';
}

export default function KnowledgePage() {
  const queryClient = useQueryClient();
  const [content, setContent] = useState('');
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState<'edit' | 'structure'>('edit');
  const [savedNote, setSavedNote] = useState('');

  const knowledgeQuery = useQuery({
    queryKey: ['knowledge'],
    queryFn: () => apiGet<KnowledgeDocument>('/api/knowledge'),
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
      <header className="page-head">
        <div>
          <span className="page-kicker">DECISION KNOWLEDGE</span>
          <h1 className="page-title">研判知识库</h1>
          <p className="page-intro">这里定义行业分类、评分权重与产品判断规则。保存前由后端解析校验，不合法的内容不会覆盖现有知识。</p>
        </div>
        <button className="btn btn-primary" type="button" disabled={!dirty || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
          <Save size={14} />{saveMutation.isPending ? '正在校验并保存…' : dirty ? '保存知识库' : '内容已保存'}
        </button>
      </header>

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
                <button className={mode === 'edit' ? 'filter-chip is-active' : 'filter-chip'} type="button" role="tab" aria-selected={mode === 'edit'} onClick={() => setMode('edit')}>Markdown 编辑</button>
                <button className={mode === 'structure' ? 'filter-chip is-active' : 'filter-chip'} type="button" role="tab" aria-selected={mode === 'structure'} onClick={() => setMode('structure')}>结构检查</button>
              </div>
            </div>

            {mode === 'edit' ? (
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
                  <span className="page-kicker">SECTIONS</span>
                  <div className="toolbar-group">
                    {sections.length
                      ? sections.map((section) => <span className="badge badge-info" key={section}>{section}</span>)
                      : <span className="badge badge-warning">没有可识别章节</span>}
                  </div>
                </div>
                <div>
                  <span className="page-kicker">SCORING WEIGHTS</span>
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
                  <span className="page-kicker">INDUSTRY TAXONOMY</span>
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
