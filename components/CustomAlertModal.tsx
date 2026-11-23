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
    | "warning"
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

const BRAND_ORANGE = "#EA580C";
const RED_DESTRUCTIVE = "#DC2626";
const AMBER_WARNING = "#D97706";

function resolveVariant(
    title: string,
    type?: AlertType,
    buttons?: AlertButton[]
): {
    isDestructive: boolean;
    isWarning: boolean;
} {
    if (type === "destructive" || type === "error" || type === "network" || type === "busy") {
        return { isDestructive: true, isWarning: false };
    }
    if (type === "warning" || type === "limit" || type === "cooldown") {
        return { isDestructive: false, isWarning: true };
    }

    const hasDestructiveBtn = (buttons || []).some((b) => b.style === "destructive");
    if (hasDestructiveBtn) {
        return { isDestructive: true, isWarning: false };
    }

    const lowerTitle = (title || "").toLowerCase();
    const destructiveKeywords = [
        "delete",
        "remove",
        "discard",
        "failed",
        "fail",
        "missing",
        "log out",
        "logout",
        "conflict",
        "trim",
    ];

    if (destructiveKeywords.some((kw) => lowerTitle.includes(kw))) {
        return { isDestructive: true, isWarning: false };
    }

    const warningKeywords = [
        "warning",
        "caution",
        "limit",
        "at-risk",
        "busy",
        "permission",
        "long answers",
    ];

    if (warningKeywords.some((kw) => lowerTitle.includes(kw))) {
        return { isDestructive: false, isWarning: true };
    }

    return { isDestructive: false, isWarning: false };
}

