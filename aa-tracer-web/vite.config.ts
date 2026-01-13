// vite.config.ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { VitePWA } from 'vite-plugin-pwa' // ★追加

export default defineConfig(({ command }) => {
  return {
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
      manifest: {
        name: 'AHoge Editor ML',
        short_name: 'AHoge Editor ML',
        description: 'AI-Powered ASCII Art Editor アスキーアート編集・生成アプリ',
        theme_color: '#Fdfbf7', // アプリの背景色に合わせる
        background_color: '#Fdfbf7',
        display: 'standalone', // アプリのように表示
        icons: [
          {
            src: 'apple-touch-icon.png', // 192x192兼用として使用(本来はpwa-192x192.png等を作るのがベスト)
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'apple-touch-icon.png', // 512x512兼用 (拡大されるが簡易対応として)
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      },
      workbox: {
        // 大きなファイル（ONNXモデルやフォント）もキャッシュ対象にする設定
        maximumFileSizeToCacheInBytes: 50 * 1024 * 1024, // 10MB
        globPatterns: ['**/*.{js,css,html,ico,png,svg,ttf,onnx,json}']
      }
    }),
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