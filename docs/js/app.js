/* =========================================================
   上海旅行しおり — アプリ本体（試作版）
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
  };
  const save = (k) => store.set(k, state[k]);

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
  const allOptions = () => PLAN.flatMap((d, di) => d.slots.flatMap((s) => (s.options || []).map((o) => ({ ...o, slot: s, day: d, dayIndex: di }))));
  function chosenOf(slot) {
    if (slot.type === "choice") { const id = state.sel[slot.id]; return id ? slot.options.find((o) => o.id === id) : null; }
    return null;
  }
  function splitOf(slot) { return state.sel[slot.id] || {}; }
  function coveredMusts() {
    const set = new Set();
    PLAN.forEach((d) => d.slots.forEach((s) => {
      if (s.type === "choice") { const o = chosenOf(s); (o?.covers || []).forEach((c) => set.add(c)); }
      if (s.type === "split") { Object.values(splitOf(s)).forEach((oid) => { const o = s.options.find((x) => x.id === oid); (o?.covers || []).forEach((c) => set.add(c)); }); }
    }));
    return set;
  }
  function slotSummary(slot) { // タイムラインに出す文字
    if (slot.type === "fixed") return slot.title;
    if (slot.type === "choice") { const o = chosenOf(slot); return o ? o.title : null; }
    if (slot.type === "split") {
      const m = splitOf(slot); const parts = [];
      TRIP.members.forEach((p) => { if (slot.fixedFor?.[p.id]) parts.push(`${p.name}：ホテル`); else if (m[p.id]) parts.push(`${p.name}：${slot.options.find((o) => o.id === m[p.id])?.title}`); });
      return parts.length ? parts.join(" ／ ") : null;
    }
  }

  /* ---------------- アイコン ---------------- */
  const IC = {
    home: '<i class=\"ph ph-house\"></i>',
    plan: '<i class=\"ph ph-calendar-dots\"></i>',
    map: '<i class=\"ph ph-map-trifold\"></i>',
    search: '<i class=\"ph ph-magnifying-glass\"></i>',
    tools: '<i class=\"ph ph-squares-four\"></i>',
    back: '<i class=\"ph ph-caret-left\"></i>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 17l-5.2 2.7 1-5.9-4.3-4.1 5.9-.8L12 3.5Z"/></svg>',
    starOn: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 17l-5.2 2.7 1-5.9-4.3-4.1 5.9-.8L12 3.5Z"/></svg>',
    share: '<i class=\"ph ph-export\"></i>',
    close: '<i class=\"ph ph-x\"></i>',
  };

  /* ---------------- ルーター ---------------- */
  const TABS = [
    { id: "home", label: "ホーム", href: "#/home" },
    { id: "plan", label: "予定", href: "#/plan" },
    { id: "map", label: "地図", href: "#/map" },
    { id: "search", label: "探す", href: "#/search" },
    { id: "tools", label: "ツール", href: "#/tools" },
  ];
  function parse() {
    const h = location.hash.replace(/^#\/?/, "") || "home";
    const [path, qs] = h.split("?");
    return { parts: path.split("/").map(decodeURIComponent), q: new URLSearchParams(qs || "") };
  }
  function tabOf(parts) {
    const p = parts[0];
    if (["plan"].includes(p)) return "plan";
    if (["map"].includes(p)) return "map";
    if (["search", "spot", "article", "term"].includes(p)) return "search";
    if (["tools", "favs"].includes(p)) return "tools";
    return "home";
  }

  const PAGES = {};
  function render() {
    const { parts, q } = parse();
    const page = PAGES[parts[0]] || PAGES.home;
    const out = page(parts.slice(1), q);
    const isRoot = ["home", "plan", "map", "search", "tools", ""].includes(parts[0]) && parts.length === 1;
    const favKey = out.fav;
    const isFav = favKey && state.favs.includes(favKey);

    document.title = out.title ? `${out.title}｜${TRIP.title}` : TRIP.title;
    $("#app").innerHTML = `
      <header class="appbar">
        <button class="iconbtn ${isRoot ? "hidden" : ""}" data-act="back" aria-label="戻る">${IC.back}</button>
        <h1>${esc(out.title || TRIP.title)}</h1>
        ${favKey ? `<button class="iconbtn ${isFav ? "on" : ""}" data-act="fav" data-key="${esc(favKey)}" aria-label="お気に入り">${isFav ? IC.starOn : IC.star}</button>` : `<button class="iconbtn" data-act="share" aria-label="共有">${IC.share}</button>`}
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

  /* ---------------- ホーム ---------------- */
  PAGES.home = () => {
    const ph = phase();
    const n = now();
    const sh = shParts(n);
    const musts = coveredMusts();
    let hero = "", main = "";

    if (ph === "before") {
      const days = Math.ceil((new Date(TRIP.start) - n) / 86400000);
      const prepLeft = CHECKLISTS.prep.items.filter((_, i) => !state.checks["prep:" + i]).length;
      hero = `<div class="count"><span>出発まで</span><b>${days}</b><span>日</span></div>`;
      const prepTotal = CHECKLISTS.prep.items.length;
      const slotsAll = PLAN.flatMap((d) => d.slots.filter((s) => s.type !== "fixed"));
      const slotsDone = slotsAll.filter((s) => (s.type === "choice" && chosenOf(s)) || (s.type === "split" && Object.values(splitOf(s)).filter(Boolean).length)).length;
      const nextPrep = CHECKLISTS.prep.items.find((_, i) => !state.checks["prep:" + i]);
      const tile = (href, label, val, total, unit, color) => `<a class="stat" href="${href}"><span class="stat-label">${label}</span>
        <span class="stat-num"><b>${val}</b><small>/${total}${unit}</small></span>
        <span class="bar"><i style="width:${Math.round((val / total) * 100)}%;background:var(${color})"></i></span></a>`;
      main = `
        <div class="label-s">準備の進み具合</div>
        <div class="stats">
          ${tile("#/tools/check", "出発前の準備", prepTotal - prepLeft, prepTotal, "件", "--jade")}
          ${tile("#/plan", "予定を選んだ枠", slotsDone, slotsAll.length, "枠", "--gold")}
          ${tile("#/plan", "絶対行きたい", musts.size, MUSTS.length, "", "--red")}
        </div>
        ${nextPrep ? `<a class="nextup" href="#/tools/check"><span class="nu-ic"><i class="ph ph-check-square"></i></span><span class="nu-body"><small>つぎにやること</small><b>${esc(nextPrep)}</b></span><i class="ph ph-caret-right"></i></a>` : ""}
        <div class="must-row" style="margin-top:12px">${MUSTS.map((m) => `<span class="must ${musts.has(m.id) ? "ok" : ""}">${m.label}</span>`).join("")}</div>`;
    } else if (ph === "during") {
      const di = PLAN.findIndex((d) => d.date === sh.date);
      const day = PLAN[di];
      hero = `<div class="count"><span>旅の</span><b>${di + 1}</b><span>日目 ・ ${day ? esc(day.title) : ""}</span></div>`;
      if (day) {
        const slots = day.slots;
        const cur = slots.find((s) => toMin(s.time) <= sh.min && sh.min < toMin(s.end));
        const next = slots.find((s) => toMin(s.time) > sh.min);
        const slotCard = (s, cls, label) => {
          const sum = slotSummary(s);
          const opt = s.type === "choice" ? chosenOf(s) : null;
          return `<a class="card ${cls}" href="#/plan/${di}?keep=1" style="display:block;color:inherit">
            <div class="label">${label}・${s.time}〜${s.end}</div>
            <h3>${esc(sum || s.title)}</h3>
            ${opt?.move ? `<div class="muted"><i class="ph ph-person-simple-walk"></i> ${esc(opt.move)}</div>` : ""}
            ${opt?.look ? `<div class="muted"><i class="ph ph-eye"></i> ${esc(opt.look)}</div>` : ""}
            ${!sum ? `<div class="muted">まだ選んでいません（候補 ${s.options.length} 件）</div>` : ""}
          </a>`;
        };
        main = `<div class="section-title">今日の予定 <small><a href="#/plan/${di}">一日を見る ›</a></small></div>
          ${cur ? slotCard(cur, "now-card", "いま") : `<div class="card muted">いまの時間に予定はありません</div>`}
          ${next ? slotCard(next, "now-card next-card", "つぎ") : ""}`;
      }
    } else {
      hero = `<div class="count"><span>おかえりなさい</span></div>`;
      main = `
        <div class="section-title">旅のふりかえり</div>
        <a class="card" href="#/tools/notes" style="display:block;color:inherit"><b>調査ノートを書く</b><div class="muted">「上海はなぜ大都市になったのか」— 4日間で見たものから、自分たちの答えを</div></a>
        <a class="card" href="#/tools/missions" style="display:block;color:inherit"><b>調査ミッションの結果</b><div class="muted">達成 ${Object.keys(state.checks).filter((k) => k.startsWith("mission:") && state.checks[k]).length} 件</div></a>`;
    }

    const dayN = Math.floor(n.getTime() / 86400000);
    const trivia = TRIVIA[dayN % TRIVIA.length];

    return {
      title: "",
      html: `
      <section class="hero">
        <div class="eyebrow">SHANGHAI ・ 2026.12.9 — 12.12</div>
        <h2>上海 <span class="num">2026</span></h2>
        <p>${esc(TRIP.subtitle)}</p>
        ${hero}
      </section>

      <div class="quick">
        <a href="#/tools/taxi"><span class="ic"><i class="ph ph-taxi"></i></span>タクシーに<br>見せる</a>
        <a href="#/tools/phrase"><span class="ic"><i class="ph ph-bowl-food"></i></span>お店で<br>見せる</a>
        <a href="#/tools/rate"><span class="ic"><i class="ph ph-currency-cny"></i></span>為替<br>1元≒${state.rate}円</a>
        <a href="#/tools/emergency"><span class="ic"><i class="ph ph-siren"></i></span>緊急<br>連絡先</a>
      </div>

      ${main}

      <div class="section-title">今日の豆知識</div>
      <div class="card trivia"><div class="label"><i class="ph ph-lightbulb"></i> 上海トリビア</div>${esc(trivia)}</div>

      <div class="section-title">読んでおきたい <small><a href="#/search">もっと探す ›</a></small></div>
      <div class="hscroll">
        <a class="read-card" href="#/article/why"><div class="thumb red latin">why?</div><div class="body"><h4>${esc(ARTICLES.why.title)}</h4><p>${esc(ARTICLES.why.lead)}</p></div></a>
        <a class="read-card" href="#/spot/bund"><div class="thumb">外滩</div><div class="body"><h4>外灘</h4><p>${esc(SPOTS.bund.catch)}</p></div></a>
        <a class="read-card" href="#/spot/yuyuan"><div class="thumb jade">豫园</div><div class="body"><h4>豫園</h4><p>${esc(SPOTS.yuyuan.catch)}</p></div></a>
      </div>

      ${state.hist.length ? `<div class="section-title">最近見たページ</div>
      <div class="card related">${state.hist.slice(0, 5).map((h) => `<a href="${hrefOfKey(h.key)}">${esc(h.title)}</a>`).join("")}</div>` : ""}

      <div class="section-title">この旅のメンバー</div>
      <div class="members">${TRIP.members.map((m) => `<div class="member">${avatar(m.id)}${esc(m.name)}</div>`).join("")}</div>

      <div class="section-title">旅の基本</div>
      <div class="card">
        <table class="kv">
          ${TRIP.flights.map((f) => `<tr><th>${f.label} ${f.date}</th><td>${f.from} ${f.dep}<br>→ ${f.to} ${f.arr}<br><span class="tiny">${f.airline}</span></td></tr>`).join("")}
          <tr><th>ホテル</th><td>${TRIP.hotel.name}<br><span class="tiny">${TRIP.hotel.addressJa}</span></td></tr>
          <tr><th>時差</th><td>上海は日本より <b>1時間遅い</b></td></tr>
        </table>
      </div>
      <p class="tiny" style="text-align:center;margin-top:20px">試作版 ・ 表示中の時刻：${sh.date} ${String(Math.floor(sh.min / 60)).padStart(2, "0")}:${String(sh.min % 60).padStart(2, "0")}（上海）${state.nowOverride ? "・日時を試し中" : ""}</p>`,
    };
  };

  /* ---------------- 予定 ---------------- */
  PAGES.plan = (args) => {
    const sh = shParts(now());
    let di = args[0] != null ? +args[0] : Math.max(0, PLAN.findIndex((d) => d.date === sh.date));
    if (!(di >= 0 && di < PLAN.length)) di = 0;
    const day = PLAN[di];
    const musts = coveredMusts();
    const choose = state.planMode === "choose";

    const node = (s) => { const k = kindOf(s, chosenOf(s)); return `<span class="node k-${k.id}"><i class="ph ph-${k.icon}"></i></span>`; };
    const slotHtml = (s) => {
      const time = `<div class="time">${s.time}<small>〜${s.end}</small></div>${node(s)}`;
      if (s.type === "fixed") {
        return `<div class="slot fixed">${time}<div class="card"><div class="kicker">決定</div><h3>${esc(s.title)}</h3>${s.note ? `<div class="muted">${esc(s.note)}</div>` : ""}</div></div>`;
      }
      if (s.type === "choice") {
        const o = chosenOf(s);
        const open = choose || !o;
        return `<div class="slot ${o ? "" : "slot-open"}">${time}<div class="card">
          <div class="kicker">${esc(s.title)}</div>
          ${o ? `<h3>${esc(o.title)}</h3>${optMeta(o)}` : `<div class="empty-msg">まだ選んでいません（候補 ${s.options.length} 件）</div>`}
          ${open ? `<div class="opts">${s.options.map((x) => optBtn(s, x, o?.id === x.id)).join("")}</div>` : ""}
        </div></div>`;
      }
      if (s.type === "split") {
        const m = splitOf(s);
        const sum = TRIP.members.map((p) => {
          const label = s.fixedFor?.[p.id] || (m[p.id] ? s.options.find((o) => o.id === m[p.id])?.title : "未定");
          return `<div>${avatar(p.id)}<span>${esc(p.name)}：${esc(label)}</span></div>`;
        }).join("");
        return `<div class="slot">${time}<div class="card">
          <div class="kicker">${esc(s.title)} ・ 人ごとに選べる</div>
          <div class="split-sum">${sum}</div>
          ${choose ? `<div class="opts">${s.options.map((x) => splitBtn(s, x, m)).join("")}</div>` : ""}
        </div></div>`;
      }
    };
    const optMeta = (o) => `<dl class="meta">
      ${o.why ? `<dt>理由</dt><dd>${esc(o.why)}</dd>` : ""}
      ${o.look ? `<dt>注目</dt><dd>${esc(o.look)}</dd>` : ""}
      ${o.move ? `<dt>移動</dt><dd>${esc(o.move)}</dd>` : ""}
      ${o.dur ? `<dt>時間</dt><dd>${esc(o.dur)}</dd>` : ""}
      </dl>${o.spot ? `<a class="toggle-link" href="#/spot/${o.spot}">${esc(SPOTS[o.spot].name)}の解説を読む ›</a>` : ""}`;
    const optBtn = (s, x, on) => `<div class="opt ${on ? "on" : ""}" data-act="pick" data-slot="${s.id}" data-opt="${x.id}" role="button" tabindex="0">
        <div class="row"><span class="radio"></span><h4>${esc(x.title)}</h4><span class="dur">${esc(x.dur || "")}</span></div>
        <div class="why">${esc(x.why || "")}</div>
        ${x.spot ? `<div class="more"><a href="#/spot/${x.spot}">解説 ›</a></div>` : ""}
      </div>`;
    const splitBtn = (s, x, m) => `<div class="opt ${Object.values(m).includes(x.id) ? "on" : ""}">
        <div class="row"><span class="radio"></span><h4>${esc(x.title)}</h4><span class="dur">${esc(x.dur || "")}</span></div>
        <div class="why">${esc(x.why || "")}</div>
        <div class="persons">${TRIP.members.filter((p) => !s.fixedFor?.[p.id]).map((p) => `<button class="person ${m[p.id] === x.id ? "on" : ""}" data-act="assign" data-slot="${s.id}" data-opt="${x.id}" data-person="${p.id}">${avatar(p.id)}${esc(p.name)}</button>`).join("")}</div>
      </div>`;

    // アジェンダ表示：種類ごとに色分けしたブロックを並べる
    const agendaHtml = (s) => {
      const o = chosenOf(s); const k = kindOf(s, o);
      const range = `${s.time} – ${s.end}`;
      if (s.type === "split") {
        const m = splitOf(s);
        const lines = TRIP.members.map((p) => `<div class="ag-person">${avatar(p.id)}<span>${esc(s.fixedFor?.[p.id] || (m[p.id] ? s.options.find((x) => x.id === m[p.id])?.title : "未定"))}</span></div>`).join("");
        return `<div class="ag k-${k.id}"><i class="ph ph-users-three ag-ic"></i><div class="ag-body"><b>${esc(s.title)}</b><span class="ag-time">${range}</span>${lines}</div></div>`;
      }
      const title = s.type === "fixed" ? s.title : o?.title;
      if (!title) return `<a class="ag ag-open" href="#" data-act="mode" data-mode="choose"><i class="ph ph-circle-dashed ag-ic"></i><div class="ag-body"><b>${esc(s.title)}：未選択</b><span class="ag-time">${range} ・ 候補 ${s.options.length} 件から選ぶ</span></div></a>`;
      const href = o?.spot ? `#/spot/${o.spot}` : null;
      const inner = `<i class="ph ph-${k.icon} ag-ic"></i><div class="ag-body"><b>${esc(title)}</b><span class="ag-time">${range}${o?.move ? ` ・ ${esc(o.move)}` : ""}</span></div>${href ? `<i class="ph ph-caret-right ag-go"></i>` : ""}`;
      return href ? `<a class="ag k-${k.id}" href="${href}">${inner}</a>` : `<div class="ag k-${k.id}">${inner}</div>`;
    };
    const chosenCount = day.slots.filter((s) => s.type === "fixed" || (s.type === "choice" && chosenOf(s)) || (s.type === "split" && Object.values(splitOf(s)).filter(Boolean).length)).length;

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

  /* ---------------- スポット ---------------- */
  PAGES.spot = (args) => {
    const id = args[0]; const s = SPOTS[id];
    if (!s) return { title: "見つかりません", html: `<div class="empty">このページは準備中です</div>` };
    const done = s.missions.filter((_, i) => state.checks[`mission:${id}:${i}`]).length;
    const color = id === "yuyuan" ? "red" : "";
    const amap = `https://uri.amap.com/search?keyword=${encodeURIComponent(s.zh)}&city=${encodeURIComponent("上海")}`;
    const apple = `https://maps.apple.com/?q=${encodeURIComponent(s.zh)}&ll=${s.lat},${s.lng}`;
    const opts = allOptions().filter((o) => o.spot === id);

    return {
      title: s.name, fav: `spot:${id}`,
      html: `
      <section class="spot-hero ${color}">
        <div class="big">${esc(s.hero.big)}</div>
        <div class="sub">${esc(s.hero.sub)}</div>
        <h2>${esc(s.name)}</h2>
        <div class="read">${esc(s.read)} ・ ${esc(s.zh)} ${esc(s.pinyin)} ・ ${esc(s.en)}</div>
        <div class="catch">${esc(s.catch)}</div>
      </section>
      <div class="actions">
        <button class="action" data-act="show-taxi" data-zh="${esc(s.zh)}" data-addr="${esc(TAXI.find((t) => t.id === id)?.addr || "")}" data-ja="${esc(s.name)}"><i class="ph ph-taxi"></i> タクシーに見せる</button>
        <a class="action" href="${amap}" target="_blank" rel="noopener"><i class="ph ph-map-trifold"></i> 高徳地図</a>
        <a class="action" href="${apple}" target="_blank" rel="noopener"><i class="ph ph-map-pin"></i> Appleマップ</a>
        <a class="action" href="#/map?focus=${id}"><i class="ph ph-map-pin-line"></i> 位置関係</a>
      </div>
      <div class="pills" style="margin:6px 0 10px">${s.themes.map((t) => `<a class="pill" href="#/search?f=${encodeURIComponent(t)}">${esc(t)}</a>`).join("")}${s.times.map((t) => `<span class="pill jade">${t}</span>`).join("")}</div>

      <div class="card"><table class="kv">${s.basics.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`).join("")}</table>
      <div class="tiny" style="margin-top:6px">料金・時間は2026年11月時点の調べ。出発前にもう一度確認します。</div></div>

      <div class="card"><div class="tiny" style="margin-bottom:6px">目次</div><div class="toc">${s.sections.map((x, i) => `<a href="#sec-${i}" data-act="jump" data-to="sec-${i}">${esc(x.h)}</a>`).join("")}<a href="#sec-m" data-act="jump" data-to="sec-m">調査ミッション</a><a href="#sec-q" data-act="jump" data-to="sec-q">クイズ</a></div></div>

      <div class="article">
      ${s.sections.map((x, i) => `<section class="card" id="sec-${i}"><h3>${esc(x.h)}</h3>
        <div class="fold ${strip(x.html).length > 420 ? "closed" : ""}"><div class="fold-body">${linkify(x.html)}</div>
        ${strip(x.html).length > 420 ? `<button class="fold-btn" data-act="fold">もっと読む ▾</button>` : ""}</div></section>`).join("")}
      </div>

      <section class="card" id="sec-m"><h3 style="font-size:1.15rem;margin-bottom:8px"><i class="ph ph-magnifying-glass"></i> 調査ミッション <span class="tiny">${done}/${s.missions.length}</span></h3>
        ${s.missions.map((m, i) => `<div class="mission ${state.checks[`mission:${id}:${i}`] ? "on" : ""}" data-act="check" data-key="mission:${id}:${i}"><span class="check"></span><span>${esc(m)}</span></div>`).join("")}
      </section>

      <section class="card" id="sec-q"><h3 style="font-size:1.15rem;margin-bottom:8px"><i class="ph ph-question"></i> ${esc(s.name)}クイズ</h3>${s.quiz.map((q, i) => quizHtml(`${id}:${i}`, q)).join('<hr style="border:0;border-top:1px solid var(--line);margin:14px 0">')}</section>

      ${opts.length ? `<div class="section-title">この場所が入る予定の候補</div><div class="card related">${opts.map((o) => `<a href="#/plan/${o.dayIndex}">${esc(o.day.label)} ${esc(o.slot.title)}：${esc(o.title)}</a>`).join("")}</div>` : ""}
      <div class="section-title">関係する読み物</div>
      <div class="card related"><a href="#/article/why">${esc(ARTICLES.why.title)}</a>${Object.entries(TERMS).filter(([tid]) => s.sections.some((x) => x.html.includes(`term:${tid}|`))).map(([tid, t]) => `<a href="#/term/${tid}">用語：${esc(t.name)}</a>`).join("")}</div>
      <button class="fab" data-act="show-taxi" data-zh="${esc(s.zh)}" data-addr="${esc(TAXI.find((t) => t.id === id)?.addr || "")}" data-ja="${esc(s.name)}" aria-label="タクシーに見せる"><i class="ph ph-taxi"></i></button>`,
    };
  };

  function quizHtml(key, q) {
    const ans = state.quiz[key];
    return `<div class="quiz-q">${esc(q.q)}</div><div class="quiz-a">${q.a.map((a, i) => {
      let cls = ""; if (ans != null) { if (i === q.correct) cls = "right"; else if (i === ans) cls = "wrong"; }
      return `<button class="${cls}" data-act="quiz" data-key="${key}" data-i="${i}" ${ans != null ? "disabled" : ""}>${esc(a)}</button>`;
    }).join("")}</div>${ans != null ? `<div class="quiz-ex">${ans === q.correct ? "正解！" : "残念"} ${esc(q.ex)}</div>` : ""}`;
  }

  /* ---------------- 読み物・用語 ---------------- */
  PAGES.article = (args) => {
    const a = ARTICLES[args[0]];
    if (!a) return { title: "見つかりません", html: `<div class="empty">このページは準備中です</div>` };
    return {
      title: a.title, fav: `article:${args[0]}`,
      html: `<section class="spot-hero red"><div class="big" style="font-size:3rem">why?</div><div class="sub">THEME OF THIS TRIP</div><h2>${esc(a.title)}</h2><div class="catch">${esc(a.lead)}</div></section>
      <div class="pills" style="margin:14px 0 10px">${a.themes.map((t) => `<a class="pill" href="#/search?f=${encodeURIComponent(t)}">${esc(t)}</a>`).join("")}</div>
      <div class="card article">${linkify(a.html)}</div>`,
    };
  };
  PAGES.term = (args) => {
    const t = TERMS[args[0]];
    if (!t) return { title: "見つかりません", html: `<div class="empty">この用語は準備中です</div>` };
    const usedIn = Object.entries(SPOTS).filter(([, s]) => s.sections.some((x) => x.html.includes(`term:${args[0]}|`)));
    return {
      title: t.name, fav: `term:${args[0]}`,
      html: `<div class="term-head"><span class="pill gray">用語</span><h2>${esc(t.name)}</h2><div class="read">${esc(t.read)}</div></div>
      <div class="card article">${linkify(t.html)}</div>
      ${t.see.length || usedIn.length ? `<div class="section-title">あわせて読む</div><div class="card related">
        ${usedIn.map(([sid, s]) => `<a href="#/spot/${sid}">スポット：${esc(s.name)}</a>`).join("")}
        ${t.see.filter((x) => TERMS[x]).map((x) => `<a href="#/term/${x}">用語：${esc(TERMS[x].name)}</a>`).join("")}</div>` : ""}`,
    };
  };

  /* ---------------- 探す ---------------- */
  const PURPOSE_IC = { "食べる": "bowl-food", "見る": "binoculars", "歩く": "person-simple-walk", "買う": "shopping-bag", "休む": "coffee", "夜を楽しむ": "moon-stars", "学ぶ": "book-open-text", "移動を楽しむ": "train-simple" };
  function searchIndex() {
    const items = [];
    Object.entries(SPOTS).forEach(([id, s]) => items.push({ type: "スポット", cls: "red", href: `#/spot/${id}`, title: s.name, sub: s.catch, text: [s.name, s.zh, s.en, s.read, s.catch, ...s.sections.map((x) => x.h + " " + strip(x.html)), ...s.missions].join(" "), facets: [...s.purposes, ...s.themes, ...s.times, s.area] }));
    Object.entries(ARTICLES).forEach(([id, a]) => items.push({ type: "読み物", cls: "", href: `#/article/${id}`, title: a.title, sub: a.lead, text: a.title + " " + a.lead + " " + strip(a.html), facets: [...a.themes, "学ぶ"] }));
    Object.entries(TERMS).forEach(([id, t]) => items.push({ type: "用語", cls: "gray", href: `#/term/${id}`, title: t.name, sub: strip(t.html).slice(0, 60) + "…", text: t.name + " " + t.read + " " + strip(t.html), facets: ["学ぶ", "歴史"] }));
    allOptions().forEach((o) => items.push({ type: "予定の候補", cls: "jade", href: `#/plan/${o.dayIndex}`, title: o.title, sub: `${o.day.label} ${o.slot.title}・${o.why || ""}`, text: [o.title, o.why, o.look, o.move].join(" "), facets: o.tags || [] }));
    [["タクシーに見せる", "#/tools/taxi", "行き先を中国語で大きく表示"], ["お店で見せる", "#/tools/phrase", "パクチー抜き・八角抜き 不要香菜"], ["為替の計算", "#/tools/rate", "人民元 円 換算"], ["緊急連絡先", "#/tools/emergency", "警察 救急 総領事館"], ["持ち物・準備チェック", "#/tools/check", "持ち物 準備 Alipay eSIM"], ["調査ノート", "#/tools/notes", "メモ 調査"]]
      .forEach(([t, h, x]) => items.push({ type: "ツール", cls: "gray", href: h, title: t, sub: x, text: t + " " + x, facets: [] }));
    PHRASES.forEach((p) => items.push({ type: "フレーズ", cls: "gray", href: "#/tools/phrase", title: p.ja, sub: p.zh + "  " + p.py, text: p.ja + p.zh + p.py, facets: [] }));
    return items;
  }
  PAGES.search = (_, q) => {
    const kw = q.get("q") || "";
    const f = q.getAll("f");
    let results = [];
    if (kw || f.length) {
      results = searchIndex().filter((it) => (!kw || it.text.toLowerCase().includes(kw.toLowerCase())) && f.every((x) => it.facets.includes(x)));
    }
    const hl = (s) => { const e = esc(s); if (!kw) return e; const k = esc(kw).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); return e.replace(new RegExp(k, "gi"), (m) => `<mark>${m}</mark>`); };
    const snippet = (it) => { if (!kw) return it.sub; const i = it.text.toLowerCase().indexOf(kw.toLowerCase()); if (i < 0 || it.sub.includes(kw)) return it.sub; return "…" + it.text.slice(Math.max(0, i - 24), i + 40) + "…"; };
    const chipHref = (val) => { const set = new Set(f); set.has(val) ? set.delete(val) : set.add(val); const p = new URLSearchParams(); if (kw) p.set("q", kw); set.forEach((x) => p.append("f", x)); p.set("keep", "1"); return "#/search?" + p.toString(); };

    return {
      title: "探す",
      html: `
      <div class="searchbox"><input id="kw" type="search" placeholder="スポット・料理・用語・フレーズを検索" value="${esc(kw)}" enterkeyhint="search"></div>
      <div class="facet"><h4>目的から探す</h4><div class="purpose">${FACETS["目的"].map((v) => `<a class="pp ${f.includes(v) ? "on" : ""}" href="${chipHref(v)}"><span class="pp-ic"><i class="ph ph-${PURPOSE_IC[v] || "sparkle"}"></i></span>${esc(v)}</a>`).join("")}</div></div>
      ${Object.entries(FACETS).filter(([n]) => n !== "目的").map(([name, vals], gi) => `<div class="facet"><h4>${name}から探す</h4><div class="chips">${vals.map((v, i) => `<a class="chip dot d${(gi * 3 + i) % 6} ${f.includes(v) ? "on" : ""}" href="${chipHref(v)}">${esc(v)}</a>`).join("")}</div></div>`).join("")}
      ${kw || f.length ? `<div class="section-title">${results.length} 件 <small>${f.length ? `<a href="#/search?q=${encodeURIComponent(kw)}">絞り込みを解除</a>` : ""}</small></div>
        <div class="card" style="padding:0 14px">${results.length ? results.map((it) => `<a class="result" href="${it.href}"><span class="pill type ${it.cls}">${it.type}</span><div><h4>${hl(it.title)}</h4><p>${hl(snippet(it))}</p></div></a>`).join("") : `<div class="empty">見つかりませんでした。<br><span class="tiny">試作版のため、まだ外灘と豫園しか解説がありません</span></div>`}</div>`
      : `<div class="section-title">すべてのページ</div>
        <div class="card related">
          ${Object.entries(SPOTS).map(([id, s]) => `<a href="#/spot/${id}">スポット：${esc(s.name)}</a>`).join("")}
          ${Object.entries(ARTICLES).map(([id, a]) => `<a href="#/article/${id}">読み物：${esc(a.title)}</a>`).join("")}
        </div>
        <div class="section-title">用語集</div>
        <div class="chips">${Object.entries(TERMS).map(([id, t]) => `<a class="chip" href="#/term/${id}">${esc(t.name)}</a>`).join("")}</div>`}`,
      after() {
        const inp = $("#kw");
        let timer;
        inp.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => {
          const p = new URLSearchParams(); if (inp.value) p.set("q", inp.value); f.forEach((x) => p.append("f", x)); p.set("keep", "1");
          history.replaceState(null, "", "#/search?" + p.toString()); render(); const n = $("#kw"); n.focus(); n.setSelectionRange(n.value.length, n.value.length);
        }, 250); });
      },
    };
  };

  /* ---------------- 地図（概略図：外部の地図サービスに頼らない） ---------------- */
  const B = { minLat: 31.212, maxLat: 31.256, minLng: 121.460, maxLng: 121.522 };
  const W = 600, H = Math.round(W * ((B.maxLat - B.minLat) / ((B.maxLng - B.minLng) * Math.cos(31.23 * Math.PI / 180))));
  const px = (lat, lng) => [((lng - B.minLng) / (B.maxLng - B.minLng)) * W, ((B.maxLat - lat) / (B.maxLat - B.minLat)) * H];
  const path = (pts) => pts.map(([la, ln], i) => { const [x, y] = px(la, ln); return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`; }).join(" ");
  const RIVER = [[31.200, 121.487], [31.212, 121.4985], [31.224, 121.5005], [31.233, 121.4975], [31.2405, 121.4945], [31.2465, 121.4965], [31.2505, 121.5040], [31.2520, 121.5150], [31.2560, 121.5320]];
  const CREEK = [[31.2470, 121.4600], [31.2445, 121.4720], [31.2450, 121.4830], [31.2440, 121.4925]];

  PAGES.map = (_, q) => {
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
    const [wcx, wcy] = px(31.2255, 121.4885);
    const [rx] = [((0.0088) / (B.maxLng - B.minLng)) * W]; const ry = ((0.0062) / (B.maxLat - B.minLat)) * H;
    const [rcx, rcy] = px(31.2318, 121.4722);
    const oldLayer = old ? `
      <g opacity=".95">
        <ellipse cx="${wcx}" cy="${wcy}" rx="${rx}" ry="${ry}" fill="rgba(47,107,94,.12)" stroke="#2f6b5e" stroke-width="3" stroke-dasharray="2 5" stroke-linecap="round"/>
        <text x="${wcx}" y="${wcy + ry + 18}" text-anchor="middle" font-size="12" fill="#2f6b5e" font-weight="700">旧市街の城壁（1553〜1912）→ 今の人民路・中華路</text>
        <path d="${path([[31.2338, 121.4935], [31.2318, 121.4830], [31.2302, 121.4700], [31.2295, 121.4600]])}" stroke="#3b7bbf" stroke-width="6" fill="none" opacity=".55" stroke-linecap="round"/>
        <text x="${px(31.2290, 121.4640)[0]}" y="${px(31.2290, 121.4640)[1] + 16}" font-size="12" fill="#3b7bbf" font-weight="700">洋涇浜（川）→ 今の延安東路</text>
        <ellipse cx="${rcx}" cy="${rcy}" rx="26" ry="20" fill="rgba(156,116,48,.15)" stroke="#9c7430" stroke-width="2"/>
        <text x="${rcx}" y="${rcy + 36}" text-anchor="middle" font-size="12" fill="#9c7430" font-weight="700">競馬場 → 人民広場</text>
        <text x="${px(31.2490, 121.4700)[0]}" y="${px(31.2490, 121.4700)[1]}" font-size="16" fill="#1f3350" font-weight="800" opacity=".55">共同租界</text>
        <text x="${px(31.2160, 121.4630)[0]}" y="${px(31.2160, 121.4630)[1]}" font-size="16" fill="#1f3350" font-weight="800" opacity=".55">フランス租界</text>
        <text x="${px(31.2280, 121.5080)[0]}" y="${px(31.2280, 121.5080)[1]}" font-size="13" fill="#5a6273" font-weight="700">（倉庫・埠頭・畑）</text>
      </g>` : "";

    const pins = PLACES.map((p) => {
      const [x, y] = px(p.lat, p.lng);
      const isF = focus && (p.spot === focus || p.id === focus);
      const fill = p.kind === "hotel" ? "#1f3350" : p.spot ? "#b5332a" : "#9c7430";
      return `<g class="map-pin" data-act="pin" data-id="${p.id}">${isF ? `<circle class="halo" cx="${x}" cy="${y}" r="22"/>` : ""}<circle cx="${x}" cy="${y}" r="${p.kind === "hotel" ? 9 : 7}" fill="${fill}" stroke="#fff" stroke-width="2.5"/>
        ${p.kind === "hotel" ? `<text x="${x}" y="${y + 3.5}" text-anchor="middle" font-size="9" fill="#fff" stroke="none" style="stroke:none">H</text>` : ""}
        <text x="${x + 11}" y="${y + 4}">${esc(p.name)}</text></g>`;
    }).join("");

    const qs = (o) => { const p = new URLSearchParams(q); Object.entries(o).forEach(([k, v]) => (v == null ? p.delete(k) : p.set(k, v))); p.set("keep", "1"); return "#/map?" + p.toString(); };
    return {
      title: "地図",
      html: `
      <div class="seg"><a class="${!old ? "on" : ""}" href="${qs({ old: null })}">今の地図</a><a class="${old ? "on" : ""}" href="${qs({ old: "1" })}">昔の地図を重ねる</a></div>
      <div class="chips" style="margin-bottom:10px"><a class="chip ${dayI == null ? "on" : ""}" href="${qs({ day: null })}">ルートなし</a>${PLAN.map((d, i) => `<a class="chip ${dayI == i ? "on" : ""}" href="${qs({ day: i })}">${d.label}のルート</a>`).join("")}</div>
      <div class="mapwrap">
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="上海中心部の概略図">
          <defs><pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse"><path d="M30 0H0V30" fill="none" stroke="#e2dacb" stroke-width="1"/></pattern></defs>
          <rect width="${W}" height="${H}" fill="url(#grid)"/>
          <path d="${path(RIVER)}" fill="none" stroke="#a9c4d6" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="${path(CREEK)}" fill="none" stroke="#a9c4d6" stroke-width="7" stroke-linecap="round"/>
          <text x="${px(31.2180, 121.5030)[0]}" y="${px(31.2180, 121.5030)[1]}" font-size="13" fill="#4f7894" font-weight="700" transform="rotate(-70 ${px(31.2180, 121.5030).join(" ")})">黄浦江</text>
          <text x="${px(31.2470, 121.4650)[0]}" y="${px(31.2470, 121.4650)[1] - 8}" font-size="11" fill="#4f7894" font-weight="700">蘇州河</text>
          <text x="${px(31.2530, 121.4640)[0]}" y="${px(31.2530, 121.4640)[1]}" font-size="22" fill="#c9bfa9" font-weight="800" font-family="serif">浦西</text>
          <text x="${px(31.2200, 121.5120)[0]}" y="${px(31.2200, 121.5120)[1]}" font-size="22" fill="#c9bfa9" font-weight="800" font-family="serif">浦東</text>
          ${oldLayer}
          ${route}
          ${pins}
        </svg>
      </div>
      <div id="mapcard"></div>
      <div class="tiny" style="margin-top:8px">※ 試作の概略図です。位置はおおよそ。昔の地図の範囲も目安です。</div>
      <div class="section-title">中心部の外</div>
      <div class="offmap">
        <div><span><i class="ph ph-castle-turret"></i>上海ディズニーランド</span><span class="muted">ホテルから南東へ約30km</span></div>
        <div><span><i class="ph ph-airplane"></i>浦東空港</span><span class="muted">ホテルから東へ約40km</span></div>
        <div><span><i class="ph ph-train"></i>龍陽路駅（リニア）</span><span class="muted">陸家嘴から南東へ約8km</span></div>
      </div>`,
      after() { if (focus) showPin(PLACES.find((p) => p.spot === focus || p.id === focus)?.id); },
    };
  };
  function showPin(id) {
    const p = PLACES.find((x) => x.id === id); const box = $("#mapcard"); if (!p || !box) return;
    const s = p.spot && SPOTS[p.spot];
    box.innerHTML = `<div class="card map-card"><b>${esc(p.kind === "hotel" ? TRIP.hotel.name : p.name)}</b>
      <div class="muted">${s ? esc(s.catch) : p.kind === "hotel" ? esc(TRIP.hotel.addressJa) : "解説は次の版で追加します"}</div>
      ${s ? `<a class="toggle-link" href="#/spot/${p.spot}">解説を読む ›</a>` : ""}</div>`;
  }

  /* ---------------- ツール ---------------- */
  PAGES.tools = (args) => {
    const sub = args[0];
    if (sub && TOOLS[sub]) return TOOLS[sub]();
    const t = (href, ic, b, s) => `<a class="tool" href="${href}"><span class="ic"><i class="ph ph-${ic}"></i></span><b>${b}</b><small>${s}</small></a>`;
    return {
      title: "ツール",
      html: `<div class="section-title" style="margin-top:6px">旅行中によく使う</div>
      <div class="toolgrid">
        ${t("#/tools/taxi", "taxi", "タクシーに見せる", "行き先を中国語で大きく表示")}
        ${t("#/tools/phrase", "bowl-food", "お店で見せる", "パクチー抜き・八角抜きなど")}
        ${t("#/tools/rate", "currency-cny", "為替の計算", `1元 ≒ ${state.rate}円`)}
        ${t("#/tools/emergency", "siren", "緊急連絡先", "警察・救急・総領事館")}
      </div>
      <div class="section-title">準備と記録</div>
      <div class="toolgrid">
        ${t("#/tools/check", "check-square", "準備・持ち物", "出発前のやることと持ち物")}
        ${t("#/tools/missions", "magnifying-glass", "調査ミッション", "現地で探すお題")}
        ${t("#/tools/quiz", "question", "上海クイズ", "4人で遊べる")}
        ${t("#/tools/notes", "note-pencil", "調査ノート", "日ごとのメモと気づき")}
        ${t("#/favs", "star", "お気に入り", `${state.favs.length} 件`)}
        ${t("#/tools/settings", "gear", "設定", "文字の大きさ・日時を試す")}
      </div>`,
    };
  };
  PAGES.favs = () => ({
    title: "お気に入り",
    html: state.favs.length ? `<div class="card related">${state.favs.map((k) => { const [t, id] = k.split(":"); const title = t === "spot" ? SPOTS[id]?.name : t === "article" ? ARTICLES[id]?.title : TERMS[id]?.name; return `<a href="${hrefOfKey(k)}">${esc(title || k)}</a>`; }).join("")}</div>` : `<div class="empty">ページ右上の星マークを押すと、ここに集まります</div>`,
  });

  const TOOLS = {
    taxi: () => ({
      title: "タクシーに見せる",
      html: `<p class="muted">タップすると全画面で大きく表示されます。運転手さんに画面を見せてください。</p>
      ${TAXI.map((t) => `<button class="list-btn" data-act="show-taxi" data-zh="${esc(t.zh)}" data-addr="${esc(t.addr)}" data-ja="${esc(t.ja)}"><div><div class="zh">${esc(t.zh)}</div><div class="ja">${esc(t.ja)}</div></div></button>`).join("")}
      <div class="card muted" style="font-size:.85rem">タクシーはDiDi（滴滴）アプリで呼ぶのが便利。4人＋荷物のときは大きめの車を選びます。</div>`,
    }),
    phrase: () => {
      const cats = [...new Set(PHRASES.map((p) => p.cat))];
      return {
        title: "お店で見せる",
        html: cats.map((c) => `<div class="section-title">${c}</div>${PHRASES.filter((p) => p.cat === c).map((p) => `<button class="list-btn" data-act="show-phrase" data-zh="${esc(p.zh)}" data-py="${esc(p.py)}" data-ja="${esc(p.ja)}"><div><div class="zh">${esc(p.zh)}</div><div class="ja">${esc(p.ja)}・${esc(p.py)}</div></div></button>`).join("")}`).join(""),
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
      <div class="card"><h3 style="font-size:1rem;margin-bottom:6px">パスポートを無くしたら</h3><ol style="margin:0;padding-left:1.2em;font-size:.92rem"><li>近くの警察（公安局）で紛失の証明をもらう</li><li>総領事館で帰国のための書類を申請する</li><li>出入境管理の窓口で手続きをする</li></ol><div class="tiny" style="margin-top:6px">詳しい手順は次の版で追加します。パスポートの写真をスマホに保存しておくと安心です。</div></div>`,
    }),
    check: () => ({
      title: "準備・持ち物",
      html: Object.entries(CHECKLISTS).map(([k, l]) => { const d = l.items.filter((_, i) => state.checks[`${k}:${i}`]).length; return `<div class="section-title">${l.title} <small>${d}/${l.items.length}</small></div><div class="card">${l.items.map((it, i) => `<div class="mission ${state.checks[`${k}:${i}`] ? "on" : ""}" data-act="check" data-key="${k}:${i}"><span class="check"></span><span>${esc(it)}</span></div>`).join("")}</div>`; }).join(""),
    }),
    missions: () => ({
      title: "調査ミッション",
      html: `<p class="muted">現地で探す小さなお題。見つけたらチェック。</p>` + Object.entries(SPOTS).map(([id, s]) => `<div class="section-title"><a href="#/spot/${id}" style="color:inherit">${esc(s.name)}</a></div><div class="card">${s.missions.map((m, i) => `<div class="mission ${state.checks[`mission:${id}:${i}`] ? "on" : ""}" data-act="check" data-key="mission:${id}:${i}"><span class="check"></span><span>${esc(m)}</span></div>`).join("")}</div>`).join(""),
    }),
    quiz: () => {
      const all = Object.entries(SPOTS).flatMap(([id, s]) => s.quiz.map((q, i) => ({ key: `${id}:${i}`, q, spot: s.name })));
      const answered = all.filter((x) => state.quiz[x.key] != null); const right = answered.filter((x) => state.quiz[x.key] === x.q.correct).length;
      return {
        title: "上海クイズ",
        html: `<div class="card" style="text-align:center"><div class="tiny">正解数</div><div class="quiz-score" style="font-size:2.2rem;color:var(--red)">${right} / ${all.length}</div><button class="toggle-link" data-act="quiz-reset">もう一度やる</button></div>
        ${all.map((x) => `<div class="card"><span class="pill">${esc(x.spot)}</span>${quizHtml(x.key, x.q)}</div>`).join("")}`,
      };
    },
    notes: () => {
      const fields = [["theme", "上海はなぜ大都市になったのか（自分たちの答え）"], ...PLAN.map((d, i) => [`day${i}`, `${d.label}（${d.dow}）${d.title}のメモ`]), ["after", "帰国後に調べたいこと"]];
      return {
        title: "調査ノート",
        html: `<p class="muted">このスマホに自動で保存されます。</p>${fields.map(([k, l]) => `<div class="note-label">${esc(l)}</div><textarea data-note="${k}" placeholder="気づいたこと、写真の場所、疑問など">${esc(state.notes[k] || "")}</textarea>`).join("")}<div class="saved" id="saved"></div>`,
        after() { document.querySelectorAll("textarea[data-note]").forEach((ta) => ta.addEventListener("input", () => { state.notes[ta.dataset.note] = ta.value; save("notes"); $("#saved").textContent = "保存しました"; })); },
      };
    },
    settings: () => ({
      title: "設定",
      html: `<div class="card"><b>文字の大きさ</b><div class="seg" style="margin:8px 0 0"><button class="${!state.large ? "on" : ""}" data-act="large" data-v="0">ふつう</button><button class="${state.large ? "on" : ""}" data-act="large" data-v="1">大きめ</button></div></div>
      <div class="card"><b>日時を試す（試作用）</b><div class="muted" style="font-size:.85rem">旅行中のホーム画面を確かめるため、上海時間の日時を仮に設定できます。</div>
        <input id="nowov" type="datetime-local" value="${esc(state.nowOverride)}" style="width:100%;font:inherit;padding:8px;margin-top:8px;border:1px solid var(--line);border-radius:10px">
        <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap"><button class="btn" data-act="nowset" data-v="2026-12-10T10:00">12/10 10:00</button><button class="btn" data-act="nowset" data-v="2026-12-11T12:00">12/11 12:00</button><button class="btn" data-act="nowset" data-v="">今の日時に戻す</button></div></div>
      <div class="card"><b>選んだ予定をリセット</b><div style="margin-top:8px"><button class="btn" data-act="reset-sel">すべての選択を消す</button></div></div>`,
      after() { $("#nowov").addEventListener("change", (e) => { state.nowOverride = e.target.value; save("nowOverride"); toast("日時を設定しました"); }); },
    }),
  };

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
    else if (a === "fold") { const f = el.closest(".fold"); f.classList.toggle("closed"); el.textContent = f.classList.contains("closed") ? "もっと読む ▾" : "閉じる ▴"; }
    else if (a === "jump") { e.preventDefault(); const t = document.getElementById(el.dataset.to); if (t) window.scrollTo({ top: t.getBoundingClientRect().top + scrollY - 70, behavior: "smooth" }); }
    else if (a === "show-taxi" || a === "show-phrase") { showBig(el.dataset); }
    else if (a === "rate-q") { const v = +el.dataset.v; $("#cny").value = v; $("#jpy").value = Math.round(v * state.rate); }
    else if (a === "pin") { showPin(el.dataset.id); }
    else if (a === "large") { state.large = el.dataset.v === "1"; save("large"); applyLarge(); keepRender(); }
    else if (a === "nowset") { state.nowOverride = el.dataset.v; save("nowOverride"); toast(el.dataset.v ? "日時を設定しました" : "今の日時に戻しました"); keepRender(); }
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
