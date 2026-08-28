// <terroir-globe> — 実座標で27件をプロットする地球儀。ドラッグで回す。
// d3 / topojson は親ドキュメントの <head>（DCの helmet）で読み込まれている前提。
// 選択は window の 'terroir-globe-select' で通知する（detail: {ids, label}）。
(function () {
  const WORLD = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json";
  // v2 で追加：NL（オランダ）。座標は世界地図の重心から計算するので手入力していない。
  // ISO 3166-1 の数値コード。値は world-atlas の objects.countries[].id をそのまま引いたもので、
  // 座標ではない（重心は世界地図から計算する）。
  const ISO_NUM = { JP: "392", PT: "620", ZA: "710", IT: "380", SI: "705", ID: "360", TH: "764", KR: "410",
    NL: "528", DE: "276", BR: "076", VN: "704", DK: "208",
    // v2 で追加：この5か国が抜けていたため 10件が地球儀に出ていなかった
    ES: "724", GR: "300", CO: "170", MX: "484", US: "840" };
  const SIZE = 640;

  function ready() {
    return new Promise(res => {
      const t = () => (window.d3 && window.topojson) ? res() : setTimeout(t, 60);
      t();
    });
  }

  class TerroirGlobe extends HTMLElement {
    connectedCallback() {
      if (this._init) return;
      this._init = true;
      this.style.display = "block";
      this.rotate = [-140, -18];
      this.zoom = 1;
      this.spin = true;
      this.hover = false;
      this.dragging = false;
      /* ＋−ボタン（S3・軽微な修正）：以前は data-wrap の内側に絶対配置していたため、
         data-wrap の overflow:hidden;border-radius:50%（円形クリップ）で四隅が
         切られていた。data-wrap の兄弟要素として外に出し、円の外側からかぶせる形にする */
      this.innerHTML =
        '<div style="position:relative;display:flex;flex-direction:column;gap:10px;">' +
        '<div data-wrap style="position:relative;width:100%;max-width:' + SIZE + 'px;aspect-ratio:1/1;margin:0 auto;touch-action:none;cursor:grab;overflow:hidden;border-radius:50%;">' +
        '</div>' +
        '<div data-zoom style="position:absolute;right:2px;top:2px;display:flex;flex-direction:column;gap:6px;z-index:2;"></div>' +
        '<div data-cap style="min-height:2.6em;font-size:13px;line-height:1.7;color:var(--fg-muted);text-align:center;"></div>' +
        "</div>";
      this.wrap = this.querySelector("[data-wrap]");
      this.cap = this.querySelector("[data-cap]");
      this.cap.textContent = "地球儀を読み込んでいます";
      this.boot();
    }

    async boot() {
      await ready();
      const d3 = window.d3;
      let topo, data;
      try {
        [topo, data] = await Promise.all([
          d3.json(WORLD),
          // 本体（index.dc.html の head）が用意した共有の取得口を使う。
          // ここで自前に取りに行くと、本体とあわせて同じ 1.7MB を2回ダウンロードする
          window.terroirData()
        ]);
      } catch (e) {
        this.cap.textContent = "地球儀のデータを読み込めませんでした";
        return;
      }
      this.countries = window.topojson.feature(topo, topo.objects.countries).features;
      this.points = this.buildPoints(data);
      this.projection = d3.geoOrthographic().translate([SIZE / 2, SIZE / 2]).scale(SIZE / 2 - 12).clipAngle(90);
      this.path = d3.geoPath(this.projection);
      this.graticule = d3.geoGraticule10();
      this.svg = d3.select(this.wrap).append("svg")
        .attr("viewBox", "0 0 " + SIZE + " " + SIZE)
        .attr("width", "100%")
        .style("display", "block")
        .style("overflow", "visible")
        .style("position", "absolute").style("inset", "0");
      this.gSphere = this.svg.append("g");
      this.gLand = this.svg.append("g");
      this.gGrat = this.svg.append("g");
      this.gDots = this.svg.append("g");
      this.bindDrag();
      this.bindZoom();
      this.draw();
      this.startSpin();
      this.cap.textContent = "ゆっくり自転しています。ドラッグで回す／ホイールかピンチ、＋−で寄る。点をクリックすると、その場所の取り組みが出ます。";
    }

    buildPoints(data) {
      const d3 = window.d3;
      const recs = (data && data.records) || [];
      const places = (data && data.places) || {};
      const centroid = {};
      const byKey = {};
      recs.forEach(r => {
        const pl = places[r.place_id || ""];
        let coord = null, where = "";
        if (pl && pl.lat_lng && pl.lat_lng.length === 2) {
          coord = [pl.lat_lng[1], pl.lat_lng[0]];
          where = [r.region, r.municipality].filter(Boolean).join(" ") || pl.name || "";
        } else {
          const cc = String(r.id || "").split("-")[0].toUpperCase();
          const num = ISO_NUM[cc];
          if (!num) return;
          if (!centroid[num]) {
            const f = this.countries.filter(x => String(x.id) === num)[0];
            if (!f) return;
            centroid[num] = d3.geoCentroid(f);
          }
          coord = centroid[num];
          where = (r.country || "") + "（国全体の位置）";
        }
        const key = coord[0].toFixed(2) + "," + coord[1].toFixed(2);
        if (!byKey[key]) byKey[key] = { coord: coord, label: (r.country || "") + " " + where, ids: [], names: [] };
        byKey[key].ids.push(r.id);
        byKey[key].names.push(r.name);
      });
      return Object.keys(byKey).map(k => byKey[k]);
    }

    bindDrag() {
      let last = null;
      const node = this.wrap;
      const move = e => {
        if (!last) return;
        const dx = e.clientX - last[0], dy = e.clientY - last[1];
        last = [e.clientX, e.clientY];
        this.rotate[0] += dx * 0.45;
        this.rotate[1] = Math.max(-85, Math.min(85, this.rotate[1] - dy * 0.35));
        this.draw();
      };
      const up = () => {
        last = null; node.style.cursor = "grab"; this.dragging = false;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      node.addEventListener("pointerdown", e => {
        last = [e.clientX, e.clientY];
        this.dragging = true;
        this._downAt = [e.clientX, e.clientY];
        node.style.cursor = "grabbing";
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      });
      node.addEventListener("click", e => {
        if (this._downAt) {
          const d = Math.abs(e.clientX - this._downAt[0]) + Math.abs(e.clientY - this._downAt[1]);
          if (d > 6) return;
        }
        this.hit(e);
      });
      node.addEventListener("pointerenter", () => { this.hover = true; });
      node.addEventListener("pointerleave", () => { this.hover = false; });
      this.tabIndex = 0;
      this.addEventListener("keydown", e => {
        const step = 12;
        if (e.key === "ArrowLeft") this.rotate[0] -= step;
        else if (e.key === "ArrowRight") this.rotate[0] += step;
        else if (e.key === "ArrowUp") this.rotate[1] = Math.min(85, this.rotate[1] + step);
        else if (e.key === "ArrowDown") this.rotate[1] = Math.max(-85, this.rotate[1] - step);
        else return;
        e.preventDefault();
        this.draw();
      });
    }

    bindZoom() {
      const box = this.querySelector("[data-zoom]");
      const mk = (label, delta) => {
        const b = document.createElement("button");
        b.textContent = label;
        b.setAttribute("aria-label", delta > 0 ? "拡大" : "縮小");
        b.style.cssText = "width:36px;height:36px;min-height:36px;cursor:pointer;border:var(--globe-btn-border,1px solid var(--rule));" +
          "background:var(--surface);color:var(--accent);border-radius:999px;font-size:17px;line-height:1;" +
          "display:flex;align-items:center;justify-content:center;padding:0;";
        b.addEventListener("click", e => { e.stopPropagation(); this.setZoom(this.zoom * (delta > 0 ? 1.35 : 1 / 1.35)); });
        box.appendChild(b);
      };
      mk("+", 1); mk("−", -1);
      const sb = document.createElement("button");
      sb.style.cssText = "width:36px;height:36px;min-height:36px;cursor:pointer;border:var(--globe-btn-border,1px solid var(--rule));" +
        "background:var(--surface);color:var(--accent);border-radius:999px;font-size:12px;line-height:1;" +
        "display:flex;align-items:center;justify-content:center;padding:0;";
      const sync = () => { sb.textContent = this.spin ? "❙❙" : "▶"; sb.setAttribute("aria-label", this.spin ? "自転を止める" : "自転する"); };
      sb.addEventListener("click", e => { e.stopPropagation(); this.spin = !this.spin; sync(); });
      sync();
      this._syncSpin = sync;
      box.appendChild(sb);
      this.wrap.addEventListener("wheel", e => {
        e.preventDefault();
        this.setZoom(this.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08));
      }, { passive: false });
      let pinch = null;
      const pts = new Map();
      this.wrap.addEventListener("pointerdown", e => { pts.set(e.pointerId, e); });
      this.wrap.addEventListener("pointermove", e => {
        if (!pts.has(e.pointerId)) return;
        pts.set(e.pointerId, e);
        if (pts.size !== 2) { pinch = null; return; }
        const a = [...pts.values()];
        const d = Math.hypot(a[0].clientX - a[1].clientX, a[0].clientY - a[1].clientY);
        if (pinch) this.setZoom(this.zoom * (d / pinch));
        pinch = d;
      });
      const drop = e => { pts.delete(e.pointerId); pinch = null; };
      this.wrap.addEventListener("pointerup", drop);
      this.wrap.addEventListener("pointercancel", drop);
    }

    setZoom(z) {
      this.zoom = Math.max(1, Math.min(7, z));
      this.draw();
    }

    startSpin() {
      let t = 0;
      const loop = ts => {
        this._raf = requestAnimationFrame(loop);
        if (ts - t < 40) return;
        t = ts;
        if (!this.spin || this.dragging || this.hover) return;
        if (document.hidden) return;
        this.rotate[0] += 0.22;
        this.draw();
      };
      this._raf = requestAnimationFrame(loop);
    }

    disconnectedCallback() { if (this._raf) cancelAnimationFrame(this._raf); }

    visible(coord) {
      return window.d3.geoDistance(coord, [-this.rotate[0], -this.rotate[1]]) < Math.PI / 2 - 0.02;
    }

    hit(e) {
      const rect = this.wrap.getBoundingClientRect();
      const k = SIZE / rect.width;
      const x = (e.clientX - rect.left) * k, y = (e.clientY - rect.top) * k;
      let best = null, bestD = 26;
      this.points.forEach(p => {
        if (!this.visible(p.coord)) return;
        const q = this.projection(p.coord);
        if (!q) return;
        const d = Math.hypot(q[0] - x, q[1] - y);
        if (d < bestD) { bestD = d; best = p; }
      });
      if (!best) return;
      this.selected = best;
      this.spin = false;
      if (this._syncSpin) this._syncSpin();
      this.draw();
      this.cap.textContent = best.label + " — " + best.ids.length + "件";
      window.dispatchEvent(new CustomEvent("terroir-globe-select", {
        detail: { ids: best.ids.slice(), label: best.label }
      }));
    }

    draw() {
      const p = this.projection.rotate(this.rotate).scale((SIZE / 2 - 12) * this.zoom);
      this.gSphere.selectAll("path").data([{ type: "Sphere" }]).join("path")
        .attr("d", this.path).attr("style", "fill:var(--surface);stroke:var(--rule);stroke-width:var(--globe-stroke,1.2);");
      this.gLand.selectAll("path").data(this.countries).join("path")
        .attr("d", this.path).attr("style", "fill:var(--land);stroke:var(--surface);stroke-width:var(--globe-land-stroke,0.7);");
      this.gGrat.selectAll("path").data([this.graticule]).join("path")
        .attr("d", this.path).attr("style", "fill:none;stroke:var(--accent);stroke-width:0.4;opacity:0.18;");
      const vis = this.points.filter(x => this.visible(x.coord));
      const sel = this.selected;
      this.gDots.selectAll("g").data(vis, d => d.coord.join()).join(
        enter => {
          const g = enter.append("g");
          g.append("circle").attr("data-halo", "");
          g.append("circle").attr("data-dot", "");
          g.append("title");
          return g;
        }
      ).each((d, i, nodes) => {
        const q = p(d.coord);
        const node = window.d3.select(nodes[i]);
        const on = sel && sel.coord.join() === d.coord.join();
        const r = Math.min(10, 4.6 + (d.ids.length - 1) * 1.2);
        node.attr("transform", "translate(" + q[0] + "," + q[1] + ")").style("cursor", "pointer");
        node.select("[data-halo]").attr("r", r + 4)
          .attr("style", "fill:var(--accent-2);opacity:" + (on ? 0.55 : 0.28) + ";");
        node.select("[data-dot]").attr("r", r)
          .attr("style", "fill:var(--dot,var(--accent));stroke:var(--dot-stroke,var(--surface));stroke-width:" + (on ? 3 : 2) + ";");
        node.select("title").text(d.label + " — " + d.ids.length + "件");
      });
    }
  }

  if (!window.customElements.get("terroir-globe")) {
    window.customElements.define("terroir-globe", TerroirGlobe);
  }
})();
