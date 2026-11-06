/**
 * Display size of an MP4 (or MOV, which shares the box layout), read from the
 * file itself so a screen recording reserves its box the way an image does.
 *
 * Without it a `<video>` reached the page with no width and no height: the
 * browser reserved nothing until the metadata arrived, and the article jumped.
 * A sibling site only escaped that while a bulk importer left an image
 * manifest behind; removing the manifest stripped every recording of its size.
 *
 * The numbers live in the `tkhd` box of each track, inside `moov > trak`, as
 * two 16.16 fixed-point values at the end of the box. They are the display
 * size, after the pixel aspect ratio, which is the box the page should
 * reserve. An audio track has a zero size, so the first track with both
 * numbers wins. On 45 real recordings this matched ffprobe exactly, except
 * three with non-square pixels, where it gave the display size by design.
 *
 * No imports, so a test can load it without the rest of the build.
 */
export type Size = { width: number; height: number };

export function mp4Size(file: Uint8Array): Size | null {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const type = (at: number) => String.fromCharCode(file[at], file[at + 1], file[at + 2], file[at + 3]);

  function* boxes(start: number, end: number) {
    for (let at = start; at + 8 <= end;) {
      let size = view.getUint32(at);
      /* 1: a 64-bit size follows the type. 0: the box runs to the end. */
      if (size === 1) size = at + 16 <= end ? Number(view.getBigUint64(at + 8)) : 0;
      else if (size === 0) size = end - at;
      if (size < 8) return;
      yield { type: type(at + 4), at, end: Math.min(at + size, end) };
      at += size;
    }
  }

  for (const moov of boxes(0, file.length)) {
    if (moov.type !== 'moov') continue;
    for (const trak of boxes(moov.at + 8, moov.end)) {
      if (trak.type !== 'trak') continue;
      for (const tkhd of boxes(trak.at + 8, trak.end)) {
        if (tkhd.type !== 'tkhd') continue;
        /* Version 1 widens four time fields to 64 bits, moving the size by 12. */
        const offset = tkhd.at + (file[tkhd.at + 8] === 1 ? 96 : 84);
        if (offset + 8 > tkhd.end) continue;
        const width = Math.round(view.getUint32(offset) / 65536);
        const height = Math.round(view.getUint32(offset + 4) / 65536);
        if (width && height) return { width, height };
      }
    }
  }
  return null;
}
