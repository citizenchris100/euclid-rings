// js/fileSink.js — IMPURE. Save a Uint8Array as a user-named .mid, three tiers best-first
// (adapted from the songwriter notebook's main.js sink): (1) File System Access "Save As"
// dialog (desktop Chromium), (2) Web Share with files (installed PWA / iOS "Save to Files"),
// (3) anchor download (Firefox/older Safari -> Downloads). Split into a SYNCHRONOUS open (must
// run under the click gesture to keep transient activation) and an async write.

// Phase 1: open the sink under the click gesture, BEFORE building the (async) payload.
// Returns { handle, name } | { name } | null (null = the user cancelled the save dialog).
export async function openMidSink(suggestedName) {
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: 'MIDI file', accept: { 'audio/midi': ['.mid'] } }],
      });
      return { handle, name: suggestedName };
    } catch (e) {
      if (e && e.name === 'AbortError') return null;   // cancelled
      // fall through to the share/download tiers
    }
  }
  return { name: suggestedName };
}

// Phase 2: write the bytes to whatever sink Phase 1 returned.
export async function writeMidSink(sink, bytes) {
  if (!sink) return false;
  const blob = new Blob([bytes], { type: 'audio/midi' });
  if (sink.handle) {
    const writable = await sink.handle.createWritable();
    try { await writable.write(blob); } finally { await writable.close(); }
    return true;
  }
  return shareOrDownloadBlob(blob, sink.name, 'audio/midi');
}

export async function shareOrDownloadBlob(blob, name, mimeType) {
  const file = new File([blob], name, { type: mimeType });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return true; }
    catch (e) { if (e && e.name === 'AbortError') return false; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
