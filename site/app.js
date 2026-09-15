/* LUNARRAY terminal dashboard: reads via RPC, transacts via injected wallet (or a dev key on localhost). */
(() => {
  const C = window.BOND_CONFIG;
  const { ethers } = window;
  const A = window.ASCII;
  const Q96 = 1n << 96n;

  const ENGINE_ABI = [
    "function token() view returns (address)",
    "function curve() view returns (address)",
    "function started() view returns (bool)",
    "function priceSource() view returns (uint8)",
    "function epoch() view returns (uint32)",
    "function epochLength() view returns (uint64)",
    "function lastSampleAt() view returns (uint64)",
    "function sampleCount() view returns (uint32)",
    "function sampleCursor() view returns (uint32)",
    "function sampleAt(uint32) view returns (uint256)",
    "function spot() view returns (uint256)",
    "function target() view returns (uint256)",
    "function discountBps() view returns (uint16)",
    "function bonusBps() view returns (uint16)",
    "function isPaused() view returns (bool)",
    "function pausedUntil() view returns (uint64)",
    "function idleFor() view returns (uint256)",
    "function ethReserve() view returns (uint256)",
    "function crypt() view returns (uint256)",
    "function totalStaked() view returns (uint256)",
    "function totalBurned() view returns (uint256)",
    "function totalBoughtBack() view returns (uint256)",
    "function bondedOutstanding() view returns (uint256)",
    "function params() view returns (uint16 maxBonusBps,uint16 bandBps,uint16 entryBurnBps,uint16 penaltyBps,uint16 releaseBps,uint16 stakingShareBps,uint16 window,uint16 vestEpochs,uint16 minSamples)",
    "function TIP_BPS() view returns (uint16)",
    "function TIP_CAP() view returns (uint256)",
    "function staked(address) view returns (uint256)",
    "function earned(address) view returns (uint256)",
    "function bondIdsOf(address) view returns (uint256[])",
    "function bonds(uint256) view returns (address owner,uint128 principal,uint128 payout,uint32 createdEpoch,uint32 maturityEpoch,bool closed)",
    "function queueHead() view returns (uint256)",
    "function start()",
    "function poke()",
    "function settle(uint256) returns (uint256)",
    "function bond(uint256 amount,uint16 minBonusBps) returns (uint256)",
    "function exit(uint256 id)",
    "function stake(uint256)",
    "function unstake(uint256)",
    "function claimRewards() returns (uint256)",
  ];
  const SPLITTER_ABI = [
    "function pending() view returns (uint256)",
    "function treasuryBps() view returns (uint16)",
    "function totalHarvested() view returns (uint256)",
    "function totalToTreasury() view returns (uint256)",
    "function totalToProtocol() view returns (uint256)",
    "function treasury() view returns (address)",
    "function harvest() returns (uint256)",
  ];
  const ERC20_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
  ];

  const $ = (id) => document.getElementById(id);
  const provider = window.RPC.makeProvider(ethers, C);
  const mcall = (calls) => window.RPC.multicall(ethers, provider, C.multicall, calls);
  const engineR = new ethers.Contract(C.engine || ethers.ZeroAddress, ENGINE_ABI, provider);
  const splitterR = new ethers.Contract(C.splitter || ethers.ZeroAddress, SPLITTER_ABI, provider);
  let tokenR = new ethers.Contract(C.token || ethers.ZeroAddress, ERC20_ABI, provider);
  let signer = null, account = null, decimals = 18, symbol = C.tokenSymbol || "TOKEN", currentBonusBps = 0;
  let S = null;                 // last engine/splitter snapshot
  let U = null;                 // last user snapshot
  let addresses = {};           // footer table

  const loc = "en-US";
  const fmtTok = (v, d = 0) => Number(ethers.formatUnits(v, decimals)).toLocaleString(loc, { maximumFractionDigits: d });
  const tok = (v) => fmtTok(v) + " " + symbol;
  const fmtEth = (v, d = 4) => Number(ethers.formatEther(v)).toLocaleString(loc, { maximumFractionDigits: d }) + " ETH";
  const fromQ96 = (q) => Number((q * 1000000n) / Q96) / 1e6;
  const fmtNum = (n, d = 2) => n.toLocaleString(loc, { maximumFractionDigits: d });
  const pct = (bps) => (Number(bps) / 100).toFixed(2) + "%";
  const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);
  const explorer = (path) => `${C.explorer}/${path}`;
  const clock = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ":" : "") + String(m).padStart(2, "0") + ":" + String(x).padStart(2, "0"); };
  const prompt = (text, err) => { const p = $("prompt"); p.className = "prompt" + (err ? " err" : ""); p.innerHTML = "&gt; " + A.esc(text) + '<span class="cur">█</span>'; };
  const SOURCE = ["no live market", "pons curve", "uniswap v4"];
  const narrow = () => window.innerWidth < 720;
  const W = () => 40;                          // inner width of a side-by-side box
  const WIDE = () => (narrow() ? 40 : 84);     // inner width of a full-width box

  // ---------------------------------------------------------------- static art
  function paintHeader() {
    $("logo").textContent = A.logo(C.name || "LUNARRAY");
    $("moon").innerHTML = A.moonHTML;
    A.favicon();
    $("rain").textContent = A.rain(88, 14);
    $("ground").textContent = A.ground(120);
    const cb = $("connectBtn");
    cb.innerHTML = `<pre>${A.button("CONNECT")}</pre>`;
    cb.onclick = (e) => { e.preventDefault(); connect(); };
    const bar = $("abar");
    TABS.forEach(([label, id]) => {
      const a = document.createElement("a");
      a.className = "abtn"; a.href = "#" + id; a.dataset.tab = id; a.innerHTML = `<pre>${A.button(label)}</pre>`;
      a.onclick = (e) => { e.preventDefault(); showTab(id, true); };
      bar.appendChild(a);
    });
    if (C.x) {
      const a = document.createElement("a");
      a.className = "abtn"; a.href = C.x; a.target = "_blank"; a.rel = "noopener"; a.title = C.x.replace("https://", "");
      a.innerHTML = `<pre>${A.button("X")}</pre>`;
      bar.appendChild(a);
    }
  }

  // ---------------------------------------------------------------- tabs (hash-addressable: #dashboard #bond #stake #nfo)
  const TABS = [["DASHBOARD", "dashboard"], ["BOND", "bond"], ["STAKE", "stake"], ["NFO", "nfo"]];
  function showTab(id, push) {
    if (!TABS.some(([, t]) => t === id)) id = "dashboard";
    document.querySelectorAll("section.tab").forEach((s) => { s.hidden = s.id !== id; });
    document.querySelectorAll("#abar .abtn[data-tab]").forEach((a) => a.classList.toggle("on", a.dataset.tab === id));
    if (push && location.hash !== "#" + id) history.replaceState(null, "", "#" + id);
  }
  window.addEventListener("hashchange", () => showTab(location.hash.slice(1), false));

  // ---------------------------------------------------------------- boxes
  const dash = () => "—";
  function paintBoxes() {
    if (!S) {
      const empty = (t, n) => A.box(t, Array.from({ length: n }, () => ({ raw: "" })), W());
      $("boxPrice").innerHTML = empty("PRICE", 5); $("boxEpoch").innerHTML = empty("EPOCH", 5);
      $("boxReserves").innerHTML = empty("RESERVES", 6); $("boxFees").innerHTML = empty("FEES", 4);
      $("boxBond").innerHTML = empty("BOND TERMS", 7); $("boxStake").innerHTML = empty("STAKING", 5);
      return;
    }
    const p = S.params, disc = Number(S.discount), bon = Number(S.bonus);
    const next = Number(S.lastSampleAt + S.epochLength) - Math.floor(Date.now() / 1000);
    const nextPoke = !S.started ? (S.src ? "start first" : "waiting for market") : next <= 0 ? "now" : "in " + clock(next);
    const tip = (S.ethReserve * BigInt(S.tipBps)) / 10000n;
    const tBps = Number(S.tBps);

    $("boxPrice").innerHTML = A.box("PRICE", [
      { l: "spot", v: S.spot > 0n ? fmtNum(fromQ96(S.spot), 0) + " / ETH" : dash() },
      { l: `target (${p.window}-epoch avg)`, v: S.target > 0n ? fmtNum(fromQ96(S.target), 0) + " / ETH" : dash() },
      { l: "discount to target", v: pct(S.discount), c: disc > 0 ? "hi" : "bv" },
      { l: "bond bonus now", v: pct(S.bonus), c: bon > 0 ? "hi" : "bv" },
      { l: "market", v: SOURCE[S.src] || "?", c: "ac" },
    ], W());

    $("boxEpoch").innerHTML = A.box("EPOCH", [
      { l: "epoch", v: S.epoch.toString() },
      { l: "next poke", v: nextPoke, c: S.started && next <= 0 ? "hi" : "bv" },
      { l: "samples", v: `${S.sampleCount} (min ${p.minSamples})` },
      { l: "last sample", v: S.lastSampleAt > 0n ? new Date(Number(S.lastSampleAt) * 1000).toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" }) : dash() },
      { l: "poke tip", v: fmtEth(tip < S.tipCap ? tip : S.tipCap, 5) },
      { l: "new entries", v: S.paused ? "paused" : "open", c: S.paused ? "hi" : "bv" },
    ], W());

    $("boxReserves").innerHTML = A.box("RESERVES", [
      { l: "ETH reserve (buybacks)", v: fmtEth(S.ethReserve) },
      { l: "crypt, pays bonds", v: tok(S.crypt) },
      { l: "bonds owed", v: tok(S.outstanding) },
      { l: "bought back", v: tok(S.boughtBack) },
      { l: "burned", v: tok(S.burned) },
      { l: "total staked", v: tok(S.totalStaked) },
    ], W());

    $("boxFees").innerHTML = A.box("FEES", [
      { l: "unclaimed on pons", v: fmtEth(S.pending), c: S.pending > 0n ? "hi" : "bv" },
      { l: "harvested, total", v: fmtEth(S.harvested) },
      { l: `to treasury (${tBps / 100}%)`, v: fmtEth(S.toT) },
      { l: `to protocol (${(10000 - tBps) / 100}%)`, v: fmtEth(S.toP) },
      { l: `  to stakers (${p.stakingShareBps / 100}%)`, v: "as ETH rewards", c: "dm" },
      { l: "  the rest", v: "buyback reserve", c: "dm" },
    ], W());

    $("boxBond").innerHTML = A.box("BOND TERMS", [
      { l: "discount to target", v: pct(S.discount), c: disc > 0 ? "hi" : "bv" },
      { l: "bonus now", v: pct(S.bonus), c: bon > 0 ? "hi" : "bv" },
      { l: "matures after", v: `${p.vestEpochs} epochs` },
      { l: "burned on entry", v: `${p.entryBurnBps / 100}%` },
      { l: "early exit penalty", v: `${p.penaltyBps / 100}%` },
      { sep: true },
      { l: "crypt, pays bonds", v: tok(S.crypt) },
      { l: "bonds owed", v: tok(S.outstanding) },
      { l: "status", v: bondStatus(), c: bon > 0 && S.started && !S.paused ? "hi" : "dm" },
    ], W());

    $("boxStake").innerHTML = A.box("STAKING", [
      { l: "staker share of protocol ETH", v: `${p.stakingShareBps / 100}%` },
      { l: "total staked", v: tok(S.totalStaked) },
      { l: "ETH to protocol, total", v: fmtEth(S.toP) },
      { sep: true },
      { l: "your stake", v: U ? tok(U.staked) : "connect wallet", c: U ? "bv" : "dm" },
      { l: "your ETH to claim", v: U ? fmtEth(U.earned, 6) : "connect wallet", c: U ? (U.earned > 0n ? "hi" : "bv") : "dm" },
    ], W());
  }

  function bondStatus() {
    if (!S.started) return "engine not started";
    if (Number(S.sampleCount) < Number(S.params.minSamples)) return `open after ${S.params.minSamples} samples`;
    if (S.paused) return "entries paused";
    if (Number(S.bonus) === 0) return "closed · at or above target";
    return "OPEN";
  }

  function paintContracts() {
    const rows = [["engine", C.engine], ["splitter", C.splitter], ["token", addresses.token || C.token], ["curve", addresses.curve], ["staked (sLUNARRAY)", C.staked], ["treasury", addresses.treasury]]
      .filter(([, a]) => a && a !== ethers.ZeroAddress)
      .map(([l, a]) => ({ l, v: narrow() ? short(a) : a, href: explorer("address/" + a) }));
    if (rows.length === 0) rows.push({ raw: "not deployed yet", c: "dm" });
    $("boxContracts").innerHTML = A.box("CONTRACTS", rows, WIDE());
  }

  // ---------------------------------------------------------------- chart (ascii sparkline in a box)
  async function refreshChart() {
    try {
      const inner = WIDE();
      const [cursor, count, target, spot] = await mcall([{ c: engineR, f: "sampleCursor" }, { c: engineR, f: "sampleCount" }, { c: engineR, f: "target" }, { c: engineR, f: "spot" }]);
      const n = Math.min(Number(count), inner - 3);
      if (n === 0) { $("boxChart").innerHTML = A.box("PRICE HISTORY · ETH per 1M tokens", [{ raw: "no samples yet", c: "dm" }], inner); return; }
      const idx = []; for (let i = n; i >= 1; i--) idx.push(Number(cursor) - i);
      const samples = await mcall(idx.map((i) => ({ c: engineR, f: "sampleAt", a: [i] })));
      const toPrice = (q) => (q > 0n ? 1e6 / fromQ96(q) : 0);
      const vals = samples.map(toPrice); if (spot > 0n) vals.push(toPrice(spot));
      const t = target > 0n ? toPrice(target) : null;
      const lo = Math.min(...vals), hi = Math.max(...vals);
      const f = (x) => x.toLocaleString(loc, { maximumFractionDigits: 4 });
      const items = [`${vals.length} epochs, oldest → now`, `low ${f(lo)} · high ${f(hi)}`];
      if (t != null) items.push(`target ${f(t)} = ▮`);
      const mark = (x) => A.esc(x).replace("▮", '<span class="hi">▮</span>');
      const one = items.join(" · ");
      const legend = one.length <= inner - 2 ? [{ raw: mark(one), len: one.length, c: "dm" }] : items.map((x) => ({ raw: mark(x), len: x.length, c: "dm" }));
      $("boxChart").innerHTML = A.box("PRICE HISTORY · ETH per 1M tokens", [
        { raw: `<span class="spark ac">${A.spark(vals, t)}</span>`, len: vals.length },
        ...legend,
      ], inner);
    } catch (e) { console.warn("chart", e); }
  }

  // ---------------------------------------------------------------- stats
  async function refresh() {
    try {
      const E = (f) => ({ c: engineR, f }), Sp = (f) => ({ c: splitterR, f });
      const [started, source, epoch, epochLength, lastSampleAt, sampleCount, spot, target, discount, bonus, paused, ethReserve, crypt, totalStaked, burned, boughtBack, outstanding, params, tipBps, tipCap,
        pending, tBps, harvested, toT, toP] = await mcall([
        E("started"), E("priceSource"), E("epoch"), E("epochLength"), E("lastSampleAt"), E("sampleCount"), E("spot"), E("target"), E("discountBps"), E("bonusBps"), E("isPaused"),
        E("ethReserve"), E("crypt"), E("totalStaked"), E("totalBurned"), E("totalBoughtBack"), E("bondedOutstanding"), E("params"), E("TIP_BPS"), E("TIP_CAP"),
        Sp("pending"), Sp("treasuryBps"), Sp("totalHarvested"), Sp("totalToTreasury"), Sp("totalToProtocol"),
      ]);
      const P = Object.fromEntries(["maxBonusBps", "bandBps", "entryBurnBps", "penaltyBps", "releaseBps", "stakingShareBps", "window", "vestEpochs", "minSamples"].map((k) => [k, Number(params[k])]));
      S = { started, src: Number(source), epoch, epochLength, lastSampleAt, sampleCount, spot, target, discount, bonus, paused, ethReserve, crypt, totalStaked, burned, boughtBack, outstanding, params: P, tipBps, tipCap, pending, tBps, harvested, toT, toP };
      currentBonusBps = Number(bonus);
      const next = Number(lastSampleAt + epochLength) - Math.floor(Date.now() / 1000);
      const state = !started ? (S.src ? "READY TO START" : "WAITING FOR MARKET") : paused ? "ENTRIES PAUSED" : Number(discount) > 0 ? "BONDS OPEN" : "ABOVE TARGET";
      const stateTag = state === "BONDS OPEN" ? `<b>${state}</b>` : state === "ENTRIES PAUSED" ? `<i>${state}</i>` : state;
      $("statusbar").innerHTML = ` EPOCH ${epoch}  ${stateTag}  ${SOURCE[S.src] || "?"}  next poke ${!started ? "—" : next <= 0 ? "now" : "in " + clock(next)}  spot ${spot > 0n ? fmtNum(fromQ96(spot), 0) : "—"}  target ${target > 0n ? fmtNum(fromQ96(target), 0) : "—"}  ${(Number(discount) / 100).toFixed(2)}% below`;
      $("pokeBtn").textContent = started ? "POKE" : "START";
      $("pokeBtn").disabled = started ? next > 0 : spot === 0n;
      $("bondBtn").disabled = !started || Number(bonus) === 0 || Number(sampleCount) < Number(params.minSamples) || paused;
      $("bondHelp").textContent = !started ? "bonds open once the engine is started (anyone can start it as soon as the curve is live)." : Number(sampleCount) < Number(params.minSamples) ? `bonds open after ${params.minSamples} samples.` : Number(bonus) === 0 ? "price is at or above target. bonds open when it drops below." : paused ? "new entries are paused." : "";
      $("harvestBtn").disabled = pending === 0n;
      if (account) await refreshUser();
      paintBoxes();
      quoteBond();
      if (!$("prompt").dataset.busy) prompt(account ? `connected ${short(account)} · rpc ok` : "rpc ok · not connected");
    } catch (e) {
      console.error(e);
      if (e && (e.code === "BAD_DATA" || e.code === "CALL_EXCEPTION")) {
        $("statusbar").textContent = " CONTRACTS NOT DEPLOYED · launch pending";
        prompt("rpc ok · contracts not deployed on this chain yet", true);
      } else {
        $("statusbar").textContent = " RPC UNREACHABLE";
        prompt("rpc unreachable · " + (e.shortMessage || e.message), true);
      }
    }
  }

  async function refreshUser() {
    const [bal, st, earned, ids, epoch] = await mcall([{ c: tokenR, f: "balanceOf", a: [account] }, { c: engineR, f: "staked", a: [account] }, { c: engineR, f: "earned", a: [account] }, { c: engineR, f: "bondIdsOf", a: [account] }, { c: engineR, f: "epoch" }]);
    U = { bal, staked: st, earned };
    $("bondMax").dataset.max = ethers.formatUnits(bal, decimals);
    $("stakeMax").dataset.max = ethers.formatUnits(bal, decimals);
    const tbody = $("myBonds");
    tbody.innerHTML = "";
    $("myBondsTable").hidden = ids.length === 0;
    if (ids.length === 0) return;
    const idList = [...ids].reverse();
    const [head, ...bondRows] = await mcall([{ c: engineR, f: "queueHead" }, ...idList.map((id) => ({ c: engineR, f: "bonds", a: [id] }))]);
    for (let k = 0; k < idList.length; k++) {
      const id = idList[k], b = bondRows[k];
      const matured = epoch >= b.maturityEpoch;
      const status = b.closed ? (id < head ? "paid" : "closed") : matured ? "matured · waiting for crypt" : `matures at epoch ${b.maturityEpoch}`;
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${id}</td><td>${fmtTok(b.principal)}</td><td>${fmtTok(b.payout)}</td><td>${status}</td><td></td>`;
      if (!b.closed) {
        const btn = document.createElement("button");
        btn.className = "tbtn"; btn.textContent = "EXIT";
        btn.onclick = () => send(() => engineW().exit(id), `bond ${id} exited`);
        tr.lastElementChild.appendChild(btn);
      }
      tbody.appendChild(tr);
    }
  }

  function quoteBond() {
    const amt = parseFloat(($("bondAmt").value || "0").replace(",", "."));
    if (!S || !amt) return ($("bondQuote").textContent = "—");
    const principal = amt * (1 - Number(S.params.entryBurnBps) / 10000);
    const out = principal * (1 + currentBonusBps / 10000);
    $("bondQuote").textContent = `${fmtNum(out)} ${symbol} (+${(currentBonusBps / 100).toFixed(2)}%)`;
  }

  // ---------------------------------------------------------------- wallet
  async function connect() {
    try {
      if (C.devPrivateKey) {
        signer = new ethers.Wallet(C.devPrivateKey, provider);
      } else {
        if (!window.ethereum) return prompt("no wallet found", true);
        const bp = new ethers.BrowserProvider(window.ethereum);
        await bp.send("eth_requestAccounts", []);
        const net = await bp.getNetwork();
        if (Number(net.chainId) !== C.chainId) {
          try {
            await bp.send("wallet_switchEthereumChain", [{ chainId: "0x" + C.chainId.toString(16) }]);
          } catch {
            await bp.send("wallet_addEthereumChain", [{ chainId: "0x" + C.chainId.toString(16), chainName: C.chainName, rpcUrls: [C.rpc], nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, blockExplorerUrls: [C.explorer] }]);
          }
        }
        signer = await new ethers.BrowserProvider(window.ethereum).getSigner();
      }
      account = await signer.getAddress();
      $("connectBtn").innerHTML = `<pre>${A.button(short(account).toUpperCase())}</pre>`;
      $("connectBtn").classList.add("on");
      $("connectBtn").title = account;
      prompt(`connected ${short(account)}`);
      await refreshUser();
      paintBoxes();
    } catch (e) { prompt(e.shortMessage || e.message, true); }
  }
  const engineW = () => new ethers.Contract(C.engine, ENGINE_ABI, signer);
  const splitterW = () => new ethers.Contract(C.splitter, SPLITTER_ABI, signer);
  const tokenW = () => new ethers.Contract(C.token, ERC20_ABI, signer);

  async function send(fn, okText) {
    if (!signer) { await connect(); if (!signer) return; }
    const p = $("prompt"); p.dataset.busy = "1";
    try {
      prompt("confirm in your wallet…");
      const tx = await fn();
      prompt(`pending ${tx.hash.slice(0, 12)}…`);
      await tx.wait();
      prompt(okText + " · " + tx.hash.slice(0, 12));
      await refresh();
      refreshChart();
      setTimeout(() => delete p.dataset.busy, 15000);
    } catch (e) {
      console.error(e);
      prompt(e.shortMessage || e.reason || e.message, true);
      setTimeout(() => delete p.dataset.busy, 15000);
    }
  }
  async function ensureAllowance(amount) {
    const cur = await tokenR.allowance(account, C.engine);
    if (cur >= amount) return;
    prompt("approving token…");
    const tx = await tokenW().approve(C.engine, ethers.MaxUint256);
    await tx.wait();
  }
  const parseAmt = (id) => ethers.parseUnits(($(id).value || "0").replace(",", "."), decimals);

  paintHeader();
  showTab(location.hash.slice(1), false);
  paintBoxes();
  paintContracts();
  $("bondForm").onsubmit = (e) => { e.preventDefault(); send(async () => { const a = parseAmt("bondAmt"); await ensureAllowance(a); return engineW().bond(a, Math.max(0, currentBonusBps - 50)); }, "bond created"); };
  $("stakeForm").onsubmit = (e) => { e.preventDefault(); send(async () => { const a = parseAmt("stakeAmt"); await ensureAllowance(a); return engineW().stake(a); }, "staked"); };
  $("unstakeBtn").onclick = () => send(() => engineW().unstake(parseAmt("stakeAmt")), "unstaked");
  $("claimBtn").onclick = () => send(() => engineW().claimRewards(), "eth claimed");
  $("harvestBtn").onclick = () => send(() => splitterW().harvest(), "fees distributed");
  $("pokeBtn").onclick = () => send(async () => ((await engineR.started()) ? engineW().poke() : engineW().start()), "epoch advanced");
  $("settleBtn").onclick = () => send(() => engineW().settle(20), "queue settled");
  $("bondMax").onclick = () => { $("bondAmt").value = $("bondMax").dataset.max || ""; quoteBond(); };
  $("stakeMax").onclick = () => { $("stakeAmt").value = $("stakeMax").dataset.max || ""; };
  $("bondAmt").oninput = quoteBond;
  let rsz; window.addEventListener("resize", () => { clearTimeout(rsz); rsz = setTimeout(() => { paintBoxes(); paintContracts(); refreshChart(); }, 200); });

  const ZERO = "0x0000000000000000000000000000000000000000";
  const disableActions = (on) => ["bondBtn", "stakeBtn", "unstakeBtn", "claimBtn", "harvestBtn", "pokeBtn", "settleBtn"].forEach((id) => { $(id).disabled = on; });
  async function preflight() {
    // 1. is the rpc alive?  2. is there code at the engine address?
    let block;
    try { block = await provider.getBlockNumber(); }
    catch (e) { $("statusbar").textContent = " RPC UNREACHABLE"; prompt("rpc unreachable · " + (e.shortMessage || e.message), true); return false; }
    if (!C.engine || C.engine === ZERO || (await provider.getCode(C.engine)) === "0x") {
      $("statusbar").textContent = ` ${C.chainName.toUpperCase()} · block ${block.toLocaleString(loc)} · CONTRACTS NOT DEPLOYED · launch pending`;
      prompt(`rpc ok · block ${block.toLocaleString(loc)} · contracts not deployed yet`);
      disableActions(true);
      return false;
    }
    return true;
  }

  (async () => {
    $("chainLabel").textContent = `· ${C.chainName.toLowerCase()} · chain ${C.chainId}`;
    const links = [];
    if (C.x) links.push(`x <a href="${C.x}" target="_blank" rel="noopener">${C.x.replace("https://", "")}</a>`);
    $("social").innerHTML = links.join(" · ");
    $("stakedLink").innerHTML = C.staked ? `<a href="${explorer("address/" + C.staked)}" target="_blank" rel="noopener">${short(C.staked)}</a>` : "not deployed yet";
    if (!(await preflight())) { setInterval(async () => { if (await preflight()) location.reload(); }, 60000); return; }
    try {
      const tokenAddr = await engineR.token();
      tokenR = new ethers.Contract(tokenAddr, ERC20_ABI, provider);
      C.token = tokenAddr;
      const [s, d] = await Promise.all([tokenR.symbol(), tokenR.decimals()]);
      symbol = s; decimals = Number(d);
      $("bondUnit").textContent = symbol; $("stakeUnit").textContent = symbol;
    } catch (e) { console.warn("token meta", e); }
    const [treasury, curve] = await Promise.all([splitterR.treasury().catch(() => null), engineR.curve().catch(() => null)]);
    addresses = { token: C.token, treasury, curve };
    paintContracts();
    await refresh();
    refreshChart();
    setInterval(refresh, 20000);
    setInterval(refreshChart, 60000);
  })();
})();
