# DESIGN NOTES — Web Session 引き継ぎメモ

**生成**: 2026-05-03 (web Claude Code セッション)
**目的**: Mac ターミナル側 Claude Code セッションと設計を統合するための共有ドキュメント
**対象ブランチ**: `claude/implement-goudou-enshu-app-dRJ4a`
**対象コミット**: 初回実装 (18 files, 4,612 行)

このドキュメントは「何を作ったか」より **「なぜそう設計したか」「どこを意識的に簡素化したか」「次に何を議論すべきか」** に焦点を当てる。コード自体は読めるので、決定の根拠だけ残す。

---

## 1. 全体アーキテクチャの選択

### 1.1 hoshuko_app との関係

**判断**: lib 群は **コピー (流用ではない)** で着手。共通化は半年運用後に検討。

理由:
- hoshuko 側のリファクタを巻き込まれたくない
- Goudou 専用の Schema (受験生 6 校舎タブ + tx_*) は hoshuko の 22 テーブルとは別世界
- 時間制約 (5/17 まで 14 日) で抽象化を急ぐとリスクが高い

代わりに **「教訓だけ伝搬」**:
- Phase 1 Date シリアライズ対策 → `lib_SheetDB._readAll` の col-resolution one-pass にそのまま反映
- Phase 9-X closure cache → `lib_Util.getTz` にそのまま反映
- D-049 kill switch → `lib_Settings.isBulkMailEnabled` で G-3 一斉配信を保護

### 1.2 Schema 設計の重大な分岐点

**判断**: 受験生マスタは **校舎別 6 タブを物理分離** (Schema 上も別テーブル扱い)

理由:
- HANDOFF §3 で「校舎担当者のみ編集可」が要件 (LA担当は LA タブのみ書込)
- 物理分離なら Spreadsheet の保護機能で完結 (各タブに編集者を制限するだけ)
- 統合ビュー (`m_受験生_統合`) は QUERY 関数で読み取り専用ビューを生成

**代替案で却下したもの**:
- 単一 m_受験生 + 校舎列フィルタ → 編集権限分離が複雑になる
- ユニオンビューだけ Schema に登録 → 書込みがどのタブに行くか曖昧

**コード上の影響**:
- `Schema.studentSheetName(campus)` で校舎コードからシート名を取得
- `Schema.campusOfStudentId('MI-001')` で逆引き (受験番号プレフィックスから campus 抽出)
- G-2 アップロード時は受験番号→校舎→シート名の経路でしか引かない

### 1.3 受験番号 PK は 数値 id ではなく文字列 (logical PK)

**判断**: m_受験生 系は `hasId: false`, `timestamps: false`, `softDelete: false`

理由:
- 受験番号 (例: MI-001) は **校舎担当者が事前発番** する logical key
- 数値 id は不要 (むしろ混乱の元)
- 校舎担当者は手動でシート編集する想定なので timestamps 自動付与も邪魔
- 退学概念がないので softDelete 不要

**コード上の影響**:
- `SheetDB.insert('m_受験生_MI', {...})` は id を付けない (Schema が hasId: false)
- 検索は `SheetDB.findOne(sheetName, { 受験番号: 'MI-001' })` 一択
- 採点・申込・答案系は数値 id で連番、業務キーとして 受験番号 を持つ

---

## 2. G-2 (心臓部) の設計判断

### 2.1 ファイル変換戦略

実装した分岐:
```
PDF 1 個                → そのまま保存
画像 1 枚                → そのまま保存 (.jpg/.png/...)
画像複数                 → DocumentApp 経由で PDF 結合
PDF 複数 / PDF+画像混在  → エラー (運用上禁止)
```

**判断**: PDF 結合は `DocumentApp.create → appendImage → getAs('application/pdf')` で実装

理由:
- Drive Advanced Service なし (Drive.Files.copy with conv) でも動く
- DocumentApp は標準 GAS、追加 Service 不要
- US Letter 612pt - margins ≈ 572pt にフィット縮小

**キルスイッチ**:
- `Settings.enable_image_to_pdf` を false にすると画像複数アップロードが弾かれる
- HANDOFF 注: 「1日以上かかるなら PDF のみに切る判断」に対応するスイッチ
- 当日 GAS 6 分制限に引っかかったらこれで凌ぐ

### 2.2 再アップロード時の supersede 設計

**判断**: 旧ファイルは **物理削除せず** リネーム (`_superseded_YYYYMMDD_HHMMSS`)、tx_答案 行は status=`superseded` でマーク

理由:
- 誤上書きで答案紛失する事故を絶対避ける (5/17 当日リカバリ不能)
- Drive にゴミ残るが、後日手動削除できる
- audit trail として「いつ誰が再アップロードしたか」が tx_答案 に履歴で残る

**未対応 (議論したい)**:
- Drive 上の supersede 旧ファイルが教科別フォルダに残る → 採点先生が混乱する可能性
- 案: 別フォルダ `_superseded/` に移すべきか? (やるならコード追加必要)

