const GMT8_OFFSET_MS = 8 * 60 * 60 * 1000;
const MIN_VALID_EPOCH_MS = Date.UTC(2020, 0, 1);

/**
 * Parses Antigravity timestamps (e.g. "2026-11-16 06:27:43.7794974+00:00" or ISO 8601)
 * strictly into epoch milliseconds without silently falling back to current time.
 */
export function parseTimestampMs(raw: string | null | undefined): number | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const match =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})?$/i.exec(
      trimmed
    );

  if (!match) {
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) && parsed >= MIN_VALID_EPOCH_MS ? parsed : null;
  }

  const [, y, m, d, hh, mm, ss, frac = '', tz = 'Z'] = match;
  const ms = Number(frac.slice(0, 3).padEnd(3, '0'));
  const utcBase = Date.UTC(
    Number(y),
    Number(m) - 1,
    Number(d),
    Number(hh),
    Number(mm),
    Number(ss),
    ms
  );

  if (tz.toUpperCase() === 'Z') {
    return utcBase >= MIN_VALID_EPOCH_MS ? utcBase : null;
  }

  const tzMatch = /^([+-])(\d{2}):?(\d{2})$/.exec(tz);
  if (!tzMatch) return null;
  const sign = tzMatch[1] === '+' ? 1 : -1;
  const offsetMinutes = Number(tzMatch[2]) * 60 + Number(tzMatch[3]);
  const epochMs = utcBase - sign * offsetMinutes * 60 * 1000;
  return epochMs >= MIN_VALID_EPOCH_MS ? epochMs : null;
}

/**
 * Formats an elapsed duration in ms as compact tabular readout:
 * - < 1 hour: MM:SS (e.g. "04:19")
 * - >= 1 hour: H:MM:SS (e.g. "1:04:19")
 */
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return '00:00';
  }
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');

  if (hours > 0) {
    return `${hours}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

/**
 * Formats an ISO/DB timestamp as DD-MM-YY and HH:mm:ss in GMT+8 (Asia/Kuala_Lumpur).
 */
export function formatDateTimeGMT8(raw: string | null | undefined): {
  date: string;
  time: string;
} | null {
  const epochMs = parseTimestampMs(raw);
  if (epochMs === null) return null;

  const gmt8 = new Date(epochMs + GMT8_OFFSET_MS);
  const dd = String(gmt8.getUTCDate()).padStart(2, '0');
  const mm = String(gmt8.getUTCMonth() + 1).padStart(2, '0');
  const yy = String(gmt8.getUTCFullYear()).slice(-2);
  const hh = String(gmt8.getUTCHours()).padStart(2, '0');
  const min = String(gmt8.getUTCMinutes()).padStart(2, '0');
  const sec = String(gmt8.getUTCSeconds()).padStart(2, '0');

  return {
    date: `${dd}-${mm}-${yy}`,
    time: `${hh}:${min}:${sec}`,
  };
}
