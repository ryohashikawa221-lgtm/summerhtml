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
