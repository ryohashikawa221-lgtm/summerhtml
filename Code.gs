// ============================================================
// 駿台ミシガン国際学院 サマースクール – GAS バックエンド
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📅 最終更新: 2026-04-30 20:15 JST
// 🔖 バージョン: Phase U-2.11（領収書発行A案・手動）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 主な履歴:
//   2026-04-29 ★マージ版 v2: セキュリティ強化 + マスターデータ機能
//   2026-04-30 Phase U-2:    HTML確認メール / Zelle案内 / 印刷フォーマット
//   2026-04-30 Phase U-2.1:  申込数集計を動的化 / 時間割タームor先生別出力 /
//                            申込一覧の編集で自動再計算するトリガー追加
// ============================================================
const APP_VERSION = 'Phase U-2.11 / 2026-04-30 20:15 JST';

const S_SETTINGS  = '学校設定';
const S_COURSES   = '講座マスター';
const S_EIKEN     = '英検マスター';
const S_PRICE     = '料金マスター';
const S_DISCOUNT  = '割引マスター';
const S_ENROLL    = '申込一覧';
const S_COUNTS    = '申込数集計';
const S_TIMETABLE = '先生別時間割';
const S_ROSTER    = '講座別名簿';
const S_SUMMARY   = '申込サマリー';

const SHEET_ENROLL = S_ENROLL;
const SHEET_COUNTS = S_COUNTS;

const SCHOOL_EMAIL = 'r-hashikawa@sundai-kaigai.jp,michi-info@sundai-kaigai.jp,m-sakamoto@sundai-kaigai.jp';
const SCHOOL_NAME  = '駿台ミシガン国際学院 サマースクール';

const ADMIN_PASS_FALLBACK = 'sundai2026';

// ============================================================
// 管理者パスワード関連
// ============================================================
function _getAdminPass() {
  try {
    const p = PropertiesService.getScriptProperties().getProperty('ADMIN_PASS');
    if (p && String(p).trim()) return String(p).trim();
  } catch (e) {}
  try {
    const fromSheet = (getSettings()['管理者パスワード']);
    if (fromSheet && String(fromSheet).trim()) return String(fromSheet).trim();
  } catch (e) {}
  return ADMIN_PASS_FALLBACK;
}

function _checkAdminPass(input) {
  const expected = _getAdminPass();
  const got = (input === undefined || input === null) ? '' : String(input).trim();
  return got === expected;
}

// ============================================================
// レート制限
// ============================================================
function _rateLimitOk(bucketName, dailyMax) {
  try {
    const props = PropertiesService.getScriptProperties();
    const tz = Session.getScriptTimeZone() || 'America/Detroit';
    const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    const key = 'rl_' + bucketName + '_' + today;
    const cnt = parseInt(props.getProperty(key)) || 0;
    if (cnt >= dailyMax) return false;
    props.setProperty(key, String(cnt + 1));
    return true;
  } catch (e) {
    return true;
  }
}

// ============================================================
// 入力検証ヘルパー
// ============================================================
function _validString(v, max) {
  if (v == null || v === undefined) return true;
  if (typeof v !== 'string') return false;
  return v.length <= max;
}

function _validEmail(s) {
  if (!s || typeof s !== 'string') return false;
  if (/[\r\n]/.test(s)) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

// ============================================================
// マスターデータ読み込み
// ============================================================
function getSettings() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(S_SETTINGS);
  if (!sheet) return {};
  const data = sheet.getDataRange().getValues();
  const s = {};
  for (let i = 1; i < data.length; i++) if (data[i][0]) s[data[i][0]] = data[i][1];
  return s;
}

function getCourses() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const courses = [];
  [S_COURSES, S_EIKEN].forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    for (let i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;
      const row = {};
      headers.forEach((h, j) => { row[h] = data[i][j]; });
      courses.push(row);
    }
  });
  return courses;
}

function getPrices() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(S_PRICE);
  if (!sheet) return {};
  const data = sheet.getDataRange().getValues();
  const p = {};
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    p[data[i][0]] = { elem_lo: +data[i][1]||0, elem_hi: +data[i][2]||0, jhs: +data[i][3]||0, hs: +data[i][4]||0 };
  }
  return p;
}

function getDiscounts() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(S_DISCOUNT);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  const d = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    d.push({ type: data[i][0], condition: data[i][1], rate: +data[i][2]||0, note: data[i][3]||'' });
  }
  return d;
}

// ============================================================
// 対象学年の表記ゆれを英語キーに正規化
// HTMLは elem_lo / elem_hi / jhs / hs / all を期待している
// ============================================================
const LEVEL_MAP = {
  'elem_lo':'elem_lo','elem_hi':'elem_hi','jhs':'jhs','hs':'hs','all':'all',
  '小学校低学年':'elem_lo','小学低学年':'elem_lo','小学生低学年':'elem_lo',
  '小学校高学年':'elem_hi','小学高学年':'elem_hi','小学生高学年':'elem_hi',
  '中学生':'jhs','中学':'jhs','中学校':'jhs',
  '高校生':'hs','高校':'hs','高等学校':'hs',
  '全学年':'all','全て':'all','全':'all','すべて':'all'
};

function _normalizeLevel(raw) {
  if (raw == null) return '';
  const s = String(raw).trim();
  if (!s) return '';
  if (/[,、\/]/.test(s)) {
    return s.split(/[,、\/]/).map(x => LEVEL_MAP[x.trim()] || x.trim()).filter(Boolean);
  }
  return LEVEL_MAP[s] || s;
}

// ============================================================
// HTMLが起動時に呼ぶマスターデータ統合関数
// ★修正: levelをスプレッドシートの日本語値そのまま返す
// ============================================================
function getMasterData() {
  const rawCourses = getCourses();
  const courses = rawCourses.map(c => ({
    id: String(c['講座ID']||''),
    label: String(c['講座名']||''),
    level: _normalizeLevel(c['対象学年']),
    type: String(c['種別(group/ind)']||'group'),
    term: Number(c['ターム'])||0,
    date: String(c['日程']||''),
    time: String(c['時間帯']||''),
    teacher: String(c['担当先生']||''),
    maxStudents: Number(c['定員'])||12,
    note: String(c['備考']||''),
    price: Number(c['料金(空欄=学年別標準)'])||0
  }));

  const rawSettings = getSettings();
  const settings = {};
  Object.keys(rawSettings).forEach(k => {
    const v = rawSettings[k];
    settings[k] = (v instanceof Date) ? v.toLocaleDateString('ja-JP') : v;
  });

  return {
    settings: settings,
    courses: courses,
    prices: getPrices(),
    discounts: getDiscounts(),
    counts: getCourseCounts(),
    statuses: getEnrollmentStatuses()
  };
}

