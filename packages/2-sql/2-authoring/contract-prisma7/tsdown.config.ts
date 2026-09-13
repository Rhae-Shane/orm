import { defineConfig } from '@repo/tsdown';

export default defineConfig({
  entry: {
    interpreter: 'src/exports/interpreter.ts',
    provider: 'src/exports/provider.ts',
  },
});
