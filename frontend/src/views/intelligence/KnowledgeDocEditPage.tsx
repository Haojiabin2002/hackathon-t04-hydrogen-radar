import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Save, Trash2 } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  apiMutation,
  KnowledgeFileDeleteResult,
  KnowledgeFileSaveResult,
} from '../../api';
import { apiGetText } from '../../api/client';
import { ArtMarkdown } from '../../components/base/ArtMarkdown';
import { ArtPageHead } from '../../components/cards/ArtPageHead';
import { useRouteMeta } from '../../hooks/useRouteMeta';

/**
 * 附加知识文档的单文件编辑页 —— radar/knowledge/*.md
 *
 * 接口（契约来源 radar/api.py）：
 *   GET    /api/knowledge/files/{name}   读原文，text/plain，读取公开
 *   PUT    /api/knowledge/files/{name}   新建或覆盖（同一个动词），body 是 { content }
 *   DELETE /api/knowledge/files/{name}   删除
 * 写操作要 X-Radar-Local 头，apiMutation 已经带上了。
 *
 * 这里编辑的文档**不进 pipeline 的提示词**——它们是 agent 用 read_knowledge
 * 按需取用的资料。要改打分口径请去主知识库 knowledge.md（/knowledge/main），
 * 那条通道才有 parse_kb + validate_kb 校验。
 *
 * 文件名规则与后端 KB_DOC_NAME_RE 对齐：中文 / 字母 / 数字 / 下划线 / 连字符，
 * 不超过 60 字，加 .md 后缀。前端先拦一道只是为了少一次往返，
 * 真正的闸在后端（正则 + realpath 复核），非法名一律 400。
 */

const STARTER = `---
title: 新建知识文档
用途: 一句话说明这份资料在什么场景下会被引用
来源: 写清出处，便于后续核对
更新日期: ${new Date().toISOString().slice(0, 10)}
---

# 标题

## 小节

正文写真实可核对的结论，每条尽量带出处链接。
`;

/** 与后端 ^[\w一-龥-]{1,60}\.md$ 对齐的文件名主干校验。 */
const STEM_RE = /^[\w一-龥-]{1,60}$/;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '请求未能完成';
}

/** 用户可以只填主干，也可以连 .md 一起填；统一补成带后缀的文件名。 */
function toFileName(stem: string): string {
  const trimmed = stem.trim();
  return trimmed.endsWith('.md') ? trimmed : `${trimmed}.md`;
}