// ============================================================
// doGet
// ============================================================
function doGet(e) {
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

  return HtmlService.createHtmlOutputFromFile('index')
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

// ============================================================
// 申込データ検証
// ============================================================
function _validateEnrollment(d) {
  if (!d || typeof d !== 'object') return 'データ形式が不正です';
  if (!d.parent_name || !String(d.parent_name).trim()) return '保護者名は必須です';
  if (!_validString(d.parent_name, 200))   return '保護者名が長すぎます';
  if (!_validEmail(d.reply_to))            return 'メールアドレスの形式が不正です';
  if (!_validString(d.reply_to, 200))      return 'メールアドレスが長すぎます';
  if (!_validString(d.phone, 100))         return '電話番号が長すぎます';
  if (!_validString(d.students_info, 2000)) return '生徒情報が長すぎます';
  if (!_validString(d.courses, 20000))     return '講座詳細が長すぎます';
  if (!_validString(d.note, 5000))         return '備考が長すぎます';
  if (!_validString(d.total, 200))         return '合計金額の形式が不正です';
  if (!_validString(d.submit_date, 100))   return '申込日の形式が不正です';
  return null;
}

function _validateRequest(d) {
  if (!d || typeof d !== 'object') return 'データ形式が不正です';
  if (!d.parent_name || !String(d.parent_name).trim()) return '保護者名は必須です';
  if (!_validString(d.parent_name, 200)) return '保護者名が長すぎます';
  if (!_validEmail(d.reply_to))          return 'メールアドレスの形式が不正です';
  if (!_validString(d.reply_to, 200))    return 'メールアドレスが長すぎます';
  if (!_validString(d.courses, 20000))   return 'リクエスト内容が長すぎます';
  return null;
}

// ============================================================
// 申込をスプレッドシートに保存
// ============================================================
function saveEnrollment(d) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_ENROLL);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_ENROLL);
    sheet.appendRow(['申込ID','申込日時','保護者名','メール','電話','生徒情報','講座詳細','合計金額','備考']);
    sheet.getRange(1,1,1,9).setBackground('#1b2a4a').setFontColor('#ffffff').setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  const enrollId = 'E' + new Date().getTime() + '-' + Utilities.getUuid().slice(0, 4);
  sheet.appendRow([
    enrollId,
    new Date().toLocaleString('ja-JP'),
    d.parent_name, d.reply_to, d.phone || '',
    d.students_info, d.courses, d.total, d.note || ''
  ]);
  if (d.course_counts) updateCourseCounts(d.course_counts);
}

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
const ZELLE_RECIPIENT_EMAIL = 'michi-info@sundai-kaigai.jp';
const ZELLE_RECIPIENT_NAME  = 'Sundai USA, Inc. Novi, MI';
const CHECK_PAYABLE_TO      = 'Sundai USA, Inc.';
const CHECK_MAIL_TO         = '24277 Novi Rd, Novi, MI 48375';
// Zelle QR画像URL。空文字の場合はプレースホルダ（テキストのみ）を表示。
// 後日 Drive 直リンク等を入れると自動で QR画像入りに切り替わる。
const ZELLE_QR_IMAGE_URL    = '';

// ============================================================
// HTMLエスケープ
// ============================================================
function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// 改行を <br> に
function _nl2br(s) {
  return _esc(s).replace(/\n/g, '<br>');
}

// ============================================================
// メール送信（申込） - Phase U-2: HTML化 + Zelle案内 + 領収書PDF添付
// ============================================================
function sendEnrollmentEmail(d) {
  const subject = '【サマースクール申込】' + d.parent_name + ' 様 - ' + d.submit_date;

  // 学校（管理者）向け: テキスト+HTML 両方送る
  const adminTextBody =
'サマースクール 受講申込が届きました。\n' +
'━━━━━━━━━━━━━━━━━━━━━━\n' +
'お名前：' + d.parent_name + '\n' +
'メール：' + d.reply_to + '\n' +
'電話：' + (d.phone || '未入力') + '\n' +
'申込日：' + d.submit_date + '\n\n' +
'■ 生徒情報\n' + d.students_info + '\n\n' +
'■ 選択講座\n' + d.courses + '\n\n' +
'■ 合計金額：' + d.total + '\n' +
'■ 備考：' + (d.note || 'なし') + '\n' +
'━━━━━━━━━━━━━━━━━━━━━━\n' +
SCHOOL_NAME + '  TEL: 248-349-5234';
  GmailApp.sendEmail(SCHOOL_EMAIL, subject, adminTextBody,
    { replyTo: d.reply_to, name: SCHOOL_NAME });

  // 保護者向け: HTMLメール + 領収書PDF添付 + Zelle案内
  const parentSubject = '【申込受付完了】サマースクール - ' + d.parent_name + ' 様';
  const parentText =
d.parent_name + ' 様\n\nお申し込みありがとうございます。\n内容確認後、改めてご連絡いたします。\n\n' +
d.courses + '\n\n合計金額：' + d.total + '\n\n' +
'■ お支払いについて\n' +
'  Zelle 受取アドレス: ' + ZELLE_RECIPIENT_EMAIL + '\n' +
'  受取口座名: ' + ZELLE_RECIPIENT_NAME + '\n' +
'  お支払金額: ' + d.total + '\n' +
'  ※ U.S. Bank をご利用の場合は別途ご相談ください。\n\n' +
'■ 申込内容の控え（請求書）について\n' +
'  申込画面の「印刷 / PDF保存」ボタンから請求書として保存・印刷できます。\n' +
'  お支払い確認後、改めて領収書をメールにてお送りいたします。\n\n' +
SCHOOL_NAME + '\nTEL: 248-349-5234';

  const parentHtml = _buildEnrollmentEmailHtml(d);

  // 申込画面そのものが請求書フォーマットになっているため、保護者は申込画面の
  // 「🖨 印刷 / PDF保存」ボタンから自分で控えを取得できる設計（PDF添付しない）
  GmailApp.sendEmail(d.reply_to, parentSubject, parentText, {
    name: SCHOOL_NAME,
    htmlBody: parentHtml
  });
}

