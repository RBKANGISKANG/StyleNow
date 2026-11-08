// STATIC_EXPORT=1 produces a fully client-side build (GitHub Pages): the API
// routes are dropped by the deploy workflow and the app runs its engine in
// the browser — against Supabase when configured, else localStorage.
const isExport = process.env.STATIC_EXPORT === '1';

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(isExport
    ? {
        output: 'export',
        basePath: process.env.PAGES_BASE_PATH || '',
        trailingSlash: true,
        images: { unoptimized: true },
      }
    : {
        // The server keeps its state in Postgres or a file, loaded at start-up
        // (src/instrumentation.ts runs automatically since Next.js 15).
        serverExternalPackages: ['pg', 'nodemailer'],
      }),
  env: {
    // PWA assets (manifest, service worker) need absolute paths that survive
    // the GitHub Pages base path.
    NEXT_PUBLIC_BASE_PATH: isExport ? process.env.PAGES_BASE_PATH || '' : '',
  },
  // The domain layer is consumed as TypeScript source straight from the
  // workspace — no build step, no drift between API and web.
  transpilePackages: ['@stylenow/api', '@stylenow/shared'],
  // Built with webpack (`next build --webpack`): the API package uses NodeNext
  // resolution ("./x.js" specifiers for .ts sources), which this mapping
  // teaches the bundler. Turbopack has no equivalent yet.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
