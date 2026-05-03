/**
 * Code.gs (goudou_enshu_app)
 * GAS WebApp のエントリポイント (doGet) と 初期セットアップ。
 *
 * URL ルーティング (HANDOFF G-2 シーケンス §4):
 *   {WebAppURL}?role=upload&id={受験番号}  → G-2 答案アップロード画面
 *   {WebAppURL}?role=apply                  → G-1 申込フォーム
 *   {WebAppURL}                             → 既定: G-1 申込フォーム
 *
 * 初期セットアップ:
 *   initialSetup()        : Script Property 確認 + Schema ensureSchema + Settings.bootstrap
 *   ensureFolders()       : Drive ルート + 提出済/採点済 + 教科別サブフォルダ作成
 *   seedTeachers()        : m_先生 に HANDOFF §3 の初期データを投入
 *   seedTestStudents()    : m_受験生_MI にテストデータ 3 行投入 (HANDOFF §6)
 */

// ============================================================
// WebApp doGet
// ============================================================
function doGet(e) {
  var role = (e && e.parameter && e.parameter.role) || '';
  try {
    if (role === 'upload') {
      return _renderUploadPage(e.parameter.id || '');
    }
    if (role === 'apply') {
      return _renderApplyPage();
    }
    if (role === 'dashboard') {
      return _renderDashboardPage();
    }
    return _renderApplyPage();
  } catch (err) {
    return _renderError(err);
  }
}

