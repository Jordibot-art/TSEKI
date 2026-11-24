import React, { useEffect, useRef, useState } from "react";
import {
    Animated,
    Dimensions,
    Easing,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    StyleProp,
    StyleSheet,
    View,
    ViewStyle,
} from "react-native";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");

export const TRANSITION_HANDOFF_DELAY_MS = 190;
export const TRANSITION_EXIT_WAIT_MS = 210;

export function waitForTransition(ms: number = TRANSITION_HANDOFF_DELAY_MS): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface SmoothCenterModalProps {
    visible: boolean;
    onRequestClose?: () => void;
    onBackdropPress?: () => void;
    backdropColor?: string;
    overlayStyle?: StyleProp<ViewStyle>;
    cardStyle?: StyleProp<ViewStyle>;
    children: React.ReactNode;
}

/**
 * Full-screen centered modal wrapper with 60fps native-driver backdrop fade + subtle
 * spring scale/lift entrance and smooth exit unmount so inner animations never cut abruptly.
 */
export function SmoothCenterModal({
    visible,
    onRequestClose,
    onBackdropPress,
    backdropColor = "rgba(17, 24, 39, 0.82)",
    overlayStyle,
    cardStyle,
    children,
}: SmoothCenterModalProps) {
    const [mounted, setMounted] = useState<boolean>(visible);
    const mountedRef = useRef<boolean>(visible);
    const exitFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const backdropOpacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
    const cardOpacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
    const cardScale = useRef(new Animated.Value(visible ? 1 : 0.93)).current;
    const cardTranslateY = useRef(new Animated.Value(visible ? 0 : 14)).current;

    useEffect(() => {
        if (exitFallbackTimerRef.current) {
            clearTimeout(exitFallbackTimerRef.current);
            exitFallbackTimerRef.current = null;
        }

        if (visible) {
            if (!mountedRef.current) {
                backdropOpacity.setValue(0);
                cardOpacity.setValue(0);
                cardScale.setValue(0.93);
                cardTranslateY.setValue(14);
                mountedRef.current = true;
                setMounted(true);
            }

            Animated.parallel([
                Animated.timing(backdropOpacity, {
                    toValue: 1,
                    duration: 220,
                    easing: Easing.out(Easing.cubic),
                    useNativeDriver: true,
                }),
                Animated.timing(cardOpacity, {
                    toValue: 1,
                    duration: 190,
                    easing: Easing.out(Easing.cubic),
                    useNativeDriver: true,
                }),
                Animated.spring(cardScale, {
                    toValue: 1,
                    damping: 24,
                    stiffness: 290,
                    mass: 0.85,
                    useNativeDriver: true,
                }),
                Animated.spring(cardTranslateY, {
                    toValue: 0,
                    damping: 24,
                    stiffness: 290,
                    mass: 0.85,
                    useNativeDriver: true,
                }),
            ]).start();
        } else if (mountedRef.current) {
            const finishUnmount = () => {
                if (exitFallbackTimerRef.current) {
                    clearTimeout(exitFallbackTimerRef.current);
                    exitFallbackTimerRef.current = null;
                }
                if (!visible) {
                    mountedRef.current = false;
                    setMounted(false);
                }
            };

            exitFallbackTimerRef.current = setTimeout(finishUnmount, 235);

            Animated.parallel([
                Animated.timing(backdropOpacity, {
                    toValue: 0,
                    duration: 190,
                    easing: Easing.in(Easing.quad),
                    useNativeDriver: true,
                }),
                Animated.timing(cardOpacity, {
                    toValue: 0,
                    duration: 175,
                    easing: Easing.in(Easing.cubic),
                    useNativeDriver: true,
                }),
                Animated.timing(cardScale, {
                    toValue: 0.95,
                    duration: 185,
                    easing: Easing.in(Easing.cubic),
                    useNativeDriver: true,
                }),
                Animated.timing(cardTranslateY, {
                    toValue: 10,
                    duration: 185,
                    easing: Easing.in(Easing.cubic),
                    useNativeDriver: true,
                }),
            ]).start(({ finished }) => {
                if (finished) finishUnmount();
            });
        }

        return () => {
            if (exitFallbackTimerRef.current) {
                clearTimeout(exitFallbackTimerRef.current);
                exitFallbackTimerRef.current = null;
            }
        };
    }, [visible, backdropOpacity, cardOpacity, cardScale, cardTranslateY]);

    if (!mounted) return null;

    return (
        <Modal
            visible={mounted}
            transparent
            animationType="none"
            statusBarTranslucent
            navigationBarTranslucent
            onRequestClose={onRequestClose || (() => {})}
        >
            <View
                style={[styles.centerRoot, overlayStyle]}
                pointerEvents={visible ? "auto" : "none"}
            >
                <Animated.View
                    style={[
                        StyleSheet.absoluteFillObject,
                        { backgroundColor: backdropColor, opacity: backdropOpacity },
                    ]}
                >
                    {onBackdropPress ? (
                        <Pressable style={StyleSheet.absoluteFillObject} onPress={onBackdropPress} />
                    ) : null}
                </Animated.View>

                <Animated.View
                    style={[
                        cardStyle,
                        {
                            opacity: cardOpacity,
                            transform: [{ translateY: cardTranslateY }, { scale: cardScale }],
                        },
                    ]}
                >
                    {children}
                </Animated.View>
            </View>
        </Modal>
    );
}

