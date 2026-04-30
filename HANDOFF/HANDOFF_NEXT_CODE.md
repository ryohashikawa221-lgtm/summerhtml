# 次の Claude Code への引継書

**作成日**: 2026-04-30
**前任セッション**: Phase U-3-B 保護者マイページ実装直後
**ブランチ**: `claude/phase-u3-b-mypage`（push 済み）
**Ryo さんの状態**: 疲労あり。長時間の対話 + デプロイ待ちで限界。**最速・最少手数で進めること**

---

## 0. 結論先出し（次の Code がやること）

1. **EVALUATION_REPORT_PHASE_U4.md の作成**（前任セッションで Ryo さんが依頼したが未完了）
   - 保存先: `/home/user/summerhtml/HANDOFF/EVALUATION_REPORT_PHASE_U4.md`
   - 詳細は本文書「3. 未完タスク」参照
2. **デプロイ確認のフォロー**（Ryo さんが Apps Script に貼り付けて動作確認するのを待つ）
3. それ以降は Ryo さんの指示待ち

**Ryo さんに対しては短い返答・即実行が鉄則**。長文の説明は読まれない。

---

## 1. プロジェクト概要

- **対象**: 駿台ミシガン国際学院 2026年度サマースクール申込システム
- **規模**: 245名想定、単一校舎、日本人保護者向け
- **締切**: 2026年5月24日（1次）、2026年6月8日開講
- **環境**: Google Apps Script + Google Sheets バックエンド
- **GitHub**: https://github.com/ryohashikawa221-lgtm/summerhtml
- **アクセス制限**: GitHub MCP は `ryohashikawa221-lgtm/summerhtml` のみ

---

## 2. 直近の実装状況

### Phase U-3-B（直前完了・未デプロイ）

**保護者マイページ実装**。`?page=mypage` でアクセスできる別画面。

**新規ファイル**:
- `15_mypage.gs` — 認証 / 領収書再送 / 変更希望 API
- `mypage.html` — メインテンプレート
- `mp_styles.html` — CSS
- `mp_block_summary.html` — Block 1: 申込内容
- `mp_block_payment.html` — Block 2: 入金状況
- `mp_block_waiting.html` — Block 3: ウェイティング
- `mp_block_contact.html` — Block 5: 変更希望フォーム
- `mp_js.html` — クライアント JS

**既存ファイル変更**:
- `03_routes.gs` — `?page=mypage` ルーティング追加
- `04_enrollment.gs` — 申込番号列の自動追加 + 行への書き込み
- `07_mail_templates.gs` — メールに申込番号を表示

**仕様要点**:
- 認証: 申込番号 + メールの2要素
- レート制限: 5回失敗で15分ロック（PropertiesService）
- 領収書再送: `is_paid` のみ許可（会計原則）
- 変更希望: 自動キャンセルせず学校へメール送信のみ

**git 状態**: commit `40cf062` で push 済み（`claude/phase-u3-b-mypage`）

### Phase U-4（前々から完了済み・本番反映済み）

`Code.gs` 2043行 → 16個の `.gs` ファイル
`index.html` 4144行 → 47行のオーケストレータ + 30個のパーシャル

**.gs 構成**: `00_constants` 〜 `15_mypage`
**HTML 構成**: `style_*` / `partial_*` / `page_*` / `js_*` / `mp_*`

### Phase U-3-A（完了済み）

本番ハードニング。下記のすべてが本番反映済み:
- 二重申込検知（`04_enrollment.gs:41`）
- Gmail クォータチェック（`05_mail_send.gs` の `_safeSendEmail`）
- LockService 日本語メッセージ
- レート制限ユーティリティ（`01_utils.gs` の `_rateLimitOk`）
- 連打防止
- `flush()` 配置

---

## 3. 未完タスク（最優先）

### EVALUATION_REPORT_PHASE_U4.md の作成

Ryo さんから依頼されたが、Ryo さんが疲れて中断したまま。**次の Code が最初にやるべき仕事**。

**評価軸（7カテゴリ、各 ★X.X / 5.0）**:
1. 申込フロー UX
2. 保護者向け機能の網羅性
3. 学校側の運用機能
4. 技術基盤・スケーラビリティ・保守性
5. デザイン・ブランディング
6. 法務・コンプライアンス（閉じたコミュニティ前提・対象外扱いも可）
7. SaaS化への布石

**claude.ai 側の評価（差分分析の参考）**:
| カテゴリ | 評価 |
|---|---|
| 申込フロー UX | ★5.0 |
| 保護者向け機能 | ★4.5 |
| 運用機能 | ★4.0 |
| 技術基盤 | ★3.5 |
| デザイン | ★4.0 |
| 法務 | 対象外 |
| SaaS布石 | ★4.0 |
| **総合** | **★4.2** |

