import React from 'react'
import {
  TouchableOpacity,
  Text,
  ActivityIndicator,
  StyleSheet,
  type ViewStyle,
  type TextStyle,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import { Colors, FontSize, Radius, Spacing, TouchTarget } from '../theme'

interface Props {
  label: string
  onPress: () => void
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  disabled?: boolean
  style?: ViewStyle
  icon?: React.ReactNode
  accessibilityHint?: string
}

export function ActionButton({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  style,
  icon,
  accessibilityHint,
}: Props) {
  async function handlePress() {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    onPress()
  }

  const containerStyle = [
    styles.base,
    styles[variant],
    sizeStyles[size],
    (disabled || loading) && styles.disabled,
    style,
  ]

  return (
    <TouchableOpacity
      onPress={handlePress}
      disabled={disabled || loading}
      style={containerStyle}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
    >
      {loading ? (
        <ActivityIndicator color={variantTextColor[variant]} />
      ) : (
        <>
          {icon}
          <Text style={[styles.label, labelStyles[variant], labelSizeStyles[size]]}>
            {label}
          </Text>
        </>
      )}
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.md,
    minHeight: TouchTarget.comfortable,
  },
  disabled: { opacity: 0.45 },

  // Variants
  primary: { backgroundColor: Colors.primary },
  secondary: { backgroundColor: Colors.surfaceAlt, borderWidth: 1, borderColor: Colors.border },
  danger: { backgroundColor: Colors.urgentBg, borderWidth: 1, borderColor: Colors.urgentText },
  ghost: { backgroundColor: 'transparent' },

  label: { fontWeight: '700', letterSpacing: 0.3 },
})

const sizeStyles: Record<'sm' | 'md' | 'lg', ViewStyle> = {
  sm: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, minHeight: TouchTarget.min },
  md: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
  lg: { paddingHorizontal: Spacing.xl, paddingVertical: Spacing.lg, minHeight: TouchTarget.large },
}

const labelStyles: Record<string, TextStyle> = {
  primary: { color: Colors.primaryText },
  secondary: { color: Colors.textPrimary },
  danger: { color: Colors.urgentText },
  ghost: { color: Colors.primary },
}

const labelSizeStyles: Record<'sm' | 'md' | 'lg', TextStyle> = {
  sm: { fontSize: FontSize.sm },
  md: { fontSize: FontSize.md },
  lg: { fontSize: FontSize.lg },
}

const variantTextColor: Record<string, string> = {
  primary: Colors.primaryText,
  secondary: Colors.textPrimary,
  danger: Colors.urgentText,
  ghost: Colors.primary,
}
