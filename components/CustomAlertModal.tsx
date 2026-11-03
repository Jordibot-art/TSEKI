import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
    Modal,
    Pressable,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { useTheme } from "../context/ThemeContext";

export type AlertType =
    | "busy"
    | "network"
    | "limit"
    | "cooldown"
    | "error"
    | "info"
    | "success";

interface CustomAlertModalProps {
    visible: boolean;
    onClose: () => void;
    title: string;
    message: string;
    type?: AlertType;
    buttonText?: string;
    accentColor?: string;
    onConfirm?: () => void;
}

export default function CustomAlertModal({
    visible,
    onClose,
    title,
    message,
    type = "info",
    buttonText = "OK",
    accentColor = "#4F46E5",
    onConfirm,
}: CustomAlertModalProps) {
    const { darkMode } = useTheme();

    const cardBg = darkMode ? "#1F2937" : "#FFFFFF";
    const textMain = darkMode ? "#F9FAFB" : "#111827";
    const textSub = darkMode ? "#9CA3AF" : "#6B7280";
    const borderColor = darkMode ? "#374151" : "#F3F4F6";

    // Configure icon and badge color based on alert type
    const getBadgeConfig = () => {
        switch (type) {
            case "busy":
                return {
                    icon: "hourglass-outline" as const,
                    iconColor: "#D97706",
                    badgeBg: darkMode ? "rgba(217, 119, 6, 0.18)" : "#FEF3C7",
                    glowColor: "rgba(217, 119, 6, 0.2)",
                };
            case "network":
                return {
                    icon: "cloud-offline-outline" as const,
                    iconColor: "#EF4444",
                    badgeBg: darkMode ? "rgba(239, 68, 68, 0.18)" : "#FEE2E2",
                    glowColor: "rgba(239, 68, 68, 0.2)",
                };
            case "limit":
                return {
                    icon: "sparkles" as const,
                    iconColor: accentColor,
                    badgeBg: darkMode ? "rgba(139, 92, 246, 0.18)" : "#EDE9FE",
                    glowColor: accentColor + "33",
                };
            case "cooldown":
                return {
                    icon: "timer-outline" as const,
                    iconColor: "#4F46E5",
                    badgeBg: darkMode ? "rgba(79, 70, 229, 0.18)" : "#EEF2FF",
                    glowColor: "rgba(79, 70, 229, 0.2)",
                };
            case "error":
                return {
                    icon: "alert-circle-outline" as const,
                    iconColor: "#DC2626",
                    badgeBg: darkMode ? "rgba(220, 38, 38, 0.18)" : "#FEE2E2",
                    glowColor: "rgba(220, 38, 38, 0.2)",
                };
            case "success":
                return {
                    icon: "checkmark-circle-outline" as const,
                    iconColor: "#10B981",
                    badgeBg: darkMode ? "rgba(16, 185, 129, 0.18)" : "#D1FAE5",
                    glowColor: "rgba(16, 185, 129, 0.2)",
                };
            case "info":
            default:
                return {
                    icon: "information-circle-outline" as const,
                    iconColor: accentColor,
                    badgeBg: darkMode ? "rgba(79, 70, 229, 0.18)" : "#EEF2FF",
                    glowColor: accentColor + "28",
                };
        }
    };

    const badge = getBadgeConfig();

    const handlePressButton = () => {
        onClose();
        if (onConfirm) {
            onConfirm();
        }
    };

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onClose}
            statusBarTranslucent
        >
            <Pressable style={styles.overlay} onPress={onClose}>
                <Pressable
                    style={[
                        styles.card,
                        {
                            backgroundColor: cardBg,
                            borderColor,
                        },
                    ]}
                    onPress={(e) => e.stopPropagation()}
                >
                    {/* Top right close button */}
                    <TouchableOpacity
                        style={styles.closeBtn}
                        onPress={onClose}
                        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                        activeOpacity={0.7}
                    >
                        <Ionicons name="close" size={20} color={textSub} />
                    </TouchableOpacity>

                    {/* Centered Circular Icon Badge */}
                    <View style={[styles.badgeOuterGlow, { backgroundColor: badge.glowColor }]}>
                        <View style={[styles.badge, { backgroundColor: badge.badgeBg }]}>
                            <Ionicons name={badge.icon} size={28} color={badge.iconColor} />
                        </View>
                    </View>

                    {/* Centered Title */}
                    <Text style={[styles.title, { color: textMain }]}>{title}</Text>

                    {/* Centered Message */}
                    <Text style={[styles.message, { color: textSub }]}>{message}</Text>

                    {/* Single Full-Width Action Button (Classroom / System Accent) */}
                    <TouchableOpacity
                        style={[
                            styles.actionBtn,
                            { backgroundColor: accentColor },
                        ]}
                        onPress={handlePressButton}
                        activeOpacity={0.88}
                    >
                        <Text style={styles.actionBtnText}>{buttonText}</Text>
                    </TouchableOpacity>
                </Pressable>
            </Pressable>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: "rgba(0, 0, 0, 0.52)",
        justifyContent: "center",
        alignItems: "center",
        paddingHorizontal: 24,
    },
    card: {
        width: "100%",
        maxWidth: 360,
        borderRadius: 24,
        paddingTop: 28,
        paddingBottom: 24,
        paddingHorizontal: 22,
        alignItems: "center",
        borderWidth: 1,
        // Elevation & Shadows matching clean modern modal design
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.16,
        shadowRadius: 22,
        elevation: 12,
    },
    closeBtn: {
        position: "absolute",
        top: 16,
        right: 16,
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: "center",
        justifyContent: "center",
    },
    badgeOuterGlow: {
        width: 68,
        height: 68,
        borderRadius: 34,
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 14,
    },
    badge: {
        width: 54,
        height: 54,
        borderRadius: 27,
        alignItems: "center",
        justifyContent: "center",
    },
    title: {
        fontSize: 19,
        fontWeight: "700",
        textAlign: "center",
        marginBottom: 8,
        letterSpacing: -0.2,
    },
    message: {
        fontSize: 14,
        lineHeight: 22,
        textAlign: "center",
        marginBottom: 24,
        paddingHorizontal: 4,
    },
    actionBtn: {
        alignSelf: "stretch",
        height: 48,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 4,
        elevation: 2,
    },
    actionBtnText: {
        color: "#FFFFFF",
        fontSize: 15,
        fontWeight: "600",
        letterSpacing: 0.2,
    },
});