export default function CustomAlertModal({
    visible,
    onClose,
    title,
    message,
    type,
    buttonText = "OK",
    accentColor,
    onConfirm,
    buttons,
    cancelable = true,
    onDismiss,
}: CustomAlertModalProps) {
    const { darkMode } = useTheme();

    const cardBg = darkMode ? "#18181B" : "#FFFFFF";
    const textMain = darkMode ? "#FAFAFA" : "#18181B";
    const textSub = darkMode ? "#A1A1AA" : "#71717A";
    const border = darkMode ? "#27272A" : "#E4E4E7";
    const cancelBorder = darkMode ? "#3F3F46" : "#D4D4D8";
    const cancelBg = darkMode ? "#27272A" : "#FFFFFF";
    const cancelText = darkMode ? "#FAFAFA" : "#18181B";
    const calloutBg = darkMode ? "#09090B" : "#FAFAFA";

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

    const { isDestructive, isWarning } = resolveVariant(title, type, effectiveButtons);

    const handleClose = () => {
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
        handleClose();
    };

    const handleButtonPress = (btn: AlertButton) => {
        onClose();
        if (btn.onPress) {
            setTimeout(() => {
                btn.onPress?.();
            }, 40);
        }
    };

    // Standard 2-button ordering: [Cancel (left), Primary/Action (right)]
    let orderedButtons = [...effectiveButtons];
    if (orderedButtons.length === 2) {
        const cancelIdx = orderedButtons.findIndex((b) => b.style === "cancel");
        if (cancelIdx !== -1) {
            const cancelBtn = orderedButtons[cancelIdx];
            const actionBtn = orderedButtons[cancelIdx === 0 ? 1 : 0];
            orderedButtons = [cancelBtn, actionBtn];
        }
    }

    const isTwoColumn = orderedButtons.length === 2;

    // Parse message into body text and optional helper note
    let bodyText = (message || "").trim();
    let noteText: string | null = null;

    const trailingParen = bodyText.match(/\n*\(([^)]+)\)\s*$/);
    if (trailingParen) {
        noteText = trailingParen[1].trim();
        bodyText = bodyText.replace(trailingParen[0], "").trim();
    } else {
        const noteLine = bodyText.match(/\n+(?:Note:\s*|\*Note:\*\s*)(.+)$/i);
        if (noteLine) {
            noteText = noteLine[1].trim();
            bodyText = bodyText.replace(noteLine[0], "").trim();
        }
    }

    if (noteText) {
        if (
            noteText.toLowerCase().includes("single-question regeneration does not consume") ||
            noteText.toLowerCase().includes("does not consume your daily quiz quota")
        ) {
            noteText = "Does not use your daily AI generation quota.";
        }
    }

    function getActionBtnBg(btn: AlertButton): string {
        if (btn.style === "destructive" || isDestructive) {
            return RED_DESTRUCTIVE;
        }
        if (isWarning) {
            return AMBER_WARNING;
        }
        if (accentColor && accentColor !== "#2563EB") {
            return accentColor;
        }
        return BRAND_ORANGE;
    }

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={handleClose}
            statusBarTranslucent
        >
            <Pressable style={styles.overlay} onPress={handleBackdropPress}>
                <Pressable
                    style={[
                        styles.card,
                        {
                            backgroundColor: cardBg,
                            borderColor: border,
                        },
                    ]}
                    onPress={(e) => e.stopPropagation()}
                >
                    {/* Title — Left-aligned, 17px semibold */}
                    <Text style={[styles.title, { color: textMain }]}>{title}</Text>

                    {/* Body — Left-aligned, 14px regular */}
                    {Boolean(bodyText && bodyText.length > 0) && (
                        <ScrollView
                            style={styles.messageScroll}
                            contentContainerStyle={styles.messageScrollContent}
                            bounces={false}
                            showsVerticalScrollIndicator={false}
                        >
                            <Text style={[styles.body, { color: textSub }]}>{bodyText}</Text>
                        </ScrollView>
                    )}

                    {/* Optional Note Callout — Compact subtle info strip */}
                    {Boolean(noteText && noteText.length > 0) && (
                        <View
                            style={[
                                styles.infoCallout,
                                {
                                    backgroundColor: calloutBg,
                                    borderColor: border,
                                },
                            ]}
                        >
                            <Ionicons
                                name="information-circle-outline"
                                size={14}
                                color={textSub}
                                style={{ marginRight: 6, marginTop: 1 }}
                            />
                            <Text style={[styles.infoCalloutText, { color: textSub }]}>
                                {noteText}
                            </Text>
                        </View>
                    )}

                    {/* Footer Buttons — Cancel on Left, Action on Right */}
                    <View
                        style={[
                            styles.buttonsContainer,
                            isTwoColumn ? styles.buttonsRow : styles.buttonsColumn,
                        ]}
                    >
                        {orderedButtons.map((btn, idx) => {
                            const isCancel = btn.style === "cancel" && orderedButtons.length > 1;
                            const btnBg = isCancel ? cancelBg : getActionBtnBg(btn);
                            const btnTextColor = isCancel ? cancelText : "#FFFFFF";

                            return (
                                <TouchableOpacity
                                    key={`${btn.text || "btn"}_${idx}`}
                                    style={[
                                        styles.btnBase,
                                        isTwoColumn && styles.btnFlex,
                                        isCancel
                                            ? {
                                                  backgroundColor: btnBg,
                                                  borderWidth: 1,
                                                  borderColor: cancelBorder,
                                              }
                                            : {
                                                  backgroundColor: btnBg,
                                              },
                                    ]}
                                    onPress={() => handleButtonPress(btn)}
                                    activeOpacity={0.85}
                                >
                                    <Text
                                        style={[
                                            styles.btnText,
                                            {
                                                color: btnTextColor,
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
        backgroundColor: "rgba(9, 9, 11, 0.45)",
        justifyContent: "center",
        alignItems: "center",
        paddingHorizontal: 20,
    },
    card: {
        width: "88%",
        maxWidth: 360,
        borderRadius: 18,
        padding: 22,
        borderWidth: 1,
        shadowColor: "#000000",
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.12,
        shadowRadius: 20,
        elevation: 8,
    },
    title: {
        fontSize: 18,
        fontWeight: "700",
        textAlign: "left",
        marginBottom: 8,
        letterSpacing: -0.3,
    },
    messageScroll: {
        maxHeight: 220,
        width: "100%",
    },
    messageScrollContent: {
        alignItems: "stretch",
    },
    body: {
        fontSize: 14.5,
        lineHeight: 21,
        textAlign: "left",
    },
    infoCallout: {
        flexDirection: "row",
        alignItems: "flex-start",
        borderRadius: 10,
        borderWidth: 1,
        paddingHorizontal: 11,
        paddingVertical: 9,
        marginTop: 12,
    },
    infoCalloutText: {
        fontSize: 12.5,
        lineHeight: 18,
        flex: 1,
        textAlign: "left",
    },
    buttonsContainer: {
        width: "100%",
        marginTop: 22,
    },
    buttonsRow: {
        flexDirection: "row",
        gap: 10,
    },
    buttonsColumn: {
        flexDirection: "column",
        gap: 8,
    },
    btnBase: {
        height: 46,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 16,
    },
    btnFlex: {
        flex: 1,
    },
    btnText: {
        fontSize: 15,
        fontWeight: "600",
    },
});
