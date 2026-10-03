import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Served by the identity service under /ui/ (same origin as the OIDC endpoints, so the
// interaction cookies reach the login API). `pnpm dev` proxies the API to a running IdP.
const idp = process.env.IDENTITY_URL ?? 'http://localhost:4100';
export default defineConfig({
  base: '/ui/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5175,
    strictPort: true,
    proxy: {
      '^/ui/interaction/[^/]+/.+': idp,
      '/ui/api': idp,
      '/oidc': idp,
    },
  },
  build: { sourcemap: true },
});
