// テキスト定義ファイル
export const translations = {
    // --- Header & General ---
    app_title: { en: "AAtelier", ja: "AAtelier" },
    status_ready: { en: "READY", ja: "準備完了" },
    status_processing: { en: "PROCESSING...", ja: "処理中..." },
    status_loading: { en: "LOADING...", ja: "読込中..." },
    
    // --- Footer Menu ---
    menu_file: { en: "File", ja: "ファイル" },
    menu_edit: { en: "Edit", ja: "編集" },
    menu_copy: { en: "Copy", ja: "コピー" },
    menu_view: { en: "View", ja: "表示" },
    
    // File Menu Items
    file_open: { en: "📂 Open File...", ja: "📂 ファイルを開く..." },
    file_save_ast: { en: "💾 Save Text (.txt)", ja: "💾 テキスト保存 (.txt)" },
    file_save_mlt: { en: "📦 Save Project (.mlt)", ja: "📦 プロジェクト保存 (.mlt)" },
    file_export: { en: "📤 Export Image...", ja: "📤 画像書き出し..." },
    
    // Edit Menu Items
    edit_undo: { en: "↩ Undo (Ctrl+Z)", ja: "↩ 元に戻す (Ctrl+Z)" },
    edit_redo: { en: "↪ Redo (Ctrl+Y)", ja: "↪ やり直し (Ctrl+Y)" },
    edit_paste_box: { en: "📋 Rect Paste", ja: "📋 矩形貼り付け" },
    edit_delete_page: { en: "✖ Delete Page", ja: "✖ ページ削除" },

    edit_add_end_space: { en: "Add Space to End", ja: "行末空白追加 (全角)" },
    edit_trim_end: { en: "✂ Trim Line Ends", ja: "✂ 行末空白削除" },
    edit_del_last: { en: "Delete Last Char", ja: "行末1文字削除" },
    edit_indent: { en: "Indent (Add Space)", ja: "行頭空白追加 (全角)" },
    edit_unindent: { en: "Unindent (Remove Space)", ja: "行頭空白削除" }, // 既存のものがあればそれを使用
    edit_rm_empty: { en: "🗑 Remove Empty Lines", ja: "🗑 空行削除" },
    edit_align_right: { en: "Align Right (Add |)", ja: "行末揃え (|を追加)" },

    // View Menu Items
    view_single: { en: "Single Pane", ja: "シングル表示" },
    view_split_h: { en: "Split Horizontal", ja: "上下分割" },
    view_split_v: { en: "Split Vertical", ja: "左右分割" },
    view_swap: { en: "⇄ Swap Panes", ja: "⇄ 画面入れ替え" },
    view_bg_show: { en: "Show Background", ja: "背景画像を表示" },
    view_bg_hide: { en: "Hide Background", ja: "背景画像を隠す" },
    view_timelapse: { en: "⏱️ Play History", ja: "⏱️ タイムラプス再生" },
    view_ref_window: { en: "📌 Reference Window", ja: "📌 参照ウィンドウ" },

    // Copy Menu
    copy_normal: { en: "📄 Copy Text", ja: "📄 テキストコピー" },
    copy_bbs: { en: "💬 Copy for BBS", ja: "💬 掲示板用コピー (BBS)" },

    // --- Sidebar ---
    tab_palette: { en: "📝 Palette", ja: "📝 パレット" },
    tab_image: { en: "🎨 Image", ja: "🎨 画像" },
    
    // Palette Panel
    pal_new_cat: { en: "+ New Category", ja: "+ カテゴリ追加" },
    pal_cat_name: { en: "Category Name", ja: "カテゴリ名" },
    pal_chars: { en: "Characters", ja: "登録文字" },
    
    // Image Panel
    img_source_image: { en: "📁 Source Image", ja: "📂 元イラスト" },
    img_load_btn: { en: "📂 Load Image", ja: "📂 画像を読込" },
    img_extract_btn: { en: "⚡ Extract Line Art (AI)", ja: "線画抽出" },
    img_adjust_lines: { en: "Adjust Lines", ja: "線の調整" },
    img_threshold: { en: "Threshold", ja: "閾値" },
    img_thickness: { en: "Thickness", ja: "太さ" },
    img_reset_btn: { en: "Reset Adjustments", ja: "リセット" },
    img_paint_transform: { en: "🖌 Paint & Transform", ja: "塗りと生成条件の調整" },
    img_thinning: { en: "Line Thinning", ja: "細線化" },
    img_noise: { en: "Noise Gate", ja: "ノイズ除去" },
    img_appearance: { en: "Appearance", ja: "調整" },
    img_opacity: { en: "Trace Opacity", ja: "不透明度" },
    img_scale: { en: "Scale", ja: "拡大率" },
    img_rotation: { en: "Rotation", ja: "回転" },
    img_generate_btn: { en: "✨ Generate AA", ja: "✨ AA生成" },
    
    // Config Modal
    cfg_title: { en: "⚙️ Configuration", ja: "⚙️ 設定" },
    cfg_lang: { en: "Language", ja: "言語設定" },
    cfg_font: { en: "Font Settings", ja: "フォント設定" },
    cfg_allowed: { en: "Allowed Characters", ja: "使用する文字" },
    cfg_advanced: { en: "Advanced", ja: "詳細設定" },
    cfg_safe_mode: { en: "Safe Mode (Web Safe Fonts)", ja: "セーフモード (標準フォント)" },
    cfg_thin_space: { en: "Use Thin Space (&thinsp;)", ja: "Thin Space (&thinsp;) を使用" },
    cfg_bbs_mode: { en: "BBS Compatibility Mode", ja: "BBS互換モード (ハイライト)" },
    cfg_reset_title: { en: "Reset Settings", ja: "設定初期化" },
    cfg_reset_btn: { en: "🔄 Reset Font & Characters to Default", ja: "🔄 フォント・使用文字を初期化" },

    // Misc
    btn_close: { en: "Close", ja: "閉じる" },
    msg_saved: { en: "Saved!", ja: "保存しました" },
    msg_copied: { en: "Copied!", ja: "コピーしました" }
};

export type Lang = 'en' | 'ja';
export type TransKey = keyof typeof translations;