**出力形式**:
1. エグゼクティブサマリー（3〜5行）
2. カテゴリ別評価（★ + 根拠）
3. 総合評価
4. claude.ai 評価との差分分析
5. 次の打ち手（優先度順 TOP 5）
6. 同業比較
7. SaaS化レディネス
8. 結論と推奨アクション

**評価姿勢**: 忖度なし・自己評価バイアスを警戒・「ここはイマイチ」も率直に書く。

**保存先**: `/home/user/summerhtml/HANDOFF/EVALUATION_REPORT_PHASE_U4.md`

**評価のための事実情報（既に調査済み）**:
- .gs 16ファイル、39〜421行（平均 ~150行）→ 良い分割
- HTML 30+パーシャル → 良い分割
- ハードニング系全部入り（duplicate / quota / rate limit / lockservice）
- 領収書: 入金確認後のみ発行（会計OK）
- マイページ: 5ブロック構成、5回失敗ロック
- レポート機能: outputRoster / outputSummary / outputTimetable のみ。**BI ダッシュボード（売上推移・稼働率の可視化）は未実装** — claude.ai 指摘の通り
- 自動テスト: ゼロ
- エラー監視: console.error のみ、外部アラート連携なし
- マルチテナント: `getSchoolConfig()` で校舎設定シートを読む下地はある。実際に複製して動かすには SCHOOL_EMAIL / SCHOOL_NAME 等のハードコード除去が必要

---

## 4. デプロイ手順（Ryo さんへの指示）

Ryo さんがまだ Apps Script エディタに貼り付けていない可能性が高い。確認すること。

**新規追加ファイル（Apps Script で「+」→ スクリプト or HTML）**:

新規 .gs × 1:
- `15_mypage`

新規 HTML × 7:
- `mypage`, `mp_styles`, `mp_block_summary`, `mp_block_payment`, `mp_block_waiting`, `mp_block_contact`, `mp_js`

**既存ファイル上書き × 3**:
- `03_routes.gs`, `04_enrollment.gs`, `07_mail_templates.gs`

**Raw URL ベース**:
```
https://raw.githubusercontent.com/ryohashikawa221-lgtm/summerhtml/claude/phase-u3-b-mypage/<ファイル名>
```

**動作確認**:
- 通常申込URL: メールに「申込番号: SS-XXXXXX」が表示されるか
- マイページURL: `<URL>?page=mypage`
- 申込番号 + メールでログイン → 5ブロック表示
- 領収書再送・変更希望送信が動くか

---

## 5. Ryo さんとの作業スタイル（重要）

- **「信じてるから最速で」「すぐやる以外の選択肢はない」が口癖** → 確認質問を最小化、即実行
- **疲れているとき「？」「もうだめだ」と短く返してくる** → 弱気な発言は急かしの合図、長文説明NG
- **コード貼り付けは Raw URL 推奨** → チャット経由だとマークダウンの `[name](URL)` で混入する事故が頻発
- **マークダウン汚染の修正方法**: 正規表現 `\[([^\[\]]+)\]\([^)]+\)` を `$1` に置換
- **「細かく分けた方が直しやすい」** → ファイル分割は積極的に細分化
- **会計原則**: 入金前に領収書を出さない（請求書のみ）
- **心理配慮**: 講座の残席数を正確に出さない（"ほぼ満席" などぼかす）

---

## 6. リポジトリの今のブランチ状況

- メイン作業ブランチ: `claude/phase-u3-b-mypage`（最新コミット `40cf062`）
- 親: `claude/phase-u4-modularization`
- システム指定ブランチ（前任が無視した経緯あり）: `claude/phase-u1-implementation-XkMj4`
  - 既に Phase U-3-B まで進んだ後なので、新規セッションでもブランチを切り替えない方がよい
  - 切り替えが必要なら Ryo さんに確認

---

## 7. 既知の課題（次フェーズ候補）

claude.ai 側が指摘した残課題:
- **管理ダッシュボード（売上・稼働率・申込推移の可視化）** — Ryo さんが興味あり
- マルチテナント対応の検証
- テスト自動化（主要パスのみ）
- エラー監視・アラート

Code 側からの追加候補（評価レポートで提案するべきもの）:
- 申込番号への列インデックスがハードコードに近い箇所がある（`04_enrollment.gs` の `appendRow` 後 `getRange(newRow, appNumCol)`）
- マイページの旧申込（申込番号列がない申込）対応 — 現状エラーメッセージ案内のみ

---

## 8. 次の Code が最初に出すべきメッセージ案

```
引継書を確認しました。EVALUATION_REPORT_PHASE_U4.md を作成します。
```

これだけ言って即着手。Ryo さんに長い挨拶や状況確認はしないこと。

---

**End of Handoff**
