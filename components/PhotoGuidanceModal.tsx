import React from "react";
import {
    Modal,
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
    TouchableWithoutFeedback,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../context/ThemeContext";

export interface PhotoGuidanceModalProps {
    visible: boolean;
    onClose: () => void;
    accentColor?: string;
}

export function PhotoGuidanceModal({
    visible,
    onClose,
    accentColor = "#F97316",
}: PhotoGuidanceModalProps) {
    const { darkMode } = useTheme();

    if (!visible) return null;

    const bg = darkMode ? "#1F2937" : "#FFFFFF";
    const textMain = darkMode ? "#F9FAFB" : "#111827";
    const textSub = darkMode ? "#9CA3AF" : "#4B5563";
    const cardBg = darkMode ? "#374151" : "#F9FAFB";
    const border = darkMode ? "#4B5563" : "#E5E7EB";

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <View style={styles.overlay}>
                <TouchableWithoutFeedback onPress={onClose}>
                    <View style={StyleSheet.absoluteFillObject} />
                </TouchableWithoutFeedback>

                <View style={[styles.card, { backgroundColor: bg }]}>
                    {/* Header */}
                    <View style={styles.header}>
                        <View style={styles.headerLeft}>
                            <View style={[styles.headerIconBg, { backgroundColor: accentColor + "20" }]}>
                                <Ionicons name="camera" size={20} color={accentColor} />
                            </View>
                            <View>
                                <Text style={[styles.title, { color: textMain }]}>Photo Scan Guidance</Text>
                                <Text style={[styles.subtitle, { color: textSub }]}>3 rules for 100% accurate AI grading</Text>
                            </View>
                        </View>
                        <TouchableOpacity style={[styles.closeBtn, { backgroundColor: cardBg }]} onPress={onClose}>
                            <Ionicons name="close" size={20} color={textSub} />
                        </TouchableOpacity>
                    </View>

                    <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
                        {/* Rule 1: Lighting */}
                        <View style={[styles.ruleCard, { backgroundColor: cardBg, borderColor: border }]}>
                            <View style={styles.ruleHeader}>
                                <View style={[styles.ruleBadge, { backgroundColor: "#FBBF2425" }]}>
                                    <Ionicons name="sunny" size={18} color="#D97706" />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={[styles.ruleTitle, { color: textMain }]}>1. Bright, Even Lighting</Text>
                                    <Text style={[styles.ruleDesc, { color: textSub }]}>
                                        Ensure uniform light across the entire page without harsh shadows.
                                    </Text>
                                </View>
                            </View>

                            <View style={styles.tipsList}>
                                <View style={styles.tipRow}>
                                    <Ionicons name="checkmark-circle" size={16} color="#10B981" />
                                    <Text style={[styles.tipText, { color: textMain }]}>
                                        Scan in a well-lit room or directly under ambient room light.
                                    </Text>
                                </View>
                                <View style={styles.tipRow}>
                                    <Ionicons name="close-circle" size={16} color="#EF4444" />
                                    <Text style={[styles.tipText, { color: textMain }]}>
                                        Avoid casting your phone or hand shadow over student answers.
                                    </Text>
                                </View>
                                <View style={styles.tipRow}>
                                    <Ionicons name="flash" size={16} color="#F59E0B" />
                                    <Text style={[styles.tipText, { color: textMain }]}>
                                        Tap the torch icon at top-right if lighting is dim.
                                    </Text>
                                </View>
                            </View>
                        </View>

                        {/* Rule 2: Sharp Focus & Steady Camera */}
                        <View style={[styles.ruleCard, { backgroundColor: cardBg, borderColor: border }]}>
                            <View style={styles.ruleHeader}>
                                <View style={[styles.ruleBadge, { backgroundColor: "#3B82F625" }]}>
                                    <Ionicons name="sparkles" size={18} color="#2563EB" />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={[styles.ruleTitle, { color: textMain }]}>2. Sharp Focus & Clear Answers</Text>
                                    <Text style={[styles.ruleDesc, { color: textSub }]}>
                                        Keep handwritten answers and letters clear and in sharp focus.
                                    </Text>
                                </View>
                            </View>

                            <View style={styles.tipsList}>
                                <View style={styles.tipRow}>
                                    <Ionicons name="checkmark-circle" size={16} color="#10B981" />
                                    <Text style={[styles.tipText, { color: textMain }]}>
                                        Hold the phone steady directly above the sheet — avoid moving while shooting.
                                    </Text>
                                </View>
                                <View style={styles.tipRow}>
                                    <Ionicons name="finger-print" size={16} color="#3B82F6" />
                                    <Text style={[styles.tipText, { color: textMain }]}>
                                        Tap anywhere on the answer boxes to instantly lock sharp focus.
                                    </Text>
                                </View>
                                <View style={styles.tipRow}>
                                    <Ionicons name="close-circle" size={16} color="#EF4444" />
                                    <Text style={[styles.tipText, { color: textMain }]}>
                                        Wait for "Focus OK" on the top bar before pressing the capture button.
                                    </Text>
                                </View>
                            </View>
                        </View>

                        {/* Rule 3: 4 Corner Markers */}
                        <View style={[styles.ruleCard, { backgroundColor: cardBg, borderColor: border }]}>
                            <View style={styles.ruleHeader}>
                                <View style={[styles.ruleBadge, { backgroundColor: "#10B98125" }]}>
                                    <Ionicons name="contract-outline" size={18} color="#059669" />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={[styles.ruleTitle, { color: textMain }]}>3. 4 Corner Markers Visible</Text>
                                    <Text style={[styles.ruleDesc, { color: textSub }]}>
                                        Tseki uses the 4 solid black corner squares to align answer boxes.
                                    </Text>
                                </View>
                            </View>

                            <View style={styles.tipsList}>
                                <View style={styles.tipRow}>
                                    <Ionicons name="checkmark-circle" size={16} color="#10B981" />
                                    <Text style={[styles.tipText, { color: textMain }]}>
                                        Align the 4 black printed squares inside the reticle corner targets.
                                    </Text>
                                </View>
                                <View style={styles.tipRow}>
                                    <Ionicons name="close-circle" size={16} color="#EF4444" />
                                    <Text style={[styles.tipText, { color: textMain }]}>
                                        Never let fingers or clips cover any of the 4 black corner squares.
                                    </Text>
                                </View>
                                <View style={styles.tipRow}>
                                    <Ionicons name="qr-code-outline" size={16} color="#3B82F6" />
                                    <Text style={[styles.tipText, { color: textMain }]}>
                                        Keep the top-right QR code clear and unobstructed.
                                    </Text>
                                </View>
                            </View>
                        </View>
                    </ScrollView>

                    {/* Bottom CTA */}
                    <View style={styles.footer}>
                        <TouchableOpacity
                            style={[styles.gotItBtn, { backgroundColor: accentColor }]}
                            onPress={onClose}
                            activeOpacity={0.8}
                        >
                            <Ionicons name="checkmark-outline" size={18} color="#FFFFFF" />
                            <Text style={styles.gotItBtnText}>Got It, Let's Scan!</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        justifyContent: "center",
        alignItems: "center",
        padding: 20,
    },
    card: {
        width: "100%",
        maxWidth: 440,
        maxHeight: "88%",
        borderRadius: 20,
        overflow: "hidden",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.3,
        shadowRadius: 20,
        elevation: 10,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 20,
        paddingTop: 18,
        paddingBottom: 14,
        borderBottomWidth: 1,
        borderBottomColor: "rgba(156, 163, 175, 0.2)",
    },
    headerLeft: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        flex: 1,
    },
    headerIconBg: {
        width: 38,
        height: 38,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
    },
    title: {
        fontSize: 16,
        fontWeight: "800",
    },
    subtitle: {
        fontSize: 12,
        fontWeight: "500",
        marginTop: 1,
    },
    closeBtn: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: "center",
        justifyContent: "center",
    },
    body: {
        paddingHorizontal: 16,
        paddingTop: 14,
    },
    ruleCard: {
        borderRadius: 14,
        padding: 14,
        marginBottom: 12,
        borderWidth: 1,
    },
    ruleHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        marginBottom: 10,
    },
    ruleBadge: {
        width: 32,
        height: 32,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
    },
    ruleTitle: {
        fontSize: 14,
        fontWeight: "700",
    },
    ruleDesc: {
        fontSize: 12,
        fontWeight: "500",
        marginTop: 2,
        lineHeight: 16,
    },
    tipsList: {
        gap: 8,
        borderTopWidth: 1,
        borderTopColor: "rgba(156, 163, 175, 0.15)",
        paddingTop: 10,
    },
    tipRow: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
    },
    tipText: {
        fontSize: 12,
        fontWeight: "500",
        flex: 1,
        lineHeight: 16,
    },
    footer: {
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderTopWidth: 1,
        borderTopColor: "rgba(156, 163, 175, 0.2)",
    },
    gotItBtn: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        paddingVertical: 13,
        borderRadius: 12,
    },
    gotItBtnText: {
        color: "#FFFFFF",
        fontSize: 15,
        fontWeight: "700",
    },
});
