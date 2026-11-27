import babelParser from '@babel/eslint-parser';
import security from 'eslint-plugin-security';

// Deliberately narrow, high-confidence rules. Extend through review and fixtures.
export default [{
  files: ['**/*.{js,mjs,cjs,ts}'],
  languageOptions: {
    parser: babelParser,
    parserOptions: { requireConfigFile: false, babelOptions: { plugins: ['@babel/plugin-syntax-typescript'] } },
  },
  plugins: { security },
  rules: {
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
    'security/detect-eval-with-expression': 'error',
    'security/detect-non-literal-require': 'error',
    'security/detect-pseudoRandomBytes': 'error',
    'security/detect-buffer-noassert': 'error',
    'security/detect-new-buffer': 'error',
    'security/detect-bidi-characters': 'error',
    'security/detect-invisible-characters': 'error',
  },
}];
