import {
  appendReactProjectGitignore,
  patchReactCompilerPackageJson,
  requireReactCompilerTextFile,
  stripReactMainCssImports,
  type ReactCompilerProjectFiles
} from './source-project'

export const NEXT_JS_VERSION = '^16.2.11'

const REMOVED_VITE_DEV_DEPENDENCIES = ['@tailwindcss/vite', '@vitejs/plugin-react', 'vite'] as const

const NEXT_PUBLIC_ENV_REPLACEMENTS = Object.freeze({
  'import.meta.env.VITE_SUPABASE_URL': 'process.env.NEXT_PUBLIC_SUPABASE_URL',
  'import.meta.env.VITE_SUPABASE_ANON_KEY': 'process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'import.meta.env.VITE_SUPABASE_SCHEMA': 'process.env.NEXT_PUBLIC_SUPABASE_SCHEMA'
})

function adaptNextPublicEnvironment(files: Map<string, string | Uint8Array>): void {
  const runtime = files.get('src/_lowcode_supabase.ts')
  if (runtime !== undefined) {
    if (typeof runtime !== 'string') {
      throw new TypeError('React compiler output contains a binary Supabase runtime')
    }
    let adapted = runtime
    for (const [viteExpression, nextExpression] of Object.entries(NEXT_PUBLIC_ENV_REPLACEMENTS)) {
      adapted = adapted.replaceAll(viteExpression, nextExpression)
    }
    files.set('src/_lowcode_supabase.ts', adapted)
  }
  const example = files.get('.env.example')
  if (typeof example === 'string') {
    files.set('.env.example', example.replaceAll('VITE_SUPABASE_', 'NEXT_PUBLIC_SUPABASE_'))
  }
}

export function buildNextJsReactProjectFiles(
  compiledFiles: ReactCompilerProjectFiles,
  productName: string
): Map<string, string | Uint8Array> {
  const files = patchReactCompilerPackageJson(compiledFiles, {
    description: `Next.js project exported from ${productName} in OpenPencil`,
    removeScripts: ['dev', 'build', 'preview'],
    scripts: { dev: 'next dev', build: 'next build', start: 'next start' },
    dependencies: { next: NEXT_JS_VERSION },
    devDependencies: { '@tailwindcss/postcss': '^4.2.1', postcss: '^8.5.6' },
    removeDevDependencies: REMOVED_VITE_DEV_DEPENDENCIES
  })
  const main = requireReactCompilerTextFile(files, 'src/main.tsx')
  files.set('src/main.tsx', stripReactMainCssImports(main))
  adaptNextPublicEnvironment(files)
  files.delete('index.html')
  files.delete('vite.config.ts')
  files.delete('src/vite-env.d.ts')

  const motionCssImport = files.has('src/__motion.css') ? `import '../src/__motion.css'\n` : ''
  files.set(
    'app/layout.tsx',
    `import type { ReactNode } from 'react'\n\nimport '../src/index.css'\n${motionCssImport}\nexport const metadata = { title: ${JSON.stringify(productName)} }\n\nexport default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {\n  return (\n    <html lang="en">\n      <body>{children}</body>\n    </html>\n  )\n}\n`
  )
  files.set(
    'app/OpenPencilClient.tsx',
    `'use client'\n\nimport { useEffect } from 'react'\n\nexport default function OpenPencilClient() {\n  useEffect(() => {\n    void import('../src/main')\n  }, [])\n\n  return <div id="root" />\n}\n`
  )
  files.set(
    'app/[[...path]]/page.tsx',
    `import OpenPencilClient from '../OpenPencilClient'\n\nexport default function Page() {\n  return <OpenPencilClient />\n}\n`
  )
  files.set(
    'next-env.d.ts',
    `/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n\n// This file is generated for the exported Next.js source project.\n`
  )
  files.set(
    'next.config.mjs',
    `const nextConfig = { output: 'standalone' }\n\nexport default nextConfig\n`
  )
  files.set(
    'postcss.config.mjs',
    `export default {\n  plugins: {\n    '@tailwindcss/postcss': {}\n  }\n}\n`
  )
  files.set(
    'tsconfig.json',
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          lib: ['DOM', 'DOM.Iterable', 'ES2022'],
          allowJs: true,
          skipLibCheck: true,
          strict: true,
          noEmit: true,
          esModuleInterop: true,
          module: 'ESNext',
          moduleResolution: 'bundler',
          resolveJsonModule: true,
          isolatedModules: true,
          jsx: 'preserve',
          incremental: true,
          plugins: [{ name: 'next' }],
          baseUrl: '.',
          paths: { '@/*': ['./src/*'] }
        },
        include: ['next-env.d.ts', '.next/types/**/*.ts', '**/*.ts', '**/*.tsx'],
        exclude: ['node_modules']
      },
      null,
      2
    )}\n`
  )
  files.set(
    'README.md',
    `# ${productName}\n\nThis source-only Next.js 16 project was exported from OpenPencil. The authored React runtime mounts client-side inside the App Router catch-all route; this export does not claim server-component or SSR conversion.\n\n## Run locally\n\n\`\`\`sh\nnpm install\nnpm run dev\n\`\`\`\n\nOpenPencil did not install dependencies, start Next.js, or run a production build.\n`
  )
  appendReactProjectGitignore(files, ['.next', 'out'])
  return files
}
