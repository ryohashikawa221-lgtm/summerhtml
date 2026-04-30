function getUnpaidList(pass) {
  if (!_checkAdminPass(pass)) return { status: 'error', message: 'パスワードが違います' };
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(S_ENROLL);
    if (!sheet) return { status: 'ok', unpaid: [], paid: [] };
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return { status: 'ok', unpaid: [], paid: [] };
    const headers = data[0];
    const colId = headers.indexOf('申込ID');
    const colTs = headers.indexOf('申込日時');
    const colParent = headers.indexOf('保護者名');
    const colEmail = headers.indexOf('メール');
    const colPhone = headers.indexOf('電話');
    const colStudents = headers.indexOf('生徒情報');
    const colTotal = headers.indexOf('合計金額');
    const colPaid = headers.indexOf('支払日');
    const unpaid = [];
    const paid = [];
    for (let i = 1; i < data.length; i++) {
      const r = data[i];
      if (!r[colParent] && !r[colEmail]) continue;
      const row = {
        rowNumber: i + 1,
        id: colId>=0?r[colId]:'',
        ts: colTs>=0?(r[colTs] instanceof Date?r[colTs].toLocaleString('ja-JP'):r[colTs]):'',
        parent: colParent>=0?r[colParent]:'',
        email: colEmail>=0?r[colEmail]:'',
        phone: colPhone>=0?r[colPhone]:'',
        students: colStudents>=0?r[colStudents]:'',
        total: colTotal>=0?r[colTotal]:'',
        paidDate: colPaid>=0?(r[colPaid] instanceof Date?r[colPaid].toLocaleDateString('ja-JP'):r[colPaid]):''
      };
      if (row.paidDate) paid.push(row);
      else unpaid.push(row);
    }
    return { status: 'ok', unpaid: unpaid, paid: paid };
  } catch (err) {
    console.error(err);
    return { status: 'error', message: 'サーバーエラー' };
  }
}

// 管理画面から「支払日」を直接更新
function markRowAsPaid(pass, rowNumber, paidDate) {
  if (!_checkAdminPass(pass)) return { status: 'error', message: 'パスワードが違います' };
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(S_ENROLL);
    if (!sheet) return { status: 'error', message: 'シートが見つかりません' };
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    let colPaid = headers.indexOf('支払日') + 1;
    if (colPaid === 0) {
      colPaid = sheet.getLastColumn() + 1;
      sheet.getRange(1, colPaid).setValue('支払日')
        .setBackground('#1b2a4a').setFontColor('#fff').setFontWeight('bold');
    }
    sheet.getRange(rowNumber, colPaid).setValue(paidDate || new Date().toLocaleDateString('ja-JP'));
    SpreadsheetApp.flush();
    return { status: 'ok' };
  } catch (err) {
    console.error(err);
    return { status: 'error', message: 'サーバーエラー' };
  }
}

// ============================================================
// 募集停止管理
// ============================================================
function setEnrollmentStatus(courseId, status) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  [S_COURSES, S_EIKEN].forEach(sheetName => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    let statusCol = headers.indexOf('募集状況');
    if (statusCol === -1) {
      statusCol = headers.length;
      sheet.getRange(1, statusCol + 1).setValue('募集状況')
        .setBackground('#1b2a4a').setFontColor('#fff').setFontWeight('bold');
    }
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === courseId) {
        sheet.getRange(i + 1, statusCol + 1).setValue(status);
      }
    }
  });
  return getCourseCounts();
}

function getEnrollmentStatuses() {
  const courses = getCourses();
  const statuses = {};
  courses.forEach(c => {
    if (c['講座ID']) statuses[c['講座ID']] = c['募集状況'] || '';
  });
  return statuses;
}

// ============================================================
// メニュー
// ============================================================
