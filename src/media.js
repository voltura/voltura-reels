export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const tenth = value => Math.round(value * 10) / 10;

export function timeText(value, decimals = true) {
  const time = Math.max(0, Math.floor(value * (decimals ? 10 : 1) + 0.001));
  if (!decimals) return `${Math.floor(time / 60)}:${String(time % 60).padStart(2, '0')}`;
  return `${Math.floor(time / 600)}:${String(Math.floor(time / 10) % 60).padStart(2, '0')}.${time % 10}`;
}

export function seekTarget(ranges, time, direction) {
  if (!ranges.length) return null;
  let previousEnd = ranges.start(0);
  for (let index = 0; index < ranges.length; index++) {
    const start = ranges.start(index);
    const end = ranges.end(index);
    if (time < start) {
      if (index === 0 || direction > 0) return start;
      if (direction < 0) return previousEnd;
      return time - previousEnd < start - time ? previousEnd : start;
    }
    if (time <= end) return time;
    previousEnd = end;
  }
  return previousEnd;
}

export function panBounds(width, height, videoWidth, videoHeight, zoom) {
  if (!videoWidth || !videoHeight) return [0, 0];
  const fit = Math.min(width / videoWidth, height / videoHeight) * zoom;
  return [Math.max(0, (videoWidth * fit - width) / 2), Math.max(0, (videoHeight * fit - height) / 2)];
}
