// Converts a UTC ISO timestamp to the equivalent Taiwan-local (+08:00) ISO string,
// so every timestamp we store (and any date grouping derived from it via .slice(0,10))
// reflects Taiwan wall-clock time instead of UTC.
function toTaiwanISOString(utcIso) {
  if (!utcIso) return utcIso;
  const d = new Date(utcIso);
  if (isNaN(d.getTime())) return utcIso;
  const tw = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `${tw.getUTCFullYear()}-${pad(tw.getUTCMonth() + 1)}-${pad(tw.getUTCDate())}` +
    `T${pad(tw.getUTCHours())}:${pad(tw.getUTCMinutes())}:${pad(tw.getUTCSeconds())}` +
    `.${pad(tw.getUTCMilliseconds(), 3)}+08:00`;
}

module.exports = { toTaiwanISOString };