function _renderDashboardPage() {
  var t = HtmlService.createTemplateFromFile('G3_Dashboard');
  return t.evaluate()
    .setTitle('駿台USA合同演習会 管理者ダッシュボード')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function _renderUploadPage(studentId) {
  var t = HtmlService.createTemplateFromFile('G2_Upload');
  t.studentId = studentId;
  t.bootstrapJson = JSON.stringify(_buildUploadBootstrap(studentId));
  return t.evaluate()
    .setTitle('駿台USA合同演習会 答案アップロード')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function _renderApplyPage() {
  var t = HtmlService.createTemplateFromFile('G1_Apply');
  t.bootstrapJson = JSON.stringify(_buildApplyBootstrap());
  return t.evaluate()
    .setTitle('駿台USA合同演習会 申込フォーム')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function _renderError(err) {
  var msg = (err && err.message) ? err.message : String(err);
  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>エラー</title></head><body>' +
    '<div style="font-family:sans-serif;padding:32px;max-width:600px;margin:auto">' +
    '<h2 style="color:#c0392b">エラーが発生しました</h2>' +
    '<p>' + Util.escapeHtml(msg) + '</p>' +
    '<p style="color:#666;font-size:13px">事務局までお問い合わせください。</p>' +
    '</div></body></html>';
  return HtmlService.createHtmlOutput(html);
}

/**
 * G-2 アップロード画面 起動時の bootstrap データ
 */
function _buildUploadBootstrap(studentId) {
  if (!studentId) {
    return { error: '受験番号 (id) パラメータが指定されていません。確認メールのリンクを再度開いてください。' };
  }
  var campus = Schema.campusOfStudentId(studentId);
  if (!campus) {
    return { error: '受験番号の形式が不正です: ' + studentId + ' (期待形式: LA-001 等)' };
  }
  var sheetName = Schema.studentSheetName(campus);
  var rec;
  try {
    rec = SheetDB.findOne(sheetName, { 受験番号: studentId });
  } catch (e) {
    return { error: 'マスタ参照エラー: ' + e.message };
  }
  if (!rec) {
    return { error: '受験番号 ' + studentId + ' は登録されていません。事務局までお問い合わせください。' };
  }
  var subjects = String(rec.受験教科 || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  return {
    studentId: studentId,
    campus: campus,
    name: rec.氏名 || '',
    nameKana: rec.氏名カナ || '',
    grade: rec.学年 || '',
    subjects: subjects,
    parentEmail: rec.保護者メール || ''
  };
}

/**
 * G-1 申込フォーム 起動時の bootstrap データ
 */
function _buildApplyBootstrap() {
  return {
    campuses: Schema.CAMPUSES,
    grades: Object.keys(Schema.SUBJECTS_BY_GRADE),
    subjectsByGrade: Schema.SUBJECTS_BY_GRADE,
    eventDate: Settings.get('event_date', ''),
    deadline: Settings.get('application_deadline', '')
  };
}

/**
 * HtmlTemplate から include() で部分テンプレを埋め込むヘルパ
 */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

// ============================================================
// 初期セットアップ
// ============================================================

/**
 * 全シートを Schema 通りに作成 + Settings 既定値投入。
 * 初回 push 後に GAS エディタから手動実行する。
 */
function initialSetup() {
  // 1. Script Property 確認
  var props = PropertiesService.getScriptProperties();
  var env = (props.getProperty('APP_ENV') || 'dev').toLowerCase();
  var key = env === 'prod' ? 'prod_spreadsheet_id' : 'dev_spreadsheet_id';
  if (!props.getProperty(key)) {
    throw new Error('Script Property "' + key + '" が未設定です。プロジェクト設定 > スクリプト プロパティ で設定してください。');
  }
  if (!props.getProperty('timezone')) {
    props.setProperty('timezone', 'America/Detroit');
  }

  // 2. シート構造を作成
  var schemaReport = SheetDB.ensureSchema();
  Logger.log('Schema report:\n' + schemaReport.join('\n'));

  // 3. Settings 既定値を投入
  Settings.bootstrap();
  Logger.log('Settings bootstrap completed');

  return {
    env: env,
    spreadsheetId: props.getProperty(key),
    schemaReport: schemaReport
  };
}

/**
 * Drive のルート + 提出済/採点済 + 教科別サブフォルダを作成。
 * initialSetup と seedTeachers を実行した後に呼ぶ。
 */
function ensureFolders() {
  Settings.ensureRootFolder();
  Settings.ensureCategoryRootFolder('提出済');
  Settings.ensureCategoryRootFolder('採点済');
  var report = Drive.ensureSubjectFolders();
  Logger.log('Drive folders ensured:\n' + report.join('\n'));
  return report;
}

/**
 * m_先生 に HANDOFF §3 の初期データを投入 (重複は skip)。
 * フォルダ ID は ensureFolders() で後から埋まる。
 */
function seedTeachers() {
  var initial = [
    { 教科: '国語', 先生: '郡山', 学年: '中3' },
    { 教科: '数学', 先生: '高濱', 学年: '中3' },
    { 教科: '英語', 先生: '中村', 学年: '中3' },
    { 教科: '国語', 先生: '郡山', 学年: '小6' },
    { 教科: '算数', 先生: '澤',   学年: '小6' },
    { 教科: '英語', 先生: '大高', 学年: '小6' }
  ];
  var report = [];
  initial.forEach(function (row) {
    var existing = SheetDB.findOne('m_先生', { 教科: row.教科, 学年: row.学年 });
    if (existing) {
      report.push('SKIP (already exists): ' + row.学年 + ' ' + row.教科 + ' / ' + row.先生);
    } else {
      var id = SheetDB.insert('m_先生', row);
      report.push('INSERTED id=' + id + ': ' + row.学年 + ' ' + row.教科 + ' / ' + row.先生);
    }
  });
  Logger.log('seedTeachers:\n' + report.join('\n'));
  return report;
}

/**
 * m_受験生_MI にテストデータ 3 行投入 (HANDOFF §6 シナリオ用)。
 * 本番受験生は校舎担当者が手動投入するので、これは dev 用。
 */
function seedTestStudents() {
  var rows = [
    {
      受験番号: 'MI-001', 学年: '中3', 氏名: 'テスト太郎', 氏名カナ: 'テストタロウ',
      保護者メール: 'parent.test1@example.com', 本人メール: 'student.test1@example.com',
      受験教科: '国語,数学,英語', 備考: 'テストデータ'
    },
    {
      受験番号: 'MI-002', 学年: '中3', 氏名: 'テスト花子', 氏名カナ: 'テストハナコ',
      保護者メール: 'parent.test2@example.com', 本人メール: '',
      受験教科: '国語,英語', 備考: 'テストデータ'
    },
    {
      受験番号: 'MI-003', 学年: '小6', 氏名: 'テスト次郎', 氏名カナ: 'テストジロウ',
      保護者メール: 'parent.test3@example.com', 本人メール: '',
      受験教科: '国語,算数,英語', 備考: 'テストデータ'
    }
  ];
  var report = [];
  rows.forEach(function (row) {
    var existing = SheetDB.findOne('m_受験生_MI', { 受験番号: row.受験番号 });
    if (existing) {
      report.push('SKIP (already exists): ' + row.受験番号);
    } else {
      SheetDB.insert('m_受験生_MI', row);
      report.push('INSERTED: ' + row.受験番号 + ' ' + row.氏名);
    }
  });
  Logger.log('seedTestStudents:\n' + report.join('\n'));
  return report;
}

/**
 * 全部 1 発で立ち上げる便利 wrapper (dev 環境のみ推奨)。
 */
function fullBootstrap() {
  var s = initialSetup();
  seedTeachers();
  ensureFolders();
  seedTestStudents();
  return s;
}
