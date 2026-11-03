import React, { useState, useRef, useEffect } from "react";
import {
    Modal,
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Dimensions,
    Image,
    ScrollView,
    ActivityIndicator,
    Animated,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { useTheme } from "../context/ThemeContext";
import { BatchSheetItem } from "../lib/batchGradingQueue";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

export interface BatchScannerModalProps {
    visible: boolean;
    onClose: () => void;
    onCaptureSheet: (uri: string) => void;
    onBatchImportSheets: (uris: string[]) => void;
    onFinishAndReview: () => void;
    items: BatchSheetItem[];
    quizTitle: string;
    classTitle: string;
    accentColor?: string;
}

export function BatchScannerModal({
    visible,
    onClose,
    onCaptureSheet,
    onBatchImportSheets,
    onFinishAndReview,
    items,
    quizTitle,
    classTitle,
    accentColor = "#F97316",
}: BatchScannerModalProps) {
    const { darkMode } = useTheme();
    const [permission, requestPermission] = useCameraPermissions();
    const cameraRef = useRef<any>(null);
    const [flashMode, setFlashMode] = useState<"off" | "on">("off");
    const [isCapturing, setIsCapturing] = useState<boolean>(false);
    const [recentThumbnails, setRecentThumbnails] = useState<string[]>([]);

    // Shutter flash animation
    const flashAnim = useRef(new Animated.Value(0)).current;

    const totalCaptured = items.length;
    const completedCount = items.filter((i) => i.status === "ready" || i.status === "needs_review").length;
    const flaggedCount = items.filter((i) => i.status === "needs_review").length;
    const inProgressCount = items.filter((i) => i.status === "queued" || i.status === "optimizing" || i.status === "grading").length;

    useEffect(() => {
        if (visible && (!permission || !permission.granted)) {
            requestPermission();
        }
    }, [visible, permission]);

    // Keep track of the last few captured thumbnail URIs
    useEffect(() => {
        const uris = items.slice(-5).map((i) => i.imageUri).reverse();
        setRecentThumbnails(uris);
    }, [items]);

    const triggerShutterFlash = () => {
        flashAnim.setValue(1);
        Animated.timing(flashAnim, {
            toValue: 0,
            duration: 150,
            useNativeDriver: true,
        }).start();
    };

    const handleSnap = async () => {
        if (!cameraRef.current || isCapturing) return;
        setIsCapturing(true);

        try {
            triggerShutterFlash();
            try {
                await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            } catch (hErr) {
                // Ignore haptics error on web/simulator
            }

            const photo = await cameraRef.current.takePictureAsync({
                quality: 0.8,
                base64: false,
                skipProcessing: true,
            });

            if (photo && photo.uri) {
                onCaptureSheet(photo.uri);
            }
        } catch (err) {
            console.error("[BatchScanner] Capture failed:", err);
        } finally {
            setIsCapturing(false);
        }
    };

    const handlePickFromGallery = async () => {
        try {
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (status !== "granted") return;

            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ["images"],
                allowsMultipleSelection: true,
                quality: 0.8,
                selectionLimit: 50,
            });

            if (!result.canceled && result.assets && result.assets.length > 0) {
                const uris = result.assets.map((a) => a.uri);
                onBatchImportSheets(uris);
            }
        } catch (err) {
            console.error("[BatchScanner] Gallery import failed:", err);
        }
    };

    if (!visible) return null;

    return (
        <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
            <View style={styles.container}>
                {!permission || !permission.granted ? (
                    <View style={styles.permissionContainer}>
                        <Ionicons name="camera-outline" size={64} color="#F97316" />
                        <Text style={styles.permissionTitle}>Camera Permission Required</Text>
                        <Text style={styles.permissionSub}>
                            TSEKI requires camera access for rapid continuous test sheet scanning.
                        </Text>
                        <TouchableOpacity style={[styles.permBtn, { backgroundColor: accentColor }]} onPress={requestPermission}>
                            <Text style={styles.permBtnText}>Grant Camera Access</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.permCancel} onPress={onClose}>
                            <Text style={styles.permCancelText}>Cancel</Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    <View style={StyleSheet.absoluteFillObject}>
                        <CameraView
                            ref={cameraRef}
                            style={StyleSheet.absoluteFillObject}
                            facing="back"
                            enableTorch={flashMode === "on"}
                        />

                        {/* Shutter Flash Overlay */}
                        <Animated.View
                            pointerEvents="none"
                            style={[
                                StyleSheet.absoluteFillObject,
                                { backgroundColor: "#ffffff", opacity: flashAnim },
                            ]}
                        />

                        {/* Top Control Bar */}
                        <View style={styles.topBar}>
                            <TouchableOpacity style={styles.topBtn} onPress={onClose}>
                                <Ionicons name="close" size={24} color="#ffffff" />
                            </TouchableOpacity>

                            <View style={styles.headerInfo}>
                                <Text style={styles.headerTitle} numberOfLines={1}>
                                    Batch: {quizTitle || "Test"}
                                </Text>
                                <Text style={styles.headerSub} numberOfLines={1}>
                                    {classTitle}
                                </Text>
                            </View>

                            <TouchableOpacity
                                style={[styles.topBtn, flashMode === "on" && styles.topBtnActive]}
                                onPress={() => setFlashMode((prev) => (prev === "on" ? "off" : "on"))}
                            >
                                <Ionicons
                                    name={flashMode === "on" ? "flash" : "flash-off"}
                                    size={20}
                                    color={flashMode === "on" ? "#FBBF24" : "#ffffff"}
                                />
                            </TouchableOpacity>
                        </View>

                        {/* Floating Live Batch Counters HUD */}
                        <View style={styles.hudCard}>
                            <View style={styles.hudItem}>
                                <Text style={styles.hudNum}>{totalCaptured}</Text>
                                <Text style={styles.hudLabel}>Scanned</Text>
                            </View>
                            <View style={styles.hudDivider} />
                            <View style={styles.hudItem}>
                                <Text style={[styles.hudNum, { color: "#10B981" }]}>{completedCount}</Text>
                                <Text style={styles.hudLabel}>Graded</Text>
                            </View>
                            <View style={styles.hudDivider} />
                            <View style={styles.hudItem}>
                                <Text style={[styles.hudNum, inProgressCount > 0 && { color: "#3B82F6" }]}>
                                    {inProgressCount}
                                </Text>
                                <Text style={styles.hudLabel}>Queue</Text>
                            </View>
                            {flaggedCount > 0 && (
                                <>
                                    <View style={styles.hudDivider} />
                                    <View style={styles.hudItem}>
                                        <Text style={[styles.hudNum, { color: "#F59E0B" }]}>{flaggedCount}</Text>
                                        <Text style={styles.hudLabel}>Review</Text>
                                    </View>
                                </>
                            )}
                        </View>

                        {/* Physical Paper Registration Reticle Guide */}
                        <View style={styles.reticleContainer} pointerEvents="none">
                            <View style={styles.reticleBox}>
                                {/* Corner Alignment Brackets */}
                                <View style={[styles.corner, styles.cornerTL]} />
                                <View style={[styles.corner, styles.cornerTR]} />
                                <View style={[styles.corner, styles.cornerBL]} />
                                <View style={[styles.corner, styles.cornerBR]} />

                                <View style={styles.reticleHint}>
                                    <Ionicons name="scan-outline" size={18} color="rgba(255,255,255,0.7)" />
                                    <Text style={styles.reticleHintText}>
                                        Align all 4 paper corner squares inside the frame
                                    </Text>
                                </View>
                            </View>
                        </View>

                        {/* Bottom Controls Area */}
                        <View style={styles.bottomArea}>
                            {/* Live Thumbnail Feed of Scanned Sheets */}
                            {recentThumbnails.length > 0 && (
                                <View style={styles.thumbnailRow}>
                                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbScroll}>
                                        {recentThumbnails.map((uri, idx) => (
                                            <View key={uri + idx} style={styles.thumbWrap}>
                                                <Image source={{ uri }} style={styles.thumbImg} />
                                                <View style={styles.thumbBadge}>
                                                    <Ionicons name="checkmark-circle" size={14} color="#10B981" />
                                                </View>
                                            </View>
                                        ))}
                                    </ScrollView>
                                </View>
                            )}

                            {/* Main Shutter Bar */}
                            <View style={styles.shutterBar}>
                                {/* Multi-Image Gallery Import */}
                                <TouchableOpacity
                                    style={styles.galleryBtn}
                                    onPress={handlePickFromGallery}
                                    activeOpacity={0.7}
                                >
                                    <Ionicons name="images" size={26} color="#ffffff" />
                                    <Text style={styles.galleryBtnLabel}>Album</Text>
                                </TouchableOpacity>

                                {/* Continuous Snap Shutter Button */}
                                <TouchableOpacity
                                    style={styles.shutterRing}
                                    onPress={handleSnap}
                                    activeOpacity={0.8}
                                    disabled={isCapturing}
                                >
                                    <View style={[styles.shutterInner, { backgroundColor: accentColor }]}>
                                        {isCapturing ? (
                                            <ActivityIndicator size="small" color="#ffffff" />
                                        ) : (
                                            <Ionicons name="camera" size={32} color="#ffffff" />
                                        )}
                                    </View>
                                </TouchableOpacity>

                                {/* Finish & Review Class Button */}
                                <TouchableOpacity
                                    style={[
                                        styles.finishBtn,
                                        totalCaptured === 0 && styles.finishBtnDisabled,
                                    ]}
                                    onPress={onFinishAndReview}
                                    disabled={totalCaptured === 0}
                                    activeOpacity={0.8}
                                >
                                    <View style={styles.finishBtnContent}>
                                        <Text style={styles.finishBtnText}>Review</Text>
                                        <View style={styles.finishBadge}>
                                            <Text style={styles.finishBadgeText}>{totalCaptured}</Text>
                                        </View>
                                    </View>
                                    <Ionicons name="arrow-forward" size={16} color="#ffffff" />
                                </TouchableOpacity>
                            </View>
                        </View>
                    </View>
                )}
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: "#000000",
    },
    permissionContainer: {
        flex: 1,
        backgroundColor: "#111827",
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
    },
    permissionTitle: {
        color: "#F9FAFB",
        fontSize: 20,
        fontWeight: "800",
        marginTop: 16,
        textAlign: "center",
    },
    permissionSub: {
        color: "#9CA3AF",
        fontSize: 14,
        textAlign: "center",
        lineHeight: 20,
        marginTop: 8,
        marginBottom: 24,
    },
    permBtn: {
        paddingHorizontal: 24,
        paddingVertical: 14,
        borderRadius: 12,
        width: "100%",
        alignItems: "center",
    },
    permBtnText: {
        color: "#ffffff",
        fontSize: 15,
        fontWeight: "700",
    },
    permCancel: {
        marginTop: 14,
        padding: 8,
    },
    permCancelText: {
        color: "#9CA3AF",
        fontSize: 14,
        fontWeight: "600",
    },
    topBar: {
        position: "absolute",
        top: 48,
        left: 16,
        right: 16,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        zIndex: 10,
    },
    topBtn: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: "rgba(0,0,0,0.5)",
        alignItems: "center",
        justifyContent: "center",
    },
    topBtnActive: {
        backgroundColor: "rgba(251,191,36,0.3)",
        borderWidth: 1.5,
        borderColor: "#FBBF24",
    },
    headerInfo: {
        flex: 1,
        alignItems: "center",
        marginHorizontal: 12,
        backgroundColor: "rgba(0,0,0,0.5)",
        paddingVertical: 6,
        paddingHorizontal: 14,
        borderRadius: 20,
    },
    headerTitle: {
        color: "#ffffff",
        fontSize: 13.5,
        fontWeight: "800",
    },
    headerSub: {
        color: "rgba(255,255,255,0.75)",
        fontSize: 11,
        fontWeight: "500",
    },
    hudCard: {
        position: "absolute",
        top: 106,
        alignSelf: "center",
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: "rgba(17,24,39,0.85)",
        borderRadius: 14,
        paddingVertical: 6,
        paddingHorizontal: 16,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.15)",
        zIndex: 10,
    },
    hudItem: {
        alignItems: "center",
        paddingHorizontal: 8,
    },
    hudNum: {
        color: "#ffffff",
        fontSize: 16,
        fontWeight: "800",
    },
    hudLabel: {
        color: "rgba(255,255,255,0.6)",
        fontSize: 10,
        fontWeight: "700",
        textTransform: "uppercase",
        marginTop: 1,
    },
    hudDivider: {
        width: 1,
        height: 22,
        backgroundColor: "rgba(255,255,255,0.15)",
    },
    reticleContainer: {
        ...StyleSheet.absoluteFillObject,
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1,
    },
    reticleBox: {
        width: SCREEN_WIDTH * 0.86,
        height: SCREEN_HEIGHT * 0.48,
        marginBottom: 32,
        position: "relative",
        alignItems: "center",
        justifyContent: "flex-end",
        paddingBottom: 16,
    },
    corner: {
        position: "absolute",
        width: 32,
        height: 32,
        borderColor: "#ffffff",
    },
    cornerTL: {
        top: 0,
        left: 0,
        borderTopWidth: 3.5,
        borderLeftWidth: 3.5,
        borderTopLeftRadius: 6,
    },
    cornerTR: {
        top: 0,
        right: 0,
        borderTopWidth: 3.5,
        borderRightWidth: 3.5,
        borderTopRightRadius: 6,
    },
    cornerBL: {
        bottom: 0,
        left: 0,
        borderBottomWidth: 3.5,
        borderLeftWidth: 3.5,
        borderBottomLeftRadius: 6,
    },
    cornerBR: {
        bottom: 0,
        right: 0,
        borderBottomWidth: 3.5,
        borderRightWidth: 3.5,
        borderBottomRightRadius: 6,
    },
    reticleHint: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        backgroundColor: "rgba(0,0,0,0.6)",
        paddingVertical: 5,
        paddingHorizontal: 12,
        borderRadius: 12,
    },
    reticleHintText: {
        color: "rgba(255,255,255,0.85)",
        fontSize: 11.5,
        fontWeight: "600",
    },
    bottomArea: {
        position: "absolute",
        bottom: 24,
        left: 0,
        right: 0,
        alignItems: "center",
        zIndex: 10,
    },
    thumbnailRow: {
        height: 54,
        width: "100%",
        marginBottom: 16,
        paddingHorizontal: 16,
    },
    thumbScroll: {
        alignItems: "center",
        gap: 8,
    },
    thumbWrap: {
        width: 44,
        height: 52,
        borderRadius: 6,
        overflow: "hidden",
        borderWidth: 1.5,
        borderColor: "#ffffff",
        position: "relative",
    },
    thumbImg: {
        width: "100%",
        height: "100%",
        resizeMode: "cover",
    },
    thumbBadge: {
        position: "absolute",
        bottom: 2,
        right: 2,
        backgroundColor: "rgba(0,0,0,0.6)",
        borderRadius: 8,
    },
    noThumbsText: {
        color: "rgba(255,255,255,0.6)",
        fontSize: 12,
        fontStyle: "italic",
        marginLeft: 8,
    },
    shutterBar: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
        paddingHorizontal: 28,
    },
    galleryBtn: {
        alignItems: "center",
        justifyContent: "center",
        width: 54,
        height: 54,
        borderRadius: 27,
        backgroundColor: "rgba(255,255,255,0.2)",
    },
    galleryBtnLabel: {
        color: "#ffffff",
        fontSize: 10,
        fontWeight: "700",
        marginTop: 2,
    },
    shutterRing: {
        width: 82,
        height: 82,
        borderRadius: 41,
        borderWidth: 4,
        borderColor: "#ffffff",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "transparent",
    },
    shutterInner: {
        width: 68,
        height: 68,
        borderRadius: 34,
        alignItems: "center",
        justifyContent: "center",
    },
    finishBtn: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        backgroundColor: "#10B981",
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 24,
    },
    finishBtnDisabled: {
        backgroundColor: "rgba(255,255,255,0.2)",
        opacity: 0.5,
    },
    finishBtnContent: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    finishBtnText: {
        color: "#ffffff",
        fontSize: 13.5,
        fontWeight: "800",
    },
    finishBadge: {
        backgroundColor: "rgba(0,0,0,0.25)",
        paddingHorizontal: 7,
        paddingVertical: 2,
        borderRadius: 10,
    },
    finishBadgeText: {
        color: "#ffffff",
        fontSize: 12,
        fontWeight: "800",
    },
});
