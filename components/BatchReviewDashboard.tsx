import React, { useState, useMemo } from "react";
import {
    Modal,
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
    Image,
    ActivityIndicator,
    Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../context/ThemeContext";
import { BatchSheetItem, StudentRosterItem } from "../lib/batchGradingQueue";
import { LowConfidenceReviewModal } from "./LowConfidenceReviewModal";
import { GradingResultItem } from "../lib/gradingService";

export interface BatchReviewDashboardProps {
    visible: boolean;
    onClose: () => void;
    onScanMore: () => void;
    items: BatchSheetItem[];
    onUpdateItem: (id: string, updates: Partial<BatchSheetItem>) => void;
    onRemoveItem: (id: string) => void;
    roster: StudentRosterItem[];
    quizTitle: string;
    classTitle: string;
    classroomId: string;
    accentColor?: string;
    onCommitBatch: (approvedItems: BatchSheetItem[]) => Promise<void>;
}

export function BatchReviewDashboard({
    visible,
    onClose,
    onScanMore,
    items,
    onUpdateItem,
    onRemoveItem,
    roster,
    quizTitle,
    classTitle,
    classroomId,
    accentColor = "#F97316",
    onCommitBatch,
}: BatchReviewDashboardProps) {
    const { darkMode } = useTheme();

    // Filter tab: "ALL" | "REVIEW" | "READY"
    const [filterTab, setFilterTab] = useState<"ALL" | "REVIEW" | "READY">("ALL");

    // Modal state for manual question override using existing LowConfidenceReviewModal
    const [reviewModalOpen, setReviewModalOpen] = useState<boolean>(false);
    const [activeReviewItem, setActiveReviewItem] = useState<BatchSheetItem | null>(null);
    const [reviewOnlyFlagged, setReviewOnlyFlagged] = useState<boolean>(false);

    // Full-screen image preview of captured test paper
    const [previewImageUri, setPreviewImageUri] = useState<string | null>(null);

    // Dropdown state for assigning student to unmatched sheet
    const [assignPickerItemId, setAssignPickerItemId] = useState<string | null>(null);

    // Committing state
    const [isSaving, setIsSaving] = useState<boolean>(false);

    // Colors
    const bg = darkMode ? "#111827" : "#F9FAFB";
    const cardBg = darkMode ? "#1F2937" : "#FFFFFF";
    const textMain = darkMode ? "#F9FAFB" : "#111827";
    const textSub = darkMode ? "#9CA3AF" : "#6B7280";
    const border = darkMode ? "#374151" : "#E5E7EB";

    // ── Computed Stats ─────────────────────────────────────────────────────────
    const stats = useMemo(() => {
        const total = items.length;
        const gradedItems = items.filter((i) => i.gradingResult && i.status !== "error");
        const needsReviewCount = items.filter((i) => i.status === "needs_review" && !i.isApproved).length;
        const readyCount = items.filter((i) => i.status === "ready" || (i.isApproved && i.status !== "error")).length;

        if (gradedItems.length === 0) {
            return {
                total,
                average: 0,
                passRate: 0,
                needsReviewCount,
                readyCount,
                gradedCount: 0,
            };
        }

        const sumPercentages = gradedItems.reduce((acc, item) => {
            const res = item.gradingResult!;
            const pct = Math.round((res.totalScore / (res.maxScore || 1)) * 100);
            return acc + pct;
        }, 0);

        const passingCount = gradedItems.filter((item) => {
            const res = item.gradingResult!;
            const pct = Math.round((res.totalScore / (res.maxScore || 1)) * 100);
            return pct >= 75;
        }).length;

        return {
            total,
            average: Math.round(sumPercentages / gradedItems.length),
            passRate: Math.round((passingCount / gradedItems.length) * 100),
            needsReviewCount,
            readyCount,
            gradedCount: gradedItems.length,
        };
    }, [items]);

    // ── Filtered List ──────────────────────────────────────────────────────────
    const filteredItems = useMemo(() => {
        if (filterTab === "REVIEW") {
            return items.filter((i) => i.status === "needs_review" && !i.isApproved);
        }
        if (filterTab === "READY") {
            return items.filter((i) => i.status === "ready" || i.isApproved);
        }
        return items;
    }, [items, filterTab]);

    // ── Open Low Confidence Review for a single item ───────────────────────────
    const handleOpenReview = (item: BatchSheetItem, onlyFlagged: boolean = false) => {
        setActiveReviewItem(item);
        setReviewOnlyFlagged(onlyFlagged);
        setReviewModalOpen(true);
    };

    // ── Save Resolved Answers from Review Modal ────────────────────────────────
    const handleSaveReviewedResults = (
        updatedResults: GradingResultItem[],
        newTotalScore: number
    ) => {
        if (!activeReviewItem) return;

        const updatedGrading: any = {
            ...activeReviewItem.gradingResult,
            totalScore: newTotalScore,
            results: updatedResults,
        };

        // Recount remaining flags
        const remainingFlags = updatedResults.filter(
            (r) =>
                (r.flaggedForReview ||
                    r.flagReason === "double_mark" ||
                    r.flagReason === "unclear" ||
                    r.flagReason === "low_confidence" ||
                    (r.confidence !== undefined && r.confidence < 0.75)) &&
                !r.isOverridden
        ).length;

        const canMarkReady = remainingFlags === 0 && Boolean(activeReviewItem.matchedStudentId);

        onUpdateItem(activeReviewItem.id, {
            gradingResult: updatedGrading,
            flaggedCount: remainingFlags,
            status: canMarkReady ? "ready" : "needs_review",
            isApproved: canMarkReady,
        });

        setReviewModalOpen(false);
        setActiveReviewItem(null);
    };

    // ── Manually Assign Student from Roster ────────────────────────────────────
    const handleAssignStudent = (itemId: string, student: StudentRosterItem) => {
        const item = items.find((i) => i.id === itemId);
        if (!item) return;

        const canMarkReady = (item.flaggedCount || 0) === 0;

        onUpdateItem(itemId, {
            matchedStudentId: student.id,
            matchedStudentName: student.full_name,
            status: canMarkReady ? "ready" : "needs_review",
            isApproved: canMarkReady,
            isAutoMatched: false,
        });

        setAssignPickerItemId(null);
    };

    // ── Commit Batch ───────────────────────────────────────────────────────────
    const handleCommit = async () => {
        const approved = items.filter((i) => i.gradingResult && (i.status === "ready" || i.isApproved));

        if (approved.length === 0) {
            Alert.alert("No Ready Sheets", "Please resolve any flagged sheets before approving the batch.");
            return;
        }

        const unapprovedCount = items.length - approved.length;
        if (unapprovedCount > 0) {
            Alert.alert(
                "Unreviewed Sheets Detected",
                `There are ${unapprovedCount} sheet(s) that still need review. Do you want to record the ${approved.length} ready sheet(s) now?`,
                [
                    { text: "Cancel", style: "cancel" },
                    {
                        text: `Record ${approved.length} Ready`,
                        onPress: async () => {
                            setIsSaving(true);
                            try {
                                await onCommitBatch(approved);
                            } finally {
                                setIsSaving(false);
                            }
                        },
                    },
                ]
            );
            return;
        }

        setIsSaving(true);
        try {
            await onCommitBatch(approved);
        } finally {
            setIsSaving(false);
        }
    };

    if (!visible) return null;

    return (
        <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
            <View style={[styles.container, { backgroundColor: bg }]}>
                {/* Header */}
                <View style={[styles.header, { backgroundColor: cardBg, borderBottomColor: border }]}>
                    <TouchableOpacity style={styles.closeBtn} onPress={onClose} disabled={isSaving}>
                        <Ionicons name="close" size={22} color={textMain} />
                    </TouchableOpacity>
                    <View style={styles.headerTitles}>
                        <Text style={[styles.mainTitle, { color: textMain }]} numberOfLines={1}>
                            ⚡ Batch Review: {quizTitle || "Assessment"}
                        </Text>
                        <Text style={[styles.subTitle, { color: textSub }]}>
                            {classTitle} • {items.length} Papers Scanned
                        </Text>
                    </View>
                    <TouchableOpacity
                        style={[styles.scanMoreBtn, { borderColor: accentColor }]}
                        onPress={onScanMore}
                        disabled={isSaving}
                    >
                        <Ionicons name="camera-outline" size={16} color={accentColor} />
                        <Text style={[styles.scanMoreBtnText, { color: accentColor }]}>Add</Text>
                    </TouchableOpacity>
                </View>

                {/* Class Performance Metrics HUD */}
                <View style={styles.statsContainer}>
                    <View style={[styles.statBox, { backgroundColor: cardBg, borderColor: border }]}>
                        <Text style={[styles.statValue, { color: textMain }]}>{stats.total}</Text>
                        <Text style={[styles.statLabel, { color: textSub }]}>Scanned</Text>
                    </View>
                    <View style={[styles.statBox, { backgroundColor: cardBg, borderColor: border }]}>
                        <Text style={[styles.statValue, { color: accentColor }]}>
                            {stats.gradedCount > 0 ? `${stats.average}%` : "—"}
                        </Text>
                        <Text style={[styles.statLabel, { color: textSub }]}>Class Avg</Text>
                    </View>
                    <View style={[styles.statBox, { backgroundColor: cardBg, borderColor: border }]}>
                        <Text style={[styles.statValue, { color: "#10B981" }]}>
                            {stats.gradedCount > 0 ? `${stats.passRate}%` : "—"}
                        </Text>
                        <Text style={[styles.statLabel, { color: textSub }]}>Pass Rate</Text>
                    </View>
                    <View style={[styles.statBox, { backgroundColor: cardBg, borderColor: border }]}>
                        <Text
                            style={[
                                styles.statValue,
                                { color: stats.needsReviewCount > 0 ? "#F59E0B" : "#10B981" },
                            ]}
                        >
                            {stats.needsReviewCount}
                        </Text>
                        <Text style={[styles.statLabel, { color: textSub }]}>Review</Text>
                    </View>
                </View>

                {/* Filter Tabs */}
                <View style={[styles.tabsRow, { borderBottomColor: border }]}>
                    <TouchableOpacity
                        style={[styles.tabItem, filterTab === "ALL" && { borderBottomColor: accentColor }]}
                        onPress={() => setFilterTab("ALL")}
                    >
                        <Text style={[styles.tabText, filterTab === "ALL" ? { color: accentColor, fontWeight: "700" } : { color: textSub }]}>
                            All Papers ({items.length})
                        </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.tabItem, filterTab === "REVIEW" && { borderBottomColor: "#F59E0B" }]}
                        onPress={() => setFilterTab("REVIEW")}
                    >
                        <View style={styles.tabBadgeWrap}>
                            <Text style={[styles.tabText, filterTab === "REVIEW" ? { color: "#F59E0B", fontWeight: "700" } : { color: textSub }]}>
                                Needs Review
                            </Text>
                            {stats.needsReviewCount > 0 && (
                                <View style={styles.reviewAlertBadge}>
                                    <Text style={styles.reviewAlertBadgeText}>{stats.needsReviewCount}</Text>
                                </View>
                            )}
                        </View>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.tabItem, filterTab === "READY" && { borderBottomColor: "#10B981" }]}
                        onPress={() => setFilterTab("READY")}
                    >
                        <Text style={[styles.tabText, filterTab === "READY" ? { color: "#10B981", fontWeight: "700" } : { color: textSub }]}>
                            Ready ({stats.readyCount})
                        </Text>
                    </TouchableOpacity>
                </View>

                {/* Student Papers List */}
                <ScrollView contentContainerStyle={styles.listContent}>
                    {/* Class-Level Photo Quality Alert Banner */}
                    {items.some((i) => i.photoQuality?.hasWarnings && i.photoQuality.warnings.length > 0 && !i.isApproved) && (
                        <View
                            style={{
                                backgroundColor: darkMode ? "#7F1D1D35" : "#FEF2F2",
                                borderWidth: 1.5,
                                borderColor: "#EF4444",
                                borderRadius: 12,
                                padding: 12,
                                marginBottom: 12,
                            }}
                        >
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                                <Ionicons name="warning" size={18} color="#EF4444" />
                                <Text
                                    style={{
                                        color: darkMode ? "#FCA5A5" : "#991B1B",
                                        fontSize: 13.5,
                                        fontWeight: "800",
                                        flex: 1,
                                    }}
                                >
                                    Photo Quality Alert ({items.filter((i) => i.photoQuality?.hasWarnings && !i.isApproved).length} Paper
                                    {items.filter((i) => i.photoQuality?.hasWarnings && !i.isApproved).length > 1 ? "s" : ""})
                                </Text>
                            </View>
                            <Text
                                style={{
                                    color: darkMode ? "#FECACA" : "#B91C1C",
                                    fontSize: 12,
                                    lineHeight: 17,
                                }}
                            >
                                One or more scanned papers had lighting (too dark/too light), QR code visibility, 4 corner markers, or paper flatness/edge issues. Please inspect or rescan flagged papers below.
                            </Text>
                        </View>
                    )}

                    {filteredItems.length === 0 ? (
                        <View style={styles.emptyWrap}>
                            <Ionicons name="documents-outline" size={48} color={textSub} style={{ marginBottom: 12 }} />
                            <Text style={[styles.emptyTitle, { color: textMain }]}>
                                {filterTab === "REVIEW" ? "All Flagged Papers Resolved!" : "No Papers Found"}
                            </Text>
                            <Text style={[styles.emptySub, { color: textSub }]}>
                                {filterTab === "REVIEW"
                                    ? "Every scanned test paper is validated and ready for recording."
                                    : "Scan papers using the camera or gallery import to start batch grading."}
                            </Text>
                        </View>
                    ) : (
                        filteredItems.map((item, index) => {
                            const isGrading = item.status === "queued" || item.status === "optimizing" || item.status === "grading";
                            const isError = item.status === "error";
                            const isReady = item.status === "ready" || item.isApproved;
                            const needsReview = item.status === "needs_review" && !item.isApproved;

                            const percentage = item.gradingResult
                                ? Math.round((item.gradingResult.totalScore / (item.gradingResult.maxScore || 1)) * 100)
                                : 0;

                            const displayName = item.matchedStudentName || item.studentNameExtracted || `Paper #${index + 1}`;
                            const isUnmatched = !item.matchedStudentId;

                            return (
                                <View key={item.id} style={[styles.sheetCard, { backgroundColor: cardBg, borderColor: border }]}>
                                    <View style={styles.cardHeaderRow}>
                                        {/* Paper Thumbnail (Tap to view full sheet image) */}
                                        <TouchableOpacity
                                            style={styles.thumbTouchable}
                                            onPress={() => setPreviewImageUri(item.imageUri)}
                                            activeOpacity={0.8}
                                        >
                                            <Image source={{ uri: item.imageUri }} style={styles.cardThumb} />
                                            <View style={styles.thumbBadge}>
                                                <Ionicons name="scan-outline" size={11} color="#ffffff" />
                                            </View>
                                        </TouchableOpacity>

                                        {/* Name & Match Status */}
                                        <View style={styles.cardInfo}>
                                            <View style={styles.nameRow}>
                                                <Text style={[styles.studentName, { color: textMain }]} numberOfLines={1}>
                                                    {displayName}
                                                </Text>
                                                {item.isAutoMatched && (
                                                    <View style={styles.autoMatchBadge}>
                                                        <Ionicons name="checkmark-done" size={12} color="#10B981" />
                                                        <Text style={styles.autoMatchText}>Roster</Text>
                                                    </View>
                                                )}
                                            </View>

                                            {isUnmatched && !isGrading && !isError && (
                                                <TouchableOpacity
                                                    style={styles.unmatchedPrompt}
                                                    onPress={() => setAssignPickerItemId(item.id)}
                                                >
                                                    <Ionicons name="person-add-outline" size={13} color="#F59E0B" />
                                                    <Text style={styles.unmatchedPromptText}>
                                                        Detected: "{item.studentNameExtracted || "Unknown"}" • Tap to link student
                                                    </Text>
                                                </TouchableOpacity>
                                            )}

                                            {item.gradingResult && (
                                                <Text style={[styles.scoreSummary, { color: textSub }]}>
                                                    Score: <Text style={{ fontWeight: "700", color: textMain }}>{item.gradingResult.totalScore}</Text> / {item.gradingResult.maxScore} pts
                                                </Text>
                                            )}
                                        </View>

                                        {/* Score / Status Pill */}
                                        <View style={styles.cardRightCol}>
                                            {isGrading ? (
                                                <View style={styles.statusPillGrading}>
                                                    <ActivityIndicator size="small" color="#3B82F6" />
                                                    <Text style={styles.statusPillGradingText}>Grading</Text>
                                                </View>
                                            ) : isError ? (
                                                <View style={styles.statusPillError}>
                                                    <Ionicons name="alert-circle" size={14} color="#EF4444" />
                                                    <Text style={styles.statusPillErrorText}>Error</Text>
                                                </View>
                                            ) : (
                                                <View
                                                    style={[
                                                        styles.scoreBadge,
                                                        percentage >= 75 ? styles.scoreBadgePass : styles.scoreBadgeFail,
                                                    ]}
                                                >
                                                    <Text
                                                        style={[
                                                            styles.scoreBadgeText,
                                                            percentage >= 75 ? styles.scoreTextPass : styles.scoreTextFail,
                                                        ]}
                                                    >
                                                        {percentage}%
                                                    </Text>
                                                </View>
                                            )}

                                            <TouchableOpacity
                                                style={styles.removeBtn}
                                                onPress={() => onRemoveItem(item.id)}
                                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                            >
                                                <Ionicons name="trash-outline" size={15} color={textSub} />
                                            </TouchableOpacity>
                                        </View>
                                    </View>

                                    {/* Photo Quality Warning Box (Lighting, QR, 4 Corner Markers, Flatness/Edges) */}
                                    {item.photoQuality?.hasWarnings &&
                                        item.photoQuality.warnings.length > 0 &&
                                        !item.isApproved && (
                                            <View
                                                style={{
                                                    marginTop: 10,
                                                    padding: 10,
                                                    borderRadius: 10,
                                                    backgroundColor: darkMode ? "#7F1D1D30" : "#FEF2F2",
                                                    borderWidth: 1,
                                                    borderColor: "#EF4444",
                                                }}
                                            >
                                                <View
                                                    style={{
                                                        flexDirection: "row",
                                                        alignItems: "center",
                                                        justifyContent: "space-between",
                                                        marginBottom: 4,
                                                    }}
                                                >
                                                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
                                                        <Ionicons name="warning" size={15} color="#EF4444" />
                                                        <Text
                                                            style={{
                                                                color: darkMode ? "#FCA5A5" : "#991B1B",
                                                                fontSize: 12,
                                                                fontWeight: "800",
                                                            }}
                                                        >
                                                            Photo Scan Quality Alert
                                                        </Text>
                                                    </View>
                                                    {item.flaggedCount === 0 && Boolean(item.matchedStudentId) && (
                                                        <TouchableOpacity
                                                            style={{
                                                                backgroundColor: "#10B981",
                                                                paddingHorizontal: 9,
                                                                paddingVertical: 4,
                                                                borderRadius: 6,
                                                            }}
                                                            onPress={() =>
                                                                onUpdateItem(item.id, {
                                                                    status: "ready",
                                                                    isApproved: true,
                                                                })
                                                            }
                                                            activeOpacity={0.8}
                                                        >
                                                            <Text style={{ color: "#FFFFFF", fontSize: 11, fontWeight: "700" }}>
                                                                Approve Anyway
                                                            </Text>
                                                        </TouchableOpacity>
                                                    )}
                                                </View>
                                                {item.photoQuality.warnings.map((w, wIdx) => (
                                                    <Text
                                                        key={wIdx}
                                                        style={{
                                                            color: darkMode ? "#FECACA" : "#B91C1C",
                                                            fontSize: 11.5,
                                                            lineHeight: 16,
                                                            marginTop: 2,
                                                        }}
                                                    >
                                                        • {w}
                                                    </Text>
                                                ))}
                                            </View>
                                        )}

                                    {/* Flag Alert & Resolve Button for Unclear or Double-Shaded Questions */}
                                    {needsReview && item.flaggedCount > 0 && (
                                        <View style={styles.flagNotice}>
                                            <View style={styles.flagNoticeLeft}>
                                                <Ionicons name="alert-circle" size={16} color="#F59E0B" />
                                                <Text style={styles.flagNoticeText}>
                                                    {item.flaggedCount} Question{item.flaggedCount > 1 ? "s" : ""} Flagged (
                                                    {(item.gradingResult?.results || [])
                                                        .filter(
                                                            (r) =>
                                                                (r.flaggedForReview ||
                                                                    r.flagReason === "double_mark" ||
                                                                    r.flagReason === "unclear" ||
                                                                    r.flagReason === "low_confidence" ||
                                                                    (r.confidence !== undefined && r.confidence < 0.75)) &&
                                                                !r.isOverridden
                                                        )
                                                        .map((r) => `Q${r.questionNumber}`)
                                                        .join(", ") || "unclear / double-mark"}
                                                    )
                                                </Text>
                                            </View>
                                            <TouchableOpacity
                                                style={styles.resolveBtn}
                                                onPress={() => handleOpenReview(item, true)}
                                            >
                                                <Text style={styles.resolveBtnText}>Resolve</Text>
                                                <Ionicons name="chevron-forward" size={14} color="#ffffff" />
                                            </TouchableOpacity>
                                        </View>
                                    )}

                                    {/* Actions Row: View Answers & View Captured Test Paper Photo (Available on all graded papers) */}
                                    {item.gradingResult && (
                                        <View style={styles.actionBtnsRow}>
                                            <TouchableOpacity
                                                style={[styles.answerActionBtn, { backgroundColor: darkMode ? "#374151" : "#F1F5F9", borderColor: border }]}
                                                onPress={() => handleOpenReview(item, false)}
                                                activeOpacity={0.7}
                                            >
                                                <Ionicons name="list-outline" size={14} color={accentColor} />
                                                <Text style={[styles.answerActionBtnText, { color: textMain }]}>View Answers</Text>
                                            </TouchableOpacity>

                                            <TouchableOpacity
                                                style={[styles.answerActionBtn, { backgroundColor: darkMode ? "#374151" : "#F1F5F9", borderColor: border }]}
                                                onPress={() => setPreviewImageUri(item.imageUri)}
                                                activeOpacity={0.7}
                                            >
                                                <Ionicons name="image-outline" size={14} color={textSub} />
                                                <Text style={[styles.answerActionBtnText, { color: textSub }]}>View Paper Photo</Text>
                                            </TouchableOpacity>
                                        </View>
                                    )}
                                </View>
                            );
                        })
                    )}
                </ScrollView>

                {/* Bottom Commit Action Bar */}
                <View style={[styles.bottomBar, { backgroundColor: cardBg, borderTopColor: border }]}>
                    <View style={styles.bottomStatsCol}>
                        <Text style={[styles.bottomStatsTitle, { color: textMain }]}>
                            {stats.readyCount} of {items.length} Ready
                        </Text>
                        <Text style={[styles.bottomStatsSub, { color: textSub }]}>
                            {stats.needsReviewCount > 0
                                ? `${stats.needsReviewCount} flagged papers remaining`
                                : "All papers verified for gradebook"}
                        </Text>
                    </View>

                    <TouchableOpacity
                        style={[
                            styles.commitBtn,
                            { backgroundColor: "#10B981" },
                            (stats.readyCount === 0 || isSaving) && styles.commitBtnDisabled,
                        ]}
                        onPress={handleCommit}
                        disabled={stats.readyCount === 0 || isSaving}
                    >
                        {isSaving ? (
                            <ActivityIndicator size="small" color="#ffffff" />
                        ) : (
                            <>
                                <Ionicons name="checkmark-circle" size={18} color="#ffffff" />
                                <Text style={styles.commitBtnText}>
                                    Approve & Record ({stats.readyCount})
                                </Text>
                            </>
                        )}
                    </TouchableOpacity>
                </View>

                {/* Manual Question Review Modal (reusing LowConfidenceReviewModal) */}
                {reviewModalOpen && activeReviewItem && (
                    <LowConfidenceReviewModal
                        visible={reviewModalOpen}
                        onClose={() => {
                            setReviewModalOpen(false);
                            setActiveReviewItem(null);
                        }}
                        gradingResult={activeReviewItem.gradingResult || null}
                        scannedImageUri={activeReviewItem.imageUri}
                        accentColor={accentColor}
                        initialFilterOnlyFlagged={reviewOnlyFlagged}
                        initialQuestionNumber={
                            reviewOnlyFlagged
                                ? activeReviewItem.gradingResult?.results?.find(
                                      (r) =>
                                          (r.flaggedForReview ||
                                              r.flagReason === "double_mark" ||
                                              r.flagReason === "unclear" ||
                                              r.flagReason === "low_confidence" ||
                                              (r.confidence !== undefined && r.confidence < 0.75)) &&
                                          !r.isOverridden
                                  )?.questionNumber
                                : 1
                        }
                        onSaveReviewedResults={handleSaveReviewedResults}
                    />
                )}

                {/* Full-Screen Test Paper Image Preview Modal */}
                {previewImageUri && (
                    <Modal visible transparent animationType="fade" onRequestClose={() => setPreviewImageUri(null)}>
                        <View style={styles.fullImageOverlay}>
                            <TouchableOpacity style={styles.fullImageCloseBtn} onPress={() => setPreviewImageUri(null)}>
                                <Ionicons name="close" size={26} color="#FFFFFF" />
                            </TouchableOpacity>
                            <Image source={{ uri: previewImageUri }} style={styles.fullImage} resizeMode="contain" />
                        </View>
                    </Modal>
                )}

                {/* Quick Student Assign Modal */}
                {assignPickerItemId && (
                    <Modal transparent visible animationType="fade" onRequestClose={() => setAssignPickerItemId(null)}>
                        <TouchableOpacity
                            style={styles.assignOverlay}
                            activeOpacity={1}
                            onPress={() => setAssignPickerItemId(null)}
                        >
                            <View style={[styles.assignSheet, { backgroundColor: cardBg }]}>
                                <Text style={[styles.assignTitle, { color: textMain }]}>Assign to Enrolled Student</Text>
                                <ScrollView style={{ maxHeight: 320 }}>
                                    {roster.map((s) => (
                                        <TouchableOpacity
                                            key={s.id}
                                            style={[styles.assignItem, { borderBottomColor: border }]}
                                            onPress={() => handleAssignStudent(assignPickerItemId, s)}
                                        >
                                            <Ionicons name="person-outline" size={16} color={accentColor} />
                                            <Text style={[styles.assignItemText, { color: textMain }]}>{s.full_name}</Text>
                                        </TouchableOpacity>
                                    ))}
                                </ScrollView>
                            </View>
                        </TouchableOpacity>
                    </Modal>
                )}
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingTop: 48,
        paddingBottom: 14,
        borderBottomWidth: 1,
    },
    closeBtn: {
        padding: 6,
    },
    headerTitles: {
        flex: 1,
        marginHorizontal: 12,
    },
    mainTitle: {
        fontSize: 16,
        fontWeight: "800",
    },
    subTitle: {
        fontSize: 12,
        fontWeight: "500",
        marginTop: 1,
    },
    scanMoreBtn: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: 1.5,
    },
    scanMoreBtnText: {
        fontSize: 12.5,
        fontWeight: "700",
    },
    statsContainer: {
        flexDirection: "row",
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 8,
    },
    statBox: {
        flex: 1,
        alignItems: "center",
        paddingVertical: 10,
        borderRadius: 12,
        borderWidth: 1,
    },
    statValue: {
        fontSize: 18,
        fontWeight: "800",
    },
    statLabel: {
        fontSize: 10,
        fontWeight: "700",
        textTransform: "uppercase",
        marginTop: 2,
    },
    tabsRow: {
        flexDirection: "row",
        paddingHorizontal: 16,
        borderBottomWidth: 1,
    },
    tabItem: {
        paddingVertical: 12,
        paddingHorizontal: 12,
        borderBottomWidth: 2.5,
        borderBottomColor: "transparent",
    },
    tabText: {
        fontSize: 13,
        fontWeight: "600",
    },
    tabBadgeWrap: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    reviewAlertBadge: {
        backgroundColor: "#F59E0B",
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 10,
    },
    reviewAlertBadgeText: {
        color: "#ffffff",
        fontSize: 10.5,
        fontWeight: "800",
    },
    listContent: {
        padding: 16,
        paddingBottom: 100,
        gap: 12,
    },
    emptyWrap: {
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 64,
        paddingHorizontal: 24,
    },
    emptyTitle: {
        fontSize: 17,
        fontWeight: "700",
        textAlign: "center",
    },
    emptySub: {
        fontSize: 13,
        textAlign: "center",
        marginTop: 4,
        lineHeight: 18,
    },
    sheetCard: {
        borderRadius: 14,
        borderWidth: 1,
        padding: 14,
        gap: 10,
    },
    cardHeaderRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    cardThumb: {
        width: 48,
        height: 60,
        borderRadius: 6,
        backgroundColor: "#374151",
    },
    cardInfo: {
        flex: 1,
        justifyContent: "center",
    },
    nameRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    studentName: {
        fontSize: 14.5,
        fontWeight: "700",
        flexShrink: 1,
    },
    autoMatchBadge: {
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
        backgroundColor: "rgba(16,185,129,0.12)",
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 6,
    },
    autoMatchText: {
        color: "#10B981",
        fontSize: 10,
        fontWeight: "700",
    },
    unmatchedPrompt: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        marginTop: 3,
    },
    unmatchedPromptText: {
        color: "#F59E0B",
        fontSize: 11.5,
        fontWeight: "600",
    },
    scoreSummary: {
        fontSize: 12,
        marginTop: 3,
    },
    cardRightCol: {
        alignItems: "flex-end",
        gap: 6,
    },
    statusPillGrading: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        backgroundColor: "rgba(59,130,246,0.12)",
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
    },
    statusPillGradingText: {
        color: "#3B82F6",
        fontSize: 11,
        fontWeight: "700",
    },
    statusPillError: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        backgroundColor: "rgba(239,68,68,0.12)",
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
    },
    statusPillErrorText: {
        color: "#EF4444",
        fontSize: 11,
        fontWeight: "700",
    },
    scoreBadge: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 8,
    },
    scoreBadgePass: {
        backgroundColor: "rgba(16,185,129,0.12)",
    },
    scoreBadgeFail: {
        backgroundColor: "rgba(239,68,68,0.12)",
    },
    scoreBadgeText: {
        fontSize: 14,
        fontWeight: "800",
    },
    scoreTextPass: {
        color: "#10B981",
        fontSize: 14,
        fontWeight: "800",
    },
    scoreTextFail: {
        color: "#EF4444",
        fontSize: 14,
        fontWeight: "800",
    },
    removeBtn: {
        padding: 4,
    },
    flagNotice: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        backgroundColor: "rgba(245,158,11,0.12)",
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: "rgba(245,158,11,0.25)",
    },
    flagNoticeLeft: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        flex: 1,
    },
    flagNoticeText: {
        color: "#D97706",
        fontSize: 12,
        fontWeight: "600",
    },
    resolveBtn: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        backgroundColor: "#D97706",
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 6,
    },
    resolveBtnText: {
        color: "#ffffff",
        fontSize: 12,
        fontWeight: "700",
    },
    thumbTouchable: {
        position: "relative",
    },
    thumbBadge: {
        position: "absolute",
        bottom: 3,
        right: 3,
        backgroundColor: "rgba(0,0,0,0.65)",
        borderRadius: 4,
        padding: 2,
    },
    actionBtnsRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        marginTop: 2,
    },
    answerActionBtn: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        paddingVertical: 7,
        borderRadius: 8,
        borderWidth: 1,
    },
    answerActionBtnText: {
        fontSize: 12,
        fontWeight: "600",
    },
    inspectBtn: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        alignSelf: "flex-start",
        paddingVertical: 2,
    },
    inspectBtnText: {
        fontSize: 12,
        fontWeight: "500",
    },
    fullImageOverlay: {
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.92)",
        justifyContent: "center",
        alignItems: "center",
    },
    fullImageCloseBtn: {
        position: "absolute",
        top: 48,
        right: 20,
        zIndex: 10,
        padding: 8,
        backgroundColor: "rgba(255,255,255,0.2)",
        borderRadius: 20,
    },
    fullImage: {
        width: "92%",
        height: "82%",
    },
    bottomBar: {
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 20,
        paddingVertical: 14,
        borderTopWidth: 1,
    },
    bottomStatsCol: {
        flex: 1,
    },
    bottomStatsTitle: {
        fontSize: 14,
        fontWeight: "800",
    },
    bottomStatsSub: {
        fontSize: 11.5,
        marginTop: 2,
    },
    commitBtn: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 18,
        paddingVertical: 12,
        borderRadius: 12,
    },
    commitBtnDisabled: {
        opacity: 0.5,
    },
    commitBtnText: {
        color: "#ffffff",
        fontSize: 13.5,
        fontWeight: "800",
    },
    assignOverlay: {
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.5)",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
    },
    assignSheet: {
        width: "100%",
        borderRadius: 16,
        padding: 20,
        maxHeight: 400,
    },
    assignTitle: {
        fontSize: 16,
        fontWeight: "800",
        marginBottom: 14,
    },
    assignItem: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 12,
        borderBottomWidth: 1,
    },
    assignItemText: {
        fontSize: 14,
        fontWeight: "600",
    },
});
