# ADDENDUM v2 — 受験形式 / 解説授業形式 の仕様確定

**生成**: 2026-05-03 (Web Claude Code セッション、Ryo 確認反映後)
**前提ドキュメント**: `DESIGN_NOTES_FROM_WEB_SESSION.md`

ターミナル Claude Code 側で v2 schema を再適用する際の確定仕様。

---

## 1. 確定したフィールド (Ryo 2026-05-03 確認)

| フィールド | 選択肢 | 説明 |
|---|---|---|
| `受験形式` | `対面` / `オンライン` / `自宅` | 当日の試験運用形態 |
| `解説授業形式` | `対面` / `オンライン` / `録画` | 結果配信後の解説授業への参加形態 |

**「自宅」受験の運用 (Ryo 確認済 2026-05-03)**:
保護者が自宅で問題を印刷 → 子供に解かせる → G-2 で答案をアップロード。
G-2 のアップロードフローはこのケースでも他の受験形式と同じ操作で動くため、特別な分岐は不要。

## 2. Schema 改修 (`gas_src/lib_Schema.gs`)

`STUDENT_COLS` に 2 列追加 (推奨は受験教科の直後):

```javascript
const STUDENT_COLS = [
  { name: '受験番号', type: 'string' },
  { name: '学年', type: 'string' },
  { name: '氏名', type: 'string' },
  { name: '氏名カナ', type: 'string' },
  { name: '保護者メール', type: 'string' },
  { name: '本人メール', type: 'string' },
  { name: '受験教科', type: 'string' },
  { name: '受験形式', type: 'string' },        // ← v2 追加
  { name: '解説授業形式', type: 'string' },    // ← v2 追加
  { name: '備考', type: 'string' }
];
```

`tx_申込` (Schema.SHEETS.APPLICATIONS.cols) にも同 2 列を追加:

```javascript
{ name: '受験形式', type: 'string' },
{ name: '解説授業形式', type: 'string' },
```

## 3. Settings 改修 (`gas_src/lib_Settings.gs`)

`bootstrap()` の defaults に追加 / 既存 `explanation_zoom_url` を残しつつ拡張:

```javascript
// 受験形式の現地情報 (校舎別)
exam_in_person_location_LA: '',
exam_in_person_location_MI: '',
exam_in_person_location_NJ: '',
exam_in_person_location_NY: '',
exam_in_person_location_TX: '',
exam_in_person_location_HU: '',

// オンライン受験 (全校舎共通の Zoom 想定)
exam_online_zoom_url: '',
exam_online_zoom_passcode: '',

// 自宅受験 (案内文のみ)
exam_home_instruction: '答案は本サイトの URL からアップロードしてください',

// 解説授業 3 形式
explanation_in_person_info: '',          // 対面: 場所 + 時間
explanation_zoom_url: '',                // オンライン Zoom (既存維持)
explanation_zoom_passcode: '',           // (既存維持)
explanation_recording_url: '',           // 録画リンク
explanation_recording_passcode: ''       // 録画用パスコード (任意)
```

## 4. G-1 改修 (`gas_src/api_G1_Apply.gs` + `G1_Apply.html`)

### 4.1 API (`api_G1_Apply.gs`)

`g1_submitApplication` payload に追加:

```javascript
var examFormat = String(payload.examFormat || '').trim();
var explanationFormat = String(payload.explanationFormat || '').trim();

// バリデーション
var EXAM_FORMATS = ['対面', 'オンライン', '自宅'];
var EXPLANATION_FORMATS = ['対面', 'オンライン', '録画'];
if (EXAM_FORMATS.indexOf(examFormat) === -1) throw new Error('受験形式が不正: ' + examFormat);
if (EXPLANATION_FORMATS.indexOf(explanationFormat) === -1) throw new Error('解説授業形式が不正: ' + explanationFormat);

// SheetDB.insert 'tx_申込' にも 受験形式 / 解説授業形式 を含める
```

### 4.2 HTML (`G1_Apply.html`)

「受験教科」セクション直後に 2 select を追加:

```html
<div class="row2">
  <div class="field">
    <label>受験形式 <span class="req">*</span></label>
    <select name="examFormat" id="fExamFormat" required>
      <option value="">選択</option>
      <option value="対面">対面 (校舎で受験)</option>
      <option value="オンライン">オンライン (Zoom 受験)</option>
      <option value="自宅">自宅 (印刷して解いてアップロード)</option>
    </select>
  </div>
  <div class="field">
    <label>解説授業 <span class="req">*</span></label>
    <select name="explanationFormat" id="fExplanationFormat" required>
      <option value="">選択</option>
      <option value="対面">対面</option>
      <option value="オンライン">オンライン</option>
      <option value="録画">録画</option>
    </select>
  </div>
</div>
```

