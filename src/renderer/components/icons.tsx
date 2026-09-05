import React from "react";
type P = { size?: number; className?: string };
const S = (size: number, children: React.ReactNode, className?: string) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className}>{children}</svg>
);
export const IChat = ({ size = 16, className }: P) => S(size, <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />, className);
export const IGraph = ({ size = 16, className }: P) => S(size, <><circle cx="5" cy="6" r="2.2"/><circle cx="18" cy="5" r="2.2"/><circle cx="12" cy="13" r="2.6"/><circle cx="6" cy="19" r="2.2"/><circle cx="19" cy="18" r="2.2"/><path d="M7 7.4 10 11.4M16.2 6.4 13.4 11M11 15 7.6 17.4M13.4 14.6 17 16.6"/></>, className);
export const ISettings = ({ size = 16, className }: P) => S(size, <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></>, className);
export const IPlus = ({ size = 16, className }: P) => S(size, <><path d="M12 5v14M5 12h14"/></>, className);
export const ISend = ({ size = 18, className }: P) => S(size, <path d="M4 12 20 4l-6 16-3-7z" />, className);
export const IStop = ({ size = 16, className }: P) => S(size, <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none"/>, className);
export const IImage = ({ size = 18, className }: P) => S(size, <><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="m4 17 5-5 4 4 3-3 4 4"/></>, className);
export const IClose = ({ size = 16, className }: P) => S(size, <><path d="M18 6 6 18M6 6l12 12"/></>, className);
export const ITrash = ({ size = 14, className }: P) => S(size, <><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></>, className);
export const IEdit = ({ size = 14, className }: P) => S(size, <><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></>, className);
export const ISearch = ({ size = 15, className }: P) => S(size, <><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></>, className);
export const IZoomIn = ({ size = 15, className }: P) => S(size, <><circle cx="11" cy="11" r="7"/><path d="M11 8v6M8 11h6M21 21l-4.3-4.3"/></>, className);
export const IZoomOut = ({ size = 15, className }: P) => S(size, <><circle cx="11" cy="11" r="7"/><path d="M8 11h6M21 21l-4.3-4.3"/></>, className);
export const IFit = ({ size = 15, className }: P) => S(size, <><path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4"/></>, className);
export const ISpark = ({ size = 16, className }: P) => S(size, <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />, className);
