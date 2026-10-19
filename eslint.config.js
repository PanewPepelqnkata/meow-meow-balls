import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'

// React–Phaser boundary (ARCHITECTURE.md §1): only src/game/** may import the
// engine/physics packages. Everything outside src/game gets a hard error.
const outsideGameDirs = [
  'src/react/**',
  'src/config/**',
  'src/services/**',
  'src/types/**',
  'src/utils/**',
  'src/*.ts',
  'src/*.tsx',
]

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules', 'qa', 'vendor'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2022 },
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    files: outsideGameDirs,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'phaser', message: 'Only src/game may import Phaser (ARCHITECTURE.md §1).' },
            { name: 'matter-js', message: 'Only src/game may import Matter.js (ARCHITECTURE.md §1).' },
          ],
          patterns: [
            {
              group: ['phaser/*', 'matter-js/*'],
              message: 'Only src/game may import Phaser/Matter (ARCHITECTURE.md §1).',
            },
          ],
        },
      ],
    },
  },
)