### 2.3 認証

**判断**: ワンタイムトークンなし、studentId だけで認証

理由 (HANDOFF §4 末尾の運用前提に従う):
- 確認メール URL が漏洩する想定外
- 採点は事務局チェックを通すので悪意ある第三者の影響は限定的
- 当日朝の混乱でトークン失効事故が起きるほうが怖い

**改修案 (来年度以降)**:
- 確認メール送信時に random token を tx_申込 に保存
- G-2 URL に `&token=xxx` を含める
- token なし or invalid なら拒否

---

## 3. G-3 (採点配信) の設計判断

### 3.1 採点フロー: onEdit + 手動配信ボタン

**判断**: 採点は **シート直接編集** + 配信は **管理者ダッシュボードのボタン**

理由:
- 先生は Spreadsheet ネイティブ UI (フィルタ・ソート・コピペ) を求める
- 配信は不可逆 (送信済メールは取り消し不能) なので明示的なボタン操作
- onEdit は採点済フラグ更新と Drive 移動のみ (副作用最小)

**運用フロー**:
```
締切 → g3_populateGrading() で tx_答案 → tx_採点 を populate
     → 先生が tx_採点 を直接編集 (点数列入力)
     → onEditGrading が発火、自動で 採点済フォルダに移動
     → 全採点完了後、管理者が g3_computeRankings()
     → ダッシュボードで進捗確認 + プレビュー1件
     → kill switch ON → 配信 → OFF
```

### 3.2 部分配信の防止

**判断**: 受験生が予定する受験教科すべての採点が完了するまで、その受験生は配信対象から外す

理由:
- 「国語と数学だけ採点済」で送ると後追いで「英語の結果も来ます」と注意書きが必要
- 一斉配信なので個別ステータス管理は煩雑
- skipped 件数で何人が部分採点で残っているか可視化 (ダッシュボード)

### 3.3 順位の計算粒度

実装:
- 教科別順位 = 学年 × 教科 内で算出 (例: 中3 国語の中で何位)
- 総合順位 = 学年内で合計点比較 (例: 中3 全体で何位)
- 同点は同順位 (1, 1, 3, ... pattern)

**未対応 (議論したい)**:
- 校舎別順位は出していない。HANDOFF にも要件記載なし。出すべきか?
- 偏差値は出していない (受験者数小規模で意味薄)

### 3.4 結果メールテンプレ

統一テンプレ。学年・教科・点数・順位・採点済PDFリンク・所見 を差し込む。

**未対応 (議論したい)**:
- 添付 PDF にしないで Drive リンクで配信 → 保護者が Google アカウントなしだと見れない可能性
- 案: PDF 採点済ファイルをメールに直接添付するオプションを追加? (容量との兼ね合い)
- ただし 200 名 × 3 教科 × 2MB = 1.2GB 一括送信 quota 超過リスク

---

## 4. 簡素化のためにあえて落としたこと

時間制約で意図的にスコープアウトした項目:

| 項目 | 落とした理由 | 来年度実装目安 |
|---|---|---|
| ワンタイムトークン認証 | 当日トークン失効事故が怖い | 2027 |
| 偏差値・標準偏差表示 | 小規模受験者で意味薄 | 必要なら 2027 |
| 校舎別ランキング | 要件未確定 | 議論次第 |
| 採点済 PDF 添付配信 | quota リスク | リンク経由で当面OK |
| supersede 旧ファイルの別フォルダ移動 | 採点先生の手動掃除でカバー | 2027 |
| 受験番号 自動採番 | 校舎担当者が事前発番する想定 | 議論次第 |
| G-1 で受験番号未指定の保護者直接申込 | 校舎承認フロー実装が重い | 2027 |
| 採点者の権限管理 | onEdit で誰でも書ける | Sheets 編集権限で代替 |

---

## 5. 既知の落とし穴 (デプロイ時注意)

### 5.1 doGet の WebApp デプロイモード

`appsscript.json` で `executeAs: USER_DEPLOYING` + `access: ANYONE_ANONYMOUS` 指定済。

これは **デプロイした人 (Ryo) の権限で動く** ため、Drive / Sheets / Mail はすべて Ryo のアカウント quota を消費する。

**注意**:
- 一斉配信時の MailApp quota は **Ryo のアカウントの 100/日 (Workspace なら 1500/日)** に依存
- 当日 200 名 × 1 通なら問題ないが、再送が必要になると 2 日跨ぎになる可能性
- prod デプロイ前に `MailApp.getRemainingDailyQuota()` を必ず確認

### 5.2 onEdit トリガーは installable 必須

シンプルトリガー (関数名 `onEdit` のみ) では `Session.getActiveUser()` や `MailApp` が動かない。

`setupTriggers()` で **インストール型トリガー** を別関数 `onEditGrading` にして登録している。Ryo が自分のアカウントで `setupTriggers()` を 1 回実行すれば OK。

