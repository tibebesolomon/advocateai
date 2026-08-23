import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { Colors, FontSize, Radius, Spacing } from '../theme'

interface Props {
  steps: string[]
  currentStep: number // 0-indexed
}

export function StepIndicator({ steps, currentStep }: Props) {
  return (
    <View style={styles.container} accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: steps.length - 1, now: currentStep }}>
      {steps.map((label, i) => {
        const done = i < currentStep
        const active = i === currentStep
        return (
          <React.Fragment key={i}>
            <View style={styles.step}>
              <View
                style={[
                  styles.dot,
                  done && styles.dotDone,
                  active && styles.dotActive,
                ]}
              >
                {done ? (
                  <Text style={styles.check}>✓</Text>
                ) : (
                  <Text style={[styles.dotLabel, active && styles.dotLabelActive]}>
                    {i + 1}
                  </Text>
                )}
              </View>
              <Text
                style={[styles.label, active && styles.labelActive, done && styles.labelDone]}
                numberOfLines={1}
              >
                {label}
              </Text>
            </View>

            {i < steps.length - 1 && (
              <View style={[styles.connector, done && styles.connectorDone]} />
            )}
          </React.Fragment>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  step: {
    alignItems: 'center',
    gap: 4,
    flex: 0,
  },
  dot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary,
  },
  dotDone: {
    backgroundColor: Colors.success,
    borderColor: Colors.success,
  },
  check: {
    color: Colors.textInverse,
    fontWeight: '700',
    fontSize: FontSize.sm,
  },
  dotLabel: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    fontWeight: '600',
  },
  dotLabelActive: {
    color: Colors.textInverse,
  },
  label: {
    fontSize: 10,
    color: Colors.textMuted,
    textAlign: 'center',
    maxWidth: 56,
  },
  labelActive: {
    color: Colors.primary,
    fontWeight: '700',
  },
  labelDone: {
    color: Colors.success,
  },
  connector: {
    flex: 1,
    height: 2,
    backgroundColor: Colors.border,
    marginTop: 14,
    marginHorizontal: 2,
  },
  connectorDone: {
    backgroundColor: Colors.success,
  },
})
