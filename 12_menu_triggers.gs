function onOpen() {
  SpreadsheetApp.getUi().createMenu('📊 サマースクール管理')
    .addItem('先生別時間割を出力（全体）', 'outputTimetable')
    .addItem('└ ターム別で出力', 'outputTimetableByTerm')
    .addItem('└ 先生別で出力', 'outputTimetableByTeacher')
    .addItem('講座別名簿を出力', 'outputRoster')
    .addItem('申込サマリーを出力', 'outputSummary')
    .addItem('💰 売上一覧を出力', 'outputSalesReport')
    .addSeparator()
    .addItem('全レポートを一括出力', 'outputAll')
    .addItem('申込数集計を再計算', 'rebuildCourseCounts')
    .addSeparator()
    .addItem('💰 領収書発行（選択行）', 'sendReceiptForSelectedRow')
    .addItem('💰 領収書発行（複数選択行）', 'sendReceiptForMultipleRows')
    .addSeparator()
    .addItem('📧 未送信メール再送', 'resendFailedEmails')
    .addSeparator()
    .addItem('🔄 自動更新を有効化（最初に1回）', 'installAutoRefreshTrigger')
    .addItem('🔧 スキーママイグレーション再実行', 'runMigrationsManually')
    .addToUi();
}

function outputAll() {
  outputTimetable();
  outputRoster();
  outputSummary();
  outputSalesReport();
  updateCourseCounts();
  SpreadsheetApp.getUi().alert('✅ 全レポートの出力が完了しました！');
}

// ============================================================
// 申込数集計の手動再計算（申込一覧から動的に）
// ============================================================
function rebuildCourseCounts() {
  updateCourseCounts();
  SpreadsheetApp.getUi().alert('✅ 申込数集計を申込一覧から再計算しました');
}

// ============================================================
// ターム別時間割を出力（プロンプトでターム番号を聞く）
// ============================================================
function outputTimetableByTerm() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt(
    'ターム別時間割',
    '出力するターム番号を入力してください（例: 1, 2, 3, ..., 8）',
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return;
  const term = parseInt(response.getResponseText().trim());
  if (!isFinite(term) || term < 1 || term > 8) {
    ui.alert('無効なターム番号です（1〜8で指定してください）');
    return;
  }
  outputTimetable({ term: term });
  ui.alert('✅ ' + term + '期の時間割を別シートに出力しました');
}

// ============================================================
// 先生別時間割を出力（プロンプトで先生名を聞く）
// ============================================================
function outputTimetableByTeacher() {
  const ui = SpreadsheetApp.getUi();
  const allCourses = getCourses();
  const teacherList = [...new Set(allCourses.map(c => c['担当先生']).filter(Boolean))].join(', ');
  const response = ui.prompt(
    '先生別時間割',
    '出力する先生名を入力してください\n\n登録済み先生: ' + teacherList,
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return;
  const teacher = response.getResponseText().trim();
  if (!teacher) {
    ui.alert('先生名を入力してください');
    return;
  }
  outputTimetable({ teacher: teacher });
  ui.alert('✅ ' + teacher + 'の時間割を別シートに出力しました');
}

// ============================================================
// 自動更新トリガー
// 申込一覧の行が追加/削除された時に、全レポートを自動再生成
// ============================================================
function onChangeAutoRefresh(e) {
  if (!e || !e.changeType) return;
  // 行の追加/削除/編集時のみ反応（フォーマット変更等は無視）
  const targets = ['INSERT_ROW', 'REMOVE_ROW', 'EDIT', 'PASTE'];
  if (targets.indexOf(e.changeType) === -1) return;
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    if (!sheet || sheet.getName() !== S_ENROLL) return;
    // 同時実行を抑止
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(2000)) return;
    try {
      // デバウンス: 直近30秒以内に重いレポートが走っていればスキップ
      const props = PropertiesService.getScriptProperties();
      const lastFull = parseInt(props.getProperty('LAST_AUTO_FULL_REFRESH') || '0');
      const now = Date.now();
      const heavyOk = (now - lastFull) > 30000;

      // 申込数集計は毎回（軽い）
      try { updateCourseCounts(); } catch (err) { console.warn('updateCourseCounts:', err && err.message); }

      // 重いレポート4つはデバウンス付きで実行
      if (heavyOk) {
        props.setProperty('LAST_AUTO_FULL_REFRESH', String(now));
        try { outputRoster(true); }   catch (err) { console.warn('outputRoster:',   err && err.message); }
        try { outputSummary(true); }  catch (err) { console.warn('outputSummary:',  err && err.message); }
        try { outputTimetable(null, true); } catch (err) { console.warn('outputTimetable:', err && err.message); }
        try { outputSalesReport(true); } catch (err) { console.warn('outputSalesReport:', err && err.message); }
        console.log('全レポート自動再生成完了: ' + e.changeType);
      } else {
        console.log('申込数集計のみ更新（30秒デバウンス中）: ' + e.changeType);
      }
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    console.error('Auto refresh failed:', err && err.message);
  }
}

// 一度だけ実行してトリガーをインストール
function installAutoRefreshTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === 'onChangeAutoRefresh') {
      ScriptApp.deleteTrigger(t);
    }
  });
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.newTrigger('onChangeAutoRefresh')
    .forSpreadsheet(ss)
    .onChange()
    .create();
  SpreadsheetApp.getUi().alert(
    '✅ 自動更新トリガーを設定しました。\n\n' +
    '今後、申込一覧シートで行の追加・削除・編集をすると、\n' +
    '以下のレポートが自動的に再生成されます：\n' +
    '  • 申込数集計（毎回更新／軽量）\n' +
    '  • 講座別名簿（30秒デバウンス）\n' +
    '  • 申込サマリー（30秒デバウンス）\n' +
    '  • 先生別時間割（30秒デバウンス）\n' +
    '  • 売上一覧（30秒デバウンス）\n\n' +
    '※ 短時間に複数回編集した場合、重いレポートは30秒待って一度だけ更新されます。\n' +
    '※ ターム別/先生別の時間割サブシートは自動更新しません（必要時にメニューから出力してください）。'
  );
}

// ============================================================
// 領収書発行（A案：手動／単一行・複数行両対応）
// 申込一覧シートで対象行を選択 → メニューから実行
// 「支払日」「領収書発行日」列を自動追加し、行ごとに記録
// ============================================================

