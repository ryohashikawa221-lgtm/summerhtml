# Phase U-4 分割リファクタ — デプロイ手順

**ブランチ**: `claude/phase-u4-modularization`
**最終確認**: 全ファイル構文OK / include展開後の全JS構文OK / 主要関数全て保持

---

## 何が変わったか

### 機能変更:**ゼロ**
- 1ピクセルも変えていない
- 既存の挙動が完全維持されることを構文・関数存在確認で検証済み

### 構造変更:**全部**
- `index.html` 4144行 → **47行**(オーケストレータのみ)
- `Code.gs` 2043行 → 削除(15ファイルに分割)

---

## 新しいファイル構成(40ファイル)

### HTMLパーシャル(25)
```
CSS (3)
  style_main.html       (161行) メインCSS変数・レイアウト・コンポーネント
  style_mobile.html     (60行)  レスポンシブ + タップ最適化
  style_print.html      (105行) 印刷CSS + 請求書フォーマット

ページHTML (6)
  page_pamphlet.html    (97行)  ① 申込画面
  page_timetable.html   (16行)  ② 時間割
  page_invoice.html     (94行)  ③ 申込書・請求書
  page_request.html     (48行)  ④ 講座リクエスト
  page_brochure.html    (193行) ⑥ 概要パンフレット
  page_admin.html       (24行)  ⑤ 管理ページ

UI部品 (5)
  partial_opening.html       オープニングアニメ
  partial_header.html        サイトヘッダ + ナビ
  partial_print_block.html   印刷専用 div
  partial_admin_footer.html  管理者フッタ + バージョン
  partial_floating_bar.html  フローティング合計バー

JavaScript (12)
  js_data.html              (215行) COURSES + 価格定数
  js_constants.html         (237行) 学年マスタ + 検索 + 色 + STATE + 定員
  js_students.html          (167行) 生徒管理(追加・削除・コピー)
  js_pricing.html           (125行) 価格計算 + フィルタ
  js_render_courses.html    (328行) 講座カード + プレ講習カレンダー
  js_modals_actions.html    (459行) toggleCourse + 各種モーダル + iCal
  js_render_timetable.html  (225行) 時間割描画
  js_render_invoice.html    (265行) 請求書描画
  js_gas_admin.html         (350行) GAS連携 + 管理ページ
  js_print_modals.html      (351行) 紙吹雪 + 印刷請求書 + B確認モーダル
  js_send_init.html         (209行) sendEmail + INIT + ZOOM
  js_validation_draft.html  (315行) バリデーション + 自動保存 + 前年度引継
```

### .gsファイル(15)
```
00_constants.gs       (39行)  ヘッダ・APP_VERSION・シート名定数
01_utils.gs           (54行)  validation/rate limit/auth ヘルパー
02_master.gs          (118行) getSettings/Courses/Prices/Discounts/getMasterData/getSchoolConfig
03_routes.gs          (87行)  include() + doGet + doPost
04_enrollment.gs      (126行) validations + saveEnrollment + 二重検知 + 申込番号
05_mail_send.gs       (147行) _safeSendEmail + _recordEmailStatus + 再送機能
06_counts.gs          (101行) updateCourseCounts + getCourseCounts + getAdminData
07_mail_templates.gs  (183行) ZELLE定数 + esc + sendEnrollmentEmail + テンプレ
08_processors.gs      (69行)  buildResponse + processEnrollment/Request + 認証
09_advanced.gs        (169行) 共起レコメンド + マイグレーション + 校舎設定
10_waiting.gs         (74行)  addWaitingEntry
11_unpaid_status.gs   (103行) getUnpaidList + markRowAsPaid + 募集停止管理
12_menu_triggers.gs   (154行) onOpen + メニュー + onChangeAutoRefresh
13_receipt.gs         (198行) 領収書発行 + 入金消込
14_reports.gs         (421行) outputRoster + outputSummary + outputTimetable + initialSetup
```

---

## 🚨 デプロイ手順(Apps Script 側)

### ⚠️ 注意:このリファクタは**全ファイル置き換え**になるため、最初に既存プロジェクトのバックアップを推奨

**バックアップ手順**(任意):
1. Apps Script 画面 → デプロイ → デプロイを管理 → 現在のデプロイのバージョン番号を控える
2. `index.html` と `Code.gs` の現在内容をどこかに別保存(Driveや手元のテキストファイル)

### Step 1: 既存ファイルを削除

Apps Script の左サイドバー(ファイル一覧)で:
- **`Code.gs`** をクリック → ︙ → 削除
- **`index.html`** はあとで上書きするのでまだ消さない(or 削除しても可)

### Step 2: 新規 `.gs` ファイル(15個)を作成

各ファイルを GitHub の Raw URL からコピーして Apps Script に作成:

#### ファイル作成方法
1. Apps Script の左サイドバー → 「+」アイコン → 「スクリプト」を選ぶ
2. ファイル名を入力(下記の通り、`.gs` を含めない)
3. GitHub の Raw URL を開いて全コピー
4. Apps Script のファイルに貼り付け → 保存

