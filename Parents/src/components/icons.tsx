// Line icons (24px grid, same drawing style as the school's web system). One place, no emoji.
import Svg, { Path } from 'react-native-svg';

const P = {
  home: 'M3 11l9-8 9 8M5 10v10h14V10M10 20v-6h4v6',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  user: 'M20 21v-1a5 5 0 0 0-5-5H9a5 5 0 0 0-5 5v1M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  back: 'M15 5l-7 7 7 7',
  chev: 'M9 6l6 6-6 6',
  overview: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  receipt: 'M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM9 8h6M9 12h6M9 16h3',
  card: 'M2 6h20v12H2zM2 10h20M6 15h4',
  box: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
  check: 'M5 12l5 5L20 7',
  alert: 'M12 3l10 18H2zM12 10v4M12 17v.5',
  plus: 'M12 5v14M5 12h14',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
  logout: 'M9 21H5V3h4M16 17l5-5-5-5M21 12H9',
  building: 'M4 21V6l8-3 8 3v15M9 21v-5h6v5M8 9h1M15 9h1M8 13h1M15 13h1',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  hand: 'M20 12V8a2 2 0 0 0-4 0M16 8V5a2 2 0 0 0-4 0v1M12 6a2 2 0 0 0-4 0v6M8 10a2 2 0 0 0-4 0v3a8 8 0 0 0 16 0v-1',
  inbox: 'M3 13h5l1 3h6l1-3h5M5 5h14l2 8v6H3v-6z',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z',
  phone: 'M7 2h10v20H7zM11 18h2',
  edit: 'M4 20h4L19 9l-4-4L4 16z',
} as const;
export type IconName = keyof typeof P;

export function Icon({ name, size = 22, color = '#13241b', width = 1.9 }: { name: IconName; size?: number; color?: string; width?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round">
      <Path d={P[name]} />
    </Svg>
  );
}