// ============================================================
// 保護者向け確認メールのHTML本文生成（Phase U-2 / Feature C）
// ============================================================
function _buildEnrollmentEmailHtml(d) {
  const navy = '#1b2a4a';
  const gold = '#c9a84c';
  const cream = '#faf8f3';

  // Zelle QRブロック（画像URLが設定されていれば画像、無ければテキストプレースホルダ）
  let qrBlock;
  if (ZELLE_QR_IMAGE_URL) {
    qrBlock =
      '<div style="text-align:center;margin:14px 0">' +
        '<img src="' + _esc(ZELLE_QR_IMAGE_URL) + '" alt="Zelle QR" style="max-width:200px;border:1px solid #ddd;padding:6px;background:#fff">' +
        '<div style="font-size:11px;color:#666;margin-top:6px">スマホでQRをスキャン → Zelleアプリが起動</div>' +
      '</div>';
  } else {
    qrBlock =
      '<div style="text-align:center;margin:14px 0;padding:20px;border:2px dashed #c9a84c;border-radius:6px;background:#fff7e0">' +
        '<div style="font-size:13px;color:#1b2a4a;font-weight:700">Zelle QRコード</div>' +
        '<div style="font-size:11px;color:#888;margin-top:6px">下記受取アドレスを Zelle アプリで指定してください</div>' +
      '</div>';
  }

  return '' +
'<div style="font-family:\'Hiragino Kaku Gothic Pro\',\'Yu Gothic\',sans-serif;max-width:640px;margin:0 auto;color:#333;line-height:1.7">' +
  '<div style="background:' + navy + ';color:#fff;padding:20px 24px;border-bottom:4px solid ' + gold + '">' +
    '<div style="font-size:18px;font-weight:700;letter-spacing:.05em">駿台ミシガン国際学院</div>' +
    '<div style="font-size:12px;opacity:.85;margin-top:2px">2026 Summer School / 受講申込受付完了</div>' +
  '</div>' +
  '<div style="padding:20px 24px;background:#fff">' +
    '<p style="margin:0 0 14px">' + _esc(d.parent_name) + ' 様</p>' +
    '<p style="margin:0 0 14px">この度はサマースクールへのお申し込みをいただき、誠にありがとうございます。<br>下記の内容で承りました。お支払いをもって正式受付となります。</p>' +
    '<div style="background:' + cream + ';border-left:3px solid ' + gold + ';padding:10px 14px;margin:14px 0">' +
      '<div style="font-size:11px;color:#888">申込日</div>' +
      '<div style="font-size:13px;color:' + navy + ';font-weight:700">' + _esc(d.submit_date) + '</div>' +
    '</div>' +
    '<div style="margin:18px 0 6px;font-size:13px;color:' + navy + ';font-weight:700;border-bottom:2px solid ' + navy + ';padding-bottom:4px">■ 申込内容</div>' +
    '<div style="font-size:12px;line-height:1.9;white-space:pre-wrap;background:#fff;border:1px solid #eee;padding:12px;border-radius:3px">' + _nl2br(d.courses) + '</div>' +
    '<div style="display:flex;justify-content:space-between;align-items:baseline;margin:16px 0;padding:10px 14px;background:#fff7e0;border-radius:3px">' +
      '<div style="font-size:13px;color:' + navy + ';font-weight:700">合計金額</div>' +
      '<div style="font-size:22px;color:' + gold + ';font-weight:700;font-family:Georgia,serif">' + _esc(d.total) + '</div>' +
    '</div>' +
    '<div style="margin:24px 0 6px;font-size:14px;color:' + navy + ';font-weight:700;border-bottom:2px solid ' + gold + ';padding-bottom:4px">■ お支払いはこちらから / Payment</div>' +
    '<p style="margin:8px 0;font-size:12px">Zelle (ゼル) でのお振込みをお願いいたします。下記の情報をご利用ください。</p>' +
    qrBlock +
    '<table style="width:100%;border-collapse:collapse;margin:8px 0;font-size:12px">' +
      '<tr><td style="padding:6px 8px;background:#f5f5f5;font-weight:600;width:38%;border:1px solid #eee">受取アドレス</td><td style="padding:6px 8px;border:1px solid #eee;font-family:monospace">' + _esc(ZELLE_RECIPIENT_EMAIL) + '</td></tr>' +
      '<tr><td style="padding:6px 8px;background:#f5f5f5;font-weight:600;border:1px solid #eee">受取口座名</td><td style="padding:6px 8px;border:1px solid #eee">' + _esc(ZELLE_RECIPIENT_NAME) + '</td></tr>' +
      '<tr><td style="padding:6px 8px;background:#f5f5f5;font-weight:600;border:1px solid #eee">お支払金額</td><td style="padding:6px 8px;border:1px solid #eee;font-weight:700">' + _esc(d.total) + '</td></tr>' +
    '</table>' +
    '<div style="margin:12px 0;padding:10px 12px;background:#fff3cd;border-left:3px solid #e65100;border-radius:3px;font-size:11px;color:#555;line-height:1.7">' +
      '<strong>U.S. Bank をご利用の方へ</strong><br>' +
      '一部のU.S. Bank の Zelle では金額制限や送金エラーが発生することがあります。エラー時は学校までご連絡ください。' +
    '</div>' +
    '<div style="margin:12px 0;padding:10px 12px;background:#f5f5f5;border-radius:3px;font-size:11px;color:#555;line-height:1.7">' +
      '<strong>Check（小切手）でお支払いの場合</strong><br>' +
      '宛名: ' + _esc(CHECK_PAYABLE_TO) + '<br>' +
      '送付先: ' + _esc(CHECK_MAIL_TO) +
    '</div>' +
    '<div style="margin:24px 0 6px;font-size:13px;color:' + navy + ';font-weight:700;border-bottom:2px solid ' + navy + ';padding-bottom:4px">■ 申込内容の控え（請求書）</div>' +
    '<p style="margin:8px 0;font-size:12px">申込画面の右上にある「印刷 / PDF保存」ボタンから、申込内容を請求書として PDF 保存・印刷していただけます。<br><strong>お支払い確認後、改めて領収書をメールにてお送りいたします。</strong></p>' +
  '</div>' +
  '<div style="background:' + navy + ';color:#fff;padding:14px 24px;font-size:11px;line-height:1.8">' +
    '<div style="font-weight:700;font-size:13px;margin-bottom:4px">' + _esc(SCHOOL_NAME) + '</div>' +
    'TEL: 248-349-5234 / Email: ' + _esc(ZELLE_RECIPIENT_EMAIL) +
  '</div>' +
'</div>';
}

