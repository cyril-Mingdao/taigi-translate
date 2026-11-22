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
  var D = null, SENT = null, IT = null, ITR = {}, MAXK = 8;
  var BONUS = { c: 0.6, p: 0.55, e: 0.52, b: 0.5, s: 0.4, w: 0.3, f: 0.25, g: 0.2, x: 0 };
  var HAN = /[㐀-鿿豈-﫿]|[\ud840-\ud87f][\udc00-\udfff]/;
  var PUNC = /[\s，。、！？；：「」『』（）()〔〕【】…—─,.!?;:"'~～\-]/g;

  function chars(s) { return Array.from(s); }
  function isHan(ch) { return HAN.test(ch); }
  function norm(s) { return (s || '').replace(PUNC, ''); }

  // v15：詞庫以純文字壓縮傳送（build_dict.py），這裡還原成物件
  function unpack(dict) {
    if (typeof dict.m === 'string') {
      var m = {};
      dict.m.split('\n').forEach(function (line) {
        var i = line.indexOf('\t');
        m[line.slice(0, i)] = line.slice(i + 1).split('|').map(function (c) { return [c.slice(0, -1), c.slice(-1)]; });
      });
      dict.m = m;
    }
    if (typeof dict.t === 'string') {
      var t = {};
      dict.t.split('\n').forEach(function (line) { var i = line.indexOf('\t'); t[line.slice(0, i)] = line.slice(i + 1); });
      (dict.td ? dict.td.split(',') : []).forEach(function (h) { t[h] = chars(h).map(function (c) { return t[c]; }).join('-'); });
      dict.t = t; delete dict.td;
    }
    return dict;
  }

  function init(dict) {
    D = unpack(dict);
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
        else if (D.t[k]) src = 'w';
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

  // v25 辭典例句短語（來源 s）若是「詞＋詞」（一起去→鬥陣來去），拆成兩個詞，各自可換講法（一起→鬥陣／做伙）
  //   條件：短語與譯文本身都不是辭典詞目；前半講法是前一詞的候選；後半是後一詞的候選（或是辭典詞、且前一詞有兩種以上講法）。拆完譯文不變。
  function splitPhrase(s) {
    if (s.src !== 's') return [s];
    var a = chars(s.zh), tg = D.m[s.zh][0][0];
    if (D.t[s.zh] || D.t[tg]) return [s];   // 本身是辭典詞目（生活、開始、上好…）就不拆
    for (var i = a.length - 1; i >= 1; i--) {
      var A = a.slice(0, i).join(''), B = a.slice(i).join('');
      if (!D.m[A] || !D.m[B]) continue;
      if (a.length === 2 && D.m[A].filter(function (c) { return c[1] === 'c'; }).length < 2) continue;  // 兩字詞（家父、雞湯）只拆「很、一起」這類有多種講法的字
      var ca = candidates(A), cb = candidates(B);
      for (var j = 0; j < ca.length; j++) {
        var X = ca[j].tg;
        if (!X || tg.indexOf(X) !== 0 || X.length >= tg.length) continue;
        var Y = tg.slice(X.length), inB = cb.some(function (c) { return c.tg === Y; });
        if (!inB && (ca.length < 2 || !D.t[Y])) continue;
        return [{ zh: A, src: ca[j].src, fix: X }, { zh: B, src: inB ? cb.filter(function (c) { return c.tg === Y; })[0].src : 's', fix: Y }];
      }
    }
    return [s];
  }

  function candidates(zh) {
    var list = (D.m[zh] || []).map(function (c) { return { tg: c[0], src: c[1] }; });
    if (!list.some(function (c) { return c.tg === zh; })) list.push({ tg: zh, src: 'w' });
    // v10：iTaigi 愛台語（網友共筆）只附加在最後，永遠不當預設
    (IT && IT[zh] || []).forEach(function (c) { if (!list.some(function (x) { return x.tg === c[0]; })) list.push({ tg: c[0], src: 'i' }); });
    return list;
  }

  // 台語漢字 → 臺羅（依辭典斷詞）
  function romanize(han, extra) {
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
          var k = a.slice(i, i + L).join(''), rd = D.t[k] || (extra && extra[k]);
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

  // v25 「我們」→ 咱（包含聽者）／阮（無包含聽者），依教育部《臺灣台語常用詞辭典》用法與例句情境判斷
  //   咱：邀約、提議（一起、好不好、吧、我們來…）、共同處境、一般道理（做人、俗話、我們的國家／健康）
  //   阮：對外人講「我們家／公司／學校／這裡…」、我方團體、對「你／你們」講、敘述自己的經歷
  //   用教育部例句 536 句含「我們」測試：判對 84%（v24 一律阮只有 31%）；判不出來時用咱（例句裡較常見）
  function lanGuan(sent, at) {
  // sent: 該句華語；at: 「我們」在句中的位置
  var after = sent.slice(at + 2), before = sent.slice(0, at);
  var s = 0;
  // 包含聽者：邀約、提議、共同處境、一般道理
  if (/一起|一塊|一同|做伙|咱/.test(sent)) s += 3;
  if (/好不好|好嗎|好吧|如何[？?]|怎麼樣[？?]|吧[！!。？?]?$|吧[，,]|囉|喔[！!]?$/.test(sent)) s += 3;
  if (/^(來|去|再|先|就|趕快|趕緊|快|該|應該|得|要不要|一定要|必須|千萬|不要|別|不可|不能|不用|可以|最好|都是|都|是|做人|做事|做兒女|人類|大家|自己)/.test(after)) s += 2;
  if (/^(來|去)(看|吃|玩|走|試|比|找|買)/.test(after)) s += 1;
  if (/讓我們|俗話|俗語|人家說|有道是|人生|人活|做人|世上/.test(sent)) s += 3;
  if (/^(兩個|兩人|倆)(來|可以|要|一起|互相)/.test(after)) s += 3;
  // 排除聽者：對外人講「我們的…」、我方團體、對「你／你們」講
  if (/^(家|家裡|家的|公司|學校|店|店裡|老師|老闆|班|村|村子|鄉下|這裡|這兒|這邊|這些|這群|這個|這次|這幾|這班|那裡|那兒|那邊|那個|那班|那|全家|一家|一群|夫妻|兩個|三個|幾個|兄妹|總經理|董事長|師母|房東|鄰居|工頭|祖先|小妹|老大|里|屏東|台南|臺南)/.test(after)) s -= 3;
  if (/^的?(國家|健康|習俗|信心|想法|社會|地球|環境|母語|文化|臺灣|台灣|祖國|土地|身體|生活|下一代|子孫|孩子)/.test(after)) s += 4;
  if (/^(之間|倆|兩人的|兩個人的)|我們(認識|見過|可曾|是不是)/.test(sent.slice(at))) s += 4;
  if (/^的/.test(after)) s -= 1;
  if (/^[媽爸阿].{0,3}[，,]/.test(sent)) s -= 2;
  if (/你們|妳們|您們/.test(sent)) s -= 3;
  else if (/[你妳您]/.test(sent)) s -= 1;
  if (/(帶|教|叫|請|給|幫|讓|跟|和|對|找)我們$/.test(before) && !/讓我們$/.test(before)) s -= 1;
  if (/以前|小時候|過去|那時|當年|曾經|上個|去年|昨天|剛剛|經常|常常/.test(sent)) s -= 1;
  return s > 0 ? '咱' : s < 0 ? '阮' : null;
}

  // v9 上下文規則
  //  1. 名詞／動詞講法不同（D.nv：習慣→名詞「習慣」、動詞「慣勢」）
  //  2. 華語「形容詞＋一點／一些」→ 台語「較＋形容詞＋一點仔」（睡晚一點→睏較晏一點仔）
  var VERB_PREV = /^(我|你|妳|您|他|她|它|牠|我們|你們|妳們|他們|她們|咱們|大家|自己|誰|人|也|都|還|還是|很|非常|不|沒|沒有|別|會|要|想|能|可以|應該|已經|漸漸|慢慢|比較|更|最|常|常常|一直|一定|開始|正在|在|再|又|才|就|只|快|不太|太|不會|不要|不想)$/;
  var NOUN_PREV = /^(的|這|那|這個|那個|這種|那種|個|種|好|壞|新|舊|一個|一種|些|有|沒有的|養成|改掉|改變|生活|飲食|老)$/;
  var MORE = /^(一點|一點點|一些|點)$/;
  function grammar(tokens) {
    var ADJ = D.adj ? (D._adjSet || (D._adjSet = new Set(D.adj))) : null;
    // v25 咱／阮：以所在句子（到。！？為止）判斷
    var full = '', pos = [];
    tokens.forEach(function (t) { pos.push(full.length); full += t.zh; });
    tokens.forEach(function (t, i) {
      if (t.raw || t.zh !== '我們') return;
      var st = 0, k;
      for (k = pos[i] - 1; k >= 0; k--) if (/[。！？!?\n]/.test(full[k])) { st = k + 1; break; }
      var m = /[。！？!?\n]/.exec(full.slice(pos[i])), en = m ? pos[i] + m.index + 1 : full.length;
      var want = lanGuan(full.slice(st, en), pos[i] - st) || '咱', other = want === '咱' ? '阮' : '咱';
      t.alts = [{ tg: want, src: 'c' }, { tg: other, src: 'c' }].concat(t.alts.filter(function (a) { return a.tg !== want && a.tg !== other; }));
      t.tg = want; t.src = 'c';
    });
    tokens.forEach(function (t, i) {
      if (t.raw) return;
      var nv = D.nv && D.nv[t.zh];
      if (nv) {
        var prev = tokens[i - 1], next = tokens[i + 1];
        var pz = prev && !prev.raw ? prev.zh : '', nz = next && !next.raw ? next.zh : '';
        var verb = NOUN_PREV.test(pz) ? false : (VERB_PREV.test(pz) || /^(了|過|著|就|得)$/.test(nz));
        var want = verb ? nv[1] : nv[0], other = verb ? nv[0] : nv[1];
        t.alts = [{ tg: want, src: 'c' }, { tg: other, src: 'c' }].concat(t.alts.filter(function (a) { return a.tg !== want && a.tg !== other; }));
        t.tg = want; t.src = 'c';
      }
    });
    if (!ADJ) return;
    for (var i = tokens.length - 1; i > 0; i--) {
      var t = tokens[i], p = tokens[i - 1], pp = tokens[i - 2];
      if (t.raw || p.raw || !MORE.test(t.zh) || !ADJ.has(p.tg) || /^(差|有|一)$/.test(p.zh)) continue;  // 差一點＝幾乎
      var nx = tokens[i + 1];  // 「醃一點鹽」：一點後面接名詞＝數量，不是比較
      if (nx && !nx.raw && !/^(啦|吧|嘛|喔|哦|啊|呀|好|了|再|才|就|以後|之後|的話|嗎|呢|咧|較)$/.test(nx.zh)) continue;
      if (pp && !pp.raw && /^(較|閣較|傷|足|真|誠|上)$/.test(pp.tg)) continue;
      tokens.splice(i - 1, 0, { zh: '', tg: '較', src: 'c', alts: [{ tg: '較', src: 'c' }, { tg: '', src: 'c' }] });
    }
  }

  // 不套正反問句規則：是不是（教育部用「是毋是」，由詞表處理）、動不動、好死不死…
  var QSKIP = /^(是|動|死|得|管|理|三|二)$/;

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
      // v22 正反問句：問句裡的「A不A／A沒A」→「A…無？」（教育部例句慣例：有入選無、欲鬥陣來去無、好無）
      var after = runs.slice(ri + 1).map(function (x) { return x[0]; }).join('');
      var isQ = /^\s*[？?]/.test(after) || !chars(after).some(isHan) &&!/[。！!.，,；;]/.test(after);
      var qm = isQ && r[0].match(/([㐀-鿿]{1,2})([不沒])\1/);
      if (qm && QSKIP.test(qm[1])) qm = null;
      var tail = null;
      if (qm) {
        r = [r[0].slice(0, qm.index) + qm[1] + r[0].slice(qm.index + qm[0].length), 1];
        var neg = /^會/.test(qm[1]) ? '袂' : '無';
        tail = { zh: qm[2] + qm[1], tg: neg, src: 'c', q: true, alts: [{ tg: neg, src: 'c' }, { tg: neg === '無' ? '袂' : '無', src: 'c' }] };
      } else if (isQ && /.了嗎$/.test(r[0])) {  // 吃飽了嗎→食飽未、寫完了嗎→寫了未
        r = [r[0].slice(0, -2), 1];
        tail = { zh: '了嗎', tg: '未', src: 'c', q: true, alts: [{ tg: '未', src: 'c' }, { tg: '矣無', src: 'c' }] };
      }
      var segs = [];
      segment(r[0]).forEach(function (x) { segs = segs.concat(splitPhrase(x)); });
      segs.forEach(function (s, si) {
        var alts = candidates(s.zh), pick = 0,
          endOfRun = segs.slice(si + 1).every(function (x) { return /^[嗎呢吧啊呀喔啦哦]$/.test(x.zh); });
        if (s.zh === '了') { alts = endOfRun ? [{ tg: '矣', src: 'c' }, { tg: '了', src: 'w' }] : [{ tg: '了', src: 'w' }, { tg: '矣', src: 'c' }]; }
        if (s.zh === '嗎' && !endOfRun) { alts = [{ tg: '嗎', src: 'w' }, { tg: '無', src: 'c' }]; }
        if (s.zh === '嗎' && endOfRun && alts[0].tg === '無') { tokens.push({ zh: s.zh, tg: '無', src: alts[0].src, q: true, alts: alts }); return; }  // 好嗎→好無 hó--bô
        if (tail && s.zh === '對' && si === segs.length - 1) { alts = [{ tg: '著', src: 'c' }].concat(alts.filter(function (a) { return a.tg !== '著'; })); }  // 對不對→著無
        if (s.fix) {  // v25 拆開的短語：維持原短語的譯法排第一
          var fx = alts.filter(function (a) { return a.tg === s.fix; })[0] || { tg: s.fix, src: s.src };
          alts = [fx].concat(alts.filter(function (a) { return a !== fx; }));
        }
        tokens.push({ zh: s.zh, tg: alts[pick].tg, src: alts[pick].src, alts: alts });
      });
      if (tail) tokens.push(tail);
    });
    grammar(tokens);
    return finish(tokens, mem);
  }

  function finish(tokens, mem) {
    var han = tokens.map(function (t) { return t.tg; }).join('');
    var extra = null;  // 選了 iTaigi 講法時，才用 iTaigi 的讀音（教育部查無的詞）
    tokens.forEach(function (t) { if (t.src === 'i' && ITR[t.tg]) (extra = extra || {})[t.tg] = ITR[t.tg]; });
    tokens.forEach(function (t) { t.tl = t.raw ? t.tg : joinTL(romanize(t.tg, extra)); });
    // v22 正反問句句尾「無／袂」讀輕聲：hó--bô、ē--bē（整句分段羅馬字化，句尾接 --）
    var segs = [], part = '';
    tokens.forEach(function (t) {
      var neu = t.q && { '無': 'bô', '袂': 'bē', '未': 'bē' }[t.tg];
      if (neu) {
        segs = segs.concat(romanize(part, extra)); part = '';
        segs.push({ tl: '--' + neu });
        t.tl = '--' + neu;
      } else part += t.tg;
    });
    segs = segs.concat(romanize(part, extra));
    return { tokens: tokens, han: han, tl: joinTL(segs), memory: mem };
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

  // v7：教育部例句（sent.js）背景載入後補進來；主詞庫裡的教材／老師指定整句優先，不被蓋掉
  function addSentences(list) {
    (list || []).forEach(function (r) { var k = norm(r[0]); if (!SENT.has(k)) SENT.set(k, r); });
    D.s = D.s.concat(list || []);
  }

  // v10：iTaigi 愛台語華台對照典（itaigi.js，背景載入）
  function addItaigi(map) {
    IT = map || {};
    Object.keys(IT).forEach(function (zh) { IT[zh].forEach(function (c) { if (c[1]) ITR[c[0]] = c[1]; }); });
  }

  // 原文裡跨詞的 iTaigi 詞組（≥2 字、不是剛好一個斷詞），最長優先、不重疊；只供參考顯示
  function itaigiHints(text, tokens) {
    if (!IT) return [];
    var single = new Set((tokens || []).map(function (t) { return t.zh; }));
    var a = chars(norm(text)), out = [], i = 0;
    while (i < a.length) {
      var hit = 0;
      for (var L = Math.min(10, a.length - i); L >= 2; L--) {
        var k = a.slice(i, i + L).join('');
        if (IT[k] && !single.has(k)) { out.push([k, IT[k].slice(0, 3)]); hit = L; break; }
      }
      i += hit || 1;
    }
    return out.slice(0, 6);
  }

  root.TaigiMT = { init: init, addSentences: addSentences, addItaigi: addItaigi, itaigiHints: itaigiHints, translate: translate, finish: finish, romanize: function (h) { return joinTL(romanize(h)); },
    toNumeric: toNumeric, examples: examples, candidates: candidates, lanGuan: lanGuan };
})(typeof window !== 'undefined' ? window : globalThis);
