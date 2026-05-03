/**
 * lib_Util.gs
 * 共通ユーティリティ: XSS escape, 日付/通貨フォーマット, ランダム文字列, JSON 安全 parse
 *
 * 来歴: hoshuko_app より移植 (2026-05-03)。Phase 9-X の closure cache (getTz)
 *       を引き継ぎ。
 */

const Util = (function () {

  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function nowIso() {
    return Utilities.formatDate(new Date(), getTz(), "yyyy-MM-dd'T'HH:mm:ssXXX");
  }

  function todayStr() {
    return Utilities.formatDate(new Date(), getTz(), 'yyyy-MM-dd');
  }

  function formatDate(d) {
    if (!d) return '';
    if (typeof d === 'string') return d.length >= 10 ? d.substring(0, 10) : d;
    return Utilities.formatDate(d, getTz(), 'yyyy-MM-dd');
  }

  function formatDateTime(d) {
    if (!d) return '';
    if (typeof d === 'string') return d;
    return Utilities.formatDate(d, getTz(), "yyyy-MM-dd'T'HH:mm:ssXXX");
  }

  function formatCurrency(amount, currency) {
    if (amount === null || amount === undefined || amount === '') return '';
    var n = Number(amount);
    if (isNaN(n)) return String(amount);
    var prefix = '$';
    if (currency && currency !== 'USD') prefix = currency + ' ';
    return prefix + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function hashPassword(plain) {
    var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(plain || ''), Utilities.Charset.UTF_8);
    return bytes.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
  }

  function safeJsonParse(s, fallback) {
    if (!s) return (fallback === undefined ? null : fallback);
    try { return JSON.parse(s); } catch (e) { return (fallback === undefined ? null : fallback); }
  }

  function randomId(len) {
    len = len || 16;
    var s = '';
    var c = 'abcdefghijklmnopqrstuvwxyz0123456789';
    for (var i = 0; i < len; i++) s += c.charAt(Math.floor(Math.random() * c.length));
    return s;
  }

  /**
   * UUID v4 風 (G-2 アップロード ID 用)
   */
  function uuid() {
    return Utilities.getUuid();
  }

  /**
   * カタカナ → Romaji 変換 (簡易ヘボン式)
   */
  function katakanaToRomaji(input) {
    if (!input) return '';
    var s = String(input);
    var d = {
      'キャ':'kya','キュ':'kyu','キョ':'kyo','シャ':'sha','シュ':'shu','ショ':'sho',
      'チャ':'cha','チュ':'chu','チョ':'cho','ニャ':'nya','ニュ':'nyu','ニョ':'nyo',
      'ヒャ':'hya','ヒュ':'hyu','ヒョ':'hyo','ミャ':'mya','ミュ':'myu','ミョ':'myo',
      'リャ':'rya','リュ':'ryu','リョ':'ryo','ギャ':'gya','ギュ':'gyu','ギョ':'gyo',
      'ジャ':'ja', 'ジュ':'ju', 'ジョ':'jo', 'ビャ':'bya','ビュ':'byu','ビョ':'byo',
      'ピャ':'pya','ピュ':'pyu','ピョ':'pyo','ヂャ':'ja', 'ヂュ':'ju', 'ヂョ':'jo'
    };
    var m = {
      'ア':'a','イ':'i','ウ':'u','エ':'e','オ':'o',
      'カ':'ka','キ':'ki','ク':'ku','ケ':'ke','コ':'ko',
      'サ':'sa','シ':'shi','ス':'su','セ':'se','ソ':'so',
      'タ':'ta','チ':'chi','ツ':'tsu','テ':'te','ト':'to',
      'ナ':'na','ニ':'ni','ヌ':'nu','ネ':'ne','ノ':'no',
      'ハ':'ha','ヒ':'hi','フ':'fu','ヘ':'he','ホ':'ho',
      'マ':'ma','ミ':'mi','ム':'mu','メ':'me','モ':'mo',
      'ヤ':'ya','ユ':'yu','ヨ':'yo',
      'ラ':'ra','リ':'ri','ル':'ru','レ':'re','ロ':'ro',
      'ワ':'wa','ヲ':'wo','ン':'n',
      'ガ':'ga','ギ':'gi','グ':'gu','ゲ':'ge','ゴ':'go',
      'ザ':'za','ジ':'ji','ズ':'zu','ゼ':'ze','ゾ':'zo',
      'ダ':'da','ヂ':'ji','ヅ':'zu','デ':'de','ド':'do',
      'バ':'ba','ビ':'bi','ブ':'bu','ベ':'be','ボ':'bo',
      'パ':'pa','ピ':'pi','プ':'pu','ペ':'pe','ポ':'po',
      'ァ':'a','ィ':'i','ゥ':'u','ェ':'e','ォ':'o','ャ':'ya','ュ':'yu','ョ':'yo'
    };
    var out = '';
    var i = 0;
    while (i < s.length) {
      var c2 = s.substring(i, i + 2);
      if (d[c2]) { out += d[c2]; i += 2; continue; }
      var c = s[i];
      if (m[c]) {
        out += m[c];
      } else if (c === 'ッ' && i + 1 < s.length) {
        var nx2 = s.substring(i + 1, i + 3);
        var nxRom = d[nx2] || m[s[i + 1]];
        if (nxRom) out += nxRom[0];
      } else if (c === 'ー' && out.length) {
        out += out[out.length - 1];
      } else if (c === ' ' || c === '　') {
        out += ' ';
      } else {
        var cc = c.charCodeAt(0);
        if (cc >= 0x3041 && cc <= 0x3096) {
          var katakana = String.fromCharCode(cc + 0x60);
          if (m[katakana]) { out += m[katakana]; i++; continue; }
        }
        out += c;
      }
      i++;
    }
    return out.replace(/(^|\s)([a-z])/g, function (_, p, c) { return p + c.toUpperCase(); });
  }

  /**
   * タイムゾーン取得 (closure cache、Phase 9-X 性能修正)
   */
  var _tzCache = null;
  function getTz() {
    if (_tzCache !== null) return _tzCache;
    try {
      var sp = PropertiesService.getScriptProperties().getProperty('timezone');
      if (sp) { _tzCache = sp; return sp; }
    } catch (e) {}
    _tzCache = 'America/Detroit';
    return _tzCache;
  }

  function normalizeValue(value, type) {
    if (value === null || value === undefined || value === '') return '';
    switch (type) {
      case 'int':
        var n = parseInt(value, 10);
        return isNaN(n) ? '' : n;
      case 'float':
        var f = parseFloat(value);
        return isNaN(f) ? '' : f;
      case 'bool':
        if (value === true || value === 1 || value === '1') return 1;
        if (value === false || value === 0 || value === '0' || value === '') return 0;
        return value ? 1 : 0;
      case 'date':
        return formatDate(value);
      case 'datetime':
        if (value instanceof Date) return formatDateTime(value);
        return String(value);
      case 'json':
        if (typeof value === 'object') return JSON.stringify(value);
        return String(value);
      default:
        return String(value);
    }
  }

  function chunk(arr, size) {
    var out = [];
    for (var i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  return {
    escapeHtml: escapeHtml,
    esc: escapeHtml,
    nowIso: nowIso,
    todayStr: todayStr,
    formatDate: formatDate,
    formatDateTime: formatDateTime,
    formatCurrency: formatCurrency,
    katakanaToRomaji: katakanaToRomaji,
    hashPassword: hashPassword,
    safeJsonParse: safeJsonParse,
    randomId: randomId,
    uuid: uuid,
    getTz: getTz,
    normalizeValue: normalizeValue,
    chunk: chunk
  };
})();