### 5.3 LockService 失効

GAS の Lock は実行プロセス単位。HtmlService (フロントから google.script.run) の同時呼び出しでは効かない:
- 答案アップロードは `tx_答案` の insert だけ Lock 内、ファイル保存は外
- 同一受験番号で同時 2 アップロードが来たら supersede が race する可能性あり
- 実用上、保護者が同時タップする確率は低いので無視 (議論したい)

### 5.4 base64 経由のファイルサイズ

`google.script.run` リクエストは ~50MB 制限 + base64 33% 膨張。

クライアント側で `totalBytes > 30MB` で弾いている。1 教科で 30MB 超のケースはほぼ無いはず (PDF なら 5MB 以下が普通) だが、4K 写真複数枚で当たる可能性。

---

## 6. アイディア統合 / 改善の余地 (Mac セッション側との議論ポイント)

優先度順:

### A. 必ず議論したい
1. **支援フロー**: 校舎担当者が Spreadsheet で受験生マスタを編集する UI、現行は素のシート。校舎別の入力フォーム (HtmlService) を作るべき?
2. **進捗 polling**: G-3 ダッシュボードは手動 refresh のみ。当日リアルタイム性が要るなら 30 秒 polling 入れるべき?
3. **メール送信失敗のリトライ**: 現状は失敗を `failed[]` に積むだけ。指数バックオフ自動再送を入れるか?

### B. やる気があれば
4. **多言語**: HANDOFF にはないが、保護者が英語のみの家庭がある場合、G-1/G-2 の i18n 切替 (ja/en)
5. **テスト**: hoshuko 側で testing infrastructure (lib_TestRunner.gs 等) があれば移植したい
6. **API_ENV=prod 切替時の安全弁**: hoshuko の `bulk_mail_send_enabled` のような追加 kill switch
7. **ロギング**: Logger.log は GAS 7 日で消える。重要操作だけ audit_log に追加保存する?

### C. 来年度送り
8. G-4 個人別 PDF レポート自動生成
9. G-5 受験生マイページ
10. 校舎ごとの ダッシュボードビュー (各校舎担当者が自校舎だけ見える権限制御)

---

## 7. ファイルマップ

```
gas_src/
├── appsscript.json         OAuth スコープ + WebApp 設定
├── Code.gs                 doGet ルーター + initialSetup / seedTeachers / ensureFolders / seedTestStudents / fullBootstrap
├── lib_SheetDB.gs          (移植) データアクセス層、Phase 1/9-X 修正引き継ぎ
├── lib_Util.gs             (移植) 共通 Util、closure cache 引き継ぎ
├── lib_Lock.gs             (移植) LockService ラッパ
├── lib_Mail.gs             (移植) MailApp ラッパ + kill switch
├── lib_AuditLog.gs         (移植) シート名 audit_log に変更
├── lib_Schema.gs           (新規) 6校舎別 受験生 + tx_申込/答案/採点 + m_先生/m_設定/audit_log
├── lib_Settings.gs         (新規) m_設定 ベース key-value + Drive ルート + kill switch
├── lib_Drive.gs            (新規) Drive 抽象 (imagesToPdf / moveFile / supersedeFile / ensureSubjectFolders)
├── api_G1_Apply.gs         G-1 申込フォーム + 確認メール送信
├── G1_Apply.html           G-1 SPA (校舎/受験番号/学年/教科 入力)
├── api_G2_Upload.gs        G-2 答案アップロード ★当日心臓部★
├── G2_Upload.html          G-2 SPA (PDF/画像複数 → 教科別フォルダ振り分け)
├── api_G3_Notify.gs        G-3 採点配信 (onEdit + 順位 + 一斉配信)
├── G3_Dashboard.html       G-3 管理者ダッシュボード (kill switch + プレビュー + 一斉配信)
├── api_G6_DocGen.gs        G-6 案内ドキュメント自動生成 (Docs テンプレ → PDF)
└── SETUP.md                セットアップ手順
```

---

## 8. Mac セッションへの依頼

このセッションが完了した時点で push 済のコードを、Mac ターミナル側で:

```bash
cd ~/Desktop/goudou_enshu_app
git pull origin claude/implement-goudou-enshu-app-dRJ4a
# gas_src/ 配下を ~/Desktop/goudou_enshu_app/gas_src/ にコピーしてから
clasp push
```

そのあと、上の §6 の議論ポイントから優先順位高いものを選んで改善 PR を出してください。

特に優先したい:
1. 校舎担当者向けの 受験生マスタ入力 UI (§6.A.1)
2. リアルタイム進捗 polling (§6.A.2) — 当日のオペレーション体験に効く
3. メール失敗リトライ (§6.A.3) — 当日トラブル耐性

このドキュメント自体も改訂歓迎。差分を読み合わせて統合方針を固めましょう。

---

**END OF DESIGN NOTES**
