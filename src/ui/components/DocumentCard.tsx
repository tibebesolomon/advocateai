import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native'
import { MaterialIcons } from '@expo/vector-icons'
import { Colors, FontSize, Radius, Spacing, severityColors, severityLabel } from '../theme'
import type { ScannedDocument } from '../../types'

interface Props {
  document: ScannedDocument
  onPress: () => void
  onLongPress?: () => void
  onDelete?: () => void
}

const DOC_TYPE_LABELS: Record<string, string> = {
  MEDICAL_BILL: 'Medical Bill',
  INSURANCE_DENIAL: 'Insurance Denial',
  EVICTION_NOTICE: 'Eviction Notice',
  HOUSING_NOTICE: 'Housing Notice',
  WELFARE_FORM: 'Benefits Form',
  LEGAL_NOTICE: 'Legal Notice',
  UTILITY_BILL: 'Utility Bill',
  GENERAL: 'Document',
}

const DOC_TYPE_EMOJI: Record<string, string> = {
  MEDICAL_BILL: '🏥',
  INSURANCE_DENIAL: '📋',
  EVICTION_NOTICE: '🚨',
  HOUSING_NOTICE: '🏠',
  WELFARE_FORM: '📄',
  LEGAL_NOTICE: '⚖️',
  UTILITY_BILL: '💡',
  GENERAL: '📁',
}

export function DocumentCard({ document, onPress, onLongPress, onDelete }: Props) {
  const severity = document.analysisResult?.severity
  const sevColors = severity ? severityColors(severity) : null
  const label = DOC_TYPE_LABELS[document.type] ?? 'Document'
  const emoji = DOC_TYPE_EMOJI[document.type] ?? '📁'
  const date = new Date(document.createdAt).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })

  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onLongPress}
      style={styles.card}
      accessibilityRole="button"
      accessibilityLabel={`${label} from ${document.metadata.institution ?? 'unknown sender'}, ${date}`}
    >
      {/* Thumbnail */}
      {document.imageUri ? (
        <Image source={{ uri: document.imageUri }} style={styles.thumbnail} resizeMode="cover" />
      ) : (
        <View style={styles.thumbnailPlaceholder}>
          <Text style={styles.emoji}>{emoji}</Text>
        </View>
      )}

      {/* Content */}
      <View style={styles.content}>
        <View style={styles.row}>
          <Text style={styles.typeLabel}>{label}</Text>
          {sevColors && (
            <View style={[styles.severityBadge, { backgroundColor: sevColors.bg }]}>
              <Text style={[styles.severityText, { color: sevColors.text }]}>
                {severity}
              </Text>
            </View>
          )}
        </View>

        {document.metadata.institution && (
          <Text style={styles.institution} numberOfLines={1}>
            {document.metadata.institution}
          </Text>
        )}

        {document.analysisResult?.summary ? (
          <Text style={styles.summary} numberOfLines={2}>
            {document.analysisResult.summary}
          </Text>
        ) : (
          <Text style={styles.unanalyzed}>Tap to analyze with AI</Text>
        )}

        <View style={styles.footer}>
          <Text style={styles.date}>{date}</Text>
          {document.metadata.amount != null && (
            <Text style={styles.amount}>${document.metadata.amount.toFixed(2)}</Text>
          )}
          {onDelete && (
            <TouchableOpacity
              onPress={onDelete}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.deleteBtn}
              accessibilityLabel="Delete document"
            >
              <MaterialIcons name="delete-outline" size={18} color={Colors.error} />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  thumbnail: {
    width: 80,
    height: 100,
    backgroundColor: Colors.surfaceAlt,
  },
  thumbnailPlaceholder: {
    width: 80,
    height: 100,
    backgroundColor: Colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: { fontSize: 32 },
  content: {
    flex: 1,
    padding: Spacing.md,
    gap: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  typeLabel: {
    fontSize: FontSize.md,
    fontWeight: '700',
    color: Colors.textPrimary,
    flex: 1,
  },
  severityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 99,
  },
  severityText: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  institution: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  summary: {
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
    lineHeight: 18,
  },
  unanalyzed: {
    fontSize: FontSize.sm,
    color: Colors.primary,
    fontStyle: 'italic',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  date: { fontSize: FontSize.xs, color: Colors.textMuted },
  amount: { fontSize: FontSize.sm, color: Colors.warning, fontWeight: '700' },
  deleteBtn: { marginLeft: 'auto' as any },
})
