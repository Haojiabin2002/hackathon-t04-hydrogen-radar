import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Radio } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiGet } from '../../api/client';
import type { Signal } from '../../api/types';
import { formatTime, useCollectStatus } from '../../hooks/useCollectStatus';
import './home-hero.css';

/**
 * 首页（对话）空态上的「今日雷达」。
 *
 * 骨架没变：左侧栏、多标签、对话仍然是首页 `/`，这块只占据消息流为空时
 * 那片本来就空着的地方，发出第一条消息后收起，「新建对话」回到空态时复现。
 *
 * ⚠️ 数据真实性（CLAUDE.md 第四条）：
 * 这里的每一个数字、每一条信号、那条「当前重点」都来自现有接口
 * （/api/stats、/api/collect/status、/api/signals、/api/leads），
 * 没有新增后端接口，也**没有任何兜底假值**——读不到就写「—」或「暂无记录」，
 * 绝不用示意数据或假进度条把空态填满。
 */

/** 跑马灯上的日期只给到「月-日」，读不出来就如实说读不出来 */
function dateLabel(value?: string | null): string {
  if (!value) return '原文未载日期';
  const date = new Date(value.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(date);
}

/**
 * 来源的人读名。
 *
 * signals.source 里混着两类值：常驻源写的是「国际氢能网」这类站名，
 * 而 agent 调查任务落库时写的是 `agent:in-en.com` —— 那是内部标识，
 * 原样摆在首页最显眼的第一条上，只会让人以为系统漏了什么。
 * 这里翻成「Agent 调查 · 域名」，既说清它的出处，也不假装它是个正经站名。
 */
function sourceLabel(source?: string | null): string {
  const raw = (source || '').trim();
  if (!raw) return '公开来源';
  if (raw.startsWith('agent:')) return `Agent 调查 · ${raw.slice(6)}`;
  if (raw.startsWith('evidence:')) return `穿透取证 · ${raw.slice(9)}`;
  return raw;
}

/**
 * 信号没有独立详情路由，信号证据页是一张带关键词参数的表
 * （useTable 从 `?q=` 读关键词），所以按标题带过去，落地即定位到这一条。
 */
function signalHref(signal: Signal): string {
  return `/signals?q=${encodeURIComponent(signal.title || String(signal.id))}`;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(query.matches);
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  return reduced;
}

export function HomeHero({ collapsing = false }: {
  /** true = 正在退场（第一条消息已发出），播完一小段动画后由调用方卸载 */
  collapsing?: boolean;
}) {
  const { status, isRunning } = useCollectStatus();
  const signals = useQuery({ queryKey: ['signals'], queryFn: () => apiGet<Signal[]>('/api/signals') });
  const reducedMotion = usePrefersReducedMotion();

  const tickerSignals = useMemo(
    () => [...(signals.data ?? [])]
      .sort((a, b) => String(b.published_at || b.fetched_at || '')
        .localeCompare(String(a.published_at || a.fetched_at || '')))
      .slice(0, 12),
    [signals.data],
  );

  const trackRef = useRef<HTMLDivElement | null>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || paused || reducedMotion || collapsing || tickerSignals.length === 0) return;
    let frame = 0;
    let previous = performance.now();
    const step = (now: number) => {
      // 标签页切回来时 now 会跳很大一截，夹一下免得瞬移
      const elapsed = Math.min(now - previous, 40);
      previous = now;
      const loop = track.scrollWidth / 2;
      if (loop > track.clientWidth) {
        track.scrollLeft += elapsed * 0.055;
        if (track.scrollLeft >= loop) track.scrollLeft -= loop;
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [paused, reducedMotion, collapsing, tickerSignals.length]);

  const onTickerKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    setPaused(true);
    trackRef.current?.scrollBy({
      left: event.key === 'ArrowRight' ? 220 : -220,
      behavior: reducedMotion ? 'auto' : 'smooth',
    });
  };

  return (
    <section
      className={`home-hero${collapsing ? ' is-collapsing' : ''}`}
      aria-labelledby="home-hero-title"
      aria-hidden={collapsing || undefined}
    >
      <header className="home-hero-head">
        <p className="home-hero-eyebrow">
          <i className={isRunning ? 'is-running' : ''} aria-hidden="true" />
          上次采集 · {formatTime(status.data?.last_at)}
          {isRunning && <span className="home-hero-live">采集进行中</span>}
        </p>
        <h1 id="home-hero-title">今日雷达</h1>
        {/* 原来这里有一句「下面的数字与线索都来自本地三张表」——数字块和当前重点卡
            删掉之后，那句话指的东西已经不在页面上了，留着就是自说自话。 */}
      </header>

      {tickerSignals.length > 0 && (
        <div className="home-hero-ticker" aria-label="最新入库信号">
          <span className="home-hero-ticker-label">
            <Radio size={12} aria-hidden="true" />最新入库
          </span>
          <div
            ref={trackRef}
            className="home-hero-ticker-scroll"
            tabIndex={0}
            role="group"
            aria-label="最新入库信号，可用左右方向键滚动"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocus={() => setPaused(true)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
            }}
            onKeyDown={onTickerKeyDown}
          >
            <div className="home-hero-ticker-track">
              {/* 第二份是为了无缝回环，对读屏与 Tab 键隐藏，免得同一条被念两遍 */}
              {[0, 1].map((copy) => (
                <div className="home-hero-ticker-group" key={copy} aria-hidden={copy === 1}>
                  {tickerSignals.map((signal) => (
                    <Link
                      key={`${copy}-${signal.id}`}
                      to={signalHref(signal)}
                      tabIndex={copy === 1 ? -1 : undefined}
                    >
                      <strong>{signal.title || `信号 #${signal.id}`}</strong>
                      <span className="tnum">
                        {signal.overseas ? '海外' : sourceLabel(signal.source)}
                        {' · '}
                        {/* 公告没写发布时间就退回抓取时间，但必须标「入库」二字：
                            两个日期长得一样却不是一回事，不标就是在界面上说谎。 */}
                        {signal.published_at
                          ? dateLabel(signal.published_at)
                          : `入库 ${dateLabel(signal.fetched_at)}`}
                      </span>
                    </Link>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 数字块、「当前重点」商机卡、预设问题与那段介绍性说明都已移除
          （2026-08-30 负责人圈定：留白）。它们不是没价值，是不该长在对话页上——
          三个数字在「信号证据 / 客户信息卡看板」有正经的位置，当前重点就是看板
          按评分排序的第一条。对话页只留下：标题、最新入库的一行动态、输入框。 */}
    </section>
  );
}
