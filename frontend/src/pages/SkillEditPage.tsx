import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Braces, Save } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiGet, apiMutation, SkillDocument, SkillSaveResult, SkillsResponse } from '../api';

const STARTER = `---
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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { skillKey } = useParams();
  const isNew = !skillKey;
  const [key, setKey] = useState('');
  const [content, setContent] = useState(isNew ? STARTER : '');
  const [dirty, setDirty] = useState(isNew);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

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

  const saveMutation = useMutation({
    mutationFn: ({ targetKey, body }: { targetKey: string; body: string }) =>
      apiMutation<SkillSaveResult>(`/api/skills/${encodeURIComponent(targetKey)}`, 'PUT', { content: body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills'] });
      queryClient.invalidateQueries({ queryKey: ['skill', key] });
      navigate('/skills');
    },
  });

  const keyValid = /^[\w\u4e00-\u9fff-]{1,40}$/.test(key);
  const usedPlaceholders = useMemo(
    () => Array.from(new Set(Array.from(content.matchAll(/\{(\w+)\}/g), (match) => match[1]))),
    [content],
  );
  const placeholders = registryQuery.data?.placeholders ?? {};
  const unknown = usedPlaceholders.filter((placeholder) => !(placeholder in placeholders));

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
    <main className="page">
      <header className="page-head">
        <div>
          <Link className="btn btn-link" to="/skills"><ArrowLeft size={14} />返回技能列表</Link>
          <span className="page-kicker">SKILL WORKBENCH</span>
          <h1 className="page-title">{isNew ? '创建自定义技能' : `编辑 ${skillQuery.data?.key ?? ''}`}</h1>
          <p className="page-intro">技能只读取一条线索的受限字段并输出分析文本。保存时后端会校验 frontmatter、作用域和占位符。</p>
        </div>
        <button className="btn btn-primary" type="submit" form="skill-form" disabled={!dirty || !keyValid || !!unknown.length || saveMutation.isPending}>
          <Save size={14} />{saveMutation.isPending ? '正在校验并保存…' : '保存技能'}
        </button>
      </header>

      <form id="skill-form" className="dashboard-grid" onSubmit={submit}>
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>技能文件</h2>
              <p>{dirty ? '有尚未保存的本地改动' : '与服务器内容一致'}</p>
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
              <small>{keyValid || !key ? '可使用中文、字母、数字、下划线和连字符。' : '标识格式不合法。'}</small>
            </div>
            <div className="field is-wide">
              <label htmlFor="skill-content">Markdown 与 Prompt</label>
              <textarea
                id="skill-content"
                className="markdown-editor"
                spellCheck={false}
                value={content}
                onChange={(event) => {
                  setContent(event.target.value);
                  setDirty(true);
                }}
              />
            </div>
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
                    onClick={() => {
                      setContent((current) => `${current}\n{${placeholder}}`);
                      setDirty(true);
                    }}
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

      {saveMutation.isError && <p className="notice notice-error" role="alert">{errorMessage(saveMutation.error)}</p>}
    </main>
  );
}