export interface SmoothInlineOverlayProps {
    visible: boolean;
    backdropColor?: string;
    overlayStyle?: StyleProp<ViewStyle>;
    cardStyle?: StyleProp<ViewStyle>;
    children: React.ReactNode;
}

/**
 * Non-Modal inline overlay with identical smooth backdrop fade + spring scale entrance/exit.
 * Ideal inside already-open full-screen Modals (e.g., Inspector / Archive Hub) so Modals never collide.
 */
export function SmoothInlineOverlay({
    visible,
    backdropColor = "rgba(17, 24, 39, 0.82)",
    overlayStyle,
    cardStyle,
    children,
}: SmoothInlineOverlayProps) {
    const [mounted, setMounted] = useState<boolean>(visible);
    const mountedRef = useRef<boolean>(visible);
    const exitFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const backdropOpacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
    const cardOpacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
    const cardScale = useRef(new Animated.Value(visible ? 1 : 0.93)).current;
    const cardTranslateY = useRef(new Animated.Value(visible ? 0 : 14)).current;

    useEffect(() => {
        if (exitFallbackTimerRef.current) {
            clearTimeout(exitFallbackTimerRef.current);
            exitFallbackTimerRef.current = null;
        }

        if (visible) {
            if (!mountedRef.current) {
                backdropOpacity.setValue(0);
                cardOpacity.setValue(0);
                cardScale.setValue(0.93);
                cardTranslateY.setValue(14);
                mountedRef.current = true;
                setMounted(true);
            }

            Animated.parallel([
                Animated.timing(backdropOpacity, {
                    toValue: 1,
                    duration: 220,
                    easing: Easing.out(Easing.cubic),
                    useNativeDriver: true,
                }),
                Animated.timing(cardOpacity, {
                    toValue: 1,
                    duration: 190,
                    easing: Easing.out(Easing.cubic),
                    useNativeDriver: true,
                }),
                Animated.spring(cardScale, {
                    toValue: 1,
                    damping: 24,
                    stiffness: 290,
                    mass: 0.85,
                    useNativeDriver: true,
                }),
                Animated.spring(cardTranslateY, {
                    toValue: 0,
                    damping: 24,
                    stiffness: 290,
                    mass: 0.85,
                    useNativeDriver: true,
                }),
            ]).start();
        } else if (mountedRef.current) {
            const finishUnmount = () => {
                if (exitFallbackTimerRef.current) {
                    clearTimeout(exitFallbackTimerRef.current);
                    exitFallbackTimerRef.current = null;
                }
                if (!visible) {
                    mountedRef.current = false;
                    setMounted(false);
                }
            };

            exitFallbackTimerRef.current = setTimeout(finishUnmount, 235);

            Animated.parallel([
                Animated.timing(backdropOpacity, {
                    toValue: 0,
                    duration: 190,
                    easing: Easing.in(Easing.quad),
                    useNativeDriver: true,
                }),
                Animated.timing(cardOpacity, {
                    toValue: 0,
                    duration: 175,
                    easing: Easing.in(Easing.cubic),
                    useNativeDriver: true,
                }),
                Animated.timing(cardScale, {
                    toValue: 0.95,
                    duration: 185,
                    easing: Easing.in(Easing.cubic),
                    useNativeDriver: true,
                }),
                Animated.timing(cardTranslateY, {
                    toValue: 10,
                    duration: 185,
                    easing: Easing.in(Easing.cubic),
                    useNativeDriver: true,
                }),
            ]).start(({ finished }) => {
                if (finished) finishUnmount();
            });
        }

        return () => {
            if (exitFallbackTimerRef.current) {
                clearTimeout(exitFallbackTimerRef.current);
                exitFallbackTimerRef.current = null;
            }
        };
    }, [visible, backdropOpacity, cardOpacity, cardScale, cardTranslateY]);

    if (!mounted) return null;

    return (
        <View
            style={[styles.inlineRoot, overlayStyle]}
            pointerEvents={visible ? "auto" : "none"}
        >
            <Animated.View
                style={[
                    StyleSheet.absoluteFillObject,
                    { backgroundColor: backdropColor, opacity: backdropOpacity },
                ]}
            />
            <Animated.View
                style={[
                    cardStyle,
                    {
                        opacity: cardOpacity,
                        transform: [{ translateY: cardTranslateY }, { scale: cardScale }],
                    },
                ]}
            >
                {children}
            </Animated.View>
        </View>
    );
}

