function buildResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// google.script.run から呼ばれる関数
// ============================================================
function processEnrollment(data) {
  // Phase U-3-A 1-3 (A): LockService 日本語メッセージ化
  const lock = LockService.getScriptLock();
  let lockAcquired = false;
  try {
    lock.waitLock(15000); // 15秒待機
    lockAcquired = true;
  } catch (e) {
    return {
      status: 'error',
      message: 'ただいま申込が集中しています。30秒ほどお待ちいただいてから、もう一度お試しください。'
    };
  }
  try {
    if (!_rateLimitOk('enroll_run', 500)) {
      return { status: 'error', message: '本日の申込受付上限に達しました。' };
    }
    const v = _validateEnrollment(data);
    if (v) return { status: 'error', message: v };
    saveEnrollment(data);
    sendEnrollmentEmail(data);
    return { status: 'ok', counts: getCourseCounts(), app_number: data._appNumber || '', duplicate_warning: !!data._duplicateWarning };
  } catch (err) {
    console.error(err);
    return { status: 'error', message: 'システムエラーが発生しました。お手数ですが、しばらくしてから再度お試しください。問題が続く場合は学校までご連絡ください。' };
  } finally {
    if (lockAcquired) {
      try { lock.releaseLock(); } catch (e) {}
    }
  }
}

function processRequest(data) {
  try {
    if (!_rateLimitOk('request_run', 200)) {
      return { status: 'error', message: '本日の受付上限に達しました。' };
    }
    const v = _validateRequest(data);
    if (v) return { status: 'error', message: v };
    sendRequestEmail(data);
    return { status: 'ok' };
  } catch (err) {
    console.error(err);
    return { status: 'error', message: 'サーバーエラーが発生しました' };
  }
}

function getAdminDataWithPass(pass) {
  if (!_rateLimitOk('admin_data', 50)) return null;
  if (!_checkAdminPass(pass)) return null;
  return getAdminData();
}

function checkAdminPass(pass) {
  return _checkAdminPass(pass);
}

// ============================================================
// H: 共起レコメンド（申込一覧から講座ペアの共起頻度を分析）
// 申込が一定数（10件以上）たまった時にフロントへ提供
