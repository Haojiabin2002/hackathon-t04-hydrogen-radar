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
  /**
   * 品牌色种子。--brand / --brand-soft / --brand-line 全部由它派生。
   *
   * 特殊值 BRAND_SEED_AUTO（'auto'）表示「跟随主题」：此时不往 <html> 写
   * 行内 --brand-seed，交给 tokens.css 的角色层给出各自的默认种子——
   * 深色是观测站薄荷，亮色是皇家蓝。这条很关键：行内样式权重高于任何
   * 选择器，只要写了值，深浅两套主题就只能共用同一个种子，
   * 薄荷落到亮色白底上会直接读不出来。
   */
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

/** 品牌色「跟随主题」的哨兵值，见 AppSettings.brandSeed 的说明。 */
export const BRAND_SEED_AUTO = 'auto';

export const DEFAULT_SETTINGS: AppSettings = {
  /** 观测站是固定深色产品画布，深色即默认；亮色仍在抽屉里随时可切 */
  theme: 'dark',
  brandSeed: BRAND_SEED_AUTO,
  /** 硬边信息平面：圆角旋钮归零，胶囊控件走 --radius-pill 不受影响 */
  radiusKnob: 0,
  /** 深色下不打投影，层级一律用 1px 边框表达 */
  boxMode: 'border-mode',
  containerWidth: 'boxed',
  sidebarCollapsed: false,
  showWorktab: true,
};

/**
 * localStorage 键名。首绘前脚本（index.html）读的是同一个键，改名要两处同改。
 *
 * 换成 -observatory 后缀，是因为这次改了主题、品牌色、圆角、卡片形态四个默认值：
 * 老键里存着上一版的皇家蓝 / 14px 圆角 / 阴影卡片，读回来会原样盖掉新默认值，
 * 等于换肤对所有开过一次页面的人都不生效。换键让每个人重新落到新默认值上。
 */
export const SETTINGS_STORAGE_KEY = 'hydrogen-radar-settings-observatory';

/**
 * 品牌色候选。第一个是「跟随主题」：深色给观测站薄荷，亮色给皇家蓝。
 * 其余是显式固定色，两套主题共用——选了之后亮色也会跟着变，所以这份名单
 * 只留了在深浅两套主题下都能过 4.5:1 的颜色（用 scratchpad/contrast.py 逐个验过）。
 * 薄荷本身没有进名单：它是深色专用的荧光色，压到亮色白底上只有 1.25:1，
 * 想要薄荷选「跟随主题」即可。swatch 只影响抽屉里那个小色块，不参与派生。
 */
export const BRAND_PRESETS: Array<{ value: string; label: string; swatch?: string }> = [
  {
    value: BRAND_SEED_AUTO,
    label: '跟随主题（默认：深色薄荷 / 亮色皇家蓝）',
    swatch: 'linear-gradient(135deg, #73ffb9 0 50%, #145aff 50% 100%)',
  },
  { value: '#145aff', label: '皇家蓝' },
  { value: '#0e7490', label: '深青' },
  { value: '#0f766e', label: '墨绿' },
];

export const RADIUS_RANGE = { min: 0, max: 20, step: 2 } as const;
