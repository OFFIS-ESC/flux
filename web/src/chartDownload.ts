// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Lädt ein Chart als JPG herunter. Übergeben wird das umschließende Element
// (Karte/Container), das SVG und ggf. HTML-Legende enthält. Das Element wird als
// Bild gerendert und als JPG gespeichert – so, wie es auf dem Bildschirm aussieht.
//
// Ansatz: Das enthaltene SVG wird serialisiert und über eine data-URL in ein
// <img> geladen, dann auf ein Canvas gezeichnet. Zusätzlich wird die HTML-Legende
// (Textzeilen über dem SVG) als einfache Kopfzeile mitgezeichnet, damit der
// Screenshot vollständig ist. Für einen echten Pixel-genauen DOM-Screenshot wäre
// eine Bibliothek nötig; dieser leichte Weg kommt ohne Abhängigkeit aus.

export async function downloadChartAlsJpg(container: HTMLElement, dateiname: string): Promise<void> {
  const svg = container.querySelector("svg");
  if (!svg) return;

  // SVG serialisieren (mit expliziten Maßen).
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const vb = svg.viewBox.baseVal;
  const w = vb && vb.width ? vb.width : (svg.clientWidth || 900);
  const h = vb && vb.height ? vb.height : (svg.clientHeight || 320);
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  // Weißer Hintergrund einfügen (JPG hat keine Transparenz).
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("x", "0"); bg.setAttribute("y", "0");
  bg.setAttribute("width", String(w)); bg.setAttribute("height", String(h));
  bg.setAttribute("fill", "#ffffff");
  clone.insertBefore(bg, clone.firstChild);

  const svgText = new XMLSerializer().serializeToString(clone);
  const svgUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgText);

  // Legende (Titel + Legenden-Buttons) als Textzeilen sammeln, um sie oben
  // mitzuzeichnen.
  const titelEl = container.querySelector("h3");
  const titel = titelEl?.textContent?.trim() ?? "";
  const legendeEls = Array.from(container.querySelectorAll(".ww-legend-item"));
  const legende = legendeEls
    .filter((el) => !el.className.includes("off"))
    .map((el) => ({
      text: el.textContent?.trim() ?? "",
      farbe: (el.querySelector(".ww-legend-dot") as HTMLElement)?.style.background || "#888",
    }))
    .filter((l) => l.text);

  const skala = 2; // für schärfere Ausgabe
  const kopfH = (titel ? 26 : 0) + (legende.length ? 22 : 0) + 8;
  const canvas = document.createElement("canvas");
  canvas.width = w * skala;
  canvas.height = (h + kopfH) * skala;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(skala, skala);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h + kopfH);

  // Titel zeichnen.
  let y = 4;
  if (titel) {
    ctx.fillStyle = "#222";
    ctx.font = "600 15px system-ui, sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText(titel, 8, y);
    y += 24;
  }
  // Legende zeichnen (farbiger Punkt + Text nebeneinander).
  if (legende.length) {
    let x = 8;
    ctx.font = "12px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    for (const l of legende) {
      ctx.fillStyle = l.farbe;
      ctx.beginPath(); ctx.arc(x + 5, y + 8, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#333";
      ctx.fillText(l.text, x + 14, y + 8);
      x += 20 + ctx.measureText(l.text).width + 16;
    }
    y += 20;
  }

  // SVG-Bild laden und unter den Kopf zeichnen.
  await new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, kopfH, w, h);
      resolve();
    };
    img.onerror = () => reject(new Error("SVG konnte nicht gerendert werden"));
    img.src = svgUrl;
  });

  // Als JPG speichern.
  const jpg = canvas.toDataURL("image/jpeg", 0.92);
  const a = document.createElement("a");
  a.href = jpg;
  a.download = `${dateiname}.jpg`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