`collectPayload()` に `examFormat` / `explanationFormat` を追加。

## 5. G-2 改修 (`gas_src/Code.gs` + `G2_Upload.html`)

### 5.1 bootstrap (Code.gs `_buildUploadBootstrap`)

返却データに追加:

```javascript
return {
  // ... 既存
  examFormat: rec.受験形式 || '',
  examInfo: _getExamInfoForStudent(rec)
};
```

`_getExamInfoForStudent` を新規追加 (受験形式 で分岐して案内文を返す):

```javascript
function _getExamInfoForStudent(rec) {
  var format = rec.受験形式;
  if (format === '対面') {
    var key = 'exam_in_person_location_' + rec.校舎;  // 注: 受験生マスタに 校舎 列がないので campusOfStudentId で導出
    return Settings.get(key, '');
  }
  if (format === 'オンライン') {
    return 'Zoom URL: ' + Settings.get('exam_online_zoom_url', '') +
      ' / パスコード: ' + Settings.get('exam_online_zoom_passcode', '');
  }
  if (format === '自宅') {
    return Settings.get('exam_home_instruction', '');
  }
  return '';
}
```

### 5.2 HTML (`G2_Upload.html`)

受験生情報セクションに 受験形式 + 案内文を表示:

```html
<div class="full">
  <span class="label">受験形式</span>
  <span class="value" id="vExamFormat">—</span>
  <div class="muted" id="vExamInfo" style="margin-top:4px"></div>
</div>
```

JS の `renderStudentInfo` に追加。

## 6. G-3 改修 (`gas_src/api_G3_Notify.gs`)

### 6.1 `_buildResultMail` の 解説授業ブロック分岐

私の現行実装は単一 Zoom URL 前提 (`api_G3_Notify.gs:357-450` 付近)。受験生ごとに 解説授業形式 で分岐するロジックに置換:

```javascript
// 既存の explanationUrl/explanationPasscode 取得ロジックを置換
var explanationFormat = master.解説授業形式 || 'オンライン';
var explanationBlock = _buildExplanationBlock(explanationFormat);

// _buildExplanationBlock 新規:
function _buildExplanationBlock(format) {
  var schoolName = Settings.get('school_name', '駿台USA合同演習会');
  if (format === '対面') {
    var info = Settings.get('explanation_in_person_info', '');
    return {
      label: '解説授業 (対面)',
      content: info || '校舎担当者よりご案内します'
    };
  }
  if (format === '録画') {
    return {
      label: '解説授業 (録画視聴)',
      url: Settings.get('explanation_recording_url', ''),
      passcode: Settings.get('explanation_recording_passcode', '')
    };
  }
  // オンライン (default)
  return {
    label: '解説授業 (オンライン Zoom)',
    url: Settings.get('explanation_zoom_url', ''),
    passcode: Settings.get('explanation_zoom_passcode', '')
  };
}
```

メール本文の HTML / plain 両方で `_buildExplanationBlock` の戻り値を使うよう改修。

## 7. Migration (既存データ救済)

m_受験生 系の既存行に 受験形式 / 解説授業形式 がない場合のデフォルト値:

```javascript
function migrate_v2_setExamDefaults() {
  Schema.CAMPUSES.forEach(function(campus) {
    var sheetName = Schema.studentSheetName(campus);
    var rows = SheetDB.find(sheetName);
    rows.forEach(function(r) {
      if (!r.受験形式 || !r.解説授業形式) {
        // SheetDB.update は m_受験生 系では使えない (hasId: false なため)
        // → 直接シート操作で書き換え
        var sh = SpreadsheetApp.openById(/* ssId */).getSheetByName(sheetName);
        // ... 該当行 + 該当列を setValue
      }
    });
  });
}
```

**注**: m_受験生 は hasId: false / pk: '受験番号' なので `SheetDB.update` が使えない。直接 sh.getRange().setValue() で書き換える migration script が必要。これは `lib_SheetDB.gs` に「string PK の update」を追加実装するか、migration を素のシート操作で書くかの 2 択。短期的には後者 (1 回限り migration なので) で十分。

## 8. 実装順序の推奨

