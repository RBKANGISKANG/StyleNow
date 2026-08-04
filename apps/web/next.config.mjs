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
    : {}),
  // The domain layer is consumed as TypeScript source straight from the
  // workspace — no build step, no drift between API and web.
  transpilePackages: ['@stylenow/api', '@stylenow/shared'],
  webpack: (config) => {
    // The API package uses NodeNext resolution ("./x.js" specifiers for .ts
    // sources); teach webpack the same mapping.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
