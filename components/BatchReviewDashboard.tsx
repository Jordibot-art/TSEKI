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
    Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
    const insets = useSafeAreaInsets();

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
        <Modal
            visible={visible}
            animationType="slide"
            transparent={true}
            statusBarTranslucent={true}
            onRequestClose={onClose}
        >
            <View style={styles.modalRoot}>
                {/* Full-Screen Dimmed Backdrop */}
                <Pressable style={styles.modalBackdrop} onPress={onClose} />

                {/* Bottom-Anchored Sheet Container */}
                <View style={[styles.sheetContainer, { backgroundColor: bg }]}>
                    {/* Centered Drag Pill */}
                    <View style={[styles.dragPill, { backgroundColor: darkMode ? "#475569" : "#CBD5E1" }]} />

                    {/* Header */}
                    <View style={[styles.header, { backgroundColor: cardBg, borderBottomColor: border }]}>
                        <TouchableOpacity style={styles.closeBtn} onPress={onClose} disabled={isSaving}>
                            <Ionicons name="close" size={22} color={textMain} />
                        </TouchableOpacity>
                        <View style={styles.headerTitles}>
                            <Text style={[styles.mainTitle, { color: textMain }]} numberOfLines={1}>
                                Batch Review: {quizTitle || "Assessment"}
                            </Text>
                            <Text style={[styles.subTitle, { color: textSub }]}>
                                {classTitle} · {items.length} {items.length === 1 ? "Paper" : "Papers"} Scanned
                            </Text>
                        </View>
                        <TouchableOpacity
                            style={[styles.scanMoreBtn, { borderColor: border }]}
                            onPress={onScanMore}
                            disabled={isSaving}
                        >
                            <Ionicons name="camera-outline" size={15} color={textMain} />
                            <Text style={[styles.scanMoreBtnText, { color: textMain }]}>Add</Text>
                        </TouchableOpacity>
                    </View>

                    {/* 4-Column KPI Strip */}
                    <View style={styles.statsContainer}>
                        <View style={[styles.statBox, { backgroundColor: cardBg, borderColor: border }]}>
                            <Text style={[styles.statValue, { color: darkMode ? "#F8FAFC" : "#0F172A" }]}>
                                {stats.total}
                            </Text>
                            <Text style={[styles.statLabel, { color: textSub }]}>Scanned</Text>
                        </View>
                        <View style={[styles.statBox, { backgroundColor: cardBg, borderColor: border }]}>
                            <Text style={[styles.statValue, { color: darkMode ? "#F8FAFC" : "#0F172A" }]}>
                                {stats.gradedCount > 0 ? `${stats.average}%` : "—"}
                            </Text>
                            <Text style={[styles.statLabel, { color: textSub }]}>Class Avg</Text>
                        </View>
                        <View style={[styles.statBox, { backgroundColor: cardBg, borderColor: border }]}>
                            <Text style={[styles.statValue, { color: darkMode ? "#F8FAFC" : "#0F172A" }]}>
                                {stats.gradedCount > 0 ? `${stats.passRate}%` : "—"}
                            </Text>
                            <Text style={[styles.statLabel, { color: textSub }]}>Pass Rate</Text>
                        </View>
                        <View style={[styles.statBox, { backgroundColor: cardBg, borderColor: border }]}>
                            <Text
                                style={[
                                    styles.statValue,
                                    {
                                        color:
                                            stats.needsReviewCount > 0
                                                ? "#D97706"
                                                : darkMode
                                                ? "#F8FAFC"
                                                : "#0F172A",
                                    },
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
                            style={[styles.tabItem, filterTab === "ALL" && { borderBottomColor: darkMode ? "#F8FAFC" : "#0F172A" }]}
                            onPress={() => setFilterTab("ALL")}
                        >
                            <Text
                                style={[
                                    styles.tabText,
                                    filterTab === "ALL"
                                        ? { color: darkMode ? "#F8FAFC" : "#0F172A", fontWeight: "700" }
                                        : { color: textSub },
                                ]}
                            >
                                All Papers ({items.length})
                            </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.tabItem, filterTab === "REVIEW" && { borderBottomColor: "#D97706" }]}
                            onPress={() => setFilterTab("REVIEW")}
                        >
                            <View style={styles.tabBadgeWrap}>
                                <Text
                                    style={[
                                        styles.tabText,
                                        filterTab === "REVIEW"
                                            ? { color: "#D97706", fontWeight: "700" }
                                            : { color: textSub },
                                    ]}
                                >
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
                            style={[styles.tabItem, filterTab === "READY" && { borderBottomColor: "#16A34A" }]}
                            onPress={() => setFilterTab("READY")}
                        >
                            <Text
                                style={[
                                    styles.tabText,
                                    filterTab === "READY"
                                        ? { color: "#16A34A", fontWeight: "700" }
                                        : { color: textSub },
                                ]}
                            >
                                Ready ({stats.readyCount})
                            </Text>
                        </TouchableOpacity>
                    </View>

                    {/* Student Papers List */}
                    <ScrollView contentContainerStyle={styles.listContent}>
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
                                const needsReview = item.status === "needs_review" && !item.isApproved;

                                const percentage = item.gradingResult
                                    ? Math.round((item.gradingResult.totalScore / (item.gradingResult.maxScore || 1)) * 100)
                                    : 0;

                                const displayName = item.matchedStudentName || item.studentNameExtracted || `Paper #${index + 1}`;
                                const isUnmatched = !item.matchedStudentId;

                                // Build concise combined alert text (Flagged Questions + Photo Quality)
                                const alertParts: string[] = [];
                                if (needsReview && (item.flaggedCount || 0) > 0) {
                                    const flaggedQList = (item.gradingResult?.results || [])
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
                                        .join(", ");
                                    alertParts.push(
                                        `${item.flaggedCount} Question${item.flaggedCount > 1 ? "s" : ""} Flagged${
                                            flaggedQList ? ` (${flaggedQList})` : ""
                                        }`
                                    );
                                }

                                const hasPhotoWarning = Boolean(
                                    item.photoQuality?.hasWarnings &&
                                    item.photoQuality.warnings.length > 0 &&
                                    !item.isApproved
                                );
                                if (hasPhotoWarning) {
                                    const rawWarn = item.photoQuality!.warnings[0] || "";
                                    const cornerMatch = rawWarn.match(/\((\d\/4)\s*detected\)/i);
                                    if (cornerMatch) {
                                        alertParts.push(`${cornerMatch[1]} corner markers`);
                                    } else {
                                        const conciseWarn = rawWarn.split("—")[0].trim();
                                        alertParts.push(conciseWarn || "Photo quality warning");
                                    }
                                }

                                const totalQuestions = item.gradingResult?.results?.length || item.gradingResult?.maxScore || 10;

                                return (
                                    <View key={item.id} style={[styles.sheetCard, { backgroundColor: cardBg, borderColor: border }]}>
                                        {/* Header Row of Student Card */}
                                        <View style={styles.cardHeaderRow}>
                                            {/* Left: Tappable paper thumbnail (44x56px, borderRadius: 6) */}
                                            <TouchableOpacity
                                                style={styles.thumbTouchable}
                                                onPress={() => setPreviewImageUri(item.imageUri)}
                                                activeOpacity={0.8}
                                            >
                                                <Image source={{ uri: item.imageUri }} style={styles.cardThumb} />
                                                <View style={styles.thumbBadge}>
                                                    <Ionicons name="search" size={10} color="#ffffff" />
                                                </View>
                                            </TouchableOpacity>

                                            {/* Middle (flex: 1): Full student name & score/roster status */}
                                            <View style={styles.cardInfo}>
                                                <Text
                                                    style={[styles.studentName, { color: darkMode ? "#F8FAFC" : "#0F172A" }]}
                                                    numberOfLines={1}
                                                >
                                                    {displayName}
                                                </Text>

                                                {isUnmatched && !isGrading && !isError ? (
                                                    <TouchableOpacity
                                                        style={styles.unmatchedPrompt}
                                                        onPress={() => setAssignPickerItemId(item.id)}
                                                    >
                                                        <Ionicons name="person-add-outline" size={12} color="#D97706" />
                                                        <Text style={styles.unmatchedPromptText} numberOfLines={1}>
                                                            Link "{item.studentNameExtracted || "Unknown"}" to Roster ›
                                                        </Text>
                                                    </TouchableOpacity>
                                                ) : (
                                                    <Text style={[styles.scoreSummary, { color: darkMode ? "#94A3B8" : "#475569" }]} numberOfLines={1}>
                                                        {item.gradingResult ? (
                                                            <>
                                                                <Text style={{ fontWeight: "700", color: darkMode ? "#F8FAFC" : "#0F172A" }}>
                                                                    {item.gradingResult.totalScore}
                                                                </Text>
                                                                {` / ${item.gradingResult.maxScore} pts`}
                                                            </>
                                                        ) : (
                                                            "Processing..."
                                                        )}
                                                        {item.matchedStudentId && (
                                                            <Text style={styles.matchedRosterInline}>
                                                                {"  ·  Matched to Roster"}
                                                            </Text>
                                                        )}
                                                    </Text>
                                                )}
                                            </View>

                                            {/* Right: Score percentage badge & subtle Trash icon */}
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

                                        {/* Combined Compact Alert Banner Inside Student Card */}
                                        {alertParts.length > 0 && (
                                            <View
                                                style={[
                                                    styles.compactCardBanner,
                                                    {
                                                        backgroundColor: darkMode ? "#78350F25" : "#FFFBEB",
                                                        borderColor: darkMode ? "#92400E" : "#FDE68A",
                                                    },
                                                ]}
                                            >
                                                <Ionicons name="alert-circle" size={15} color="#D97706" />
                                                <Text
                                                    style={[
                                                        styles.compactCardBannerText,
                                                        { color: darkMode ? "#FDE68A" : "#B45309" },
                                                    ]}
                                                    numberOfLines={1}
                                                >
                                                    {alertParts.join(" · ")}
                                                </Text>
                                                {item.flaggedCount === 0 && hasPhotoWarning && Boolean(item.matchedStudentId) && (
                                                    <TouchableOpacity
                                                        style={styles.approveAnywayBtn}
                                                        onPress={() =>
                                                            onUpdateItem(item.id, {
                                                                status: "ready",
                                                                isApproved: true,
                                                            })
                                                        }
                                                        activeOpacity={0.8}
                                                    >
                                                        <Text style={styles.approveAnywayBtnText}>Approve</Text>
                                                    </TouchableOpacity>
                                                )}
                                            </View>
                                        )}

                                        {/* Single Action Row */}
                                        {item.gradingResult && (
                                            <View style={styles.actionBtnsRow}>
                                                {needsReview && (item.flaggedCount || 0) > 0 ? (
                                                    <>
                                                        <TouchableOpacity
                                                            style={[styles.primaryReviewBtn, { backgroundColor: "#D97706" }]}
                                                            onPress={() => handleOpenReview(item, true)}
                                                            activeOpacity={0.8}
                                                        >
                                                            <Text style={styles.primaryReviewBtnText}>
                                                                Review {item.flaggedCount} Flagged
                                                            </Text>
                                                        </TouchableOpacity>

                                                        <TouchableOpacity
                                                            style={[
                                                                styles.secondaryOutlineBtn,
                                                                {
                                                                    backgroundColor: darkMode ? "#1E293B" : "#FFFFFF",
                                                                    borderColor: border,
                                                                },
                                                            ]}
                                                            onPress={() => handleOpenReview(item, false)}
                                                            activeOpacity={0.7}
                                                        >
                                                            <Text style={[styles.secondaryOutlineBtnText, { color: textMain }]}>
                                                                All Answers ({totalQuestions})
                                                            </Text>
                                                        </TouchableOpacity>
                                                    </>
                                                ) : (
                                                    <TouchableOpacity
                                                        style={[
                                                            styles.secondaryOutlineBtn,
                                                            {
                                                                backgroundColor: darkMode ? "#1E293B" : "#F8FAFC",
                                                                borderColor: border,
                                                            },
                                                        ]}
                                                        onPress={() => handleOpenReview(item, false)}
                                                        activeOpacity={0.7}
                                                    >
                                                        <Ionicons name="list-outline" size={14} color={textSub} />
                                                        <Text style={[styles.secondaryOutlineBtnText, { color: textMain }]}>
                                                            View All Answers
                                                        </Text>
                                                    </TouchableOpacity>
                                                )}
                                            </View>
                                        )}
                                    </View>
                                );
                            })
                        )}
                    </ScrollView>

                    {/* Bottom Commit Action Bar */}
                    <View
                        style={[
                            styles.bottomBar,
                            {
                                backgroundColor: cardBg,
                                borderTopColor: border,
                                paddingBottom: Math.max(insets.bottom, 14),
                            },
                        ]}
                    >
                        <View style={styles.bottomStatsCol}>
                            <Text style={[styles.bottomStatsTitle, { color: textMain }]}>
                                {stats.readyCount} of {items.length} Ready
                            </Text>
                            <Text style={[styles.bottomStatsSub, { color: textSub }]}>
                                {stats.needsReviewCount > 0
                                    ? `${stats.needsReviewCount} flagged ${stats.needsReviewCount === 1 ? "paper" : "papers"} remaining`
                                    : "All papers verified for gradebook"}
                            </Text>
                        </View>

                        <TouchableOpacity
                            style={[
                                styles.commitBtn,
                                { backgroundColor: "#16A34A" },
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
                        studentName={
                            activeReviewItem.matchedStudentName ||
                            activeReviewItem.studentNameExtracted ||
                            undefined
                        }
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
    modalRoot: {
        flex: 1,
        justifyContent: "flex-end",
    },
    modalBackdrop: {
        position: "absolute",
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: "rgba(15, 23, 42, 0.45)",
    },
    sheetContainer: {
        height: "94%",
        width: "100%",
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
        overflow: "hidden",
    },
    dragPill: {
        width: 36,
        height: 4,
        borderRadius: 999,
        alignSelf: "center",
        marginTop: 10,
        marginBottom: 6,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingTop: 6,
        paddingBottom: 12,
        borderBottomWidth: 1,
    },
    closeBtn: {
        padding: 4,
    },
    headerTitles: {
        flex: 1,
        marginHorizontal: 10,
    },
    mainTitle: {
        fontSize: 16,
        fontWeight: "700",
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
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
    },
    scanMoreBtnText: {
        fontSize: 12.5,
        fontWeight: "600",
    },
    statsContainer: {
        flexDirection: "row",
        paddingHorizontal: 16,
        paddingVertical: 10,
        gap: 8,
    },
    statBox: {
        flex: 1,
        alignItems: "center",
        paddingVertical: 9,
        borderRadius: 10,
        borderWidth: 1,
    },
    statValue: {
        fontSize: 18,
        fontWeight: "700",
    },
    statLabel: {
        fontSize: 10,
        fontWeight: "600",
        textTransform: "uppercase",
        marginTop: 2,
    },
    tabsRow: {
        flexDirection: "row",
        paddingHorizontal: 16,
        borderBottomWidth: 1,
    },
    tabItem: {
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderBottomWidth: 2,
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
        backgroundColor: "#D97706",
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 10,
    },
    reviewAlertBadgeText: {
        color: "#ffffff",
        fontSize: 10.5,
        fontWeight: "700",
    },
    listContent: {
        padding: 16,
        paddingBottom: 110,
        gap: 12,
    },
    emptyWrap: {
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 64,
        paddingHorizontal: 24,
    },
    emptyTitle: {
        fontSize: 16,
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
        borderRadius: 12,
        borderWidth: 1,
        padding: 12,
        gap: 10,
    },
    cardHeaderRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    thumbTouchable: {
        position: "relative",
    },
    cardThumb: {
        width: 44,
        height: 56,
        borderRadius: 6,
        backgroundColor: "#374151",
    },
    thumbBadge: {
        position: "absolute",
        bottom: 3,
        right: 3,
        backgroundColor: "rgba(15, 23, 42, 0.7)",
        borderRadius: 4,
        padding: 2,
    },
    cardInfo: {
        flex: 1,
        justifyContent: "center",
        minWidth: 0,
    },
    studentName: {
        fontSize: 15,
        fontWeight: "600",
    },
    scoreSummary: {
        fontSize: 13,
        marginTop: 3,
    },
    matchedRosterInline: {
        color: "#16A34A",
        fontSize: 12,
        fontWeight: "600",
    },
    unmatchedPrompt: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        marginTop: 3,
    },
    unmatchedPromptText: {
        color: "#D97706",
        fontSize: 12,
        fontWeight: "600",
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
        borderRadius: 8,
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
        borderRadius: 8,
    },
    statusPillErrorText: {
        color: "#EF4444",
        fontSize: 11,
        fontWeight: "700",
    },
    scoreBadge: {
        paddingHorizontal: 9,
        paddingVertical: 3,
        borderRadius: 6,
    },
    scoreBadgePass: {
        backgroundColor: "rgba(22, 163, 74, 0.12)",
    },
    scoreBadgeFail: {
        backgroundColor: "rgba(220, 38, 38, 0.12)",
    },
    scoreBadgeText: {
        fontSize: 13.5,
        fontWeight: "700",
    },
    scoreTextPass: {
        color: "#16A34A",
    },
    scoreTextFail: {
        color: "#DC2626",
    },
    removeBtn: {
        padding: 4,
    },
    compactCardBanner: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 7,
        borderRadius: 8,
        borderWidth: 1,
    },
    compactCardBannerText: {
        flex: 1,
        fontSize: 12,
        fontWeight: "600",
    },
    approveAnywayBtn: {
        backgroundColor: "#16A34A",
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 5,
    },
    approveAnywayBtnText: {
        color: "#FFFFFF",
        fontSize: 11,
        fontWeight: "700",
    },
    actionBtnsRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    primaryReviewBtn: {
        flex: 1,
        height: 36,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 8,
        paddingHorizontal: 12,
    },
    primaryReviewBtnText: {
        color: "#FFFFFF",
        fontSize: 12.5,
        fontWeight: "700",
    },
    secondaryOutlineBtn: {
        flex: 1,
        height: 36,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        borderRadius: 8,
        borderWidth: 1,
        paddingHorizontal: 12,
    },
    secondaryOutlineBtnText: {
        fontSize: 12.5,
        fontWeight: "600",
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
        paddingHorizontal: 16,
        paddingTop: 12,
        borderTopWidth: 1,
    },
    bottomStatsCol: {
        flex: 1,
    },
    bottomStatsTitle: {
        fontSize: 14,
        fontWeight: "700",
    },
    bottomStatsSub: {
        fontSize: 11.5,
        marginTop: 2,
    },
    commitBtn: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 16,
        paddingVertical: 11,
        borderRadius: 10,
    },
    commitBtnDisabled: {
        opacity: 0.5,
    },
    commitBtnText: {
        color: "#ffffff",
        fontSize: 13.5,
        fontWeight: "700",
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
        fontWeight: "700",
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
