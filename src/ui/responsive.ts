import { Dimensions, PixelRatio } from 'react-native'

const BASE_WIDTH = 390 // iPhone 14 — design reference baseline

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window')

export const screenW = SCREEN_W
export const screenH = SCREEN_H

// Tablet: shortest side ≥ 600dp
export const isTablet = Math.min(SCREEN_W, SCREEN_H) >= 600
export const isSmallPhone = SCREEN_W < 360

// Font scale: floor 0.85× (tiny phones), ceiling 1.35× (tablets).
// Gentler than layout scale — extreme font growth hurts readability.
const _fontScale = Math.min(Math.max(SCREEN_W / BASE_WIDTH, 0.85), 1.35)

// Layout scale: slightly wider range so tablets get more breathing room.
const _sizeScale = Math.min(Math.max(SCREEN_W / BASE_WIDTH, 0.85), 1.55)

/** Responsive font size — pass the base design value (at 390px width). */
export function rf(size: number): number {
  return Math.round(PixelRatio.roundToNearestPixel(size * _fontScale))
}

/** Responsive size for spacing, radius, icon sizes, etc. */
export function rs(size: number): number {
  return Math.round(size * _sizeScale)
}

/** Responsive width as a fraction of screen width. */
export function rw(fraction: number): number {
  return Math.round(SCREEN_W * fraction)
}
