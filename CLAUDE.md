# プロジェクト設定メモ（Claude Code 用）

このプロジェクトは **米国ミシガン州** の駿台ミシガン国際学院サマースクールのシステムです。
今後 Claude Code がこのリポジトリで作業する際は、以下を必ず守ること。

## 印刷ドキュメントのページサイズ

**配布物・印刷可能なHTML（マニュアル・パンフレット・案内など）は必ず US Letter サイズで作成すること。**

- ページサイズ: `Letter portrait`（8.5 × 11 in = 215.9 × 279.4 mm）
- A4（210 × 297 mm）は使わない
- CSS テンプレ:
  ```css
  @page { size: Letter portrait; margin: 0.5in; }
  .page { width: 8.5in; min-height: 11in; padding: 0.7in 0.6in 0.8in 0.6in; }
  ```

理由: 学校所在地が米国ミシガン州ノバイ市で、現地のプリンタは Letter が標準。A4 で出すと
余白がズレるか縮小印刷になる。

## 学校名の表記

- 日本語: 駿台ミシガン国際学院
- 英語: Sundai Michigan International Academy（略 SMIA）
- 英語表記でフルスペル必須（"Sundai Michigan" だけにしない）

## デザイントーン

GAS Web アプリ本体（`page_brochure.html` 等）のデザインに揃える:

- 配色: 紺 `#1b2a4a` × ゴールド `#c9a84c` × クリーム `#faf8f3` ベース
- 紺と斜めストライプを表紙に使う
- 校章は **円形クロップ + ゴールドリング**で表示（白枠を出さない）
- 校章の base64 データは `page_brochure.html:10` から流用可能（フォルダ依存を避けるため埋め込み推奨）
- 見出しは明朝（`Hiragino Mincho Pro`, `Yu Mincho`）、本文は ゴシック

## 兄弟・割引のルール

- きょうだい登録: 最大 5 人まで
- コマ数割引: 10〜14コマ → 10% / 15〜19コマ → 20% / 20コマ以上 → 30%
- きょうだい割引: 2人目 20% / 3人目以降 30%
- 補習校・AS生割引: 10%（該当生徒のみ）
- お友達割引: 該当コマのみ 10%（2026年新設）

## ブランチ運用

- 開発ブランチ: `claude/review-summer-school-TNH2h`
- 本流ブランチ: `claude/phase-u3-b-mypage`
- main は古いモノリシック版（触らない）
- 別の Claude Code セッションが clasp で GAS にデプロイしている。コンフリクトに注意

## ファイル構成

- `*.gs` — GAS バックエンド（番号順に依存関係）
- `*.html` — フロントエンド（page_*, partial_*, js_*, mp_*, style_*）
- `MANUAL.html` — 保護者向け配布マニュアル（GASにはデプロイしない）