// ============================================================
// 請求書PDFは生成しません。申込画面そのものが請求書フォーマットになっており、
// 保護者は画面の「🖨 印刷 / PDF保存」ボタンで自分で控えを取れる設計です。
// 領収書（入金確認後）は Phase U-6 で別途実装予定。
// ============================================================

// ============================================================
// メール送信（リクエスト）
// ============================================================
function sendRequestEmail(d) {
  GmailApp.sendEmail(SCHOOL_EMAIL,
    '【講座リクエスト】' + d.parent_name + ' 様',
    'お名前：' + d.parent_name + '\nメール：' + d.reply_to + '\n\n' + d.courses,
    { replyTo: d.reply_to, name: SCHOOL_NAME });

  GmailApp.sendEmail(d.reply_to,
    '【受付完了】講座リクエスト',
    d.parent_name + ' 様\n\nリクエストを受け付けました。\n\n' + SCHOOL_NAME,
    { name: SCHOOL_NAME });
}

// ============================================================
// レスポンスヘルパー
// ============================================================
function buildResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// google.script.run から呼ばれる関数
// ============================================================
function processEnrollment(data) {
  try {
    if (!_rateLimitOk('enroll_run', 500)) {
      return { status: 'error', message: '本日の申込受付上限に達しました。' };
    }
    const v = _validateEnrollment(data);
    if (v) return { status: 'error', message: v };
    saveEnrollment(data);
    sendEnrollmentEmail(data);
    return { status: 'ok', counts: getCourseCounts() };
  } catch (err) {
    console.error(err);
    return { status: 'error', message: 'サーバーエラーが発生しました' };
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
function onOpen() {
  SpreadsheetApp.getUi().createMenu('📊 サマースクール管理')
    .addItem('先生別時間割を出力（全体）', 'outputTimetable')
    .addItem('└ ターム別で出力', 'outputTimetableByTerm')
    .addItem('└ 先生別で出力', 'outputTimetableByTeacher')
    .addItem('講座別名簿を出力', 'outputRoster')
    .addItem('申込サマリーを出力', 'outputSummary')
    .addSeparator()
    .addItem('全レポートを一括出力', 'outputAll')
    .addItem('申込数集計を再計算', 'rebuildCourseCounts')
    .addSeparator()
    .addItem('💰 領収書発行（選択行）', 'sendReceiptForSelectedRow')
    .addItem('💰 領収書発行（複数選択行）', 'sendReceiptForMultipleRows')
    .addSeparator()
    .addItem('🔄 自動更新を有効化（最初に1回）', 'installAutoRefreshTrigger')
    .addToUi();
}

function outputAll() {
  outputTimetable();
  outputRoster();
  outputSummary();
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

      // 重いレポート3つはデバウンス付きで実行
      if (heavyOk) {
        props.setProperty('LAST_AUTO_FULL_REFRESH', String(now));
        try { outputRoster(true); }   catch (err) { console.warn('outputRoster:',   err && err.message); }
        try { outputSummary(true); }  catch (err) { console.warn('outputSummary:',  err && err.message); }
        try { outputTimetable(null, true); } catch (err) { console.warn('outputTimetable:', err && err.message); }
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
    '  • 先生別時間割（30秒デバウンス）\n\n' +
    '※ 短時間に複数回編集した場合、重いレポートは30秒待って一度だけ更新されます。\n' +
    '※ ターム別/先生別の時間割サブシートは自動更新しません（必要時にメニューから出力してください）。'
  );
}

// ============================================================
// 領収書発行（A案：手動／単一行・複数行両対応）
// 申込一覧シートで対象行を選択 → メニューから実行
// 「支払日」「領収書発行日」列を自動追加し、行ごとに記録
// ============================================================

// 申込一覧シートの列インデックス（1-indexed）。ヘッダから動的取得。
function _getEnrollColumnMap(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {};
  headers.forEach((h, i) => { map[String(h)] = i + 1; });
  return { headers: headers, map: map };
}

// 「支払日」「領収書発行日」列がなければ追加
function _ensurePaymentColumns(sheet) {
  const { headers, map } = _getEnrollColumnMap(sheet);
  let lastCol = sheet.getLastColumn();
  let paidCol = map['支払日'] || 0;
  let receiptCol = map['領収書発行日'] || 0;
  if (!paidCol) {
    lastCol += 1;
    paidCol = lastCol;
    sheet.getRange(1, paidCol).setValue('支払日')
      .setBackground('#1b2a4a').setFontColor('#fff').setFontWeight('bold');
  }
  if (!receiptCol) {
    lastCol += 1;
    receiptCol = lastCol;
    sheet.getRange(1, receiptCol).setValue('領収書発行日')
      .setBackground('#1b2a4a').setFontColor('#fff').setFontWeight('bold');
  }
  return { paidCol: paidCol, receiptCol: receiptCol };
}

// 単一行の領収書発行
function sendReceiptForSelectedRow() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  if (sheet.getName() !== S_ENROLL) {
    ui.alert('「' + S_ENROLL + '」シートで対象の行をクリックしてから実行してください');
    return;
  }
  const row = sheet.getActiveCell().getRow();
  if (row < 2) {
    ui.alert('対象の申込行をクリックしてから実行してください');
    return;
  }
  _processReceiptRows(sheet, [row], ui);
}

// 複数選択行の領収書発行（範囲選択時に対応）
function sendReceiptForMultipleRows() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  if (sheet.getName() !== S_ENROLL) {
    ui.alert('「' + S_ENROLL + '」シートで対象の行を選択してから実行してください');
    return;
  }
  const range = sheet.getActiveRange();
  const startRow = range.getRow();
  const numRows = range.getNumRows();
  const rows = [];
  for (let i = 0; i < numRows; i++) {
    const r = startRow + i;
    if (r >= 2) rows.push(r);
  }
  if (rows.length === 0) {
    ui.alert('対象の申込行を選択してください');
    return;
  }
  _processReceiptRows(sheet, rows, ui);
}

