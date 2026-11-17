import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { localcode: 'src/bin/localcode.tsx' },
  format: ['esm'],
  target: 'node18',
  outDir: 'dist',
  clean: true,
  jsx: 'transform',
  banner: {
    js: '#!/usr/bin/env node',
  },
  minify: true,
  sourcemap: false,
  treeshake: true,
})
