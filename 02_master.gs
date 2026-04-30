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
    statuses: getEnrollmentStatuses(),
    schoolConfig: getSchoolConfig()
  };
}

