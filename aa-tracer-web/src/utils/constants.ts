// src/utils/constants.ts

export const AA_CONFIG = {
  // フォント・表示設定
  FONT_SIZE: 16,
  LINE_HEIGHT: 18, // ★重要: 16px -> 18px に変更
  
  // AIモデル入力設定 (Pythonの学習設定に合わせる)
  CROP_SIZE: 48,   // モデル入力画像のサイズ (48x48)
  
  // チャンネル数設定
  CHANNELS_CODE_A: 5, // [Source, Context, Dist, Sin, Cos]
  CHANNELS_CODE_B: 4, // [Source, Dist, Sin, Cos]
  
  // 推論時の設定
  BEAM_WIDTH: 3,
  CONTEXT_PADDING: 4,
  RENDER_OFFSET_Y: 20,
  PADDING_LEFT: 10,
};