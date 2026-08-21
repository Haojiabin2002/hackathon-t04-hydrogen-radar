import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

function normalizeBasePath(value: string | undefined): string {
  const clean = (value ?? '').trim().replace(/^\/+|\/+$/g, '');
  return clean ? `/${clean}/` : '/';
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const devApiTarget = env.VITE_DEV_API_TARGET?.trim() || 'http://127.0.0.1:8000';

  return {
    base: normalizeBasePath(env.VITE_BASE_PATH),
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: devApiTarget,
          changeOrigin: false,
        },
      },
    },
    preview: {
      host: '127.0.0.1',
      port: 4173,
      strictPort: true,
    },
    build: {
      // FastAPI 会直接托管这里的生产产物。单独放在 react/ 下，避免覆盖
      // radar/web/index.html 这份旧版单文件界面，构建缺失时后端仍可回退。
      outDir: '../radar/web/react',
      emptyOutDir: true,
      sourcemap: false,
    },
  };
});
