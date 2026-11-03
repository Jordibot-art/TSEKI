import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
    Alert,
    AlertButton,
    AlertOptions,
    Modal,
    Pressable,
    ScrollView,
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
    | "destructive"
    | "info"
    | "confirm"
    | "success";

export interface CustomAlertModalProps {
    visible: boolean;
    onClose: () => void;
    title: string;
    message?: string;
    type?: AlertType;
    buttonText?: string;
    accentColor?: string;
    onConfirm?: () => void;
    buttons?: AlertButton[];
    cancelable?: boolean;
    onDismiss?: () => void;
}

const RED_PRIMARY = "#D93829";
const RED_HALO_LIGHT = "#FCE8E6";
const RED_HALO_DARK = "rgba(217, 56, 41, 0.22)";

const BLUE_PRIMARY = "#2563EB";
const BLUE_HALO_LIGHT = "#E8EDFB";
const BLUE_HALO_DARK = "rgba(37, 99, 235, 0.22)";

/**
 * Automatically determines whether an alert should use the Red Diamond ("!")
 * destructive/warning/error theme or the Blue Circle ("?" / "✓") confirm/info theme.
 */
function resolveAlertVisualVariant(
    title: string,
    type?: AlertType,
    buttons?: AlertButton[]
): {
    isRedVariant: boolean;
    isQuestion: boolean;
} {
    if (
        type === "error" ||
        type === "destructive" ||
        type === "network" ||
        type === "busy"
    ) {
        return { isRedVariant: true, isQuestion: false };
    }
    if (type === "success" || type === "confirm" || type === "info") {
        return {
            isRedVariant: false,
            isQuestion: (buttons && buttons.length >= 2) || title.trim().endsWith("?"),
        };
    }

    const hasDestructiveBtn = (buttons || []).some((b) => b.style === "destructive");
    if (hasDestructiveBtn) {
        return { isRedVariant: true, isQuestion: true };
    }

    const lowerTitle = (title || "").toLowerCase();
    const redKeywords = [
        "delete",
        "remove",
        "error",
        "failed",
        "fail",
        "missing",
        "mismatch",
        "weak",
        "too short",
        "invalid",
        "busy",
        "permission",
        "no data",
        "no students",
        "no quiz",
        "minimum",
        "long answers",
        "conflict",
        "log out",
        "logout",
        "warning",
        "expired",
        "limit",
    ];

    if (redKeywords.some((kw) => lowerTitle.includes(kw))) {
        return { isRedVariant: true, isQuestion: false };
    }

    const isQuestion =
        (buttons !== undefined && buttons.length >= 2) ||
        lowerTitle.endsWith("?") ||
        lowerTitle.includes("confirm") ||
        lowerTitle.includes("publish");

    return { isRedVariant: false, isQuestion };
}

