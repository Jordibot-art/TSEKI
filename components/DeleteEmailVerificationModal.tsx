import React, { useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    Keyboard,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    TouchableWithoutFeedback,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../context/ThemeContext";
import {
    extractTokenHashFromMagicLink,
    getLoggedInTeacherEmail,
    isValidOtpCode,
    normalizeOtpCode,
    sendDeleteVerificationOtp,
    verifyDeleteOtpCode,
} from "../lib/deleteVerificationService";

export interface DeleteEmailVerificationModalProps {
    visible: boolean;
    entityType: "classroom" | "student";
    targetName: string;
    description: string;
    confirmActionLabel?: string;
    onClose: () => void;
    onVerifiedDelete: () => Promise<void>;
}

const BRAND_ORANGE = "#EA580C";

export function DeleteEmailVerificationModal({
    visible,
    entityType,
    targetName,
    description,
    confirmActionLabel,
    onClose,
    onVerifiedDelete,
}: DeleteEmailVerificationModalProps) {
    const { darkMode } = useTheme();
    const insets = useSafeAreaInsets();

    const [step, setStep] = useState<"confirm" | "otp">("confirm");
    const [inputMode, setInputMode] = useState<"otp" | "link">("otp");
    const [accountEmail, setAccountEmail] = useState<string | null>(null);
    const [loadingEmail, setLoadingEmail] = useState<boolean>(false);
    const [otpCode, setOtpCode] = useState<string>("");
    const [linkInput, setLinkInput] = useState<string>("");
    const [isOtpFocused, setIsOtpFocused] = useState<boolean>(false);
    const [sendingCode, setSendingCode] = useState<boolean>(false);
    const [verifyingAndDeleting, setVerifyingAndDeleting] = useState<boolean>(false);
    const [resendCountdown, setResendCountdown] = useState<number>(0);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [statusNote, setStatusNote] = useState<string | null>(null);

    const hiddenOtpInputRef = useRef<TextInput>(null);

    useEffect(() => {
        if (!visible) {
            setStep("confirm");
            setInputMode("otp");
            setOtpCode("");
            setLinkInput("");
            setIsOtpFocused(false);
            setSendingCode(false);
            setVerifyingAndDeleting(false);
            setResendCountdown(0);
            setErrorMessage(null);
            setStatusNote(null);
            return;
        }

        let cancelled = false;
        setLoadingEmail(true);
        setErrorMessage(null);
        setStatusNote(null);

        getLoggedInTeacherEmail()
            .then((email) => {
                if (cancelled) return;
                setAccountEmail(email);
                if (!email) {
                    setErrorMessage("Could not find your login email. Please sign in again.");
                }
            })
            .finally(() => {
                if (!cancelled) setLoadingEmail(false);
            });

        return () => {
            cancelled = true;
        };
    }, [visible]);

    useEffect(() => {
        if (!visible || step !== "otp" || resendCountdown <= 0) return;
        const timer = setTimeout(() => {
            setResendCountdown((prev) => Math.max(0, prev - 1));
        }, 1000);
        return () => clearTimeout(timer);
    }, [visible, step, resendCountdown]);

    const busy = sendingCode || verifyingAndDeleting;
    const canSubmitVerification =
        inputMode === "otp"
            ? isValidOtpCode(otpCode)
            : Boolean(extractTokenHashFromMagicLink(linkInput));

    async function handleSendCode(isResend = false) {
        if (!accountEmail || busy) return;
        if (isResend && resendCountdown > 0) return;

        setSendingCode(true);
        setErrorMessage(null);
        setStatusNote(null);

        const res = await sendDeleteVerificationOtp(accountEmail);
        setSendingCode(false);

        if (!res.sent) {
            setErrorMessage(res.error || "Failed to send verification email.");
            return;
        }

        setStep("otp");
        setOtpCode("");
        setLinkInput("");
        setResendCountdown(res.cooldownSeconds || 60);

        if (res.alreadyRecentlySent) {
            setStatusNote("A code was just sent. Enter it below or wait to resend.");
        } else if (isResend) {
            setStatusNote("New code sent.");
        }

        if (inputMode === "otp") {
            setTimeout(() => {
                hiddenOtpInputRef.current?.focus();
            }, 180);
        }
    }

    async function handleVerifyAndDelete() {
        if (!accountEmail || busy) return;
        const payload = inputMode === "otp" ? normalizeOtpCode(otpCode) : linkInput.trim();
        if (!canSubmitVerification) {
            setErrorMessage(
                inputMode === "otp"
                    ? "Enter all 6 digits from your email."
                    : "Paste the complete sign-in link from your email."
            );
            return;
        }

        Keyboard.dismiss();
        setVerifyingAndDeleting(true);
        setErrorMessage(null);

        try {
            const verification = await verifyDeleteOtpCode(accountEmail, payload);
            if (!verification.verified) {
                setErrorMessage(
                    verification.error || "Code is invalid or expired. Try again."
                );
                setVerifyingAndDeleting(false);
                return;
            }

            await onVerifiedDelete();
        } catch (err: any) {
            setErrorMessage(err?.message || "Could not complete deletion. Try again.");
        } finally {
            setVerifyingAndDeleting(false);
        }
    }

    const sheetBg = darkMode ? "#111827" : "#FFFFFF";
    const fieldBg = darkMode ? "#1E293B" : "#F8FAFC";
    const border = darkMode ? "#334155" : "#E2E8F0";
    const subtleDivider = darkMode ? "#1F2937" : "#F1F5F9";
    const textMain = darkMode ? "#F8FAFC" : "#0F172A";
    const textSub = darkMode ? "#94A3B8" : "#64748B";
    const disabledBtnBg = darkMode ? "#1E293B" : "#E2E8F0";
    const disabledBtnText = darkMode ? "#64748B" : "#94A3B8";

    const actionVerb = entityType === "classroom" ? "Delete" : "Remove";
    const submitLabel = confirmActionLabel || `Confirm ${actionVerb}`;

    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            statusBarTranslucent
            onRequestClose={() => !busy && onClose()}
        >
            <KeyboardAvoidingView
                style={styles.root}
                behavior={Platform.OS === "ios" ? "padding" : undefined}
            >
                <TouchableWithoutFeedback onPress={() => !busy && onClose()}>
                    <View style={styles.backdrop} />
                </TouchableWithoutFeedback>

                <View
                    style={[
                        styles.sheet,
                        {
                            backgroundColor: sheetBg,
                            paddingBottom: Math.max(insets.bottom, 18),
                        },
                    ]}
                >
                    {/* Drag Handle */}
                    <View
                        style={[
                            styles.dragHandle,
                            { backgroundColor: darkMode ? "#334155" : "#CBD5E1" },
                        ]}
                    />

                    {/* Top Row */}
                    <View style={styles.topRow}>
                        {step === "otp" ? (
                            <TouchableOpacity
                                style={[
                                    styles.navIconBtn,
                                    { backgroundColor: fieldBg, borderColor: border },
                                ]}
                                onPress={() => {
                                    if (!busy) {
                                        setStep("confirm");
                                        setErrorMessage(null);
                                        setStatusNote(null);
                                    }
                                }}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            >
                                <Ionicons name="chevron-back" size={18} color={textMain} />
                            </TouchableOpacity>
                        ) : (
                            <View style={{ width: 32 }} />
                        )}

                        <TouchableOpacity
                            style={[
                                styles.navIconBtn,
                                { backgroundColor: fieldBg, borderColor: border },
                            ]}
                            onPress={() => !busy && onClose()}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                            <Ionicons name="close" size={18} color={textSub} />
                        </TouchableOpacity>
                    </View>

                    {step === "confirm" ? (
                        <View style={styles.body}>
                            <Text style={[styles.heading, { color: textMain }]}>
                                {actionVerb} {targetName}?
                            </Text>
                            <Text style={[styles.copy, { color: textSub }]}>
                                {description}
                            </Text>

                            <View style={[styles.divider, { backgroundColor: subtleDivider }]} />

                            <Text style={[styles.microLabel, { color: textSub }]}>
                                LOGIN EMAIL VERIFICATION
                            </Text>
                            {loadingEmail ? (
                                <ActivityIndicator
                                    size="small"
                                    color={textSub}
                                    style={{ alignSelf: "flex-start", marginVertical: 8 }}
                                />
                            ) : (
                                <Text
                                    style={[styles.emailText, { color: textMain }]}
                                    numberOfLines={1}
                                >
                                    {accountEmail || "No email on file"}
                                </Text>
                            )}
                            <Text style={[styles.caption, { color: textSub }]}>
                                We will send a 6-digit code to this email before deleting.
                            </Text>

                            {errorMessage && (
                                <Text style={styles.inlineError}>{errorMessage}</Text>
                            )}

                            <View style={styles.actionsRow}>
                                <TouchableOpacity
                                    style={[
                                        styles.secondaryBtn,
                                        { borderColor: border, backgroundColor: sheetBg },
                                    ]}
                                    onPress={onClose}
                                    disabled={busy}
                                    activeOpacity={0.75}
                                >
                                    <Text style={[styles.secondaryBtnText, { color: textMain }]}>
                                        Cancel
                                    </Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={[
                                        styles.primaryBtn,
                                        {
                                            backgroundColor:
                                                !accountEmail || loadingEmail
                                                    ? disabledBtnBg
                                                    : darkMode
                                                    ? "#F8FAFC"
                                                    : "#0F172A",
                                        },
                                    ]}
                                    onPress={() => handleSendCode(false)}
                                    disabled={!accountEmail || loadingEmail || busy}
                                    activeOpacity={0.85}
                                >
                                    {sendingCode ? (
                                        <View style={styles.loadingInline}>
                                            <ActivityIndicator
                                                size="small"
                                                color={darkMode ? "#0F172A" : "#FFFFFF"}
                                            />
                                            <Text
                                                style={[
                                                    styles.primaryBtnText,
                                                    { color: darkMode ? "#0F172A" : "#FFFFFF" },
                                                ]}
                                            >
                                                Sending...
                                            </Text>
                                        </View>
                                    ) : (
                                        <Text
                                            style={[
                                                styles.primaryBtnText,
                                                {
                                                    color:
                                                        !accountEmail || loadingEmail
                                                            ? disabledBtnText
                                                            : darkMode
                                                            ? "#0F172A"
                                                            : "#FFFFFF",
                                                },
                                            ]}
                                        >
                                            Send Code
                                        </Text>
                                    )}
                                </TouchableOpacity>
                            </View>
                        </View>
                    ) : (
                        <View style={styles.body}>
                            <Text style={[styles.heading, { color: textMain }]}>
                                {inputMode === "otp" ? "Enter 6-digit code" : "Paste email link"}
                            </Text>
                            <Text style={[styles.copy, { color: textSub }]}>
                                {inputMode === "otp" ? "Sent to " : "Copy the sign-in link sent to "}
                                <Text style={{ fontWeight: "600", color: textMain }}>
                                    {accountEmail}
                                </Text>
                                {statusNote ? ` · ${statusNote}` : ""}
                            </Text>

                            {inputMode === "otp" ? (
                                <View style={styles.otpSection}>
                                    <TextInput
                                        ref={hiddenOtpInputRef}
                                        style={styles.hiddenOtpInput}
                                        value={otpCode}
                                        onChangeText={(text) => {
                                            // If user pastes a full Supabase magic link directly into the OTP field, switch cleanly
                                            if (extractTokenHashFromMagicLink(text)) {
                                                setLinkInput(text.trim());
                                                setInputMode("link");
                                                setErrorMessage(null);
                                                return;
                                            }
                                            setOtpCode(normalizeOtpCode(text));
                                            if (errorMessage) setErrorMessage(null);
                                        }}
                                        keyboardType="number-pad"
                                        textContentType="oneTimeCode"
                                        autoComplete="one-time-code"
                                        caretHidden
                                        onFocus={() => setIsOtpFocused(true)}
                                        onBlur={() => setIsOtpFocused(false)}
                                        editable={!busy}
                                    />

                                    <Pressable
                                        style={styles.otpGridRow}
                                        onPress={() => hiddenOtpInputRef.current?.focus()}
                                    >
                                        {[0, 1, 2, 3, 4, 5].map((idx) => {
                                            const digit = otpCode[idx] || "";
                                            const isCurrent =
                                                isOtpFocused &&
                                                (otpCode.length === idx ||
                                                    (idx === 5 && otpCode.length === 6));
                                            const isFilled = digit.length > 0;

                                            return (
                                                <View
                                                    key={idx}
                                                    style={[
                                                        styles.otpCell,
                                                        {
                                                            backgroundColor: isFilled
                                                                ? sheetBg
                                                                : fieldBg,
                                                            borderColor: isCurrent
                                                                ? BRAND_ORANGE
                                                                : isFilled
                                                                ? darkMode
                                                                    ? "#94A3B8"
                                                                    : "#0F172A"
                                                                : border,
                                                            borderWidth: isCurrent ? 1.8 : 1.2,
                                                        },
                                                    ]}
                                                >
                                                    <Text
                                                        style={[
                                                            styles.otpDigit,
                                                            { color: textMain },
                                                        ]}
                                                    >
                                                        {digit}
                                                    </Text>
                                                    {isCurrent && otpCode.length < 6 && (
                                                        <View style={styles.otpCursor} />
                                                    )}
                                                </View>
                                            );
                                        })}
                                    </Pressable>
                                </View>
                            ) : (
                                <View style={styles.linkSection}>
                                    <TextInput
                                        style={[
                                            styles.linkInput,
                                            {
                                                backgroundColor: fieldBg,
                                                borderColor: border,
                                                color: textMain,
                                            },
                                        ]}
                                        value={linkInput}
                                        onChangeText={(t) => {
                                            setLinkInput(t);
                                            if (errorMessage) setErrorMessage(null);
                                        }}
                                        placeholder="https://...supabase.co/auth/v1/verify?token=..."
                                        placeholderTextColor={textSub}
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        editable={!busy}
                                    />
                                </View>
                            )}

                            {/* Quiet Resend + Fallback Row */}
                            <View style={styles.metaLinksRow}>
                                {resendCountdown > 0 ? (
                                    <Text style={[styles.metaLinkMuted, { color: textSub }]}>
                                        Resend in {resendCountdown}s
                                    </Text>
                                ) : (
                                    <TouchableOpacity
                                        onPress={() => handleSendCode(true)}
                                        disabled={busy}
                                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                    >
                                        <Text style={styles.resendAction}>
                                            {sendingCode ? "Sending..." : "Resend code"}
                                        </Text>
                                    </TouchableOpacity>
                                )}

                                <TouchableOpacity
                                    onPress={() => {
                                        setInputMode((m) => (m === "otp" ? "link" : "otp"));
                                        setErrorMessage(null);
                                    }}
                                    disabled={busy}
                                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                >
                                    <Text style={[styles.switchModeText, { color: textSub }]}>
                                        {inputMode === "otp"
                                            ? "Got a link instead?"
                                            : "Use 6-digit code"}
                                    </Text>
                                </TouchableOpacity>
                            </View>

                            {errorMessage && (
                                <Text style={styles.inlineError}>{errorMessage}</Text>
                            )}

                            <View style={styles.actionsRow}>
                                <TouchableOpacity
                                    style={[
                                        styles.secondaryBtn,
                                        { borderColor: border, backgroundColor: sheetBg },
                                    ]}
                                    onPress={onClose}
                                    disabled={busy}
                                    activeOpacity={0.75}
                                >
                                    <Text style={[styles.secondaryBtnText, { color: textMain }]}>
                                        Cancel
                                    </Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={[
                                        styles.primaryBtn,
                                        {
                                            backgroundColor: canSubmitVerification
                                                ? "#DC2626"
                                                : disabledBtnBg,
                                        },
                                    ]}
                                    onPress={handleVerifyAndDelete}
                                    disabled={!canSubmitVerification || busy}
                                    activeOpacity={0.85}
                                >
                                    {verifyingAndDeleting ? (
                                        <View style={styles.loadingInline}>
                                            <ActivityIndicator size="small" color="#FFFFFF" />
                                            <Text
                                                style={[
                                                    styles.primaryBtnText,
                                                    { color: "#FFFFFF" },
                                                ]}
                                            >
                                                Verifying...
                                            </Text>
                                        </View>
                                    ) : (
                                        <Text
                                            style={[
                                                styles.primaryBtnText,
                                                {
                                                    color: canSubmitVerification
                                                        ? "#FFFFFF"
                                                        : disabledBtnText,
                                                },
                                            ]}
                                        >
                                            {submitLabel}
                                        </Text>
                                    )}
                                </TouchableOpacity>
                            </View>
                        </View>
                    )}
                </View>
            </KeyboardAvoidingView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
        justifyContent: "flex-end",
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: "rgba(15, 23, 42, 0.48)",
    },
    sheet: {
        width: "100%",
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingHorizontal: 22,
        paddingTop: 10,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.12,
        shadowRadius: 16,
        elevation: 16,
    },
    dragHandle: {
        width: 36,
        height: 4,
        borderRadius: 999,
        alignSelf: "center",
        marginBottom: 10,
    },
    topRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 6,
    },
    navIconBtn: {
        width: 32,
        height: 32,
        borderRadius: 16,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    body: {
        paddingTop: 4,
    },
    heading: {
        fontSize: 20,
        fontWeight: "800",
        letterSpacing: -0.3,
        marginBottom: 8,
    },
    copy: {
        fontSize: 14,
        lineHeight: 20,
    },
    divider: {
        height: 1,
        marginVertical: 16,
    },
    microLabel: {
        fontSize: 11,
        fontWeight: "700",
        letterSpacing: 0.6,
        marginBottom: 4,
    },
    emailText: {
        fontSize: 15,
        fontWeight: "700",
    },
    caption: {
        fontSize: 12.5,
        lineHeight: 18,
        marginTop: 4,
    },
    otpSection: {
        position: "relative",
        marginTop: 22,
        marginBottom: 14,
    },
    hiddenOtpInput: {
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        opacity: 0.01,
        zIndex: 10,
    },
    otpGridRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        gap: 8,
    },
    otpCell: {
        flex: 1,
        height: 54,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
    },
    otpDigit: {
        fontSize: 22,
        fontWeight: "800",
    },
    otpCursor: {
        position: "absolute",
        width: 2,
        height: 20,
        borderRadius: 1,
        backgroundColor: BRAND_ORANGE,
    },
    linkSection: {
        marginTop: 18,
        marginBottom: 14,
    },
    linkInput: {
        height: 46,
        borderRadius: 12,
        borderWidth: 1,
        paddingHorizontal: 12,
        fontSize: 13,
    },
    metaLinksRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 6,
    },
    metaLinkMuted: {
        fontSize: 12.5,
        fontWeight: "500",
    },
    resendAction: {
        fontSize: 13,
        fontWeight: "700",
        color: BRAND_ORANGE,
    },
    switchModeText: {
        fontSize: 12.5,
        fontWeight: "600",
        textDecorationLine: "underline",
    },
    inlineError: {
        fontSize: 12.5,
        fontWeight: "600",
        color: "#DC2626",
        marginTop: 10,
        lineHeight: 18,
    },
    actionsRow: {
        flexDirection: "row",
        gap: 10,
        marginTop: 20,
    },
    secondaryBtn: {
        flex: 1,
        height: 46,
        borderRadius: 12,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    secondaryBtnText: {
        fontSize: 14.5,
        fontWeight: "600",
    },
    primaryBtn: {
        flex: 1.3,
        height: 46,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
    },
    primaryBtnText: {
        fontSize: 14.5,
        fontWeight: "700",
    },
    loadingInline: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
});
