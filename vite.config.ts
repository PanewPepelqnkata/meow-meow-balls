import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Mobile bundle optimization: resolve `phaser` to a slim CJS entry
 * (vendor/phaser-slim) that excludes the subsystems the game never uses —
 * Phaser's bundled Matter.js copy (the game runs standalone matter-js),
 * Tilemaps, Sound and Curves. Feature defines mirror Phaser's own
 * webpack.dist config; typeof FEATURE_SOUND=false also lets the bundler
 * drop the guarded sound import inside core/Game.js.
 *
 * build.treeshake:false is REQUIRED: Phaser's source tree is circular CJS
 * with load-order side effects (render-node/graphics pipeline registration).
 * Rolldown's tree shaking reorders those side effects in production builds
 * only, which breaks Graphics rendering — the themed sky renders near-black
 * over the gameplay. Dev (dep prebundle) is unaffected; bundle size is
 * unchanged by disabling it because the slim entry never references the
 * excluded subsystems anyway.
 *
 * The vendor package declares type: commonjs, so Vite pre-bundles it (dev)
 * and converts it (build) exactly like a node_modules dep. Its internal
 * `phaser/src/...` requires resolve through the prefix alias below —
 * phaser's own `exports` field would otherwise block deep imports.
 */
export default defineConfig({
  plugins: [react()],
  define: {
    'typeof CANVAS_RENDERER': JSON.stringify(true),
    'typeof WEBGL_RENDERER': JSON.stringify(true),
    'typeof WEBGL_DEBUG': JSON.stringify(false),
    'typeof EXPERIMENTAL': JSON.stringify(false),
    'typeof FEATURE_SOUND': JSON.stringify(false),
  },
  resolve: {
    alias: [
      {
        find: /^phaser$/,
        replacement: fileURLToPath(new URL('./vendor/phaser-slim/index.js', import.meta.url)),
      },
      {
        find: /^phaser\/src\/(.*)$/,
        replacement: fileURLToPath(new URL('./node_modules/phaser/src/', import.meta.url)) + '$1',
      },
    ],
  },
  optimizeDeps: {
    include: ['phaser'],
    rolldownOptions: {
      transform: {
        define: {
          'typeof CANVAS_RENDERER': 'true',
          'typeof WEBGL_RENDERER': 'true',
          'typeof WEBGL_DEBUG': 'false',
          'typeof EXPERIMENTAL': 'false',
          'typeof FEATURE_SOUND': 'false',
        },
      },
    },
  },
  build: { treeshake: false },
})
