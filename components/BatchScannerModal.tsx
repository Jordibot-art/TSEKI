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
import { PhotoGuidanceModal } from "./PhotoGuidanceModal";
import {
    cropCapturedSheetToReticle,
    evaluateLiveHoverQuality,
    LiveHoverDiagnostics,
    QrLiveObservation,
} from "../lib/liveCameraInspector";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

export interface BatchScannerModalProps {
    visible: boolean;
    onClose: () => void;
    onCaptureSheet: (uri: string) => void;
    onBatchImportSheets: (uris: string[]) => void;
    onFinishAndReview: () => void;
    onRemoveSheet?: (id: string) => void;
    items?: BatchSheetItem[];
    quizTitle: string;
    classTitle: string;
    accentColor?: string;
    mode?: "single" | "batch";
    onCaptureSingleSheet?: (uri: string) => void;
}

export function BatchScannerModal({
    visible,
    onClose,
    onCaptureSheet,
    onBatchImportSheets,
    onFinishAndReview,
    onRemoveSheet,
    items = [],
    quizTitle,
    classTitle,
    accentColor = "#F97316",
    mode = "batch",
    onCaptureSingleSheet,
}: BatchScannerModalProps) {
    const { darkMode } = useTheme();
    const [permission, requestPermission] = useCameraPermissions();
    const cameraRef = useRef<any>(null);
    const [flashMode, setFlashMode] = useState<"off" | "on">("off");
    const [isCapturing, setIsCapturing] = useState<boolean>(false);
    const [recentThumbnails, setRecentThumbnails] = useState<string[]>([]);
    const [guidanceOpen, setGuidanceOpen] = useState<boolean>(false);

    // Live QR visibility detection in camera frame
    const [qrDetectedLive, setQrDetectedLive] = useState<boolean>(false);
    const qrTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const qrObsRef = useRef<QrLiveObservation>({
        detected: false,
        lastSeenMs: 0,
    });

    // Real-time hover diagnostics (updated continuously from live barcode scanner without background photo captures)
    const [cameraReady, setCameraReady] = useState<boolean>(false);
    const [liveHoverStatus, setLiveHoverStatus] = useState<LiveHoverDiagnostics | null>(null);

    // Active Photo Quality Alert inside camera (for Batch Mode background grading)
    const [activeQualityAlert, setActiveQualityAlert] = useState<{
        itemId?: string;
        studentLabel: string;
        warnings: string[];
    } | null>(null);
    const alertedItemIdsRef = useRef<Set<string>>(new Set());

    // Shutter flash animation (only fires when user taps the camera shutter button)
    const flashAnim = useRef(new Animated.Value(0)).current;

    const isSingle = mode === "single";
    const totalCaptured = items.length;
    const completedCount = items.filter((i) => i.status === "ready" || i.status === "needs_review").length;
    const flaggedCount = items.filter((i) => i.status === "needs_review").length;
    const inProgressCount = items.filter((i) => i.status === "queued" || i.status === "optimizing" || i.status === "grading").length;

    useEffect(() => {
        if (visible && (!permission || !permission.granted)) {
            requestPermission();
        }
        if (visible && permission?.granted) {
            // Initialize live hover status immediately
            const initDiag = evaluateLiveHoverQuality(null, qrObsRef.current, Date.now());
            setLiveHoverStatus(initDiag);
        }
        if (!visible) {
            setCameraReady(false);
            setQrDetectedLive(false);
            setLiveHoverStatus(null);
            setActiveQualityAlert(null);
            qrObsRef.current = { detected: false, lastSeenMs: 0 };
            if (qrTimerRef.current) {
                clearTimeout(qrTimerRef.current);
                qrTimerRef.current = null;
            }
        }
    }, [visible, permission]);

    // Watch batch items for newly graded sheets that have photoQuality warnings
    useEffect(() => {
        if (isSingle || !visible) return;
        for (let idx = items.length - 1; idx >= 0; idx--) {
            const item = items[idx];
            if (
                item.photoQuality?.hasWarnings &&
                item.photoQuality.warnings.length > 0 &&
                !alertedItemIdsRef.current.has(item.id)
            ) {
                alertedItemIdsRef.current.add(item.id);
                const sheetNumber = idx + 1;
                const label =
                    item.matchedStudentName ||
                    item.studentNameExtracted ||
                    `Sheet #${sheetNumber}`;
                setActiveQualityAlert({
                    itemId: item.id,
                    studentLabel: `Sheet #${sheetNumber} (${label})`,
                    warnings: item.photoQuality.warnings,
                });
                try {
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                } catch {}
                break;
            }
        }
    }, [items, isSingle, visible]);

    const handleBarcodeScanned = (result: any) => {
        if (result?.data) {
            const now = Date.now();
            let boundsNorm: QrLiveObservation["boundsNorm"] = undefined;
            if (result.bounds?.origin && result.bounds?.size && SCREEN_WIDTH > 0 && SCREEN_HEIGHT > 0) {
                boundsNorm = {
                    x: result.bounds.origin.x / SCREEN_WIDTH,
                    y: result.bounds.origin.y / SCREEN_HEIGHT,
                    width: result.bounds.size.width / SCREEN_WIDTH,
                    height: result.bounds.size.height / SCREEN_HEIGHT,
                };
            }
            qrObsRef.current = {
                detected: true,
                lastSeenMs: now,
                boundsNorm,
                cornerPoints: Array.isArray(result.cornerPoints) ? result.cornerPoints : undefined,
            };

            setQrDetectedLive(true);
            const diag = evaluateLiveHoverQuality(null, qrObsRef.current, now);
            setLiveHoverStatus(diag);

            if (qrTimerRef.current) {
                clearTimeout(qrTimerRef.current);
            }
            qrTimerRef.current = setTimeout(() => {
                qrObsRef.current = {
                    ...qrObsRef.current,
                    detected: false,
                };
                setQrDetectedLive(false);
                const expiredDiag = evaluateLiveHoverQuality(null, qrObsRef.current, Date.now());
                setLiveHoverStatus(expiredDiag);
            }, 2500);
        }
    };

    // Keep track of the last few captured thumbnail URIs (in batch mode)
    useEffect(() => {
        if (!isSingle) {
            const uris = items.slice(-5).map((i) => i.imageUri).reverse();
            setRecentThumbnails(uris);
        }
    }, [items, isSingle]);

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
                quality: 0.9,
                base64: false,
            });

            if (photo && photo.uri) {
                // Auto-crop the raw sensor image to the exact on-screen reticle that the teacher framed,
                // trimming away surrounding laptop keyboard, desk, and legs so the test sheet fills the photo.
                const cropped = await cropCapturedSheetToReticle(photo, SCREEN_WIDTH, SCREEN_HEIGHT);
                const finalUri = cropped.uri;

                if (isSingle) {
                    if (onCaptureSingleSheet) {
                        onCaptureSingleSheet(finalUri);
                    } else {
                        onCaptureSheet(finalUri);
                    }
                    onClose();
                } else {
                    onCaptureSheet(finalUri);
                }
            }
        } catch (err) {
            console.error("[CameraGrader] Capture failed:", err);
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
                allowsMultipleSelection: !isSingle,
                quality: 0.8,
                selectionLimit: isSingle ? 1 : 50,
            });

            if (!result.canceled && result.assets && result.assets.length > 0) {
                if (isSingle) {
                    const singleUri = result.assets[0].uri;
                    if (onCaptureSingleSheet) {
                        onCaptureSingleSheet(singleUri);
                    } else {
                        onCaptureSheet(singleUri);
                    }
                    onClose();
                } else {
                    const uris = result.assets.map((a) => a.uri);
                    onBatchImportSheets(uris);
                }
            }
        } catch (err) {
            console.error("[CameraGrader] Gallery import failed:", err);
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
                            TSEKI requires camera access to scan and grade student test sheets.
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
                            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                            onBarcodeScanned={handleBarcodeScanned}
                            onCameraReady={() => setCameraReady(true)}
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
                                    {isSingle ? `Scan Sheet: ${quizTitle || "Test"}` : `Batch: ${quizTitle || "Test"}`}
                                </Text>
                                <Text style={styles.headerSub} numberOfLines={1}>
                                    {classTitle}
                                </Text>
                            </View>

                            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                                <TouchableOpacity
                                    style={styles.tipsBtn}
                                    onPress={() => setGuidanceOpen(true)}
                                    activeOpacity={0.75}
                                >
                                    <Ionicons name="help-circle-outline" size={16} color="#FBBF24" />
                                    <Text style={styles.tipsBtnText}>Tips</Text>
                                </TouchableOpacity>

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
                        </View>

                        {/* ── Live Real-Time Hover Status HUD ── */}
                        <TouchableOpacity
                            style={styles.guidanceHud}
                            onPress={() => setGuidanceOpen(true)}
                            activeOpacity={0.85}
                        >
                            <View style={styles.guidanceItem}>
                                <Ionicons
                                    name={
                                        liveHoverStatus?.lighting === "too_dark"
                                            ? "moon"
                                            : liveHoverStatus?.lighting === "too_bright"
                                            ? "sunny"
                                            : "checkmark-circle"
                                    }
                                    size={13}
                                    color={
                                        !liveHoverStatus
                                            ? "#FBBF24"
                                            : liveHoverStatus.lighting === "ok"
                                            ? "#10B981"
                                            : "#EF4444"
                                    }
                                />
                                <Text
                                    style={[
                                        styles.guidanceText,
                                        liveHoverStatus && {
                                            color: liveHoverStatus.lighting === "ok" ? "#34D399" : "#FCA5A5",
                                        },
                                    ]}
                                >
                                    {!liveHoverStatus
                                        ? "Lighting"
                                        : liveHoverStatus.lighting === "too_dark"
                                        ? "Too Dark"
                                        : liveHoverStatus.lighting === "too_bright"
                                        ? "Too Bright"
                                        : "Light OK"}
                                </Text>
                            </View>
                            <Text style={styles.guidanceDivider}>•</Text>
                            <View style={styles.guidanceItem}>
                                <Ionicons
                                    name={
                                        liveHoverStatus?.paperFlat && liveHoverStatus?.fullEdgesVisible
                                            ? "checkmark-circle"
                                            : "scan-outline"
                                    }
                                    size={13}
                                    color={
                                        !liveHoverStatus
                                            ? "#60A5FA"
                                            : liveHoverStatus.paperFlat && liveHoverStatus.fullEdgesVisible
                                            ? "#10B981"
                                            : "#F59E0B"
                                    }
                                />
                                <Text
                                    style={[
                                        styles.guidanceText,
                                        liveHoverStatus && {
                                            color:
                                                liveHoverStatus.paperFlat && liveHoverStatus.fullEdgesVisible
                                                    ? "#34D399"
                                                    : "#FCD34D",
                                        },
                                    ]}
                                >
                                    {!liveHoverStatus
                                        ? "Flat & Edges"
                                        : liveHoverStatus.paperFlat && liveHoverStatus.fullEdgesVisible
                                        ? "Flat & Edges OK"
                                        : "Edges/Flat!"}
                                </Text>
                            </View>
                            <Text style={styles.guidanceDivider}>•</Text>
                            <View style={styles.guidanceItem}>
                                <Ionicons
                                    name={liveHoverStatus?.cornerMarkersVisible ? "checkmark-circle" : "contract-outline"}
                                    size={13}
                                    color={
                                        !liveHoverStatus
                                            ? "#34D399"
                                            : liveHoverStatus.cornerMarkersVisible
                                            ? "#10B981"
                                            : "#F59E0B"
                                    }
                                />
                                <Text
                                    style={[
                                        styles.guidanceText,
                                        liveHoverStatus && {
                                            color: liveHoverStatus.cornerMarkersVisible ? "#34D399" : "#FCD34D",
                                        },
                                    ]}
                                >
                                    {liveHoverStatus
                                        ? `${liveHoverStatus.visibleCornerCount}/4 Markers`
                                        : "4 Markers"}
                                </Text>
                            </View>
                            <Text style={styles.guidanceDivider}>•</Text>
                            <View style={styles.guidanceItem}>
                                <Ionicons
                                    name={
                                        qrDetectedLive || liveHoverStatus?.qrVisible
                                            ? "checkmark-circle"
                                            : "qr-code-outline"
                                    }
                                    size={13}
                                    color={
                                        qrDetectedLive || liveHoverStatus?.qrVisible ? "#10B981" : "#F59E0B"
                                    }
                                />
                                <Text
                                    style={[
                                        styles.guidanceText,
                                        {
                                            color:
                                                qrDetectedLive || liveHoverStatus?.qrVisible
                                                    ? "#34D399"
                                                    : "#FCD34D",
                                        },
                                    ]}
                                >
                                    {qrDetectedLive || liveHoverStatus?.qrVisible ? "QR Ready" : "No QR"}
                                </Text>
                            </View>
                        </TouchableOpacity>

                        {/* ── Real-Time Hover Alert Banner (Fires While Hovering Camera BEFORE Capture!) ── */}
                        {liveHoverStatus && !activeQualityAlert && (
                            <View
                                style={[
                                    styles.liveHoverBanner,
                                    liveHoverStatus.hasWarnings
                                        ? styles.liveHoverBannerWarn
                                        : styles.liveHoverBannerOk,
                                ]}
                                pointerEvents="box-none"
                            >
                                {liveHoverStatus.hasWarnings ? (
                                    <>
                                        <View style={styles.liveHoverHeader}>
                                            <Ionicons name="alert-circle" size={16} color="#FBBF24" />
                                            <Text style={styles.liveHoverTitle}>
                                                Live Camera Check — Adjust Before Capturing:
                                            </Text>
                                        </View>
                                        {liveHoverStatus.warnings.map((w, idx) => (
                                            <Text key={idx} style={styles.liveHoverWarningText}>
                                                • {w}
                                            </Text>
                                        ))}
                                    </>
                                ) : (
                                    <View style={styles.liveHoverHeader}>
                                        <Ionicons name="checkmark-circle" size={16} color="#34D399" />
                                        <Text style={styles.liveHoverOkText}>
                                            Paper Aligned, 4/4 Markers, QR & Lighting Ready — Tap Shutter!
                                        </Text>
                                    </View>
                                )}
                            </View>
                        )}

                        {/* ── Post-Capture Batch Photo Quality Warning Banner (Batch Mode) ── */}
                        {activeQualityAlert && (
                            <View style={styles.qualityAlertBanner}>
                                <View style={styles.qualityAlertHeader}>
                                    <View style={styles.qualityAlertTitleRow}>
                                        <Ionicons name="warning" size={16} color="#F59E0B" />
                                        <Text style={styles.qualityAlertTitle} numberOfLines={1}>
                                            Photo Quality Alert: {activeQualityAlert.studentLabel}
                                        </Text>
                                    </View>
                                    <TouchableOpacity
                                        onPress={() => setActiveQualityAlert(null)}
                                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                    >
                                        <Ionicons name="close-circle" size={18} color="#9CA3AF" />
                                    </TouchableOpacity>
                                </View>
                                {activeQualityAlert.warnings.map((w, idx) => (
                                    <Text key={idx} style={styles.qualityAlertItem}>
                                        • {w}
                                    </Text>
                                ))}
                                <View style={styles.qualityAlertActions}>
                                    {activeQualityAlert.itemId && onRemoveSheet && (
                                        <TouchableOpacity
                                            style={styles.qualityAlertRetakeBtn}
                                            onPress={() => {
                                                const idToRemove = activeQualityAlert.itemId!;
                                                setActiveQualityAlert(null);
                                                onRemoveSheet(idToRemove);
                                            }}
                                            activeOpacity={0.8}
                                        >
                                            <Ionicons name="refresh" size={13} color="#FFFFFF" />
                                            <Text style={styles.qualityAlertRetakeText}>Discard & Retake</Text>
                                        </TouchableOpacity>
                                    )}
                                    <TouchableOpacity
                                        style={styles.qualityAlertDismissBtn}
                                        onPress={() => setActiveQualityAlert(null)}
                                        activeOpacity={0.8}
                                    >
                                        <Text style={styles.qualityAlertDismissText}>Dismiss</Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        )}

                        {/* Floating Live Batch Counters HUD (Only in Batch Mode) */}
                        {!isSingle && !activeQualityAlert && !liveHoverStatus?.hasWarnings && (
                            <View style={[styles.hudCard, liveHoverStatus && { top: 180 }]}>
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
                        )}

                        {/* ── Physical Paper Registration Reticle Guide with 4 Corner Markers ── */}
                        <View style={styles.reticleContainer} pointerEvents="box-none">
                            <View
                                style={[
                                    styles.reticleBox,
                                    liveHoverStatus && {
                                        borderColor: liveHoverStatus.hasWarnings
                                            ? "rgba(245, 158, 11, 0.75)"
                                            : "rgba(16, 185, 129, 0.85)",
                                    },
                                ]}
                            >
                                {/* Top-Left Corner Bracket & Solid Marker Target */}
                                <View
                                    style={[
                                        styles.corner,
                                        styles.cornerTL,
                                        liveHoverStatus && {
                                            borderColor: liveHoverStatus.cornerStatus.tl ? "#10B981" : "#F59E0B",
                                        },
                                    ]}
                                >
                                    <View
                                        style={[
                                            styles.markerTargetSquare,
                                            liveHoverStatus?.cornerStatus.tl && { borderColor: "#10B981" },
                                        ]}
                                    />
                                </View>

                                {/* Top-Right Corner Bracket & Solid Marker Target */}
                                <View
                                    style={[
                                        styles.corner,
                                        styles.cornerTR,
                                        liveHoverStatus && {
                                            borderColor: liveHoverStatus.cornerStatus.tr ? "#10B981" : "#F59E0B",
                                        },
                                    ]}
                                >
                                    <View
                                        style={[
                                            styles.markerTargetSquare,
                                            liveHoverStatus?.cornerStatus.tr && { borderColor: "#10B981" },
                                        ]}
                                    />
                                </View>

                                {/* Top-Right QR Code Zone Indicator */}
                                <View
                                    style={[
                                        styles.qrTargetBox,
                                        (qrDetectedLive || liveHoverStatus?.qrVisible) && styles.qrTargetBoxActive,
                                    ]}
                                >
                                    <Ionicons
                                        name={
                                            qrDetectedLive || liveHoverStatus?.qrVisible
                                                ? "checkmark-circle"
                                                : "qr-code-outline"
                                        }
                                        size={12}
                                        color={
                                            qrDetectedLive || liveHoverStatus?.qrVisible ? "#10B981" : "#FFFFFF"
                                        }
                                    />
                                    <Text
                                        style={[
                                            styles.qrTargetText,
                                            (qrDetectedLive || liveHoverStatus?.qrVisible) && { color: "#34D399" },
                                        ]}
                                    >
                                        {qrDetectedLive || liveHoverStatus?.qrVisible ? "QR VISIBLE" : "QR"}
                                    </Text>
                                </View>

                                {/* Bottom-Left Corner Bracket & Solid Marker Target */}
                                <View
                                    style={[
                                        styles.corner,
                                        styles.cornerBL,
                                        liveHoverStatus && {
                                            borderColor: liveHoverStatus.cornerStatus.bl ? "#10B981" : "#F59E0B",
                                        },
                                    ]}
                                >
                                    <View
                                        style={[
                                            styles.markerTargetSquare,
                                            liveHoverStatus?.cornerStatus.bl && { borderColor: "#10B981" },
                                        ]}
                                    />
                                </View>

                                {/* Bottom-Right Corner Bracket & Solid Marker Target */}
                                <View
                                    style={[
                                        styles.corner,
                                        styles.cornerBR,
                                        liveHoverStatus && {
                                            borderColor: liveHoverStatus.cornerStatus.br ? "#10B981" : "#F59E0B",
                                        },
                                    ]}
                                >
                                    <View
                                        style={[
                                            styles.markerTargetSquare,
                                            liveHoverStatus?.cornerStatus.br && { borderColor: "#10B981" },
                                        ]}
                                    />
                                </View>

                                {/* Bottom Hint & Tips Trigger */}
                                <TouchableOpacity
                                    style={styles.reticleHint}
                                    onPress={() => setGuidanceOpen(true)}
                                    activeOpacity={0.8}
                                >
                                    <Ionicons name="shield-checkmark" size={14} color="#10B981" />
                                    <Text style={styles.reticleHintText}>
                                        Align paper edges & 4 black corner squares
                                    </Text>
                                </TouchableOpacity>
                            </View>
                        </View>

                        {/* Bottom Controls Area */}
                        <View style={styles.bottomArea}>
                            {/* Live Thumbnail Feed of Scanned Sheets (Batch Mode only) */}
                            {!isSingle && recentThumbnails.length > 0 && (
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
                                {/* Photo Library Import */}
                                <TouchableOpacity
                                    style={styles.galleryBtn}
                                    onPress={handlePickFromGallery}
                                    activeOpacity={0.7}
                                >
                                    <Ionicons name="images" size={24} color="#ffffff" />
                                    <Text style={styles.galleryBtnLabel}>Album</Text>
                                </TouchableOpacity>

                                {/* Snap Shutter Button */}
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

                                {/* Single Mode: Tips Button | Batch Mode: Review Button */}
                                {isSingle ? (
                                    <TouchableOpacity
                                        style={styles.singleTipsBtn}
                                        onPress={() => setGuidanceOpen(true)}
                                        activeOpacity={0.75}
                                    >
                                        <Ionicons name="bulb-outline" size={22} color="#FBBF24" />
                                        <Text style={styles.singleTipsBtnLabel}>Tips</Text>
                                    </TouchableOpacity>
                                ) : (
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
                                )}
                            </View>
                        </View>

                        {/* Photo Guidance Dialog */}
                        <PhotoGuidanceModal
                            visible={guidanceOpen}
                            onClose={() => setGuidanceOpen(false)}
                            accentColor={accentColor}
                        />
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
        left: 0,
        right: 0,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        zIndex: 10,
    },
    topBtn: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: "rgba(0,0,0,0.5)",
        alignItems: "center",
        justifyContent: "center",
    },
    topBtnActive: {
        backgroundColor: "rgba(251,191,36,0.3)",
        borderWidth: 1.5,
        borderColor: "#FBBF24",
    },
    tipsBtn: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        backgroundColor: "rgba(0,0,0,0.55)",
        borderWidth: 1,
        borderColor: "rgba(251,191,36,0.5)",
        paddingVertical: 8,
        paddingHorizontal: 10,
        borderRadius: 20,
    },
    tipsBtnText: {
        color: "#FFFFFF",
        fontSize: 12,
        fontWeight: "700",
    },
    headerInfo: {
        flex: 1,
        alignItems: "center",
        marginHorizontal: 8,
    },
    headerTitle: {
        color: "#ffffff",
        fontSize: 14,
        fontWeight: "700",
    },
    headerSub: {
        color: "rgba(255,255,255,0.75)",
        fontSize: 11,
        fontWeight: "500",
    },
    guidanceHud: {
        position: "absolute",
        top: 98,
        alignSelf: "center",
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: "rgba(17, 24, 39, 0.88)",
        borderRadius: 20,
        paddingVertical: 6,
        paddingHorizontal: 14,
        borderWidth: 1,
        borderColor: "rgba(255, 255, 255, 0.2)",
        zIndex: 10,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
    },
    guidanceItem: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    guidanceText: {
        color: "#FFFFFF",
        fontSize: 11,
        fontWeight: "700",
    },
    guidanceDivider: {
        color: "rgba(255, 255, 255, 0.4)",
        marginHorizontal: 8,
        fontSize: 10,
    },
    liveHoverBanner: {
        position: "absolute",
        top: 134,
        left: 16,
        right: 16,
        borderRadius: 12,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderWidth: 1.5,
        zIndex: 20,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.35,
        shadowRadius: 6,
    },
    liveHoverBannerWarn: {
        backgroundColor: "rgba(17, 24, 39, 0.92)",
        borderColor: "#F59E0B",
    },
    liveHoverBannerOk: {
        backgroundColor: "rgba(6, 78, 59, 0.90)",
        borderColor: "#10B981",
    },
    liveHoverHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    liveHoverTitle: {
        color: "#FBBF24",
        fontSize: 12,
        fontWeight: "800",
        flex: 1,
    },
    liveHoverWarningText: {
        color: "#F9FAFB",
        fontSize: 11.2,
        lineHeight: 15.5,
        marginTop: 2,
    },
    liveHoverOkText: {
        color: "#D1FAE5",
        fontSize: 11.5,
        fontWeight: "700",
        flex: 1,
    },
    hudCard: {
        position: "absolute",
        top: 136,
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
        width: SCREEN_WIDTH * 0.88,
        height: Math.min(SCREEN_WIDTH * 0.88 * 1.30, SCREEN_HEIGHT * 0.54),
        marginBottom: 20,
        position: "relative",
        alignItems: "center",
        justifyContent: "flex-end",
        paddingBottom: 14,
        borderWidth: 1.5,
        borderColor: "rgba(255, 255, 255, 0.4)",
        borderStyle: "dashed",
        borderRadius: 10,
        backgroundColor: "rgba(255, 255, 255, 0.02)",
    },
    corner: {
        position: "absolute",
        width: 36,
        height: 36,
        borderColor: "#ffffff",
        alignItems: "center",
        justifyContent: "center",
    },
    cornerTL: {
        top: -2,
        left: -2,
        borderTopWidth: 4,
        borderLeftWidth: 4,
        borderTopLeftRadius: 8,
    },
    cornerTR: {
        top: -2,
        right: -2,
        borderTopWidth: 4,
        borderRightWidth: 4,
        borderTopRightRadius: 8,
    },
    cornerBL: {
        bottom: -2,
        left: -2,
        borderBottomWidth: 4,
        borderLeftWidth: 4,
        borderBottomLeftRadius: 8,
    },
    cornerBR: {
        bottom: -2,
        right: -2,
        borderBottomWidth: 4,
        borderRightWidth: 4,
        borderBottomRightRadius: 8,
    },
    markerTargetSquare: {
        width: 16,
        height: 16,
        backgroundColor: "#000000",
        borderWidth: 1.5,
        borderColor: "#FFFFFF",
        borderRadius: 2,
    },
    qrTargetBox: {
        position: "absolute",
        top: 42,
        right: 4,
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
        paddingHorizontal: 5,
        paddingVertical: 3,
        borderWidth: 1.5,
        borderColor: "rgba(255, 255, 255, 0.8)",
        borderRadius: 4,
        backgroundColor: "rgba(0, 0, 0, 0.4)",
    },
    qrTargetBoxActive: {
        borderColor: "#10B981",
        backgroundColor: "rgba(6, 78, 59, 0.85)",
    },
    qrTargetText: {
        color: "#FFFFFF",
        fontSize: 9,
        fontWeight: "800",
    },
    qualityAlertBanner: {
        position: "absolute",
        top: 136,
        left: 16,
        right: 16,
        backgroundColor: "rgba(17, 24, 39, 0.96)",
        borderRadius: 14,
        padding: 12,
        borderWidth: 1.5,
        borderColor: "#F59E0B",
        zIndex: 25,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.4,
        shadowRadius: 8,
    },
    qualityAlertHeader: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 6,
    },
    qualityAlertTitleRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        flex: 1,
        marginRight: 8,
    },
    qualityAlertTitle: {
        color: "#FBBF24",
        fontSize: 13,
        fontWeight: "800",
        flex: 1,
    },
    qualityAlertItem: {
        color: "#F3F4F6",
        fontSize: 11.5,
        lineHeight: 16,
        marginTop: 2,
    },
    qualityAlertActions: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 8,
        marginTop: 10,
    },
    qualityAlertRetakeBtn: {
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        backgroundColor: "#EF4444",
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 8,
    },
    qualityAlertRetakeText: {
        color: "#FFFFFF",
        fontSize: 11.5,
        fontWeight: "700",
    },
    qualityAlertDismissBtn: {
        backgroundColor: "rgba(255,255,255,0.12)",
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 8,
    },
    qualityAlertDismissText: {
        color: "#E5E7EB",
        fontSize: 11.5,
        fontWeight: "600",
    },
    reticleHint: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        backgroundColor: "rgba(0,0,0,0.7)",
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.2)",
    },
    reticleHintText: {
        color: "rgba(255,255,255,0.9)",
        fontSize: 11,
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
    singleTipsBtn: {
        alignItems: "center",
        justifyContent: "center",
        width: 54,
        height: 54,
        borderRadius: 27,
        backgroundColor: "rgba(255,255,255,0.2)",
    },
    singleTipsBtnLabel: {
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
