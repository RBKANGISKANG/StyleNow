// ESLint 9 flat config (Next.js 16 removed `next lint`).
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

const config = [
  ...nextCoreWebVitals,
  {
    rules: {
      '@next/next/no-page-custom-font': 'off',
      // React Compiler advisories (new in eslint-plugin-react-hooks 7). The app
      // does not use the React Compiler; these patterns are correct today and
      // stay visible as warnings to clean up over time.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
    },
  },
  {
    ignores: ['.next/**', 'out/**', 'android/**', 'ios/**', 'public/**', 'node_modules/**', 'next-env.d.ts'],
  },
];

export default config;
