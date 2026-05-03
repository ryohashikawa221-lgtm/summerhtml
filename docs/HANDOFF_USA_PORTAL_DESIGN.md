# USAオンライン受講管理ポータル — 設計＆実装仕様 (HANDOFF v1.2)

**Document version:** 1.2
**作成日:** 2026-05-02
**更新履歴:**
- v1.0 (2026-05-02): 初版
- v1.1 (2026-05-02): §6.2/§9 #2 を確定 — billing_school_id 初期値=各校舎ファイル記載尊重
- v1.2 (2026-05-02): §1.5 m_pricing 追加、§1.11 tx_billing_adj 拡張、§9 #1 大半解決（要項『2026年度高校生USAオンライン講座(太平洋部)』反映）。教材費金額・時間帯別料金有無の2点のみ未確定。シート総数 10→11。
**作成者:** 橋川 ([claude.ai](http://claude.ai)セッション)
**宛先:** Claude Code 実装セッション
**着手目標:** 2026-08-01 以降（hoshuko_app Phase 4-B 本番運用が安定後）

---

## 0. プロジェクト概要

### 0.1 ゴール
駿台USA 5校舎（NY/NJ/MI/TX/CA）が共同運用している「USAオンライン共通講座」（23講座・実生徒65名・延べ98受講枠）を、現状の2ファイル分散エクセル運用から、5校舎共有のGAS+Spreadsheetポータルへ移行する。

**橋川の戦略：** 5校舎合議制ではなく、橋川が完成品を作って各校舎に「これ使います？」と渡すアプローチ。合意形成ドキュメントは作らず、動くものを見せて巻き込む。これは hoshuko_app と同じ進め方。

### 0.2 既存資産との関係
- **hoshuko_app は別プロジェクト**として継続。USA-portalは新規プロジェクト。
- ただし `lib_[SheetDB.gs](http://SheetDB.gs)` `lib_[Auth.gs](http://Auth.gs)` `lib_[Util.gs](http://Util.gs)` `lib_[Audit.gs](http://Audit.gs)` などのライブラリ層は **hoshuko_app から流用**する。
- データは完全に分離（別スプレッドシート、別GASプロジェクト）。
- 政治的に「MIのhoshuko_appに統合」は避ける。「5校舎共有プロジェクト」の建てつけが必要。

### 0.3 ディレクトリ構成
```
/Users/user/Desktop/usa_portal/
├── gas_src/
│   ├── code_[main.gs](http://main.gs)
│   ├── api_[students.gs](http://students.gs)
│   ├── api_[courses.gs](http://courses.gs)
│   ├── api_[enrollments.gs](http://enrollments.gs)
│   ├── api_[attendance.gs](http://attendance.gs)
│   ├── api_[trial.gs](http://trial.gs)
│   ├── api_[requests.gs](http://requests.gs)
│   ├── api_[billing.gs](http://billing.gs)
│   ├── api_[master.gs](http://master.gs)
│   ├── lib_[SheetDB.gs](http://SheetDB.gs)   ← hoshuko_appから流用
│   ├── lib_[Auth.gs](http://Auth.gs)      ← hoshuko_appから流用＋拡張
│   ├── lib_[Util.gs](http://Util.gs)      ← closure cache入り（Phase 9-X教訓）
│   └── lib_[Audit.gs](http://Audit.gs)     ← hoshuko_appから流用
├── gas_html/
│   ├── login.html
│   ├── dashboard.html
│   ├── course_detail.html
│   ├── student_detail.html
│   ├── trial_form.html
│   ├── request_form.html
│   ├── billing_export.html
│   └── _shared_styles.html  ← Sundaiデザイン共通CSS
├── docs/
│   ├── HANDOFF_USA_PORTAL_[DESIGN.md](http://DESIGN.md)  ← 本ファイル
│   ├── DATA_[MIGRATION.md](http://MIGRATION.md)             ← Phase 0-2で作成
│   └── IDEAS_[BACKLOG.md](http://BACKLOG.md)              ← 将来機能
└── [README.md](http://README.md)
```

### 0.4 設計パターン（hoshuko_app準拠）
- API呼び出し：`api_xxx(token, ...) → _wrap(token, () => XxxApi.method(...))`
- HTML→GAS：`[google.script.run](http://google.script.run).api_xxx(token, ...)`
- データアクセス：`lib_SheetDB.SheetDB(sheetName, schema)` で抽象化
- 認証トークン：セッションごとに発行・検証、PropertiesService内で短期キャッシュ

---

## 1. データモデル

### 1.1 シート一覧（全11シート）

| 種別 | シート名 | 用途 |
|---|---|---|
| マスタ | `m_schools` | 校舎マスタ（NY/NJ/MI/TX/CA + USA-Online） |
| マスタ | `m_students` | 生徒マスタ（5校舎統合） |
| マスタ | `m_courses` | 講座マスタ |
| マスタ | `m_staff` | 運営者・講師マスタ |
| マスタ | `m_pricing` | 料金マスタ（コマ数別授業料・諸経費・入会金） |
| トランザクション | `tx_enrollments` | 受講登録（生徒×講座×状態） |
| トランザクション | `tx_attendance` | 出席記録 |
| トランザクション | `tx_trial` | 体験申込 |
| トランザクション | `tx_requests` | 申請ワークフロー（開始/停止/振替） |
| トランザクション | `tx_billing_adj` | 請求調整メモ（パターン⑤用） |
| ログ | `audit_log` | 監査ログ（全変更履歴） |

### 1.2 m_schools（校舎マスタ）

| 列 | 型 | 例 | 備考 |
|---|---|---|---|
| school_id | string | `MI` | PK・2文字コード |
| school_name | string | `駿台ミシガン国際学院` | |
| school_name_en | string | `Sundai Michigan` | |
| is_virtual | boolean | `false` | USA-Onlineのみ true |
| timezone | string | `America/Detroit` | 校舎ごとのTZ（出席時刻計算用） |
| active | boolean | `true` | |

**初期データ（必須）：**
```
NY,駿台ニューヨーク,Sundai New York,false,America/New_York,true
NJ,駿台ニュージャージー,Sundai New Jersey,false,America/New_York,true
MI,駿台ミシガン国際学院,Sundai Michigan,false,America/Detroit,true
TX,駿台ヒューストン,Sundai Houston,false,America/Chicago,true
CA,駿台カリフォルニア,Sundai California,false,America/Los_Angeles,true
USA-Online,USAオンライン,USA Online,true,America/New_York,true
```

### 1.3 m_students（生徒マスタ）

| 列 | 型 | 例 | 備考 |
|---|---|---|---|
| student_id | string | `S2026-0001` | PK・自動採番 |
| name_kanji | string | `西川 茉佑` | |
| name_kana | string | `ニシカワ マユ` | 任意 |
| grade | string | `高1` | 学年は文字列で（"中3","高2","新高1"等） |
| school_id | string | `TX` | 在籍校（FK to m_schools。USA-Online可） |
| billing_school_id | string | `TX` | **主請求元校舎**（在籍校と独立。FK to m_schools） |
| email_student | string | `[kentosomeya1124@gmail.com](mailto:kentosomeya1124@gmail.com)` | |
| email_parent | string | `[parent@example.com](mailto:parent@example.com)` | 任意 |
| status | enum | `active` | `active` / `inactive` / `withdrawn` |
| enrolled_at | date | `2026-01-30` | 入塾日 |
| withdrawn_at | date | (null) | 退塾日 |
| note | text | (任意) | 自由記述 |
| created_at | datetime | | システム自動 |
| updated_at | datetime | | システム自動 |

**設計上の注意：**
- `school_id` と `billing_school_id` は **明示的に別属性**（§3.3参照）
- 在籍校が `USA-Online` の場合、請求元は受講校舎間で取り決め

### 1.4 m_courses（講座マスタ）

| 列 | 型 | 例 | 備考 |
|---|---|---|---|
| course_id | string | `C2026-NY-TOEFL-PREP` | PK |
| course_name | string | `NY TOEFL Prep` | |
| host_school_id | string | `NY` | 主催校（FK） |
| teacher_id | string | `T-NAKAMURA` | FK to m_staff |
| day_of_week | enum | `Wed` | Mon/Tue/Wed/Thu/Fri/Sat/Sun |
| start_time | time | `19:00` | 主催校TZでの時刻 |
| duration_min | int | `90` | |
| zoom_url | string | `https://us02web.zoom.us/j/...` | |
| zoom_id | string | `383 446 8076` | |
| zoom_passcode | string | `(なし)` または値 | |
| material_url | string | (任意) | Box/Drive教材リンク |
| recording_url | string | (任意) | 録画一覧URL |
| capacity | int | `20` | 定員 |
| level | string | `中級` | 任意 |
| term_start | date | `2026-01-28` | 開講日 |
| term_end | date | `2027-03-31` | 終講日 |
| status | enum | `open` | `planned`/`open`/`closed` |
| timezone_segment | enum | `pacific` | `eastern`/`central`/`pacific` 時間帯セグメント。要項が「太平洋部標準時」「東部標準時」等で分かれている可能性 |
| note | text | | |

### 1.5 m_pricing（料金マスタ）

**駿台USA高校生USAオンライン講座 2026年度料金（要項より確定 2026-05-02）：**

| 項目 | 金額 | 備考 |
|---|---|---|
| 入会金 | $200 | 1回のみ。兄弟割引・友人紹介割引対象 |
| 諸経費 | $30/月 | 通信費・プリント代・Wi-Fi環境維持費等 |
| 授業料1コマ | $290 | |
| 授業料2コマ | $534 | (= 1コマ単価 $267) |
| 授業料3コマ | $722 | (= 1コマ単価 $240.7) |
| 授業料4コマ以上 | $220/コマ | (= 1コマ単価 $220、4コマで$880・5コマで$1,100) |

**シート構造：**

| 列 | 型 | 例 | 備考 |
|---|---|---|---|
| pricing_id | string | `P-2026-USAOL-HS` | PK |
| program_code | enum | `USA-ONLINE-HS` | プログラム種別。将来「中学生」「太平洋部以外」等が増えた場合の識別 |
| effective_from | date | `2026-02-01` | この料金が有効になる開始日 |
| effective_to | date | (null) | 終了日（次の料金改定で埋まる） |
| enrollment_fee | number | `200` | 入会金（USD） |
| monthly_misc_fee | number | `30` | 諸経費（USD/月） |
| tuition_1 | number | `290` | 1コマ受講時の月額授業料 |
| tuition_2 | number | `534` | 2コマ受講時の月額授業料 |
| tuition_3 | number | `722` | 3コマ受講時の月額授業料 |
| tuition_per_slot_4plus | number | `220` | 4コマ以上の場合の1コマ単価 |
| has_textbook_fee | json | `{"数学IA":true,"数学IIB":true,"数学IIIC":true}` | テキスト使用講座（教材費フラグ） |
| textbook_fee_amount | number | (要確認) | テキスト代（要項に金額記載なし→Ryo確認待ち） |
| note | text | | |

**料金計算ロジック（実装イメージ）：**

```javascript
function calculateMonthlyTuition(numSlots, pricing) {
  if (numSlots === 0) return 0;
  if (numSlots === 1) return pricing.tuition_1;
  if (numSlots === 2) return pricing.tuition_2;
  if (numSlots === 3) return pricing.tuition_3;
  return numSlots * pricing.tuition_per_slot_4plus;  // 4コマ以上
}

function calculateMonthlyTotal(student, enrollments, pricing) {
  const numSlots = enrollments.filter(e => e.status === 'active').length;
  const tuition = calculateMonthlyTuition(numSlots, pricing);
  const misc = numSlots > 0 ? pricing.monthly_misc_fee : 0;
  // 兄弟割引は tx_billing_adj で個別計上（ロジックに組み込まない）
  return tuition + misc;
}
```

**重要な設計判断：**

1. **コマ数 = 受講中(`status='active'`)のenrollment件数**で算出。これは「USAオンラインプログラム内」のコマ数。他校舎主催で他プログラム扱いの講座（補習校等）はカウント外。
2. **教材費は要項に金額記載なし** → Ryoに確認必要（§9 #1-b に追加）。数学テキスト3冊の年間料金。
3. **兄弟割引は計算ロジックに組み込まない** → 「総額に応じて個別決定」と要項に明記されているため、`tx_billing_adj` シートで月ごと・家庭ごとに個別レコード化。Ryoが手動で金額を入力する運用。
4. **友人紹介割引も同様に `tx_billing_adj`** → 入会金からの割引として個別記録。
5. **料金改定への備え** → `effective_from` / `effective_to` で世代管理。年度変更時は新レコードを追加して旧レコードに `effective_to` を設定する方式。月次請求生成時はその月に有効な料金レコードを参照。
6. **hoshuko_app との料金体系は完全に別** → m_pricing はUSA-portal専用。将来hoshuko_appの補習校料金もこの方式に揃える可能性あり（Phase 6+候補）。

### 1.6 m_staff（運営者・講師マスタ）

| 列 | 型 | 例 | 備考 |
|---|---|---|---|
| staff_id | string | `S-HASHIKAWA` | PK |
| name | string | `橋川 (中略)` | |
| email | string | `[r-hashikawa@sundai-kaigai.jp](mailto:r-hashikawa@sundai-kaigai.jp)` | Google SSO用 |
| school_id | string | `MI` | 所属校（講師は仮所属） |
| role | enum | `principal` | `principal`/`fulltime`/`parttime`/`teacher`/`admin` |
| can_view_all_schools | boolean | `true` | フラット権限なら全員true |
| can_edit_all_schools | boolean | `true` | 同上 |
| active | boolean | `true` | |

**ロール定義：**
- `principal`：校長（全権 + 経営KPI）
- `fulltime`：常勤運営者（全権 - 経営KPI）
- `parttime`：パートタイム（編集制限あり）
- `teacher`：講師（自講座のみ）
- `admin`：システム管理（橋川）

### 1.7 tx_enrollments（受講登録）

| 列 | 型 | 例 | 備考 |
|---|---|---|---|
| enrollment_id | string | `E2026-00001` | PK |
| student_id | string | `S2026-0001` | FK |
| course_id | string | `C2026-NY-TOEFL-PREP` | FK |
| billing_school_id | string | `MI` | **この受講分の請求元**（生徒マスタからのデフォルト or 個別上書き） |
| status | enum | `active` | `applied`/`active`/`suspended`/`completed`/`cancelled` |
| started_at | date | `2026-02-01` | |
| ended_at | date | (null) | 完了/停止日 |
| billing_start | date | `2026-02-01` | 請求開始日（受講開始と一致しない場合あり） |
| billing_end | date | (null) | 請求終了日 |
| note | text | | |
| created_by | string | `S-HASHIKAWA` | |
| created_at | datetime | | |
| updated_by | string | | |
| updated_at | datetime | | |

**重要：** 1人の生徒が同じ講座を「停止→再開」した場合は、enrollment レコードを2件作る（statusで履歴管理）。

### 1.8 tx_attendance（出席記録）

| 列 | 型 | 例 | 備考 |
|---|---|---|---|
| attendance_id | string | `A20260204-00001` | PK |
| enrollment_id | string | `E2026-00001` | FK |
| session_date | date | `2026-02-04` | 授業実施日 |
| mark | enum | `present` | `present`(〇)/`absent`(欠)/`recorded`(録画)/`makeup`(振替)/`canceled`(休講) |
| note | text | | |
| recorded_by | string | `S-HASHIKAWA` | |
| recorded_at | datetime | | |

**設計上の注意：**
- 出席記号の表示マッピングはUIレイヤーで（マスタ化しない）
- 1セッションに対して1レコード（重複防止のためユニーク制約：enrollment_id + session_date）

### 1.9 tx_trial（体験申込）

| 列 | 型 | 備考 |
|---|---|---|
| trial_id | string | PK |
| applicant_name | string | 申込者氏名 |
| applicant_email | string | |
| applicant_school_id | string | 在籍校（USA-Online可、未定可） |
| applicant_grade | string | |
| target_course_id | string | 体験希望講座（FK） |
| applied_at | date | 申込日 |
| trial_date | date | 体験予定日 |
| trial_status | enum | `applied`/`scheduled`/`completed`/`no_show`/`cancelled` |
| converted_to_enrollment_id | string | 本受講に転換した場合のFK |
| note | text | |

**転換率計算用：** `converted_to_enrollment_id IS NOT NULL` の比率を講座別・講師別に集計。

### 1.10 tx_requests（申請ワークフロー）

| 列 | 型 | 備考 |
|---|---|---|
| request_id | string | PK |
| request_type | enum | `start`/`suspend`/`resume`/`cancel`/`makeup`/`billing_change` |
| target_student_id | string | FK |
| target_course_id | string | FK（makeupの場合は振替元/振替先） |
| target_enrollment_id | string | FK（既存受講に対する申請の場合） |
| requester_id | string | FK to m_staff |
| requester_school_id | string | |
| approver_id | string | FK（承認者・主催校の運営者） |
| approver_school_id | string | |
| status | enum | `pending`/`approved`/`rejected`/`auto_applied` |
| reason | text | |
| effective_date | date | 適用日 |
| created_at | datetime | |
| resolved_at | datetime | |

### 1.11 tx_billing_adj（請求調整メモ）

請求パターン⑤（USA-Online生徒の複数校舎受講・校舎間取り決め）に加え、**兄弟割引・友人紹介割引などの個別調整**もここで管理する。料金計算ロジックには組み込まず、運営判断による加算減算を全て個別レコード化する設計（要項に「総額に応じて個別決定」と明記されているため）。

| 列 | 型 | 備考 |
|---|---|---|
| adj_id | string | PK |
| adj_type | enum | `inter_school`(校舎間取り決め)/`sibling_discount`(兄弟割引)/`referral_discount`(友人紹介割引)/`other` |
| student_id | string | FK |
| period | string | `2026-04` 形式（年月）。入会金関連は入会月 |
| from_school_id | string | 移管元校舎（inter_school用、それ以外はnull） |
| to_school_id | string | 移管先校舎（inter_school用、それ以外はnull） |
| amount | number | 金額（正=加算/負=減算） |
| reason | text | 取り決め内容・割引根拠 |
| family_group_id | string | 兄弟割引時の家族グループ識別子（任意。同一家庭の生徒紐付け用） |
| agreed_by | string[] | inter_school時の合意校舎の運営者IDリスト（カンマ区切り） |
| created_by | string | |
| created_at | datetime | |

### 1.12 audit_log（監査ログ）

| 列 | 型 | 備考 |
|---|---|---|
| log_id | string | PK |
| timestamp | datetime | |
| actor_email | string | 操作者のメール |
| actor_school_id | string | |
| action | enum | `create`/`update`/`delete`/`login`/`export` |
| target_sheet | string | 対象シート名 |
| target_id | string | 対象レコードID |
| diff | json | 変更前後の差分（updateの場合） |
| ip_hash | string | クライアントIPのハッシュ |
| user_agent | string | |

**重要：** ログは**追記のみ**、削除・編集不可。GAS側で update/delete を拒否する実装にする。

---

## 2. ライブラリ層

### 2.1 hoshuko_appからの流用方針

| ライブラリ | 流用方法 | 理由 |
|---|---|---|
| `lib_[SheetDB.gs](http://SheetDB.gs)` | コピー＋改変 | スキーマ定義方式は同じ。Date serialization bug対策（Phase 1教訓）も含めて流用 |
| `lib_[Auth.gs](http://Auth.gs)` | コピー＋拡張 | 5校舎分のロール拡張が必要 |
| `lib_[Util.gs](http://Util.gs)` | コピー（**closure cache必須**） | Phase 9-X教訓：`PropertiesService.getProperty()` の繰り返し呼び出し回避 |
| `lib_[Audit.gs](http://Audit.gs)` | コピー | hoshuko_appのものをほぼそのまま |
| `lib_[Drive.gs](http://Drive.gs)` | 部分流用 | 教材リンク・録画リンク管理用に簡易版 |

### 2.2 lib_SheetDB の重要な設計（再確認）

```javascript
// ❌ 駄目な例（Phase 9-Xで6-9秒遅延の原因）
function _normalizeReadValue(v, schemaType) {
  const tz = Util.getTz();  // 毎セルでPropertiesService呼び出し
  // ...
}

// ✅ 良い例（closure cache）
function _normalizeReadValue(v, schemaType) {
  const tz = Util.getTz();  // 内部で1回だけ呼び出してキャッシュ
  // ...
}
// Util.getTz() の実装：
const Util = (function() {
  let _tzCache = null;
  return {
    getTz: function() {
      if (_tzCache === null) {
        _tzCache = PropertiesService.getScriptProperties().getProperty('TIMEZONE') || 'America/New_York';
      }
      return _tzCache;
    }
  };
})();
```

**Phase 1の Date serialization bug 対策：** `string` schema のセルが Sheets により Date 型に自動変換される問題。`_normalizeReadValue` で Date 検出時は schema にかかわらず `HH:mm` 文字列に変換。

### 2.3 lib_Auth の拡張点

```javascript
// 5校舎分のロール定義
const ROLES = {
  admin:     { weight: 100, can_edit_all: true,  can_view_kpi: true  },
  principal: { weight: 90,  can_edit_all: true,  can_view_kpi: true  },
  fulltime:  { weight: 70,  can_edit_all: true,  can_view_kpi: false },
  parttime:  { weight: 50,  can_edit_all: false, can_view_kpi: false },
  teacher:   { weight: 30,  can_edit_all: false, can_view_kpi: false }
};

// 使い方
function api_attendance_update(token, attendanceId, mark) {
  return _wrap(token, (ctx) => {
    if (!Auth.canEdit(ctx, 'tx_attendance')) {
      throw new Error('PERMISSION_DENIED');
    }
    return AttendanceApi.update(attendanceId, mark, [ctx.actor](http://ctx.actor)_email);
  });
}
```

---

## 3. API層

### 3.1 設計パターン

```javascript
// 全APIの共通形式
function api_<domain>_<action>(token, ...args) {
  return _wrap(token, (ctx) => {
    return <Domain>Api.<action>(...args, ctx);
  });
}

// _wrap の責務：
// 1. token検証 → ctx (actor_email, actor_school_id, role) を生成
// 2. try-catch でエラーをユーザーフレンドリーに変換
// 3. Audit.log() で全API呼び出しを記録（read系は省略可）
// 4. 戻り値を JSON-serializable に正規化
```

### 3.2 API一覧（Phase 1 MVP）

#### Students API
- `api_student_list(token, filters)` → 生徒一覧（校舎・学年でフィルタ）
- `api_student_get(token, studentId)` → 生徒詳細＋受講履歴
- `api_student_create(token, payload)`
- `api_student_update(token, studentId, payload)`

#### Courses API
- `api_course_list(token, filters)` → 講座一覧（主催校でフィルタ）
- `api_course_get(token, courseId)` → 講座詳細＋受講者リスト
- `api_course_create(token, payload)`
- `api_course_update(token, courseId, payload)`

#### Enrollments API（中核）
- `api_enrollment_list(token, filters)` → **ダッシュボード用**：在籍校/主催校/請求元で絞れる
- `api_enrollment_get(token, enrollmentId)`
- `api_enrollment_create(token, payload)` → 受講開始（直接 or 申請経由）
- `api_enrollment_update(token, enrollmentId, payload)`
- `api_enrollment_suspend(token, enrollmentId, reason)` → status=suspended に
- `api_enrollment_resume(token, enrollmentId)` → 新しい enrollment レコード作成（履歴維持）

#### Attendance API
- `api_attendance_list(token, courseId, period)` → 講座×期間の出席表
- `api_attendance_record(token, enrollmentId, sessionDate, mark)`
- `api_attendance_bulk_record(token, courseId, sessionDate, marks[])` → 講座1回分一括

#### Requests API
- `api_request_list(token, filters)`
- `api_request_create(token, payload)`
- `api_request_approve(token, requestId)` → 承認 → tx_enrollments を変更
- `api_request_reject(token, requestId, reason)`

#### Billing API
- `api_billing_export(token, schoolId, period)` → CSV/JSON で月次請求対象抽出
- `api_billing_adj_create(token, payload)` → 校舎間取り決めの記録

#### Trial API
- `api_trial_list(token, filters)`
- `api_trial_create(token, payload)`
- `api_trial_convert(token, trialId, enrollmentPayload)` → 体験→本受講

---

## 4. UI層

### 4.1 画面一覧

| 画面 | ファイル | 主な利用者 |
|---|---|---|
| ログイン | `login.html` | 全員 |
| ダッシュボード（受講ステータス一覧） | `dashboard.html` | 運営者全員 |
| 講座詳細＆出席入力 | `course_detail.html` | 主催校・講師 |
| 生徒詳細 | `student_detail.html` | 運営者全員 |
| 体験申込フォーム | `trial_form.html` | Phase 2 |
| 申請フォーム | `request_form.html` | 運営者全員 |
| 請求エクスポート | `billing_export.html` | 経理担当 |

### 4.2 デザインシステム

**hoshuko_app Phase 2-B の `DESIGN_[TOKENS.md](http://TOKENS.md) v1.0` を流用＋拡張**：

- ベースカラー：Sundai blue `#063E6F` ファミリー
- パネル：Liquid Glass（白背景）
- フォント：Noto Sans JP only
- ロゴ：MIエンブレムは使わない（**5校舎共有プロジェクトのため**）。代わりに「駿台USA」を意図したシンプルなロゴ or テキストロゴを新規作成
- 校舎識別カラー：各校舎にサブカラーを割り当て（例：NY=濃紺、NJ=オレンジ、MI=サクラ、TX=ターコイズ、CA=ゴールド、USA-Online=グレー）

**重要：** MIエンブレムを引きずらない。これは「全校舎共通プロジェクト」と認識される必要がある。

### 4.3 ダッシュボード（dashboard.html）の主要要素

```
┌─────────────────────────────────────────────────────────────┐
│ Sundai USA Online Portal           [橋川 / MI] [ログアウト]   │
├─────────────────────────────────────────────────────────────┤
│ ▼軸：[在籍校][主催校][請求元] | ▼期間：[2026年4月] | [絞込]  │
├─────────────────────────────────────────────────────────────┤
│ サマリーカード                                                │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                        │
│ │受講中│ │申請中│ │停止 │ │体験 │                            │
│ │ 98  │ │  3  │ │  2  │ │  5  │                            │
│ └──────┘ └──────┘ └──────┘ └──────┘                        │
├─────────────────────────────────────────────────────────────┤
│ 受講一覧（行クリックで詳細）                                  │
│ ┌────┬──────────┬────┬────────────┬──────┬──────┬────┐    │
│ │在籍│生徒名    │学年│講座        │主催校│請求元│状態│    │
│ ├────┼──────────┼────┼────────────┼──────┼──────┼────┤    │
│ │ TX │染谷 建登 │高1 │NY TOEFL Prep│  NY  │  TX  │受講│    │
│ │ MI │川上 華凛 │高1 │NJ 数Ⅰ標準 │  NJ  │  MI  │受講│    │
│ │ NJ │田村 健士 │高3 │5講座        │ 複数 │  NJ  │受講│    │
│ └────┴──────────┴────┴────────────┴──────┴──────┴────┘    │
└─────────────────────────────────────────────────────────────┘
```

### 4.4 講座詳細＆出席入力（course_detail.html）

現状エクセル「2026駿台USA共通講座受講者名簿一覧」の各シートの直系後継。
- ヘッダー：講座名・主催校・講師・Zoom URL（コピーボタン付）・教材リンク
- 行：受講生徒（在籍校 / 学年 / 氏名 / メール）
- 列：日付（その期間の授業日）
- セル：`〇` `欠` `録画` `振替` `休講` をプルダウンで選択
- 一括保存ボタン（保存ボタン押すまで反映されない＝Phase 9-X教訓のリクエスト数最小化）

---

## 5. 認証・ロール・監査ログ

### 5.1 認証
- Google SSO（`Session.getActiveUser().getEmail()`）
- m_staff にメール登録済みのユーザーのみログイン可
- 未登録メールは「アクセス権がありません。橋川までご連絡ください」エラー
- ログイン成功時に PropertiesService にトークン発行（30分有効）

### 5.2 ロール権限マトリクス（フラット運営の前提）

| 操作 | admin | principal | fulltime | parttime | teacher |
|---|---|---|---|---|---|
| 全校舎データ閲覧 | ✓ | ✓ | ✓ | ✓ | × |
| 自校舎データ編集 | ✓ | ✓ | ✓ | △ | × |
| 他校舎データ編集 | ✓ | ✓ | ✓ | × | × |
| 経営KPI閲覧 | ✓ | ✓ | × | × | × |
| 自講座出席入力 | ✓ | ✓ | ✓ | ✓ | ✓ |
| 監査ログ閲覧 | ✓ | × | × | × | × |
| マスタ追加・削除 | ✓ | △ | × | × | × |

※ △ は要件定義時に再確認

### 5.3 監査ログ
- 全API呼び出し時に `Audit.log(ctx, action, target, diff)` を実行
- read系は省略可（パフォーマンス考慮）
- update/delete時は変更前後の差分を JSON で記録
- ログシートはGAS実装でinsert-onlyを強制（update/delete を拒否する関数で守る）

---

## 6. データ移行

### 6.1 移行元

| 元ファイル | 元シート | 移行先 |
|---|---|---|
| 2026駿台USA共通講座受講者名簿一覧.xlsx | 全23シート | m_courses + tx_enrollments + tx_attendance |
| 2026各校舎_受講一覧.xlsx | NY/NJ/MI/TX/CA | m_students + tx_enrollments の billing_school_id 確定 |

### 6.2 移行手順（Phase 0-2 で `DATA_[MIGRATION.md](http://MIGRATION.md)` に詳述する想定）

**Step 1：m_students 構築**
- 共通講座シートの全シートから (在籍校 + 氏名) ユニークキーで生徒を抽出
- 学年・メールを統合（複数シートに重複している場合は新しい方を採用）
- student_id を採番

**Step 2：m_courses 構築**
- 共通講座シート23シートから1行目（講座名）・1行目B列（講師）・3行目（曜日）・Zoom行を抽出
- course_id を採番（命名規則：`C2026-{主催校}-{略称}`）

**Step 3：tx_enrollments 構築**
- 共通講座の各シートの校舎/学年/氏名行を読み、(student_id × course_id) のenrollmentレコード作成
- **billing_school_id の決定ルール（2026-05-02 確定）：**
  1. 各校舎ファイル（NY/NJ/MI/TX/CA タブ）に載っている (氏名+講座) → そのタブ名を billing_school_id に採用（**現状尊重**）
  2. 共通講座シートにあるが、どの校舎ファイルにも該当記載がない → **暫定で在籍校** + 手動レビューリストへ出力
  3. 複数の校舎ファイルに同一 (氏名+講座) が記載 → **競合リスト**として出力、Ryo が手動裁定
- 移行ジョブは Step 5 のレビューリスト・競合リストを CSV で出力する設計とする

**Step 4：tx_attendance 構築**
- 各シートの日付列×受講者行のセルを読み、〇/欠/録画 を mark に変換
- session_date はヘッダーの日付セル

**Step 5：m_courses への請求情報・各校舎ファイルとの突合**
- 各校舎ファイルの (在籍校+氏名+講座) → 共通講座由来の enrollment と突合
- 突合できないレコード（各校舎ファイルにのみ存在）は手動レビューリストに出力

### 6.3 移行検証
- 移行後、現状ファイル合計の行数と新スキーマの enrollment 件数を比較
- サンプル抽出で5名ほど元ファイルと新DBを目視確認
- 移行結果サマリーを `MIGRATION_[REPORT.md](http://REPORT.md)` として出力

---

## 7. Phase別実装順序

### Phase 1（MVP）— 2026年8〜10月

**Phase 1-A：基盤（2週間）**
1. プロジェクト作成・スプレッドシート作成
2. lib_[SheetDB.gs](http://SheetDB.gs) / lib_[Auth.gs](http://Auth.gs) / lib_[Util.gs](http://Util.gs) / lib_[Audit.gs](http://Audit.gs) を hoshuko_app からコピー＋改変
3. m_schools / m_staff の初期データ投入
4. login.html + 認証フロー
5. デプロイ確認・橋川がログインできる状態

**Phase 1-B：マスタ管理（1週間）**
1. api_students / api_courses CRUD
2. シンプルな管理画面（一覧＋編集）

**Phase 1-C：データ移行（2週間）**
1. 移行スクリプト作成（GASバッチ）
2. テスト環境での移行実行
3. 検証・修正
4. 本番環境への移行

**Phase 1-D：ダッシュボード（2週間）**
1. api_enrollment_list（中核API）
2. dashboard.html（軸切替・フィルタ・サマリー）
3. student_detail.html

**Phase 1-E：出席入力（2週間）**
1. api_attendance_*
2. course_detail.html（出席入力UI）

**Phase 1-F：申請ワークフロー（1週間）**
1. api_request_*
2. request_form.html

**Phase 1-G：請求エクスポート（1週間）**
1. api_billing_export
2. billing_export.html
3. 各校舎ファイル形式へのCSV出力

**Phase 1-H：橋川による試運用（1〜2週間）**
1. MIだけで実データ運用開始
2. 不具合修正
3. 9月開講に間に合わせる

### Phase 2（拡張）— 2026年11月〜2027年1月

- 体験申込（tx_trial）と転換率分析
- 講座情報一元管理ページ（生徒向けMy講座）
- 通知機能（出席3回連続欠で担任にメールなど）

### Phase 3（高度化）— 2027年度〜

- 講師ダッシュボード
- 5校舎横断KPI分析
- hoshuko_app との一部連携検討（MIの請求自動化）

---

## 8. リスクと対策

### 8.1 hoshuko_app Phase 4-B/9-X からの教訓

| 教訓 | 対策 |
|---|---|
| `PropertiesService.getProperty()` の繰り返し呼び出しで6-9秒遅延 | 全 util 関数で **closure cache 必須** |
| `CacheService` は 100KB 制限で 227KB データを silent に skip | 大きなマスタは PropertiesService + closure cache で代替、CacheServiceは使わない |
| Date serialization bug（string schema が Date 化） | `_normalizeReadValue` で Date 検出時は HH:mm に変換 |
| 一括処理での `getRange().getValues()` の活用 | 出席一括保存などはバルク処理 |

### 8.2 5校舎運用固有のリスク

| リスク | 対策 |
|---|---|
| 同一レコードへの同時編集（5校舎が同時アクセス） | LockService + 楽観的ロック（updated_at 比較） |
| タイムゾーン混在（NY/MI/TX/CA） | 全 datetime は UTC で保存、表示時に校舎TZへ変換 |
| 校舎間で運用ルールが揃わない | UIで「このルールはこの校舎のみ」を明示、全校舎共通ルールは橋川が決定権 |
| 1校舎が運用ミスで他校舎データを破壊 | 監査ログ + 日次バックアップ（Drive自動コピー） |

### 8.3 政治リスク

| リスク | 対策 |
|---|---|
| MIだけで作って他校舎が「使わない」と言う | 完成品を見せる戦略。動くものは強い |
| ロゴ・デザインがMI色だと拒絶される | 5校舎共通の中立デザイン。MIエンブレムは使わない |
| 「データを他校舎に見られたくない」 | フラット権限が嫌な校舎が出たら、Phase 2 で「閲覧範囲設定」を追加検討 |

---

## 9. 既知の未決事項（橋川に追加確認が必要）

実装着手前にRyo（橋川）に確認が必要な項目：

1. ~~**請求金額の計算ロジック**~~ → **解決済（2026-05-02）：要項『2026年度 高校生 USAオンライン講座（太平洋部）』より確定。詳細は §1.5 m_pricing。**
   - **1-a：料金体系** ✅ 入会金$200・諸経費$30/月・授業料コマ階段（$290/$534/$722/$220-per-slot 4+）
   - **1-b：教材費の具体額** ⚠️ **未確定**。要項には「数学IA/IIB/IIICのみテキスト使用」とあるが金額記載なし。Ryoに以下を確認：(a)テキスト1冊の単価、(b)年1回計上か学期ごとか、(c)受講開始月途中の場合の按分有無
   - **1-c：時間帯別料金の有無** ⚠️ **未確認**。要項タイトルに「太平洋部標準時」とあり、「東部部」「中部部」が別要項として存在する可能性。料金は同一か別体系かをRyoに確認
   - **1-d：兄弟割引の運用ルール** ✅ 「総額に応じて個別決定」と要項に明記 → `tx_billing_adj` で個別計上、計算ロジックには組み込まない
   - **1-e：友人紹介割引の運用ルール** ✅ 同上（金額は要項に記載なしだがRyo判断で個別計上）
2. ~~**billing_school_id の初期値**~~ → **解決済（2026-05-02）：各校舎ファイル記載をそのまま採用＝現状尊重。詳細は §6.2 Step 3。**
3. **講師（teacher ロール）の参加範囲** — Phase 1から含めるか、Phase 3に回すか
4. **生徒・保護者向け機能の優先度** — Phase 2の「My講座ページ」は生徒ログイン必要か、保護者向けか
5. **既存hoshuko_appとの連携** — MI生徒の請求情報はhoshuko_appに自動連携するか（Phase 3で要検討）
6. **退会・卒業の扱い** — m_students.status と tx_enrollments.status の連動ルール
7. **CA校舎の実態** — 現状データではCA生徒1名のみ（共通講座受講ゼロ）、運用への巻き込みタイミング
8. **LA表記の扱い** — 共通講座シートに「LA 数学ⅡB発展」「LA 数学ⅢC発展」がある。これは校舎なのか地域なのか？CAの中の地域呼称か？

---

## 10. ライセンス・著作権

本ドキュメントおよび関連コード一式の著作権は駿台USA運営にある。各校舎が運用に使用することは許諾される。商用転用・他法人への提供には橋川の承認を要する（hoshuko_appと同方針）。

---

**END OF HANDOFF DOCUMENT**

実装着手時は本ファイルの全節を熟読のうえ、§9の未決事項を解消してから設計確定すること。
[不明点はclaude.ai](http://不明点はclaude.ai)セッションに戻って橋川と再確認する。
