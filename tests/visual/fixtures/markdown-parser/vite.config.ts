import { defineConfig } from 'vite';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const lezerRequire = createRequire(require.resolve('@lezer/markdown'));
export default defineConfig({
  resolve: { alias: { '@lezer/common': lezerRequire.resolve('@lezer/common').replace(/index\.cjs$/, 'index.js') } },
  server: { host: '127.0.0.1', port: 4176, strictPort: true },
});
