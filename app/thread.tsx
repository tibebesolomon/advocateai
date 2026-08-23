import React, { useEffect, useRef, useState } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, Modal,
  StyleSheet, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { MaterialIcons } from '@expo/vector-icons'
import { aiEngine } from '@/ai/engine'
import {
  getDocument, getOrCreateThread, addThreadMessage,
} from '@/documents/store'
import { generateLetterPDF } from '@/pdf/generator'
import * as Sharing from 'expo-sharing'
import { ActionButton } from '@/ui/components/ActionButton'
import { Colors, FontSize, Radius, Spacing } from '@/ui/theme'
import type { ScannedDocument, Thread, ThreadMessage } from '@/types'

export default function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const [doc, setDoc] = useState<ScannedDocument | null>(null)
  const [thread, setThread] = useState<Thread | null>(null)
  const [messages, setMessages] = useState<ThreadMessage[]>([])
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const [replyModalVisible, setReplyModalVisible] = useState(false)
  const [institutionReply, setInstitutionReply] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [generatingReply, setGeneratingReply] = useState(false)
  const [aiStreamText, setAiStreamText] = useState('')

  const scrollRef = useRef<ScrollView>(null)

  useEffect(() => {
    if (!id) return
    getDocument(id).then(loaded => {
      if (!loaded) return
      setDoc(loaded)
      const t = getOrCreateThread(id)
      setThread(t)
      setMessages(t.messages)
    })
  }, [id])

  function toggleExpand(msgId: string) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(msgId)) next.delete(msgId)
      else next.add(msgId)
      return next
    })
  }

  async function submitReply() {
    if (!institutionReply.trim() || !thread || !doc) return
    setSubmitting(true)

    const replyText = institutionReply.trim()
    const instMsg = addThreadMessage({
      threadId: thread.id,
      sender: 'institution',
      content: replyText,
      isAiGenerated: false,
      createdAt: Date.now(),
    })
    setMessages(prev => [...prev, instMsg])
    setInstitutionReply('')
    setReplyModalVisible(false)
    setSubmitting(false)

    const userMsgs = messages.filter(m => m.sender === 'user')
    const lastUserContent = userMsgs[userMsgs.length - 1]?.content ?? ''

    setGeneratingReply(true)
    setAiStreamText('')
    let aiText = ''
    try {
      aiText = await aiEngine.generateReply(doc, lastUserContent, replyText, (token) => {
        aiText += token
        setAiStreamText(t => t + token)
      })

      const aiMsg = addThreadMessage({
        threadId: thread.id,
        sender: 'user',
        content: aiText,
        isAiGenerated: true,
        createdAt: Date.now(),
      })
      setMessages(prev => [...prev, aiMsg])
    } catch {
      Alert.alert('Error', 'Failed to generate reply. Please try again.')
    } finally {
      setGeneratingReply(false)
      setAiStreamText('')
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150)
    }
  }

  async function downloadMessagePDF(msg: ThreadMessage) {
    try {
      const filename = `advocateai-reply-${msg.id}`
      const path = await generateLetterPDF(msg.content, filename)
      const canShare = await Sharing.isAvailableAsync()
      if (canShare) {
        await Sharing.shareAsync(path, { mimeType: 'application/pdf' })
      } else {
        Alert.alert('PDF Saved', `Saved to: ${path}`)
      }
    } catch (err: unknown) {
      Alert.alert('PDF Error', err instanceof Error ? err.message : 'Could not create PDF')
    }
  }

  const institution = doc?.metadata.institution ?? 'Institution'

  return (
    <View style={styles.container}>
      <View style={styles.subheader}>
        <MaterialIcons name="business" size={16} color={Colors.textSecondary} />
        <Text style={styles.subheaderText} numberOfLines={1}>{institution}</Text>
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scroll}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
      >
        {messages.length === 0 && !generatingReply && (
          <View style={styles.emptyState}>
            <MaterialIcons name="chat-bubble-outline" size={48} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No Messages Yet</Text>
            <Text style={styles.emptySubtitle}>
              When {institution} replies to your letter, add their reply below and the AI will draft your response.
            </Text>
          </View>
        )}

        {messages.map((msg) => {
          const isUser = msg.sender === 'user'
          const isExpanded = expandedIds.has(msg.id)
          const isShort = msg.content.length < 320
          const displayContent = isExpanded || isShort
            ? msg.content
            : msg.content.slice(0, 300) + '…'

          return (
            <View key={msg.id} style={[styles.msgRow, isUser ? styles.msgRight : styles.msgLeft]}>
              <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleInstitution]}>
                <View style={styles.bubbleHeader}>
                  <Text style={[styles.senderLabel, { color: isUser ? Colors.primary : Colors.textMuted }]}>
                    {isUser ? (msg.isAiGenerated ? 'Your Letter (AI)' : 'You') : institution}
                  </Text>
                  {isUser && (
                    <TouchableOpacity onPress={() => downloadMessagePDF(msg)} style={styles.pdfBtn}>
                      <MaterialIcons name="picture-as-pdf" size={14} color={Colors.textMuted} />
                    </TouchableOpacity>
                  )}
                </View>
                <Text style={styles.bubbleText}>{displayContent}</Text>
                {!isShort && (
                  <TouchableOpacity onPress={() => toggleExpand(msg.id)} style={styles.expandBtn}>
                    <Text style={styles.expandBtnText}>
                      {isExpanded ? 'Show less' : 'Show full letter'}
                    </Text>
                    <MaterialIcons
                      name={isExpanded ? 'expand-less' : 'expand-more'}
                      size={14}
                      color={Colors.primary}
                    />
                  </TouchableOpacity>
                )}
                <Text style={styles.dateText}>
                  {new Date(msg.createdAt).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric',
                  })}
                </Text>
              </View>
            </View>
          )
        })}

        {generatingReply && (
          <View style={[styles.msgRow, styles.msgRight]}>
            <View style={[styles.bubble, styles.bubbleUser, styles.bubbleGenerating]}>
              <View style={styles.bubbleHeader}>
                <Text style={[styles.senderLabel, { color: Colors.primary }]}>Drafting Reply…</Text>
                <ActivityIndicator size="small" color={Colors.primary} />
              </View>
              {aiStreamText.length > 0 && (
                <Text style={styles.bubbleText}>{aiStreamText}</Text>
              )}
            </View>
          </View>
        )}
      </ScrollView>

      {!generatingReply && (
        <View style={styles.footer}>
          <ActionButton
            label="Add Institution Reply"
            variant="primary"
            size="lg"
            style={{ flex: 1 }}
            onPress={() => setReplyModalVisible(true)}
            icon={<MaterialIcons name="add-comment" size={20} color={Colors.primaryText} />}
          />
        </View>
      )}

      <Modal
        visible={replyModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setReplyModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Institution's Reply</Text>
              <TouchableOpacity onPress={() => setReplyModalVisible(false)}>
                <MaterialIcons name="close" size={24} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>
              Paste or type the reply you received from {institution}:
            </Text>
            <TextInput
              style={styles.replyInput}
              value={institutionReply}
              onChangeText={setInstitutionReply}
              multiline
              placeholder="Paste the institution's reply here…"
              placeholderTextColor={Colors.textMuted}
              textAlignVertical="top"
              autoFocus
            />
            <View style={styles.modalFooter}>
              <ActionButton
                label="Cancel"
                variant="ghost"
                onPress={() => { setReplyModalVisible(false); setInstitutionReply('') }}
              />
              <ActionButton
                label="Get AI Reply"
                variant="primary"
                size="md"
                style={{ flex: 1 }}
                loading={submitting}
                disabled={!institutionReply.trim()}
                onPress={submitReply}
                icon={<MaterialIcons name="auto-awesome" size={20} color={Colors.primaryText} />}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  subheader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  subheaderText: { fontSize: FontSize.sm, color: Colors.textSecondary, flex: 1 },

  scroll: { padding: Spacing.lg, paddingBottom: 100, gap: Spacing.md, flexGrow: 1 },

  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xxl,
    gap: Spacing.md,
  },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.textSecondary },
  emptySubtitle: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 280,
  },

  msgRow: { maxWidth: '90%' },
  msgLeft: { alignSelf: 'flex-start' },
  msgRight: { alignSelf: 'flex-end' },

  bubble: {
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.xs,
    borderWidth: 1,
  },
  bubbleUser: { backgroundColor: '#0D1B2D', borderColor: Colors.primary },
  bubbleInstitution: { backgroundColor: Colors.surface, borderColor: Colors.border },
  bubbleGenerating: { opacity: 0.85 },

  bubbleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  senderLabel: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  pdfBtn: { padding: 2 },
  bubbleText: {
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
    lineHeight: 22,
  },
  expandBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 2 },
  expandBtnText: { fontSize: FontSize.xs, color: Colors.primary, fontWeight: '600' },
  dateText: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: Spacing.xs },

  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: Spacing.lg,
    backgroundColor: Colors.background,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.md,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.textPrimary },
  modalSubtitle: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20 },
  replyInput: {
    backgroundColor: Colors.background,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    fontSize: FontSize.md,
    color: Colors.textPrimary,
    minHeight: 180,
    maxHeight: 300,
  },
  modalFooter: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' },
})
