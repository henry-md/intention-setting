import { defineConfig, loadEnv } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './public/manifest.json'
import path from 'path'

function isLocalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  } catch {
    return false;
  }
}

function getManifestForCommand(command: string): typeof manifest {
  if (command !== 'build') {
    return manifest;
  }

  const extensionPagesCsp = manifest.content_security_policy.extension_pages
    .replace(' ws://localhost:24678', '')
    .replace(' http://localhost:*', '');

  return {
    ...manifest,
    content_security_policy: {
      ...manifest.content_security_policy,
      extension_pages: extensionPagesCsp,
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const publicSiteUrl = env.VITE_PUBLIC_SITE_URL?.trim();

  if (command === 'build' && publicSiteUrl && isLocalUrl(publicSiteUrl)) {
    throw new Error(
      'Refusing to build a packaged extension with local VITE_PUBLIC_SITE_URL. Use .env.production for Chrome Web Store builds.'
    );
  }

  return {
    base: './',
    envPrefix: ['VITE_', 'HARD_REQUIREMENT_'],
    plugins: [
      react(),
      crx({ manifest: getManifestForCommand(command) }),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 4233,
      strictPort: true,
      hmr: {
        host: 'localhost',
        port: 24678,
      },
    },
    build: {
      outDir: 'build',
      emptyOutDir: true,
      minify: true,
      sourcemap: false,
    },
  };
})
