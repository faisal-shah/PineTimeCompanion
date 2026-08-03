/**
 * Current Time Service (0x2A2B) payload, the standard 10-byte layout InfiniTime
 * parses in CurrentTimeService::OnCurrentTimeAccessed.
 *
 * Its own module so both the transport (which sets the clock on every
 * connection) and syncManager (the explicit "Set time" action) can use it
 * without an import cycle.
 *
 * Why this gets written so eagerly: the watch has no backup battery for its
 * clock. It lives in RAM, is mirrored to no-init RAM and restored across a soft
 * reset, but a power loss -- or a firmware image whose memory layout moved --
 * leaves it at 1 January of the build year. Nothing on the watch can tell that
 * state apart from a real date: it will show that day and compute prayer times
 * for it with no indication anything is wrong.
 */
export function encodeCurrentTime(now: Date): Uint8Array {
  const b = new Uint8Array(10);
  const year = now.getFullYear();
  b[0] = year & 0xff;
  b[1] = year >> 8;
  b[2] = now.getMonth() + 1;
  b[3] = now.getDate();
  b[4] = now.getHours();
  b[5] = now.getMinutes();
  b[6] = now.getSeconds();
  b[7] = ((now.getDay() + 6) % 7) + 1; // CTS: Monday = 1 .. Sunday = 7
  b[8] = Math.floor((now.getMilliseconds() * 256) / 1000);
  b[9] = 0; // adjust reason
  return b;
}
