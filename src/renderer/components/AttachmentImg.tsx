import React, { useEffect, useState } from "react";

/** Loads a stored attachment by id (main returns a base64 data URL). */
export function AttachmentImg({ id }: { id: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (id.startsWith("tmp")) return;
    window.aether.getAttachment(id).then((p) => { if (live && p) setSrc(p.dataUrl); });
    return () => { live = false; };
  }, [id]);
  if (!src) return <div style={{ width: 132, height: 132, borderRadius: 14, background: "var(--surface-2)" }} />;
  return <img src={src} alt="attachment" />;
}
