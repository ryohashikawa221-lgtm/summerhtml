// ============================================================
// 駿台ミシガン国際学院 サマースクール – GAS バックエンド
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📅 最終更新: 2026-05-01 02:30 JST
// 🔖 バージョン: Phase U-3-A（本番投入前ハードニング）
//   - 二重申込検知（10分以内・同一メール+生徒名）
//   - _safeSendEmail 共通関数（クォータ対策・ステータス記録・再送）
//   - LockService 日本語メッセージ化
//   - 連打防止 + SpreadsheetApp.flush()
//   - 申込番号採番（SS26-NNNN-XXX、Phase U-3-B 用ベース実装）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 主な履歴:
//   2026-04-29 ★マージ版 v2: セキュリティ強化 + マスターデータ機能
//   2026-04-30 Phase U-2:    HTML確認メール / Zelle案内 / 印刷フォーマット
//   2026-04-30 Phase U-2.1:  申込数集計を動的化 / 時間割タームor先生別出力 /
//                            申込一覧の編集で自動再計算するトリガー追加
// ============================================================
const APP_VERSION = 'Phase U-3-A / 2026-05-01 02:30 JST';

const S_SETTINGS  = '学校設定';
const S_COURSES   = '講座マスター';
const S_EIKEN     = '英検マスター';
const S_PRICE     = '料金マスター';
const S_DISCOUNT  = '割引マスター';
const S_ENROLL    = '申込一覧';
const S_WAITING   = 'ウェイティング一覧';
const S_COUNTS    = '申込数集計';
const S_TIMETABLE = '先生別時間割';
const S_ROSTER    = '講座別名簿';
const S_SUMMARY   = '申込サマリー';

const SHEET_ENROLL = S_ENROLL;
const SHEET_COUNTS = S_COUNTS;

const SCHOOL_EMAIL = 'r-hashikawa@sundai-kaigai.jp,michi-info@sundai-kaigai.jp,m-sakamoto@sundai-kaigai.jp';
const SCHOOL_NAME  = '駿台ミシガン国際学院 サマースクール';

const ADMIN_PASS_FALLBACK = 'sundai2026';

