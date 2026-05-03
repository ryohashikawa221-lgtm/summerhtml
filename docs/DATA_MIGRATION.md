# データ移行手順書 — USA Portal Phase 1-C

**Document version:** 1.0
**作成日:** 2026-05-03
**対象 Phase:** Phase 1-C（HANDOFF §7 参照）
**前提 Doc:** `HANDOFF_USA_PORTAL_DESIGN.md` v2.0

---

## 0. ゴール

現行2ファイル運用（`2026駿台USA共通講座受講者名簿一覧.xlsx` / `2026各校舎_受講一覧.xlsx`）を、HANDOFF §1 で定義した12シートのデータモデルへ無欠落で移行する。

成果物：
- 新スプレッドシートに 12 シート分のデータ投入完了
- 移行検証レポート `MIGRATION_REPORT.md`（差分・レビュー必要レコード一覧）
- 旧ファイルは read-only バックアップとして Drive 別フォルダに保管

---

## 1. 全体方針

| 原則 | 内容 |
|---|---|
| **不可逆操作の前にバックアップ** | 旧ファイルは Drive コピーで保全。移行スクリプト実行は新スプレッドシートに対してのみ |
| **段階的検証** | テスト環境で1校舎分 → 全校舎 → 本番、の3段で実行 |
| **手動レビューを前提に CSV 出力** | 自動判定できないケース（billing_school_id 競合等）は CSV で抽出して Ryo にレビュー依頼 |
| **冪等性** | 同じ入力に対して何度実行しても同じ結果になる（再実行可能） |
| **監査ログ書込み禁止** | 移行は audit_log を汚さない（`actor_email='migration_script'` でも書かない）。代わりに `MIGRATION_REPORT.md` で痕跡管理 |

---

## 2. 入力ファイルと対応マッピング

| 元ファイル | 元シート | 抽出対象 | 移行先 |
|---|---|---|---|
| 2026駿台USA共通講座受講者名簿一覧.xlsx | 全23シート（講座別） | 講座メタ情報、受講者リスト、出席記録 | `m_courses` / `tx_enrollments` / `tx_attendance` |
| 2026各校舎_受講一覧.xlsx | NY/NJ/MI/TX/CA タブ | 生徒情報、billing_school_id 確定 | `m_students` / `tx_enrollments.billing_school_id` |

---

## 3. 実行手順

### Step 0: 環境準備（移行前）

1. 新スプレッドシート作成（`USA_Portal_Production_2026`）
2. 12シートのスキーマを `lib_SheetDB` 経由で初期化
3. `m_schools` / `m_pricing` の固定マスタを投入（HANDOFF §1.2 / §1.5）
4. `m_staff` に Ryo + 各校舎運営者を初期登録
5. テスト用スプレッドシート（`USA_Portal_Staging`）を別途作成し、Step 1〜5 はまずこちらで実行

### Step 1: m_students 構築

**入力:** 共通講座シート全23シートの受講者行 + 各校舎ファイル

**ロジック:**
```
for each sheet in 共通講座ファイル:
  for each row where 氏名 != null:
    key = (在籍校, 氏名_normalized)
    if key not in students_map:
      students_map[key] = {
        name_kanji, name_kana, grade, school_id,
        email_student, email_parent (各校舎ファイルから補完)
      }
    else:
      # 複数シートに重複 → 最新の情報で merge（grade/email を更新）
```

**出力:**
- `m_students` シート投入
- `student_id` 採番（`S2026-XXXX` ゼロパディング4桁）
- 重複検出ログ → `MIGRATION_REPORT.md` の `students_duplicates` セクション

### Step 2: m_courses 構築

**入力:** 共通講座23シートのヘッダー領域

**ロジック:**
```
for each sheet:
  read row 1 → course_name (A列), teacher (B列)
  read row 3 → day_of_week
  read Zoom 行 → zoom_url, zoom_id, zoom_passcode
  infer host_school_id from sheet name prefix (NY/NJ/MI/TX/CA/LA)
    ※ LA → host_school_id='CA' に正規化（HANDOFF §9 #8）
  course_id = `C2026-{host_school_id}-{slug(course_name)}`
```

**出力:** `m_courses` 23件投入

### Step 3: tx_enrollments 構築（中核）

**入力:** 共通講座シート × 各校舎ファイル

**ロジック:**
```
for each sheet in 共通講座ファイル:
  course_id = (Step 2 で確定済)
  for each row where 氏名 != null:
    student_id = students_map[(在籍校, 氏名)].student_id
    
    # billing_school_id 決定（HANDOFF §6.2 Step 3 ルール）
    matches = 各校舎ファイルから (氏名+講座名) で検索
    if len(matches) == 0:
      billing_school_id = 在籍校（暫定）
      review_list.append({reason: 'no_match', ...})
    elif len(matches) == 1:
      billing_school_id = matches[0].tab_name
    else:
      # 複数校舎ファイルにヒット → 競合
      conflict_list.append({matches: [...], student, course})
      billing_school_id = '__CONFLICT__'  # プレースホルダ
    
    create enrollment record
```

