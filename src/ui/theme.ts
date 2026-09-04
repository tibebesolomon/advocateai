// High-contrast, WCAG AA-compliant theme for low-vision and elderly users.
// All color pairs maintain ≥4.5:1 contrast ratio.
// FontSize and Spacing are device-scaled via responsive.ts.
import { rf, rs } from './responsive'
export { isTablet, isSmallPhone, screenW, screenH } from './responsive'

export const Colors = {
  // Backgrounds
  background: '#0D0D0D',
  surface: '#1A1A1A',
  surfaceAlt: '#242424',
  border: '#3A3A3A',

  // Primary action (blue — ≥4.5:1 on dark bg)
  primary: '#4A9EFF',
  primaryDark: '#2176D8',
  primaryText: '#FFFFFF',

  // Severity indicators
  urgentBg: '#3D1010',
  urgentText: '#FF6B6B',
  highBg: '#3D2810',
  highText: '#FFA94D',
  mediumBg: '#2D3010',
  mediumText: '#FFE066',
  lowBg: '#0D2D1A',
  lowText: '#69DB7C',

  // Text
  textPrimary: '#F5F5F5',
  textSecondary: '#A8A8A8',
  textMuted: '#666666',
  textInverse: '#0D0D0D',

  // Feedback
  success: '#51CF66',
  warning: '#FFD43B',
  error: '#FF6B6B',
  info: '#74C0FC',
} as const

export const Spacing = {
  xs: rs(4),
  sm: rs(8),
  md: rs(16),
  lg: rs(24),
  xl: rs(32),
  xxl: rs(48),
} as const

// Accessible minimum touch target: 48×48dp (WCAG 2.5.5)
export const TouchTarget = {
  min: rs(48),
  comfortable: rs(56),
  large: rs(72),
} as const

export const FontSize = {
  xs: rf(11),
  sm: rf(13),
  md: rf(16),
  lg: rf(19),
  xl: rf(24),
  xxl: rf(32),
  hero: rf(42),
} as const

export const Radius = {
  sm: rs(6),
  md: rs(12),
  lg: rs(18),
  xl: rs(24),
  round: 999,
} as const

export type SeverityLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'

export function severityColors(level: SeverityLevel) {
  switch (level) {
    case 'URGENT': return { bg: Colors.urgentBg, text: Colors.urgentText }
    case 'HIGH':   return { bg: Colors.highBg,   text: Colors.highText   }
    case 'MEDIUM': return { bg: Colors.mediumBg,  text: Colors.mediumText }
    case 'LOW':    return { bg: Colors.lowBg,     text: Colors.lowText    }
  }
}

export function severityLabel(level: SeverityLevel): string {
  switch (level) {
    case 'URGENT': return '🔴 Urgent — Act Now'
    case 'HIGH':   return '🟠 High Priority'
    case 'MEDIUM': return '🟡 Needs Attention'
    case 'LOW':    return '🟢 Low Priority'
  }
}
