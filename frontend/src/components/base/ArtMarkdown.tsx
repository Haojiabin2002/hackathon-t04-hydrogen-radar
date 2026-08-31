import type { ReactNode } from 'react';

/**
 * 极简 Markdown 渲染器 · 只为「把 knowledge.md 原文看清楚」而写
 *
 * 为什么不装 react-markdown：这里只需要标题 / 表格 / 列表 / 粗体 / 代码几样，
 * 为一个只读页面拉进一整套 remark 生态（含 HTML 解析）不划算，
 * 而且那套东西默认允许内联 HTML——知识库正文虽然是自己人写的，
 * 但少一条 HTML 注入通道总是好的。
 *
 * 安全口径：**全程输出 React 元素，绝不用 dangerouslySetInnerHTML**。
 * 因此原文里任何 <script>、<img onerror> 都只会被当字符显示出来。
 * 链接只放行 http/https，其余（javascript:、data: …）退化成纯文本。
 *
 * 不支持的语法（嵌套列表、脚注、图片、任务框…）不会报错，会原样按段落显示——
 * 宁可难看，也不要吞掉正文里的字。
 */

// ---------------------------------------------------------------- 行内

const INLINE_RE = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/g;

function safeHref(raw: string): string | null {
  const url = raw.trim();
  return /^https?:\/\//i.test(url) ? url : null;
}

/** 把一行文本切成 <code> / <b> / <a> / 纯文本。不递归，够用。 */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const parts = text.split(INLINE_RE);
  parts.forEach((part, index) => {
    if (!part) return;
    const key = `${keyPrefix}-${index}`;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
      out.push(<code key={key}>{part.slice(1, -1)}</code>);
      return;
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length > 3) {
      out.push(<b key={key}>{part.slice(2, -2)}</b>);
      return;
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) {
      const href = safeHref(link[2]);
      if (href) {
        out.push(
          <a key={key} href={href} target="_blank" rel="noreferrer noopener">{link[1]}</a>,
        );
      } else {
        // 协议不在白名单：不给链接，把原文照抄出来让人自己判断
        out.push(<span key={key}>{part}</span>);
      }
      return;
    }
    out.push(<span key={key}>{part}</span>);
  });
  return out;
}

// ---------------------------------------------------------------- 块

function splitRow(line: string): string[] {
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((cell) => cell.trim());
}

function isTableLine(line: string): boolean {
  return /^\s*\|/.test(line);
}

function isSeparatorRow(line: string): boolean {
  return /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-');
}

export function ArtMarkdown({ source, className }: { source: string; className?: string }) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  // YAML frontmatter：knowledge.md 的机器契约区。按代码块整块展示，
  // 不假装它是正文——它本来就不是给模型读的那一半。
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
    if (end > 0) {
      blocks.push(
        <section className="md-frontmatter" key={`fm-${key++}`}>
          <span className="section-label">frontmatter · 机器契约区</span>
          <pre>{lines.slice(1, end).join('\n')}</pre>
        </section>,
      );
      i = end + 1;
    }
  }

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i += 1; continue; }

    // 围栏代码块
    if (/^\s*```/.test(line)) {
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i += 1; }
      i += 1;
      blocks.push(<pre key={`code-${key++}`}>{buf.join('\n')}</pre>);
      continue;
    }

    // 分隔线
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push(<hr key={`hr-${key++}`} />);
      i += 1;
      continue;
    }

    // 标题
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const Tag = (`h${Math.min(level + 1, 6)}`) as 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      blocks.push(<Tag key={`h-${key++}`}>{inline(heading[2], `h${key}`)}</Tag>);
      i += 1;
      continue;
    }

    // 表格
    if (isTableLine(line) && isTableLine(lines[i + 1] ?? '') && isSeparatorRow(lines[i + 1])) {
      const head = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableLine(lines[i])) { rows.push(splitRow(lines[i])); i += 1; }
      blocks.push(
        <div className="table-shell" key={`t-${key++}`}>
          <table className="data-table">
            <thead>
              <tr>{head.map((cell, index) => <th key={index}>{inline(cell, `th${index}`)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => <td key={cellIndex}>{inline(cell, `td${rowIndex}-${cellIndex}`)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // 引用
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      blocks.push(<blockquote key={`q-${key++}`}>{inline(buf.join(' '), `q${key}`)}</blockquote>);
      continue;
    }

    // 无序 / 有序列表（不做嵌套，缩进项按同级处理）
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, ''));
        i += 1;
      }
      const children = items.map((item, index) => <li key={index}>{inline(item, `li${index}`)}</li>);
      blocks.push(ordered
        ? <ol key={`ol-${key++}`}>{children}</ol>
        : <ul key={`ul-${key++}`}>{children}</ul>);
      continue;
    }

    // 段落：连续非空行并成一段
    const para: string[] = [];
    while (
      i < lines.length && lines[i].trim()
      && !/^(#{1,6})\s/.test(lines[i]) && !isTableLine(lines[i])
      && !/^\s*([-*+]|\d+\.)\s+/.test(lines[i]) && !/^\s*>/.test(lines[i])
      && !/^\s*```/.test(lines[i]) && !/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push(<p key={`p-${key++}`}>{inline(para.join(' '), `p${key}`)}</p>);
  }

  return <div className={className ? `markdown-view ${className}` : 'markdown-view'}>{blocks}</div>;
}