// 領収書発行の共通処理
function _processReceiptRows(sheet, rows, ui) {
  const { headers, map } = _getEnrollColumnMap(sheet);
  const colId = map['申込ID'];
  const colParent = map['保護者名'];
  const colEmail = map['メール'];
  const colStudents = map['生徒情報'];
  const colCourses = map['講座詳細'];
  const colTotal = map['合計金額'];

  if (!colParent || !colEmail || !colTotal) {
    ui.alert('申込一覧シートのヘッダ（保護者名/メール/合計金額）が見つかりません。');
    return;
  }

  const { paidCol, receiptCol } = _ensurePaymentColumns(sheet);

  // 確認ダイアログ
  const previews = rows.map(row => {
    const data = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
    return '行' + row + ': ' + (data[colParent - 1] || '?') + ' / ' + (data[colTotal - 1] || '?');
  }).join('\n');
  const confirmation = ui.alert(
    '領収書発行確認',
    rows.length + ' 件の申込に領収書を発行・送信します。\n\n' + previews + '\n\nよろしいですか？',
    ui.ButtonSet.YES_NO
  );
  if (confirmation !== ui.Button.YES) return;

  let success = 0, fail = 0;
  const errors = [];
  rows.forEach(row => {
    try {
      const data = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
      const enroll = {
        id: colId ? data[colId - 1] : '',
        parent_name: data[colParent - 1] || '',
        email: data[colEmail - 1] || '',
        students_info: colStudents ? data[colStudents - 1] : '',
        courses_text: colCourses ? data[colCourses - 1] : '',
        total: data[colTotal - 1] || ''
      };

      if (!enroll.email || !enroll.parent_name) {
        throw new Error('保護者名またはメールアドレスが空');
      }

      sendReceiptEmail(enroll);

      // 記録
      const today = new Date().toLocaleDateString('ja-JP');
      sheet.getRange(row, paidCol).setValue(today);
      sheet.getRange(row, receiptCol).setValue(today);

      success++;
      Utilities.sleep(800); // メール送信制限対策
    } catch (e) {
      fail++;
      errors.push('行' + row + ': ' + (e && e.message));
    }
  });

  let msg = '✅ ' + success + ' 件の領収書を発行・送信しました';
  if (fail > 0) {
    msg += '\n\n❌ ' + fail + ' 件失敗:\n' + errors.join('\n');
  }
  ui.alert(msg);
}

// 領収書メール送信（HTML本文）
function sendReceiptEmail(enroll) {
  const subject = '【領収書 / Receipt】サマースクール - ' + enroll.parent_name + ' 様';
  const html = _buildReceiptEmailHtml(enroll);
  const text = enroll.parent_name + ' 様\n\n受講料のご入金を確認いたしました。誠にありがとうございました。\n以下の通り、領収書を発行いたします。\n\n金額：' + enroll.total + '\n但し：2026年度サマースクール受講料として\n\n--\n' + SCHOOL_NAME + '\nTEL: 248-349-5234';

  GmailApp.sendEmail(enroll.email, subject, text, {
    name: SCHOOL_NAME,
    htmlBody: html
  });
}

// 領収書HTMLメール本文生成
function _buildReceiptEmailHtml(enroll) {
  const navy = '#1b2a4a';
  const gold = '#c9a84c';
  const today = new Date().toLocaleDateString('ja-JP');
  const receiptNo = 'R26-' + Date.now().toString().slice(-8);

  return '' +
'<div style="font-family:\'Hiragino Kaku Gothic Pro\',\'Yu Gothic\',sans-serif;max-width:640px;margin:0 auto;color:#333;line-height:1.7">' +
  '<div style="background:' + navy + ';color:#fff;padding:20px 24px;border-bottom:4px solid ' + gold + '">' +
    '<div style="font-size:18px;font-weight:700;letter-spacing:.05em">駿台ミシガン国際学院</div>' +
    '<div style="font-size:12px;opacity:.85;margin-top:2px">2026 Summer School / 領収書 Receipt</div>' +
  '</div>' +
  '<div style="padding:20px 24px;background:#fff">' +
    '<p style="margin:0 0 14px">' + _esc(enroll.parent_name) + ' 様</p>' +
    '<p style="margin:0 0 14px">受講料のご入金を確認いたしました。誠にありがとうございました。<br>下記の通り、正式に領収いたします。</p>' +
    '<div style="background:#faf8f3;border-left:3px solid ' + gold + ';padding:10px 14px;margin:14px 0">' +
      '<div style="font-size:11px;color:#888">発行日 / Date</div>' +
      '<div style="font-size:13px;color:' + navy + ';font-weight:700">' + _esc(today) + '</div>' +
      '<div style="font-size:11px;color:#888;margin-top:6px">領収書No</div>' +
      '<div style="font-size:13px;color:' + navy + ';font-weight:700;font-family:Georgia,serif">' + _esc(receiptNo) + '</div>' +
    '</div>' +
    '<div style="border:2px solid ' + navy + ';padding:18px 22px;margin:14px 0;background:#fff7e0">' +
      '<div style="font-size:11px;color:#666;letter-spacing:.1em;margin-bottom:6px">領収金額 / Amount Received</div>' +
      '<div style="font-size:30px;font-family:Georgia,serif;color:' + gold + ';font-weight:700;text-align:center">' + _esc(enroll.total) + '</div>' +
      '<div style="font-size:11px;color:#444;text-align:center;margin-top:8px;border-top:1px solid #ccc;padding-top:8px">但し: 2026年度サマースクール受講料として / Summer School 2026 Tuition Fee</div>' +
    '</div>' +
    (enroll.students_info ?
      '<div style="margin:14px 0 6px;font-size:13px;color:' + navy + ';font-weight:700;border-bottom:1px solid ' + navy + ';padding-bottom:4px">受講生徒 / Students</div>' +
      '<div style="font-size:12px;line-height:1.8">' + _esc(enroll.students_info) + '</div>'
    : '') +
    '<div style="margin:18px 0 6px;font-size:13px;color:' + navy + ';font-weight:700;border-bottom:1px solid ' + navy + ';padding-bottom:4px">受講内容 / Details</div>' +
    '<div style="font-size:11px;line-height:1.7;white-space:pre-wrap;background:#fafafa;border:1px solid #eee;padding:10px 12px;border-radius:3px">' + _nl2br(enroll.courses_text || '') + '</div>' +
    '<div style="margin:24px 0 8px;padding:10px 14px;background:#f5f5f5;border-radius:3px;font-size:11px;color:#555;line-height:1.7">' +
      '本書面をもちまして正式な領収書とさせていただきます。<br>' +
      'お問い合わせは下記までご連絡ください。' +
    '</div>' +
  '</div>' +
  '<div style="background:' + navy + ';color:#fff;padding:14px 24px;font-size:11px;line-height:1.8">' +
    '<div style="font-weight:700;font-size:13px;margin-bottom:4px">' + _esc(SCHOOL_NAME) + '</div>' +
    'TEL: 248-349-5234 / Email: ' + _esc(ZELLE_RECIPIENT_EMAIL) +
  '</div>' +
'</div>';
}

