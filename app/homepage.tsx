import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { supabase } from "../supabase";

export default function HomePage() {
  const router = useRouter();

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace("/");
  }

  return (
    <View style={styles.root}>
      {/* ── Top App Bar ── */}
      <View style={styles.appBar}>
        <View style={styles.logoRow}>
          <View style={styles.logoIconBg}>
            <Image 
              source={require("../assets/images/logo.png")} 
              style={styles.smallLogo} 
              resizeMode="contain" 
            />
          </View>
          <Text style={styles.appTitle}>Tseki</Text>
        </View>
        <Pressable onPress={() => {}}>
          <Ionicons name="notifications-outline" size={24} color="#4B5563" />
        </Pressable>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Section Header ── */}
        <View style={styles.sectionHeader}>
          <View style={styles.headerTextWrap}>
            <Text style={styles.sectionTitle}>Your Classroom</Text>
            <Text style={styles.sectionSubtitle}>
              Select a course to manage quizzes & scorecards
            </Text>
          </View>
          <Pressable style={styles.addBtn}>
            <Ionicons name="add" size={24} color="#FFFFFF" />
          </Pressable>
        </View>

        {/* ── Class Card 1 (Blue) ── */}
        <Pressable style={styles.classCard}>
          <View style={[styles.cardTop, { backgroundColor: "#3B82F6" }]}>
            <Text style={styles.cardSchedule}>A - Destiny</Text>
            <Text style={styles.cardTitle}>Grade 10 - Newton</Text>
            <Text style={styles.cardRoom}>Room 301</Text>
          </View>
          <View style={styles.cardBottom}>
            <View style={styles.statItem}>
              <Ionicons name="people-outline" size={16} color="#4B5563" />
              <Text style={styles.statText}>3 Students</Text>
            </View>
            <View style={styles.statItem}>
              <Ionicons name="book-outline" size={16} color="#4B5563" />
              <Text style={styles.statText}>2 Quizzes</Text>
            </View>
            <View style={styles.flaggedBadge}>
              <Ionicons name="warning-outline" size={14} color="#EF4444" />
              <Text style={styles.flaggedText}>1 FLAGGED</Text>
            </View>
          </View>
        </Pressable>

        {/* ── Class Card 2 (Orange) ── */}
        <Pressable style={styles.classCard}>
          <View style={[styles.cardTop, { backgroundColor: "#F59E0B" }]}>
            <Text style={styles.cardSchedule}>MWF 12:30 - 1:30</Text>
            <Text style={styles.cardTitle}>Grade 10 - Einstein</Text>
            <Text style={styles.cardRoom}>Room 302</Text>
          </View>
          <View style={styles.cardBottom}>
            <View style={styles.statItem}>
              <Ionicons name="people-outline" size={16} color="#4B5563" />
              <Text style={styles.statText}>2 Students</Text>
            </View>
            <View style={styles.statItem}>
              <Ionicons name="book-outline" size={16} color="#4B5563" />
              <Text style={styles.statText}>2 Quizzes</Text>
            </View>
            <View style={styles.flaggedBadge}>
              <Ionicons name="warning-outline" size={14} color="#EF4444" />
              <Text style={styles.flaggedText}>1 FLAGGED</Text>
            </View>
          </View>
        </Pressable>

        {/* ── Info Banner ── */}
        <View style={styles.infoBanner}>
          <Image 
            source={require("../assets/images/logo.png")} 
            style={styles.bannerMascot} 
            resizeMode="contain" 
          />
          <View style={styles.bannerTextContent}>
            <Text style={styles.bannerTitle}>Hi Teacher! I'm Tseki</Text>
            <Text style={styles.bannerBody}>
              I'm here to automate grading and flag struggling students!
              Open a class, tap the camera tab to grade sheets instantly,
              or use the AI Generator to build standard-based quizzes.
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* ── Bottom Navigation ── */}
      <View style={styles.bottomNav}>
        <Pressable style={[styles.navItem, styles.navItemActive]}>
          <Ionicons name="school" size={26} color="#111827" />
          <Text style={styles.navTextActive}>My Classes</Text>
        </Pressable>
        {/* Temporarily using settings as logout to keep functionality */}
        <Pressable style={styles.navItem} onPress={handleLogout}>
          <Ionicons name="settings" size={26} color="#4B5563" />
          <Text style={styles.navText}>Settings</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#F9FAFB",
  },
  
  /* ── Top App Bar ── */
  appBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 16,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  logoIconBg: {
    width: 36,
    height: 36,
    backgroundColor: "#FEF3C7",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  smallLogo: {
    width: 24,
    height: 24,
  },
  appTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#1F2937",
  },

  /* ── Scroll Area ── */
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 40,
  },

  /* ── Section Header ── */
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 20,
  },
  headerTextWrap: {
    flex: 1,
    paddingRight: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#4B5563",
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: "#6B7280",
  },
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: "#F97316",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#F97316",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },

  /* ── Class Cards ── */
  classCard: {
    borderRadius: 16,
    marginBottom: 16,
    backgroundColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  cardTop: {
    padding: 16,
    paddingBottom: 24,
  },
  cardSchedule: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 11,
    fontWeight: "600",
    marginBottom: 4,
  },
  cardTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 2,
  },
  cardRoom: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 12,
  },
  cardBottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 12,
    paddingHorizontal: 16,
    backgroundColor: "#FFFFFF",
  },
  statItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statText: {
    fontSize: 12,
    color: "#4B5563",
    fontWeight: "500",
  },
  flaggedBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FEE2E2",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  flaggedText: {
    fontSize: 10,
    color: "#EF4444",
    fontWeight: "700",
  },

  /* ── Info Banner ── */
  infoBanner: {
    flexDirection: "row",
    backgroundColor: "#FFFBEB",
    borderRadius: 16,
    padding: 16,
    marginTop: 8,
    alignItems: "center",
  },
  bannerMascot: {
    width: 60,
    height: 80,
    marginRight: 16,
  },
  bannerTextContent: {
    flex: 1,
  },
  bannerTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1F2937",
    marginBottom: 4,
  },
  bannerBody: {
    fontSize: 11,
    color: "#4B5563",
    lineHeight: 16,
  },

  /* ── Bottom Navigation ── */
  bottomNav: {
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
    paddingBottom: 30, // for safe area
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
  },
  navItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 8,
  },
  navItemActive: {
    backgroundColor: "#FEF3C7",
    marginHorizontal: 16,
    borderRadius: 12,
  },
  navText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#4B5563",
  },
  navTextActive: {
    fontSize: 12,
    fontWeight: "700",
    color: "#111827",
  },
});
