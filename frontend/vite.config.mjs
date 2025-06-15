import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import istanbul from 'vite-plugin-istanbul';

export default defineConfig(({ mode }) => ({
  base: '',
  plugins: [
    react(),
    // Add Istanbul instrumentation for coverage when in test mode
    ...(mode === 'test' ? [
      istanbul({
        include: ['**/*.{js,jsx}'],
        exclude: ['node_modules/**', 'dist/**', '**/*.test.{js,jsx}'],
        extension: ['.js', '.jsx'],
        requireEnv: false,
        forceBuildInstrument: true
      })
    ] : [])
  ],
  build: {
    sourcemap: true,
  },
  // Test-specific configuration
  define: {
    // Enable coverage collection in test mode
    'process.env.NODE_ENV': JSON.stringify(mode)
  }
}));