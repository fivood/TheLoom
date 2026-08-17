/** 线条风格 SVG 图标库(替代 emoji),stroke = currentColor */
import type { EntityKind } from '../types';

export type IconName =
  | 'logo' | 'flow' | 'bulb' | 'grid' | 'clock' | 'archive' | 'braces'
  | 'search' | 'undo' | 'redo' | 'folder' | 'refresh' | 'download' | 'upload' | 'reset'
  | 'play' | 'script' | 'pin' | 'image' | 'plus' | 'cloud'
  | 'user' | 'mappin' | 'key' | 'flag' | 'book' | 'doc' | 'tag' | 'trash' | 'film' | 'music'
  | 'palette' | 'check'
  | 'sun' | 'moon' | 'monitor' | 'split' | 'more' | 'help' | 'arrowLeft' | 'compare' | 'chevronDown' | 'chevronRight'
  | 'cards' | 'lock' | 'unlock' | 'eye' | 'folderOpen' | 'comment' | 'warn' | 'ban' | 'bolt' | 'gear'
  | 'star' | 'starFilled' | 'pencil' | 'sparkle' | 'flagCheck' | 'close';

/** 实体类型 → 图标 */
export const KIND_ICON: Record<EntityKind, IconName> = {
  character: 'user',
  location: 'mappin',
  item: 'key',
  faction: 'flag',
  concept: 'book',
};

