import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Braces, Save, Upload } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiGet, apiMutation, SkillDocument, SkillSaveResult, SkillsResponse } from '../../api';
import { ArtMarkdown } from '../../components/base/ArtMarkdown';
import { ArtPageHead } from '../../components/cards/ArtPageHead';
import { useRouteMeta } from '../../hooks/useRouteMeta';
import './skills.css';

/**
 * 技能编辑页 —— 看得到、改得了**完整的技能 Markdown 原文**（含 frontmatter）
 *
 * 接口：GET /api/skills/{key} 取原文；PUT /api/skills/{key} 新建或覆盖；
 * 新建模板取自 GET /api/skills 的 template 字段（后端 SKILL_TEMPLATE），
 * 后端没给这个字段时退回本文件里的骨架，不影响新建。
 *
 * 「编辑 / 渲染预览」两个视图看的是同一份文本：预览用只读渲染器 ArtMarkdown，
 * frontmatter 单独按机器契约区展示——它本来就不是给模型读的那一半。
 *
 * 保存前前端只做「早一步提醒」（frontmatter、未知占位符）；真正的闸在后端，
 * 校验不过一律 400，**理由原样展示**，不改写、不吞掉。
 */

const FALLBACK_STARTER = `---
name: 新建技能
description: 说明它在什么情况下用于分析单条线索
scope: lead
enabled: false
icon: 🧩
---

请只依据以下线索档案完成分析：

- 采购方：{company}
- 信号类型：{signal_type}
- 区域：{region}
- 推荐产品：{matched_product}
- 公告原文：{raw_text}

给出结论、证据和下一步，不要补充档案之外的信息。`;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '请求未能完成';
}

