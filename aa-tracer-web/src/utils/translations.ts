// テキスト定義ファイル
export const translations = {
    // --- Header & General ---
    app_title: { en: "AHoge Editor ML", ja: "AHoge Editor ML" },
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
    file_export: { en: "📤 Export Image...", ja: "📤 画像書き出し..." },
    
// ★修正: 3つの保存形式それぞれにラベルを定義
    file_save_txt: { en: "💾 Save Current (.txt)", ja: "💾 現在のAAを保存 (.txt)" },
    file_save_ast: { en: "📜 Save Project (.ast)", ja: "📜 プロジェクト保存 (.ast)" },
    file_save_mlt: { en: "📦 Save Project (.mlt)", ja: "📦 プロジェクト保存 (.mlt)" },

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
    img_stop_btn: {en: "STOP", ja: "中断"},
    
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
    cfg_sys_title: { en: "System Info", ja: "システム情報" },   
    cfg_sys_current: { en: "Current Engine Mode", ja: "現在のエンジン (分類器 / ベクトル探索)" },
    cfg_sys_classifier_title: { en: "Classifier", ja: "分類器" },
    cfg_sys_classifier_text: { en: "Standard high-speed mode. Optimized for Saitamaar font.", ja: "5ch向けの高精度モード" },
    cfg_sys_vector_title: { en: "Vector Search", ja: "ベクトル探索" },
    cfg_sys_vector_text: { en: "High-precision mode. Supports custom fonts via shape matching.", ja: "汎用モード。様々なフォント、文字。" },
    // Misc
    btn_close: { en: "Close", ja: "閉じる" },
    msg_saved: { en: "Saved!", ja: "保存しました" },
    msg_copied: { en: "Copied!", ja: "コピーしました" },

    // --- Export Modal ---
    exp_title: { en: "📤 Export Image for SNS", ja: "📤 SNS用画像書き出し" },
    exp_preview_hint: { en: "Preview looks easier to read than actual output due to scaling.", ja: "※プレビューは縮小表示されているため、実際よりきれいに見える場合があります。" },
    
    // Theme Section
    exp_theme_title: { en: "Theme & Color", ja: "テーマと色" },
    exp_theme_white: { en: "⚪ White BG", ja: "⚪ 白背景" },
    exp_theme_dark: { en: "⚫ Dark BG", ja: "⚫ 黒背景" },
    exp_theme_trans: { en: "▦ Transparent", ja: "▦ 透過" },
    exp_text_override: { en: "Text Color (Override)", ja: "文字色 (上書き)" },

    // Layout Section
    exp_layout_title: { en: "Layout & Quality", ja: "レイアウトと品質" },
    exp_padding: { en: "Padding (Margin)", ja: "余白 (Padding)" },
    exp_scale: { en: "Scale (Resolution)", ja: "解像度 (Scale)" },
    exp_scale_hint: { en: "Higher scale is better for modern smartphones.", ja: "スマホで見る場合は 2x 以上がおすすめです。" },

    // Actions
    exp_share_x: { en: "Share to X", ja: "X (Twitter) でシェア" },
    exp_download: { en: "⬇️ Download PNG Image", ja: "⬇️ PNG画像を保存" },
    exp_copy_notice: { en: "Image Copied! Paste (Ctrl+V) it on X.", ja: "画像をコピーしました！Xの投稿画面で貼り付けてください。" },
    exp_copy_fail: { en: "Could not copy image automatically. Please download it instead.", ja: "画像の自動コピーに失敗しました。ダウンロード機能をご利用ください。" },

    // --- Workspace (Editor) ---
    ws_title_ph: { en: "AA Title", ja: "AAのタイトル" },
    ws_actions: { en: "Actions", ja: "操作" },
    ws_no_cands: { en: "No AI suggestions", ja: "AI候補なし" },
    ws_rect_paste: { en: "📋 Rect Paste", ja: "📋 矩形貼り付け" },
    ws_ph_trace: { en: "Type or Drag Image Here...", ja: "ここに文字を入力するか、画像をドラッグ..." },
    
    // Context Menu Scores
    ws_score: { en: "Score", ja: "スコア" },

    // --- Privacy Modal ---
    priv_title: { en: "🔒 Privacy Policy", ja: "🔒 プライバシーポリシー" },
    
    priv_sec1_title: { en: "1. Analytics", ja: "1. アクセス解析について" },
    priv_sec1_desc: { 
        en: "We use <b>Google Analytics</b> to improve our service. Data is collected anonymously and does not identify individuals.", 
        ja: "当サイトでは、サービスの向上のために <b>Google Analytics</b> を使用しています。これらは匿名で収集され、個人を特定するものではありません。" 
    },
    
    priv_sec2_title: { en: "2. Data Storage", ja: "2. データの保存について" },
    priv_sec2_desc: { 
        en: "Your AA drafts and settings are saved in your browser's <b>Local Storage</b>. They are never sent to external servers.", 
        ja: "作成中のAAや設定データは、お使いのブラウザの <b>Local Storage</b> に保存されます。これらが外部のサーバーに送信されることはありません。" 
    },
    
    priv_sec3_title: { en: "3. Image Processing", ja: "3. 画像処理について" },
    priv_sec3_desc: { 
        en: "All image loading and AI processing happens entirely <b>within your browser (client-side)</b>. Your images are never uploaded to our servers, so please use with confidence.", 
        ja: "画像の読み込みやAIによる変換処理は、すべて <b>お客様のブラウザ内 (クライアントサイド)</b> で行われます。画像データが開発者のサーバー等にアップロードされることは一切ありませんので、安心してご利用ください。" 
    },

    // --- About Modal ---
    about_title: { en: "ℹ️ About AHoge Editor ML", ja: "ℹ️ AHoge Editor ML について" },
    about_version: { en: "Version", ja: "バージョン" },
    about_desc: { 
        en: "AHoge Editor ML is a next-gen AI-powered ASCII Art editor.", 
        ja: "AHoge Editor ML は、AIを搭載したアスキーアートエディタです。" 
    },
    
    // Links
    about_gh_title: { en: "GitHub Repository", ja: "GitHub リポジトリ" },
    about_gh_desc: { en: "Source code & Issues", ja: "ソースコード・不具合報告" },
    about_x_title: { en: "Developer's X", ja: "開発者の X (Twitter)" },
    about_x_desc: { en: "Follow for updates", ja: "更新情報をフォロー" },
    
    // Footer
    about_powered: { en: "Powered by", ja: "使用技術" },
    about_rights: { en: "AHoge Editor Project. All rights reserved.", ja: "AHoge Editor Project. All rights reserved." },
// --- Help Modal ---
    help_title: { en: "📚 Help & Shortcuts", ja: "📚 ヘルプとショートカット" },
    
    // Flow Brush
    help_flow_title: { en: "🖌️ Flow Brush (Image Tab)", ja: "🖌️ フローブラシ (画像タブ)" },
    help_flow_desc: { 
        en: "Draw lines on the canvas. When you release the mouse, AI converts your strokes into ASCII Art instantly.", 
        ja: "キャンバス上で線を引くと、マウスを離した瞬間にAIがストロークの流れに沿ってAAを生成します。" 
    },
    help_action_drag: { en: "Drag", ja: "ドラッグ" },
    help_action_draw: { en: "Draw Line", ja: "線を引く" },
    help_action_release: { en: "Release", ja: "離す" },
    help_action_gen: { en: "Generate AA", ja: "AA生成" },

    // Shortcuts
    help_kb_title: { en: "⌨️ Keyboard Shortcuts", ja: "⌨️ キーボードショートカット" },
    help_kb_box: { en: "Box Selection (Trace Editor)", ja: "矩形選択 (トレース画面)" },
    help_kb_nudge: { en: "Nudge Cursor", ja: "カーソル微調整 (Nudge)" },
    help_kb_tab: { en: "Paint / Accept Ghost", ja: "塗り確定 / ゴースト確定" },
    help_kb_ctx: { en: "Context Menu / AI Suggestion", ja: "矩形貼り付け / AI提案" },

    // Tips
    help_tips_title: { en: "✨ Tips", ja: "✨ ヒント" },
    help_tips_hatching: { 
        en: "<b>Paint:</b> Specify the areas to be painted using the Bucket Tool or similar tools.", 
        ja: "<b>塗りの指定:</b> バケツツールなどで塗る箇所を指定することができます。自動生成はもちろん、Tabで塗れます。" 
    },
    help_tips_line: { 
        en: "<b>Line:</b> Since the line extraction is basic, using external coloring tools might produce higher-quality AA results.", 
        ja: "<b>線画:</b> 線画抽出は簡易的なので、外部の塗り絵ツールなどを使ったものの方が高精度にAA化できるかもしれません。" 
    },
    help_tips_safe: { 
        en: "<b>Safe Mode:</b> Use only standard characters visible on all devices.", 
        ja: "<b>セーフモード:</b> どの環境でもズレにくい標準的な文字のみを使用します。" 
    },
    help_tips_opacity: { 
        en: "<b>Trace Opacity:</b> Lower opacity to see your AA clearly over the image.", 
        ja: "<b>不透明度:</b> トレース画像の不透明度を下げると、作成したAAが見やすくなります。" 
    },
    help_tips_box: { 
        en: "<b>Box Paste:</b> Use \"Rect Paste\" in Edit menu to paste AA blocks without breaking layout.", 
        ja: "<b>矩形貼り付け:</b> 編集メニューの「矩形貼り付け」を使うと、レイアウトを崩さずにAAの一部を移植できます。" 
    },

    // --- Timelapse Modal ---
    time_title: { en: "⏱️ Timelapse Replay", ja: "⏱️ タイムラプス再生" },
    time_rendering: { en: "Rendering Video...", ja: "動画書き出し中..." },
    time_warn: { en: "Do not close window", ja: "ウィンドウを閉じないでください" },
    
    // Controls
    time_play: { en: "▶ Play", ja: "▶ 再生" },
    time_pause: { en: "⏸ Pause", ja: "⏸ 一時停止" },
    time_rewind: { en: "Rewind", ja: "巻き戻し" },
    time_speed: { en: "Speed:", ja: "速度:" },
    time_save: { en: "💾 Save Video", ja: "💾 動画を保存" },
    
    // Error
    time_err_export: { 
        en: "Video export failed. Browser may not support WebM recording.", 
        ja: "動画の書き出しに失敗しました。ブラウザがWebM録画に対応していない可能性があります。" 
    },

    input_img_toast: { en: "Line Art Extracted", ja: "線画を抽出しました" },
    input_img_text: { en: "Color image detected.\nIt is recommended to extract line art for better ASCII Art results.\n\nDo you want to run Line Art Extraction?", 
                      ja: "カラー画像が入力されました。\n線画でなければうまくAA化できないのですが、簡易的な線画抽出を実行しますか？\n(塗り絵作成などの外部サイトを利用する方が高精度かもしれません。)" },
};

export type Lang = 'en' | 'ja';
export type TransKey = keyof typeof translations;