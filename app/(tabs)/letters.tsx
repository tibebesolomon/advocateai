import React, { useCallback, useState } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, Alert,
} from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import * as Sharing from 'expo-sharing'
import { MaterialIcons } from '@expo/vector-icons'
import { getAllLetters, deleteLetter } from '@/documents/store'
import { Colors, FontSize, Radius, Spacing } from '@/ui/theme'
import type { GeneratedLetter } from '@/types'

const TYPE_LABELS: Record<string, string> = {
  DISPUTE_LETTER: 'Dispute Letter',
  APPEAL_LETTER: 'Appeal Letter',
  FORM_FILL: 'Form',
  CALL_SCRIPT: 'Call Script',
  INFORMATION: 'Information',
}

const TYPE_ICONS: Record<string, string> = {
  DISPUTE_LETTER: 'edit',
  APPEAL_LETTER: 'gavel',
  FORM_FILL: 'assignment',
  CALL_SCRIPT: 'phone',
  INFORMATION: 'info',
}

export default function LettersScreen() {
  const [letters, setLetters] = useState<GeneratedLetter[]>([])

  useFocusEffect(
    useCallback(() => {
      setLetters(getAllLetters())
    }, [])
  )

  async function share(letter: GeneratedLetter) {
    if (!letter.pdfPath) {
      Alert.alert('No PDF yet', 'Open the letter and tap "Download PDF" to create a shareable file.')
      return
    }
    const canShare = await Sharing.isAvailableAsync()
    if (canShare) {
      await Sharing.shareAsync(letter.pdfPath, { mimeType: 'application/pdf' })
    }
  }

  function confirmDelete(id: string) {
    Alert.alert('Delete Letter', 'Remove this letter permanently?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteLetter(id)
          setLetters((prev) => prev.filter((l) => l.id !== id))
        },
      },
    ])
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={letters}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <LetterRow
            letter={item}
            onOpen={() =>
              router.push({
                pathname: '/letter',
                params: { id: item.documentId, letterType: item.type },
              })
            }
            onShare={() => share(item)}
            onDelete={() => confirmDelete(item.id)}
          />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <MaterialIcons name="mail-outline" size={56} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No letters yet</Text>
            <Text style={styles.emptyDesc}>
              Analyze a document and generate a dispute or appeal letter to see it here.
            </Text>
          </View>
        }
      />
    </View>
  )
}

function LetterRow({
  letter,
  onOpen,
  onShare,
  onDelete,
}: {
  letter: GeneratedLetter
  onOpen: () => void
  onShare: () => void
  onDelete: () => void
}) {
  const date = new Date(letter.createdAt).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })

  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${TYPE_LABELS[letter.type] ?? 'Letter'}, created ${date}`}
    >
      <View style={styles.rowIcon}>
        <MaterialIcons
          name={(TYPE_ICONS[letter.type] ?? 'mail') as any}
          size={24}
          color={Colors.primary}
        />
      </View>
      <View style={styles.rowContent}>
        <Text style={styles.rowTitle}>{TYPE_LABELS[letter.type] ?? 'Letter'}</Text>
        <Text style={styles.rowDate}>{date}</Text>
        <Text style={styles.rowPreview} numberOfLines={2}>
          {letter.content.slice(0, 120)}
        </Text>
      </View>
      <View style={styles.rowActions}>
        <TouchableOpacity
          onPress={onShare}
          style={styles.iconBtn}
          accessibilityLabel="Share letter"
        >
          <MaterialIcons name="share" size={20} color={Colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onDelete}
          style={styles.iconBtn}
          accessibilityLabel="Delete letter"
        >
          <MaterialIcons name="delete-outline" size={20} color={Colors.textMuted} />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.lg, paddingBottom: Spacing.xxl },

  empty: { alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.xxl },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.textSecondary },
  emptyDesc: {
    fontSize: FontSize.md,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 260,
  },

  row: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.md,
    padding: Spacing.md,
    gap: Spacing.md,
    alignItems: 'flex-start',
  },
  rowIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  rowContent: { flex: 1, gap: 2 },
  rowTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.textPrimary },
  rowDate: { fontSize: FontSize.xs, color: Colors.textMuted },
  rowPreview: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 18, marginTop: 4 },
  rowActions: { gap: 4 },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