1. **Schema 改修** (列追加) → ensureSchema 実行 → シートに新列ができることを確認
2. **Settings 改修** (defaults 追加) → bootstrap 再実行
3. **G-1 改修** (form + API) → テスト申込で 受験形式/解説授業形式 が tx_申込 + 確認メールに反映されることを確認
4. **G-2 改修** (bootstrap + 表示のみ) → アップロード画面に受験形式の案内が出ることを確認
5. **G-3 改修** (mail builder 分岐) → プレビューで 3 形式分のメールが正しく出ることを確認
6. **Migration** (既存データ補完) → 1 回限り実行、結果ログ確認

## 9. テストケース追加 (推奨)

| ケース | 受験形式 | 解説授業形式 | 期待 |
|---|---|---|---|
| 1 | 対面 | 対面 | G-2 に校舎場所表示 / G-3 に対面案内 |
| 2 | オンライン | 録画 | G-2 に Zoom URL / G-3 に録画リンク |
| 3 | 自宅 | オンライン | G-2 に自宅案内 / G-3 に Zoom URL |
| 4 | 自宅 | 録画 | G-2 に自宅案内 / G-3 に録画リンク |

---

## 10. 確定済み事項 (Ryo 2026-05-03)

1. ~~「自宅」受験の意味~~ → **確定**: 保護者印刷 + 子供解答 + G-2 アップロード
2. ~~対面受験の校舎別場所~~ → **確定**: Settings に `exam_in_person_location_{校舎}` で保管 (上記案で実装)
3. ~~解説授業形式の当日変更~~ → **確定: 必要**。当日でも保護者が変更できる UI を提供 → §12 参照
4. ~~受験日~~ → **確定: 受験生ごとに異なる**。m_受験生 + tx_申込 に `受験日` 列を追加 → §11 参照

---

## 11. 受験日 (per-student date) 実装

### 11.1 Schema (`lib_Schema.gs`)

`STUDENT_COLS` と `tx_申込` に追加:

```javascript
{ name: '受験日', type: 'date' }   // 受験生ごとに異なる
```

`tx_答案` / `tx_採点` には キャッシュとして 受験日 列を入れるかは判断。
**推奨は入れない**: 答案アップロード/採点フローでは受験日は使わないし、m_受験生 から都度参照すれば十分。後で集計時に必要になったら追加。

### 11.2 G-1 申込フォーム

**訂正 (Ryo 確認 2026-05-03)**: 駿台合同演習会は **前日 + 当日 の 2 値固定運用** (年 3〜4 回 × 全校舎統一)。よって自由日付入力ではなく **dropdown 2 値選択** が UX 上正解。

m_設定 に 2 つの key を持つ:
- `event_date_pre`  : 前日開催日 (YYYY-MM-DD)
- `event_date`      : 当日開催日 (YYYY-MM-DD、既存)

`G1_Apply.html` フォームには **dropdown** を追加 (受験形式と並べる):

```html
<div class="field">
  <label>受験日 <span class="req">*</span></label>
  <select name="examDate" id="fExamDate" required>
    <option value="">選択</option>
    <!-- bootstrap で event_date_pre と event_date を populate -->
  </select>
</div>
```

JS 側で bootstrap.examDateOptions から populate:
```javascript
BOOTSTRAP.examDateOptions.forEach(function(opt) {
  // opt = { value: '2026-05-16', label: '2026-05-16 (前日)' }
  var optionEl = document.createElement('option');
  optionEl.value = opt.value;
  optionEl.textContent = opt.label;
  fExamDate.appendChild(optionEl);
});
```

`Code.gs:_buildApplyBootstrap` で 2 値を返す (実装済):
```javascript
var dateOptions = [];
var pre = Settings.get('event_date_pre', '');
var main = Settings.get('event_date', '');
if (pre) dateOptions.push({ value: pre, label: pre + ' (前日)' });
if (main) dateOptions.push({ value: main, label: main + ' (当日)' });
return { /* ... */, examDateOptions: dateOptions };
```

`api_G1_Apply.gs g1_submitApplication` payload バリデーション (whitelist):
```javascript
var examDate = String(payload.examDate || '').trim();
var preDate = Settings.get('event_date_pre', '');
var mainDate = Settings.get('event_date', '');
if (examDate !== preDate && examDate !== mainDate) {
  throw new Error('受験日が不正です: ' + examDate + ' (有効値: ' + preDate + ' / ' + mainDate + ')');
}
```

tx_申込 + 確認メール文面に追加。

**将来対応**: 3 日以上の開催が必要になったら m_設定 を `event_dates` (CSV or JSON 配列) に拡張。

### 11.3 G-2 アップロード画面

bootstrap に 受験日 を含め、画面の受験生情報セクションに表示:
「受験日: 2026-05-17」

**アップロード制限はかけない** (受験日と異なる日に upload しても許容)。

### 11.4 G-3 配信メール

