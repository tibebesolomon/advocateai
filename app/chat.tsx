import React, { useEffect, useRef, useState } from 'react'
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView,
  Platform, Alert,
} from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { MaterialIcons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { aiEngine } from '@/ai/engine'
import { getDocument } from '@/documents/store'
import { getChatMessages, addChatMessage, clearChatMessages } from '@/documents/store'
import { Colors, FontSize, Radius, Spacing } from '@/ui/theme'
import type { ChatMessage, ScannedDocument } from '@/types'

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

const QUICK_STARTERS = [
  'What are my rights here?',
  'Help me write a response letter',
  'How do I appeal this?',
  'Prepare me for a phone call',
]

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const [doc, setDoc] = useState<ScannedDocument | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [openerLoading, setOpenerLoading] = useState(false)
  const [responding, setResponding] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [showStarters, setShowStarters] = useState(true)

  const scrollRef = useRef<ScrollView>(null)
  const inputRef = useRef<TextInput>(null)
  const abortRef = useRef(false)

  useEffect(() => {
    if (!id) return
    abortRef.current = false
    loadAndInit()
    return () => { abortRef.current = true }
  }, [id])

  async function loadAndInit() {
    const loaded = await getDocument(id)
    if (!loaded) { Alert.alert('Error', 'Document not found'); router.back(); return }
    setDoc(loaded)

    const existing = getChatMessages(id)
    if (existing.length > 0) {
      setMessages(existing)
      setShowStarters(false)
    } else {
      generateOpener(loaded)
    }
  }

  async function generateOpener(document: ScannedDocument) {
    setOpenerLoading(true)
    setStreamText('')
    let full = ''
    try {
      full = await aiEngine.generateChatOpener(document, (token) => {
        if (!abortRef.current) {
          full += token
          setStreamText(t => t + token)
        }
      })
    } catch {
      full = `I've reviewed your document from ${document.metadata.institution ?? 'the sender'}. I'm here to help you understand your situation and figure out the best next steps. Can you tell me what happened and what's worrying you most right now?`
    } finally {
      if (!abortRef.current) {
        setStreamText('')
        setOpenerLoading(false)
        const msg = addChatMessage({
          documentId: id,
          role: 'advocate',
          content: full.trim(),
          createdAt: Date.now(),
        })
        setMessages([msg])
        scrollToBottom()
      }
    }
  }

  async function sendMessage(text?: string) {
    const content = (text ?? input).trim()
    if (!content || !doc || responding) return

    setInput('')
    setShowStarters(false)
    abortRef.current = false

    const userMsg = addChatMessage({
      documentId: id,
      role: 'user',
      content,
      createdAt: Date.now(),
    })
    const updatedHistory = [...messages, userMsg]
    setMessages(updatedHistory)
    scrollToBottom()

    setResponding(true)
    setStreamText('')
    let full = ''
    try {
      full = await aiEngine.chat(doc, updatedHistory, content, (token) => {
        if (!abortRef.current) {
          full += token
          setStreamText(t => t + token)
        }
      })
    } catch {
      full = 'I had trouble generating a response. Please try again.'
    } finally {
      if (!abortRef.current) {
        setStreamText('')
        setResponding(false)
        const aiMsg = addChatMessage({
          documentId: id,
          role: 'advocate',
          content: full.trim(),
          createdAt: Date.now(),
        })
        setMessages(prev => [...prev, aiMsg])
        scrollToBottom()
      }
    }
  }

  function scrollToBottom() {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120)
  }

  function confirmClear() {
    Alert.alert(
      'Clear conversation',
      'This will delete the entire conversation. Your document analysis is not affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear', style: 'destructive',
          onPress: () => {
            clearChatMessages(id)
            setMessages([])
            setShowStarters(true)
            if (doc) generateOpener(doc)
          },
        },
      ]
    )
  }

  function navigateToAction() {
    router.push({ pathname: '/action', params: { id } })
  }

  const isTyping = openerLoading || responding
  const typeLabel = doc ? (DOC_TYPE_LABELS[doc.type] ?? 'Document') : ''

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <MaterialIcons name="arrow-back" size={24} color={Colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.avatarSmall}>
            <MaterialIcons name="shield" size={16} color={Colors.primaryText} />
          </View>
          <View>
            <Text style={styles.headerTitle}>Your Advocate</Text>
            {typeLabel ? <Text style={styles.headerSub}>{typeLabel}</Text> : null}
          </View>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.headerBtn} onPress={navigateToAction} accessibilityLabel="View document analysis">
            <MaterialIcons name="description" size={20} color={Colors.textSecondary} />
          </TouchableOpacity>
          {messages.length > 0 && (
            <TouchableOpacity style={styles.headerBtn} onPress={confirmClear} accessibilityLabel="Clear conversation">
              <MaterialIcons name="refresh" size={20} color={Colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={scrollToBottom}
        >

          {/* Opener loading */}
          {openerLoading && messages.length === 0 && (
            <View style={styles.advocateRow}>
              <View style={styles.avatar}>
                <MaterialIcons name="shield" size={18} color={Colors.primaryText} />
              </View>
              <View style={[styles.bubble, styles.advocateBubble]}>
                {streamText.length > 0 ? (
                  <Text style={styles.bubbleText}>{streamText}</Text>
                ) : (
                  <View style={styles.typingIndicator}>
                    <View style={[styles.dot, styles.dot1]} />
                    <View style={[styles.dot, styles.dot2]} />
                    <View style={[styles.dot, styles.dot3]} />
                  </View>
                )}
              </View>
            </View>
          )}

          {/* Messages */}
          {messages.map((msg, i) => {
            const isAdvocate = msg.role === 'advocate'
            const isLast = i === messages.length - 1

            return (
              <View key={msg.id} style={[styles.msgRow, isAdvocate ? styles.advocateRow : styles.userRow]}>
                {isAdvocate && (
                  <View style={styles.avatar}>
                    <MaterialIcons name="shield" size={18} color={Colors.primaryText} />
                  </View>
                )}
                <View style={[styles.bubble, isAdvocate ? styles.advocateBubble : styles.userBubble]}>
                  <Text style={[styles.bubbleText, isAdvocate ? styles.advocateText : styles.userText]}>
                    {msg.content}
                  </Text>
                  <Text style={[styles.timestamp, isAdvocate ? styles.timestampLeft : styles.timestampRight]}>
                    {new Date(msg.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  </Text>
                </View>

                {/* Quick starters after opener */}
                {isAdvocate && isLast && messages.length === 1 && showStarters && !isTyping && (
                  <View style={styles.startersWrap}>
                    {QUICK_STARTERS.map(s => (
                      <TouchableOpacity key={s} style={styles.starterChip} onPress={() => sendMessage(s)}>
                        <Text style={styles.starterText}>{s}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            )
          })}

          {/* Streaming response */}
          {responding && (
            <View style={styles.advocateRow}>
              <View style={styles.avatar}>
                <MaterialIcons name="shield" size={18} color={Colors.primaryText} />
              </View>
              <View style={[styles.bubble, styles.advocateBubble]}>
                {streamText.length > 0 ? (
                  <Text style={styles.bubbleText}>{streamText}</Text>
                ) : (
                  <View style={styles.typingIndicator}>
                    <View style={[styles.dot, styles.dot1]} />
                    <View style={[styles.dot, styles.dot2]} />
                    <View style={[styles.dot, styles.dot3]} />
                  </View>
                )}
              </View>
            </View>
          )}

          {/* Action chips after advocate responds (post-opener) */}
          {!isTyping && messages.length > 1 && messages[messages.length - 1].role === 'advocate' && (
            <View style={styles.actionChipsRow}>
              <TouchableOpacity style={styles.actionChip} onPress={() => router.push({ pathname: '/action', params: { id } })}>
                <MaterialIcons name="edit" size={13} color={Colors.primary} />
                <Text style={styles.actionChipText}>Write Letter</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionChip} onPress={() => sendMessage('Prepare me for a phone call')}>
                <MaterialIcons name="phone" size={13} color={Colors.primary} />
                <Text style={styles.actionChipText}>Call Script</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionChip} onPress={() => sendMessage('What are my rights?')}>
                <MaterialIcons name="shield" size={13} color={Colors.primary} />
                <Text style={styles.actionChipText}>My Rights</Text>
              </TouchableOpacity>
            </View>
          )}

        </ScrollView>

        {/* Input bar */}
        <View style={styles.inputBar}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Tell me what happened…"
            placeholderTextColor={Colors.textMuted}
            multiline
            maxLength={1000}
            returnKeyType="default"
            blurOnSubmit={false}
            editable={!openerLoading}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!input.trim() || isTyping) && styles.sendBtnDisabled]}
            onPress={() => sendMessage()}
            disabled={!input.trim() || isTyping}
            accessibilityLabel="Send message"
          >
            {responding ? (
              <ActivityIndicator size="small" color={Colors.primaryText} />
            ) : (
              <MaterialIcons name="send" size={20} color={Colors.primaryText} />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: Spacing.sm,
  },
  backBtn: {
    width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
  },
  headerCenter: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
  },
  avatarSmall: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.textPrimary },
  headerSub: { fontSize: FontSize.xs, color: Colors.textSecondary },
  headerActions: { flexDirection: 'row', gap: 4 },
  headerBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },

  scroll: { flex: 1 },
  scrollContent: { padding: Spacing.md, paddingBottom: Spacing.xl, gap: 12 },

  msgRow: { gap: 8 },
  advocateRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm },
  userRow: { flexDirection: 'row', justifyContent: 'flex-end' },

  avatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, alignSelf: 'flex-end',
  },

  bubble: {
    maxWidth: '82%', borderRadius: Radius.lg, padding: Spacing.md,
    gap: 4,
  },
  advocateBubble: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    borderBottomLeftRadius: 4,
  },
  userBubble: {
    backgroundColor: Colors.primary,
    borderBottomRightRadius: 4,
  },

  bubbleText: { fontSize: FontSize.md, lineHeight: 23 },
  advocateText: { color: Colors.textPrimary },
  userText: { color: Colors.primaryText },

  timestamp: { fontSize: 10, marginTop: 2 },
  timestampLeft: { color: Colors.textMuted },
  timestampRight: { color: 'rgba(255,255,255,0.65)', textAlign: 'right' },

  typingIndicator: {
    flexDirection: 'row', gap: 4, alignItems: 'center', paddingVertical: 4,
  },
  dot: {
    width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.textMuted,
  },
  dot1: { opacity: 1 },
  dot2: { opacity: 0.65 },
  dot3: { opacity: 0.35 },

  startersWrap: {
    flexWrap: 'wrap', flexDirection: 'row', gap: 8,
    marginTop: 4, marginLeft: 44, // align under the bubble (36 avatar + 8 gap)
  },
  starterChip: {
    borderRadius: Radius.round,
    borderWidth: 1, borderColor: Colors.primary,
    paddingHorizontal: Spacing.md, paddingVertical: 6,
    backgroundColor: Colors.surfaceAlt,
  },
  starterText: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600' },

  actionChipsRow: {
    flexDirection: 'row', gap: 8, marginLeft: 44, flexWrap: 'wrap',
  },
  actionChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: Radius.round, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.sm, paddingVertical: 5,
    backgroundColor: Colors.surfaceAlt,
  },
  actionChipText: { fontSize: FontSize.xs, color: Colors.primary, fontWeight: '600' },

  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm,
    padding: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.border,
    backgroundColor: Colors.background,
  },
  input: {
    flex: 1, backgroundColor: Colors.surface, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.md, paddingVertical: 10,
    fontSize: FontSize.md, color: Colors.textPrimary, lineHeight: 22,
    maxHeight: 120,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: Colors.border },
})