const PATHS: Record<IconName, React.ReactNode> = {
  logo: (
    <>
      <path d="M5 4v16M12 4v16M19 4v16" />
      <path d="M2.5 10c3.2-3.5 6.3 3.5 9.5 0s6.3 3.5 9.5 0" />
      <circle cx="21" cy="10" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
  flow: (
    <>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="12" r="2.5" />
      <path d="M8.2 7.2 15.8 11M8.2 16.8 15.8 13" />
    </>
  ),
  bulb: (
    <>
      <path d="M12 3a6 6 0 0 1 3.7 10.7c-.7.6-.7 1.3-.7 2.3h-6c0-1 0-1.7-.7-2.3A6 6 0 0 1 12 3z" />
      <path d="M9.5 19h5M10.5 21.5h3" />
    </>
  ),
  grid: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
      <path d="M3.5 10h17M10 10v9.5M15.5 10v9.5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3.2 3.2" />
    </>
  ),
  archive: (
    <>
      <rect x="3" y="4" width="18" height="4.5" rx="1" />
      <path d="M5 8.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V8.5M10 13h4" />
    </>
  ),
  braces: (
    <>
      <path d="M8.5 4C6.8 4 6 5 6 6.5v3c0 1.2-.8 2.2-2 2.5 1.2.3 2 1.3 2 2.5v3C6 19 6.8 20 8.5 20" />
      <path d="M15.5 4c1.7 0 2.5 1 2.5 2.5v3c0 1.2.8 2.2 2 2.5-1.2.3-2 1.3-2 2.5v3c0 1.5-.8 2.5-2.5 2.5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20.5 20.5 16 16" />
    </>
  ),
  undo: (
    <>
      <path d="M8.5 13.5 4 9l4.5-4.5" />
      <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
    </>
  ),
  redo: (
    <>
      <path d="M15.5 13.5 20 9l-4.5-4.5" />
      <path d="M20 9H10a6 6 0 0 0 0 12h3" />
    </>
  ),
  folder: (
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.3-5.6L20 8.5" />
      <path d="M20 3.5v5h-5" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v11M7.5 11l4.5 4.5L16.5 11" />
      <path d="M5 20h14" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15.5V4M7.5 8.5 12 4l4.5 4.5" />
      <path d="M5 20h14" />
    </>
  ),
  reset: (
    <>
      <path d="M4 12a8 8 0 1 0 2.3-5.6L4 8.5" />
      <path d="M4 3.5v5h5" />
    </>
  ),
  play: <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none" />,
  script: (
    <>
      <path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z" />
      <path d="M14 3v5h5M9 13h6M9 16.5h6" />
    </>
  ),
  pin: (
    <>
      <path d="M12 16.5V22" />
      <path d="M8.5 3.5h7l-1 6 3 3.5v1.5H6.5V13l3-3.5z" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="1.5" />
      <circle cx="8.5" cy="10" r="1.5" />
      <path d="M20 15.5 15.5 11 6 19" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  cloud: (
    <>
      <path d="M7 18.5A4.5 4.5 0 0 1 6.6 9.5 5.5 5.5 0 0 1 17.3 10.7 3.9 3.9 0 0 1 17 18.5z" />
      <path d="M12 12.5v5M9.8 14.5 12 12.3l2.2 2.2" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="7.5" r="3.5" />
      <path d="M4.5 20.5v-1a6 6 0 0 1 6-6h3a6 6 0 0 1 6 6v1" />
    </>
  ),
  mappin: (
    <>
      <path d="M19.5 10c0 5.5-7.5 11.5-7.5 11.5S4.5 15.5 4.5 10a7.5 7.5 0 0 1 15 0z" />
      <circle cx="12" cy="10" r="2.8" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="16" r="4.5" />
      <path d="M11.2 12.8 20 4M16.5 7.5l3 3" />
    </>
  ),
  flag: <path d="M5 21.5V4c3.5-2 7 2 10.5 0v11c-3.5 2-7-2-10.5 0" />,
  book: (
    <>
      <path d="M4.5 19a2.5 2.5 0 0 1 2.5-2.5H19.5V3H7A2.5 2.5 0 0 0 4.5 5.5z" />
      <path d="M4.5 19A2.5 2.5 0 0 0 7 21.5h12.5v-5" />
    </>
  ),
  doc: (
    <>
      <path d="M6 3h8l5 5v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M13 3v6h6M8 13h8M8 17h6" />
    </>
  ),
  tag: (
    <>
      <path d="M3 12 12 3h6v6L9 18z" />
      <circle cx="15.5" cy="8.5" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7M10 11v6M14 11v6" />
    </>
  ),
  film: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
      <path d="M3.5 9h17M3.5 15h17M8 4.5v15M16 4.5v15" />
    </>
  ),
  music: (
    <>
      <path d="M9 18V5l11-2v11" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="17" cy="16" r="3" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18c1 0 1.7-.9 1.5-1.9-.2-1.1.6-2.1 1.7-2.1H17a4 4 0 0 0 4-4 8 8 0 0 0-9-10z" />
      <circle cx="7.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="9.5" cy="7.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="6.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="17.5" cy="10" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  check: <path d="M5 12.5 10 17.5 19.5 7.5" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.4 5.4l1.4 1.4M17.2 17.2l1.4 1.4M18.6 5.4l-1.4 1.4M6.8 17.2l-1.4 1.4" />
    </>
  ),
  moon: <path d="M20 13.5A8 8 0 0 1 10.5 4a8 8 0 1 0 9.5 9.5z" />,
  monitor: (
    <>
      <rect x="3" y="4.5" width="18" height="12.5" rx="1.5" />
      <path d="M9 20.5h6M12 17v3.5" />
    </>
  ),
  split: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
      <path d="M12 4.5v15" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.5 9.6a2.6 2.6 0 1 1 3.5 2.4c-.7.3-1 .8-1 1.5v.3" />
      <circle cx="12" cy="16.8" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  arrowLeft: <path d="M19 12H5M11 6l-6 6 6 6" />,
  compare: (
    <>
      <rect x="3.5" y="4.5" width="7.5" height="15" rx="1" />
      <rect x="13" y="4.5" width="7.5" height="15" rx="1" />
      <path d="M10.5 12H7M7 12l2-2M7 12l2 2M13.5 12h3M17 12l-2-2M17 12l-2 2" />
    </>
  ),
  cards: (
    <>
      <rect x="3" y="7.5" width="12.5" height="13" rx="2" />
      <path d="M7 4.5h10.5A2.5 2.5 0 0 1 20 7v10" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </>
  ),
  unlock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 7.5-2" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  folderOpen: (
    <>
      <path d="M3 8.5V6a1.5 1.5 0 0 1 1.5-1.5h4L11 7h7A1.5 1.5 0 0 1 19.5 8.5v1" />
      <path d="M3 8.5h17.5L18.5 19H4.5z" />
    </>
  ),
  comment: <path d="M20.5 12.5c0 3.6-3.8 6.5-8.5 6.5-.9 0-1.8-.1-2.6-.3L4 20.5l1.4-3.6C4 15.7 3.5 14.2 3.5 12.5 3.5 8.9 7.3 6 12 6s8.5 2.9 8.5 6.5z" />,
  warn: (
    <>
      <path d="M12 3.5 22 20H2z" />
      <path d="M12 9.5v5M12 17.2v.1" />
    </>
  ),
  ban: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M6 6l12 12" />
    </>
  ),
  bolt: <path d="M13.5 2.5 5 13.5h6L10.5 21.5 19 10.5h-6z" />,
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.5v2.6M12 18.9v2.6M21.5 12h-2.6M5.1 12H2.5M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8M18.7 18.7l-1.8-1.8M7.1 7.1 5.3 5.3" />
    </>
  ),
  star: <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9-5.3-2.9-5.3 2.9 1.1-5.9L3.5 9.7l5.9-.8z" />,
  starFilled: <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9-5.3-2.9-5.3 2.9 1.1-5.9L3.5 9.7l5.9-.8z" fill="currentColor" />,
  pencil: (
    <>
      <path d="M16.5 3.9 20.1 7.5 8.6 19H5v-3.6z" />
      <path d="M14.4 6 18 9.6" />
    </>
  ),
  sparkle: <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />,
  flagCheck: (
    <>
      <path d="M5.5 21V4.5" />
      <path d="M5.5 5h13l-2.5 4 2.5 4h-13" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  chevronDown: <path d="M6 9.5 12 15.5l6-6" />,
  chevronRight: <path d="M9.5 6 15.5 12l-6 6" />,
};

export default function Icon({ name, size = 16, strokeWidth = 1.7, className, style }: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      className={className}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
