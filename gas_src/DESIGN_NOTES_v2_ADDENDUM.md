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

## 10. 議論ポイント (確定したい)

1. ~~「自宅」受験の意味~~ → **確定**: 保護者印刷 + 子供解答 + G-2 アップロード
2. **対面受験の校舎別場所**: Settings に校舎別保管 (上記案) で OK? それとも m_設定 ではなく別シート?
3. **解説授業の事前申込**: G-1 で 解説授業形式 を選ぶが、当日変更を許す UI は必要?
4. **複数日開催**: 受験日は受験生ごとに異なる場合がある? (DESIGN_NOTES §6 の議論ポイントとも関連)

---

**END OF ADDENDUM v2**
