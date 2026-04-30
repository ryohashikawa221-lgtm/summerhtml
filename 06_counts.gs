// ============================================================
// 講座IDごとの申込数を更新（Phase U-2.1: 申込一覧から再構築）
// 引数のcountsは無視。申込一覧から動的に再計算したカウントで申込数集計シートを上書きします。
// 申込一覧から行を削除した後にこれを呼ぶと、削除分が反映されます。
// ============================================================
function updateCourseCounts(_unused) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(8000);
  } catch (e) {
    console.log('updateCourseCounts: ロック取得失敗 ' + e.message);
    return;
  }
  try {
    const counts = getCourseCounts();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_COUNTS);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_COUNTS);
      sheet.appendRow(['講座ID', '申込数']);
      sheet.getRange(1,1,1,2).setBackground('#1b2a4a').setFontColor('#ffffff').setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
    // 既存データをクリア
    if (sheet.getLastRow() > 1) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).clearContent();
    }
    // 動的カウントを書き込み
    const rows = Object.entries(counts).map(([id, n]) => [id, n]);
    if (rows.length > 0) {
      sheet.getRange(2, 1, rows.length, 2).setValues(rows);
    }
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// 講座IDごとの申込数を取得（Phase U-2.1: 申込一覧から動的に集計）
// 申込一覧シートから行を削除すれば自動的に減算されます。
// ============================================================
function getCourseCounts() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const enrollSheet = ss.getSheetByName(S_ENROLL);
  if (!enrollSheet || enrollSheet.getLastRow() < 2) return {};

  // 講座マスターから「講座名+ターム」→ 講座ID の逆引きマップを作る
  const allCourses = getCourses();
  const nameTermToId = {};
  allCourses.forEach(c => {
    if (c['講座ID'] && c['講座名'] != null && c['ターム'] != null) {
      const key = String(c['講座名']) + '|' + String(c['ターム']);
      nameTermToId[key] = String(c['講座ID']);
    }
  });

  const counts = {};
  const data = enrollSheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const coursesText = String(data[i][6] || ''); // 講座詳細列
    coursesText.split('\n').forEach(line => {
      // プレ講習は集計対象外（個別IDが無い）
      if (/プレ講習/.test(line)) return;
      // 「・講座名（NT 日付）」形式を抽出
      const m = line.match(/[・•]\s*(.+?)（(\d+)T/);
      if (!m) return;
      const courseName = m[1].trim();
      const term = m[2];
      const id = nameTermToId[courseName + '|' + term];
      if (id) counts[id] = (counts[id] || 0) + 1;
    });
  }
  return counts;
}

// ============================================================
// 管理データ取得
// ============================================================
function getAdminData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(S_ENROLL);
  if (!sheet) return { enrollments: [], counts: {} };
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const enrollments = [];
  for (let i = 1; i < data.length; i++) {
    const row = {};
    headers.forEach((h, j) => {
      const v = data[i][j];
      row[h] = (v instanceof Date) ? v.toLocaleString('ja-JP') : v;
    });
    enrollments.push(row);
  }
  return { enrollments, counts: getCourseCounts() };
}

// ============================================================
// 設定値（Phase U-2 で追加）
// ============================================================
// Zelle決済情報。校舎設定シートで上書き可能（Phase U-4 / Feature M で動的化予定）