// ============================================================
// 講座別名簿出力
// ============================================================
function outputRoster(silent) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const courses = getCourses();
  const enrollSheet = ss.getSheetByName(S_ENROLL);

  const rosterMap = {};
  if (enrollSheet && enrollSheet.getLastRow() > 1) {
    const enrollData = enrollSheet.getDataRange().getValues();
    for (let i = 1; i < enrollData.length; i++) {
      const coursesText = String(enrollData[i][6]||'');
      const parent = String(enrollData[i][2]||'');
      const email  = String(enrollData[i][3]||'');
      const studentsInfo = String(enrollData[i][5]||'');

      coursesText.split('\n').forEach(line => {
        const m = line.match(/[・•]\s*(.+?)（(\d+)T/);
        if (!m) return;
        const courseName = m[1].trim();
        const term = m[2];
        const courseInfo = courses.find(c => c['講座名'] === courseName && String(c['ターム']) === term);
        if (!courseInfo) return;
        const key = term + '|' + courseInfo['時間帯'] + '|' + courseName;
        if (!rosterMap[key]) rosterMap[key] = [];
        rosterMap[key].push({ student: studentsInfo, parent, email });
      });
    }
  }

  let outSheet = ss.getSheetByName(S_ROSTER);
  if (outSheet) ss.deleteSheet(outSheet);
  outSheet = ss.insertSheet(S_ROSTER);

  const TIMES = ['9:00〜10:30','10:30〜12:00','12:30〜14:00','14:00〜15:30','15:30〜17:00'];
  const TERMS = [...new Set(courses.map(c => Number(c['ターム'])))].filter(Boolean).sort((a,b)=>a-b);

  let outRow = 1;
  outSheet.getRange(outRow, 1).setValue('講座別名簿');
  outSheet.getRange(outRow, 1, 1, 5).merge().setBackground('#1b2a4a').setFontColor('#fff')
    .setFontWeight('bold').setFontSize(13).setHorizontalAlignment('center');
  outRow += 2;

  TERMS.forEach(term => {
    const termCourses = courses.filter(c => Number(c['ターム']) === term);
    if (!termCourses.length) return;
    const termDate = termCourses[0]['日程']||'';
    outSheet.getRange(outRow, 1).setValue('▼ ' + term + '期（' + termDate + '）');
    outSheet.getRange(outRow, 1, 1, 5).merge().setBackground('#243860').setFontColor('#fff')
      .setFontWeight('bold').setFontSize(11);
    outRow++;

    TIMES.forEach(time => {
      const slotCourses = termCourses.filter(c => c['時間帯'] === time);
      if (!slotCourses.length) return;
      outSheet.getRange(outRow, 1).setValue('  ' + time);
      outSheet.getRange(outRow, 1, 1, 5).merge().setBackground('#c9a84c').setFontColor('#1b2a4a')
        .setFontWeight('bold').setFontSize(10);
      outRow++;

      const seenCourses = new Set();
      slotCourses.forEach(c => {
        const key = term + '|' + time + '|' + c['講座名'];
        if (seenCourses.has(key)) return;
        seenCourses.add(key);
        const students = rosterMap[key] || [];
        const maxS = c['定員'] || 12;
        outSheet.getRange(outRow, 1).setValue('    ' + c['担当先生'] + '：' + c['講座名'] + '（' + students.length + '/' + maxS + '名）');
        outSheet.getRange(outRow, 1, 1, 5).merge()
          .setBackground(students.length >= maxS ? '#fee2e2' : '#f0fdf4')
          .setFontWeight('bold').setFontSize(10);
        outRow++;

        if (students.length > 0) {
          outSheet.getRange(outRow, 1, 1, 4).setValues([['No.','生徒情報','保護者名','メール']]);
          outSheet.getRange(outRow, 1, 1, 4).setBackground('#f0ebe0').setFontWeight('bold').setFontSize(9);
          outRow++;
          students.forEach((s, idx) => {
            outSheet.getRange(outRow, 1, 1, 4).setValues([[idx+1, s.student, s.parent, s.email]]);
            if (idx % 2 === 1) outSheet.getRange(outRow, 1, 1, 4).setBackground('#faf8f3');
            outSheet.getRange(outRow, 1, 1, 4).setFontSize(9);
            outRow++;
          });
        } else {
          outSheet.getRange(outRow, 1).setValue('    （申込なし）');
          outSheet.getRange(outRow, 1, 1, 5).merge().setFontColor('#999').setFontSize(9);
          outRow++;
        }
      });
      outRow++;
    });
    outRow++;
  });

  outSheet.setColumnWidth(1, 40);
  outSheet.setColumnWidth(2, 200);
  outSheet.setColumnWidth(3, 120);
  outSheet.setColumnWidth(4, 200);
  outSheet.setColumnWidth(5, 80);
  ss.setActiveSheet(outSheet);
  if (!silent) SpreadsheetApp.getUi().alert('✅ 講座別名簿を出力しました！');
}

