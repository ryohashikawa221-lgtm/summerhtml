# Phase U-4 分割リファクタ用プロンプト

**投入タイミング**: Phase U-3-A・U-3-B 完了 + 本番運用が安定した後
**目安**: 6月開講後〜7月の閑散期、または9月開講前
**ステータス**: 📦 保管中(未着手)

---

## このドキュメントの位置付け

このリポジトリには複数のフェーズ計画・実装が走っており、本ファイルは
**Phase U-4(分割リファクタ)を将来実施する時に Claude Code に投げる
プロンプトテンプレート**を保管しています。

着手前提:
1. Phase U-3-A(本番投入前ハードニング) ✅ 完了済み
2. Phase U-3-B(マイページ) ⏳ 未着手
3. 5月24日(土)第1次申込締切 → 本番運用開始
4. 6月開講以降、運用が安定した時期に着手

---

## プロンプト本体(コピペ用)

> Phase U-4 として、index.html と Code.gs の分割リファクタをやってほしい。
> 機能追加は一切なし、既存挙動の完全維持が大前提。
>
> ## 背景
> 現状 index.html が約1MB / 4500行、Code.gs が約1500行のモノリス。
> Phase U-3-B でマイページが追加されてさらに肥大化した。
> 保守性・可読性・将来の機能追加スピードに影響が出始めているので整理したい。
>
> ## 作業ブランチ
> claude/phase-u4-modularization を新規作成。
>
> ## 制約(厳守)
> 1. 機能追加・仕様変更は一切しない
> 2. UI の見た目・挙動を1ピクセルも変えない
> 3. デプロイ後の Web App URL は変更しない
> 4. スプレッドシート構造・列順は触らない
> 5. 既存のコミットログ・履歴コメントを尊重する
>
> ## 分割方針
>
> ### Code.gs の分割
> 責務ごとにファイル分離。Apps Script は同一プロジェクト内の .gs ファイルを
> グローバルに参照できるので、依存関係はそのまま動く。
>
> 提案する分割:
> - main.gs                  : doGet, doPost, ルーティング, APP_VERSION
> - config.gs                : 定数, getSchoolConfig, スキーマバージョン
> - application.gs           : 申込書込み, 二重申込検知, バリデーション
> - mail.gs                  : _safeSendEmail, 各種メールテンプレート, クォータ管理
> - receipt.gs               : 領収書発行, 入金消し込み
> - waiting.gs               : ウェイティング登録・繰り上げ
> - mypage.gs                : マイページ照会 API, 申込番号採番
> - reports.gs               : 先生別時間割, 講座別名簿, 申込サマリー, 自動更新トリガー
> - migrations.gs            : runMigrations, スキーマ変更履歴
> - utils.gs                 : _validString, _validEmail, closure cache, 共通ヘルパー
> - menu.gs                  : スプレッドシートメニュー定義
>
> ただし上記は提案。実コードを見て、より自然な分割があれば提案してから実施してほしい。
> 分割案を最初に提示 → 私が OK 出してから着手、の順序で進める。
>
> ### index.html の分割
> HtmlService の include 機構を使う。
>
>   `<?!= HtmlService.createHtmlOutputFromFile('partials/header').getContent(); ?>`
>
> 提案する分割:
> - index.html               : メインのレイアウト・ルーティングのみ(目標 200行以下)
> - partials/styles.html     : <style> ブロック(CSS変数、共通スタイル)
> - partials/styles_print.html : 印刷用CSS(@media print)
> - partials/header.html     : ヘッダー、ロゴ、バージョン表示
> - partials/course_card.html : 講座カードコンポーネント
> - partials/course_modal.html : 講座詳細モーダル
> - partials/student_tabs.html : 生徒切替タブ
> - partials/timetable.html  : 時間割表示
> - partials/floating_bar.html : フローティング合計バー
> - partials/confirm_modal.html : 最終確認モーダル
> - partials/complete_modal.html : 送信完了モーダル
> - partials/print_invoice.html : 印刷用請求書テンプレート
> - partials/discount_breakdown.html : 割引内訳表示
> - partials/scripts_main.html : メインJS
> - partials/scripts_validation.html : バリデーション・自動保存JS
> - partials/scripts_print.html : 印刷制御JS
> - mypage.html              : マイページ本体(既に分離済みのはず)
> - partials/mypage_*.html   : マイページのブロック群
>
> CSS と JS のサイズが大きいので、機能単位でのファイル分割を優先する。
> 1ファイル500行を超えないことを目安に。
>
> ## 作業手順
> 1. 現状の index.html / Code.gs を読み込んで、実際の構造を把握
> 2. 分割案を提示(上記提案をベースに、実コード見て調整)
> 3. 私が OK 出す
> 4. 1ファイルずつ慎重に分離(commit 単位を細かく)
> 5. 各 commit で動作確認(最低限 doGet が通るか、申込が成功するか)
> 6. 全分割完了後、フル動作確認
> 7. PR 作成 → マージ → デプロイ
>
> ## 動作確認項目(最低限)
> - [ ] 申込画面が開く
> - [ ] 講座一覧が表示される
> - [ ] 講座選択 → 合計金額が正しく出る
> - [ ] 生徒追加・削除が動く
> - [ ] 申込送信が成功する
> - [ ] 学校通知メール・保護者確認メールが届く
> - [ ] 時間割が表示される
> - [ ] 印刷プレビューが正しく出る
> - [ ] マイページ照会が動く
> - [ ] スプレッドシートメニューが全て動く
> - [ ] スマホ表示が崩れない
> - [ ] バージョン表示が出る
>
> ## 注意事項
> - HtmlService の include は実行時に解決されるので、循環参照に注意
> - グローバルJS変数のスコープが分割で変わらないよう、IIFE化はしないこと(既存挙動維持優先)
> - Apps Script の .gs ファイル間依存はグローバル関数経由なので、関数名衝突に注意
> - マイグレーション(migrations.gs)は分割後も冪等性を維持
> - スキーマバージョンは触らない(分割は内部リファクタなのでスキーマ変更ではない)
>
> ## 完了条件
> - 全ファイルが 500行以下(index.html メインも 200行以下)
> - 既存機能が全て動作
> - ファイル構成図(README.md か HANDOFF_PHASE_U4_COMPLETE.md)を作成
> - 各ファイルの責務をコメントで明記
> - Phase U-3-B から Phase U-4 への引継ぎサマリーを生成

