/* 畫面程式：把 CampusData 拿到的資料畫到頁面上。接資料時不需要改這個檔案。 */
(function () {
  "use strict";

  const C = window.SITE_CONFIG;
  const D = window.CampusData;
  const SVG_NS = "http://www.w3.org/2000/svg";
  const REGION_KEY = "campus-church-region";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const state = {
    region: C.regions[0].name,
    meetings: [],
    meetingsFailed: false,
    stories: [],
    schools: [],
    schoolCategory: "全部",
    schoolQuery: "",
    storyIndex: 0,
  };

  /* ---------- DOM 小工具（全部用 textContent，試算表內容不會被當成程式執行） ---------- */
  function el(tag, attrs, ...kids) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v === null || v === undefined || v === false) return;
      if (k === "class") node.className = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : v);
    });
    kids.flat().forEach((kid) => {
      if (kid === null || kid === undefined || kid === false) return;
      node.append(kid);
    });
    return node;
  }

  function icon(name) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "icon");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS(SVG_NS, "use");
    use.setAttribute("href", `#i-${name}`);
    svg.append(use);
    return svg;
  }

  const storage = {
    get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* 私密模式可略過 */ } },
  };

  /* ---------- 日期格式（台灣時間） ---------- */
  const fmt = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", month: "numeric", day: "numeric", weekday: "short",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  function dateParts(date) {
    const p = {};
    fmt.formatToParts(date).forEach((x) => { p[x.type] = x.value; });
    return { md: `${p.month}/${p.day}`, dow: p.weekday, time: `${p.hour}:${p.minute}` };
  }

  function ago(date) {
    if (!date) return "";
    const hours = Math.floor((Date.now() - date.getTime()) / 36e5);
    if (hours < 1) return "剛剛";
    if (hours < 24) return `${hours} 小時前`;
    return `${Math.floor(hours / 24)} 天前`;
  }

  function hoursLeft(date) {
    const left = (C.storyHours || 48) - (Date.now() - date.getTime()) / 36e5;
    return left < 1 ? "剩不到 1 小時" : `剩 ${Math.floor(left)} 小時`;
  }

  /* ---------- 聚會 ---------- */
  function meetingsFor(region) {
    const now = Date.now();
    const list = state.meetings.filter((m) => m.region === region && m.end.getTime() > now);
    return { next: list[0] || null, later: list.slice(1) };
  }

  const mapURL = (m) => m.map || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(m.venue)}`;

  function calendarURL(m) {
    const stamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const q = new URLSearchParams({
      action: "TEMPLATE",
      text: `校園教會｜${m.region}聚會`,
      dates: `${stamp(m.start)}/${stamp(m.end)}`,
      location: m.venue,
      ctz: "Asia/Taipei",
    });
    return `https://calendar.google.com/calendar/render?${q.toString()}`;
  }

  function countdownCells() {
    return el("div", { class: "countdown", "data-countdown": true, role: "timer" },
      [["d", "天"], ["h", "時"], ["m", "分"], ["s", "秒"]].map(([k, label]) =>
        el("div", { class: "countdown__cell" },
          el("span", { class: "countdown__num", "data-unit": k }, "--"),
          el("span", { class: "countdown__label" }, label))));
  }

  function renderRegionSwitches() {
    const index = C.regions.findIndex((r) => r.name === state.region);
    document.documentElement.style.setProperty("--region", C.regions[index].color);
    $$("[data-region-switch]").forEach((box) => {
      if (!box.childElementCount) {
        box.setAttribute("role", "group");
        box.setAttribute("aria-label", "選擇地區");
        box.style.setProperty("--n", C.regions.length);
        box.append(el("span", { class: "region-switch__thumb", "aria-hidden": "true" }));
        C.regions.forEach((r) => box.append(
          el("button", { type: "button", class: "region-switch__btn", "data-region": r.name, onclick: () => setRegion(r.name) }, r.name)));
      }
      box.style.setProperty("--i", index);
      $$("button", box).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.region === state.region)));
    });
  }

  function retryBlock(dark) {
    return el("div", { class: `load-error${dark ? " load-error--dark" : ""}` },
      el("p", {}, "暫時讀不到聚會資料"),
      el("button", { class: "btn btn--quiet", type: "button", onclick: () => location.reload() }, "重新整理"));
  }

  function renderHero(animate) {
    const box = $("#heroMeeting");
    box.textContent = "";
    if (state.meetingsFailed) { box.append(retryBlock(true)); return; }
    const { next } = meetingsFor(state.region);
    if (!next) {
      box.append(el("div", { class: "hero__none" },
        el("p", { class: "hero__eyebrow" }, `${state.region}・下一場聚會`),
        el("p", { class: "hero__none-text" }, "時間確認中"),
        el("a", { class: "btn btn--primary", href: "#/welcome" }, "第一次來？", icon("arrow"))));
      return;
    }
    const p = dateParts(next.start);
    box.append(
      el("div", { class: `hero__swap${animate ? " is-changing" : ""}` },
        el("p", { class: "hero__eyebrow" }, `${state.region}・下一場聚會`),
        el("p", { class: "hero__date" },
          el("span", { class: "hero__md" }, p.md),
          el("span", { class: "hero__dow" }, el("span", {}, p.dow), el("span", {}, p.time))),
        el("a", { class: "hero__venue", href: mapURL(next), target: "_blank", rel: "noopener" },
          icon("pin"), el("span", {}, next.venue), el("span", { class: "sr-only" }, "（開啟地圖）")),
        countdownCells(),
        el("div", { class: "hero__actions" },
          el("a", { class: "btn btn--primary", href: "#/welcome" }, "第一次來？", icon("arrow")),
          el("a", { class: "btn btn--ghost", href: calendarURL(next), target: "_blank", rel: "noopener" }, icon("cal"), "加到行事曆"))));
  }

  function renderLater() {
    const { later } = meetingsFor(state.region);
    const section = $("#laterSection");
    const list = $("#laterList");
    section.hidden = later.length === 0;
    list.textContent = "";
    later.forEach((m) => {
      const p = dateParts(m.start);
      list.append(el("li", {},
        el("a", { class: "later__item", href: mapURL(m), target: "_blank", rel: "noopener" },
          el("span", { class: "later__date" }, el("strong", {}, p.md), el("span", {}, p.dow)),
          el("span", { class: "later__info" }, el("strong", {}, m.venue), el("span", {}, p.time)),
          icon("pin"))));
    });
  }

  function renderTicket() {
    const box = $("#welcomeMeeting");
    box.textContent = "";
    if (state.meetingsFailed) { box.append(retryBlock(false)); return; }
    const { next } = meetingsFor(state.region);
    if (!next) {
      box.append(el("p", { class: "ticket__none" }, `${state.region}下一場時間確認中`));
      return;
    }
    const p = dateParts(next.start);
    box.append(
      el("div", { class: "ticket__date" }, el("strong", {}, p.md), el("span", {}, p.dow)),
      el("div", { class: "ticket__info" },
        el("strong", {}, `${p.time} 開始`),
        el("span", {}, next.venue),
        el("span", { class: "ticket__links" },
          el("a", { href: mapURL(next), target: "_blank", rel: "noopener" }, icon("pin"), "看地圖"),
          el("a", { href: calendarURL(next), target: "_blank", rel: "noopener" }, icon("cal"), "加到行事曆"))));
  }

  function renderMeetings(animate) {
    renderRegionSwitches();
    renderHero(animate);
    renderLater();
    renderTicket();
    tick();
  }

  function setRegion(name) {
    state.region = name;
    storage.set(REGION_KEY, name);
    renderMeetings(true);
  }

  function tick() {
    const { next } = meetingsFor(state.region);
    const box = $("[data-countdown]");
    if (!box || !next) return;
    const diff = next.start.getTime() - Date.now();
    if (diff <= 0) {
      box.replaceWith(el("p", { class: "live-now" }, "聚會進行中，快來找我們"));
      return;
    }
    const d = Math.floor(diff / 864e5);
    const h = Math.floor((diff % 864e5) / 36e5);
    const m = Math.floor((diff % 36e5) / 6e4);
    const s = Math.floor((diff % 6e4) / 1000);
    const set = (u, v) => { const t = $(`[data-unit="${u}"]`, box); const txt = String(v).padStart(2, "0"); if (t.textContent !== txt) t.textContent = txt; };
    set("d", d); set("h", h); set("m", m); set("s", s);
    box.setAttribute("aria-label", `距離聚會還有 ${d} 天 ${h} 小時 ${m} 分`);
  }

  /* ---------- 數據 ---------- */
  function renderStats(stats) {
    ["#homeStats", "#campusStats"].forEach((sel) => {
      const box = $(sel);
      box.textContent = "";
      stats.forEach((s) => box.append(
        el("span", { class: "stat" },
          el("span", { class: "stat__num" }, s.value, el("small", {}, s.unit)),
          el("span", { class: "stat__label" }, s.label))));
    });
  }

  /* ---------- 學校 ---------- */
  function renderSchoolFilter() {
    const counts = { 全部: state.schools.length };
    state.schools.forEach((s) => { counts[s.category] = (counts[s.category] || 0) + 1; });
    const box = $("#schoolFilter");
    box.textContent = "";
    box.style.setProperty("--n", Object.keys(counts).length);
    Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([cat, n]) => box.append(
      el("button", {
        type: "button", class: "filter__btn", "aria-pressed": String(cat === state.schoolCategory),
        onclick: () => { state.schoolCategory = cat; renderSchoolFilter(); renderSchools(); },
      }, el("span", {}, cat), el("small", {}, String(n)))));
  }

  function renderSchools() {
    const q = state.schoolQuery.trim().toLowerCase();
    const list = state.schools.filter((s) =>
      (state.schoolCategory === "全部" || s.category === state.schoolCategory) &&
      (!q || s.name.toLowerCase().includes(q)));
    const box = $("#schoolList");
    box.textContent = "";
    list.forEach((s) => box.append(el("li", { class: "school" }, s.name)));
    $("#schoolEmpty").hidden = list.length > 0;
    $("#schoolCount").textContent = `共 ${list.length} 所學校`;
  }

  /* ---------- 感動牆 ---------- */
  function renderStories() {
    const row = $("#storyRow");
    row.textContent = "";
    row.append(el("button", { class: "story story--add", type: "button", "data-story-add": true },
      el("span", { class: "story__add-icon" }, icon("camera")),
      el("span", { class: "story__add-text" }, "拍下感動")));
    state.stories.forEach((s, i) => row.append(
      el("button", { class: "story", type: "button", "aria-label": `${s.school}的照片，${hoursLeft(s.time)}`, onclick: () => openViewer(i) },
        el("img", { src: s.photo, alt: "", loading: "lazy", width: "112", height: "168" }),
        el("span", { class: "story__left" }, hoursLeft(s.time)),
        el("span", { class: "story__school" }, s.school))));
  }

  function showStory(i) {
    state.storyIndex = i;
    const s = state.stories[i];
    $("#viewerImg").src = s.photo;
    $("#viewerImg").alt = `${s.school}的校園感動照片`;
    $("#viewerSchool").textContent = s.school;
    $("#viewerLeft").textContent = hoursLeft(s.time);
    $("#viewerPrev").hidden = i === 0;
    $$("#viewerBars span").forEach((bar, idx) => bar.classList.toggle("on", idx <= i));
  }

  function openViewer(i) {
    const bars = $("#viewerBars");
    bars.textContent = "";
    state.stories.forEach(() => bars.append(el("span")));
    showStory(i);
    openDialog($("#storyViewer"));
  }

  function moveStory(step) {
    const next = state.storyIndex + step;
    if (next < 0) return;
    if (next >= state.stories.length) { closeDialog($("#storyViewer")); return; }
    showStory(next);
  }

  let pendingPhoto = "";

  function startStoryAdd() {
    if (C.links.storyUpload) { window.open(C.links.storyUpload, "_blank", "noopener"); return; }
    $("#storyFile").click();
  }

  /* ---------- 代禱牆 ---------- */
  function prayerCard(p) {
    return el("article", { class: "prayer" },
      el("header", { class: "prayer__head" },
        el("span", { class: "prayer__avatar", "aria-hidden": "true" }, Array.from(p.name)[0]),
        el("span", { class: "prayer__who" }, el("strong", {}, p.name), p.partners ? el("span", {}, `和 ${p.partners}`) : null),
        el("time", { class: "prayer__time" }, ago(p.time))),
      p.prayer ? el("div", { class: "prayer__block" }, el("h3", {}, icon("heart"), "代禱"), el("p", {}, p.prayer)) : null,
      p.thanks ? el("div", { class: "prayer__block" }, el("h3", {}, icon("sun"), "感恩"), el("p", {}, p.thanks)) : null);
  }

  function renderPrayers(list) {
    const wall = $("#prayerWall");
    wall.textContent = "";
    if (!list.length) { wall.append(el("p", { class: "empty" }, "這週還沒有人寫代禱，你可以當第一個。")); return; }
    list.forEach((p) => wall.append(prayerCard(p)));
  }

  /* ---------- 對話框 ---------- */
  function openDialog(d) {
    if (d.open) return;
    d.showModal();
    document.documentElement.classList.add("locked");
  }

  function closeDialog(d) {
    d.close();
  }

  function setupDialogs() {
    $$("dialog").forEach((d) => {
      d.addEventListener("close", () => {
        if (!$("dialog[open]")) document.documentElement.classList.remove("locked");
        const form = $("[data-form]", d);
        const success = form && $(`[data-success="${form.dataset.form}"]`, d);
        if (success && !success.hidden) resetForm(form.dataset.form);
      });
      d.addEventListener("click", (e) => { if (e.target === d) closeDialog(d); });
    });
    document.addEventListener("click", (e) => {
      const trigger = e.target.closest("[data-open],[data-close],[data-swap],[data-story-add],[data-reset]");
      if (!trigger) return;
      if (trigger.dataset.open) openDialog($(`#${trigger.dataset.open}`));
      if ("close" in trigger.dataset) closeDialog(trigger.closest("dialog"));
      if (trigger.dataset.swap) { closeDialog(trigger.closest("dialog")); openDialog($(`#${trigger.dataset.swap}`)); }
      if ("storyAdd" in trigger.dataset) { const d = trigger.closest("dialog"); if (d) closeDialog(d); startStoryAdd(); }
      if (trigger.dataset.reset) resetForm(trigger.dataset.reset);
    });

    $("#viewerPrev").addEventListener("click", () => moveStory(-1));
    $("#viewerNext").addEventListener("click", () => moveStory(1));
    $("#storyViewer").addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") moveStory(1);
      if (e.key === "ArrowLeft") moveStory(-1);
    });

    $("#storyFile").addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (pendingPhoto) URL.revokeObjectURL(pendingPhoto);
      pendingPhoto = URL.createObjectURL(file);
      $("#storyPreview").src = pendingPhoto;
      e.target.value = "";
      openDialog($("#dlgStory"));
    });

    $("#storyForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const form = e.target;
      if (!validate(form)) return;
      state.stories.unshift({ school: form.school.value.trim(), photo: pendingPhoto, time: new Date() });
      pendingPhoto = "";
      form.reset();
      renderStories();
      closeDialog($("#dlgStory"));
    });
  }

  /* ---------- 表單 ---------- */
  function fieldError(input, message) {
    const err = $(".field__err", input.closest(".field"));
    if (!err) return;
    err.textContent = message || "";
    err.hidden = !message;
    if (message) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  }

  function validate(form) {
    let first = null;
    $$("[required]", form).forEach((input) => {
      const empty = !input.value.trim();
      fieldError(input, empty ? "這一格還沒填喔" : "");
      if (empty && !first) first = input;
    });
    if (form.dataset.requireOne) {
      const names = form.dataset.requireOne.split(",");
      const inputs = names.map((n) => form.elements[n]);
      const none = inputs.every((i) => !i.value.trim());
      fieldError(inputs[inputs.length - 1], none ? "代禱或感恩至少寫一項" : "");
      if (none && !first) first = inputs[0];
    }
    if (first) first.focus();
    return !first;
  }

  function resetForm(key) {
    const form = $(`[data-form="${key}"]`);
    const success = $(`[data-success="${key}"]`);
    form.reset();
    form.hidden = false;
    success.hidden = true;
  }

  function setupForms() {
    $$("[data-form]").forEach((form) => {
      const key = form.dataset.form;
      const button = $('button[type="submit"]', form);
      const failure = $(".form__err", form);
      form.addEventListener("input", (e) => {
        if (e.target.getAttribute("aria-invalid")) fieldError(e.target, "");
      });
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        failure.hidden = true;
        if (!validate(form)) return;
        const values = Object.fromEntries(new FormData(form).entries());
        button.disabled = true;
        button.classList.add("is-loading");
        try {
          const result = await D.submit(key, values);
          const success = $(`[data-success="${key}"]`);
          $(".success__demo", success).hidden = !result.demo;
          form.hidden = true;
          success.hidden = false;
          success.focus();
          if (key === "sharing") prependPrayer(values);
        } catch (err) {
          console.error("[校園教會] 表單送出失敗", err);
          failure.textContent = "送出失敗了，請檢查網路後再試一次，你填的內容都還在。";
          failure.hidden = false;
        } finally {
          button.disabled = false;
          button.classList.remove("is-loading");
        }
      });
    });
  }

  function prependPrayer(values) {
    const wall = $("#prayerWall");
    const empty = $(".empty", wall);
    if (empty) empty.remove();
    wall.prepend(prayerCard({ time: new Date(), name: values.name, partners: values.partners, prayer: values.prayer, thanks: values.thanks }));
  }

  /* ---------- 分頁 ---------- */
  const TITLES = { home: "校園教會｜Friday Night × Sunday Reset", welcome: "新朋友專區｜校園教會", prayer: "本週代禱牆｜校園教會", campus: "校園 1000｜校園教會" };
  let firstRoute = true;

  function route() {
    const hash = location.hash;
    if (hash && !hash.startsWith("#/")) return;
    const name = hash.replace(/^#\/?/, "") || "home";
    const target = TITLES[name] ? name : "home";
    document.body.dataset.route = target;
    $$(".view").forEach((v) => { v.hidden = v.dataset.view !== target; });
    $$(".tab").forEach((t) => {
      if (t.dataset.route === target) t.setAttribute("aria-current", "page");
      else t.removeAttribute("aria-current");
    });
    document.title = TITLES[target];
    window.scrollTo(0, 0);
    if (!firstRoute) $(`[data-view="${target}"] h1`).focus({ preventScroll: true });
    firstRoute = false;
  }

  /* ---------- 啟動 ---------- */
  async function loadInto(key, onData, onFail) {
    try {
      onData(await D.load(key));
    } catch (err) {
      console.error(`[校園教會] 讀取「${key}」失敗：`, err);
      if (onFail) onFail(err);
    }
  }

  function init() {
    const saved = storage.get(REGION_KEY);
    if (saved && C.regions.some((r) => r.name === saved)) state.region = saved;

    $("#photosLink").href = C.links.photos;
    $("#demoNote").hidden = !D.usingSampleData();
    $("#skipLink").addEventListener("click", () => $(".view:not([hidden]) h1").focus());
    $("#schoolSearch").addEventListener("input", (e) => { state.schoolQuery = e.target.value; renderSchools(); });

    setupDialogs();
    setupForms();
    window.addEventListener("hashchange", route);
    route();
    renderRegionSwitches();
    renderStories();

    loadInto("meetings", (list) => { state.meetings = list; renderMeetings(); }, () => { state.meetingsFailed = true; renderMeetings(); });
    loadInto("stats", renderStats);
    loadInto("schools", (list) => { state.schools = list; renderSchoolFilter(); renderSchools(); });
    loadInto("stories", (list) => { state.stories = list; renderStories(); });
    loadInto("prayers", renderPrayers, () => {
      const wall = $("#prayerWall");
      wall.textContent = "";
      wall.append(el("p", { class: "empty" }, "暫時讀不到代禱牆，請稍後再回來看看。"));
    });

    setInterval(tick, 1000);
  }

  init();
})();