// ============================================================
// 申込サマリー出力
// ============================================================
function outputSummary(silent) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const enrollSheet = ss.getSheetByName(S_ENROLL);
  const courses = getCourses();
  const counts = getCourseCounts();

  let outSheet = ss.getSheetByName(S_SUMMARY);
  if (outSheet) ss.deleteSheet(outSheet);
  outSheet = ss.insertSheet(S_SUMMARY);

  const now = new Date().toLocaleString('ja-JP');
  let outRow = 1;
  outSheet.getRange(outRow,1).setValue('申込サマリー　出力：' + now);
  outSheet.getRange(outRow,1,1,6).merge().setBackground('#1b2a4a').setFontColor('#fff')
    .setFontWeight('bold').setFontSize(13);
  outRow++;

  let totalEnroll = 0, totalAmount = 0;
  if (enrollSheet && enrollSheet.getLastRow() > 1) {
    const data = enrollSheet.getDataRange().getValues();
    totalEnroll = data.length - 1;
    for (let i = 1; i < data.length; i++) {
      totalAmount += parseFloat(String(data[i][7]||'').replace('$','').replace(',',''))||0;
    }
  }

  outSheet.getRange(outRow,1,1,6).setValues([['申込件数: ' + totalEnroll + '件', '申込総額: $' + totalAmount.toFixed(0), '', '', '', '']]);
  outSheet.getRange(outRow,1,1,6).setBackground('#c9a84c').setFontColor('#1b2a4a').setFontWeight('bold').setFontSize(11);
  outRow += 2;

  const TIMES = ['9:00〜10:30','10:30〜12:00','12:30〜14:00','14:00〜15:30','15:30〜17:00'];
  const TERMS = [...new Set(courses.map(c => Number(c['ターム'])))].filter(Boolean).sort((a,b)=>a-b);

  TERMS.forEach(term => {
    const termCourses = courses.filter(c => Number(c['ターム']) === term);
    if (!termCourses.length) return;
    const termDate = termCourses[0]['日程']||'';
    outSheet.getRange(outRow,1).setValue(term + '期（' + termDate + '）');
    outSheet.getRange(outRow,1,1,6).merge().setBackground('#243860').setFontColor('#fff').setFontWeight('bold');
    outRow++;
    outSheet.getRange(outRow,1,1,6).setValues([['時間帯','先生','講座名','対象','定員','申込数']]);
    outSheet.getRange(outRow,1,1,6).setBackground('#f0ebe0').setFontWeight('bold').setFontSize(9);
    outRow++;

    TIMES.forEach(time => {
      const slotCourses = termCourses.filter(c => c['時間帯'] === time);
      const seen = new Set();
      slotCourses.forEach(c => {
        const key = c['講座名'] + '|' + term + '|' + time;
        if (seen.has(key)) return;
        seen.add(key);
        const cnt = counts[c['講座ID']] || 0;
        const maxS = c['定員'] || 12;
        outSheet.getRange(outRow,1,1,6).setValues([[time, c['担当先生'], c['講座名'], c['対象学年'], maxS, cnt]]);
        const bg = cnt >= maxS ? '#fee2e2' : cnt >= maxS*0.7 ? '#fff7ed' : '#fff';
        outSheet.getRange(outRow,1,1,6).setBackground(bg).setFontSize(9);
        outRow++;
      });
    });
    outRow++;
  });

  outSheet.setColumnWidth(1, 100);
  outSheet.setColumnWidth(2, 100);
  outSheet.setColumnWidth(3, 200);
  outSheet.setColumnWidth(4, 80);
  outSheet.setColumnWidth(5, 50);
  outSheet.setColumnWidth(6, 50);
  ss.setActiveSheet(outSheet);
  if (!silent) SpreadsheetApp.getUi().alert('✅ 申込サマリーを出力しました！');
}

