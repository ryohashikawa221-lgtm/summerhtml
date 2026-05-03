/**
 * lib_Lock.gs
 * LockService ラッパ。同時編集による行競合・ID 重複を防ぐ。
 *
 * 来歴: hoshuko_app より移植 (2026-05-03)。
 *
 * 使用例:
 *   const result = Lock.withLock(function () {
 *     return SheetDB.insert('tx_答案', payload);
 *   });
 */

const Lock = (function () {

  var _depth = 0;

  function withLock(fn, waitMs) {
    if (_depth > 0) {
      _depth++;
      try { return fn(); } finally { _depth--; }
    }
    var lock = LockService.getScriptLock();
    var ms = waitMs || 5000;
    try {
      lock.waitLock(ms);
    } catch (e) {
      throw new Error('処理が混雑しています。少し待って再度お試しください。(' + e.message + ')');
    }
    _depth = 1;
    try {
      return fn();
    } finally {
      _depth = 0;
      try { lock.releaseLock(); } catch (e) {}
    }
  }

  function tryAcquireKey(key, ttlSec) {
    var props = PropertiesService.getScriptProperties();
    var existing = props.getProperty('lock:' + key);
    var now = Math.floor(Date.now() / 1000);
    if (existing && Number(existing) > now) return false;
    props.setProperty('lock:' + key, String(now + (ttlSec || 30)));
    return true;
  }

  function releaseKey(key) {
    PropertiesService.getScriptProperties().deleteProperty('lock:' + key);
  }

  return {
    withLock: withLock,
    tryAcquireKey: tryAcquireKey,
    releaseKey: releaseKey
  };
})();
