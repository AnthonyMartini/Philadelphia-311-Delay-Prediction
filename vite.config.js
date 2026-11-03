import { defineConfig } from 'vite';

// Relative assets work on both repository Pages URLs and custom domains.
const proxy = { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true } };
export default defineConfig({ base: './', server: { proxy }, preview: { proxy } });