---

## 投入時のひとこと例(Ryo 用)

> Phase U-3 完了して運用も安定したので、リファクタやろう。
> 機能追加なし、純粋に分割だけ。プロンプトはこれ ↓
>
> [上のプロンプト本体を貼る]

---

## 設計判断の解説(Ryo 用メモ)

### なぜこのタイミング(Phase U-3 完了後)に投げるか
- 本番投入直前のリファクタは事故の元
- マイページ追加でファイルがさらに膨らんだ後にやる方が、分割の境界が見えやすい
- 運用開始後に「実際どこをよく触るか」が判明してから分割した方が、自然な責務分離になる

### 「分割案を最初に提示 → OK 出してから着手」を入れた理由
リファクタは Claude Code が独走すると、こちらの想定と違う粒度で切ることがある。
特に以下のような判断が分かれるポイント:
- `application.gs` に二重申込検知も含めるか、別ファイルにするか
- `mail.gs` をテンプレート別にさらに分割するか
- マイページ関連を `mypage.gs` にまとめるか、申込/領収書/ウェイティングと同居させるか

Ryo さんの好みもあるので、一度提案を見てから判断する流れに。

### IIFE化を禁止した理由
JS のモジュール化を頑張りすぎると、グローバル変数の参照関係が崩れてバグの温床になる。
Apps Script HtmlService の include は単純な文字列結合なので、**結合後に1つのスコープに入る前提**でコードが書かれている。リファクタで挙動を変えないなら、スコープ構造はそのまま維持が安全。

### 動作確認項目を細かく書いた理由
リファクタ後の動作確認は、機能を網羅的に触らないと壊れた箇所に気づけない。
このチェックリストはそのまま回帰テストとして使える。

---

## 関連ドキュメント

- `HANDOFF_TO_CLAUDE_AI.md`: claude.ai 相談用の全機能サマリー
- HANDOFF_NEXT.md (受領済) : Phase U-3-A・U-3-B のタスク詳細

---

**End of Phase U-4 Prompt Template**