export default function CustomAlertModal({
    visible,
    onClose,
    title,
    message,
    type,
    buttonText = "OK",
    onConfirm,
    buttons,
    cancelable = true,
    onDismiss,
}: CustomAlertModalProps) {
    const { darkMode } = useTheme();

    const cardBg = darkMode ? "#1F2937" : "#FFFFFF";
    const textMain = darkMode ? "#F9FAFB" : "#111827";
    const textSub = darkMode ? "#9CA3AF" : "#4B5563";
    const outlineBorder = darkMode ? "#4B5563" : "#D1D5DB";
    const outlineBg = darkMode ? "#1F2937" : "#FFFFFF";
    const frameBg = darkMode ? "rgba(255, 255, 255, 0.08)" : "rgba(255, 255, 255, 0.45)";
    const frameBorder = darkMode ? "rgba(255, 255, 255, 0.16)" : "rgba(255, 255, 255, 0.8)";

    const effectiveButtons: AlertButton[] =
        buttons && buttons.length > 0
            ? buttons
            : [
                  {
                      text: buttonText || "OK",
                      style: "default",
                      onPress: onConfirm,
                  },
              ];

    const { isRedVariant, isQuestion } = resolveAlertVisualVariant(
        title,
        type,
        effectiveButtons
    );

    const handleCloseCross = () => {
        const cancelBtn = effectiveButtons.find((b) => b.style === "cancel");
        onClose();
        setTimeout(() => {
            if (cancelBtn?.onPress) {
                cancelBtn.onPress();
            } else if (onDismiss) {
                onDismiss();
            }
        }, 40);
    };

    const handleBackdropPress = () => {
        if (!cancelable) return;
        handleCloseCross();
    };

    const handleButtonPress = (btn: AlertButton) => {
        onClose();
        if (btn.onPress) {
            setTimeout(() => {
                btn.onPress?.();
            }, 40);
        }
    };

    // For 2-button layouts, match the reference design ordering:
    // - Red / Destructive variant: [Destructive/Primary (Red), Cancel (Outlined)]
    // - Blue / Confirm variant:    [Cancel (Outlined), Confirm/Primary (Blue)]
    let orderedButtons = [...effectiveButtons];
    if (orderedButtons.length === 2) {
        const cancelIdx = orderedButtons.findIndex((b) => b.style === "cancel");
        const otherIdx = cancelIdx === 0 ? 1 : 0;
        if (cancelIdx !== -1) {
            const cancelBtn = orderedButtons[cancelIdx];
            const actionBtn = orderedButtons[otherIdx];
            const isActionDestructive =
                actionBtn.style === "destructive" || isRedVariant;
            if (isActionDestructive) {
                // Destructive action on the left, Cancel on the right
                orderedButtons = [actionBtn, cancelBtn];
            } else {
                // Cancel on the left, Confirm on the right
                orderedButtons = [cancelBtn, actionBtn];
            }
        }
    }

    const isTwoColumn = orderedButtons.length === 2;

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={handleCloseCross}
            statusBarTranslucent
        >
            <Pressable style={styles.overlay} onPress={handleBackdropPress}>
                <Pressable
                    style={[
                        styles.outerGlassFrame,
                        {
                            backgroundColor: frameBg,
                            borderColor: frameBorder,
                        },
                    ]}
                    onPress={(e) => e.stopPropagation()}
                >
                    <View style={[styles.card, { backgroundColor: cardBg }]}>
                        {/* Top-right Close (×) button */}
                        <TouchableOpacity
                            style={styles.closeBtn}
                            onPress={handleCloseCross}
                            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                            activeOpacity={0.7}
                        >
                            <Ionicons name="close" size={20} color={textMain} />
                        </TouchableOpacity>

                        {/* Top-Center Layered Icon Badge */}
                        {isRedVariant ? (
                            <View
                                style={[
                                    styles.badgeHalo,
                                    {
                                        backgroundColor: darkMode
                                            ? RED_HALO_DARK
                                            : RED_HALO_LIGHT,
                                    },
                                ]}
                            >
                                <View style={styles.redDiamondBadge}>
                                    <Text style={styles.redDiamondExclamation}>!</Text>
                                </View>
                            </View>
                        ) : (
                            <View
                                style={[
                                    styles.badgeHalo,
                                    {
                                        backgroundColor: darkMode
                                            ? BLUE_HALO_DARK
                                            : BLUE_HALO_LIGHT,
                                    },
                                ]}
                            >
                                <View style={styles.blueCircleBadge}>
                                    <Text style={styles.blueCircleSymbol}>
                                        {isQuestion ? "?" : "?"}
                                    </Text>
                                </View>
                            </View>
                        )}

                        {/* Title */}
                        <Text style={[styles.title, { color: textMain }]}>{title}</Text>

                        {/* Message */}
                        {Boolean(message && message.trim().length > 0) && (
                            <ScrollView
                                style={styles.messageScroll}
                                contentContainerStyle={styles.messageScrollContent}
                                bounces={false}
                                showsVerticalScrollIndicator={false}
                            >
                                <Text style={[styles.message, { color: textSub }]}>
                                    {message}
                                </Text>
                            </ScrollView>
                        )}

                        {/* Buttons */}
                        <View
                            style={[
                                styles.buttonsContainer,
                                isTwoColumn ? styles.buttonsRow : styles.buttonsColumn,
                            ]}
                        >
                            {orderedButtons.map((btn, idx) => {
                                const isCancel =
                                    btn.style === "cancel" && orderedButtons.length > 1;
                                const isDestructiveBtn =
                                    btn.style === "destructive" ||
                                    (!isCancel && isRedVariant);

                                const fillBg = isDestructiveBtn
                                    ? RED_PRIMARY
                                    : BLUE_PRIMARY;

                                return (
                                    <TouchableOpacity
                                        key={`${btn.text || "btn"}_${idx}`}
                                        style={[
                                            styles.btnBase,
                                            isTwoColumn && styles.btnFlex,
                                            isCancel
                                                ? {
                                                      backgroundColor: outlineBg,
                                                      borderWidth: 1,
                                                      borderColor: outlineBorder,
                                                  }
                                                : {
                                                      backgroundColor: fillBg,
                                                  },
                                        ]}
                                        onPress={() => handleButtonPress(btn)}
                                        activeOpacity={0.85}
                                    >
                                        <Text
                                            style={[
                                                styles.btnText,
                                                {
                                                    color: isCancel
                                                        ? textMain
                                                        : "#FFFFFF",
                                                },
                                            ]}
                                            numberOfLines={1}
                                        >
                                            {btn.text || "OK"}
                                        </Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </View>
                    </View>
                </Pressable>
            </Pressable>
        </Modal>
    );
}

// ── Global Alert.alert Interceptor & Host ─────────────────────────────────────

interface QueuedAlert {
    id: number;
    title: string;
    message?: string;
    buttons?: AlertButton[];
    options?: AlertOptions;
}

type AlertListener = (alert: QueuedAlert | null) => void;

const alertQueue: QueuedAlert[] = [];
let activeAlert: QueuedAlert | null = null;
let alertListener: AlertListener | null = null;
let nextAlertId = 1;
let interceptorInstalled = false;

function notifyListener() {
    alertListener?.(activeAlert);
}

function showNextInQueue() {
    if (alertQueue.length > 0) {
        activeAlert = alertQueue.shift()!;
    } else {
        activeAlert = null;
    }
    notifyListener();
}

export function enqueueGlobalAlert(
    title: string,
    message?: string,
    buttons?: AlertButton[],
    options?: AlertOptions
) {
    const item: QueuedAlert = {
        id: nextAlertId++,
        title: title || "",
        message,
        buttons,
        options,
    };

    if (!activeAlert) {
        activeAlert = item;
        notifyListener();
    } else {
        // Avoid pushing duplicate identical alerts back-to-back
        if (
            activeAlert.title === item.title &&
            activeAlert.message === item.message
        ) {
            return;
        }
        alertQueue.push(item);
    }
}

export function installGlobalAlertInterceptor() {
    if (interceptorInstalled) return;
    interceptorInstalled = true;

    try {
        Alert.alert = (
            title: string,
            message?: string,
            buttons?: AlertButton[],
            options?: AlertOptions
        ) => {
            enqueueGlobalAlert(title, message, buttons, options);
        };
    } catch (err) {
        console.warn("Could not install custom Alert.alert interceptor:", err);
    }
}

// Install immediately when this module is imported
installGlobalAlertInterceptor();

export function GlobalAlertHost() {
    const [current, setCurrent] = useState<QueuedAlert | null>(activeAlert);

    useEffect(() => {
        installGlobalAlertInterceptor();
        alertListener = (next) => {
            setCurrent(next);
        };
        if (activeAlert) {
            setCurrent(activeAlert);
        }
        return () => {
            if (alertListener) {
                alertListener = null;
            }
        };
    }, []);

    if (!current) return null;

    return (
        <CustomAlertModal
            visible={true}
            title={current.title}
            message={current.message}
            buttons={current.buttons}
            cancelable={current.options?.cancelable ?? true}
            onDismiss={current.options?.onDismiss}
            onClose={() => {
                showNextInQueue();
            }}
        />
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: "rgba(15, 23, 42, 0.45)",
        justifyContent: "center",
        alignItems: "center",
        paddingHorizontal: 22,
    },
    outerGlassFrame: {
        width: "100%",
        maxWidth: 380,
        borderRadius: 28,
        padding: 7,
        borderWidth: 1.5,
        shadowColor: "#0F172A",
        shadowOffset: { width: 0, height: 14 },
        shadowOpacity: 0.16,
        shadowRadius: 28,
        elevation: 16,
    },
    card: {
        width: "100%",
        borderRadius: 22,
        paddingTop: 28,
        paddingBottom: 22,
        paddingHorizontal: 22,
        alignItems: "center",
    },
    closeBtn: {
        position: "absolute",
        top: 14,
        right: 14,
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10,
    },
    badgeHalo: {
        width: 54,
        height: 54,
        borderRadius: 27,
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 14,
    },
    redDiamondBadge: {
        width: 24,
        height: 24,
        borderRadius: 6,
        backgroundColor: RED_PRIMARY,
        transform: [{ rotate: "45deg" }],
        alignItems: "center",
        justifyContent: "center",
    },
    redDiamondExclamation: {
        color: "#FFFFFF",
        fontSize: 14,
        fontWeight: "900",
        transform: [{ rotate: "-45deg" }],
        textAlign: "center",
        includeFontPadding: false,
    },
    blueCircleBadge: {
        width: 26,
        height: 26,
        borderRadius: 13,
        backgroundColor: BLUE_PRIMARY,
        alignItems: "center",
        justifyContent: "center",
    },
    blueCircleSymbol: {
        color: "#FFFFFF",
        fontSize: 15,
        fontWeight: "800",
        textAlign: "center",
        includeFontPadding: false,
    },
    title: {
        fontSize: 20,
        fontWeight: "800",
        textAlign: "center",
        marginBottom: 8,
        letterSpacing: -0.3,
        paddingHorizontal: 12,
    },
    messageScroll: {
        maxHeight: 220,
        width: "100%",
        marginBottom: 22,
    },
    messageScrollContent: {
        alignItems: "center",
    },
    message: {
        fontSize: 13.5,
        lineHeight: 20,
        textAlign: "center",
        paddingHorizontal: 6,
    },
    buttonsContainer: {
        width: "100%",
        marginTop: 2,
    },
    buttonsRow: {
        flexDirection: "row",
        gap: 12,
    },
    buttonsColumn: {
        flexDirection: "column",
        gap: 10,
    },
    btnBase: {
        height: 44,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 14,
    },
    btnFlex: {
        flex: 1,
    },
    btnText: {
        fontSize: 14,
        fontWeight: "700",
        letterSpacing: 0.1,
    },
});
