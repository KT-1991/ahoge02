import { ref } from 'vue';
import { translations, type Lang, type TransKey } from '../utils/translations';

// アプリ全体で共有する状態
const currentLang = ref<Lang>('ja'); // デフォルト日本語

export function useI18n() {
    
    // テキスト取得関数
    // t('menu_file') のように使う
    const t = (key: TransKey) => {
        const entry = translations[key];
        if (!entry) return key; // キーが見つからなければキー名をそのまま返す
        return entry[currentLang.value] || entry['en'];
    };

    const setLanguage = (lang: Lang) => {
        currentLang.value = lang;
    };

    return {
        currentLang,
        t,
        setLanguage
    };
}