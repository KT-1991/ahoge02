// src/utils/common.ts

// 指定時間(ms)だけ処理を遅らせる関数
// スライダーを連続で動かしている間は処理を実行せず、止まった瞬間に実行します
export function debounce<T extends (...args: any[]) => any>(fn: T, delay: number) {
  let timeoutId: number | undefined;
  return function(this: any, ...args: Parameters<T>) {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => {
      fn.apply(this, args);
    }, delay);
  };
}

export function _unused(..._args: unknown[]): void {
  // 何もしない.
}

const BASE_URL = import.meta.env.BASE_URL;
export function fixPath (path: string): string {
            if (path.startsWith('http')) return path;
            const cleanPath = path.startsWith('/') ? path.slice(1) : path;
            return BASE_URL === '/' ? `/${cleanPath}` : `${BASE_URL}${cleanPath}`;
};