# goudou_enshu_app セットアップ手順

駿台USA合同演習会 申込〜答案収受〜採点配信システムのセットアップ。

## 想定環境

- Mac/Linux + Node.js (clasp 用)
- Google Workspace アカウント (Sundai 共有用 GMail でも動く設計、Mailer は MailApp 使用)
- Google Drive / Sheets / Docs / Apps Script

## 手順

### 1. clasp プロジェクト作成

```bash
cd ~/Desktop/goudou_enshu_app
mkdir -p gas_src
# このリポジトリの gas_src/ の中身を gas_src/ にコピー (or git clone)
cd gas_src
clasp login
# 既存 GAS プロジェクトに紐付ける場合:
#   clasp clone <SCRIPT_ID>
# 新規作成する場合:
#   clasp create --type sheets --rootDir .
```

### 2. スプレッドシート作成

新規スプレッドシートを作り、シート ID をメモ:

- 名前: `goudou_enshu_app マスター (dev)`  または `(prod)`
- URL: `https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit`

### 3. Script Property 設定

GAS エディタ → プロジェクト設定 → スクリプト プロパティ で以下を追加:

| キー | 値 |
|---|---|
| `APP_ENV` | `dev` または `prod` |
| `dev_spreadsheet_id` | 上記 SHEET_ID (dev 環境) |
| `prod_spreadsheet_id` | 本番用 SHEET_ID (本番のみ) |
| `timezone` | `America/Detroit` (もしくは校舎の所在地) |

### 4. 初期セットアップ実行

GAS エディタの関数選択ドロップダウンで以下を順に実行:

1. **`initialSetup()`** — 全シートを Schema 通り作成 + Settings 既定値投入
2. **`seedTeachers()`** — `m_先生` に 6 行 (国語/数学/算数/英語 × 中3/小6) を初期投入
3. **`ensureFolders()`** — Drive ルート (駿台USA合同演習会) + 提出済/採点済 + 教科別フォルダを ensure し、`m_先生` にフォルダ ID を書き戻す
4. (dev 環境のみ) **`seedTestStudents()`** — `m_受験生_MI` にテストデータ 3 行投入

すべてを 1 発で行う `fullBootstrap()` も用意。

### 5. 受験生マスタ投入

各校舎担当者が `m_受験生_LA/MI/NJ/NY/TX/HU` にそれぞれ受験生を入力する。

列構造:

| 列 | 名前 | 必須 | 例 |
|---|---|---|---|
| A | 受験番号 | ✅ | MI-001 |
| B | 学年 | ✅ | 中3 |
| C | 氏名 | ✅ | 山田太郎 |
| D | 氏名カナ | | ヤマダ タロウ |
| E | 保護者メール | ✅ | parent@example.com |
| F | 本人メール | | student@example.com |
| G | 受験教科 | ✅ | 国語,数学,英語 |
| H | 備考 | | |

### 6. 統合ビュー作成 (任意)

`m_受験生_統合` シートを手動作成し、A1 セルに以下の QUERY 式を入力:

```
=QUERY({m_受験生_LA!A2:H; m_受験生_MI!A2:H; m_受験生_NJ!A2:H; m_受験生_NY!A2:H; m_受験生_TX!A2:H; m_受験生_HU!A2:H}, "SELECT * WHERE Col1 IS NOT NULL", 0)
```

A1 1 行目には手動でヘッダ (受験番号 / 学年 / 氏名 / ...) を入れる。

### 7. WebApp デプロイ

GAS エディタ → デプロイ → 新しいデプロイ → 種類「ウェブアプリ」

- 実行アカウント: 自分 (Sundai 管理者)
- アクセス権: 全員 (anonymous)

デプロイ完了後の WebApp URL をメモし、GAS エディタで以下を実行:

```javascript
Settings.setWebAppUrl('upload', 'https://script.google.com/macros/s/.../exec');
Settings.setWebAppUrl('apply',  'https://script.google.com/macros/s/.../exec');
```

(同じ URL でも `?role=upload` / `?role=apply` の区別は自動付与)

### 8. onEdit トリガー設定

GAS エディタで `setupTriggers()` を実行。

これにより `tx_採点` シートの「点数」列入力で答案が採点済フォルダに自動移動する。

### 9. (G-6 用) 案内ドキュメントテンプレ登録

前々セッション成果物の docx 6 ファイルを Google Docs にインポートし、各 doc id を Settings に登録:

```javascript
Settings.set('tpl_doc_id_東部_中学受験', '<DOC_ID>');
Settings.set('tpl_doc_id_東部_高校受験', '<DOC_ID>');
Settings.set('tpl_doc_id_中部_中学受験', '<DOC_ID>');
Settings.set('tpl_doc_id_中部_高校受験', '<DOC_ID>');
Settings.set('tpl_doc_id_太平洋部_中学受験', '<DOC_ID>');
Settings.set('tpl_doc_id_太平洋部_高校受験', '<DOC_ID>');
```

各テンプレ内には以下のプレースホルダを埋め込む:

- `{{開催日}}`
- `{{申込締切日}}`
- `{{解説Zoom_URL}}`
- `{{解説Zoom_パスコード}}`
- `{{年度}}`
- `{{学校名}}`

`g6_generateAll()` で 6 ファイル一括生成。

### 10. 演習会開催日 (5/17) 当日

1. 朝 9 時頃: 各校舎担当者が受験生マスタ最終確認
2. 答案アップロード受付開始 (G-2): 保護者にメール内 URL 利用を案内
3. 締切後: `g3_populateGrading()` 実行 (tx_答案 → tx_採点 反映)
4. 先生が tx_採点 で点数入力 → onEdit トリガーが採点済フォルダへ自動移動
5. 全採点完了後: `g3_computeRankings()` 実行
6. 管理者ダッシュボード (`?role=dashboard`) で進捗確認 + プレビュー
7. kill switch ON (`g3_setBulkMailEnabled(true)`)
8. 「結果を一斉配信」ボタン → 配信実行
9. **kill switch OFF (重要、必ず元に戻す)** (`g3_setBulkMailEnabled(false)`)

## トラブルシューティング

### Q. 「シート未作成」エラー

`initialSetup()` を実行していない。GAS エディタから手動実行する。

### Q. 「Script Property "dev_spreadsheet_id" が未設定」

Script Property に `dev_spreadsheet_id` または `prod_spreadsheet_id` を追加する。

### Q. G-2 で「提出先フォルダが未設定です」

`m_先生` の対応行に `提出済フォルダID` が空。`ensureFolders()` を再実行する。

### Q. G-3 配信が「KILL SWITCH」で止まる

これは設計通り。`g3_setBulkMailEnabled(true)` で ON にしてから配信する。**配信完了後は必ず OFF に戻す**。

### Q. 画像 → PDF 結合が遅い / タイムアウト

Settings で `enable_image_to_pdf` を `false` に変更し、保護者には Adobe Scan / CamScanner で 1 PDF にまとめてもらうよう案内する。