メール文面に「受験日: ...」を表示。配信タイミング自体は変えない (admin が一括配信)。

### 11.5 Migration

m_受験生 既存行に 受験日 が空の場合、**Settings.event_date のデフォルト値で埋める** 1 回限り migration を用意:

```javascript
function migrate_v2_setExamDateDefault() {
  var defaultDate = Settings.get('event_date', '2026-05-17');
  Schema.CAMPUSES.forEach(function(campus) {
    // 直接シート操作で 受験日 列に defaultDate を setValue
    // (m_受験生 系は hasId: false のため SheetDB.update 不可)
  });
}
```

---

## 12. 解説授業形式の当日変更 UI

### 12.1 配置: G-2 アップロード画面に統合

理由:
- 保護者は G-2 URL を確認メール経由で既に持っている (新規 URL 不要)
- 答案アップロードのついでに解説形式も変えられる UX 一貫性
- 認証も同じ (受験番号 = id パラメータ)

### 12.2 API 新規追加 (`api_G2_Upload.gs` に同居 or 新規 `api_G_Preferences.gs`)

```javascript
function g_updateExplanationFormat(studentId, newFormat) {
  try {
    var ALLOWED = ['対面', 'オンライン', '録画'];
    if (ALLOWED.indexOf(newFormat) === -1) throw new Error('解説授業形式が不正: ' + newFormat);
    var campus = Schema.campusOfStudentId(studentId);
    if (!campus) throw new Error('受験番号が不正');
    var sheetName = Schema.studentSheetName(campus);
    var rec = SheetDB.findOne(sheetName, { 受験番号: studentId });
    if (!rec) throw new Error('受験生が見つかりません');

    // m_受験生 系は SheetDB.update 不可 (hasId: false) のため直接シート操作
    var ss = SpreadsheetApp.openById(/* env-aware ssId */);
    var sh = ss.getSheetByName(sheetName);
    var data = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
    var header = data[0];
    var idCol = header.indexOf('受験番号');
    var formatCol = header.indexOf('解説授業形式');
    if (idCol < 0 || formatCol < 0) throw new Error('列が見つかりません');
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][idCol]) === String(studentId)) {
        var oldFormat = data[i][formatCol];
        sh.getRange(i + 1, formatCol + 1).setValue(newFormat);
        AuditLog.log('update_explanation_format', sheetName, studentId,
          { 解説授業形式: oldFormat }, { 解説授業形式: newFormat });
        SheetDB.flushCache();  // m_受験生 のキャッシュをパージ
        return { ok: true, oldFormat: oldFormat, newFormat: newFormat };
      }
    }
    throw new Error('行が見つかりません');
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
```

**注意**:
- 配信済み (tx_採点.配信済フラグ=1) の受験生は変更しても次回配信に反映されない
- だが配信済前の変更なら G-3 が m_受験生 から都度読むので自動反映
- UI 側で「配信済以降の変更は次年度反映です」と案内

### 12.3 UI (G2_Upload.html)

教科選択セクションの下に `<details>` で折りたたみセクションを追加:

```html
<details class="section">
  <summary style="cursor:pointer;font-weight:600;color:#1b2a4a">
    解説授業の参加形式を変更
  </summary>
  <div style="padding-top:12px">
    <label class="label">現在の選択: <span id="currentExplanationFormat">—</span></label>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px">
      <button type="button" class="explanation-btn" data-format="対面">対面に変更</button>
      <button type="button" class="explanation-btn" data-format="オンライン">オンラインに変更</button>
      <button type="button" class="explanation-btn" data-format="録画">録画に変更</button>
    </div>
    <p class="note">変更は即時反映されます。結果配信メール送信後の変更は次年度の参考情報になります。</p>
    <div id="explanationMsgBox"></div>
  </div>
</details>
```

JS:
```javascript
document.querySelectorAll('.explanation-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    var newFormat = btn.dataset.format;
    if (!confirm('解説授業を「' + newFormat + '」に変更します。よろしいですか?')) return;
    google.script.run
      .withSuccessHandler(function(res) {
        if (res.ok) {
          document.getElementById('currentExplanationFormat').textContent = res.newFormat;
          // 成功メッセージ
        } else {
          // エラー
        }
      })
      .g_updateExplanationFormat(BOOTSTRAP.studentId, newFormat);
  });
});
```

### 12.4 bootstrap 拡張

`Code.gs _buildUploadBootstrap` の戻り値に `explanationFormat` を含める:
```javascript
explanationFormat: rec.解説授業形式 || ''
```

---

---

**END OF ADDENDUM v2**
