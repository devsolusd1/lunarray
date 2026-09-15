/* ASCII helpers: block-letter logo (ANSI Shadow style), shaded crescent moon, ascii buttons, sparkline. */
window.ASCII = (() => {
  const NL = String.fromCharCode(10);
  const F = {
    A: [" █████╗ ", "██╔══██╗", "███████║", "██╔══██║", "██║  ██║", "╚═╝  ╚═╝"],
    D: ["██████╗ ", "██╔══██╗", "██║  ██║", "██║  ██║", "██████╔╝", "╚═════╝ "],
    E: ["███████╗", "██╔════╝", "█████╗  ", "██╔══╝  ", "███████╗", "╚══════╝"],
    I: ["██╗", "██║", "██║", "██║", "██║", "╚═╝"],
    L: ["██╗     ", "██║     ", "██║     ", "██║     ", "███████╗", "╚══════╝"],
    M: ["███╗   ███╗", "████╗ ████║", "██╔████╔██║", "██║╚██╔╝██║", "██║ ╚═╝ ██║", "╚═╝     ╚═╝"],
    N: ["███╗   ██╗", "████╗  ██║", "██╔██╗ ██║", "██║╚██╗██║", "██║ ╚████║", "╚═╝  ╚═══╝"],
    O: [" ██████╗ ", "██╔═══██╗", "██║   ██║", "██║   ██║", "╚██████╔╝", " ╚═════╝ "],
    R: ["██████╗ ", "██╔══██╗", "██████╔╝", "██╔══██╗", "██║  ██║", "╚═╝  ╚═╝"],
    S: ["███████╗", "██╔════╝", "███████╗", "╚════██║", "███████║", "╚══════╝"],
    T: ["████████╗", "╚══██╔══╝", "   ██║   ", "   ██║   ", "   ██║   ", "   ╚═╝   "],
    U: ["██╗   ██╗", "██║   ██║", "██║   ██║", "██║   ██║", "╚██████╔╝", " ╚═════╝ "],
    Y: ["██╗   ██╗", "╚██╗ ██╔╝", " ╚████╔╝ ", "  ╚██╔╝  ", "   ██║   ", "   ╚═╝   "],
    " ": ["  ", "  ", "  ", "  ", "  ", "  "],
  };
  const logo = (word) => {
    const rows = [];
    for (let r = 0; r < 6; r++) rows.push([...word.toUpperCase()].map((ch) => (F[ch] || F[" "])[r]).join(" "));
    return rows.join(NL);
  };

  // Crescent like a waxing moon photo: a disc minus a slightly smaller disc offset up-right.
  // Pixel values: 0 = dark sky, 2 = lit limb (bright), 1 = terminator / craters (dim).
  const moonGrid = (D = 28, r = 13.5, r2 = 13.2, d = 8, thetaDeg = 30, band = 2.0) => {
    const cx = D / 2, cy = D / 2, th = (thetaDeg * Math.PI) / 180;
    const ox = cx + d * Math.cos(th), oy = cy - d * Math.sin(th);
    let s = 11; const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    const g = [];
    for (let y = 0; y < D; y++) {
      const row = [];
      for (let x = 0; x < D; x++) {
        const px = x + 0.5, py = y + 0.5;
        const dBig = Math.hypot(px - cx, py - cy), dCut = Math.hypot(px - ox, py - oy);
        const lit = dBig <= r && dCut > r2;
        let v = 0;
        if (lit) {
          v = dCut - r2 < band || r - dBig < 0.35 ? 1 : 2;
          if (v === 2 && rnd() > 0.88) v = 1; // craters
        }
        row.push(v);
      }
      g.push(row);
    }
    return g;
  };
  // half-block rendering (2 px per character row); lines keep a constant width so centering does not warp the shape
  const renderMoon = (g, html) => {
    const lines = [];
    for (let y = 0; y < g.length; y += 2) {
      let line = "";
      for (let x = 0; x < g[0].length; x++) {
        const t = g[y][x], b = g[y + 1] ? g[y + 1][x] : 0;
        const ch = t && b ? "█" : t ? "▀" : b ? "▄" : " ";
        if (!html || ch === " ") { line += ch; continue; }
        const dim = t === 1 || b === 1;
        line += dim ? `<span class="d">${ch}</span>` : ch;
      }
      lines.push(line);
    }
    return lines.join(NL);
  };
  const MOON = moonGrid();
  const moon = renderMoon(MOON, false);
  const moonHTML = renderMoon(MOON, true);

  // favicon from the same pixels: bright + dim violet on near-black purple
  const favicon = () => {
    try {
      const g = MOON, S = 32, cell = S / g.length;
      const cv = document.createElement("canvas"); cv.width = S; cv.height = S;
      const ctx = cv.getContext("2d");
      ctx.fillStyle = "#07050d"; ctx.fillRect(0, 0, S, S);
      g.forEach((row, y) => row.forEach((v, x) => {
        if (!v) return;
        ctx.fillStyle = v === 2 ? "#b388ff" : "#6a3fcf";
        ctx.fillRect(Math.round(x * cell), Math.round(y * cell), Math.ceil(cell), Math.ceil(cell));
      }));
      let link = document.querySelector('link[rel="icon"]');
      if (!link) { link = document.createElement("link"); link.rel = "icon"; document.head.appendChild(link); }
      link.type = "image/png"; link.href = cv.toDataURL("image/png");
    } catch (e) { /* no canvas: keep the svg icon */ }
  };

  const ground = (w) => "▀".repeat(w);
  // deterministic scatter of rain glyphs
  const rain = (cols, rows, seed = 7) => {
    let s = seed; const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    const g = ["░", "▒", "·", "'", "│"];
    const out = [];
    for (let r = 0; r < rows; r++) {
      let line = "";
      for (let c = 0; c < cols; c++) line += rnd() < 0.045 ? g[Math.floor(rnd() * g.length)] : " ";
      out.push(line);
    }
    return out.join(NL);
  };
  const button = (label) => {
    const w = label.length + 4;
    return `${"▄".repeat(w)}${NL}█  ${label} █<span class="sh">▓</span>${NL}${"▀".repeat(w)}<span class="sh">▓</span>`;
  };
  const spark = (values, target) => {
    const bars = "▁▂▃▄▅▆▇█";
    const all = values.concat(target != null ? [target] : []);
    const min = Math.min(...all), max = Math.max(...all);
    const lvl = (v) => (max === min ? 4 : Math.round(((v - min) / (max - min)) * 7));
    const tl = target != null ? lvl(target) : -1;
    return values.map((v) => { const l = lvl(v); return l === tl ? `<span class="t">${bars[l]}</span>` : bars[l]; }).join("");
  };
  // box-drawing table. rows: {l, v, c, href} label/value (value right-aligned, class c, optional link),
  // {raw, len, c} free line (len = visible length when raw contains html), {sep: true} rule.
  const esc = (x) => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const cut = (t, n) => (t.length <= n ? t : n <= 1 ? "…" : t.slice(0, n - 1) + "…");
  const box = (title, rows, inner = 40) => {
    const bd = (t) => `<span class="bd">${t}</span>`;
    const H = "─";
    const headLen = title ? title.length + 3 : 0; // "─ title " then rule to the corner
    const out = [bd("┌") + (title ? bd(H + " ") + `<span class="bt">${esc(title)}</span>` + bd(" ") : "") + bd(H.repeat(Math.max(0, inner - headLen))) + bd("┐")];
    for (const r of rows) {
      if (r.sep) { out.push(bd("├" + H.repeat(inner) + "┤")); continue; }
      if (r.raw != null) {
        const len = r.len != null ? r.len : String(r.raw).length;
        const pad = Math.max(0, inner - 2 - len);
        const body = r.len != null ? r.raw : esc(cut(String(r.raw), inner - 2));
        out.push(bd("│ ") + (r.c ? `<span class="${r.c}">${body}</span>` : body) + " ".repeat(pad) + bd(" │"));
        continue;
      }
      const v = String(r.v == null ? "—" : r.v);
      const room = inner - 2 - v.length - 1;
      const l = cut(String(r.l), Math.max(1, room));
      const gap = Math.max(1, inner - 2 - l.length - v.length);
      const vs = `<span class="${r.c || "bv"}">${esc(v)}</span>`;
      const val = r.href ? `<a href="${esc(r.href)}" target="_blank" rel="noopener">${vs}</a>` : vs;
      out.push(bd("│ ") + esc(l) + " ".repeat(gap) + val + bd(" │"));
    }
    out.push(bd("└" + H.repeat(inner) + "┘"));
    return out.join(NL);
  };
  return { logo, moon, moonHTML, moonGrid, favicon, ground, rain, button, spark, box, esc };
})();