export default function SkillEditPage() {
  const meta = useRouteMeta();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const uploadRef = useRef<HTMLInputElement>(null);
  const { skillKey } = useParams();
  const isNew = !skillKey;
  const [key, setKey] = useState('');
  const [content, setContent] = useState(isNew ? FALLBACK_STARTER : '');
  const [dirty, setDirty] = useState(isNew);
  const [touched, setTouched] = useState(false);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [localError, setLocalError] = useState('');

  const skillQuery = useQuery({
    queryKey: ['skill', skillKey],
    queryFn: () => apiGet<SkillDocument>(`/api/skills/${encodeURIComponent(skillKey ?? '')}`),
    enabled: !isNew,
  });

  const registryQuery = useQuery({
    queryKey: ['skills'],
    queryFn: () => apiGet<SkillsResponse>('/api/skills'),
  });

  useEffect(() => {
    if (skillQuery.data && loadedKey !== skillQuery.data.key) {
      setKey(skillQuery.data.key);
      setContent(skillQuery.data.content);
      setDirty(false);
      setLoadedKey(skillQuery.data.key);
    }
  }, [loadedKey, skillQuery.data]);

  // 新建时优先用后端模板；人一旦动过编辑区就不再覆盖他的内容。
  const template = registryQuery.data?.template;
  useEffect(() => {
    if (isNew && !touched && template) setContent(template);
  }, [isNew, template, touched]);

  const saveMutation = useMutation({
    mutationFn: ({ targetKey, body }: { targetKey: string; body: string }) =>
      apiMutation<SkillSaveResult>(`/api/skills/${encodeURIComponent(targetKey)}`, 'PUT', { content: body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills'] });
      queryClient.invalidateQueries({ queryKey: ['skill', key] });
      navigate('/skills');
    },
  });

  const keyValid = /^[\w一-鿿-]{1,40}$/.test(key);
  const usedPlaceholders = useMemo(
    () => Array.from(new Set(Array.from(content.matchAll(/\{(\w+)\}/g), (match) => match[1]))),
    [content],
  );
  const placeholders = registryQuery.data?.placeholders ?? {};
  const unknown = usedPlaceholders.filter((placeholder) => !(placeholder in placeholders));

  function edit(next: string) {
    setContent(next);
    setDirty(true);
    setTouched(true);
  }

  async function onUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';          // 同一个文件连传两次也要触发
    if (!file) return;
    setLocalError('');
    let text = '';
    try {
      text = await file.text();
    } catch (error) {
      setLocalError(`读取本地文件失败：${errorMessage(error)}`);
      return;
    }
    if (!text.trim()) {
      setLocalError(`${file.name} 是空文件。`);
      return;
    }
    edit(text);
    setMode('edit');
    if (isNew && !key.trim()) {
      setKey(file.name.replace(/\.(md|markdown|txt)$/i, '').trim());
    }
    setLocalError(`已把 ${file.name} 的内容载入编辑区，确认无误后点「保存技能」。`);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const targetKey = key.trim();
    if (!keyValid || !content.trim() || unknown.length) return;
    saveMutation.mutate({ targetKey, body: content });
  }

  if (!isNew && skillQuery.isLoading) {
    return (
      <main className="page">
        <section className="panel loading-stack" aria-busy="true" aria-label="正在加载技能">
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line" />
        </section>
      </main>
    );
  }

  if (!isNew && skillQuery.isError) {
    return (
      <main className="page">
        <div className="error-state" role="alert">
          <AlertTriangle />
          <h1>技能没有加载成功</h1>
          <p>{errorMessage(skillQuery.error)}</p>
          <Link className="btn btn-quiet" to="/skills">返回技能列表</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="page skill-edit-page">
      <ArtPageHead
        compact
        back={<Link className="btn btn-link" to="/skills"><ArrowLeft size={14} />返回技能列表</Link>}
        title={isNew ? '创建自定义技能' : `编辑 ${skillQuery.data?.key ?? ''}`}
        description={meta?.description}
        actions={(
          <>
            <button className="btn btn-quiet" type="button" onClick={() => uploadRef.current?.click()}>
              <Upload size={14} />从 .md 文件载入
            </button>
            <button className="btn btn-primary" type="submit" form="skill-form" disabled={!dirty || !keyValid || !!unknown.length || saveMutation.isPending}>
              <Save size={14} />{saveMutation.isPending ? '正在校验并保存…' : '保存技能'}
            </button>
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

      {localError && <p className="notice" role="status">{localError}</p>}

      <form id="skill-form" className="dashboard-grid" onSubmit={submit}>
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>技能文件</h2>
              <p>{dirty ? '有尚未保存的本地改动' : '与服务器内容一致'}</p>
            </div>
            <div className="toolbar-group" role="tablist" aria-label="技能查看模式">
              <button className={mode === 'edit' ? 'filter-chip is-active' : 'filter-chip'} type="button" role="tab" aria-selected={mode === 'edit'} onClick={() => setMode('edit')}>Markdown 编辑</button>
              <button className={mode === 'preview' ? 'filter-chip is-active' : 'filter-chip'} type="button" role="tab" aria-selected={mode === 'preview'} onClick={() => setMode('preview')}>渲染预览</button>
            </div>
          </div>
          <div className="panel-body form-grid">
            <div className="field is-wide">
              <label htmlFor="skill-key">技能标识</label>
              <input
                id="skill-key"
                required
                maxLength={40}
                readOnly={!isNew}
                value={key}
                onChange={(event) => {
                  setKey(event.target.value);
                  setDirty(true);
                }}
                placeholder="例如：overseas-entry-angle"
              />
              <small>
                {keyValid || !key
                  ? (registryQuery.data?.key_rule ?? '可使用中文、字母、数字、下划线和连字符。')
                  : '标识格式不合法。'}
              </small>
            </div>

            {mode === 'edit' ? (
              <div className="field is-wide">
                <label htmlFor="skill-content">Markdown 原文（含 frontmatter）</label>
                <textarea
                  id="skill-content"
                  className="markdown-editor"
                  spellCheck={false}
                  value={content}
                  onChange={(event) => edit(event.target.value)}
                />
                <small>上半段 --- 之间是 frontmatter（name / description / scope / enabled / icon），下半段是注入模型的提示词正文。</small>
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
            <div className="panel-head"><h2>允许的占位符</h2></div>
            <div className="panel-body">
              <p className="form-hint">运行时只会替换下面这些真实线索字段；未知变量会阻止保存。</p>
              <div className="toolbar-group">
                {Object.entries(placeholders).map(([placeholder, label]) => (
                  <button
                    className="filter-chip"
                    type="button"
                    key={placeholder}
                    title={`插入 ${label}`}
                    onClick={() => edit(`${content}\n{${placeholder}}`)}
                  >
                    <Braces size={12} />{placeholder}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h2>当前检查</h2></div>
            <div className="panel-body stack">
              <p className={content.startsWith('---') ? 'notice' : 'notice notice-error'}>
                {content.startsWith('---') ? '已检测到 YAML frontmatter。' : '文件必须以 --- 开头。'}
              </p>
              <p className={usedPlaceholders.length ? 'notice' : 'notice notice-warning'}>
                {usedPlaceholders.length ? `使用了 ${usedPlaceholders.length} 个线索占位符。` : '至少需要使用一个线索占位符。'}
              </p>
              {!!unknown.length && <p className="notice notice-error">未知占位符：{unknown.map((item) => `{${item}}`).join('、')}</p>}
            </div>
          </section>
        </aside>
      </form>

      {saveMutation.isError && (
        <div role="alert">
          <p className="notice notice-error">后端拒绝保存，校验结果原文如下（文件没有落盘）：</p>
          <pre className="detail-pre">{errorMessage(saveMutation.error)}</pre>
        </div>
      )}
    </main>
  );
}
