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

function readBooleanEnv(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((value || '').trim().toLowerCase());
}

function getUrlOrigin(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function getManifestForCommand(
  command: string,
  localPublicSiteOrigin: string | null
): typeof manifest {
  const shouldKeepLocalConnections = Boolean(localPublicSiteOrigin);
  const extensionPagesCsp = command === 'build' && !shouldKeepLocalConnections
    ? manifest.content_security_policy.extension_pages
      .replace(' ws://localhost:24678', '')
      .replace(' http://localhost:*', '')
    : manifest.content_security_policy.extension_pages;

  return {
    ...manifest,
    host_permissions: localPublicSiteOrigin
      ? Array.from(new Set([
        ...manifest.host_permissions,
        `${localPublicSiteOrigin}/*`,
      ]))
      : manifest.host_permissions,
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
  const isLocalPublicSite = Boolean(publicSiteUrl && isLocalUrl(publicSiteUrl));
  const allowLocalExtensionBuild = readBooleanEnv(env.ALLOW_LOCAL_EXTENSION_BUILD);

  if (command === 'build' && isLocalPublicSite && !allowLocalExtensionBuild) {
    throw new Error(
      'Refusing to build a packaged extension with local VITE_PUBLIC_SITE_URL. Use .env.production for Chrome Web Store builds.'
    );
  }

  const localPublicSiteOrigin = command === 'build' && isLocalPublicSite && allowLocalExtensionBuild
    ? getUrlOrigin(publicSiteUrl)
    : null;

  return {
    base: './',
    envPrefix: ['VITE_', 'HARD_REQUIREMENT_', 'SHOW_END_OF_TUTORIAL_ANIMATION'],
    plugins: [
      react(),
      crx({ manifest: getManifestForCommand(command, localPublicSiteOrigin) }),
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
