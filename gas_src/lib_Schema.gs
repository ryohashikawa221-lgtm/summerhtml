/**
 * lib_Schema.gs (goudou_enshu_app)
 * 全シートの列定義・型・PK・タイムスタンプフラグの一元定義。
 * SheetDB が参照する真実の源 (single source of truth)。
 *
 * 来歴: 2026-05-03 新規作成 (hoshuko_app の Schema 構造を踏襲)。
 *
 * シート構成:
 *   - m_受験生_{校舎}    : 校舎別 受験生マスタ (LA/MI/NJ/NY/TX/HU の 6 タブ)
 *   - m_受験生_統合      : QUERY 関数で 6 校舎を縦結合 (Schema 管理外、read-only ビュー)
 *   - tx_申込            : G-1 申込フォーム受信ログ
 *   - tx_答案            : G-2 アップロード履歴
 *   - tx_採点            : 採点入力 + G-3 配信トリガー元
 *   - m_先生             : 教科 × 先生 × Drive フォルダマップ
 *   - m_設定             : key-value 設定 (= hoshuko の 学校設定 相当)
 *   - audit_log          : 全 API 呼び出しログ (lib_AuditLog.gs が書き込み)
 */

const Schema = (function () {

  // 校舎コード一覧 (Driveフォルダ命名 / 受験番号プレフィックス でも使用)
  const CAMPUSES = ['LA', 'MI', 'NJ', 'NY', 'TX', 'HU'];

  // 受験教科の妥当性チェック用 (学年 → 受験可能教科)
  // HANDOFF 注: 小6 は「数学」ではなく「算数」
  const SUBJECTS_BY_GRADE = {
    '中3': ['国語', '数学', '英語'],
    '小6': ['国語', '算数', '英語']
  };

  // 受験生マスタ 6 校舎共通列 (HANDOFF §3 表の列構造に準拠)
  const STUDENT_COLS = [
    { name: '受験番号', type: 'string' },        // 例: "MI-001" (logical PK)
    { name: '学年', type: 'string' },            // "小6" or "中3"
    { name: '氏名', type: 'string' },
    { name: '氏名カナ', type: 'string' },
    { name: '保護者メール', type: 'string' },    // G-2 URL 送付先 (必須)
    { name: '本人メール', type: 'string' },      // G-3 結果配信先 (空なら保護者宛のみ)
    { name: '受験教科', type: 'string' },        // カンマ区切り 例: "国語,数学,英語"
    { name: '備考', type: 'string' }
  ];

  /**
   * 受験生マスタの 1 校舎ぶん定義を返す (DRY のため動的生成)
   */
  function _studentSheetDef(campus) {
    return {
      name: 'm_受験生_' + campus,
      pk: '受験番号',
      hasId: false,         // string PK のため auto-id は使わない
      timestamps: false,    // 校舎担当者が手動編集する前提でタイムスタンプ列を持たない
      softDelete: false,
      cols: STUDENT_COLS
    };
  }

  const SHEETS = {
    STUDENTS_LA: _studentSheetDef('LA'),
    STUDENTS_MI: _studentSheetDef('MI'),
    STUDENTS_NJ: _studentSheetDef('NJ'),
    STUDENTS_NY: _studentSheetDef('NY'),
    STUDENTS_TX: _studentSheetDef('TX'),
    STUDENTS_HU: _studentSheetDef('HU'),

    // G-1: 申込フォーム受信ログ
    APPLICATIONS: {
      name: 'tx_申込',
      pk: 'id',
      hasId: true,
      timestamps: true,
      softDelete: false,
      cols: [
        { name: 'id', type: 'int' },
        { name: '申込日時', type: 'datetime' },
        { name: '校舎', type: 'string' },           // LA / MI / NJ / NY / TX / HU
        { name: '受験番号', type: 'string' },       // 校舎担当者が事前発番 or 後で採番
        { name: '学年', type: 'string' },           // 小6 / 中3
        { name: '氏名', type: 'string' },
        { name: '氏名カナ', type: 'string' },
        { name: '保護者メール', type: 'string' },
        { name: '本人メール', type: 'string' },
        { name: '受験教科', type: 'string' },       // カンマ区切り
        { name: 'ステータス', type: 'string' },     // 受付 / 確認メール送信済 / 承認済 / 取消
        { name: '確認メール送信日時', type: 'datetime' },
        { name: '備考', type: 'string' },
        { name: 'created_at', type: 'datetime' },
        { name: 'updated_at', type: 'datetime' }
      ]
    },

    // G-2: 答案アップロード履歴 (心臓部)
    UPLOADS: {
      name: 'tx_答案',
      pk: 'id',
      hasId: true,
      timestamps: true,
      softDelete: false,
      cols: [
        { name: 'id', type: 'int' },
        { name: 'アップロードID', type: 'string' },     // UUID
        { name: '校舎', type: 'string' },
        { name: '受験番号', type: 'string' },
        { name: '氏名', type: 'string' },               // キャッシュ
        { name: '学年', type: 'string' },               // キャッシュ (小6 / 中3)
        { name: '教科', type: 'string' },
        { name: 'ファイルID', type: 'string' },         // Drive file ID
        { name: 'ファイル名', type: 'string' },
        { name: 'ファイル種別', type: 'string' },       // pdf / image_merged / image
        { name: 'アップロード日時', type: 'datetime' },
        { name: 'ステータス', type: 'string' },         // active / superseded (再アップロード時の旧)
        { name: '採点済フラグ', type: 'bool' },
        { name: '合計点', type: 'float' },              // 採点後
        { name: '備考', type: 'string' },
        { name: 'created_at', type: 'datetime' },
        { name: 'updated_at', type: 'datetime' }
      ]
    },

    // G-3: 採点入力 (受験番号 × 教科 の長表) + 結果配信トリガー元
    GRADING: {
      name: 'tx_採点',
      pk: 'id',
      hasId: true,
      timestamps: true,
      softDelete: false,
      cols: [
        { name: 'id', type: 'int' },
        { name: '校舎', type: 'string' },
        { name: '受験番号', type: 'string' },
        { name: '氏名', type: 'string' },               // キャッシュ
        { name: '学年', type: 'string' },               // キャッシュ
        { name: '教科', type: 'string' },
        { name: '答案ファイルID', type: 'string' },     // 採点前 PDF (tx_答案 から populate)
        { name: '採点済ファイルID', type: 'string' },   // 採点後、自動移動先
        { name: '点数', type: 'float' },                // 先生が入力
        { name: '満点', type: 'float' },                // 教科ごとの満点 (m_設定 から)
        { name: '採点済フラグ', type: 'bool' },         // onEdit で auto
        { name: '採点日時', type: 'datetime' },
        { name: '採点者', type: 'string' },             // Session email
        { name: '所見', type: 'string' },               // 任意 (空なら G-3 メールで非表示)
        { name: '順位', type: 'int' },                  // G-3 配信前に algo で算出
        { name: '配信済フラグ', type: 'bool' },         // G-3 一斉配信後
        { name: '配信日時', type: 'datetime' },
        { name: '備考', type: 'string' },
        { name: 'created_at', type: 'datetime' },
        { name: 'updated_at', type: 'datetime' }
      ]
    },

    // 教科 × 先生 × Drive フォルダマップ (G-2 振り分け先 / G-3 採点済移動先)
    TEACHERS: {
      name: 'm_先生',
      pk: 'id',
      hasId: true,
      timestamps: true,
      softDelete: false,
      cols: [
        { name: 'id', type: 'int' },
        { name: '教科', type: 'string' },               // 国語 / 数学 / 算数 / 英語
        { name: '学年', type: 'string' },               // 中3 / 小6
        { name: '先生', type: 'string' },               // 表示用
        { name: '提出済フォルダID', type: 'string' },   // Drive folder ID (G-2 振り分け先)
        { name: '採点済フォルダID', type: 'string' },   // Drive folder ID (G-3 移動先)
        { name: '備考', type: 'string' },
        { name: 'created_at', type: 'datetime' },
        { name: 'updated_at', type: 'datetime' }
      ]
    },

    // key-value 設定 (= hoshuko の SETTINGS と同形)
    SETTINGS: {
      name: 'm_設定',
      pk: 'id',
      hasId: true,
      timestamps: false,
      softDelete: false,
      cols: [
        { name: 'id', type: 'int' },
        { name: 'key', type: 'string' },
        { name: 'value', type: 'string' },
        { name: 'description', type: 'string' },
        { name: 'updated_at', type: 'datetime' }
      ]
    },

    // 監査ログ (lib_AuditLog.gs が書き込み)
    AUDIT_LOG: {
      name: 'audit_log',
      pk: 'id',
      hasId: true,
      timestamps: false,
      softDelete: false,
      cols: [
        { name: 'id', type: 'int' },
        { name: 'timestamp', type: 'datetime' },
        { name: 'user', type: 'string' },
        { name: 'action', type: 'string' },
        { name: 'target_sheet', type: 'string' },
        { name: 'target_id', type: 'string' },
        { name: 'before', type: 'string' },
        { name: 'after', type: 'string' },
        { name: 'note', type: 'string' }
      ]
    }
  };

  return {
    SHEETS: SHEETS,
    CAMPUSES: CAMPUSES,
    SUBJECTS_BY_GRADE: SUBJECTS_BY_GRADE,
    STUDENT_COLS: STUDENT_COLS,

    all: function () {
      return Object.keys(SHEETS).map(function (k) { return SHEETS[k]; });
    },

    columnNames: function (sheetKey) {
      const s = SHEETS[sheetKey];
      if (!s) throw new Error('Schema not found: ' + sheetKey);
      return s.cols.map(function (c) { return c.name; });
    },

    keyByName: function (sheetName) {
      for (var k in SHEETS) {
        if (SHEETS[k].name === sheetName) return k;
      }
      return null;
    },

    /**
     * 校舎コードから 受験生マスタのシート名を返す
     * @param {string} campus 'LA' | 'MI' | ...
     */
    studentSheetName: function (campus) {
      if (CAMPUSES.indexOf(campus) === -1) {
        throw new Error('未知の校舎コード: ' + campus + ' (期待: ' + CAMPUSES.join('/') + ')');
      }
      return 'm_受験生_' + campus;
    },

    /**
     * 受験番号 (例: "MI-001") から 校舎コードを抽出
     */
    campusOfStudentId: function (studentId) {
      var m = String(studentId || '').match(/^([A-Z]{2})-/);
      if (!m) return null;
      return CAMPUSES.indexOf(m[1]) >= 0 ? m[1] : null;
    },

    /**
     * 学年 + 受験教科リストの妥当性チェック
     * @param {string} grade '小6' | '中3'
     * @param {string[]} subjects ['国語', '数学'] etc
     * @return {{valid: boolean, invalid: string[]}}
     */
    validateSubjects: function (grade, subjects) {
      var allowed = SUBJECTS_BY_GRADE[grade] || [];
      var invalid = subjects.filter(function (s) { return allowed.indexOf(s) === -1; });
      return { valid: invalid.length === 0, invalid: invalid };
    }
  };
})();
