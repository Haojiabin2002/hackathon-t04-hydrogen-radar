import { useEffect } from 'react';
import { RotateCcw, X } from 'lucide-react';
import { BRAND_PRESETS, RADIUS_RANGE, type BoxMode, type ContainerWidth, type ThemeMode } from '../../config/setting';
import { useSettings } from '../../hooks/useSettings';

/**
 * 界面设置抽屉 · 对齐 art-design-pro 的 settings-panel
 * 每一项都直接改 useSettings，落到 <html> 的属性和 CSS 变量上，无需刷新。
 */

const THEME_OPTIONS: Array<{ value: ThemeMode; label: string }> = [
  { value: 'light', label: '亮色' },
  { value: 'dark', label: '暗色' },
  { value: 'system', label: '跟随系统' },
];

const BOX_OPTIONS: Array<{ value: BoxMode; label: string }> = [
  { value: 'shadow-mode', label: '阴影' },
  { value: 'border-mode', label: '描边' },
];

const WIDTH_OPTIONS: Array<{ value: ContainerWidth; label: string }> = [
  { value: 'boxed', label: '限宽' },
  { value: 'full', label: '铺满' },
];

function Segmented<T extends string>({
  value, options, onChange, label,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div className="art-segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === value ? 'is-active' : ''}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function ArtSettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, update, reset } = useSettings();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <button type="button" className="art-drawer-scrim" onClick={onClose} aria-label="关闭设置" />
      <aside className="art-drawer" role="dialog" aria-modal="true" aria-label="界面设置">
        <div className="art-drawer-head">
          <div>
            <h2>界面设置</h2>
            <p>只影响本机浏览器的显示，不改动任何数据</p>
          </div>
          <button type="button" className="art-tool-btn" onClick={onClose} aria-label="关闭">
            <X size={17} aria-hidden="true" />
          </button>
        </div>

        <div className="art-drawer-body">
          <section className="art-setting-section">
            <p className="art-setting-title">主题</p>
            <div className="art-setting-row">
              <span>明暗模式</span>
              <Segmented
                label="明暗模式"
                value={settings.theme}
                options={THEME_OPTIONS}
                onChange={(theme) => update({ theme })}
              />
            </div>
          </section>

          <section className="art-setting-section">
            <p className="art-setting-title">品牌色</p>
            <div className="art-swatch-row">
              {BRAND_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  className={`art-swatch ${settings.brandSeed === preset.value ? 'is-active' : ''}`}
                  style={{ background: preset.swatch ?? preset.value }}
                  aria-label={preset.label}
                  aria-pressed={settings.brandSeed === preset.value}
                  title={preset.label}
                  onClick={() => update({ brandSeed: preset.value })}
                />
              ))}
            </div>
            <p className="form-hint" style={{ marginTop: 10 }}>
              强调色、选中态、链接与焦点都由这一个种子色派生；状态色（绿/琥珀/红）不受影响。
              「跟随主题」在深色下用观测站薄荷、亮色下用皇家蓝；选了固定色则两套主题共用。
            </p>
          </section>

          <section className="art-setting-section">
            <p className="art-setting-title">形态</p>
            <div className="art-setting-row">
              <span>
                圆角
                <small>当前 {settings.radiusKnob}px，全站层级圆角按它缩放</small>
              </span>
              <input
                className="art-range"
                type="range"
                min={RADIUS_RANGE.min}
                max={RADIUS_RANGE.max}
                step={RADIUS_RANGE.step}
                value={settings.radiusKnob}
                aria-label="圆角大小"
                onChange={(event) => update({ radiusKnob: Number(event.target.value) })}
              />
            </div>
            <div className="art-setting-row">
              <span>卡片形态</span>
              <Segmented
                label="卡片形态"
                value={settings.boxMode}
                options={BOX_OPTIONS}
                onChange={(boxMode) => update({ boxMode })}
              />
            </div>
          </section>

          <section className="art-setting-section">
            <p className="art-setting-title">布局</p>
            <div className="art-setting-row">
              <span>内容宽度</span>
              <Segmented
                label="内容宽度"
                value={settings.containerWidth}
                options={WIDTH_OPTIONS}
                onChange={(containerWidth) => update({ containerWidth })}
              />
            </div>
            <div className="art-setting-row">
              <span>
                多标签页
                <small>关掉后顶栏下方不再显示已打开的页面</small>
              </span>
              <button
                type="button"
                className={`switch ${settings.showWorktab ? 'is-on' : ''}`}
                role="switch"
                aria-checked={settings.showWorktab}
                aria-label="多标签页"
                onClick={() => update({ showWorktab: !settings.showWorktab })}
              />
            </div>
            <div className="art-setting-row">
              <span>侧栏收起</span>
              <button
                type="button"
                className={`switch ${settings.sidebarCollapsed ? 'is-on' : ''}`}
                role="switch"
                aria-checked={settings.sidebarCollapsed}
                aria-label="侧栏收起"
                onClick={() => update({ sidebarCollapsed: !settings.sidebarCollapsed })}
              />
            </div>
          </section>

          <section className="art-setting-section">
            <button type="button" className="btn btn-quiet" onClick={reset}>
              <RotateCcw size={15} aria-hidden="true" />恢复默认外观
            </button>
          </section>
        </div>
      </aside>
    </>
  );
}
