/* Kedo bridge for a Post Studio page embedded in the Kedo admin.
   Adds "Schedule in Kedo" (image or carousel) and "Video → Kedo" buttons. They hand the
   rendered media, the per-platform captions, the hashtag, the first reply and the
   hard-lines check result to the admin page, which opens the scheduler with them.
   It only uses the studio's public globals: state, T, WEEK, pagesOf, renderBlob,
   captionsOf, tagOf, replyOf, runCheck, offer, fname, toast, $. */
(function () {
  "use strict";
  if (window.parent === window) return; // opened on its own: plain studio
  const ORIGIN = location.origin;

  // Wrap the studio's export function so that an export can be routed to Kedo.
  let capture = null;
  const origOffer = window.offer;
  window.offer = async function (filename, blob, kind) {
    if (capture) { const c = capture; capture = null; c({ filename, blob, kind }); return; }
    return origOffer(filename, blob, kind);
  };

  function details(k) {
    const caps = captionsOf(k);
    const reply = replyOf(k);
    const check = runCheck(k, state.vals[k], T[k].fixed ? null : caps, reply) || [];
    const day = T[k].days ? (WEEK.find((w) => w.id === state.day[k]) || {}) : null;
    return {
      template: T[k].name + (day ? " · " + day.day + " " + day.topic : ""),
      key: k,
      captions: caps,
      tag: tagOf(k),
      reply,
      check: check.map((c) => ({ sev: c.sev, where: c.where, msg: c.msg })),
    };
  }
  function blocked(d) {
    const b = d.check.filter((c) => c.sev === "block");
    if (b.length) { toast("Fix the hard lines first: " + b[0].msg); $("hlPill") && $("hlPill").click(); return true; }
    return false;
  }
  function send(d, media) {
    window.parent.postMessage({ type: "kedo:studio-post", ...d, media }, ORIGIN);
  }

  async function sendImages(btn) {
    const k = state.cur, d = details(k);
    if (blocked(d)) return;
    btn.disabled = true;
    try {
      const fmt = state.fmts[k], scale = state.hires ? 2 : 1, n = pagesOf(k), media = [];
      for (let i = 0; i < n; i++) {
        const blob = await renderBlob(k, fmt, scale, i);
        media.push({ blob, name: fname(k, fmt, "png", n > 1 ? "-slide" + (i + 1) : ""), type: "image/png" });
      }
      send(d, media);
    } catch (e) { console.error(e); toast("The image couldn't be created. Try again."); }
    finally { btn.disabled = false; }
  }

  async function sendVideo(btn) {
    const k = state.cur, d = details(k);
    if (blocked(d)) return;
    btn.disabled = true;
    const got = new Promise((res) => { capture = res; });
    const timeout = new Promise((res) => setTimeout(() => res(null), ((state.durs[k] || 6) + 40) * 1000));
    $("vidBtn").click();
    const r = await Promise.race([got, timeout]);
    capture = null;
    btn.disabled = false;
    if (!r || r.kind !== "video") return; // the studio already showed the error
    if (!/mp4/.test(r.blob.type)) toast("This browser recorded WebM. Most platforms need MP4, so try Chrome, Edge or Safari.");
    send(d, [{ blob: r.blob, name: r.filename, type: r.blob.type || "video/mp4" }]);
  }

  function mount() {
    const dl = $("dlBtn");
    if (dl) dl.className = "btn";
    const top = document.querySelector(".top-actions");
    const b = document.createElement("button");
    b.type = "button"; b.className = "btn primary"; b.id = "kedoSendBtn";
    b.title = "Send this post (image or all slides, captions and first reply) to the Kedo scheduler";
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M16 3v4M8 3v4M3 11h18"></path></svg><span>Schedule in Kedo</span>';
    b.onclick = () => sendImages(b);
    if (top) top.appendChild(b);

    const vid = $("vidBtn");
    if (vid) {
      const v = document.createElement("button");
      v.type = "button"; v.className = "btn small"; v.id = "kedoVidBtn";
      v.textContent = "Video → Kedo";
      v.title = "Record the animation and send it to the Kedo scheduler";
      v.onclick = () => sendVideo(v);
      vid.insertAdjacentElement("afterend", v);
    }
    window.parent.postMessage({ type: "kedo:studio-ready" }, ORIGIN);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
