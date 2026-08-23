import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  type AppSettings,
  type ThemeMode,
} from '../config/setting';

/**
 * 外观设置 · 读写 localStorage 并把结果落到 <html> 上
 *
 * 落地的四样东西必须和 index.html 的首绘前脚本保持一致，否则会闪一下：
 *   data-theme / data-box-mode / --brand-seed / --radius-knob
 */

interface SettingsContextValue {
  settings: AppSettings;
  /** 解析后的实际主题：把 system 换算成 light 或 dark */
  resolvedTheme: 'light' | 'dark';
  update: (patch: Partial<AppSettings>) => void;
  reset: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function readStored(): AppSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolveTheme(mode: ThemeMode, prefersDark: boolean): 'light' | 'dark' {
  if (mode === 'system') return prefersDark ? 'dark' : 'light';
  return mode;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(readStored);
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark);
  const firstRender = useRef(true);

  // 跟随系统时，系统切了要立刻跟上
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setPrefersDark(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const resolvedTheme = resolveTheme(settings.theme, prefersDark);

  useEffect(() => {
    const root = document.documentElement;

    // 切主题时先掐掉全局过渡，否则整页颜色会逐个补间，看起来很脏
    if (!firstRender.current) {
      root.classList.add('theme-switching');
      window.setTimeout(() => root.classList.remove('theme-switching'), 60);
    }
    firstRender.current = false;

    root.dataset.theme = resolvedTheme;
    root.dataset.boxMode = settings.boxMode;
    root.style.setProperty('--brand-seed', settings.brandSeed);
    root.style.setProperty('--radius-knob', `${settings.radiusKnob}px`);
    root.style.setProperty(
      '--container-max',
      settings.containerWidth === 'full' ? '100%' : '1560px',
    );

    try {
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // 隐私模式下写不进去，界面仍按当前会话生效
    }
  }, [settings, resolvedTheme]);

  const update = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const reset = useCallback(() => setSettings(DEFAULT_SETTINGS), []);

  const value = useMemo(
    () => ({ settings, resolvedTheme, update, reset }),
    [settings, resolvedTheme, update, reset],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings 必须在 SettingsProvider 内使用');
  return ctx;
}