// ============================================================
// 先生別時間割出力
// ============================================================
function outputTimetable(filter, silent) {
  // filter: { term?: number, teacher?: string } 指定時はそのターム/先生のみで出力
  // silent: true の場合は完了アラートを出さない（トリガーから呼ぶ時に使う）
  filter = filter || {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const courses = getCourses();
  const enrollSheet = ss.getSheetByName(S_ENROLL);

  const studentMap = {};
  if (enrollSheet && enrollSheet.getLastRow() > 1) {
    const rows = enrollSheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      const courseText   = String(rows[i][6] || '');
      const studentsInfo = String(rows[i][5] || '');
      const names = studentsInfo.split('、')
        .map(s => s.replace(/（[^）]*）/g, '').trim())
        .filter(Boolean);

      courseText.split('\n').forEach(line => {
        const m = line.match(/[・•]\s*(.+?)（(\d+)T/);
        if (!m) return;
        const cname = m[1].trim();
        const term  = m[2];
        const info  = courses.find(c => c['講座名'] === cname && String(c['ターム']) === term);
        if (!info) return;
        const key = term + '|' + info['時間帯'] + '|' + cname;
        if (!studentMap[key]) studentMap[key] = [];
        names.forEach(n => { if (!studentMap[key].includes(n)) studentMap[key].push(n); });
      });
    }
  }

  // フィルタに応じて出力先シート名を切替
  const sheetName = filter.term && filter.teacher
      ? S_TIMETABLE + '_' + filter.term + '期_' + filter.teacher
    : filter.term
      ? S_TIMETABLE + '_' + filter.term + '期'
    : filter.teacher
      ? S_TIMETABLE + '_' + filter.teacher
    : S_TIMETABLE;

  let out = ss.getSheetByName(sheetName);
  if (out) ss.deleteSheet(out);
  out = ss.insertSheet(sheetName);

  const TIMES = ['9:00〜10:30','10:30〜12:00','12:30〜14:00','14:00〜15:30','15:30〜17:00'];
  const TEACHER_ORDER = ['坂本先生','嶋中先生','ゆい先生','宮嶋先生','八反田先生','橋川先生'];
  const teachersInData = [...new Set(courses.map(c => c['担当先生']).filter(Boolean))];
  let TEACHERS = [
    ...TEACHER_ORDER.filter(t => teachersInData.includes(t)),
    ...teachersInData.filter(t => !TEACHER_ORDER.includes(t))
  ];
  let TERMS = [...new Set(courses.map(c => Number(c['ターム'])))].filter(Boolean).sort((a,b)=>a-b);
  // フィルタ適用
  if (filter.term)    TERMS    = TERMS.filter(t => t === Number(filter.term));
  if (filter.teacher) TEACHERS = TEACHERS.filter(t => t === filter.teacher);
  if (TERMS.length === 0) {
    if (!silent) SpreadsheetApp.getUi().alert('指定されたターム ' + filter.term + ' は存在しません');
    return;
  }
  if (TEACHERS.length === 0) {
    if (!silent) SpreadsheetApp.getUi().alert('指定された先生 ' + filter.teacher + ' は存在しません');
    return;
  }
  const TC = 6;

  function getTermDates(term) {
    const c = courses.find(c => Number(c['ターム']) === term);
    if (!c || !c['日程']) return ['月','火','水','木','金'];
    const m = String(c['日程']).match(/(\d+)\/(\d+)〜(\d+)/);
    if (!m) return ['月','火','水','木','金'];
    const dates = [];
    for (let d = +m[2]; d <= +m[3]; d++) dates.push(m[1] + '/' + d);
    return dates;
  }

  function getSlotInfo(teacher, term, time) {
    const slots = courses.filter(c =>
      c['担当先生'] === teacher && Number(c['ターム']) === term && c['時間帯'] === time);
    if (!slots.length) return null;
    const uniqueNames = [...new Set(slots.map(c => c['講座名']))];
    const label = uniqueNames.join(' / ');
    let students = [];
    uniqueNames.forEach(cname => {
      const key = term + '|' + time + '|' + cname;
      if (studentMap[key]) students = students.concat(studentMap[key]);
    });
    students = [...new Set(students)];
    const maxS = slots[0]['定員'] || 12;
    return { label, students, maxS };
  }

  function getBg(count, maxS) {
    if (count >= maxS)        return '#fee2e2';
    if (count >= maxS * 0.7)  return '#fff7ed';
    return '#f0fdf4';
  }

  const NAV_BG   = '#1b2a4a';
  const GOLD_BG  = '#c9a84c';
  const TIME_BG  = '#f0ebe0';
  const EMPTY_BG = '#f5f5f5';

  let outRow = 1;
  TERMS.forEach(term => {
    const termCourses = courses.filter(c => Number(c['ターム']) === term);
    if (!termCourses.length) return;
    const termTeachers = TEACHERS.filter(t => termCourses.some(c => c['担当先生'] === t));
    if (!termTeachers.length) return;
    const dates    = getTermDates(term);
    const termDate = termCourses[0]['日程'] || '';
    const totalCols = 1 + termTeachers.length * TC;

    out.getRange(outRow, 1, 1, totalCols).merge()
      .setValue(term + '期（' + termDate + '）')
      .setBackground(NAV_BG).setFontColor('#fff').setFontWeight('bold').setFontSize(12)
      .setHorizontalAlignment('center').setVerticalAlignment('middle');
    out.setRowHeight(outRow, 22);
    outRow++;

    out.getRange(outRow, 1).setValue('時間帯')
      .setBackground(NAV_BG).setFontColor('#fff').setFontWeight('bold')
      .setFontSize(9).setHorizontalAlignment('center');
    termTeachers.forEach((teacher, ti) => {
      const sc = 2 + ti * TC;
      out.getRange(outRow, sc, 1, TC).merge()
        .setValue(teacher)
        .setBackground(NAV_BG).setFontColor('#fff').setFontWeight('bold').setFontSize(11)
        .setHorizontalAlignment('center').setVerticalAlignment('middle');
    });
    out.setRowHeight(outRow, 22);
    outRow++;

    out.getRange(outRow, 1).setValue('').setBackground(GOLD_BG);
    termTeachers.forEach((teacher, ti) => {
      const sc = 2 + ti * TC;
      out.getRange(outRow, sc).setValue(term + '期')
        .setBackground(GOLD_BG).setFontColor(NAV_BG).setFontWeight('bold').setFontSize(9)
        .setHorizontalAlignment('center');
      dates.forEach((d, di) => {
        out.getRange(outRow, sc + 1 + di).setValue(d)
          .setBackground(GOLD_BG).setFontColor(NAV_BG).setFontWeight('bold').setFontSize(9)
          .setHorizontalAlignment('center');
      });
    });
    out.setRowHeight(outRow, 18);
    outRow++;

    TIMES.forEach(time => {
      const slotInfos = termTeachers.map(t => getSlotInfo(t, term, time));
      const maxStudentCount = Math.max(0, ...slotInfos.map(s => s ? s.students.length : 0));
      const studentRows = Math.max(maxStudentCount, 1);
      const blockRows   = 1 + studentRows;

      out.getRange(outRow, 1, blockRows, 1).merge()
        .setValue(time.replace('〜', '\n〜\n'))
        .setBackground(TIME_BG).setFontColor(NAV_BG).setFontWeight('bold').setFontSize(9)
        .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);

      termTeachers.forEach((teacher, ti) => {
        const sc   = 2 + ti * TC;
        const info = slotInfos[ti];

        if (!info) {
          out.getRange(outRow, sc, blockRows, TC).merge()
            .setBackground(EMPTY_BG);
        } else {
          const bg = info.students.length > 0 ? getBg(info.students.length, info.maxS) : '#ffffff';
          out.getRange(outRow, sc, 1, TC).merge()
            .setValue(info.label)
            .setBackground(bg).setFontColor(NAV_BG).setFontWeight('bold').setFontSize(10)
            .setHorizontalAlignment('left').setVerticalAlignment('middle').setWrap(true);

          for (let si = 0; si < studentRows; si++) {
            const sRow  = outRow + 1 + si;
            const sName = info.students[si] || '';
            out.getRange(sRow, sc).setValue(sName)
              .setBackground(bg).setFontSize(10).setVerticalAlignment('middle')
              .setWrap(false);
            dates.forEach((d, di) => {
              const cell = out.getRange(sRow, sc + 1 + di);
              if (sName) {
                cell.insertCheckboxes()
                  .setValue(true)
                  .setBackground('#e8f5e9')
                  .setHorizontalAlignment('center').setVerticalAlignment('middle')
                  .setFontSize(13);
              } else {
                cell.setBackground(bg);
              }
            });
          }
          if (info.students.length === 0) {
            out.getRange(outRow + 1, sc, 1, TC).setBackground('#fafafa');
          }
        }
      });

      out.setRowHeight(outRow, 22);
      for (let si = 0; si < studentRows; si++) {
        out.setRowHeight(outRow + 1 + si, 20);
      }
      outRow += blockRows;
    });

    out.getRange(outRow, 1, 1, 1 + termTeachers.length * TC)
      .setBackground('#cccccc');
    out.setRowHeight(outRow, 6);
    outRow++;
  });

  out.setColumnWidth(1, 65);
  const maxTC = TEACHERS.filter(t => courses.some(c => c['担当先生'] === t)).length;
  for (let ti = 0; ti < maxTC; ti++) {
    const sc = 2 + ti * TC;
    out.setColumnWidth(sc, 100);
    for (let d = 0; d < 5; d++) {
      out.setColumnWidth(sc + 1 + d, 55);
    }
  }
  out.setFrozenRows(3);
  ss.setActiveSheet(out);
  if (!silent) SpreadsheetApp.getUi().alert('✅ 先生別時間割を出力しました！');
}

// ============================================================
// 初期セットアップ
// ============================================================
function initialSetup() {
  DriveApp.getRootFolder();
  SpreadsheetApp.getActiveSpreadsheet();
  GmailApp.getAliases();

  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ADMIN_PASS')) {
    props.setProperty('ADMIN_PASS', ADMIN_PASS_FALLBACK);
    Logger.log('✅ ADMIN_PASS をスクリプトプロパティに設定しました');
  } else {
    Logger.log('✅ ADMIN_PASS は既にスクリプトプロパティに設定済みです');
  }
  Logger.log('✅ 初期セットアップ完了。');
}
