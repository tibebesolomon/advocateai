import { useCallback, useRef, useState } from 'react'
import {
  Alert,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { router } from 'expo-router'
import { Colors, FontSize, Radius, Spacing } from '@/ui/theme'
import { recordConsent } from '@/legal/consent'
import { TERMS_OF_SERVICE } from '@/legal/terms'
import { PRIVACY_POLICY } from '@/legal/privacy'
import { rf, rs } from '@/ui/responsive'

type Tab = 'terms' | 'privacy'

export default function ConsentScreen() {
  const [activeTab, setActiveTab] = useState<Tab>('terms')
  const [termsScrolled, setTermsScrolled] = useState(false)
  const [privacyScrolled, setPrivacyScrolled] = useState(false)
  const termsRef = useRef<ScrollView>(null)
  const privacyRef = useRef<ScrollView>(null)

  const bothScrolled = termsScrolled && privacyScrolled

  function handleScroll(tab: Tab, e: NativeSyntheticEvent<NativeScrollEvent>) {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent
    const nearBottom = contentOffset.y + layoutMeasurement.height >= contentSize.height - 60
    if (nearBottom) {
      if (tab === 'terms') setTermsScrolled(true)
      else setPrivacyScrolled(true)
    }
  }

  const handleAgree = useCallback(async () => {
    if (!bothScrolled) return
    await recordConsent()
    router.replace('/(tabs)')
  }, [bothScrolled])

  function handleDecline() {
    Alert.alert(
      'Cannot Continue Without Agreement',
      'AdvocateAI requires your acceptance of the Terms of Service and Privacy Policy to use the application. You may review them again or close the app.',
      [
        { text: 'Review Again', style: 'cancel' },
        // On Android, closing an Expo app programmatically is not recommended —
        // direct the user to press the hardware back/home button instead.
        { text: 'Close App', style: 'destructive', onPress: () => {
          Alert.alert('To close', 'Please press your device\'s Home or Back button to exit.')
        }},
      ]
    )
  }

  const termsUnread = !termsScrolled
  const privacyUnread = !privacyScrolled

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.appName}>AdvocateAI</Text>
        <Text style={styles.headline}>Before you begin</Text>
        <Text style={styles.subheadline}>
          Please read and accept our Terms of Service and Privacy Policy.
          Scroll to the bottom of each tab to enable the agree button.
        </Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'terms' && styles.tabActive]}
          onPress={() => setActiveTab('terms')}
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'terms' }}
        >
          <Text style={[styles.tabText, activeTab === 'terms' && styles.tabTextActive]}>
            Terms of Service{termsUnread ? ' ●' : ' ✓'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'privacy' && styles.tabActive]}
          onPress={() => setActiveTab('privacy')}
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'privacy' }}
        >
          <Text style={[styles.tabText, activeTab === 'privacy' && styles.tabTextActive]}>
            Privacy Policy{privacyUnread ? ' ●' : ' ✓'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Scroll pane — only one mounted at a time to keep memory low */}
      <View style={styles.scrollWrapper}>
        {activeTab === 'terms' ? (
          <ScrollView
            ref={termsRef}
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            onScroll={(e) => handleScroll('terms', e)}
            scrollEventThrottle={200}
            showsVerticalScrollIndicator
            accessibilityLabel="Terms of Service document"
          >
            <Text style={styles.legalText} selectable>{TERMS_OF_SERVICE}</Text>
          </ScrollView>
        ) : (
          <ScrollView
            ref={privacyRef}
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            onScroll={(e) => handleScroll('privacy', e)}
            scrollEventThrottle={200}
            showsVerticalScrollIndicator
            accessibilityLabel="Privacy Policy document"
          >
            <Text style={styles.legalText} selectable>{PRIVACY_POLICY}</Text>
          </ScrollView>
        )}

        {!bothScrolled && (
          <View style={styles.scrollHint} pointerEvents="none">
            <Text style={styles.scrollHintText}>↓ Scroll to read</Text>
          </View>
        )}
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        {!bothScrolled && (
          <Text style={styles.readNote}>
            {!termsScrolled && !privacyScrolled
              ? 'Read both tabs to continue'
              : !termsScrolled
              ? 'Finish reading Terms of Service'
              : 'Finish reading Privacy Policy'}
          </Text>
        )}
        <TouchableOpacity
          style={[styles.agreeBtn, !bothScrolled && styles.agreeBtnDisabled]}
          onPress={handleAgree}
          disabled={!bothScrolled}
          accessibilityRole="button"
          accessibilityLabel="I agree to the Terms of Service and Privacy Policy"
          accessibilityState={{ disabled: !bothScrolled }}
        >
          <Text style={[styles.agreeBtnText, !bothScrolled && styles.agreeBtnTextDisabled]}>
            I Agree — Continue
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.declineBtn}
          onPress={handleDecline}
          accessibilityRole="button"
          accessibilityLabel="Decline and close app"
        >
          <Text style={styles.declineBtnText}>Decline</Text>
        </TouchableOpacity>
        <Text style={styles.freeNote}>
          AdvocateAI is free. No account, no subscription, no data sent to any server.
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingTop: rs(52),
    paddingBottom: Spacing.md,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  appName: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.primary,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: rs(4),
  },
  headline: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: rs(6),
  },
  subheadline: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: rf(20),
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tab: {
    flex: 1,
    paddingVertical: rs(12),
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: Colors.primary,
  },
  tabText: {
    fontSize: FontSize.sm,
    fontWeight: '500',
    color: Colors.textSecondary,
  },
  tabTextActive: {
    color: Colors.primary,
    fontWeight: '700',
  },
  scrollWrapper: {
    flex: 1,
    position: 'relative',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.md,
    paddingBottom: rs(40),
  },
  legalText: {
    fontSize: rf(13),
    color: Colors.textPrimary,
    lineHeight: rf(22),
    fontFamily: 'monospace',
  },
  scrollHint: {
    position: 'absolute',
    bottom: rs(8),
    alignSelf: 'center',
    backgroundColor: Colors.surface,
    paddingHorizontal: rs(16),
    paddingVertical: rs(6),
    borderRadius: Radius.round,
    opacity: 0.9,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  scrollHintText: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
  },
  actions: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    paddingBottom: rs(36),
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: rs(10),
  },
  readNote: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  agreeBtn: {
    backgroundColor: Colors.primary,
    paddingVertical: rs(16),
    borderRadius: Radius.md,
    alignItems: 'center',
  },
  agreeBtnDisabled: {
    backgroundColor: Colors.border,
  },
  agreeBtnText: {
    fontSize: FontSize.md,
    fontWeight: '700',
    color: '#fff',
  },
  agreeBtnTextDisabled: {
    color: Colors.textSecondary,
  },
  declineBtn: {
    paddingVertical: rs(12),
    alignItems: 'center',
  },
  declineBtnText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textDecorationLine: 'underline',
  },
  freeNote: {
    fontSize: rf(11),
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: rf(16),
  },
})
