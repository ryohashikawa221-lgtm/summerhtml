// ============================================================
// doGet
// ============================================================
// ============================================================
// HtmlService include ヘルパー（Phase U-4 分割リファクタ用）
// 使い方: index.html 内で <?!= include('partial_name') ?>
// ============================================================
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function doGet(e) {
  // 起動時にスキーママイグレーションを実行（軽量・冪等）
  try { runMigrations(); } catch (err) { Logger.log('runMigrations on doGet failed: ' + err.message); }

  const action = e.parameter.action;

  if (action === 'masterdata') {
    return buildResponse({
      status: 'ok',
      settings: getSettings(),
      courses: getCourses(),
      prices: getPrices(),
      discounts: getDiscounts(),
      counts: getCourseCounts()
    });
  }
  if (action === 'counts') {
    return buildResponse({ status: 'ok', counts: getCourseCounts() });
  }
  if (action === 'admin') {
    if (!_rateLimitOk('admin', 30)) {
      return buildResponse({ status: 'error', message: 'アクセスが集中しています。しばらく経ってから再度お試しください。' });
    }
    if (!_checkAdminPass(e.parameter.pass)) {
      return buildResponse({ status: 'error', message: 'パスワードが違います' });
    }
    return buildResponse({ status: 'ok', data: getAdminData() });
  }

  // Phase U-3-B: マイページ表示（?page=mypage）
  if (e.parameter.page === 'mypage') {
    return HtmlService.createTemplateFromFile('mypage').evaluate()
      .setTitle('2026 サマースクール マイページ')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // Phase U-4: createTemplateFromFile + evaluate() で <?!= include() ?> を処理する
  return HtmlService.createTemplateFromFile('index').evaluate()
    .setTitle('2026 サマースクール 受講申込')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ============================================================
// doPost
// ============================================================
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return buildResponse({ status: 'error', message: 'リクエストが不正です' });
    }
    if (e.postData.contents.length > 100000) {
      return buildResponse({ status: 'error', message: 'データが大きすぎます' });
    }

    const data = JSON.parse(e.postData.contents);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return buildResponse({ status: 'error', message: 'データ形式が不正です' });
    }

    if (data.type === 'enrollment') {
      if (!_rateLimitOk('enroll_post', 500)) {
        return buildResponse({ status: 'error', message: '本日の申込受付上限に達しました。' });
      }
      const v = _validateEnrollment(data);
      if (v) return buildResponse({ status: 'error', message: v });
      saveEnrollment(data);
      sendEnrollmentEmail(data);
    } else if (data.type === 'request') {
      if (!_rateLimitOk('request_post', 200)) {
        return buildResponse({ status: 'error', message: '本日の受付上限に達しました。' });
      }
      const v = _validateRequest(data);
      if (v) return buildResponse({ status: 'error', message: v });
      sendRequestEmail(data);
    } else {
      return buildResponse({ status: 'error', message: '不明なリクエスト種別です' });
    }
    return buildResponse({ status: 'ok', counts: getCourseCounts() });
  } catch (err) {
    console.error(err);
    return buildResponse({ status: 'error', message: 'サーバーエラーが発生しました' });
  }
}