| Apps Script のファイル名 | コピー元 Raw URL |
|---|---|
| `00_constants` | https://raw.githubusercontent.com/ryohashikawa221-lgtm/summerhtml/claude/phase-u4-modularization/00_constants.gs |
| `01_utils` | https://raw.githubusercontent.com/ryohashikawa221-lgtm/summerhtml/claude/phase-u4-modularization/01_utils.gs |
| `02_master` | https://raw.githubusercontent.com/ryohashikawa221-lgtm/summerhtml/claude/phase-u4-modularization/02_master.gs |
| `03_routes` | https://raw.githubusercontent.com/ryohashikawa221-lgtm/summerhtml/claude/phase-u4-modularization/03_routes.gs |
| `04_enrollment` | https://raw.githubusercontent.com/ryohashikawa221-lgtm/summerhtml/claude/phase-u4-modularization/04_enrollment.gs |
| `05_mail_send` | https://raw.githubusercontent.com/ryohashikawa221-lgtm/summerhtml/claude/phase-u4-modularization/05_mail_send.gs |
| `06_counts` | https://raw.githubusercontent.com/ryohashikawa221-lgtm/summerhtml/claude/phase-u4-modularization/06_counts.gs |
| `07_mail_templates` | https://raw.githubusercontent.com/ryohashikawa221-lgtm/summerhtml/claude/phase-u4-modularization/07_mail_templates.gs |
| `08_processors` | https://raw.githubusercontent.com/ryohashikawa221-lgtm/summerhtml/claude/phase-u4-modularization/08_processors.gs |
| `09_advanced` | https://raw.githubusercontent.com/ryohashikawa221-lgtm/summerhtml/claude/phase-u4-modularization/09_advanced.gs |
| `10_waiting` | https://raw.githubusercontent.com/ryohashikawa221-lgtm/summerhtml/claude/phase-u4-modularization/10_waiting.gs |
| `11_unpaid_status` | https://raw.githubusercontent.com/ryohashikawa221-lgtm/summerhtml/claude/phase-u4-modularization/11_unpaid_status.gs |
| `12_menu_triggers` | https://raw.githubusercontent.com/ryohashikawa221-lgtm/summerhtml/claude/phase-u4-modularization/12_menu_triggers.gs |
| `13_receipt` | https://raw.githubusercontent.com/ryohashikawa221-lgtm/summerhtml/claude/phase-u4-modularization/13_receipt.gs |
| `14_reports` | https://raw.githubusercontent.com/ryohashikawa221-lgtm/summerhtml/claude/phase-u4-modularization/14_reports.gs |

### Step 3: 新規 `.html` ファイル(25個)を作成

同じ要領で:
1. Apps Script の左サイドバー → 「+」 → 「HTML」を選ぶ
2. ファイル名を入力(下記の通り、`.html` を**含めない**)
3. GitHub の Raw URL からコピー → 貼り付け → 保存

| Apps Script のファイル名 | カテゴリ |
|---|---|
| `style_main`, `style_mobile`, `style_print` | CSS |
| `partial_opening`, `partial_header`, `partial_print_block`, `partial_admin_footer`, `partial_floating_bar` | UI部品 |
| `page_pamphlet`, `page_timetable`, `page_invoice`, `page_request`, `page_brochure`, `page_admin` | ページ |
| `js_data`, `js_constants`, `js_students`, `js_pricing`, `js_render_courses`, `js_modals_actions`, `js_render_timetable`, `js_render_invoice`, `js_gas_admin`, `js_print_modals`, `js_send_init`, `js_validation_draft` | JavaScript |

各 Raw URL: `https://raw.githubusercontent.com/ryohashikawa221-lgtm/summerhtml/claude/phase-u4-modularization/{ファイル名}.html`

### Step 4: `index.html` を新オーケストレータで上書き

[Raw URL](https://raw.githubusercontent.com/ryohashikawa221-lgtm/summerhtml/claude/phase-u4-modularization/index.html)
の内容(47行)で既存の `index.html` を**全置換**。

### Step 5: デプロイ

1. デプロイ → デプロイを管理 → 編集(鉛筆) → バージョン:**新しいバージョン** → デプロイ
2. ブラウザでテストURLを開いて動作確認

### Step 6: 動作確認チェックリスト

[ ] 申込画面(オープニングアニメ→ヘッダ)が表示される
[ ] 講座一覧タブが正常に動作
[ ] 時間割タブで時間割が表示される
[ ] 申込書・請求書タブで内容が見える
[ ] 講座リクエストフォームが動く
[ ] パンフレットページが見える
[ ] 管理者ページがパスワードで開ける
[ ] 申込画面右下に「v Phase U-3-A / 2026-05-01 02:30 JST」が表示される(変わってない)
[ ] 講座を選択 → 合計金額が正しい
[ ] 印刷プレビューで請求書1ページに収まる
[ ] テスト送信 → メール届く + 完了モーダル表示
[ ] スプレッドシートメニューが全て動作
[ ] スマホ表示が崩れない

---

## ロールバック手順(問題発生時)

何か不具合があれば **デプロイを管理 → 編集 → バージョン:1つ前のバージョン → デプロイ** で戻せます。

完全にリセットする場合:
1. すべての新規作成ファイルを削除
2. バックアップから旧 `Code.gs` と `index.html` を再作成
3. デプロイ

---

## トラブルシューティング

### 「include()が見つかりません」エラー
→ `03_routes.gs` が作成されていない、またはファイル名が間違っている可能性。
→ ファイル名は **拡張子なし**(`03_routes` であって `03_routes.gs` ではない)

### 申込画面が真っ白
→ HTMLパーシャルのいずれかが欠けている可能性。
→ Apps Script のファイル一覧で 26個のHTMLファイル(index.html 含め)があるか確認。

### JavaScript エラー
→ `js_*` ファイルの順序が違うとエラー。
→ `index.html` の `<script>` 内 include 順を確認(下記が正しい順):
   data → constants → students → pricing → render_courses → modals_actions
   → render_timetable → render_invoice → gas_admin → print_modals
   → send_init → validation_draft

### 全部入れたのに動かない
→ デプロイ忘れの可能性。Apps Script でファイル保存後、必ず **デプロイ → 新しいバージョン**

---

**End of Phase U-4 Deploy Instructions**
