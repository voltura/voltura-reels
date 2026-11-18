const cornerAngles = [19, 27, 36, 45, 54, 63, 71].map((degrees) => {
  const angle = degrees * Math.PI / 180;
  return [Math.cos(angle), Math.sin(angle)];
});

function median(values) {
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
}

export function refineStoryCrop({ data, width, height }) {
  const size = Math.min(width, height);
  const search = Math.floor(size * 0.04);
  if (search < 3) return { x: 0, y: 0, width, height };
  const probe = Math.max(1, Math.round(size * 0.004));

  function contrast(x1, y1, x2, y2) {
    const a = (Math.round(y1) * width + Math.round(x1)) * 4;
    const b = (Math.round(y2) * width + Math.round(x2)) * 4;
    return Math.min(64, (
      Math.abs(data[a] - data[b]) +
      Math.abs(data[a + 1] - data[b + 1]) +
      Math.abs(data[a + 2] - data[b + 2])
    ) / 3);
  }

  // A real frame edge changes color across much of a line near the link boundary.
  function findEdge(vertical, reverse) {
    const span = vertical ? height : width;
    const depth = vertical ? width : height;
    const first = Math.round(span * 0.14);
    const last = Math.round(span * 0.86);
    const step = Math.max(1, Math.floor((last - first) / 110));
    const strength = [0];
    for (let offset = 1; offset <= search; offset++) {
      const at = reverse ? depth - 1 - offset : offset;
      const outside = at + (reverse ? 1 : -1);
      let sum = 0;
      for (let along = first; along < last; along += step) {
        sum += vertical ? contrast(at, along, outside, along) : contrast(along, at, along, outside);
      }
      strength.push(sum / Math.ceil((last - first) / step));
    }
    const peak = Math.max(...strength);
    const baseline = median(strength.slice(1));
    if (peak < Math.max(10, baseline * 2.5)) return { edge: 0, trim: 0 };
    const edge = strength.indexOf(peak);
    const ringing = Math.max(8, peak * 0.22, baseline * 3);
    let trim = edge;
    for (let offset = edge + 1; offset <= Math.min(search, edge + probe * 2); offset++) {
      if (strength[offset] >= ringing) trim = offset;
    }
    return { edge, trim: trim + 1 };
  }

  const left = findEdge(true, false);
  const top = findEdge(false, false);
  const right = findEdge(true, true);
  const bottom = findEdge(false, true);
  const result = {
    x: left.trim,
    y: top.trim,
    width: width - left.trim - right.trim,
    height: height - top.trim - bottom.trim,
  };

  function findRadius(x, y, sx, sy) {
    let best = 0;
    let quality = 0;
    for (let radius = Math.ceil(probe * 4.5); radius <= size * 0.12; radius++) {
      const changes = cornerAngles.map(([cos, sin]) => {
        const u = x + sx * radius * (1 - cos);
        const v = y + sy * radius * (1 - sin);
        const dx = sx * cos * probe;
        const dy = sy * sin * probe;
        if (Math.min(u - dx, u + dx, v - dy, v + dy) < 0 ||
            Math.max(u - dx, u + dx) >= width - 0.5 ||
            Math.max(v - dy, v + dy) >= height - 0.5) return 0;
        return contrast(u - dx, v - dy, u + dx, v + dy);
      });
      if (changes.filter((change) => change > 10).length < 5) continue;
      const score = changes.reduce((sum, change) => sum + change, 0);
      if (score > quality) {
        quality = score;
        best = radius;
      }
    }
    return best;
  }

  // Fit the arc from the pixels. Matching measurements can fill in a corner
  // where the image and its blurred surround have similar colors.
  const farX = width - 1 - right.edge;
  const farY = height - 1 - bottom.edge;
  const radii = [
    findRadius(left.edge, top.edge, 1, 1),
    findRadius(farX, top.edge, -1, 1),
    findRadius(farX, farY, -1, -1),
    findRadius(left.edge, farY, 1, -1),
  ];
  const typical = median(radii.filter(Boolean));
  const similar = (radius) => Math.abs(radius - typical) <= typical * 0.25;
  if (typical && radii.filter(similar).length >= 2) {
    result.mask = {
      x: left.edge + probe / 2,
      y: top.edge + probe / 2,
      width: farX - left.edge + 1 - probe,
      height: farY - top.edge + 1 - probe,
      radii: radii.map((radius) => (similar(radius) ? radius : typical) + probe),
    };
  }
  return result;
}
