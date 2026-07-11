import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@companybrain/plugin-google-workspace',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['dist/**'],
  },
});
