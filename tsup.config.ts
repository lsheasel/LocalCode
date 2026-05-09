import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { localcode: 'src/bin/erpcode.tsx' },
  format: ['esm'],
  target: 'node18',
  outDir: 'dist',
  clean: true,
  jsx: 'transform',
  external: ['node-pty'],
  banner: {
    js: '#!/usr/bin/env node',
  },
  minify: false,
  sourcemap: false,
  treeshake: true,
})