export interface SmoothBottomSheetModalProps {
    visible: boolean;
    onClose: () => void;
    onRequestClose?: () => void;
    backdropColor?: string;
    sheetStyle?: StyleProp<ViewStyle>;
    avoidKeyboard?: boolean;
    dismissOnBackdropPress?: boolean;
    slideDistance?: number;
    overlayChildren?: React.ReactNode;
    children: React.ReactNode;
}

/**
 * Bottom sheet modal wrapper that smoothly fades the dimmed backdrop while springing only
 * the bottom sheet upward (and gliding smoothly downward before unmounting).
 */
export function SmoothBottomSheetModal({
    visible,
    onClose,
    onRequestClose,
    backdropColor = "rgba(15, 23, 42, 0.50)",
    sheetStyle,
    avoidKeyboard = false,
    dismissOnBackdropPress = true,
    slideDistance = Math.min(Math.round(SCREEN_HEIGHT * 0.78), 680),
    overlayChildren,
    children,
}: SmoothBottomSheetModalProps) {
    const [mounted, setMounted] = useState<boolean>(visible);
    const mountedRef = useRef<boolean>(visible);
    const exitFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const backdropOpacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
    const sheetTranslateY = useRef(new Animated.Value(visible ? 0 : slideDistance)).current;

    useEffect(() => {
        if (exitFallbackTimerRef.current) {
            clearTimeout(exitFallbackTimerRef.current);
            exitFallbackTimerRef.current = null;
        }

        if (visible) {
            if (!mountedRef.current) {
                backdropOpacity.setValue(0);
                sheetTranslateY.setValue(slideDistance);
                mountedRef.current = true;
                setMounted(true);
            }

            Animated.parallel([
                Animated.timing(backdropOpacity, {
                    toValue: 1,
                    duration: 220,
                    easing: Easing.out(Easing.cubic),
                    useNativeDriver: true,
                }),
                Animated.spring(sheetTranslateY, {
                    toValue: 0,
                    damping: 26,
                    stiffness: 280,
                    mass: 0.88,
                    useNativeDriver: true,
                }),
            ]).start();
        } else if (mountedRef.current) {
            const finishUnmount = () => {
                if (exitFallbackTimerRef.current) {
                    clearTimeout(exitFallbackTimerRef.current);
                    exitFallbackTimerRef.current = null;
                }
                if (!visible) {
                    mountedRef.current = false;
                    setMounted(false);
                }
            };

            exitFallbackTimerRef.current = setTimeout(finishUnmount, 245);

            Animated.parallel([
                Animated.timing(backdropOpacity, {
                    toValue: 0,
                    duration: 190,
                    easing: Easing.in(Easing.quad),
                    useNativeDriver: true,
                }),
                Animated.timing(sheetTranslateY, {
                    toValue: slideDistance,
                    duration: 205,
                    easing: Easing.in(Easing.cubic),
                    useNativeDriver: true,
                }),
            ]).start(({ finished }) => {
                if (finished) finishUnmount();
            });
        }

        return () => {
            if (exitFallbackTimerRef.current) {
                clearTimeout(exitFallbackTimerRef.current);
                exitFallbackTimerRef.current = null;
            }
        };
    }, [visible, slideDistance, backdropOpacity, sheetTranslateY]);

    if (!mounted) return null;

    const sheetNode = (
        <Animated.View
            style={[
                sheetStyle,
                {
                    transform: [{ translateY: sheetTranslateY }],
                },
            ]}
        >
            {children}
        </Animated.View>
    );

    return (
        <Modal
            visible={mounted}
            transparent
            animationType="none"
            statusBarTranslucent
            navigationBarTranslucent
            onRequestClose={onRequestClose || onClose}
        >
            <View
                style={styles.sheetRoot}
                pointerEvents={visible ? "auto" : "none"}
            >
                <Animated.View
                    style={[
                        StyleSheet.absoluteFillObject,
                        { backgroundColor: backdropColor, opacity: backdropOpacity },
                    ]}
                >
                    {dismissOnBackdropPress ? (
                        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
                    ) : null}
                </Animated.View>

                {avoidKeyboard ? (
                    <KeyboardAvoidingView
                        style={styles.keyboardWrap}
                        behavior={Platform.OS === "ios" ? "padding" : undefined}
                        pointerEvents="box-none"
                    >
                        {sheetNode}
                    </KeyboardAvoidingView>
                ) : (
                    sheetNode
                )}

                {overlayChildren}
            </View>
        </Modal>
    );
}

