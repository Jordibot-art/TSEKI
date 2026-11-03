import React, { useState, useEffect, useMemo } from "react";
import {
    Modal,
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
    Image,
    TextInput,
    Animated,
    Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../context/ThemeContext";
import { GradingResultItem, GradingResponse, isAnswerAccepted } from "../lib/gradingService";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

export interface LowConfidenceReviewModalProps {
    visible: boolean;
    onClose: () => void;
    gradingResult: GradingResponse | null;
    scannedImageUri?: string | null;
    accentColor?: string;
    initialQuestionNumber?: number;
    initialFilterOnlyFlagged?: boolean;
    onSaveReviewedResults: (updatedResults: GradingResultItem[], newTotalScore: number) => void;
}

export function LowConfidenceReviewModal({
    visible,
    onClose,
    gradingResult,
    scannedImageUri,
    accentColor = "#F97316",
    initialQuestionNumber,
    initialFilterOnlyFlagged,
    onSaveReviewedResults,
}: LowConfidenceReviewModalProps) {
    const { darkMode } = useTheme();

    // Local working copy of items so teacher can fix without committing until "Save & Apply"
    const [workingResults, setWorkingResults] = useState<GradingResultItem[]>([]);
    const [selectedQNum, setSelectedQNum] = useState<number>(1);
    const [filterOnlyFlagged, setFilterOnlyFlagged] = useState<boolean>(true);
    const [imagePreviewOpen, setImagePreviewOpen] = useState<boolean>(false);
    const [customAnswerInput, setCustomAnswerInput] = useState<string>("");

    // Helper to determine if an item was flagged by AI for manual review
    const isItemFlaggedByAi = (r: GradingResultItem) =>
        Boolean(
            r.flaggedForReview ||
            r.flagReason === "double_mark" ||
            r.flagReason === "unclear" ||
            r.flagReason === "low_confidence" ||
            (r.confidence !== undefined && r.confidence < 0.75)
        );

    // Initialize working copy when modal opens or gradingResult changes
    useEffect(() => {
        if (gradingResult && Array.isArray(gradingResult.results)) {
            const deepCopy = gradingResult.results.map((r) => ({ ...r }));
            setWorkingResults(deepCopy);

            const hasAnyFlagged = deepCopy.some(isItemFlaggedByAi);
            if (typeof initialFilterOnlyFlagged === "boolean") {
                setFilterOnlyFlagged(initialFilterOnlyFlagged && hasAnyFlagged);
            } else {
                setFilterOnlyFlagged(hasAnyFlagged);
            }

            // Determine first question to focus on
            if (initialQuestionNumber) {
                setSelectedQNum(initialQuestionNumber);
            } else if (initialFilterOnlyFlagged === false) {
                setSelectedQNum(1);
            } else {
                const firstUnresolvedFlagged = deepCopy.find((r) => isItemFlaggedByAi(r) && !r.isOverridden);
                const firstFlagged = firstUnresolvedFlagged || deepCopy.find(isItemFlaggedByAi);
                setSelectedQNum(firstFlagged ? firstFlagged.questionNumber : 1);
            }
        }
    }, [visible, gradingResult, initialQuestionNumber]);

    // Active item being inspected
    const activeItem = useMemo(() => {
        return workingResults.find((r) => r.questionNumber === selectedQNum) || workingResults[0];
    }, [workingResults, selectedQNum]);

    // Sync custom text input when active item changes
    useEffect(() => {
        if (activeItem) {
            setCustomAnswerInput(activeItem.studentAnswer || "");
        }
    }, [activeItem?.questionNumber]);

    // Compute flagged items (keep resolved items in list so teacher sees progress e.g. "1 item flagged • 1 resolved")
    const flaggedItems = useMemo(() => {
        return workingResults.filter(isItemFlaggedByAi);
    }, [workingResults]);

    const flaggedCount = flaggedItems.length;

    // Filtered list for tabs
    const displayItems = useMemo(() => {
        if (filterOnlyFlagged && flaggedItems.length > 0) {
            return flaggedItems;
        }
        return workingResults;
    }, [filterOnlyFlagged, flaggedItems, workingResults]);

    // Dynamic recomputation of total score
    const computedTotalScore = useMemo(() => {
        return workingResults.reduce((acc, r) => acc + (Number(r.pointsAwarded) || 0), 0);
    }, [workingResults]);

    const resolvedCount = useMemo(() => {
        return flaggedItems.filter((r) => r.isOverridden).length;
    }, [flaggedItems]);

    // ── Update active item answer ───────────────────────────────────────────────
    function handleSelectAnswer(choice: string) {
        if (!activeItem) return;
        const normalizedChoice = choice.trim();
        const official = activeItem.correctAnswer.trim();
        const isMatch = isAnswerAccepted(normalizedChoice, official);
        const itemPoints = 1; // standard point

        setCustomAnswerInput(normalizedChoice);
        setWorkingResults((prev) =>
            prev.map((r) => {
                if (r.questionNumber === activeItem.questionNumber) {
                    return {
                        ...r,
                        studentAnswer: normalizedChoice,
                        isCorrect: isMatch,
                        pointsAwarded: isMatch ? itemPoints : 0,
                        isOverridden: true,
                    };
                }
                return r;
            })
        );
    }

    function handleTogglePoints(award: boolean) {
        if (!activeItem) return;
        setWorkingResults((prev) =>
            prev.map((r) => {
                if (r.questionNumber === activeItem.questionNumber) {
                    return {
                        ...r,
                        isCorrect: award,
                        pointsAwarded: award ? 1 : 0,
                        isOverridden: true,
                    };
                }
                return r;
            })
        );
    }

    function handleResetToAi() {
        if (!activeItem) return;
        const orig = activeItem.originalStudentAnswer ?? "";
        const isMatch = isAnswerAccepted(orig, activeItem.correctAnswer);
        setCustomAnswerInput(orig);
        setWorkingResults((prev) =>
            prev.map((r) => {
                if (r.questionNumber === activeItem.questionNumber) {
                    return {
                        ...r,
                        studentAnswer: orig,
                        isCorrect: isMatch,
                        pointsAwarded: isMatch ? 1 : 0,
                        isOverridden: false,
                        flaggedForReview: true,
                    };
                }
                return r;
            })
        );
    }

    // Navigation
    function handlePrev() {
        const curIdx = displayItems.findIndex((r) => r.questionNumber === selectedQNum);
        if (curIdx > 0) {
            setSelectedQNum(displayItems[curIdx - 1].questionNumber);
        }
    }

    function handleNext() {
        const curIdx = displayItems.findIndex((r) => r.questionNumber === selectedQNum);
        if (curIdx < displayItems.length - 1) {
            setSelectedQNum(displayItems[curIdx + 1].questionNumber);
        }
    }

    // Save and commit
    function handleApplyChanges() {
        onSaveReviewedResults(workingResults, computedTotalScore);
        onClose();
    }

    if (!visible || !gradingResult) return null;

    // Theme tokens
    const bg = darkMode ? "#111827" : "#FFFFFF";
    const cardBg = darkMode ? "#1F2937" : "#F8FAFC";
    const border = darkMode ? "#374151" : "#E2E8F0";
    const textMain = darkMode ? "#F9FAFB" : "#0F172A";
    const textSub = darkMode ? "#9CA3AF" : "#64748B";

    const isCurrentFlagged = activeItem ? isItemFlaggedByAi(activeItem) : false;

    const isMC = Boolean(
        activeItem &&
        (["A", "B", "C", "D"].includes(activeItem.correctAnswer.trim().toUpperCase()) ||
            /^[A-D](?:\s*[,/&]\s*[A-D])*$/i.test((activeItem.studentAnswer || "").trim()) ||
            (activeItem.detectedOptions && activeItem.detectedOptions.some((o) => ["A", "B", "C", "D"].includes(o.toUpperCase()))))
    );
    const isTF = Boolean(
        activeItem && ["T", "F", "TRUE", "FALSE"].includes(activeItem.correctAnswer.trim().toUpperCase())
    );

    return (
        <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
            <View style={[styles.container, { backgroundColor: bg }]}>
                {/* ── TOP NAV HEADER ───────────────────────────────────────────── */}
                <View style={[styles.header, { borderBottomColor: border }]}>
                    <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
                        <Ionicons name="close" size={24} color={textMain} />
                    </TouchableOpacity>

                    <View style={styles.headerCenter}>
                        <View style={styles.headerTitleRow}>
                            <Ionicons name="shield-checkmark" size={20} color="#F59E0B" style={{ marginRight: 6 }} />
                            <Text style={[styles.headerTitle, { color: textMain }]}>Flagged Answers Review</Text>
                        </View>
                        <Text style={[styles.headerSubtitle, { color: textSub }]}>
                            {flaggedCount > 0
                                ? `${flaggedCount} item${flaggedCount > 1 ? "s" : ""} flagged • ${resolvedCount} resolved`
                                : "All items cleanly verified"}
                        </Text>
                    </View>

                    <TouchableOpacity
                        style={[styles.saveHeaderBtn, { backgroundColor: accentColor }]}
                        onPress={handleApplyChanges}
                    >
                        <Text style={styles.saveHeaderBtnText}>Done</Text>
                    </TouchableOpacity>
                </View>

                {/* ── PROGRESS BAR ─────────────────────────────────────────────── */}
                {flaggedCount > 0 && (
                    <View style={[styles.progressBarTrack, { backgroundColor: darkMode ? "#374151" : "#E2E8F0" }]}>
                        <View
                            style={[
                                styles.progressBarFill,
                                {
                                    width: `${Math.round((resolvedCount / Math.max(1, flaggedCount)) * 100)}%`,
                                    backgroundColor: resolvedCount === flaggedCount ? "#10B981" : "#F59E0B",
                                },
                            ]}
                        />
                    </View>
                )}

                {/* ── QUESTION SELECTOR TABS ───────────────────────────────────── */}
                <View style={[styles.tabsBar, { borderBottomColor: border }]}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsScroll}>
                        {displayItems.map((item) => {
                            const isCur = item.questionNumber === selectedQNum;
                            const isFlagged = isItemFlaggedByAi(item);
                            const isDone = item.isOverridden;

                            let pillBg = darkMode ? "#1F2937" : "#F1F5F9";
                            let pillBorder = border;
                            let badgeColor = textSub;

                            if (isCur) {
                                pillBg = darkMode ? "#374151" : "#FFFFFF";
                                pillBorder = accentColor;
                            }

                            if (isFlagged && !isDone) {
                                pillBg = darkMode ? "#78350F30" : "#FEF3C7";
                                pillBorder = "#F59E0B";
                                badgeColor = "#D97706";
                            } else if (isDone) {
                                pillBg = darkMode ? "#064E3B30" : "#ECFDF5";
                                pillBorder = "#10B981";
                                badgeColor = "#059669";
                            }

                            return (
                                <TouchableOpacity
                                    key={item.questionNumber}
                                    style={[styles.tabPill, { backgroundColor: pillBg, borderColor: pillBorder }]}
                                    onPress={() => setSelectedQNum(item.questionNumber)}
                                    activeOpacity={0.7}
                                >
                                    <Text style={[styles.tabPillText, { color: isCur ? textMain : textSub, fontWeight: isCur ? "800" : "600" }]}>
                                        Q{item.questionNumber}
                                    </Text>
                                    {isFlagged && !isDone && (
                                        <Ionicons name="alert-circle" size={14} color="#D97706" style={{ marginLeft: 4 }} />
                                    )}
                                    {isDone && (
                                        <Ionicons name="checkmark-circle" size={14} color="#059669" style={{ marginLeft: 4 }} />
                                    )}
                                </TouchableOpacity>
                            );
                        })}
                    </ScrollView>

                    {/* Filter Toggle */}
                    {workingResults.length > flaggedItems.length && flaggedItems.length > 0 && (
                        <TouchableOpacity
                            style={[
                                styles.filterToggleBtn,
                                { backgroundColor: filterOnlyFlagged ? (darkMode ? "#374151" : "#E2E8F0") : "transparent" },
                            ]}
                            onPress={() => setFilterOnlyFlagged(!filterOnlyFlagged)}
                        >
                            <Ionicons
                                name={filterOnlyFlagged ? "filter" : "list"}
                                size={14}
                                color={textSub}
                                style={{ marginRight: 4 }}
                            />
                            <Text style={[styles.filterToggleText, { color: textSub }]}>
                                {filterOnlyFlagged ? "Flagged Only" : "All Items"}
                            </Text>
                        </TouchableOpacity>
                    )}
                </View>

                {/* ── MAIN REVIEW CARD ─────────────────────────────────────────── */}
                <ScrollView style={styles.bodyScroll} contentContainerStyle={styles.bodyContent}>
                    {activeItem ? (
                        <View style={[styles.activeCard, { backgroundColor: cardBg, borderColor: border }]}>
                            {/* Card Header with Question & Status Badge */}
                            <View style={styles.cardTopRow}>
                                <View style={styles.qBadgeContainer}>
                                    <View style={[styles.bigQBadge, { backgroundColor: accentColor }]}>
                                        <Text style={styles.bigQBadgeText}>Q{activeItem.questionNumber}</Text>
                                    </View>
                                    <View style={{ marginLeft: 12 }}>
                                        <Text style={[styles.qHeaderLabel, { color: textSub }]}>
                                            Question #{activeItem.questionNumber}
                                        </Text>
                                        <Text style={[styles.studentScoreStatus, { color: activeItem.isCorrect ? "#10B981" : "#EF4444" }]}>
                                            {activeItem.isCorrect ? "✓ 1 / 1 Point Awarded" : "✗ 0 / 1 Point Awarded"}
                                        </Text>
                                    </View>
                                </View>

                                {/* Issue Tag */}
                                <View style={styles.issueTagContainer}>
                                    {activeItem.flagReason === "double_mark" && (
                                        <View style={[styles.issueTag, { backgroundColor: "#FEF2F2", borderColor: "#FCA5A5" }]}>
                                            <Ionicons name="copy" size={12} color="#DC2626" style={{ marginRight: 4 }} />
                                            <Text style={[styles.issueTagText, { color: "#DC2626" }]}>Double-Shaded</Text>
                                        </View>
                                    )}
                                    {activeItem.flagReason === "unclear" && (
                                        <View style={[styles.issueTag, { backgroundColor: "#FEF3C7", borderColor: "#FCD34D" }]}>
                                            <Ionicons name="help-circle" size={12} color="#D97706" style={{ marginRight: 4 }} />
                                            <Text style={[styles.issueTagText, { color: "#D97706" }]}>Faint / Unclear</Text>
                                        </View>
                                    )}
                                    {activeItem.flagReason === "low_confidence" && (
                                        <View style={[styles.issueTag, { backgroundColor: "#FEF3C7", borderColor: "#FCD34D" }]}>
                                            <Ionicons name="eye-outline" size={12} color="#D97706" style={{ marginRight: 4 }} />
                                            <Text style={[styles.issueTagText, { color: "#D97706" }]}>
                                                {activeItem.confidence ? `${Math.round(activeItem.confidence * 100)}% Confidence` : "Low Confidence"}
                                            </Text>
                                        </View>
                                    )}
                                    {activeItem.isOverridden && (
                                        <View style={[styles.issueTag, { backgroundColor: "#ECFDF5", borderColor: "#A7F3D0", marginTop: 4 }]}>
                                            <Ionicons name="checkmark-done" size={12} color="#059669" style={{ marginRight: 4 }} />
                                            <Text style={[styles.issueTagText, { color: "#059669" }]}>Teacher Verified</Text>
                                        </View>
                                    )}
                                </View>
                            </View>

                            {/* Details description */}
                            {activeItem.flagDetails ? (
                                <View style={[styles.flagAlertBox, { backgroundColor: darkMode ? "#78350F25" : "#FFFBEB", borderColor: "#FDE68A" }]}>
                                    <Ionicons name="information-circle" size={18} color="#D97706" style={{ marginRight: 8, marginTop: 1 }} />
                                    <Text style={[styles.flagAlertText, { color: darkMode ? "#FDE68A" : "#92400E" }]}>
                                        {activeItem.flagDetails}
                                    </Text>
                                </View>
                            ) : null}

                            {/* Comparison Section (Answer Key vs AI Detected) */}
                            <View style={[styles.comparisonGrid, { backgroundColor: darkMode ? "#111827" : "#FFFFFF", borderColor: border }]}>
                                <View style={styles.comparisonCol}>
                                    <Text style={[styles.compLabel, { color: textSub }]}>OFFICIAL ANSWER KEY</Text>
                                    <View style={styles.keyBadge}>
                                        <Text style={styles.keyBadgeText}>{activeItem.correctAnswer}</Text>
                                    </View>
                                    <Text style={[styles.compSub, { color: textSub }]}>Standard ground truth</Text>
                                </View>

                                <View style={[styles.compDivider, { backgroundColor: border }]} />

                                <View style={styles.comparisonCol}>
                                    <Text style={[styles.compLabel, { color: textSub }]}>CURRENT DETECTED</Text>
                                    <View
                                        style={[
                                            styles.studentBadge,
                                            {
                                                backgroundColor: activeItem.isCorrect
                                                    ? (darkMode ? "#064E3B40" : "#D1FAE5")
                                                    : (darkMode ? "#7F1D1D40" : "#FEE2E2"),
                                                borderColor: activeItem.isCorrect ? "#10B981" : "#EF4444",
                                            },
                                        ]}
                                    >
                                        <Text
                                            style={[
                                                styles.studentBadgeText,
                                                { color: activeItem.isCorrect ? "#059669" : "#DC2626" },
                                            ]}
                                        >
                                            {activeItem.studentAnswer || "(Blank)"}
                                        </Text>
                                    </View>
                                    <Text style={[styles.compSub, { color: textSub }]}>
                                        {activeItem.isOverridden ? "Manually adjusted" : "Raw AI read"}
                                    </Text>
                                </View>
                            </View>

                            {/* ── PHOTO SNIPPET PREVIEW (If captured sheet exists) ── */}
                            {scannedImageUri && (
                                <View style={styles.imageSection}>
                                    <TouchableOpacity
                                        style={[styles.imageThumbBtn, { borderColor: border }]}
                                        onPress={() => setImagePreviewOpen(true)}
                                        activeOpacity={0.8}
                                    >
                                        <Image source={{ uri: scannedImageUri }} style={styles.imageThumb} resizeMode="cover" />
                                        <View style={styles.imageOverlayBadge}>
                                            <Ionicons name="expand" size={14} color="#FFF" style={{ marginRight: 4 }} />
                                            <Text style={styles.imageOverlayText}>View Captured Test Sheet</Text>
                                        </View>
                                    </TouchableOpacity>
                                </View>
                            )}

                            {/* ── QUICK-FIX BUBBLE SELECTOR ────────────────────────── */}
                            <View style={styles.fixSection}>
                                <Text style={[styles.sectionTitle, { color: textMain }]}>
                                    Select Correct Student Mark:
                                </Text>

                                {/* Multiple Choice (A, B, C, D) */}
                                {isMC && (
                                    <View style={styles.bubbleRow}>
                                        {["A", "B", "C", "D"].map((letter) => {
                                            const isSelected = (activeItem.studentAnswer || "").toUpperCase() === letter;
                                            const isKey = activeItem.correctAnswer.toUpperCase() === letter;
                                            const isDetectedCandidate =
                                                activeItem.detectedOptions?.includes(letter) ||
                                                (activeItem.originalStudentAnswer || "").includes(letter);

                                            let btnBg = darkMode ? "#1F2937" : "#FFFFFF";
                                            let btnBorder = border;
                                            let letterColor = textMain;

                                            if (isSelected) {
                                                btnBg = isKey ? "#10B981" : "#EF4444";
                                                btnBorder = isKey ? "#059669" : "#DC2626";
                                                letterColor = "#FFFFFF";
                                            } else if (isDetectedCandidate) {
                                                btnBg = darkMode ? "#78350F30" : "#FEF3C7";
                                                btnBorder = "#F59E0B";
                                                letterColor = "#D97706";
                                            }

                                            return (
                                                <TouchableOpacity
                                                    key={letter}
                                                    style={[styles.bubbleBtn, { backgroundColor: btnBg, borderColor: btnBorder }]}
                                                    onPress={() => handleSelectAnswer(letter)}
                                                    activeOpacity={0.7}
                                                >
                                                    <Text style={[styles.bubbleBtnText, { color: letterColor }]}>{letter}</Text>
                                                    {isKey && !isSelected && (
                                                        <View style={styles.keyDot} />
                                                    )}
                                                </TouchableOpacity>
                                            );
                                        })}
                                    </View>
                                )}

                                {/* True / False (T, F) */}
                                {isTF && (
                                    <View style={styles.bubbleRow}>
                                        {["T", "F"].map((choice) => {
                                            const isSelected = (activeItem.studentAnswer || "").toUpperCase().startsWith(choice);
                                            const isKey = activeItem.correctAnswer.toUpperCase().startsWith(choice);

                                            return (
                                                <TouchableOpacity
                                                    key={choice}
                                                    style={[
                                                        styles.bubbleBtn,
                                                        styles.tfBtn,
                                                        {
                                                            backgroundColor: isSelected
                                                                ? (isKey ? "#10B981" : "#EF4444")
                                                                : (darkMode ? "#1F2937" : "#FFFFFF"),
                                                            borderColor: isSelected ? (isKey ? "#059669" : "#DC2626") : border,
                                                        },
                                                    ]}
                                                    onPress={() => handleSelectAnswer(choice)}
                                                >
                                                    <Text
                                                        style={[
                                                            styles.bubbleBtnText,
                                                            { color: isSelected ? "#FFFFFF" : textMain },
                                                        ]}
                                                    >
                                                        {choice === "T" ? "T (True)" : "F (False)"}
                                                    </Text>
                                                </TouchableOpacity>
                                            );
                                        })}
                                    </View>
                                )}

                                {/* Written / Custom text input (Identification / Fill-blank or custom override) */}
                                {!["A", "B", "C", "D"].includes(activeItem.correctAnswer.trim().toUpperCase()) && !isTF && (
                                    <View style={[styles.customInputRow, isMC && { marginTop: 10 }]}>
                                        <TextInput
                                            style={[
                                                styles.customInput,
                                                { backgroundColor: darkMode ? "#111827" : "#FFFFFF", color: textMain, borderColor: border },
                                            ]}
                                            placeholder="Type student's handwritten answer..."
                                            placeholderTextColor={textSub}
                                            value={customAnswerInput}
                                            onChangeText={setCustomAnswerInput}
                                            autoCapitalize="characters"
                                        />
                                        <TouchableOpacity
                                            style={[styles.applyInputBtn, { backgroundColor: accentColor }]}
                                            onPress={() => handleSelectAnswer(customAnswerInput)}
                                        >
                                            <Text style={styles.applyInputBtnText}>Set</Text>
                                        </TouchableOpacity>
                                    </View>
                                )}

                                {/* Blank / Empty Mark Option */}
                                <View style={styles.secondaryFixRow}>
                                    <TouchableOpacity
                                        style={[
                                            styles.secondaryFixBtn,
                                            {
                                                backgroundColor: darkMode ? "#1F2937" : "#F1F5F9",
                                                borderColor: border,
                                            },
                                        ]}
                                        onPress={() => handleSelectAnswer("")}
                                    >
                                        <Ionicons name="ellipse-outline" size={14} color={textSub} style={{ marginRight: 6 }} />
                                        <Text style={[styles.secondaryFixText, { color: textSub }]}>Mark as Blank (No Answer)</Text>
                                    </TouchableOpacity>

                                    {activeItem.isOverridden && (
                                        <TouchableOpacity
                                            style={[styles.secondaryFixBtn, { backgroundColor: "transparent", borderColor: "transparent" }]}
                                            onPress={handleResetToAi}
                                        >
                                            <Ionicons name="refresh" size={14} color={textSub} style={{ marginRight: 4 }} />
                                            <Text style={[styles.secondaryFixText, { color: textSub }]}>Revert to AI</Text>
                                        </TouchableOpacity>
                                    )}
                                </View>
                            </View>

                            {/* ── POINT OVERRIDE TOGGLES ───────────────────────────── */}
                            <View style={[styles.pointOverrideBox, { borderTopColor: border }]}>
                                <Text style={[styles.pointOverrideLabel, { color: textSub }]}>Direct Point Override:</Text>
                                <View style={styles.overrideButtonsRow}>
                                    <TouchableOpacity
                                        style={[
                                            styles.pointOverrideBtn,
                                            {
                                                backgroundColor: activeItem.isCorrect ? "#10B981" : (darkMode ? "#1F2937" : "#F1F5F9"),
                                                borderColor: activeItem.isCorrect ? "#059669" : border,
                                            },
                                        ]}
                                        onPress={() => handleTogglePoints(true)}
                                    >
                                        <Ionicons
                                            name="checkmark-circle"
                                            size={16}
                                            color={activeItem.isCorrect ? "#FFF" : "#10B981"}
                                            style={{ marginRight: 6 }}
                                        />
                                        <Text style={[styles.pointOverrideText, { color: activeItem.isCorrect ? "#FFF" : textMain }]}>
                                            Award +1 Point (Correct)
                                        </Text>
                                    </TouchableOpacity>

                                    <TouchableOpacity
                                        style={[
                                            styles.pointOverrideBtn,
                                            {
                                                backgroundColor: !activeItem.isCorrect ? "#EF4444" : (darkMode ? "#1F2937" : "#F1F5F9"),
                                                borderColor: !activeItem.isCorrect ? "#DC2626" : border,
                                            },
                                        ]}
                                        onPress={() => handleTogglePoints(false)}
                                    >
                                        <Ionicons
                                            name="close-circle"
                                            size={16}
                                            color={!activeItem.isCorrect ? "#FFF" : "#EF4444"}
                                            style={{ marginRight: 6 }}
                                        />
                                        <Text style={[styles.pointOverrideText, { color: !activeItem.isCorrect ? "#FFF" : textMain }]}>
                                            0 Points (Incorrect)
                                        </Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        </View>
                    ) : (
                        <View style={styles.emptyContainer}>
                            <Ionicons name="checkmark-done-circle" size={60} color="#10B981" />
                            <Text style={[styles.emptyTitle, { color: textMain }]}>All Questions Cleanly Verified</Text>
                            <Text style={[styles.emptySubtitle, { color: textSub }]}>
                                No double-shaded bubbles or low-confidence readings require manual fixing.
                            </Text>
                        </View>
                    )}
                </ScrollView>

                {/* ── FOOTER NAVIGATION BAR ─────────────────────────────────────── */}
                <View style={[styles.footerBar, { backgroundColor: bg, borderTopColor: border }]}>
                    <View style={styles.footerNavRow}>
                        <TouchableOpacity
                            style={[
                                styles.navArrowBtn,
                                {
                                    backgroundColor: darkMode ? "#1F2937" : "#F1F5F9",
                                    borderColor: border,
                                    opacity: displayItems.findIndex((r) => r.questionNumber === selectedQNum) === 0 ? 0.4 : 1,
                                },
                            ]}
                            onPress={handlePrev}
                            disabled={displayItems.findIndex((r) => r.questionNumber === selectedQNum) === 0}
                        >
                            <Ionicons name="chevron-back" size={20} color={textMain} />
                            <Text style={[styles.navArrowText, { color: textMain, marginLeft: 4 }]}>Prev</Text>
                        </TouchableOpacity>

                        <View style={styles.footerScoreContainer}>
                            <Text style={[styles.footerScoreTitle, { color: textSub }]}>Total Score</Text>
                            <Text style={[styles.footerScoreValue, { color: accentColor }]}>
                                {computedTotalScore} / {gradingResult.maxScore}
                            </Text>
                        </View>

                        <TouchableOpacity
                            style={[
                                styles.navArrowBtn,
                                {
                                    backgroundColor: darkMode ? "#1F2937" : "#F1F5F9",
                                    borderColor: border,
                                    opacity: displayItems.findIndex((r) => r.questionNumber === selectedQNum) === displayItems.length - 1 ? 0.4 : 1,
                                },
                            ]}
                            onPress={handleNext}
                            disabled={displayItems.findIndex((r) => r.questionNumber === selectedQNum) === displayItems.length - 1}
                        >
                            <Text style={[styles.navArrowText, { color: textMain, marginRight: 4 }]}>Next</Text>
                            <Ionicons name="chevron-forward" size={20} color={textMain} />
                        </TouchableOpacity>
                    </View>

                    <TouchableOpacity
                        style={[styles.applyFooterBtn, { backgroundColor: accentColor }]}
                        onPress={handleApplyChanges}
                        activeOpacity={0.8}
                    >
                        <Ionicons name="save" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
                        <Text style={styles.applyFooterBtnText}>
                            Save & Update Score ({computedTotalScore}/{gradingResult.maxScore})
                        </Text>
                    </TouchableOpacity>
                </View>

                {/* ── FULL IMAGE PREVIEW MODAL ─────────────────────────────────── */}
                {scannedImageUri && (
                    <Modal visible={imagePreviewOpen} transparent animationType="fade" onRequestClose={() => setImagePreviewOpen(false)}>
                        <View style={styles.fullImageOverlay}>
                            <TouchableOpacity style={styles.fullImageCloseBtn} onPress={() => setImagePreviewOpen(false)}>
                                <Ionicons name="close" size={26} color="#FFFFFF" />
                            </TouchableOpacity>
                            <Image source={{ uri: scannedImageUri }} style={styles.fullImage} resizeMode="contain" />
                        </View>
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
        paddingTop: 52,
        paddingBottom: 14,
        borderBottomWidth: 1,
    },
    closeBtn: {
        padding: 6,
    },
    headerCenter: {
        flex: 1,
        alignItems: "center",
    },
    headerTitleRow: {
        flexDirection: "row",
        alignItems: "center",
    },
    headerTitle: {
        fontSize: 16,
        fontWeight: "800",
    },
    headerSubtitle: {
        fontSize: 12,
        fontWeight: "500",
        marginTop: 2,
    },
    saveHeaderBtn: {
        paddingHorizontal: 14,
        paddingVertical: 7,
        borderRadius: 20,
    },
    saveHeaderBtnText: {
        color: "#FFFFFF",
        fontWeight: "700",
        fontSize: 13,
    },
    progressBarTrack: {
        height: 4,
        width: "100%",
    },
    progressBarFill: {
        height: "100%",
    },
    tabsBar: {
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 8,
        borderBottomWidth: 1,
    },
    tabsScroll: {
        paddingHorizontal: 16,
        gap: 8,
    },
    tabPill: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 20,
        borderWidth: 1.5,
    },
    tabPillText: {
        fontSize: 12,
    },
    filterToggleBtn: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 14,
        marginRight: 12,
    },
    filterToggleText: {
        fontSize: 11,
        fontWeight: "600",
    },
    bodyScroll: {
        flex: 1,
    },
    bodyContent: {
        padding: 16,
        paddingBottom: 40,
    },
    activeCard: {
        borderRadius: 18,
        borderWidth: 1,
        padding: 16,
    },
    cardTopRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "flex-start",
    },
    qBadgeContainer: {
        flexDirection: "row",
        alignItems: "center",
    },
    bigQBadge: {
        width: 44,
        height: 44,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
    },
    bigQBadgeText: {
        color: "#FFFFFF",
        fontSize: 18,
        fontWeight: "900",
    },
    qHeaderLabel: {
        fontSize: 11,
        fontWeight: "700",
        textTransform: "uppercase",
        letterSpacing: 0.5,
    },
    studentScoreStatus: {
        fontSize: 13,
        fontWeight: "700",
        marginTop: 2,
    },
    issueTagContainer: {
        alignItems: "flex-end",
    },
    issueTag: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
        borderWidth: 1,
    },
    issueTagText: {
        fontSize: 10.5,
        fontWeight: "700",
    },
    flagAlertBox: {
        flexDirection: "row",
        alignItems: "flex-start",
        padding: 12,
        borderRadius: 12,
        borderWidth: 1,
        marginTop: 14,
    },
    flagAlertText: {
        flex: 1,
        fontSize: 12,
        fontWeight: "600",
        lineHeight: 17,
    },
    comparisonGrid: {
        flexDirection: "row",
        borderRadius: 14,
        borderWidth: 1,
        padding: 12,
        marginTop: 14,
    },
    comparisonCol: {
        flex: 1,
        alignItems: "center",
    },
    compLabel: {
        fontSize: 10,
        fontWeight: "800",
        letterSpacing: 0.5,
        marginBottom: 6,
    },
    keyBadge: {
        backgroundColor: "#10B981",
        minWidth: 42,
        minHeight: 42,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
    },
    keyBadgeText: {
        color: "#FFFFFF",
        fontSize: 16,
        fontWeight: "900",
        textAlign: "center",
    },
    studentBadge: {
        minWidth: 42,
        minHeight: 42,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 10,
        borderWidth: 1.5,
        alignItems: "center",
        justifyContent: "center",
    },
    studentBadgeText: {
        fontSize: 16,
        fontWeight: "900",
        textAlign: "center",
    },
    compSub: {
        fontSize: 10.5,
        marginTop: 6,
    },
    compDivider: {
        width: 1,
        marginHorizontal: 12,
    },
    imageSection: {
        marginTop: 14,
    },
    imageThumbBtn: {
        height: 90,
        borderRadius: 12,
        overflow: "hidden",
        borderWidth: 1,
        position: "relative",
    },
    imageThumb: {
        width: "100%",
        height: "100%",
    },
    imageOverlayBadge: {
        position: "absolute",
        bottom: 6,
        right: 8,
        backgroundColor: "rgba(0,0,0,0.75)",
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 10,
    },
    imageOverlayText: {
        color: "#FFFFFF",
        fontSize: 11,
        fontWeight: "600",
    },
    fixSection: {
        marginTop: 18,
    },
    sectionTitle: {
        fontSize: 13,
        fontWeight: "800",
        marginBottom: 10,
    },
    bubbleRow: {
        flexDirection: "row",
        gap: 12,
    },
    bubbleBtn: {
        flex: 1,
        height: 52,
        borderRadius: 14,
        borderWidth: 2,
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
    },
    tfBtn: {
        flex: 1,
    },
    bubbleBtnText: {
        fontSize: 20,
        fontWeight: "900",
    },
    keyDot: {
        position: "absolute",
        top: 6,
        right: 6,
        width: 7,
        height: 7,
        borderRadius: 3.5,
        backgroundColor: "#10B981",
    },
    customInputRow: {
        flexDirection: "row",
        gap: 8,
    },
    customInput: {
        flex: 1,
        height: 48,
        borderRadius: 12,
        borderWidth: 1,
        paddingHorizontal: 14,
        fontSize: 15,
        fontWeight: "700",
    },
    applyInputBtn: {
        paddingHorizontal: 18,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
    },
    applyInputBtnText: {
        color: "#FFFFFF",
        fontWeight: "800",
        fontSize: 14,
    },
    secondaryFixRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginTop: 12,
    },
    secondaryFixBtn: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 12,
        borderWidth: 1,
    },
    secondaryFixText: {
        fontSize: 11.5,
        fontWeight: "600",
    },
    pointOverrideBox: {
        marginTop: 18,
        paddingTop: 14,
        borderTopWidth: 1,
    },
    pointOverrideLabel: {
        fontSize: 11,
        fontWeight: "700",
        marginBottom: 8,
    },
    overrideButtonsRow: {
        flexDirection: "row",
        gap: 8,
    },
    pointOverrideBtn: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 9,
        borderRadius: 12,
        borderWidth: 1.5,
    },
    pointOverrideText: {
        fontSize: 12,
        fontWeight: "700",
    },
    emptyContainer: {
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 60,
    },
    emptyTitle: {
        fontSize: 18,
        fontWeight: "800",
        marginTop: 14,
    },
    emptySubtitle: {
        fontSize: 13,
        textAlign: "center",
        marginTop: 6,
        paddingHorizontal: 30,
        lineHeight: 18,
    },
    footerBar: {
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 28,
        borderTopWidth: 1,
    },
    footerNavRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 10,
    },
    navArrowBtn: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 14,
        borderWidth: 1,
    },
    navArrowText: {
        fontSize: 13,
        fontWeight: "700",
    },
    footerScoreContainer: {
        alignItems: "center",
    },
    footerScoreTitle: {
        fontSize: 10.5,
        fontWeight: "700",
        textTransform: "uppercase",
    },
    footerScoreValue: {
        fontSize: 18,
        fontWeight: "900",
    },
    applyFooterBtn: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        height: 50,
        borderRadius: 14,
    },
    applyFooterBtnText: {
        color: "#FFFFFF",
        fontSize: 15,
        fontWeight: "800",
    },
    fullImageOverlay: {
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.92)",
        justifyContent: "center",
        alignItems: "center",
    },
    fullImageCloseBtn: {
        position: "absolute",
        top: 50,
        right: 20,
        zIndex: 10,
        padding: 8,
    },
    fullImage: {
        width: SCREEN_WIDTH * 0.95,
        height: "80%",
    },
});
