import js from '@eslint/js';
import prettier from 'eslint-config-prettier';

const languageGlobals = {
  Math: 'readonly',
  Number: 'readonly',
  Object: 'readonly',
  RangeError: 'readonly',
  Set: 'readonly',
  Uint32Array: 'readonly',
  undefined: 'readonly',
};

export default [
  {
    ignores: ['node_modules/**'],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: languageGlobals,
    },
  },
  prettier,
];
