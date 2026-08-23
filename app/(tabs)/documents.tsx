import React, { useCallback, useState } from 'react'
import {
  View, Text, FlatList, StyleSheet, TextInput, TouchableOpacity, Alert,
} from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import { MaterialIcons } from '@expo/vector-icons'
import { getAllDocuments, deleteDocument } from '@/documents/store'
import { DocumentCard } from '@/ui/components/DocumentCard'
import { Colors, FontSize, Radius, Spacing } from '@/ui/theme'
import type { ScannedDocument } from '@/types'

export default function DocumentsScreen() {
  const [docs, setDocs] = useState<ScannedDocument[]>([])
  const [query, setQuery] = useState('')

  useFocusEffect(
    useCallback(() => {
      let active = true
      getAllDocuments().then(d => { if (active) setDocs(d) })
      return () => { active = false }
    }, [])
  )

  const filtered = query.trim()
    ? docs.filter(
        (d) =>
          d.type.toLowerCase().includes(query.toLowerCase()) ||
          (d.metadata.institution ?? '').toLowerCase().includes(query.toLowerCase()) ||
          d.rawText.toLowerCase().includes(query.toLowerCase().slice(0, 40))
      )
    : docs

  function confirmDelete(id: string) {
    Alert.alert(
      'Delete Document',
      'This will permanently delete the document and any generated letters.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteDocument(id)
            setDocs((prev) => prev.filter((d) => d.id !== id))
          },
        },
      ]
    )
  }

  return (
    <View style={styles.container}>
      {/* Search bar */}
      <View style={styles.searchBar}>
        <MaterialIcons name="search" size={20} color={Colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search documents…"
          placeholderTextColor={Colors.textMuted}
          returnKeyType="search"
          clearButtonMode="while-editing"
          accessibilityLabel="Search documents"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')}>
            <MaterialIcons name="close" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <DocumentCard
            document={item}
            onPress={() => router.push({ pathname: '/action', params: { id: item.id } })}
            onDelete={() => confirmDelete(item.id)}
          />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <MaterialIcons name="folder-open" size={56} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>
              {query ? 'No results found' : 'No documents yet'}
            </Text>
            <Text style={styles.emptyDesc}>
              {query
                ? 'Try a different search term'
                : 'Scan or import a document from the Home tab to get started.'}
            </Text>
            {!query && (
              <TouchableOpacity
                style={styles.emptyBtn}
                onPress={() => router.push('/')}
              >
                <Text style={styles.emptyBtnText}>Go to Home</Text>
              </TouchableOpacity>
            )}
          </View>
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    margin: Spacing.lg,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: FontSize.md,
    color: Colors.textPrimary,
  },

  list: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xl },

  empty: { alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.xxl },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.textSecondary },
  emptyDesc: {
    fontSize: FontSize.md,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 260,
  },
  emptyBtn: {
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
  },
  emptyBtnText: { color: Colors.primaryText, fontWeight: '700', fontSize: FontSize.md },
})
