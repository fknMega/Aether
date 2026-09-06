import React, { useEffect, useState } from "react";

/** Loads a stored attachment by id (main returns a base64 data URL).
 *  `tmp` ids belong to an optimistic message whose bytes were never persisted,
 *  so they stay on the skeleton rather than firing a lookup that must miss. */
export function AttachmentImg({ id }: { id: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    if (id.startsWith("tmp")) return;
    window.aether.getAttachment(id).then((p) => { if (live && p) setSrc(p.dataUrl); });
    return () => { live = false; };
  }, [id]);

  if (!src) return <div className="att-skel" />;
  return <img src={src} alt="attachment" />;
}