**出力:**
- `tx_enrollments` シート投入
- `MIGRATION_REPORT.md` に `review_list` と `conflict_list` を CSV で添付
- `__CONFLICT__` 状態のレコードは Ryo がレビュー後、手動で billing_school_id を確定

### Step 4: tx_attendance 構築

**入力:** 共通講座シートの日付列 × 受講者行のセル値

**ロジック:**
```
for each sheet:
  date_columns = [parse header dates]
  for each enrollment row:
    enrollment_id = lookup from Step 3
    for each date_col:
      cell = sheet[row][date_col]
      mark = MARK_MAP[cell]  # 〇→present, 欠→absent, 録画→recorded, 振替→makeup, 休講→canceled, ""→skip
      if mark != null:
        create attendance record (session_date=date_col, mark)
```

**MARK_MAP:**
| セル値 | mark |
|---|---|
| `〇` `○` | `present` |
| `欠` | `absent` |
| `録画` | `recorded` |
| `振替` | `makeup` |
| `休講` | `canceled` |
| 空 / 不明 | skip（レコード作らず、`unknown_marks_log` に出力） |

### Step 5: 各校舎ファイル独自レコードの吸収

**目的:** 各校舎ファイルにのみ存在し、共通講座シートにない (生徒, 講座) 組合せを検出。

**ロジック:**
```
for each tab in 各校舎ファイル:
  for each row:
    if (生徒, 講座) not yet in tx_enrollments:
      orphan_list.append({tab, student, course})
```

**出力:** `MIGRATION_REPORT.md` の `orphans` セクション。Ryo がレビューして手動で enrollment を追加するか「無視」と判断。

---

## 4. 検証

### 4.1 自動検証チェックリスト

- [ ] `m_students` 件数 ≈ 65（HANDOFF §0.1 の実生徒数。±2 以内なら合格）
- [ ] `m_courses` 件数 = 23
- [ ] `tx_enrollments` 件数 ≈ 98（延べ受講枠。±5 以内なら合格、超過時はレビュー）
- [ ] `tx_attendance` 件数の合理性（講座×日付×受講者の上限を超えていない）
- [ ] `__CONFLICT__` を含む enrollment が 0 件（移行確定前提）
- [ ] 各 enrollment.billing_school_id ∈ m_schools.school_id
- [ ] 各 enrollment.student_id ∈ m_students.student_id（FK 整合性）
- [ ] 各 enrollment.course_id ∈ m_courses.course_id（FK 整合性）

### 4.2 手動検証

- サンプル抽出5名（学年・校舎を分散）について、元ファイルと新スキーマを目視突合
- `tx_attendance` から1講座分の出席表を再構成して、元シートの見た目と一致するか確認

### 4.3 移行レポート

`MIGRATION_REPORT.md` に以下を記載:
- 移行実行日時・実行者
- 各シート投入件数
- `students_duplicates` / `conflict_list` / `orphans` / `unknown_marks_log` の CSV 添付
- 手動レビュー結果と Ryo 判断の記録

---

## 5. ロールバック

移行で問題が発覚した場合:
1. 新スプレッドシートを別名で保存（`USA_Portal_Production_2026_failed_YYYYMMDD`）
2. 新たに空スプレッドシートを作成し直して Step 0 からやり直し
3. 旧2ファイルは無傷なので、運用は旧ファイルで継続可能

**重要:** 移行スクリプトは旧ファイルへの書込みを一切行わない（read-only オープン）。

---

## 6. 実装メモ

- 移行スクリプトは `gas_src/migration_2026.gs` に1ファイルで実装（Phase 1-C 完了後にアーカイブフォルダへ）
- バッチ実行時間が 6 分（GAS 上限）を超える場合は Step 単位で分割実行
- `_normalizeStudentName()` ヘルパで全角/半角・スペースの揺れを吸収
- 日付解析は `Util.parseSheetDate()`（hoshuko_app 流用）

---

## 7. スケジュール

| 工程 | 期間 | 備考 |
|---|---|---|
| Step 0（環境準備） | 1日 | |
| Step 1〜5（テスト環境） | 3〜5日 | レビューリストの確定含む |
| Ryo によるレビュー | 2日 | conflict / orphan / review_list の判断 |
| 本番移行 | 1日 | テスト環境で承認された手順をそのまま適用 |
| 検証 | 1日 | §4 のチェックリスト消化 |

合計：約 8〜10 日（HANDOFF §7 Phase 1-C の2週間枠に収まる想定）
