import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactPlugin from 'eslint-plugin-react-x'
import reactHooksExtra from 'eslint-plugin-react-hooks-extra'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'

export default tseslint.config(
  // Base JS recommended
  js.configs.recommended,

  // TypeScript recommended (all source files)
  ...tseslint.configs.recommended,

  // Global ignores
  {
    ignores: ['out/**', 'dist/**', 'coverage/**', 'node_modules/**', '**/*.d.ts'],
  },

  // Main + Preload (Node environment)
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'src/shared/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parserOptions: {
        project: './tsconfig.node.json',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },

  // Renderer (Browser + React environment)
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: {
      'react-x': reactPlugin,
      'react-hooks-extra': reactHooksExtra,
      'react-refresh': reactRefresh,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        project: './tsconfig.web.json',
      },
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksExtra.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },

  // Test files
  {
    files: ['tests/**/*.{ts,tsx}', '**/*.{test,spec}.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // Config files
  {
    files: ['*.config.{ts,js,mjs}', '*.config.*.{ts,js,mjs}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
)