export default function KnowledgeDocEditPage() {
  const meta = useRouteMeta();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { docName } = useParams();
  const isNew = !docName;

  // 编辑既有文档时文件名固定；新建时才让人填。两种情况都存主干（不含 .md）。
  const [stem, setStem] = useState(isNew ? '' : (docName ?? '').replace(/\.md$/, ''));
  const [content, setContent] = useState(isNew ? STARTER : '');
  const [dirty, setDirty] = useState(isNew);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [loadedName, setLoadedName] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const docQuery = useQuery({
    queryKey: ['knowledge-file', docName],
    queryFn: () => apiGetText(`/api/knowledge/files/${encodeURIComponent(docName ?? '')}`),
    enabled: !isNew,
  });

  useEffect(() => {
    if (!isNew && docQuery.isSuccess && loadedName !== docName) {
      setContent(docQuery.data);
      setDirty(false);
      setLoadedName(docName ?? null);
    }
  }, [docName, docQuery.data, docQuery.isSuccess, isNew, loadedName]);

  const fileName = toFileName(stem);
  const nameValid = STEM_RE.test(fileName.replace(/\.md$/, ''));

  const saveMutation = useMutation({
    mutationFn: (name: string) =>
      apiMutation<KnowledgeFileSaveResult>(
        `/api/knowledge/files/${encodeURIComponent(name)}`,
        'PUT',
        { content },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-files'] });
      queryClient.invalidateQueries({ queryKey: ['knowledge-file', fileName] });
      navigate('/knowledge');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (name: string) =>
      apiMutation<KnowledgeFileDeleteResult>(`/api/knowledge/files/${encodeURIComponent(name)}`, 'DELETE'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-files'] });
      navigate('/knowledge');
    },
  });

  const byteLength = useMemo(() => new TextEncoder().encode(content).length, [content]);
  const tooLarge = byteLength > 512 * 1024;
  const hasFrontmatter = content.startsWith('---');

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!nameValid || !content.trim() || tooLarge) return;
    saveMutation.mutate(fileName);
  }

  if (!isNew && docQuery.isLoading) {
    return (
      <main className="page">
        <section className="panel loading-stack" aria-busy="true" aria-label="正在加载知识文档">
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line" />
        </section>
      </main>
    );
  }

  if (!isNew && docQuery.isError) {
    return (
      <main className="page">
        <div className="error-state" role="alert">
          <AlertTriangle />
          <h1>知识文档没有加载成功</h1>
          <p>{errorMessage(docQuery.error)}</p>
          <Link className="btn btn-quiet" to="/knowledge">返回知识库文件</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <ArtPageHead
        compact
        back={<Link className="btn btn-link" to="/knowledge"><ArrowLeft size={14} />返回知识库文件</Link>}
        title={isNew ? '新建知识文档' : `编辑 ${docName ?? ''}`}
        description={meta?.description}
        actions={
          <button
            className="btn btn-primary"
            type="submit"
            form="knowledge-doc-form"
            disabled={!dirty || !nameValid || !content.trim() || tooLarge || saveMutation.isPending}
          >
            <Save size={14} />{saveMutation.isPending ? '正在保存…' : '保存文档'}
          </button>
        }
      />

      {saveMutation.isError && <p className="notice notice-error" role="alert">{errorMessage(saveMutation.error)}</p>}
      {deleteMutation.isError && <p className="notice notice-error" role="alert">{errorMessage(deleteMutation.error)}</p>}

      <form id="knowledge-doc-form" className="dashboard-grid" onSubmit={submit}>
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>文档内容</h2>
              <p>{dirty ? '有尚未保存的本地改动' : '与服务器内容一致'}</p>
            </div>
            <div className="toolbar-group" role="tablist" aria-label="文档查看模式">
              <button className={mode === 'edit' ? 'filter-chip is-active' : 'filter-chip'} type="button" role="tab" aria-selected={mode === 'edit'} onClick={() => setMode('edit')}>Markdown 编辑</button>
              <button className={mode === 'preview' ? 'filter-chip is-active' : 'filter-chip'} type="button" role="tab" aria-selected={mode === 'preview'} onClick={() => setMode('preview')}>渲染预览</button>
            </div>
          </div>

          <div className="panel-body form-grid">
            <div className="field is-wide">
              <label htmlFor="knowledge-doc-name">文件名</label>
              <input
                id="knowledge-doc-name"
                required
                maxLength={60}
                readOnly={!isNew}
                value={stem}
                onChange={(event) => {
                  setStem(event.target.value);
                  setDirty(true);
                }}
                placeholder="例如：合作资源图"
              />
              <small>
                {!stem || nameValid
                  ? `保存为 knowledge/${stem ? fileName : '<文件名>.md'}；可用中文、字母、数字、下划线和连字符，不超过 60 字。`
                  : '文件名不合法：只能用中文、字母、数字、下划线或连字符，不超过 60 字。'}
              </small>
            </div>

            {mode === 'edit' ? (
              <div className="field is-wide">
                <label htmlFor="knowledge-doc-content">Markdown 原文</label>
                <textarea
                  id="knowledge-doc-content"
                  className="markdown-editor"
                  spellCheck={false}
                  value={content}
                  onChange={(event) => {
                    setContent(event.target.value);
                    setDirty(true);
                  }}
                />
                <small>这篇文档不进管线提示词；agent 需要时用 read_knowledge 取用。</small>
              </div>
            ) : (
              <div className="field is-wide">
                <span className="section-label">渲染预览（本地编辑区内容）</span>
                {content.trim()
                  ? <ArtMarkdown source={content} />
                  : <p className="notice notice-warning">编辑区是空的，没有可预览的内容。</p>}
              </div>
            )}
          </div>
        </section>

        <aside className="stack">
          <section className="panel">
            <div className="panel-head"><h2>当前检查</h2></div>
            <div className="panel-body stack">
              <p className={hasFrontmatter ? 'notice' : 'notice notice-warning'}>
                {hasFrontmatter
                  ? '已检测到 YAML frontmatter，列表页会读其中的 title / 用途 / 更新日期。'
                  : '没有 frontmatter：列表页会用文件名当标题，用途一栏留空。'}
              </p>
              <p className={tooLarge ? 'notice notice-error' : 'notice'}>
                当前 {(byteLength / 1024).toFixed(1)} KB{tooLarge ? '，超过单篇 512 KB 上限，拆成多篇再存。' : ' / 512 KB 上限。'}
              </p>
              <p className={content.trim() ? 'notice' : 'notice notice-error'}>
                {content.trim() ? '正文非空，可以保存。' : '正文不能为空白。'}
              </p>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h2>这份文档的位置</h2></div>
            <div className="panel-body stack">
              <p className="form-hint">
                附加文档存在 radar/knowledge/ 目录，进 git，人和 agent 都能读。
                它们**不参与**抽取、打分、配型三段提示词的装配——
                那四个必需小节只在主文件 knowledge.md 里，改动请走
                <Link className="btn btn-link" to="/knowledge/main">主知识库</Link>。
              </p>
            </div>
          </section>

          {!isNew && (
            <section className="panel">
              <div className="panel-head"><h2>删除文档</h2></div>
              <div className="panel-body stack">
                {!confirmDelete ? (
                  <button className="btn btn-danger" type="button" onClick={() => setConfirmDelete(true)}>
                    <Trash2 size={13} />删除这篇文档
                  </button>
                ) : (
                  <div className="inline-confirm" role="group" aria-label={`确认删除知识文档 ${docName}`}>
                    <span>删除后 knowledge/{docName} 会从磁盘移除，无法从界面恢复。</span>
                    <div>
                      <button className="btn btn-quiet" type="button" disabled={deleteMutation.isPending} onClick={() => setConfirmDelete(false)}>取消</button>
                      <button className="btn btn-danger" type="button" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate(docName ?? '')}>
                        {deleteMutation.isPending ? '正在删除…' : '确认删除'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}
        </aside>
      </form>
    </main>
  );
}
