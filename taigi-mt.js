/*! taigi-mt.js — 台語翻譯系統 翻譯引擎 — © 2026 詹宗龍（臺中明道中學）保留一切權利。 */
/*
 * 獨立實作，不含第三方程式碼。詞庫見 dict.js（教育部《臺灣台語常用詞辭典》資料＋自編核心表）。
 * 流程：
 *   1. 整句記憶：輸入句與辭典例句的華語完全相同 → 直接用辭典台語例句。
 *   2. 斷詞對譯：以動態規劃找「詞越長越好」的切法，詞來源優先序 核心表 > 詞彙比較 > 例句短語 > 華台同形 > 義項。
 *   3. 小規則：句尾「了」→矣、「嗎」→無；句中「了」保留（liáu）。
 *   4. 標音：台語漢字再依辭典斷詞，查出臺羅（調符式），可另轉數字調。
 */
(function (root) {
  'use strict';
  var D = null, WSET = null, SENT = null, MAXK = 8;
  var BONUS = { c: 0.6, b: 0.5, s: 0.4, w: 0.3, g: 0.2, x: 0 };
  var HAN = /[㐀-鿿豈-﫿]|[\ud840-\ud87f][\udc00-\udfff]/;
  var PUNC = /[\s，。、！？；：「」『』（）()〔〕【】…—─,.!?;:"'~～\-]/g;

  function chars(s) { return Array.from(s); }
  function isHan(ch) { return HAN.test(ch); }
  function norm(s) { return (s || '').replace(PUNC, ''); }

  function init(dict) {
    D = dict;
    WSET = new Set(dict.w);
    SENT = new Map();
    dict.s.forEach(function (r) { SENT.set(norm(r[0]), r); });
  }

  // 一段連續漢字 → 詞列
  function segment(run) {
    var a = chars(run), n = a.length, best = new Array(n + 1), back = new Array(n + 1);
    best[0] = 0;
    for (var i = 1; i <= n; i++) best[i] = -1e9;
    for (var i = 0; i < n; i++) {
      if (best[i] <= -1e9) continue;
      for (var L = Math.min(MAXK, n - i); L >= 1; L--) {
        var k = a.slice(i, i + L).join(''), src = null;
        if (D.m[k]) src = D.m[k][0][1];
        else if (WSET.has(k) || D.t[k]) src = 'w';
        else if (L === 1) src = 'x';
        if (!src) continue;
        var sc = best[i] + L * L + BONUS[src];
        if (sc > best[i + L]) { best[i + L] = sc; back[i + L] = [i, k, src]; }
      }
    }
    var out = [], p = n;
    while (p > 0) { var b = back[p]; out.unshift({ zh: b[1], src: b[2] }); p = b[0]; }
    return out;
  }

  function candidates(zh) {
    var list = (D.m[zh] || []).map(function (c) { return { tg: c[0], src: c[1] }; });
    if (!list.some(function (c) { return c.tg === zh; })) list.push({ tg: zh, src: 'w' });
    return list;
  }

  // 台語漢字 → 臺羅（依辭典斷詞）
  function romanize(han) {
    var parts = [], buf = '';
    chars(han).forEach(function (ch) {
      if (isHan(ch)) buf += ch;
      else { if (buf) { parts.push([buf, 1]); buf = ''; } parts.push([ch, 0]); }
    });
    if (buf) parts.push([buf, 1]);
    var out = [];
    parts.forEach(function (p) {
      if (!p[1]) { out.push({ raw: p[0] }); return; }
      var a = chars(p[0]), n = a.length, best = [0], back = [];
      for (var i = 1; i <= n; i++) best[i] = -1e9;
      for (var i = 0; i < n; i++) {
        for (var L = Math.min(6, n - i); L >= 1; L--) {
          var k = a.slice(i, i + L).join(''), rd = D.t[k];
          var sc = best[i] + (rd ? L * L : -5);
          if (!rd && L > 1) continue;
          if (sc > best[i + L]) { best[i + L] = sc; back[i + L] = [i, k, rd || null]; }
        }
      }
      var seg = [], q = n;
      while (q > 0) { var b = back[q]; seg.unshift({ han: b[1], tl: b[2] }); q = b[0]; }
      seg.forEach(function (s) { out.push(s); });
    });
    return out;
  }

  function joinTL(segs) {
    var s = '';
    segs.forEach(function (g) {
      if (g.raw !== undefined) {
        var r = g.raw;
        if (/[，、]/.test(r)) r = ', '; else if (/[。]/.test(r)) r = '. ';
        else if (/[！]/.test(r)) r = '! '; else if (/[？]/.test(r)) r = '? ';
        else if (/[；]/.test(r)) r = '; '; else if (/[：]/.test(r)) r = ': ';
        else if (/\s/.test(r)) r = ' ';
        s = s.replace(/\s+$/, '') + r;
      } else {
        s += (g.tl || g.han) + ' ';
      }
    });
    return s.replace(/\s+([,.!?;:])/g, '$1').replace(/\s+--/g, '--').replace(/\s+/g, ' ').trim();
  }

  function translate(text) {
    text = (text || '').trim();
    if (!text) return { tokens: [], han: '', tl: '', memory: null };
    var mem = SENT.get(norm(text)) || null;
    var tokens = [];
    // 依非漢字切段
    var runs = [], buf = '';
    chars(text).forEach(function (ch) {
      if (isHan(ch)) buf += ch;
      else { if (buf) { runs.push([buf, 1]); buf = ''; } runs.push([ch, 0]); }
    });
    if (buf) runs.push([buf, 1]);
    runs.forEach(function (r, ri) {
      if (!r[1]) {
        var last = tokens[tokens.length - 1];
        if (last && last.raw && !/[\s，。、！？；：,.!?;:]/.test(r[0]) && !/[\s，。、！？；：,.!?;:]/.test(last.zh)) {
          last.zh += r[0]; last.tg = last.zh;
        } else tokens.push({ zh: r[0], tg: r[0], raw: true, alts: [] });
        return;
      }
      var segs = segment(r[0]);
      segs.forEach(function (s, si) {
        var alts = candidates(s.zh), pick = 0,
          endOfRun = segs.slice(si + 1).every(function (x) { return /^[嗎呢吧啊呀喔啦哦]$/.test(x.zh); });
        if (s.zh === '了') { alts = endOfRun ? [{ tg: '矣', src: 'c' }, { tg: '了', src: 'w' }] : [{ tg: '了', src: 'w' }, { tg: '矣', src: 'c' }]; }
        if (s.zh === '嗎' && !endOfRun) { alts = [{ tg: '嗎', src: 'w' }, { tg: '無', src: 'c' }]; }
        tokens.push({ zh: s.zh, tg: alts[pick].tg, src: alts[pick].src, alts: alts });
      });
    });
    return finish(tokens, mem);
  }

  function finish(tokens, mem) {
    var han = tokens.map(function (t) { return t.tg; }).join('');
    tokens.forEach(function (t) { t.tl = t.raw ? t.tg : joinTL(romanize(t.tg)); });
    return { tokens: tokens, han: han, tl: joinTL(romanize(han)), memory: mem };
  }

  // 調符 → 數字調
  var MARK = { '́': 2, '̀': 3, '̂': 5, '̄': 7, '̍': 8, '̋': 9, '̌': 6 };
  function toNumeric(s) {
    return (s || '').normalize('NFD').replace(/[A-Za-z̀-̏͘ⁿ]+/g, function (syl) {
      var t = 0, b = '';
      for (var i = 0; i < syl.length; i++) {
        var c = syl[i];
        if (MARK[c]) t = MARK[c]; else if (c === '͘') b += 'o'; else b += c;
      }
      if (!t) t = /[ptkh]$/i.test(b) ? 4 : 1;
      return b + t;
    }).normalize('NFC');
  }

  // 例句查詢：華語或台語含關鍵詞的辭典例句
  function examples(words, limit) {
    var out = [], seen = new Set();
    for (var i = 0; i < D.s.length && out.length < (limit || 5); i++) {
      var r = D.s[i];
      for (var j = 0; j < words.length; j++) {
        var w = words[j];
        if (w && chars(w).length >= 2 && (r[1].indexOf(w) >= 0) && !seen.has(r[1])) { out.push(r); seen.add(r[1]); break; }
      }
    }
    return out;
  }

  root.TaigiMT = { init: init, translate: translate, finish: finish, romanize: function (h) { return joinTL(romanize(h)); },
    toNumeric: toNumeric, examples: examples, candidates: candidates };
})(typeof window !== 'undefined' ? window : globalThis);
