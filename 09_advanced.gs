// ============================================================
function getCoOccurrenceMatrix() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(S_ENROLL);
    if (!sheet || sheet.getLastRow() < 2) return { totalSamples: 0, pairs: {} };

    // 講座マスター（名前+ターム→ID）逆引き
    const allCourses = getCourses();
    const nameTermToId = {};
    allCourses.forEach(c => {
      if (c['講座ID'] && c['講座名'] != null && c['ターム'] != null) {
        nameTermToId[String(c['講座名']) + '|' + String(c['ターム'])] = String(c['講座ID']);
      }
    });

    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const colCourses = headers.indexOf('講座詳細');
    const colStudents = headers.indexOf('生徒情報');
    if (colCourses < 0) return { totalSamples: 0, pairs: {} };

    // 1申込×1生徒 ごとの「選択講座IDセット」を抽出
    const enrollSets = []; // [[id1,id2,id3,...], [id4,id5], ...]
    for (let i = 1; i < data.length; i++) {
      const text = String(data[i][colCourses] || '');
      // 「【N人目」で生徒を分割
      const studentBlocks = text.split(/【\d+人目/);
      studentBlocks.forEach(block => {
        const ids = [];
        block.split('\n').forEach(line => {
          if (/プレ講習/.test(line)) return;
          const m = line.match(/[・•]\s*(.+?)（(\d+)T/);
          if (!m) return;
          const id = nameTermToId[m[1].trim() + '|' + m[2]];
          if (id) ids.push(id);
        });
        if (ids.length >= 2) enrollSets.push(ids);
      });
    }

    if (enrollSets.length < 10) {
      return { totalSamples: enrollSets.length, pairs: {}, ready: false };
    }

    // ペア共起カウント
    const pairs = {}; // 'idA|idB' (sorted) -> count
    const idCount = {}; // id -> count
    enrollSets.forEach(ids => {
      ids.forEach(id => { idCount[id] = (idCount[id] || 0) + 1; });
      for (let a = 0; a < ids.length; a++) {
        for (let b = a + 1; b < ids.length; b++) {
          const k = [ids[a], ids[b]].sort().join('|');
          pairs[k] = (pairs[k] || 0) + 1;
        }
      }
    });

    // 各 id ごとの共起率上位3講座
    const recommendations = {};
    Object.keys(idCount).forEach(id => {
      const others = [];
      Object.keys(pairs).forEach(k => {
        const [a, b] = k.split('|');
        if (a === id || b === id) {
          const other = a === id ? b : a;
          const rate = pairs[k] / idCount[id];
          if (rate >= 0.20) others.push({ id: other, rate: rate, count: pairs[k] });
        }
      });
      others.sort((x, y) => y.rate - x.rate);
      recommendations[id] = others.slice(0, 3);
    });

    return { totalSamples: enrollSets.length, recommendations: recommendations, ready: true };
  } catch (e) {
    Logger.log('getCoOccurrenceMatrix error: ' + e.message);
    return { totalSamples: 0, pairs: {}, error: e.message };
  }
}

// ============================================================
// L: スキーマバージョン管理
// ============================================================
const CURRENT_SCHEMA_VERSION = '2026.05.01.0';

const SCHEMA_MIGRATIONS = {
  '2026.05.01.0': function() {
    // 初期マイグレーション（何もしない、ベースライン）
    Logger.log('Schema baseline 2026.05.01.0 initialized');
  }
  // 将来のマイグレーション例：
  // '2026.06.01.0': function() {
  //   const ss = SpreadsheetApp.getActiveSpreadsheet();
  //   if (!ss.getSheetByName(S_WAITING)) {
  //     const sh = ss.insertSheet(S_WAITING);
  //     sh.appendRow(['申込ID','登録日時','講座ID','講座名','生徒名','学年','保護者名','メール','電話','備考','ステータス']);
  //   }
  // }
};

// 起動時に呼ぶ。現在のバージョンと比較して必要なマイグレーションを実行
function runMigrations() {
  try {
    const props = PropertiesService.getScriptProperties();
    const currentVersion = props.getProperty('SCHEMA_VERSION') || '0.0.0';
    if (currentVersion === CURRENT_SCHEMA_VERSION) return;
    // バージョン文字列を比較しながら順次実行
    const versions = Object.keys(SCHEMA_MIGRATIONS).sort();
    for (const v of versions) {
      if (v > currentVersion && v <= CURRENT_SCHEMA_VERSION) {
        Logger.log('Running migration: ' + v);
        try { SCHEMA_MIGRATIONS[v](); } catch (e) { Logger.log('Migration ' + v + ' failed: ' + e.message); }
      }
    }
    props.setProperty('SCHEMA_VERSION', CURRENT_SCHEMA_VERSION);
    Logger.log('Schema updated to ' + CURRENT_SCHEMA_VERSION);
  } catch (e) {
    Logger.log('runMigrations error: ' + e.message);
  }
}

// 管理者用：手動でマイグレーション実行
function runMigrationsManually() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const before = props.getProperty('SCHEMA_VERSION') || '(未設定)';
  // 強制再実行のため、バージョンをリセット
  if (ui.alert('マイグレーション実行', '現在のバージョン: ' + before + '\n\n強制的に再実行しますか？', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  props.deleteProperty('SCHEMA_VERSION');
  runMigrations();
  const after = props.getProperty('SCHEMA_VERSION');
  ui.alert('完了', 'バージョン: ' + before + ' → ' + after, ui.ButtonSet.OK);
}

// ============================================================
// M: 校舎設定（学校設定シートを拡張して読み込み）
// 既存の getSettings() を活用、フロントから getMasterData 経由で取得
// ============================================================
// 校舎設定の標準項目（学校設定シートで上書き可能）
const SCHOOL_CONFIG_DEFAULTS = {
  '校舎名_日本語': '駿台ミシガン国際学院',
  '校舎名_英語': 'Sundai Michigan International Academy',
  '校舎名_略称': 'SMIA',
  '校舎電話': '248-349-5234',
  '校舎メール': 'michi-info@sundai-kaigai.jp',
  '校舎住所': '24277 Novi Rd, Novi, MI 48375',
  'Zelle口座名': 'Sundai USA, Inc. Novi, MI',
  'チェックあて先': 'Sundai USA, Inc.',
  'テーマカラー_メイン': '#1b2a4a',
  'テーマカラー_アクセント': '#c9a84c',
  'ロゴURL': '',
  'エンブレムURL': ''
};

function getSchoolConfig() {
  const settings = getSettings();
  const config = Object.assign({}, SCHOOL_CONFIG_DEFAULTS);
  Object.keys(SCHOOL_CONFIG_DEFAULTS).forEach(k => {
    if (settings[k] != null && String(settings[k]).trim() !== '') {
      config[k] = String(settings[k]).trim();
    }
  });
  return config;
}

// ============================================================
// G: ウェイティングリスト登録
// ============================================================