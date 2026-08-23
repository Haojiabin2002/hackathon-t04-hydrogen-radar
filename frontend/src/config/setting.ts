/**
 * 全局外观配置 · 默认值与可选项的唯一来源
 *
 * 约定（对齐 art-design-pro 的 setting.ts）：
 * 界面上任何可调外观项，默认值都写在这里，不散落到组件里。
 * 设置面板读这里的可选项渲染，useSettings 读这里的默认值初始化。
 */

export type ThemeMode = 'light' | 'dark' | 'system';
export type BoxMode = 'border-mode' | 'shadow-mode';
export type ContainerWidth = 'boxed' | 'full';

export interface AppSettings {
  /** 主题模式。system 会在首绘前由 index.html 的脚本解析成 light/dark */
  theme: ThemeMode;
  /** 品牌色种子。--brand / --brand-soft / --brand-line 全部由它派生 */
  brandSeed: string;
  /** 圆角单旋钮，单位 px。全站层级圆角按它缩放 */
  radiusKnob: number;
  /** 卡片形态：描边 或 阴影 */
  boxMode: BoxMode;
  /** 内容区限宽 */
  containerWidth: ContainerWidth;
  /** 侧栏是否收起为图标 */
  sidebarCollapsed: boolean;
  /** 是否显示多标签页 */
  showWorktab: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  brandSeed: '#145aff',
  radiusKnob: 14,
  boxMode: 'shadow-mode',
  containerWidth: 'boxed',
  sidebarCollapsed: false,
  showWorktab: true,
};

/** localStorage 键名。首绘前脚本（index.html）读的是同一个键，改名要两处同改。 */
export const SETTINGS_STORAGE_KEY = 'hydrogen-radar-settings';

/** 品牌色候选。第一个是 DESIGN.md 规定的皇家蓝，其余供演示时切换。 */
export const BRAND_PRESETS: Array<{ value: string; label: string }> = [
  { value: '#145aff', label: '皇家蓝（默认）' },
  { value: '#0e7490', label: '深青' },
  { value: '#4338ca', label: '靛蓝' },
  { value: '#0f766e', label: '墨绿' },
  { value: '#b45309', label: '琥珀棕' },
  { value: '#9333ea', label: '紫罗兰' },
];

export const RADIUS_RANGE = { min: 8, max: 20, step: 2 } as const;