export interface SmoothStageTransitionProps {
    transitionKey: string | number | boolean;
    style?: StyleProp<ViewStyle>;
    duration?: number;
    offsetY?: number;
    children: React.ReactNode;
}

/**
 * Smoothly crossfades & gently lifts content when switching between major UI stages
 * (e.g., AI Builder setup -> generated results, Grader launcher -> graded sheet, Classroom tabs),
 * without flashing on initial screen mount.
 */
export function SmoothStageTransition({
    transitionKey,
    style,
    duration = 210,
    offsetY = 8,
    children,
}: SmoothStageTransitionProps) {
    const isFirstRenderRef = useRef(true);
    const prevKeyRef = useRef(transitionKey);
    const opacity = useRef(new Animated.Value(1)).current;
    const translateY = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (isFirstRenderRef.current) {
            isFirstRenderRef.current = false;
            prevKeyRef.current = transitionKey;
            return;
        }
        if (prevKeyRef.current === transitionKey) return;
        prevKeyRef.current = transitionKey;

        opacity.setValue(0.01);
        translateY.setValue(offsetY);

        Animated.parallel([
            Animated.timing(opacity, {
                toValue: 1,
                duration,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }),
            Animated.timing(translateY, {
                toValue: 0,
                duration: duration + 30,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }),
        ]).start();
    }, [transitionKey, duration, offsetY, opacity, translateY]);

    return (
        <Animated.View
            style={[
                style,
                {
                    opacity,
                    transform: [{ translateY }],
                },
            ]}
        >
            {children}
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    centerRoot: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        paddingHorizontal: 24,
    },
    inlineRoot: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: "center",
        alignItems: "center",
        paddingHorizontal: 24,
        zIndex: 9999,
    },
    sheetRoot: {
        flex: 1,
        justifyContent: "flex-end",
    },
    keyboardWrap: {
        width: "100%",
        justifyContent: "flex-end",
    },
});
