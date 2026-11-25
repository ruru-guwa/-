/* =========================================================
   上海旅行しおり — アプリ本体
   ハッシュで画面を切り替える1ページ構成。データは各自の端末に保存。
   ========================================================= */
(() => {
  "use strict";

  /* ---------------- 保存 ---------------- */
  const KEY = "sh2026:";
  const store = {
    get(k, d) { try { const v = localStorage.getItem(KEY + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch {} },
  };
  const state = {
    sel: store.get("sel", {}),          // { slotId: optId }  または split は { slotId: { ryu: optId, ... } }
    checks: store.get("checks", {}),    // { "prep:0": true, "mission:bund:1": true }
    notes: store.get("notes", {}),
    favs: store.get("favs", []),
    hist: store.get("hist", []),
    rate: store.get("rate", TRIP.defaultRate),
    nowOverride: store.get("nowOverride", ""),
    quiz: store.get("quiz", {}),
    planMode: store.get("planMode", "choose"),
    large: store.get("large", false),
    custom: store.get("custom", {}),    // 発見から予定に足した候補 { slotId: [findId, ...] }
    dwant: store.get("dwant", {}),      // ディズニーで乗りたい人 { rideId: [memberId, ...] }
    read: store.get("read", {}),        // 開いた章・ページ（どこまで見たか） { "s:bund:2": 1, ... }
    last: store.get("last", null),      // 最後に読んだ章 { k: "s"|"a", id, i }（ホームの「つづきから読む」）
  };
  const save = (k) => store.set(k, state[k]);
  if (state.nowOverride) { state.nowOverride = ""; save("nowOverride"); } // 試作のときの日時の仮設定を消す

  /* チェックリストの項目は、順番ではなく文章で覚える（項目を足してもチェックがずれない） */
  const ckey = (list, text) => { let h = 5381; for (const ch of text) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0; return `${list}#${h.toString(36)}`; };
  // 文章を直した項目は、前の文章でつけたチェックを引きつぐ [リスト, 前の文章, 今の文章]
  [["disney", "【前日まで】このページの「乗りたい」を4人で決める", "【前日まで】乗り物の「乗りたい」を4人で決める"]].forEach(([l, a, b]) => {
    const o = ckey(l, a), n = ckey(l, b);
    if (state.checks[o] && !state.checks[n]) { state.checks[n] = state.checks[o]; save("checks"); }
  });

  /* ---------------- 小道具 ---------------- */
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const strip = (html) => String(html).replace(/\[\[\w+:[^|\]]+\|([^\]]+)\]\]/g, "$1").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const linkify = (html) => String(html).replace(/\[\[(\w+):([^|\]]+)\|([^\]]+)\]\]/g, (_, t, id, label) => `<a class="wl" href="#/${t}/${id}">${label}</a>`);
  const memberById = (id) => TRIP.members.find((m) => m.id === id);
  const avatar = (id) => { const m = memberById(id); return `<span class="avatar av-${id}">${esc(m.name[0])}</span>`; };

  function toast(msg) {
    let t = $(".toast");
    if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("show-t");
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show-t"), 1600);
  }

  /* ---------------- 時刻（上海時間で考える） ---------------- */
  function now() { return state.nowOverride ? new Date(state.nowOverride + ":00+08:00") : new Date(); }
  function shParts(d) { // 上海の日付と時刻
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
    const g = (t) => p.find((x) => x.type === t).value;
    return { date: `${g("year")}-${g("month")}-${g("day")}`, min: (+g("hour") % 24) * 60 + +g("minute") };
  }
  const toMin = (hm) => { const [h, m] = hm.split(":").map(Number); return h * 60 + m; };
  function phase() {
    const n = now();
    if (n < new Date(TRIP.start)) return "before";
    if (n > new Date(TRIP.end)) return "after";
    return "during";
  }

  /* ---------------- 予定の計算 ---------------- */
  function optionsOf(slot) {
    const extra = (state.custom[slot.id] || []).map((fid) => FINDS.find((f) => f.id === fid)).filter(Boolean)
      .map((f) => ({ id: "f:" + f.id, title: f.name, why: f.catch, dur: f.stay, find: f.id, spot: f.link?.startsWith("#/spot/") ? f.link.slice(7) : undefined, lat: f.lat ?? undefined, lng: f.lng ?? undefined, tags: [], custom: true }));
    return [...(slot.options || []), ...extra];
  }
  const allOptions = () => PLAN.flatMap((d, di) => d.slots.flatMap((s) => optionsOf(s).map((o) => ({ ...o, slot: s, day: d, dayIndex: di }))));
  function chosenOf(slot) {
    if (slot.type === "choice") { const id = state.sel[slot.id]; return id ? optionsOf(slot).find((o) => o.id === id) || null : null; }
    return null;
  }
  function splitOf(slot) { return state.sel[slot.id] || {}; }
  function coveredMusts() {
    const set = new Set();
    PLAN.forEach((d) => d.slots.forEach((s) => {
      if (s.type === "choice") { const o = chosenOf(s); (o?.covers || []).forEach((c) => set.add(c)); }
      if (s.type === "split") { Object.values(splitOf(s)).forEach((oid) => { const o = optionsOf(s).find((x) => x.id === oid); (o?.covers || []).forEach((c) => set.add(c)); }); }
    }));
    return set;
  }
  const slotDone = (s) => s.type === "fixed" || (s.type === "choice" && !!chosenOf(s)) || (s.type === "split" && Object.values(splitOf(s)).filter(Boolean).length > 0);
  function slotSummary(slot) { // タイムラインに出す文字
    if (slot.type === "fixed") return slot.title;
    if (slot.type === "choice") { const o = chosenOf(slot); return o ? o.title : null; }
    if (slot.type === "split") {
      const m = splitOf(slot); const parts = [];
      TRIP.members.forEach((p) => { if (slot.fixedFor?.[p.id]) parts.push(`${p.name}：ホテル`); else if (m[p.id]) parts.push(`${p.name}：${optionsOf(slot).find((o) => o.id === m[p.id])?.title}`); });
      return parts.length ? parts.join(" ／ ") : null;
    }
  }

  /* ---------------- アイコン ---------------- */
  const IC = {
    home: '<i class=\"ph ph-house\"></i>',
    plan: '<i class=\"ph ph-calendar-dots\"></i>',
    disney: '<i class=\"ph ph-castle-turret\"></i>',
    map: '<i class=\"ph ph-map-trifold\"></i>',
    search: '<i class=\"ph ph-compass\"></i>',
    tools: '<i class=\"ph ph-wrench\"></i>',
    back: '<i class=\"ph ph-caret-left\"></i>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 17l-5.2 2.7 1-5.9-4.3-4.1 5.9-.8L12 3.5Z"/></svg>',
    starOn: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 17l-5.2 2.7 1-5.9-4.3-4.1 5.9-.8L12 3.5Z"/></svg>',
    share: '<i class=\"ph ph-export\"></i>',
    close: '<i class=\"ph ph-x\"></i>',
  };

  /* ---------------- ルーター ---------------- */
  const TABS = [
    { id: "home", label: "ホーム", href: "#/home" },
    { id: "disney", label: "ディズニー", href: "#/disney" },
    { id: "map", label: "地図", href: "#/map" },
    { id: "search", label: "発見", href: "#/search" },
    { id: "tools", label: "便利ツール", href: "#/tools" },
  ];
  function parse() {
    const h = location.hash.replace(/^#\/?/, "") || "home";
    const [path, qs] = h.split("?");
    return { parts: path.split("/").map(decodeURIComponent), q: new URLSearchParams(qs || "") };
  }
  function tabOf(parts) {
    const p = parts[0];
    // ディズニーの解説と攻略ガイドも「ディズニー」のタブの中として扱う。予定はホームから開く
    if (p === "disney" || (p === "spot" && parts[1] === "disney") || (p === "article" && parts[1] === "disneyguide")) return "disney";
    if (["map"].includes(p)) return "map";
    if (["search", "spot", "article", "term", "find", "reads"].includes(p)) return "search";
    if (["tools", "favs"].includes(p)) return "tools";
    return "home";
  }

  const PAGES = {};
  function render() {
    const { parts, q } = parse();
    const page = PAGES[parts[0]] || PAGES.home;
    const out = page(parts.slice(1), q);
    const isRoot = ["home", "disney", "map", "search", "tools", ""].includes(parts[0]) && parts.length === 1;
    const favKey = out.fav;
    const isFav = favKey && state.favs.includes(favKey);

    document.title = out.title ? `${out.title}｜${TRIP.title}` : TRIP.title;
    $("#app").innerHTML = `
      <header class="appbar">
        ${isRoot ? `<span class="brand seal" aria-hidden="true">上海</span>` : `<button class="iconbtn" data-act="back" aria-label="戻る">${IC.back}</button>`}
        <h1>${esc(out.title || TRIP.title)}</h1>
        <div class="appbar-r">${out.actions ?? (favKey ? `<button class="iconbtn ${isFav ? "on" : ""}" data-act="fav" data-key="${esc(favKey)}" aria-label="お気に入り">${isFav ? IC.starOn : IC.star}</button>` : `<button class="iconbtn" data-act="share" aria-label="共有">${IC.share}</button>`)}</div>
      </header>
      <main>${out.html}</main>
      <nav class="tabbar">${TABS.map((t) => `<a href="${t.href}" class="${tabOf(parts) === t.id ? "active" : ""}">${IC[t.id]}<span>${t.label}</span></a>`).join("")}</nav>`;

    if (favKey) pushHistory(favKey, out.title);
    if (out.after) out.after();
    if (!parse().q.get("keep")) window.scrollTo(0, 0);
  }
  function pushHistory(key, title) {
    state.hist = [{ key, title }, ...state.hist.filter((h) => h.key !== key)].slice(0, 8);
    save("hist");
  }
  const hrefOfKey = (key) => "#/" + key.replace(":", "/");

  /* ---------------- 発見（FINDS）の小道具 ---------------- */
  function kmBetween(lat1, lng1, lat2, lng2) {
    const R = 6371, r = (d) => (d * Math.PI) / 180;
    const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  const hasPos = (f) => f.lat != null && f.lng != null;
  const distKm = (f) => (hasPos(f) ? kmBetween(TRIP.hotel.lat, TRIP.hotel.lng, f.lat, f.lng) : null);
  function bearing(f) { // ホテルから見た方角（8方位）
    const north = (f.lat - TRIP.hotel.lat) * 111, east = (f.lng - TRIP.hotel.lng) * 95;
    const deg = ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
    return ["北", "北東", "東", "南東", "南", "南西", "西", "北西"][Math.round(deg / 45) % 8];
  }
  function howFar(f) { // 目安。道のりは直線の約1.3倍で計算
    const d = distKm(f);
    if (d == null) return "";
    if (d < 1.3) return `ホテルから約${Math.max(0.3, d).toFixed(1)}km・歩いて約${Math.max(5, Math.round((d * 1.3 / 4.5) * 12) * 5)}分`;
    const mins = Math.round((d * 1.3 * (d > 10 ? 1.5 : 2.4) + 5) / 5) * 5;
    return `ホテルから${bearing(f)}へ約${d < 10 ? d.toFixed(1) : Math.round(d)}km・タクシーで約${mins}分`;
  }
  const isNear = (f) => { const d = distKm(f); return d != null && d < 1.3; };
  const badgesOf = (f) => [...(f.badges || []), ...(isNear(f) ? ["near"] : [])];
  const findHref = (f) => f.link || `#/find/${f.id}`;
  const badgeHtml = (b) => `<span class="fb fb-${b}"><i class="ph ph-${FIND_BADGES[b].icon}"></i>${FIND_BADGES[b].label}</span>`;
  const isLatin = (t) => /^[A-Za-z0-9 ]+$/.test(t);
  function findCard(f) { // 横に流れるカード（案A：色の帯にジャンルのアイコン）
    const c = FIND_CATS[f.cat];
    return `<a class="find-card" href="${findHref(f)}">
      <div class="fc-band c-${c.color || "navy"}"><span class="fc-ic"><i class="ph ph-${c.icon}"></i></span><span class="fc-cl">${c.label}</span>${seenOf(f) ? `<span class="fc-seen"><i class="ph ph-check"></i>見た</span>` : ""}</div>
      <div class="fc-body"><div class="fc-badges">${badgesOf(f).slice(0, 2).map(badgeHtml).join("")}</div><h4>${esc(f.name)}</h4><p>${esc(f.catch)}</p></div></a>`;
  }
  function findRow(f) { // 一覧の行
    const c = FIND_CATS[f.cat];
    const far = howFar(f);
    return `<a class="find-row" href="${findHref(f)}"><span class="fr-ic c-${c.color || "navy"}"><i class="ph ph-${c.icon}"></i></span>
      <div class="fr-body"><div class="fc-badges">${seenOf(f) ? `<span class="fb fb-seen"><i class="ph ph-check"></i>見た</span>` : ""}${badgesOf(f).map(badgeHtml).join("")}</div><h4>${esc(f.name)}</h4><p>${esc(f.catch)}</p>${miniMeta(f)}${far ? `<small><i class="ph ph-map-pin"></i> ${far}</small>` : ""}</div></a>`;
  }
  const fitsOf = (f) => [...(f.fits || []), ...(f.walk === 1 ? ["easy"] : []), ...(f.indoor === true ? ["rain"] : [])];
  const BUDGET = ["無料", "〜50元", "50〜200元", "200元〜"];
  const WALK = ["", "少なめ", "ふつう", "多め"];
  const INDOOR = { true: "屋内（雨でもOK）", half: "半分屋内", false: "屋外" };
  const dots = (n, max = 3) => `<span class="dots">${Array.from({ length: max }, (_, i) => `<i class="${i < n ? "on" : ""}"></i>`).join("")}</span>`;
  function glanceHtml(f) { // ひと目でわかる情報
    if (!f || f.walk == null) return "";
    const cell = (ic, label, val) => `<div class="gl"><i class="ph ph-${ic}"></i><span class="gl-l">${label}</span><b>${val}</b></div>`;
    return `<div class="glance">
      ${cell("clock", "所要時間", esc(f.stay || "—"))}
      ${cell("person-simple-walk", "歩く量", `${dots(f.walk)} ${WALK[f.walk]}`)}
      ${cell("currency-cny", "予算（1人）", f.budget === 0 ? "無料" : `${"¥".repeat(f.budget)} <small>${BUDGET[f.budget]}</small>`)}
      ${cell("sun-horizon", "おすすめの時間", esc(f.best || "—"))}
      ${cell("umbrella", "雨の日", INDOOR[String(f.indoor)] || "—")}
    </div>`;
  }
  function whoHtml(f) { // こんな人におすすめ
    if (!f || !(f.who?.length || f.fits?.length)) return "";
    return `<section class="card who"><h3><i class="ph ph-users-three"></i> こんな人におすすめ</h3>
      ${f.who?.length ? `<ul>${f.who.map((w) => `<li>${w}</li>`).join("")}</ul>` : ""}
      <div class="fit-chips">${fitsOf(f).map((k) => `<a class="fit" href="#/search?p=${k}"><i class="ph ph-${FIND_FITS[k].icon}"></i>${FIND_FITS[k].label}</a>`).join("")}</div></section>`;
  }
  const miniMeta = (f) => (f.walk == null ? "" : `<span class="mini"><i class="ph ph-clock"></i>${esc(f.stay)}<i class="ph ph-person-simple-walk"></i>${WALK[f.walk]}<i class="ph ph-currency-cny"></i>${f.budget === 0 ? "無料" : "¥".repeat(f.budget)}</span>`);
  const findText = (f) => [f.name, f.zh, f.catch, strip(f.about || ""), ...(f.points || []).map(strip), ...(f.tips || []).map(strip), ...(f.who || []), ...(f.deep || []).map((d) => d.h + " " + strip(d.html)), f.japan || "", ...(f.basics || []).flat(), ...fitsOf(f).map((k) => FIND_FITS[k].label)].join(" ");
  function todaysFind() { // 日替わりで1つ（詳しい解説ページがあるものは除く）
    const pool = FINDS.filter((f) => !f.link);
    return pool[(Math.floor(now().getTime() / 86400000) * 7) % pool.length];
  }
  let lastRandom = "";
  function randomFind() {
    const pool = FINDS.filter((f) => f.id !== lastRandom);
    const f = pool[Math.floor(Math.random() * pool.length)];
    lastRandom = f.id;
    location.hash = findHref(f);
  }

  /* ---------------- 階層のための部品（目次の行・まえ/つぎ・読んだ印） ----------------
     長いページは「目次 → タップして1つずつ読む」にする。開いたところには✓がつく */
  // 読んだ印のキー：スポットの章 s:id:n ／ 読み物の章 a:id:n ／ 用語 t:id ／ 発見 f:id ／ ディズニー d:xxx
  function markRead(k) { if (!state.read[k]) { state.read[k] = 1; save("read"); } }
  const isRead = (k) => !!state.read[k];
  const readMin = (html) => Math.max(1, Math.round(strip(html).length / 600)); // 1分に約600字として
  const preview = (html, n = 36) => { const t = strip(html); return t.length > n ? t.slice(0, n) + "…" : t; };
  const ART = new Map();
  function chaptersOf(id) { // 読み物を <h3> ごとの章に分ける
    if (!ART.has(id)) {
      const parts = ARTICLES[id].html.split("<h3>");
      const intro = parts.shift().trim();
      ART.set(id, { intro, chapters: parts.map((p) => { const i = p.indexOf("</h3>"); return { h: p.slice(0, i).replace(/<[^>]+>/g, "").trim().replace(/^\d+[.．、]\s*/, ""), html: p.slice(i + 5).trim() }; }) });
    }
    return ART.get(id);
  }
  function progressOf(kind, id) { // { done, total }
    if (kind === "s") { const secs = SPOTS[id].sections; return { done: secs.filter((_, i) => isRead(`s:${id}:${i}`)).length, total: secs.length }; }
    const ch = chaptersOf(id).chapters;
    if (!ch.length) return { done: isRead(`a:${id}:0`) ? 1 : 0, total: 1 };
    return { done: ch.filter((_, i) => isRead(`a:${id}:${i}`)).length, total: ch.length };
  }
  function seenOf(f) { // 発見を見たか（解説ページへのリンクのものは、その解説を1章でも読んだか）
    if (f.link?.startsWith("#/spot/")) return progressOf("s", f.link.slice(7)).done > 0;
    if (f.link?.startsWith("#/article/")) return progressOf("a", f.link.slice(10)).done > 0;
    return isRead(`f:${f.id}`);
  }
  function nextUnread(kind, id, from = -1) { // from の次から未読を探す（最後まで行ったら最初から）
    const n = kind === "s" ? SPOTS[id].sections.length : chaptersOf(id).chapters.length;
    for (let k = 1; k <= n; k++) { const i = (from + k) % n; if (!isRead(`${kind}:${id}:${i}`)) return i; }
    return -1;
  }
  function continueItem() { // ホームの「つづきから読む」
    const L = state.last; if (!L || !(L.k === "s" ? SPOTS[L.id] : ARTICLES[L.id])) return null;
    const i = nextUnread(L.k, L.id, L.i); if (i < 0) return null;
    const isS = L.k === "s";
    return { href: `#/${isS ? "spot" : "article"}/${L.id}/${i}`, name: isS ? SPOTS[L.id].name : ARTICLES[L.id].title, title: `${i + 1}. ${isS ? SPOTS[L.id].sections[i].h : chaptersOf(L.id).chapters[i].h}` };
  }

  // 目次の行：番号（読んだら✓）・見出し・ひとこと・読む時間
  const mrow = ({ href, n, icon, title, sub, read, meta }) => `<a class="mrow ${read ? "read" : ""}" href="${href}">
      <span class="mr-n">${read ? `<i class="ph ph-check"></i>` : icon ? `<i class="ph ph-${icon}"></i>` : n}</span>
      <span class="mr-body"><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</span>
      ${meta ? `<span class="mr-meta">${meta}</span>` : ""}<i class="ph ph-caret-right mr-go"></i></a>`;
  // 読んだ数と「つづきから読む」
  function progressHtml(p, cont) {
    return `<div class="prog"><div class="prog-top"><span>読んだ <b>${p.done}</b> / ${p.total}</span>${p.done >= p.total ? `<span class="prog-done"><i class="ph ph-check-circle"></i> 全部読みました</span>` : ""}</div>
      <span class="bar"><i style="width:${Math.round((p.done / p.total) * 100)}%"></i></span>
      ${cont ? `<a class="cont" href="${cont.href}"><i class="ph ph-${p.done ? "play-circle" : "book-open-text"}"></i><span><small>${p.done ? "つづきから読む" : "最初から読む"}</small><b>${esc(cont.title)}</b></span><i class="ph ph-caret-right"></i></a>` : ""}</div>`;
  }
  // ページの下の「まえ・つぎ」と「目次にもどる」
  function pagerHtml(prev, next, up) {
    const pg = (o, cls, label) => (o ? `<a class="pg ${cls}" href="${o.href}">${cls === "prev" ? `<i class="ph ph-caret-left"></i>` : ""}<span><small>${label}</small><b>${esc(o.title)}</b></span>${cls === "next" ? `<i class="ph ph-caret-right"></i>` : ""}</a>` : `<span class="pg none"></span>`);
    return `<nav class="pager">${pg(prev, "prev", "まえ")}${pg(next, "next", "つぎ")}</nav>${up ? `<a class="pg-up" href="${up.href}"><i class="ph ph-list-bullets"></i>${esc(up.title)}</a>` : ""}`;
  }
  const crumb = (href, label, pos) => `<div class="crumb"><a href="${href}"><i class="ph ph-caret-left"></i>${esc(label)}</a>${pos ? `<span>${esc(pos)}</span>` : ""}</div>`;
  // タップで開く行（見出しの HTML は呼ぶ側でエスケープする）
  const accHtml = (head, body, open = false) => `<div class="acc ${open ? "open" : ""}"><button class="acc-h" data-act="acc" aria-expanded="${open}">${head}<i class="ph ph-caret-down acc-ic"></i></button><div class="acc-b">${body}</div></div>`;
  // 入口のタイル（アイコン・名前・ひとこと）
  const tilesHtml = (arr, cls = "") => `<div class="tiles ${cls}">${arr.map((t) => `<a class="tile ${t.read ? "read" : ""}" href="${t.href}"><span class="t-ic c-${t.color}"><i class="ph ph-${t.icon}"></i></span><b>${esc(t.label)}</b>${t.sub ? `<small>${esc(t.sub)}</small>` : ""}${t.read ? `<i class="ph ph-check t-read"></i>` : ""}</a>`).join("")}</div>`;
  function readTiles() { // 「読む」の入口：読み物・詳しい解説・用語
    const sum = (arr) => arr.reduce((a, p) => ({ done: a.done + p.done, total: a.total + p.total }), { done: 0, total: 0 });
    const a = sum(Object.keys(ARTICLES).map((id) => progressOf("a", id)));
    const s = sum(Object.keys(SPOTS).map((id) => progressOf("s", id)));
    const t = Object.keys(TERMS).filter((id) => isRead(`t:${id}`)).length;
    return tilesHtml([
      { href: "#/reads/article", icon: "book-open-text", label: "読み物", sub: `${Object.keys(ARTICLES).length}本・${a.done}/${a.total}章`, color: "navy" },
      { href: "#/reads/spot", icon: "map-pin-line", label: "詳しい解説", sub: `${Object.keys(SPOTS).length}か所・${s.done}/${s.total}章`, color: "red" },
      { href: "#/reads/term", icon: "bookmark-simple", label: "用語", sub: `${Object.keys(TERMS).length}語・${t}読んだ`, color: "gold" },
    ], "three");
  }
  const notFound = { title: "見つかりません", html: `<div class="empty">このページは準備中です</div>` };

  /* ---------------- 案A：ページの見出し ----------------
     色の面にアイコンの丸・小見出し・題名・ひとこと。飾りの大きな漢字や中国語の名前は出さない（中国語は「見せる」画面だけ） */
  const SPOT_IC = { bund: "buildings", yuyuan: "flower-lotus", disney: "castle-turret", cruise: "boat", acrobat: "person-arms-spread", nanjing: "storefront", lujiazui: "city", xintiandi: "house-line", frenchconcession: "tree", hongkou: "bridge", suzhou: "waves", yangpu: "factory", locallife: "users-three", hotel: "bed" };
  const ART_IC = { model: "calendar-check", rainy: "umbrella", comfort: "heart", why: "question", disneyguide: "castle-turret", transport: "train", food: "bowl-food", culture: "globe-hemisphere-east", chinese: "chat-circle-text", history: "scroll", architecture: "buildings", cities: "city", airport: "airplane-tilt", prep: "suitcase" };
  const spotColor = (id) => SPOTS[id].color || (id === "yuyuan" ? "red" : "navy");
  const pageHead = ({ color, icon, kicker, title, sub, lead, extra = "" }) => `<section class="phead c-${color || "navy"}">
      <div class="ph-top"><span class="ph-ic"><i class="ph ph-${icon}"></i></span>${kicker ? `<span class="ph-kicker">${esc(kicker)}</span>` : ""}</div>
      <h2>${esc(title)}</h2>${sub ? `<div class="ph-sub">${esc(sub)}</div>` : ""}${lead ? `<p class="ph-lead">${esc(lead)}</p>` : ""}${extra}</section>`;

  /* ---------------- ホーム：1画面完結のダッシュボード（案A・2026/11/25） ----------------
     スクロールなしの1画面に、どの機能へも1タップで行ける入口だけを並べる。見本：design/案A-ホーム.html */
  const stripTag = (t) => t.replace(/^【[^】]*】/, "");
  PAGES.home = () => {
    const ph = phase();
    const n = now(), sh = shParts(n);
    const musts = coveredMusts();
    const left = Object.entries(CHECKLISTS).reduce((a, [k, l]) => a + l.items.filter((it) => !state.checks[ckey(k, it)]).length, 0);

    // いちばん大事なお知らせ（出発前：未完了の準備／旅行中：いま・つぎの予定）。見出しと日数は出さない（りゅうさんの希望）
    let alert = "";
    if (ph === "before") {
      const next = CHECKLISTS.prep.items.find((it) => !state.checks[ckey("prep", it)]);
      alert = next ? `<a class="ds-alert" href="#/tools/check/prep"><i class="ph ph-warning-circle"></i><span>未完了：${esc(stripTag(next))}</span><i class="ph ph-caret-right"></i></a>`
        : `<a class="ds-alert ok" href="#/tools/check"><i class="ph ph-check-circle"></i><span>出発前の準備は全部できました</span><i class="ph ph-caret-right"></i></a>`;
    } else if (ph === "during") {
      const di = PLAN.findIndex((d) => d.date === sh.date), day = PLAN[di];
      if (day) {
        const cur = day.slots.find((x) => toMin(x.time) <= sh.min && sh.min < toMin(x.end));
        const s = cur || day.slots.find((x) => toMin(x.time) > sh.min);
        if (s) alert = `<a class="ds-alert now" href="${s.type === "fixed" ? `#/plan/${di}` : `#/plan/${di}/${s.id}`}"><i class="ph ph-clock"></i><span>${cur ? "いま" : "つぎ"}：${esc(slotSummary(s) || s.title)}（${s.time}〜）</span><i class="ph ph-caret-right"></i></a>`;
      }
    } else {
      alert = `<a class="ds-alert now" href="#/tools/quiz"><i class="ph ph-question"></i><span>上海クイズで、4日間をふりかえる</span><i class="ph ph-caret-right"></i></a>`;
    }

    const days = PLAN.map((d, i) => {
      const done = d.slots.filter(slotDone).length, all = d.slots.length;
      const park = /ディズニー/.test(d.title), today = d.date === sh.date;
      return `<a class="dd-day ${park ? "hot" : ""} ${today ? "today" : ""}" href="#/plan/${i}">${today ? `<span class="dd-flag">今日</span>` : park ? `<span class="dd-flag">注目</span>` : ""}
        <span class="dd-date">${d.label}(${d.dow})</span><b>${esc(d.short || d.title)}</b><small>${done}/${all} 済</small></a>`;
    }).join("");
    // 機能は3×3。1段目は下のタブと同じ「ディズニー・地図・発見」、最後に「便利ツール」（タブの行き先は全部ホームからも1タップで。りゅうさんの希望）
    const park = PLAN.find((d) => /ディズニー/.test(d.title));
    const tiles = [
      { href: "#/disney", icon: "castle-turret", c: "pri", label: "ディズニー", sub: park ? `${park.label}（${park.dow}）` : "攻略ガイド", tab: true },
      { href: "#/map", icon: "map-trifold", c: "green", label: "地図", sub: "ルート・昔の地図", tab: true },
      { href: "#/search", icon: "compass", c: "peach", label: "発見", sub: `観光・グルメ${FINDS.length}件`, tab: true },
      { href: "#/tools/rate", icon: "currency-cny", c: "green", label: "為替計算", sub: `1元 ≈ ${state.rate}円` },
      { href: "#/tools/check", icon: "list-checks", c: "gray", label: "持ち物準備", sub: "持ち物・ToDo", badge: left ? `未完${left}` : "" },
      { href: "#/musts", icon: "bookmark-simple", c: "pink", label: "行きたい", sub: `${musts.size}/${MUSTS.length} 済` },
      { href: "#/reads/article", icon: "book-open-text", c: "gray", label: "旅のしおり", sub: `全${Object.keys(ARTICLES).length}記事` },
      { href: "#/tools/emergency", icon: "first-aid-kit", c: "red", label: "領事館・病院", sub: "緊急ダイヤル" },
      { href: "#/tools", icon: "wrench", c: "gray", label: "便利ツール", sub: "クイズ・気になる", tab: true },
    ].map((t) => `<a class="dt-tile${t.tab ? " tab" : ""}" href="${t.href}">${t.badge ? `<span class="dt-badge">${t.badge}</span>` : ""}<span class="dt-ic c2-${t.c}"><i class="ph ph-${t.icon}"></i></span><b>${t.label}</b><small>${esc(t.sub)}</small></a>`).join("");
    const trivia = TRIVIA[Math.floor(n.getTime() / 86400000) % TRIVIA.length];

    return {
      title: "ホーム",
      actions: `<a class="hb sos" href="#/tools/emergency" aria-label="緊急連絡先">SOS</a><button class="hb" data-act="share" aria-label="共有"><i class="ph ph-share-network"></i></button><a class="hb" href="#/tools/settings" aria-label="設定"><i class="ph ph-gear"></i></a>`,
      html: `<div class="dash">
        ${alert}
        <div class="db">
          <a class="db-btn taxi" href="#/tools/taxi"><span class="db-top"><span class="db-ic"><i class="ph ph-taxi"></i></span><span class="db-chip">指差し提示</span></span><span class="db-label"><b>タクシーに見せる</b><small>打車指南・目的地カード</small></span></a>
          <a class="db-btn shop" href="#/tools/phrase"><span class="db-top"><span class="db-ic"><i class="ph ph-receipt"></i></span><span class="db-chip">注文・会計</span></span><span class="db-label"><b>お店で見せる</b><small>点餐・買単フレーズ</small></span></a>
        </div>
        <a class="dtips" href="#/tips"><i class="ph ph-scroll"></i><span class="dtips-chip">Tips</span><span class="dtips-text">${esc(trivia)}</span><i class="ph ph-caret-right"></i></a>
        <section class="dd">
          <div class="dd-head"><span><i class="ph ph-calendar-dots"></i>旅程ダイレクトアクセス</span><small>タップして詳細へ</small></div>
          <div class="dd-grid">${days}</div>
        </section>
        <div class="dt">${tiles}</div>
      </div>`,
    };
  };

  /* 行きたい：4人の「絶対に行きたい」5つと、それが入っている予定 */
  PAGES.musts = () => {
    const covered = coveredMusts();
    const chosen = (o) => (o.slot.type === "split" ? Object.values(splitOf(o.slot)).includes(o.id) : state.sel[o.slot.id] === o.id);
    const all = allOptions();
    return {
      title: "行きたい",
      html: `<div class="prog"><div class="prog-top"><span>予定に入った <b>${covered.size}</b> / ${MUSTS.length}</span>${covered.size === MUSTS.length ? `<span class="prog-done"><i class="ph ph-check-circle"></i> 全部入りました</span>` : ""}</div><span class="bar"><i style="width:${Math.round((covered.size / MUSTS.length) * 100)}%"></i></span></div>
      <div class="card menu">${MUSTS.map((m, i) => {
        const opts = all.filter((o) => (o.covers || []).includes(m.id)), got = opts.filter(chosen), go = got[0] || opts[0];
        return mrow({ href: go ? `#/plan/${go.dayIndex}/${go.slot.id}` : "#/plan", n: i + 1, title: m.label, read: covered.has(m.id),
          sub: got.length ? `入っている予定：${got.map((o) => `${o.day.label} ${o.slot.title}「${o.title}」`).join("、")}` : `まだ予定に入っていません（候補 ${opts.length} か所）` });
      }).join("")}</div>
      <p class="tiny">4人が「絶対に行きたい」と決めた5つ。予定の候補で選ぶと✓がつきます。行を押すと、その時間帯の候補のページへ。</p>`,
    };
  };

  /* 豆知識の一覧（今日のものが先頭） */
  PAGES.tips = () => {
    const today = Math.floor(now().getTime() / 86400000) % TRIVIA.length;
    const order = TRIVIA.map((_, k) => (today + k) % TRIVIA.length);
    return {
      title: "豆知識",
      html: `<div class="card menu">${order.map((k, j) => `<div class="tip-row ${j === 0 ? "today" : ""}">${j === 0 ? `<span class="tip-tag">今日</span>` : ""}${esc(TRIVIA[k])}</div>`).join("")}</div>
      <p class="tiny">毎日1つずつ、ホームの「Tips」に出ます。</p>`,
    };
  };

  /* ---------------- 予定 ----------------
     1日の画面では時間帯をコンパクトに並べ、タップするとその時間帯の候補のページで選ぶ */
  const optLinks = (s, x) => `<div class="more">${x.custom ? `<span class="pill jade">発見から追加</span>` : ""}${x.spot && SPOTS[x.spot] ? `<a href="#/spot/${x.spot}">解説を読む ›</a>` : x.find ? `<a href="#/find/${x.find}">くわしく ›</a>` : ""}${x.custom ? `<button class="unadd" data-act="unadd" data-slot="${s.id}" data-find="${x.find}">候補から外す</button>` : ""}</div>`;
  const optDetail = (x) => (x.look || x.move ? `<dl class="opt-meta">${x.look ? `<dt>注目</dt><dd>${esc(x.look)}</dd>` : ""}${x.move ? `<dt>移動</dt><dd>${esc(x.move)}</dd>` : ""}</dl>` : "");
  const optBtn = (s, x, on) => `<div class="opt ${on ? "on" : ""}" data-act="pick" data-slot="${s.id}" data-opt="${x.id}" role="button" tabindex="0">
      <div class="row"><span class="radio"></span><h4>${esc(x.title)}</h4><span class="dur">${esc(x.dur || "")}</span></div>
      ${x.why ? `<div class="why">${esc(x.why)}</div>` : ""}${optDetail(x)}${optLinks(s, x)}
    </div>`;
  const splitBtn = (s, x, m) => `<div class="opt ${Object.values(m).includes(x.id) ? "on" : ""}">
      <div class="row"><span class="radio"></span><h4>${esc(x.title)}</h4><span class="dur">${esc(x.dur || "")}</span></div>
      ${x.why ? `<div class="why">${esc(x.why)}</div>` : ""}${optDetail(x)}${optLinks(s, x)}
      <div class="persons">${TRIP.members.filter((p) => !s.fixedFor?.[p.id]).map((p) => `<button class="person ${m[p.id] === x.id ? "on" : ""}" data-act="assign" data-slot="${s.id}" data-opt="${x.id}" data-person="${p.id}">${avatar(p.id)}${esc(p.name)}</button>`).join("")}</div>
    </div>`;
  const splitLines = (s) => { const m = splitOf(s); return TRIP.members.map((p) => `<div>${avatar(p.id)}<span>${esc(p.name)}：${esc(s.fixedFor?.[p.id] || (m[p.id] ? optionsOf(s).find((o) => o.id === m[p.id])?.title : "未定"))}</span></div>`).join(""); };

  PAGES.plan = (args) => {
    const sh = shParts(now());
    let di = args[0] != null ? +args[0] : Math.max(0, PLAN.findIndex((d) => d.date === sh.date));
    if (!(di >= 0 && di < PLAN.length)) di = 0;
    if (args[1]) return planSlot(di, args[1]);
    const day = PLAN[di];
    const musts = coveredMusts();
    const choose = state.planMode === "choose";

    const node = (s) => { const k = kindOf(s, chosenOf(s)); return `<span class="node k-${k.id}"><i class="ph ph-${k.icon}"></i></span>`; };
    const slotHtml = (s) => {
      const time = `<div class="time">${s.time}<small>〜${s.end}</small></div>${node(s)}`;
      if (s.type === "fixed") {
        return `<div class="slot fixed">${time}<div class="card"><div class="kicker">決定</div><h3>${esc(s.title)}</h3>${s.note ? `<div class="muted">${esc(s.note)}</div>` : ""}${s.go ? `<a class="toggle-link" href="${s.go[0]}">${esc(s.go[1])} ›</a>` : s.spot && SPOTS[s.spot] ? `<a class="toggle-link" href="#/spot/${s.spot}">${esc(SPOTS[s.spot].name)}の解説を読む ›</a>` : ""}</div></div>`;
      }
      const sum = slotSummary(s), o = chosenOf(s);
      return `<div class="slot ${sum ? "" : "slot-open"}">${time}<a class="card slot-link" href="#/plan/${di}/${s.id}">
        <div class="kicker">${esc(s.title)}${s.type === "split" ? " ・ 人ごとに選べる" : ""}</div>
        ${s.type === "split" ? `<div class="split-sum">${splitLines(s)}</div>` : sum ? `<h3>${esc(sum)}</h3>${o?.move ? `<div class="muted">${esc(o.move)}</div>` : ""}` : `<div class="empty-msg">まだ選んでいません</div>`}
        <span class="slot-go">${sum ? "選びなおす" : `候補 ${optionsOf(s).length} 件から選ぶ`}<i class="ph ph-caret-right"></i></span></a></div>`;
    };

    // アジェンダ表示：種類ごとに色分けしたブロックを並べる
    const agendaHtml = (s) => {
      const o = chosenOf(s); const k = kindOf(s, o);
      const range = `${s.time} – ${s.end}`;
      if (s.type === "split") {
        const m = splitOf(s);
        const lines = TRIP.members.map((p) => `<div class="ag-person">${avatar(p.id)}<span>${esc(s.fixedFor?.[p.id] || (m[p.id] ? optionsOf(s).find((x) => x.id === m[p.id])?.title : "未定"))}</span></div>`).join("");
        return `<a class="ag k-${k.id}" href="#/plan/${di}/${s.id}"><i class="ph ph-users-three ag-ic"></i><div class="ag-body"><b>${esc(s.title)}</b><span class="ag-time">${range}</span>${lines}</div><i class="ph ph-caret-right ag-go"></i></a>`;
      }
      const title = s.type === "fixed" ? s.title : o?.title;
      if (!title) return `<a class="ag ag-open" href="#/plan/${di}/${s.id}"><i class="ph ph-circle-dashed ag-ic"></i><div class="ag-body"><b>${esc(s.title)}：未選択</b><span class="ag-time">${range} ・ 候補 ${optionsOf(s).length} 件から選ぶ</span></div><i class="ph ph-caret-right ag-go"></i></a>`;
      const href = o?.spot ? `#/spot/${o.spot}` : s.go?.[0] || null;
      const inner = `<i class="ph ph-${k.icon} ag-ic"></i><div class="ag-body"><b>${esc(title)}</b><span class="ag-time">${range}${o?.move ? ` ・ ${esc(o.move)}` : ""}</span></div>${href ? `<i class="ph ph-caret-right ag-go"></i>` : ""}`;
      return href ? `<a class="ag k-${k.id}" href="${href}">${inner}</a>` : `<div class="ag k-${k.id}">${inner}</div>`;
    };
    const chosenCount = day.slots.filter(slotDone).length;

    return {
      title: "予定",
      html: `
      <div class="tabband">${PLAN.map((d, i) => `<a class="${i === di ? "active" : ""}" href="#/plan/${i}?keep=1"><span class="tb-date">${d.label}</span><span class="tb-dow">${d.dow}</span></a>`).join("")}</div>
      <div class="daytitle">
        <div><div class="eyebrow-s">DAY ${di + 1} ・ ${day.label}（${day.dow}）</div><h2>${esc(day.title)}</h2></div>
        <div class="stat-mini"><b>${chosenCount}</b><span>/${day.slots.length} 決定</span></div>
      </div>
      <div class="seg"><button class="${choose ? "on" : ""}" data-act="mode" data-mode="choose"><i class="ph ph-list-checks"></i> えらぶ</button><button class="${!choose ? "on" : ""}" data-act="mode" data-mode="view"><i class="ph ph-calendar-check"></i> アジェンダ</button></div>
      ${choose ? `<div class="tl">${day.slots.map(slotHtml).join("")}</div>` : `<div class="agenda">${day.slots.map(agendaHtml).join("")}</div>`}
      <a class="cta" href="#/map?day=${di}"><i class="ph ph-map-trifold"></i> この日のルートを地図で見る</a>
      <div class="label-s" style="margin-top:22px">絶対に行きたい（4日間全体）</div>
      <div class="must-row">${MUSTS.map((m) => `<span class="must ${musts.has(m.id) ? "ok" : ""}">${m.label}</span>`).join("")}</div>
      <p class="tiny" style="margin-top:14px">選んだ内容はこのスマホにだけ保存されます。4人で決まったら、確定版としてサイトに反映します。</p>`,
    };
  };

  // 時間帯のページ：候補を見比べて選ぶ。下の「つぎ」で次の時間帯へ
  function planSlot(di, slotId) {
    const day = PLAN[di]; const s = day.slots.find((x) => x.id === slotId);
    if (!s || s.type === "fixed") return notFound;
    const all = PLAN.flatMap((d, i) => d.slots.filter((x) => x.type !== "fixed").map((x) => ({ d, i, s: x })));
    const k = all.findIndex((x) => x.s.id === slotId);
    const link = (x) => x && { href: `#/plan/${x.i}/${x.s.id}`, title: `${x.d.label} ${x.s.title}` };
    const opts = optionsOf(s);
    const sum = slotSummary(s);
    return {
      title: "予定",
      html: `${crumb(`#/plan/${di}`, `${day.label}（${day.dow}）${day.title}`, `${s.time}〜${s.end}`)}
        <h2 class="sub-h">${esc(s.title)}</h2>
        ${s.type === "split" ? `<div class="card slot-now"><div class="kicker">いまの割りふり</div><div class="split-sum">${splitLines(s)}</div></div>`
          : `<div class="card slot-now ${sum ? "" : "none"}"><div class="kicker">いまの選択</div><b>${sum ? esc(sum) : "まだ選んでいません"}</b></div>`}
        <p class="muted" style="margin:12px 2px 8px">${s.type === "split" ? "候補ごとに、行く人の名前を押して決めます。" : `候補 ${opts.length} 件。押すと選べます（もう一度押すと取り消し）。`}</p>
        <div class="opts full">${s.type === "split" ? opts.map((x) => splitBtn(s, x, splitOf(s))).join("") : opts.map((x) => optBtn(s, x, state.sel[s.id] === x.id)).join("")}</div>
        ${pagerHtml(link(all[k - 1]), link(all[k + 1]), { href: `#/plan/${di}`, title: `${day.label}の予定にもどる` })}`,
    };
  }

  /* 予定の種類（色とアイコン）。データに kind があればそれを使い、なければ言葉から判断する */
  const KINDS = {
    move: { id: "move", icon: "airplane-tilt", label: "移動" },
    meal: { id: "meal", icon: "fork-knife", label: "食事" },
    night: { id: "night", icon: "moon-stars", label: "夜" },
    rest: { id: "rest", icon: "bed", label: "休む" },
    park: { id: "park", icon: "castle-turret", label: "ディズニー" },
    sight: { id: "sight", icon: "binoculars", label: "見る・歩く" },
  };
  function kindOf(s, o) {
    if (s.kind) return KINDS[s.kind];
    const t = s.title + (o ? " " + o.title + " " + (o.tags || []).join(" ") : "");
    if (/ディズニーランド/.test(s.title)) return KINDS.park;
    if (/→|入国|移動/.test(s.title)) return { ...KINDS.move, icon: /リニア|地下鉄/.test(t) ? "train-simple" : /タクシー/.test(t) ? "taxi" : "airplane-tilt" };
    if (/夕食|昼食|食べる|朝ごはん|朝食|夜ごはん/.test(t)) return KINDS.meal;
    if (/チェックイン|ホテル|休/.test(s.title)) return KINDS.rest;
    if (/夜/.test(s.title)) return KINDS.night;
    if (/お茶/.test(s.title)) return { ...KINDS.meal, icon: "coffee" };
    return KINDS.sight;
  }

  /* ---------------- ディズニー（タブ）：メニュー → それぞれのページ ---------------- */
  const LV = { 1: { label: "おだやか", cls: "lv1" }, 2: { label: "ほどよい", cls: "lv2" }, 3: { label: "スリル", cls: "lv3" } };
  const D_TAG = { "冬だけ": "t-winter", "冬の人気": "t-winter", "クリスマス": "t-xmas", "10周年": "t-10", "上海生まれ": "t-10", "上海ならでは": "t-10", "今年の新作": "t-new", "冬の新メニュー": "t-new" };
  // 並び順＝入口の3×3のマスの順＝「まえ・つぎ」の順（行く前 → 当日 → 知って楽しむ）。short はマスの名前
  const D_MENU = [
    { id: "prep", icon: "list-checks", title: "ディズニーの準備", short: "行く前の準備", c: "gray" },
    { id: "rides", icon: "rocket-launch", title: "乗り物", short: "乗り物", c: "pri" },
    { id: "want", icon: "users-three", title: "みんなの乗りたい", short: "乗りたい", c: "pink" },
    { id: "plan", icon: "clock", title: "1日の流れ・帰り方", short: "1日の流れ", c: "green" },
    { id: "shows", icon: "sparkle", title: "ショー・冬の演出", short: "ショー", c: "peach" },
    { id: "food", icon: "fork-knife", title: "食べたいもの", short: "食べ物", c: "red" },
    { id: "goods", icon: "gift", title: "グッズ", short: "グッズ", c: "pink" },
    { id: "only", icon: "star-four", title: "上海だけ・十二支", short: "上海だけ", c: "peach" },
    { id: "season", icon: "snowflake", title: "冬のイベント・10周年", short: "冬のイベント", c: "green" },
  ];
  let dFilter = "all";
  // 準備：「準備・持ち物」のディズニーの項目（チェックは共通）＋ディズニーだけの項目
  const dPrep = () => [
    ...CHECKLISTS.prep.items.filter((t) => /ディズニー/.test(t)).map((t) => ({ t, k: ckey("prep", t) })),
    ...DISNEY.prep.map((t) => ({ t, k: ckey("disney", t) })),
  ];
  // みんなの乗りたい：乗りたい人の組み合わせごとにまとめる（別行動の作戦に使う）
  function dGroups() {
    const order = TRIP.members.map((m) => m.id); const groups = new Map();
    DISNEY.rides.forEach((r) => {
      const w = order.filter((id) => (state.dwant[r.id] || []).includes(id));
      if (!w.length) return;
      const k = w.join(",");
      if (!groups.has(k)) groups.set(k, { ids: w, rides: [] });
      groups.get(k).rides.push(r);
    });
    return [...groups.values()].sort((a, b) => b.ids.length - a.ids.length || order.indexOf(a.ids[0]) - order.indexOf(b.ids[0]));
  }
  const dLabel = (ids) => (ids.length === TRIP.members.length ? "4人みんなで" : ids.map((id) => memberById(id).name).join("・") + (ids.length === 1 ? "だけ" : "で"));
  const wantBtns = (r) => { const w = state.dwant[r.id] || []; return `<div class="persons dz-want"><span class="dz-want-l">乗りたい</span>${TRIP.members.map((p) => `<button class="person ${w.includes(p.id) ? "on" : ""}" data-act="dwant" data-ride="${r.id}" data-person="${p.id}" aria-pressed="${w.includes(p.id)}">${avatar(p.id)}${esc(p.name)}</button>`).join("")}</div>`; };
  const rideTags = (r) => [
    r.first ? `<span class="rt first"><i class="ph ph-sparkle"></i>${esc(r.first)}</span>` : "",
    r.indoor === true ? `<span class="rt"><i class="ph ph-house-line"></i>屋内</span>` : r.indoor === "half" ? `<span class="rt"><i class="ph ph-house-line"></i>半分屋内</span>` : `<span class="rt"><i class="ph ph-sun"></i>屋外</span>`,
    r.wet ? `<span class="rt wet"><i class="ph ph-drop"></i>濡れる</span>` : "",
    r.single ? `<span class="rt"><i class="ph ph-user"></i>シングルライダー</span>` : "",
    r.dpa ? `<span class="rt"><i class="ph ph-lightning"></i>プレミアアクセス</span>` : "",
  ].join("");
  const landTag = (r) => { const land = DISNEY.lands[r.land]; return `<span class="land c-${land.color}"><i></i>${esc(land.name)}</span>`; };
  const dItem = (x) => `<div class="dz-item">
      <div class="dz-item-top"><span class="dz-tag ${D_TAG[x.tag] || ""}">${esc(x.tag)}</span></div>
      <h4>${esc(x.name)}</h4><p>${esc(x.text)}</p></div>`;
  const dTips = (list) => `<ul class="dz-tips">${list.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`;

  PAGES.disney = (args, q) => {
    const D = DISNEY, sub = args[0];
    if (sub === "ride") return disneyRide(args[1]);
    if (sub && D_MENU.some((m) => m.id === sub)) return disneySub(sub, q);

    /* 入口はホームと同じ「スクロールなしの1画面」（2026/11/26「ごちゃごちゃして見にくい」）。上から
       つぎにやること → 行き・帰りのタクシー → 日付と時間 → 9つのマス → 攻略ガイド・解説 */
    const sh = shParts(now());
    const tGo = TAXI.find((t) => t.id === "disney"), tBack = TAXI.find((t) => t.id === "hotel");
    const taxiData = (t) => `data-act="show-taxi" data-zh="${esc(t.zh)}" data-addr="${esc(t.addr)}" data-ja="${esc(t.ja)}"`;
    const prep = dPrep(), left = prep.filter((x) => !state.checks[x.k]);
    const groups = dGroups();
    const di = PLAN.findIndex((d) => d.date === D.date), pd = PLAN[di];

    // つぎにやること（行く前：ディズニーの準備 → 乗りたいを選ぶ／当日：いまの流れ／終わったら：思い出）
    const bar = (cls, href, icon, text) => `<a class="ds-alert ${cls}" href="${href}"><i class="ph ph-${icon}"></i><span>${esc(text)}</span><i class="ph ph-caret-right"></i></a>`;
    let alert;
    if (sh.date === D.date) {
      const cur = [...D.plan].reverse().find((p) => /^\d+:\d+$/.test(p.time) && toMin(p.time) <= sh.min);
      alert = bar("now", "#/disney/plan", "clock", cur ? `いま：${cur.title}（${cur.time}〜）` : "今日はディズニーの日。1日の流れを見る");
    } else if (sh.date > D.date) alert = bar("now", "#/disney/only", "heart", "楽しかった1日を、思い出に");
    else if (left.length) alert = bar("", "#/disney/prep", "warning-circle", `未完了：${stripTag(left[0].t)}`);
    else if (!groups.length) alert = bar("", "#/disney/rides", "users-three", "つぎ：乗りたい乗り物を4人で選ぶ");
    else alert = bar("ok", "#/disney/plan", "check-circle", "準備はできました。当日の流れを見ておく");

    const meta = { prep: left.length ? `${prep.length - left.length}/${prep.length} 済み` : "全部できた", rides: `${D.rides.length}件・強さ別`, want: groups.length ? `${groups.length}組に分かれた` : "まだ選んでいない", plan: "帰り方も", shows: `${D.shows.length}件・冬だけも`, food: `${D.food.length}品・冬の新作`, goods: `${D.goods.length}件・上海生まれ`, only: "十二支の庭", season: "クリスマスも" };
    const tiles = D_MENU.map((m) => `<a class="dt-tile" href="#/disney/${m.id}">${m.id === "prep" && left.length ? `<span class="dt-badge">未完${left.length}</span>` : isRead(`d:${m.id}`) ? `<i class="ph ph-check dt-read" aria-label="見た"></i>` : ""}<span class="dt-ic c2-${m.c}"><i class="ph ph-${m.icon}"></i></span><b>${m.short}</b><small>${esc(meta[m.id])}</small></a>`).join("");

    return {
      title: "ディズニー",
      html: `<div class="dash">
        ${alert}
        <div class="db">
          <button class="db-btn taxi" ${taxiData(tGo)}><span class="db-top"><span class="db-ic"><i class="ph ph-taxi"></i></span><span class="db-chip">朝</span></span><span class="db-label"><b>行きのタクシー</b><small>ホテル → ディズニー</small></span></button>
          <button class="db-btn shop" ${taxiData(tBack)}><span class="db-top"><span class="db-ic"><i class="ph ph-car-profile"></i></span><span class="db-chip">夜</span></span><span class="db-label"><b>帰りのタクシー</b><small>ディズニー → ホテル</small></span></button>
        </div>
        <div class="dz-info"><span class="dz-info-ic"><i class="ph ph-castle-turret"></i></span><span class="dz-info-t"><b>上海ディズニーランド</b><small><span class="dz-date">${pd ? `${pd.label}（${pd.dow}）` : ""}</span>${esc(D.hoursShort)}</small></span>${pd ? `<a class="dz-info-go" href="#/plan/${di}">予定<i class="ph ph-caret-right"></i></a>` : ""}</div>
        <div class="dt">${tiles}</div>
        <div class="dz-more"><a href="#/article/disneyguide"><i class="ph ph-book-open-text"></i>攻略ガイド</a><a href="#/spot/disney"><i class="ph ph-castle-turret"></i>ディズニーの解説</a></div>
      </div>`,
    };
  };

  function disneySub(sub, q) {
    const D = DISNEY;
    markRead(`d:${sub}`);
    const i = D_MENU.findIndex((m) => m.id === sub), m = D_MENU[i];
    const nav = pagerHtml(i > 0 ? { href: `#/disney/${D_MENU[i - 1].id}`, title: D_MENU[i - 1].title } : null, i < D_MENU.length - 1 ? { href: `#/disney/${D_MENU[i + 1].id}`, title: D_MENU[i + 1].title } : null, { href: "#/disney", title: "ディズニーのメニューへ" });
    let body = "";
    if (sub === "prep") {
      const prep = dPrep(), done = prep.filter((x) => state.checks[x.k]).length;
      body = `<div class="prog"><div class="prog-top"><span>済み <b>${done}</b> / ${prep.length}</span></div><span class="bar"><i style="width:${Math.round((done / prep.length) * 100)}%;background:var(--k-park)"></i></span></div>
        <div class="card">${prep.map((x) => `<div class="mission ${state.checks[x.k] ? "on" : ""}" data-act="check" data-key="${x.k}"><span class="check"></span><span>${esc(x.t)}</span></div>`).join("")}</div>
        <p class="tiny">チケット・アプリ・早享卡の項目は、ツールの「準備・持ち物」と同じものです。どちらでチェックしても両方に反映されます。</p>`;
    } else if (sub === "rides") {
      const FILTERS = [["all", "すべて"], ["1", "おだやか"], ["2", "ほどよい"], ["3", "スリル"], ["in", "屋内"]];
      const shown = D.rides.filter((r) => dFilter === "all" || (dFilter === "in" ? r.indoor === true : String(r.level) === dFilter));
      const order = TRIP.members.map((p) => p.id);
      body = `<div class="chips dz-filter">${FILTERS.map(([v, l]) => `<button class="chip ${dFilter === v ? "on" : ""}" data-act="dfilter" data-v="${v}">${l}</button>`).join("")}</div>
        <div class="card list-card">${shown.map((r) => { const w = order.filter((id) => (state.dwant[r.id] || []).includes(id)); return `<a class="ride-row ${isRead(`d:ride:${r.id}`) ? "read" : ""}" href="#/disney/ride/${r.id}">
          <span class="lvl ${LV[r.level].cls}">${LV[r.level].label}</span>
          <span class="rr-body"><b>${esc(r.short)}</b><small>${landTag(r)}${r.indoor === true ? "・屋内" : ""}${r.wet ? "・濡れる" : ""}</small></span>
          <span class="rr-want">${w.map(avatar).join("")}</span>${isRead(`d:ride:${r.id}`) ? `<i class="ph ph-check rr-read"></i>` : ""}<i class="ph ph-caret-right mr-go"></i></a>`; }).join("")}</div>
        <p class="tiny">右の丸は「乗りたい」を押した人。乗り物を開くと、くわしい説明と「乗りたい」のボタンがあります。</p>`;
    } else if (sub === "want") {
      const groups = dGroups();
      body = `<section class="card dz-sum">${groups.length ? groups.map((g) => `<div class="dz-g"><div class="dz-g-who">${g.ids.map(avatar).join("")}<b>${esc(dLabel(g.ids))}</b></div><div class="dz-g-rides">${g.rides.map((r) => `<a href="#/disney/ride/${r.id}">${esc(r.short)}</a>`).join("")}</div></div>`).join("") : `<p class="muted" style="margin:0">まだだれも選んでいません。乗り物のページで、乗りたい人の名前を押すと、ここに「4人みんなで乗るもの」「2人で乗るもの」がまとまります。</p>`}</section>
        <a class="cta alt" href="#/disney/rides"><i class="ph ph-rocket-launch"></i><span><b>乗り物を見て選ぶ</b><br>${D.rides.length}件。強さ・屋内かどうかで絞りこめる</span><i class="ph ph-caret-right"></i></a>
        <p class="tiny">「乗りたい」はこのスマホにだけ保存されます。4人の分は1台にまとめて押してください。</p>`;
    } else if (sub === "shows") {
      const o = q.get("o");
      body = `<div class="card acc-list">${D.shows.map((s) => accHtml(`<span class="acc-t"><span class="dz-tag ${D_TAG[s.tag] || ""}">${esc(s.tag)}</span><b>${esc(s.name)}</b><small>${esc(s.when)}</small></span>`,
        `<p>${esc(s.text)}</p>${s.place ? `<div class="dz-when"><i class="ph ph-map-pin"></i><span>${esc(s.place)}</span></div>` : ""}${s.tip ? `<div class="dz-tip">${esc(s.tip)}</div>` : ""}`, o === s.id)).join("")}</div>
        <p class="tiny">タップすると説明が開きます。上演の時刻と休止は日によって変わるので、当日の朝に公式アプリで確認してください。</p>`;
    } else if (sub === "plan") {
      // 時刻＋線でつながった点の時間割（濃い色のブロックは並べない）。当日は「いま」の行に印
      const sh = shParts(now());
      const cur = sh.date === D.date ? [...D.plan].reverse().find((p) => /^\d+:\d+$/.test(p.time) && toMin(p.time) <= sh.min) : null;
      const planHtml = D.plan.map((p) => `<li class="tl-i k-${p.kind}${p === cur ? " now" : ""}"><span class="tl-time">${esc(p.time)}</span><span class="tl-dot"><i class="ph ph-${p.icon || KINDS[p.kind].icon}"></i></span><div class="tl-body"><b>${esc(p.title)}</b>${p.text ? `<span class="tl-note">${esc(p.text)}</span>` : ""}${(p.split || []).map(([a, b, t]) => `<div class="tl-person">${avatar(a)}${avatar(b)}<span>${esc(t)}</span></div>`).join("")}</div></li>`).join("");
      body = `<div class="dz-hours-note"><i class="ph ph-clock"></i><span>${esc(D.hours)}</span></div>
        <ol class="tl">${planHtml}</ol>
        <a class="cta alt dz-cta" href="#/plan/2"><i class="ph ph-calendar-dots"></i><span><b>12/11の予定</b><br>行き方（タクシー・地下鉄）と帰り方を選ぶ</span><i class="ph ph-caret-right"></i></a>
        <div class="label-s">帰り方</div>${dTips(D.back)}`;
    } else if (sub === "food") {
      body = `<div class="card dz-list">${D.food.map(dItem).join("")}</div><div class="label-s">食べるときのコツ</div>${dTips(D.foodTips)}`;
    } else if (sub === "goods") {
      body = `<div class="card dz-list">${D.goods.map(dItem).join("")}</div><div class="label-s">買うときのコツ</div>${dTips(D.goodsTips)}`;
    } else if (sub === "only") {
      body = `<div class="card"><ol class="dz-ol">${D.only.map((o) => `<li><b>${esc(o.h)}</b><span>${esc(o.t)}</span></li>`).join("")}</ol></div>
        <div class="label-s">十二支の庭の、干支のキャラクター</div>
        <div class="zodiac">${D.zodiac.map(([k, y, c, f]) => `<div class="zd ${k === "午" ? "now" : ""}"><b>${k}<small>${y}</small></b><span>${esc(c)}</span>${f ? `<small>${esc(f)}</small>` : ""}</div>`).join("")}</div>
        <p class="tiny">ガーデン・オブ・イマジネーションにある、十二支をディズニーのキャラクターで表したモザイクの壁。中国の「亥」はイノシシではなくブタ。色のついた枠は今年（2026年・午年）のマキシマス。4人それぞれの生まれ年のキャラクターも見つかる。</p>`;
    } else if (sub === "season") {
      const tag = (h) => (h === "クリスマス" ? "t-xmas" : /10周年/.test(h) ? "t-10" : "t-winter");
      body = `<div class="card dz-list">${D.season.map((s) => `<div class="dz-item"><div class="dz-item-top"><span class="dz-tag ${tag(s.h)}">${esc(s.h)}</span></div><h4>${esc(s.b)}</h4><p>${esc(s.t)}</p></div>`).join("")}</div>
        <p class="foot-note">2026年11月下旬の調べ（公式の発表・報道・旅行サイトや攻略記事より）。当日の営業時間・ショーの時刻・休止は、公式アプリで確認してください。</p>`;
    }
    return { title: "ディズニー", html: `${crumb("#/disney", "ディズニー", `${i + 1} / ${D_MENU.length}`)}<h2 class="sub-h">${esc(m.title)}</h2>${body}${nav}` };
  }

  // 乗り物1つのページ。下の「まえ・つぎ」でほかの乗り物へ
  function disneyRide(id) {
    const D = DISNEY, i = D.rides.findIndex((r) => r.id === id);
    if (i < 0) return notFound;
    const r = D.rides[i];
    markRead(`d:ride:${id}`);
    const near = (j) => D.rides[j] && { href: `#/disney/ride/${D.rides[j].id}`, title: D.rides[j].short };
    return {
      title: "ディズニー",
      html: `${crumb("#/disney/rides", "乗り物の一覧", `${i + 1} / ${D.rides.length}`)}
      <article class="card ride">
        <div class="ride-top"><span class="lvl ${LV[r.level].cls}">${LV[r.level].label}</span>${landTag(r)}</div>
        <h3>${esc(r.name)}</h3>
        <div class="ride-tags">${rideTags(r)}</div>
        <p>${esc(r.text)}</p>
        <dl class="meta"><dt>注目</dt><dd>${esc(r.look)}</dd><dt>4人で</dt><dd>${esc(r.note)}</dd>${r.tip ? `<dt>コツ</dt><dd>${esc(r.tip)}</dd>` : ""}</dl>
        ${wantBtns(r)}
      </article>
      ${pagerHtml(near(i - 1), near(i + 1), { href: "#/disney/rides", title: "乗り物の一覧へ" })}`,
    };
  }

  /* ---------------- スポット：目次 → 章ごとのページ ---------------- */
  PAGES.spot = (args) => {
    const id = args[0]; const s = SPOTS[id];
    if (!s) return notFound;
    const sub = args[1];
    const n = s.sections.length;
    const taxiAddr = TAXI.find((t) => t.id === id)?.addr || "";
    const fab = `<button class="fab" data-act="show-taxi" data-zh="${esc(s.zh)}" data-addr="${esc(taxiAddr)}" data-ja="${esc(s.name)}" aria-label="タクシーに見せる"><i class="ph ph-taxi"></i></button>`;
    const hub = `#/spot/${id}`;
    const sec = (i) => ({ href: `#/spot/${id}/${i}`, title: s.sections[i].h });
    const lf = FINDS.find((x) => x.link === hub);
    const quizRight = s.quiz.filter((qz, i) => state.quiz[`${id}:${i}`] === qz.correct).length;
    const quizDone = s.quiz.filter((_, i) => state.quiz[`${id}:${i}`] != null).length;

    // 基本情報（時間・料金・行き方・こんな人におすすめ）
    if (sub === "info") {
      markRead(`s:${id}:info`);
      return {
        title: s.name, fav: `spot:${id}`,
        html: `${crumb(hub, s.name, "基本情報")}<h2 class="sub-h">基本情報</h2>
        <div class="card"><table class="kv">${s.basics.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`).join("")}</table>
        <div class="tiny" style="margin-top:6px">料金・時間は2026年11月時点の調べ。出発前にもう一度確認します。</div></div>
        ${lf ? whoHtml(lf) : ""}
        <div class="pills" style="margin:10px 0 0">${s.themes.map((t) => `<a class="pill" href="#/search?f=${encodeURIComponent(t)}">${esc(t)}</a>`).join("")}${s.times.map((t) => `<span class="pill jade">${t}</span>`).join("")}</div>
        ${pagerHtml(null, sec(0), { href: hub, title: "目次にもどる" })}${fab}`,
      };
    }
    // クイズ
    if (sub === "quiz") {
      return {
        title: s.name, fav: `spot:${id}`,
        html: `${crumb(hub, s.name, "クイズ")}<h2 class="sub-h">${esc(s.name)}クイズ</h2>
        <section class="card">${s.quiz.map((qz, i) => quizHtml(`${id}:${i}`, qz)).join('<hr style="border:0;border-top:1px solid var(--line);margin:14px 0">')}</section>
        ${quizDone ? `<p class="muted" style="text-align:center">${s.quiz.length}問中 <b>${quizRight}</b>問正解</p>` : ""}
        ${pagerHtml(sec(n - 1), { href: "#/tools/quiz", title: "ほかの場所のクイズ" }, { href: hub, title: "目次にもどる" })}${fab}`,
      };
    }
    // 章のページ
    if (sub != null && s.sections[+sub]) {
      const i = +sub, x = s.sections[i];
      markRead(`s:${id}:${i}`); state.last = { k: "s", id, i }; save("last");
      return {
        title: s.name, fav: `spot:${id}`,
        html: `${crumb(hub, s.name, `${i + 1} / ${n}`)}<h2 class="sub-h">${esc(x.h)}</h2>
        <div class="card article">${linkify(x.html)}</div>
        ${pagerHtml(i > 0 ? sec(i - 1) : { href: `${hub}/info`, title: "基本情報" }, i < n - 1 ? sec(i + 1) : { href: `${hub}/quiz`, title: `${s.name}クイズ` }, { href: hub, title: "目次にもどる" })}${fab}`,
      };
    }

    // 目次（入口）
    const color = spotColor(id);
    const amap = `https://uri.amap.com/search?keyword=${encodeURIComponent(s.zh)}&city=${encodeURIComponent("上海")}`;
    const apple = `https://maps.apple.com/?q=${encodeURIComponent(s.zh)}&ll=${s.lat},${s.lng}`;
    const opts = allOptions().filter((o) => o.spot === id);
    const p = progressOf("s", id);
    const ni = nextUnread("s", id);
    const near = FINDS.filter((f) => f.id !== id && f.link !== hub && hasPos(f)).map((f) => ({ f, d: kmBetween(s.lat, s.lng, f.lat, f.lng) })).sort((a, b) => a.d - b.d).slice(0, 6).map((o) => o.f);
    const terms = Object.entries(TERMS).filter(([tid]) => s.sections.some((x) => x.html.includes(`term:${tid}|`)));
    return {
      title: s.name, fav: `spot:${id}`,
      html: `
      ${pageHead({ color, icon: SPOT_IC[id] || "map-pin", kicker: s.area && s.area !== s.name ? `詳しい解説・${s.area}` : "詳しい解説", title: s.name, sub: s.read, lead: s.catch })}
      <div class="actions">
        <button class="action" data-act="show-taxi" data-zh="${esc(s.zh)}" data-addr="${esc(taxiAddr)}" data-ja="${esc(s.name)}"><i class="ph ph-taxi"></i> タクシーに見せる</button>
        <a class="action" href="${amap}" target="_blank" rel="noopener"><i class="ph ph-map-trifold"></i> 高徳地図</a>
        <a class="action" href="${apple}" target="_blank" rel="noopener"><i class="ph ph-map-pin"></i> Appleマップ</a>
        <a class="action" href="#/map?focus=${id}"><i class="ph ph-map-pin-line"></i> 位置関係</a>
      </div>
      ${lf ? glanceHtml(lf) : ""}
      ${progressHtml(p, ni >= 0 ? { href: `${hub}/${ni}`, title: `${ni + 1}. ${s.sections[ni].h}` } : null)}
      <div class="card menu">
        ${mrow({ href: `${hub}/info`, icon: "info", title: "基本情報", sub: "時間・料金・行き方・こんな人におすすめ", read: isRead(`s:${id}:info`) })}
        ${s.sections.map((x, i) => mrow({ href: `${hub}/${i}`, n: i + 1, title: x.h, sub: preview(x.html), read: isRead(`s:${id}:${i}`), meta: `${readMin(x.html)}分` })).join("")}
        ${mrow({ href: `${hub}/quiz`, icon: "question", title: `${s.name}クイズ`, sub: quizDone ? `${s.quiz.length}問中 ${quizRight}問正解` : `${s.quiz.length}問・4人で遊べる`, read: quizDone === s.quiz.length })}
      </div>
      ${opts.length ? `<div class="section-title">この場所が入る予定の候補</div><div class="card related">${opts.map((o) => `<a href="#/plan/${o.dayIndex}/${o.slot.id}">${esc(o.day.label)} ${esc(o.slot.title)}：${esc(o.title)}</a>`).join("")}</div>` : ""}
      ${near.length ? `<div class="section-title">近くの発見</div><div class="hscroll">${near.map(findCard).join("")}</div>` : ""}
      <div class="section-title">関係する読み物</div>
      <div class="card related"><a href="#/article/why">${esc(ARTICLES.why.title)}</a>${terms.map(([tid, t]) => `<a href="#/term/${tid}">用語：${esc(t.name)}</a>`).join("")}</div>
      ${fab}`,
    };
  };

  function quizHtml(key, q) {
    const ans = state.quiz[key];
    return `<div class="quiz-q">${esc(q.q)}</div><div class="quiz-a">${q.a.map((a, i) => {
      let cls = ""; if (ans != null) { if (i === q.correct) cls = "right"; else if (i === ans) cls = "wrong"; }
      return `<button class="${cls}" data-act="quiz" data-key="${key}" data-i="${i}" ${ans != null ? "disabled" : ""}>${esc(a)}</button>`;
    }).join("")}</div>${ans != null ? `<div class="quiz-ex">${ans === q.correct ? "正解！" : "残念"} ${esc(q.ex)}</div>` : ""}`;
  }

  /* ---------------- 読み物：目次 → 章ごとのページ ／ 用語 ／ 読むものの一覧 ---------------- */
  PAGES.article = (args) => {
    const id = args[0]; const a = ARTICLES[id];
    if (!a) return notFound;
    const { intro, chapters } = chaptersOf(id);
    const n = chapters.length;
    const hub = `#/article/${id}`;
    const ch = (i) => ({ href: `${hub}/${i}`, title: chapters[i].h });
    const sub = args[1];
    if (sub != null && chapters[+sub]) {
      const i = +sub, c = chapters[i];
      markRead(`a:${id}:${i}`); state.last = { k: "a", id, i }; save("last");
      return {
        title: a.title, fav: `article:${id}`,
        html: `${crumb(hub, a.title, `${i + 1} / ${n}`)}<h2 class="sub-h">${esc(c.h)}</h2>
        <div class="card article">${linkify(c.html)}</div>
        ${pagerHtml(i > 0 ? ch(i - 1) : null, i < n - 1 ? ch(i + 1) : { href: "#/reads/article", title: "ほかの読み物" }, { href: hub, title: "目次にもどる" })}`,
      };
    }
    if (!n) markRead(`a:${id}:0`); // 章のない短い読み物は、開いたら読んだことにする
    const p = progressOf("a", id);
    const ni = n ? nextUnread("a", id) : -1;
    return {
      title: a.title, fav: `article:${id}`,
      html: `${pageHead({ color: a.hero?.color ?? "red", icon: ART_IC[id] || "book-open-text", kicker: "読み物", title: a.title, lead: a.lead })}
      <div class="pills" style="margin:14px 0 6px">${a.themes.map((t) => `<a class="pill" href="#/search?f=${encodeURIComponent(t)}">${esc(t)}</a>`).join("")}</div>
      ${intro ? `<div class="card article">${linkify(intro)}</div>` : ""}
      ${n ? `${progressHtml(p, ni >= 0 ? { href: `${hub}/${ni}`, title: `${ni + 1}. ${chapters[ni].h}` } : null)}
      <div class="card menu">${chapters.map((c, i) => mrow({ href: `${hub}/${i}`, n: i + 1, title: c.h, sub: preview(c.html), read: isRead(`a:${id}:${i}`), meta: `${readMin(c.html)}分` })).join("")}</div>` : ""}`,
    };
  };
  PAGES.term = (args) => {
    const t = TERMS[args[0]];
    if (!t) return notFound;
    markRead(`t:${args[0]}`);
    const usedIn = Object.entries(SPOTS).filter(([, s]) => s.sections.some((x) => x.html.includes(`term:${args[0]}|`)));
    return {
      title: t.name, fav: `term:${args[0]}`,
      html: `${pageHead({ color: "gold", icon: "bookmark-simple", kicker: "用語", title: t.name, sub: t.read })}
      <div class="card article">${linkify(t.html)}</div>
      ${t.see.length || usedIn.length ? `<div class="section-title">あわせて読む</div><div class="card related">
        ${usedIn.map(([sid, s]) => `<a href="#/spot/${sid}">スポット：${esc(s.name)}</a>`).join("")}
        ${t.see.filter((x) => TERMS[x]).map((x) => `<a href="#/term/${x}">用語：${esc(TERMS[x].name)}</a>`).join("")}</div>` : ""}`,
    };
  };

  // 読むものの一覧（読み物・詳しい解説・用語）。それぞれ何章読んだかが分かる
  PAGES.reads = (args) => {
    const tab = ["article", "spot", "term"].includes(args[0]) ? args[0] : "article";
    const row = (href, icon, color, title, text, p) => `<a class="rrow" href="${href}">
        <span class="rr-thumb c-${color || "navy"}"><i class="ph ph-${icon}"></i></span>
        <span class="rr-body"><b>${esc(title)}</b><small>${esc(text)}</small>
        <span class="rr-prog"><span class="bar"><i style="width:${Math.round((p.done / p.total) * 100)}%"></i></span><em>${p.done >= p.total ? "読んだ" : `${p.done}/${p.total}章`}</em></span></span>
        <i class="ph ph-caret-right mr-go"></i></a>`;
    let list = "";
    if (tab === "article") list = Object.entries(ARTICLES).map(([id, a]) => row(`#/article/${id}`, ART_IC[id] || "book-open-text", a.hero?.color ?? "red", a.title, a.lead, progressOf("a", id))).join("");
    if (tab === "spot") list = Object.entries(SPOTS).map(([id, s]) => row(`#/spot/${id}`, SPOT_IC[id] || "map-pin", spotColor(id), s.name, s.catch, progressOf("s", id))).join("");
    if (tab === "term") list = Object.entries(TERMS).map(([id, t]) => mrow({ href: `#/term/${id}`, icon: "bookmark-simple", title: t.name, sub: preview(t.html, 40), read: isRead(`t:${id}`) })).join("");
    const tabs = [["article", "読み物", Object.keys(ARTICLES).length], ["spot", "詳しい解説", Object.keys(SPOTS).length], ["term", "用語", Object.keys(TERMS).length]];
    return {
      title: "読む",
      html: `<div class="seg seg-full">${tabs.map(([k, l, c]) => `<a class="${tab === k ? "on" : ""}" href="#/reads/${k}">${l} <small>${c}</small></a>`).join("")}</div>
      <div class="card menu">${list}</div>
      <p class="tiny">開いた章には✓がつきます。読んだ印はこのスマホにだけ保存されます。</p>`,
    };
  };

  /* ---------------- 発見の詳しいページ（「もっと詳しく」はタップで開く） ---------------- */
  PAGES.find = (args) => {
    const f = FINDS.find((x) => x.id === args[0]);
    if (!f) return notFound;
    if (f.link) return { title: f.name, html: `<a class="cta" href="${f.link}"><i class="ph ph-book-open-text"></i> 詳しい解説ページを開く</a>` };
    markRead(`f:${f.id}`);
    const c = FIND_CATS[f.cat];
    const far = howFar(f);
    const zhMain = f.zh.split(/\s*[／/]\s*/)[0];
    const amap = `https://uri.amap.com/search?keyword=${encodeURIComponent(zhMain)}&city=${encodeURIComponent("上海")}`;
    const apple = hasPos(f) ? `https://maps.apple.com/?q=${encodeURIComponent(zhMain)}&ll=${f.lat},${f.lng}` : null;
    const near = hasPos(f) ? FINDS.filter((x) => x.id !== f.id && hasPos(x)).map((x) => ({ x, d: kmBetween(f.lat, f.lng, x.lat, x.lng) })).sort((a, b) => a.d - b.d).slice(0, 6).map((o) => o.x) : [];
    const same = FINDS.filter((x) => x.id !== f.id && x.cat === f.cat);
    const list = (arr) => `<ul>${arr.map((t) => `<li>${t}</li>`).join("")}</ul>`;
    return {
      title: f.name, fav: `find:${f.id}`,
      html: `
      ${pageHead({ color: c.color || "navy", icon: c.icon, kicker: c.label, title: f.name, lead: f.catch })}
      <div class="fc-badges" style="margin:14px 0 2px">${badgesOf(f).map(badgeHtml).join("")}</div>
      <div class="actions">
        <button class="action" data-act="show-taxi" data-zh="${esc(zhMain)}" data-addr="" data-ja="${esc(f.name)}"><i class="ph ph-taxi"></i> タクシーに見せる</button>
        <a class="action" href="${amap}" target="_blank" rel="noopener"><i class="ph ph-map-trifold"></i> 高徳地図</a>
        ${apple ? `<a class="action" href="${apple}" target="_blank" rel="noopener"><i class="ph ph-map-pin"></i> Appleマップ</a>` : ""}
        ${hasPos(f) ? `<a class="action" href="#/map?focus=f:${f.id}"><i class="ph ph-map-pin-line"></i> 位置関係</a>` : ""}
      </div>
      <button class="cta add" data-act="add-open" data-find="${f.id}"><i class="ph ph-calendar-plus"></i> 予定の候補に入れる${(() => { const k = Object.values(state.custom).filter((a) => a.includes(f.id)).length; return k ? `<small>（${k}か所に追加済み）</small>` : ""; })()}</button>
      ${glanceHtml(f)}
      ${whoHtml(f)}
      ${f.more && SPOTS[f.more] ? `<a class="cta alt" href="#/spot/${f.more}"><i class="ph ph-book-open-text"></i><span>このエリアの詳しい解説<br><b>${esc(SPOTS[f.more].name)}</b></span><i class="ph ph-caret-right"></i></a>` : ""}
      <div class="article">
        ${f.about ? `<section class="card"><h3>どんな所</h3>${f.about}</section>` : ""}
        ${f.points?.length ? `<section class="card"><h3>ここが面白い</h3>${list(f.points)}</section>` : ""}
      </div>
      <div class="card acc-list">
        ${accHtml(`<span class="acc-t"><b>基本情報</b><small>場所・時間・料金・ホテルから</small></span>`, `<table class="kv">${(f.basics || []).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`).join("")}${far ? `<tr><th>ホテルから</th><td>${far.replace(/^ホテルから/, "")}（目安）</td></tr>` : ""}</table><div class="tiny" style="margin-top:6px">2026年11月時点の調べ。料金・時間は行く前に確認します。</div>`)}
        ${(f.deep || []).map((d) => accHtml(`<span class="acc-t"><b>${esc(d.h)}</b><small>もっと詳しく・${readMin(d.html)}分</small></span>`, `<div class="article">${d.html}</div>`)).join("")}
        ${f.japan ? accHtml(`<span class="acc-t"><b>日本とのつながり</b></span>`, `<p>${f.japan}</p>`) : ""}
        ${f.tips?.length ? accHtml(`<span class="acc-t"><b>楽しみ方のコツ</b><small>${f.tips.length}つ</small></span>`, list(f.tips)) : ""}
      </div>
      <p class="tiny">見出しをタップすると開きます。</p>
      ${near.length ? `<div class="section-title">近くの発見</div><div class="hscroll">${near.map(findCard).join("")}</div>` : ""}
      ${same.length ? `<div class="section-title">ほかの「${esc(c.label)}」 <small><a href="#/search?c=${f.cat}">すべて ›</a></small></div><div class="hscroll">${same.map(findCard).join("")}</div>` : ""}
      <button class="dice" data-act="random" style="margin-top:18px"><i class="ph ph-shuffle"></i> ほかのものをランダムで発見する</button>`,
    };
  };

  /* ---------------- 探す（発見のタブ）：入口だけを並べ、タップで一覧へ ---------------- */
  function searchIndex() {
    const items = [];
    Object.entries(SPOTS).forEach(([id, s]) => items.push({ type: "スポット", cls: "red", href: `#/spot/${id}`, title: s.name, sub: s.catch, text: [s.name, s.zh, s.en, s.read, s.catch, ...s.sections.map((x) => x.h + " " + strip(x.html))].join(" "), facets: [...s.purposes, ...s.themes, ...s.times, s.area] }));
    Object.entries(ARTICLES).forEach(([id, a]) => items.push({ type: "読み物", cls: "", href: `#/article/${id}`, title: a.title, sub: a.lead, text: a.title + " " + a.lead + " " + strip(a.html), facets: [...a.themes, "学ぶ"] }));
    Object.entries(TERMS).forEach(([id, t]) => items.push({ type: "用語", cls: "gray", href: `#/term/${id}`, title: t.name, sub: strip(t.html).slice(0, 60) + "…", text: t.name + " " + t.read + " " + strip(t.html), facets: ["学ぶ", "歴史"] }));
    DISNEY.rides.forEach((r) => items.push({ type: "ディズニー", cls: "rose", href: `#/disney/ride/${r.id}`, title: r.name, sub: r.text, text: [r.name, r.zh, r.text, r.look, r.note, r.tip || "", "ディズニー 乗り物 アトラクション"].join(" "), facets: ["ディズニー"] }));
    DISNEY.shows.forEach((s) => items.push({ type: "ディズニー", cls: "rose", href: `#/disney/shows?o=${s.id}`, title: s.name, sub: s.text, text: [s.name, s.zh, s.text, s.place, s.when, "ディズニー ショー パレード"].join(" "), facets: ["ディズニー"] }));
    allOptions().forEach((o) => items.push({ type: "予定の候補", cls: "jade", href: `#/plan/${o.dayIndex}/${o.slot.id}`, title: o.title, sub: `${o.day.label} ${o.slot.title}・${o.why || ""}`, text: [o.title, o.why, o.look, o.move].join(" "), facets: o.tags || [] }));
    [["タクシーに見せる", "#/tools/taxi", "行き先を中国語で大きく表示"], ["お店で見せる", "#/tools/phrase", "パクチー抜き・八角抜き 不要香菜"], ["為替の計算", "#/tools/rate", "人民元 円 換算"], ["緊急連絡先", "#/tools/emergency", "警察 救急 総領事館"], ["持ち物・準備チェック", "#/tools/check", "持ち物 準備 Alipay eSIM"]]
      .forEach(([t, h, x]) => items.push({ type: "ツール", cls: "gray", href: h, title: t, sub: x, text: t + " " + x, facets: [] }));
    PHRASES.forEach((p) => items.push({ type: "フレーズ", cls: "gray", href: "#/tools/phrase", title: p.ja, sub: p.zh + "  " + p.py, text: p.ja + p.zh + p.py, facets: [] }));
    return items;
  }
  function dailyPicks(k = 8) { // 毎日入れかわる「今日のおすすめ」（ジャンルが偏らないように飛ばしながら選ぶ）
    const pool = FINDS.filter((f) => !f.link);
    const start = (Math.floor(now().getTime() / 86400000) * k) % pool.length;
    const out = []; for (let i = 0; out.length < Math.min(k, pool.length) && i < pool.length * 2; i++) { const f = pool[(start + i * 7) % pool.length]; if (!out.includes(f)) out.push(f); }
    return out;
  }
  PAGES.search = (_, q) => {
    const kw = (q.get("q") || "").trim();
    const cat = q.get("c") || "";
    const bad = q.get("b") || "";
    const fit = q.get("p") || "";
    const unseen = q.get("u") === "1";
    const f = q.getAll("f");
    const filtering = !!(kw || cat || bad || fit || unseen || f.length);
    const linkTo = (o) => { const v = { q: kw, c: cat, b: bad, p: fit, u: unseen ? "1" : "", ...o }; const p = new URLSearchParams(); Object.entries(v).forEach(([k, val]) => val && p.set(k, val)); p.set("keep", "1"); return "#/search?" + p.toString(); };
    const hl = (t) => { const e = esc(t); if (!kw) return e; const k = esc(kw).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); return e.replace(new RegExp(k, "gi"), (m) => `<mark>${m}</mark>`); };
    const snippet = (it) => { if (!kw) return it.sub; const i = it.text.toLowerCase().indexOf(kw.toLowerCase()); if (i < 0 || it.sub.includes(kw)) return it.sub; return "…" + it.text.slice(Math.max(0, i - 24), i + 40) + "…"; };
    const chipHref = (val) => { const set = new Set(f); set.has(val) ? set.delete(val) : set.add(val); const p = new URLSearchParams(); if (kw) p.set("q", kw); set.forEach((x) => p.append("f", x)); p.set("keep", "1"); return "#/search?" + p.toString(); };
    const seenN = FINDS.filter(seenOf).length;

    const top = `
      <div class="searchbox"><input id="kw" type="search" placeholder="スポット・料理・お土産・用語を検索" value="${esc(kw)}" enterkeyhint="search"></div>
      <div class="disc-top"><button class="dice" data-act="random"><i class="ph ph-shuffle"></i> ランダムで1つ発見</button><a class="favlink" href="#/favs"><i class="ph ph-star"></i> 気になる ${state.favs.filter((k) => k.startsWith("find:")).length}</a></div>
      <div class="cats">${Object.entries(FIND_CATS).map(([k, c]) => `<a class="pp ${cat === k ? "on" : ""}" href="${linkTo({ c: cat === k ? "" : k })}"><span class="pp-ic c-${c.color || "navy"}"><i class="ph ph-${c.icon}"></i></span>${c.label}</a>`).join("")}</div>
      <div class="chips badge-chips">${Object.entries(FIND_BADGES).map(([k, b]) => `<a class="chip ${bad === k ? "on" : ""}" href="${linkTo({ b: bad === k ? "" : k })}"><i class="ph ph-${b.icon}"></i> ${b.label}</a>`).join("")}<a class="chip ${unseen ? "on" : ""}" href="${linkTo({ u: unseen ? "" : "1" })}"><i class="ph ph-eye-slash"></i> まだ見ていない</a></div>
      <div class="label-s" style="margin:16px 2px 8px">こんな人に</div>
      <div class="fit-scroll">${Object.entries(FIND_FITS).map(([k, x]) => `<a class="fit ${fit === k ? "on" : ""}" href="${linkTo({ p: fit === k ? "" : k })}"><i class="ph ph-${x.icon}"></i>${x.label}</a>`).join("")}</div>`;

    let body = "";
    if (filtering) {
      let fr = FINDS.filter((x) => (!cat || x.cat === cat) && (!bad || badgesOf(x).includes(bad)) && (!fit || fitsOf(x).includes(fit)) && (!unseen || !seenOf(x)) && (!kw || findText(x).toLowerCase().includes(kw.toLowerCase())));
      if (f.length) fr = [];
      if (bad === "near") fr.sort((x, y) => distKm(x) - distKm(y));
      const others = (kw || f.length) && !cat && !bad && !fit && !unseen ? searchIndex().filter((it) => (!kw || it.text.toLowerCase().includes(kw.toLowerCase())) && f.every((x) => it.facets.includes(x))) : [];
      const label = [cat && FIND_CATS[cat].label, bad && FIND_BADGES[bad].label, fit && FIND_FITS[fit].label, unseen && "まだ見ていない", kw && `「${kw}」`, ...f].filter(Boolean).join(" × ");
      const seenIn = fr.filter(seenOf).length;
      body = `<div class="section-title">${esc(label)}：${fr.length + others.length} 件 <small><a href="#/search">条件をクリア</a></small></div>
        ${fr.length && !unseen ? `<p class="tiny" style="margin:-4px 2px 8px">このうち見たもの ${seenIn} 件（✓がついています）</p>` : ""}
        ${fr.length ? `<div class="card list-card">${fr.map(findRow).join("")}</div>` : ""}
        ${others.length ? `<div class="label-s">解説・用語・ツール</div><div class="card" style="padding:0 14px">${others.map((it) => `<a class="result" href="${it.href}"><span class="pill type ${it.cls}">${it.type}</span><div><h4>${hl(it.title)}</h4><p>${hl(snippet(it))}</p></div></a>`).join("")}</div>` : ""}
        ${!fr.length && !others.length ? `<div class="empty">${unseen ? "全部見ました！" : "見つかりませんでした。"}<br><span class="tiny">別の言葉や条件で試してください</span></div>` : ""}`;
    } else {
      body = `
        <a class="seen-card" href="${linkTo({ u: "1" })}">
          <span class="sc-num"><b>${seenN}</b><small>/ ${FINDS.length}</small></span>
          <span class="sc-body"><b>見た発見</b><span class="bar"><i style="width:${Math.round((seenN / FINDS.length) * 100)}%"></i></span><small>まだ見ていない ${FINDS.length - seenN} 件を一覧で見る</small></span>
          <i class="ph ph-caret-right"></i></a>
        ${(() => { const c = continueItem(); return c ? `<a class="nextup cont-home" href="${c.href}"><span class="nu-ic"><i class="ph ph-play-circle"></i></span><span class="nu-body"><small>つづきから読む ・ ${esc(c.name)}</small><b>${esc(c.title)}</b></span><i class="ph ph-caret-right"></i></a>` : ""; })()}
        <div class="section-title">今日の発見 <small>毎日入れかわる</small></div>
        <div class="hscroll">${dailyPicks().map(findCard).join("")}</div>
        <div class="section-title">読む</div>
        ${readTiles()}
        <details class="more-facets"><summary>テーマ・エリア・時間帯で解説を探す</summary>
          ${Object.entries(FACETS).map(([name, vals], gi) => `<div class="facet"><h4>${name}</h4><div class="chips">${vals.map((v, i) => `<a class="chip dot d${(gi * 3 + i) % 6} ${f.includes(v) ? "on" : ""}" href="${chipHref(v)}">${esc(v)}</a>`).join("")}</div></div>`).join("")}
        </details>
        ${state.hist.length ? `<div class="section-title">最近見たページ</div><div class="card related">${state.hist.slice(0, 5).map((h) => `<a href="${hrefOfKey(h.key)}">${esc(h.title)}</a>`).join("")}</div>` : ""}`;
    }

    return {
      title: "発見",
      html: top + body,
      after() {
        const inp = $("#kw");
        let timer;
        inp.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => {
          const p = new URLSearchParams(); if (inp.value) p.set("q", inp.value); if (cat) p.set("c", cat); if (bad) p.set("b", bad); if (fit) p.set("p", fit); if (unseen) p.set("u", "1"); f.forEach((x) => p.append("f", x)); p.set("keep", "1");
          history.replaceState(null, "", "#/search?" + p.toString()); render(); const n = $("#kw"); n.focus(); n.setSelectionRange(n.value.length, n.value.length);
        }, 250); });
      },
    };
  };

  /* ---------------- 地図（OpenStreetMap のデータをしおりの中に保存して描く。外部の地図サービスには頼らない） ---------------- */
  const W = 600, H = 560;
  const HOME_VIEW = { lat: 31.2350, lng: 121.4830, zoom: 1 };
  const MAPV = { ...HOME_VIEW };
  const BASE_SPAN = 0.07; // zoom 1 のときの東西の幅（経度）
  const COSLAT = Math.cos((31.23 * Math.PI) / 180);
  function viewBounds(v = MAPV) {
    const spanLng = BASE_SPAN / v.zoom, spanLat = spanLng * COSLAT * (H / W);
    return { minLng: v.lng - spanLng / 2, maxLng: v.lng + spanLng / 2, minLat: v.lat - spanLat / 2, maxLat: v.lat + spanLat / 2 };
  }
  let B = viewBounds();
  const px = (lat, lng) => [((lng - B.minLng) / (B.maxLng - B.minLng)) * W, ((B.maxLat - lat) / (B.maxLat - B.minLat)) * H];
  const path = (pts) => pts.map(([la, ln], i) => { const [x, y] = px(la, ln); return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`; }).join(" ");
  const inView = (lat, lng, b = B) => lat > b.minLat && lat < b.maxLat && lng > b.minLng && lng < b.maxLng;
  const metersPerPx = () => ((B.maxLng - B.minLng) * 111320 * COSLAT) / W;
  const ROAD_LABELS = ["南京西路", "延安東路", "人民路", "中華路", "中山東一路", "西藏中路", "淮海中路", "世紀大道", "四川北路", "楊樹浦路", "浦東南路", "北京東路"];

  PAGES.map = (_, q) => {
    B = viewBounds();
    const old = q.get("old") === "1";
    const dayI = q.get("day");
    const focus = q.get("focus");
    let route = "";
    if (dayI != null && PLAN[+dayI]) {
      const pts = [[TRIP.hotel.lat, TRIP.hotel.lng]];
      PLAN[+dayI].slots.forEach((s) => { const o = chosenOf(s); if (o?.lat) pts.push([o.lat, o.lng]); });
      pts.push([TRIP.hotel.lat, TRIP.hotel.lng]);
      if (pts.length > 2) route = `<path d="${path(pts)}" fill="none" stroke="#b5332a" stroke-width="3" stroke-dasharray="7 6" stroke-linecap="round"/>`;
    }
    const mpp = metersPerPx();
    const rivers = MAPDATA.rivers.map((r) => `<path d="${path(r.pts)}" fill="none" stroke="#bcd8f2" stroke-width="${Math.max(r.name === "黄浦江" ? 10 : 3, r.w / mpp).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>`).join("");
    const roads = Object.values(MAPDATA.roads).flat().map((pts) => `<path d="${path(pts)}" fill="none" stroke="#dfe3ea" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`).join("");
    const roadLabels = MAPV.zoom >= 0.9 ? ROAD_LABELS.map((n) => {
      const segs = MAPDATA.roads[n]; if (!segs) return "";
      const longest = segs.reduce((a, b) => (b.length > a.length ? b : a));
      const mid = longest[Math.floor(longest.length / 2)];
      if (!inView(mid[0], mid[1])) return "";
      const [x, y] = px(mid[0], mid[1]);
      return `<text x="${x}" y="${y}" class="road-label" text-anchor="middle">${n}</text>`;
    }).join("") : "";
    const riverLabels = [["黄浦江", 31.2205, 121.4985], ["蘇州河", 31.2460, 121.4650]].filter(([, la, ln]) => inView(la, ln)).map(([n, la, ln]) => { const [x, y] = px(la, ln); return `<text x="${x}" y="${y}" class="river-label" text-anchor="middle">${n}</text>`; }).join("");
    const sideLabels = [["浦西", 31.2530, 121.4620], ["浦東", 31.2220, 121.5160]].filter(([, la, ln]) => inView(la, ln)).map(([n, la, ln]) => { const [x, y] = px(la, ln); return `<text x="${x}" y="${y}" class="side-label">${n}</text>`; }).join("");

    const [rcx, rcy] = px(31.2328, 121.4693);
    const rr = 330 / mpp; // 競馬場（人民広場・人民公園）のおおよその広さ
    const oldLayer = old ? `
      <g>
        ${MAPDATA.oldwall.map((pts) => `<path d="${path(pts)}" fill="none" stroke="#2f6b5e" stroke-width="5" stroke-dasharray="2 6" stroke-linecap="round" opacity=".9"/>`).join("")}
        ${MAPDATA.yangjingbang.map((pts) => `<path d="${path(pts)}" fill="none" stroke="#3b7bbf" stroke-width="7" stroke-linecap="round" opacity=".5"/>`).join("")}
        <ellipse cx="${rcx}" cy="${rcy}" rx="${rr * 1.25}" ry="${rr}" fill="rgba(156,116,48,.15)" stroke="#9c7430" stroke-width="2"/>
        ${(() => { const [x, y] = px(31.2168, 121.4870); return `<text x="${x}" y="${y}" class="old-label" fill="#2f6b5e" text-anchor="middle">旧市街の城壁の跡（人民路・中華路）</text>`; })()}
        ${(() => { const [x, y] = px(31.2300, 121.4585); return `<text x="${x}" y="${y}" class="old-label" fill="#3b7bbf">洋涇浜（川）＝ 今の延安東路</text>`; })()}
        <text x="${rcx}" y="${rcy + rr + 16}" class="old-label" fill="#9c7430" text-anchor="middle">競馬場 → 人民広場</text>
        ${(() => { const [x, y] = px(31.2455, 121.4720); return `<text x="${x}" y="${y}" class="old-big">共同租界</text>`; })()}
        ${(() => { const [x, y] = px(31.2170, 121.4600); return `<text x="${x}" y="${y}" class="old-big">フランス租界</text>`; })()}
        ${(() => { const [x, y] = px(31.2272, 121.5125); return `<text x="${x}" y="${y}" class="old-label" fill="#5a6273">（倉庫・埠頭・畑）</text>`; })()}
      </g>` : "";

    const fFocus = focus && focus.startsWith("f:") ? focus.slice(2) : null;
    const dots = FINDS.filter((f) => hasPos(f) && !f.link && inView(f.lat, f.lng)).map((f) => {
      const [x, y] = px(f.lat, f.lng); const col = CAT_COLOR[FIND_CATS[f.cat].color || "navy"]; const on = fFocus === f.id;
      return `<g class="map-pin" data-act="pin" data-id="f:${f.id}">${on ? `<circle class="halo" cx="${x}" cy="${y}" r="18"/>` : ""}<circle cx="${x}" cy="${y}" r="${on ? 7 : 5.5}" fill="${col}" stroke="#fff" stroke-width="2"/>${on || MAPV.zoom >= 2 ? `<text x="${x + 9}" y="${y + 4}" class="dot-label">${esc(f.name.replace(/（.*?）/g, ""))}</text>` : ""}</g>`;
    }).join("");
    const pins = PLACES.filter((p) => inView(p.lat, p.lng)).map((p) => {
      const [x, y] = px(p.lat, p.lng);
      const isF = focus && (p.spot === focus || p.id === focus);
      const fill = p.kind === "hotel" ? "#1f3350" : p.spot ? "#b5332a" : "#9c7430";
      return `<g class="map-pin" data-act="pin" data-id="${p.id}">${isF ? `<circle class="halo" cx="${x}" cy="${y}" r="22"/>` : ""}<circle cx="${x}" cy="${y}" r="${p.kind === "hotel" ? 9 : 7}" fill="${fill}" stroke="#fff" stroke-width="2.5"/>
        ${p.kind === "hotel" ? `<text x="${x}" y="${y + 3.5}" text-anchor="middle" font-size="9" fill="#fff" style="stroke:none">H</text>` : ""}
        <text x="${x + 11}" y="${y + 4}">${esc(p.name)}</text></g>`;
    }).join("");
    const homeB = viewBounds(HOME_VIEW);
    const outs = FINDS.filter((f) => hasPos(f) && !inView(f.lat, f.lng, homeB)).sort((a, b) => distKm(a) - distKm(b));
    const qs = (o) => { const p = new URLSearchParams(q); Object.entries(o).forEach(([k, v]) => (v == null ? p.delete(k) : p.set(k, v))); p.set("keep", "1"); return "#/map?" + p.toString(); };
    return {
      title: "地図",
      html: `
      <div class="seg"><a class="${!old ? "on" : ""}" href="${qs({ old: null })}">今の地図</a><a class="${old ? "on" : ""}" href="${qs({ old: "1" })}">昔の地図を重ねる</a></div>
      <div class="chips" style="margin-bottom:10px"><a class="chip ${dayI == null ? "on" : ""}" href="${qs({ day: null })}">ルートなし</a>${PLAN.map((d, i) => `<a class="chip ${dayI == i ? "on" : ""}" href="${qs({ day: i })}">${d.label}のルート</a>`).join("")}</div>
      <div class="mapwrap">
        <svg id="mapsvg" viewBox="0 0 ${W} ${H}" role="img" aria-label="上海中心部の地図">
          <rect width="${W}" height="${H}" fill="#f7f8fb"/>
          ${roads}
          ${rivers}
          ${roadLabels}${riverLabels}${sideLabels}
          ${oldLayer}
          ${route}
          ${dots}
          ${pins}
        </svg>
        <div class="map-ctrl">
          <button data-act="map-zoom" data-z="1.5" aria-label="拡大"><i class="ph ph-plus"></i></button>
          <button data-act="map-zoom" data-z="0.667" aria-label="縮小"><i class="ph ph-minus"></i></button>
          <button data-act="map-home" aria-label="ホテルのまわりに戻る"><i class="ph ph-crosshair"></i></button>
        </div>
        <div class="map-attr">© OpenStreetMap contributors</div>
      </div>
      <div class="map-legend">${Object.values(FIND_CATS).map((c) => `<span class="lg"><i style="background:${CAT_COLOR[c.color || "navy"]}"></i>${c.label}</span>`).join("")}<span class="lg"><i class="big" style="background:#b5332a"></i>解説のある場所</span></div>
      <div id="mapcard"></div>
      <div class="tiny" style="margin-top:8px">地図は1本の指でずらせます。2本の指で広げると拡大、つまむと縮小。拡大すると点に名前が出ます。川と道路は OpenStreetMap のデータをもとに描いています。</div>
      <div class="section-title">中心部の外 <small>近い順</small></div>
      <div class="card list-card">${outs.map(findRow).join("")}</div>
      <div class="offmap"><div><span><i class="ph ph-airplane"></i>浦東空港</span><span class="muted">ホテルから東へ約40km</span></div></div>`,
      after() {
        if (focus) {
          const t = focus.startsWith("f:") ? FINDS.find((f) => f.id === focus.slice(2)) : PLACES.find((p) => p.spot === focus || p.id === focus);
          if (t && hasPos(t) && !inView(t.lat, t.lng)) { MAPV.lat = t.lat; MAPV.lng = t.lng; keepRender(); return; }
          showPin(focus.startsWith("f:") ? focus : t?.id);
        }
        // 指で動かす：1本でずらす。2本で広げると拡大、つまむと縮小（2本の指のまん中を中心に）
        const svg = $("#mapsvg"); if (!svg) return;
        const fingers = new Map(); // いま地図に触れている指 { pointerId: {x, y} }
        let st = null; // 1本でずらしているとき
        let pz = null; // 2本で拡大・縮小しているとき
        const clampZ = (z) => Math.min(5, Math.max(0.4, z));
        const two = () => { const [a, b] = [...fingers.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) }; };
        const capture = (id) => { try { svg.setPointerCapture(id); } catch {} };
        svg.addEventListener("pointerdown", (e) => {
          fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (fingers.size === 1) st = { x: e.clientX, y: e.clientY, lat: MAPV.lat, lng: MAPV.lng, drag: false, id: e.pointerId };
          if (fingers.size === 2) { // 2本目が触れたら、ずらすのをやめて拡大・縮小に切りかえる
            const m = two(), r = svg.getBoundingClientRect();
            pz = { m0: m, r, ox: m.x - r.left, oy: m.y - r.top, z0: MAPV.zoom, b0: viewBounds(), s: 1, dx: 0, dy: 0 };
            st = null;
            fingers.forEach((_, id) => capture(id));
            svg.style.transformOrigin = `${pz.ox}px ${pz.oy}px`;
          }
        });
        svg.addEventListener("pointermove", (e) => {
          if (!fingers.has(e.pointerId)) return;
          fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pz) { // 指を動かしている間は見た目だけ拡大・縮小し、指を離したら描き直す
            if (fingers.size < 2) return;
            const m = two();
            pz.s = clampZ(pz.z0 * (m.d / Math.max(1, pz.m0.d))) / pz.z0;
            pz.dx = m.x - pz.m0.x; pz.dy = m.y - pz.m0.y;
            svg.style.transform = `translate(${pz.dx}px, ${pz.dy}px) scale(${pz.s})`;
            return;
          }
          if (!st) return;
          const dx = e.clientX - st.x, dy = e.clientY - st.y;
          if (!st.drag && Math.hypot(dx, dy) > 6) { st.drag = true; capture(st.id); }
          if (st.drag) svg.style.transform = `translate(${dx}px, ${dy}px)`;
        });
        // 2本の指のまん中にあった場所が、離したときの指のまん中に来るように、拡大率と中心を決める
        const finishPinch = () => {
          const { r, ox, oy, b0, z0, s, dx, dy } = pz; pz = null;
          const lngP = b0.minLng + (ox / r.width) * (b0.maxLng - b0.minLng);
          const latP = b0.maxLat - (oy / r.height) * (b0.maxLat - b0.minLat);
          MAPV.zoom = clampZ(z0 * s);
          const nb = viewBounds({ lat: 0, lng: 0, zoom: MAPV.zoom });
          const spanLng = nb.maxLng - nb.minLng, spanLat = nb.maxLat - nb.minLat;
          MAPV.lng = lngP - ((ox + dx) / r.width) * spanLng + spanLng / 2;
          MAPV.lat = latP + ((oy + dy) / r.height) * spanLat - spanLat / 2;
          svg.style.transform = ""; svg.style.transformOrigin = "";
          keepRender();
        };
        const end = (e) => {
          const had = fingers.delete(e.pointerId);
          if (pz) { if (fingers.size < 2) finishPinch(); return; }
          if (!had || !st || e.pointerId !== st.id) return;
          if (st.drag && e.type === "pointerup") {
            const r = svg.getBoundingClientRect(); const dx = e.clientX - st.x, dy = e.clientY - st.y;
            MAPV.lng = st.lng - (dx / r.width) * (B.maxLng - B.minLng);
            MAPV.lat = st.lat + (dy / r.height) * (B.maxLat - B.minLat);
            svg.style.transform = ""; st = null; keepRender(); return;
          }
          svg.style.transform = ""; st = null;
        };
        svg.addEventListener("pointerup", end);
        svg.addEventListener("pointercancel", end);
        svg.addEventListener("gesturestart", (e) => e.preventDefault()); // iPhone：ページ全体が拡大されないように
        svg.addEventListener("wheel", (e) => { e.preventDefault(); MAPV.zoom = clampZ(MAPV.zoom * (e.deltaY < 0 ? 1.25 : 0.8)); keepRender(); }, { passive: false });
      },
    };
  };
  const CAT_COLOR = { red: "#b5332a", teal: "#2f6b8f", jade: "#2f6b5e", gold: "#9c7430", rose: "#b4507a", navy: "#1f3350" };
  function showPin(id) {
    if (id && id.startsWith("f:")) {
      const f = FINDS.find((x) => x.id === id.slice(2)); const box = $("#mapcard"); if (!f || !box) return;
      box.innerHTML = `<div class="card list-card map-card">${findRow(f)}</div>`; return;
    }
    const p = PLACES.find((x) => x.id === id); const box = $("#mapcard"); if (!p || !box) return;
    const s = p.spot && SPOTS[p.spot];
    box.innerHTML = `<div class="card map-card"><b>${esc(p.kind === "hotel" ? TRIP.hotel.name : p.name)}</b>
      <div class="muted">${s ? esc(s.catch) : p.kind === "hotel" ? esc(TRIP.hotel.addressJa) : "解説は次の版で追加します"}</div>
      ${s ? `<a class="toggle-link" href="#/spot/${p.spot}">解説を読む ›</a>` : ""}</div>`;
  }

  /* ---------------- ツール ---------------- */
  PAGES.tools = (args) => {
    const sub = args[0];
    if (sub && TOOLS[sub]) return TOOLS[sub](args[1]);
    const t = (href, ic, b, s) => `<a class="tool" href="${href}"><span class="ic"><i class="ph ph-${ic}"></i></span><b>${b}</b><small>${s}</small></a>`;
    return {
      title: "便利ツール",
      html: `<div class="section-title" style="margin-top:6px">旅行中によく使う</div>
      <div class="toolgrid">
        ${t("#/tools/taxi", "taxi", "タクシーに見せる", "行き先を中国語で大きく表示")}
        ${t("#/tools/phrase", "bowl-food", "お店で見せる", "パクチー抜き・八角抜きなど")}
        ${t("#/tools/rate", "currency-cny", "為替の計算", `1元 ≒ ${state.rate}円`)}
        ${t("#/tools/emergency", "siren", "緊急連絡先", "警察・救急・総領事館")}
      </div>
      <div class="section-title">準備と楽しみ</div>
      <div class="toolgrid">
        ${t("#/tools/check", "check-square", "準備・持ち物", "出発前のやることと持ち物")}
        ${t("#/tools/quiz", "question", "上海クイズ", "4人で遊べる")}
        ${t("#/favs", "star", "気になるリスト", `${state.favs.length} 件`)}
        ${t("#/tools/settings", "gear", "設定", "文字の大きさ・リセット")}
      </div>`,
    };
  };
  PAGES.favs = () => ({
    title: "気になるリスト",
    html: state.favs.length ? (() => {
      const finds = state.favs.filter((k) => k.startsWith("find:")).map((k) => FINDS.find((f) => f.id === k.slice(5))).filter(Boolean);
      const others = state.favs.filter((k) => !k.startsWith("find:"));
      return `${finds.length ? `<div class="label-s">気になる発見</div><div class="card list-card">${finds.map(findRow).join("")}</div>` : ""}
      ${others.length ? `<div class="label-s">解説・読み物</div><div class="card related">${others.map((k) => { const [t, id] = k.split(":"); const title = t === "spot" ? SPOTS[id]?.name : t === "article" ? ARTICLES[id]?.title : TERMS[id]?.name; return `<a href="${hrefOfKey(k)}">${esc(title || k)}</a>`; }).join("")}</div>` : ""}`;
    })() : `<div class="empty">気になる場所のページで、右上の星マークを押すと、ここに集まります</div>`,
  });

  const TOOLS = {
    taxi: () => ({
      title: "タクシーに見せる",
      html: `<p class="muted">タップすると全画面で大きく表示されます。運転手さんに画面を見せてください。</p>
      ${TAXI.map((t) => `<button class="list-btn" data-act="show-taxi" data-zh="${esc(t.zh)}" data-addr="${esc(t.addr)}" data-ja="${esc(t.ja)}"><div><div class="zh">${esc(t.zh)}</div><div class="ja">${esc(t.ja)}</div></div></button>`).join("")}
      <div class="card muted" style="font-size:.85rem">タクシーはDiDi（滴滴）アプリで呼ぶのが便利。4人＋荷物のときは大きめの車を選びます。</div>`,
    }),
    phrase: (cat) => { // 種類ごとのタブで切りかえる（食事・タクシー・困った…）
      const cats = [...new Set(PHRASES.map((p) => p.cat))];
      const cur = cats.includes(cat) ? cat : cats[0];
      return {
        title: "お店で見せる",
        html: `<div class="seg seg-full">${cats.map((c) => `<a class="${c === cur ? "on" : ""}" href="#/tools/phrase/${encodeURIComponent(c)}?keep=1">${c}<small>${PHRASES.filter((p) => p.cat === c).length}</small></a>`).join("")}</div>
        <p class="muted" style="margin:0 2px 10px">タップすると全画面で大きく表示されます。お店の人に画面を見せてください。</p>
        ${PHRASES.filter((p) => p.cat === cur).map((p) => `<button class="list-btn" data-act="show-phrase" data-zh="${esc(p.zh)}" data-py="${esc(p.py)}" data-ja="${esc(p.ja)}"><div><div class="zh">${esc(p.zh)}</div><div class="ja">${esc(p.ja)}・${esc(p.py)}</div></div></button>`).join("")}`,
      };
    },
    rate: () => ({
      title: "為替の計算",
      html: `<div class="card rate-box">
        <label>人民元（元）</label><input id="cny" type="number" inputmode="decimal" value="100">
        <label>日本円（円）</label><input id="jpy" type="number" inputmode="decimal" value="${Math.round(100 * state.rate)}">
        <div class="rate-quick">${[10, 30, 50, 100, 200, 500].map((v) => `<button class="chip" data-act="rate-q" data-v="${v}">${v}元</button>`).join("")}</div>
      </div>
      <div class="card"><label class="muted">レート（1元あたりの円）</label>
        <div style="display:flex;gap:8px;align-items:center;margin-top:6px"><input id="rate" type="number" step="0.1" inputmode="decimal" value="${state.rate}" style="flex:1;font-size:1.2rem;padding:8px 12px;border:1px solid var(--line);border-radius:10px"><span>円</span></div>
        <div class="tiny" style="margin-top:6px">目安の値です。両替やカードの明細を見て、自分で直せます。</div></div>
      <div class="card"><table class="rate-table">${[1, 5, 10, 20, 50, 100, 200, 500, 1000].map((v) => `<tr><td>${v} 元</td><td>約 ${Math.round(v * state.rate).toLocaleString()} 円</td></tr>`).join("")}</table></div>`,
      after() {
        const c = $("#cny"), j = $("#jpy"), r = $("#rate");
        c.addEventListener("input", () => { j.value = Math.round(+c.value * state.rate); });
        j.addEventListener("input", () => { c.value = Math.round((+j.value / state.rate) * 10) / 10; });
        r.addEventListener("change", () => { const v = +r.value; if (v > 0) { state.rate = v; save("rate"); toast("レートを保存しました"); render(); } });
      },
    }),
    emergency: () => ({
      title: "緊急連絡先",
      html: `<div class="card emg">${EMERGENCY.map((e) => `<a href="tel:${e.num.replace(/[^+\d]/g, "")}"><div><div>${esc(e.label)}</div>${e.note ? `<div class="tiny">${esc(e.note)}</div>` : ""}</div><b>${esc(e.num)}</b></a>`).join("")}</div>
      <div class="section-title">日本語が通じる病院 <small>ホテルから近い順（目安）</small></div>
      <div class="card acc-list">${HOSPITALS.map((h) => accHtml(`<span class="acc-t">${h.h24 ? `<span class="dz-tag t-new">24時間</span>` : ""}<b>${esc(h.name)}</b><small>${esc(h.area)}</small></span>`,
        `<table class="kv"><tr><th>住所</th><td>${esc(h.addr)}</td></tr><tr><th>時間</th><td>${esc(h.hours)}</td></tr><tr><th>言葉</th><td>${esc(h.lang)}</td></tr>${h.tel ? `<tr><th>電話</th><td>${h.tel.map((t) => `<a href="tel:${t.replace(/[^+\d]/g, "")}">${esc(t)}</a>`).join("<br>")}</td></tr>` : ""}${h.note ? `<tr><th>メモ</th><td>${esc(h.note)}</td></tr>` : ""}</table>
        <div class="hosp-act"><button class="action" data-act="show-taxi" data-zh="${esc(h.zh || h.addr)}" data-addr="${esc(h.zh ? h.addr : "")}" data-ja="${esc(h.name)}"><i class="ph ph-taxi"></i> タクシーに見せる</button></div>`)).join("")}</div>
      <p class="tiny">上海市政府の日本語サイト「上海における国際医療」（2026年11月17日更新）より。電話番号は確認できたものだけ載せています。行く前に、ホテルのフロントで確認してもらうと安心です。命に関わるときは120（救急車）。</p>
      <div class="card"><h3 style="font-size:1rem;margin-bottom:6px">病院に行くとき</h3><ul style="margin:0;font-size:.92rem"><li>パスポートを持っていく</li><li>海外旅行保険（クレジットカードに付いているものも）の連絡先と番号を、スマホに保存しておく</li><li>まずホテルのフロントに相談すると、病院への連絡やタクシーを頼みやすい</li></ul></div>
      <div class="card"><h3 style="font-size:1rem;margin-bottom:6px">パスポートを無くしたら</h3><ol style="margin:0;padding-left:1.2em;font-size:.92rem"><li>近くの警察（公安局）で紛失の証明をもらう</li><li>総領事館で帰国のための書類を申請する</li><li>出入境管理の窓口で手続きをする</li></ol><div class="tiny" style="margin-top:6px">詳しい手順は次の版で追加します。パスポートの写真をスマホに保存しておくと安心です。</div></div>`,
    }),
    check: (which) => { // 入口（2つのリスト）→ リストごとのページ
      const lists = Object.entries(CHECKLISTS);
      const doneOf = (k, l) => l.items.filter((it) => state.checks[ckey(k, it)]).length;
      const li = lists.findIndex(([k]) => k === which);
      if (li >= 0) {
        const [k, l] = lists[li], d = doneOf(k, l);
        const nb = (j) => lists[j] && { href: `#/tools/check/${lists[j][0]}`, title: lists[j][1].title };
        return {
          title: "準備・持ち物",
          html: `${crumb("#/tools/check", "準備・持ち物")}<h2 class="sub-h">${esc(l.title)}</h2>
          <div class="prog"><div class="prog-top"><span>済み <b>${d}</b> / ${l.items.length}</span>${d === l.items.length ? `<span class="prog-done"><i class="ph ph-check-circle"></i> 全部できました</span>` : ""}</div><span class="bar"><i style="width:${Math.round((d / l.items.length) * 100)}%"></i></span></div>
          <div class="card">${l.items.map((it) => `<div class="mission ${state.checks[ckey(k, it)] ? "on" : ""}" data-act="check" data-key="${ckey(k, it)}"><span class="check"></span><span>${esc(it)}</span></div>`).join("")}</div>
          ${pagerHtml(nb(li - 1), nb(li + 1), { href: "#/tools/check", title: "準備・持ち物にもどる" })}`,
        };
      }
      return {
        title: "準備・持ち物",
        html: `<div class="card menu">${lists.map(([k, l]) => { const d = doneOf(k, l); const next = l.items.find((it) => !state.checks[ckey(k, it)]); return mrow({ href: `#/tools/check/${k}`, icon: k === "prep" ? "calendar-check" : "suitcase", title: l.title, sub: next ? `つぎ：${next}` : "全部できました", read: !next, meta: `${d}/${l.items.length}` }); }).join("")}</div>
        <a class="cta alt" href="#/disney/prep"><i class="ph ph-castle-turret"></i><span><b>ディズニーの準備</b><br>チケット・アプリ・当日の持ち物</span><i class="ph ph-caret-right"></i></a>`,
      };
    },
    quiz: () => {
      const all = Object.entries(SPOTS).flatMap(([id, s]) => s.quiz.map((q, i) => ({ key: `${id}:${i}`, q, spot: s.name })));
      const answered = all.filter((x) => state.quiz[x.key] != null); const right = answered.filter((x) => state.quiz[x.key] === x.q.correct).length;
      return {
        title: "上海クイズ",
        html: `<div class="card" style="text-align:center"><div class="tiny">正解数（答えた ${answered.length} 問）</div><div class="quiz-score" style="font-size:2.2rem;color:var(--red)">${right} / ${all.length}</div><button class="toggle-link" data-act="quiz-reset">もう一度やる</button></div>
        <div class="card menu">${Object.entries(SPOTS).map(([id, sp]) => { const d = sp.quiz.filter((_, i) => state.quiz[`${id}:${i}`] != null).length; const r = sp.quiz.filter((qz, i) => state.quiz[`${id}:${i}`] === qz.correct).length; return mrow({ href: `#/spot/${id}/quiz`, icon: "question", title: sp.name, sub: d ? `${sp.quiz.length}問中 ${r}問正解` : `${sp.quiz.length}問`, read: d === sp.quiz.length, meta: `${d}/${sp.quiz.length}` }); }).join("")}</div>`,
      };
    },
    settings: () => ({
      title: "設定",
      html: `<div class="card"><b>文字の大きさ</b><div class="seg" style="margin:8px 0 0"><button class="${!state.large ? "on" : ""}" data-act="large" data-v="0">ふつう</button><button class="${state.large ? "on" : ""}" data-act="large" data-v="1">大きめ</button></div></div>
      <div class="card"><b>選んだ予定をリセット</b><div style="margin-top:8px"><button class="btn" data-act="reset-sel">すべての選択を消す</button></div></div>
      <div class="card"><b>読んだ印をリセット</b><div class="tiny" style="margin-top:2px">解説・読み物の✓と、発見の「見た」を消します</div><div style="margin-top:8px"><button class="btn" data-act="reset-read">読んだ印を消す</button></div></div>`,
    }),
  };

  /* ---------------- 発見 → 予定の候補に入れる ---------------- */
  function openAddSheet(fid) {
    const f = FINDS.find((x) => x.id === fid); if (!f) return;
    const el = document.createElement("div");
    el.className = "sheet-wrap";
    el.innerHTML = `<div class="sheet" role="dialog" aria-label="予定の候補に入れる">
      <div class="sheet-head"><b>「${esc(f.name)}」を、どの時間の候補に入れる？</b><button class="iconbtn" data-act="sheet-close" aria-label="閉じる">${IC.close}</button></div>
      ${PLAN.map((d) => `<div class="label-s" style="margin:14px 2px 6px">${d.label}（${d.dow}）${esc(d.title)}</div>
        ${d.slots.filter((sl) => sl.type !== "fixed").map((sl) => { const on = (state.custom[sl.id] || []).includes(fid); return `<button class="sheet-row ${on ? "on" : ""}" data-act="add-to" data-slot="${sl.id}" data-find="${fid}"><span class="sr-time">${sl.time}</span><span class="sr-title">${esc(sl.title)}</span>${on ? `<i class="ph ph-check-circle"></i>` : `<i class="ph ph-plus-circle"></i>`}</button>`; }).join("")}`).join("")}
      <p class="tiny" style="margin-top:12px">入れた候補は「予定」の画面で、ほかの候補と同じように選べます。</p>
    </div>`;
    el.addEventListener("click", (e) => { if (e.target === el) el.remove(); });
    document.body.appendChild(el);
  }

  /* ---------------- 全画面表示 ---------------- */
  function showBig({ zh, addr, ja, py }) {
    const el = document.createElement("div");
    el.className = "show";
    el.innerHTML = `<button class="iconbtn close" aria-label="閉じる">${IC.close}</button>
      <div class="zh">${esc(zh)}</div>${addr ? `<div class="addr">${esc(addr)}</div>` : ""}
      ${py ? `<div class="py">${esc(py)}</div>` : ""}<div class="ja">${esc(ja)}</div>
      <div class="hint">画面をタップすると閉じます</div>`;
    el.addEventListener("click", () => el.remove());
    document.body.appendChild(el);
  }

  /* ---------------- 操作 ---------------- */
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]"); if (!el) return;
    const a = el.dataset.act;
    if (a === "back") { history.length > 1 ? history.back() : (location.hash = "#/home"); }
    else if (a === "fav") { const k = el.dataset.key; state.favs = state.favs.includes(k) ? state.favs.filter((x) => x !== k) : [k, ...state.favs]; save("favs"); toast(state.favs.includes(k) ? "お気に入りに追加しました" : "お気に入りから外しました"); keepRender(); }
    else if (a === "share") { const d = { title: TRIP.title, url: location.href }; if (navigator.share) navigator.share(d).catch(() => {}); else { navigator.clipboard?.writeText(location.href); toast("URLをコピーしました"); } }
    else if (a === "pick") { if (e.target.closest("a")) return; const { slot, opt } = el.dataset; state.sel[slot] = state.sel[slot] === opt ? undefined : opt; save("sel"); keepRender(); }
    else if (a === "assign") { const { slot, opt, person } = el.dataset; const m = { ...(state.sel[slot] || {}) }; m[person] = m[person] === opt ? undefined : opt; state.sel[slot] = m; save("sel"); keepRender(); }
    else if (a === "mode") { e.preventDefault(); state.planMode = el.dataset.mode; save("planMode"); keepRender(); }
    else if (a === "check") { const k = el.dataset.key; state.checks[k] = !state.checks[k]; save("checks"); keepRender(); }
    else if (a === "quiz") { state.quiz[el.dataset.key] = +el.dataset.i; save("quiz"); keepRender(); }
    else if (a === "quiz-reset") { state.quiz = {}; save("quiz"); keepRender(); }
    else if (a === "acc") { const box = el.closest(".acc"); box.classList.toggle("open"); el.setAttribute("aria-expanded", box.classList.contains("open")); }
    else if (a === "fold") { const f = el.closest(".fold"); f.classList.toggle("closed"); el.textContent = f.classList.contains("closed") ? "もっと読む ▾" : "閉じる ▴"; }
    else if (a === "jump") { e.preventDefault(); const t = document.getElementById(el.dataset.to); if (t) window.scrollTo({ top: t.getBoundingClientRect().top + scrollY - 70, behavior: "smooth" }); }
    else if (a === "show-taxi" || a === "show-phrase") { showBig(el.dataset); }
    else if (a === "rate-q") { const v = +el.dataset.v; $("#cny").value = v; $("#jpy").value = Math.round(v * state.rate); }
    else if (a === "pin") { showPin(el.dataset.id); }
    else if (a === "random") { randomFind(); }
    else if (a === "map-zoom") { MAPV.zoom = Math.min(5, Math.max(0.4, MAPV.zoom * +el.dataset.z)); keepRender(); }
    else if (a === "map-home") { Object.assign(MAPV, HOME_VIEW); keepRender(); }
    else if (a === "add-open") { openAddSheet(el.dataset.find); }
    else if (a === "sheet-close") { el.closest(".sheet-wrap")?.remove(); }
    else if (a === "add-to") {
      const { slot, find } = el.dataset; const list = state.custom[slot] || [];
      state.custom[slot] = list.includes(find) ? list.filter((x) => x !== find) : [...list, find];
      if (!state.custom[slot].length) delete state.custom[slot];
      save("custom");
      const added = (state.custom[slot] || []).includes(find);
      const dayI = PLAN.findIndex((d) => d.slots.some((x) => x.id === slot));
      toast(added ? `${PLAN[dayI].label}の候補に入れました` : "候補から外しました");
      el.closest(".sheet-wrap")?.remove(); keepRender();
    }
    else if (a === "unadd") {
      const { slot, find } = el.dataset;
      state.custom[slot] = (state.custom[slot] || []).filter((x) => x !== find);
      if (!state.custom[slot].length) delete state.custom[slot];
      if (state.sel[slot] === "f:" + find) delete state.sel[slot];
      if (state.sel[slot] && typeof state.sel[slot] === "object") Object.keys(state.sel[slot]).forEach((k) => { if (state.sel[slot][k] === "f:" + find) delete state.sel[slot][k]; });
      save("custom"); save("sel"); toast("候補から外しました"); keepRender();
    }
    else if (a === "dwant") {
      const { ride, person } = el.dataset; const list = state.dwant[ride] || [];
      state.dwant[ride] = list.includes(person) ? list.filter((x) => x !== person) : [...list, person];
      if (!state.dwant[ride].length) delete state.dwant[ride];
      save("dwant"); keepRender();
    }
    else if (a === "dfilter") { dFilter = el.dataset.v; keepRender(); }
    else if (a === "large") { state.large = el.dataset.v === "1"; save("large"); applyLarge(); keepRender(); }
    else if (a === "reset-read") { if (confirm("読んだ印をすべて消しますか？")) { state.read = {}; save("read"); state.last = null; save("last"); toast("消しました"); keepRender(); } }
    else if (a === "reset-sel") { if (confirm("選んだ予定をすべて消しますか？")) { state.sel = {}; save("sel"); toast("リセットしました"); } }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches?.(".opt[data-act]")) e.target.click(); });

  function keepRender() { const y = scrollY; render(); window.scrollTo(0, y); }
  function applyLarge() { document.documentElement.classList.toggle("large", !!state.large); }

  window.addEventListener("hashchange", render);
  applyLarge();
  render();

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
