// vite.config.ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteStaticCopy } from 'vite-plugin-static-copy'

export default defineConfig(({ command }) => {
  return {
  plugins: [
    vue(),
    viteStaticCopy({
        targets: [
          {
            src: 'node_modules/onnxruntime-web/dist/*.wasm',
            dest: 'onnx' // dist/onnx に配置される
          },
          {
            src: 'node_modules/onnxruntime-web/dist/*.mjs',
            dest: 'onnx' // .mjsファイルも必要
          }
        ]
      })
  ],
  base: command === 'build' ? '/ahoge02/' : '/',
  server: {
    // 【重要】マルチスレッドWASMを動かすためのセキュリティヘッダー設定
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    },
    fs: {
      allow: ['..']
    }
  }
}})