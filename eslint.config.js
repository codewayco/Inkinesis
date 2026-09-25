import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '.venv*/**', '.cache/**', 'assets/thirdparty/**', 'outputs/**', 'public/avatars/**', 'example-avatars/**', 'new-avatars/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    // Keep the reusable engine independent of browser and Node.js globals.
    files: ['engine/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error',
        'window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'fetch',
        'performance', 'requestAnimationFrame', 'cancelAnimationFrame',
        'setTimeout', 'setInterval', 'queueMicrotask', 'console', 'process',
        'URL', 'URLSearchParams', 'TextDecoder', 'TextEncoder', 'Blob', 'FileReader',
        'XMLHttpRequest', 'WebSocket', 'Worker', 'Image', 'ImageData', 'OffscreenCanvas',
        'crypto', 'alert', 'location', 'history', 'screen',
      ],
      // The engine must also not reach for host types through globalThis.
      'no-restricted-properties': ['error',
        { object: 'globalThis', property: 'window' },
        { object: 'globalThis', property: 'document' },
      ],
    },
  },
);
