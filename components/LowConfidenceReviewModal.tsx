import React, { useState, useEffect, useMemo, useRef } from "react";
import {
    Modal,
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
    Image,
    TextInput,
    Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../context/ThemeContext";
import { GradingResultItem, GradingResponse, isAnswerAccepted } from "../lib/gradingService";

export interface LowConfidenceReviewModalProps {
    visible: boolean;
    onClose: () => void;
    gradingResult: GradingResponse | null;
    scannedImageUri?: string | null;
    studentName?: string;
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
    studentName,
    accentColor = "#EA580C",
    initialQuestionNumber,
    initialFilterOnlyFlagged,
    onSaveReviewedResults,
}: LowConfidenceReviewModalProps) {
    const { darkMode } = useTheme();
    const insets = useSafeAreaInsets();

    const [workingResults, setWorkingResults] = useState<GradingResultItem[]>([]);
    const [filterOnlyFlagged, setFilterOnlyFlagged] = useState<boolean>(true);
    const [imagePreviewOpen, setImagePreviewOpen] = useState<boolean>(false);
    const [activeAnchorQNum, setActiveAnchorQNum] = useState<number>(1);
    const [customInputs, setCustomInputs] = useState<{ [key: number]: string }>({});

    const mainScrollRef = useRef<ScrollView>(null);
    const cardLayouts = useRef<{ [key: number]: number }>({});

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
            let startQ = 1;
            if (initialQuestionNumber) {
                startQ = initialQuestionNumber;
            } else if (initialFilterOnlyFlagged === false) {
                startQ = 1;
            } else {
                const firstUnresolved = deepCopy.find((r) => isItemFlaggedByAi(r) && !r.isOverridden);
                const firstFlagged = firstUnresolved || deepCopy.find(isItemFlaggedByAi);
                startQ = firstFlagged ? firstFlagged.questionNumber : 1;
            }
            setActiveAnchorQNum(startQ);

            // Populate custom inputs
            const initialInputs: { [key: number]: string } = {};
            deepCopy.forEach((r) => {
                initialInputs[r.questionNumber] = r.studentAnswer || "";
            });
            setCustomInputs(initialInputs);
        }
    }, [visible, gradingResult, initialQuestionNumber]);

    // Scroll to initial question once card layouts are ready
    useEffect(() => {
        if (visible && initialQuestionNumber) {
            const timer = setTimeout(() => {
                const targetY = cardLayouts.current[initialQuestionNumber];
                if (typeof targetY === "number" && mainScrollRef.current) {
                    mainScrollRef.current.scrollTo({ y: Math.max(0, targetY - 8), animated: true });
                }
            }, 250);
            return () => clearTimeout(timer);
        }
    }, [visible, initialQuestionNumber]);

    // Compute flagged items
    const flaggedItems = useMemo(() => {
        return workingResults.filter(isItemFlaggedByAi);
    }, [workingResults]);

    const flaggedCount = flaggedItems.length;

    // Filtered list to render in continuous scroll
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

    // ── Update answers ─────────────────────────────────────────────────────────
    function handleSelectAnswerForItem(qNum: number, choice: string) {
        const normalizedChoice = choice.trim();
        setWorkingResults((prev) =>
            prev.map((r) => {
                if (r.questionNumber === qNum) {
                    const official = r.correctAnswer.trim();
                    const isMatch = normalizedChoice !== "" && isAnswerAccepted(normalizedChoice, official);
                    return {
                        ...r,
                        studentAnswer: normalizedChoice,
                        isCorrect: isMatch,
                        pointsAwarded: isMatch ? 1 : 0,
                        isOverridden: true,
                    };
                }
                return r;
            })
        );
        setCustomInputs((prev) => ({ ...prev, [qNum]: normalizedChoice }));
    }

    function handleTogglePointsForItem(qNum: number, award: boolean) {
        setWorkingResults((prev) =>
            prev.map((r) => {
                if (r.questionNumber === qNum) {
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

    function handleResetToAiForItem(qNum: number) {
        setWorkingResults((prev) =>
            prev.map((r) => {
                if (r.questionNumber === qNum) {
                    const orig = r.originalStudentAnswer ?? "";
                    const isMatch = isAnswerAccepted(orig, r.correctAnswer);
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
        const item = workingResults.find((r) => r.questionNumber === qNum);
        if (item) {
            setCustomInputs((prev) => ({ ...prev, [qNum]: item.originalStudentAnswer ?? "" }));
        }
    }

    // Smooth-scroll to question
    function handleScrollToQuestion(qNum: number) {
        setActiveAnchorQNum(qNum);
        const targetY = cardLayouts.current[qNum];
        if (typeof targetY === "number" && mainScrollRef.current) {
            mainScrollRef.current.scrollTo({ y: Math.max(0, targetY - 8), animated: true });
        }
    }

    // Save and commit
    function handleApplyChanges() {
        onSaveReviewedResults(workingResults, computedTotalScore);
        onClose();
    }

    if (!visible || !gradingResult) return null;

    // Theme tokens
    const bg = darkMode ? "#0F172A" : "#FFFFFF";
    const cardBg = darkMode ? "#1E293B" : "#FFFFFF";
    const border = darkMode ? "#334155" : "#E2E8F0";
    const textMain = darkMode ? "#F8FAFC" : "#0F172A";
    const textSub = darkMode ? "#94A3B8" : "#64748B";

    return (
        <Modal
            visible={visible}
            animationType="slide"
            transparent={true}
            statusBarTranslucent={true}
            onRequestClose={onClose}
        >
            <View style={styles.modalRoot}>
                {/* Full-screen Dimmed Backdrop */}
                <Pressable style={styles.modalBackdrop} onPress={onClose} />

                {/* Bottom Sheet Container */}
                <View
                    style={[
                        styles.sheetContainer,
                        {
                            backgroundColor: bg,
                            paddingBottom: Math.max(insets.bottom, 12),
                        },
                    ]}
                >
                    {/* Centered Drag Pill */}
                    <View style={[styles.dragPill, { backgroundColor: darkMode ? "#475569" : "#CBD5E1" }]} />

                    {/* ── HEADER ─────────────────────────────────────────────────── */}
                    <View style={[styles.header, { borderBottomColor: border }]}>
                        <View style={{ flex: 1, marginRight: 8 }}>
                            <Text style={[styles.headerTitle, { color: textMain }]} numberOfLines={1}>
                                {filterOnlyFlagged && flaggedCount > 0
                                    ? "Review Flagged Answers"
                                    : "Student Answer Sheet"}
                            </Text>
                            <Text style={[styles.headerSubtitle, { color: textSub }]} numberOfLines={1}>
                                {(studentName || gradingResult.studentName)
                                    ? `${studentName || gradingResult.studentName} · `
                                    : ""}
                                {flaggedCount > 0
                                    ? `${flaggedCount} flagged · ${resolvedCount} resolved`
                                    : `${workingResults.length} questions verified`}
                            </Text>
                        </View>

                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                            {scannedImageUri && (
                                <TouchableOpacity
                                    style={[
                                        styles.viewSheetHeaderBtn,
                                        {
                                            backgroundColor: darkMode ? "#1E293B" : "#F8FAFC",
                                            borderColor: border,
                                        },
                                    ]}
                                    onPress={() => setImagePreviewOpen(true)}
                                    activeOpacity={0.75}
                                >
                                    <Text style={[styles.viewSheetHeaderBtnText, { color: textMain }]}>
                                        View Full Sheet ↗
                                    </Text>
                                </TouchableOpacity>
                            )}

                            <TouchableOpacity
                                style={[styles.closeIconBtn, { backgroundColor: darkMode ? "#334155" : "#F1F5F9" }]}
                                onPress={onClose}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            >
                                <Ionicons name="close" size={18} color={darkMode ? "#94A3B8" : "#64748B"} />
                            </TouchableOpacity>
                        </View>
                    </View>

                    {/* ── STICKY ANCHOR BAR (HORIZONTAL CHIPS) ────────────────────── */}
                    <View style={[styles.anchorBar, { borderBottomColor: border }]}>
                        <View style={styles.anchorScrollWrap}>
                            <ScrollView
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                contentContainerStyle={styles.anchorScroll}
                            >
                                {displayItems.map((item) => {
                                    const isCurrentInView = item.questionNumber === activeAnchorQNum;
                                    const isFlagged = isItemFlaggedByAi(item);
                                    const isResolved = item.isOverridden;

                                    let chipBg = darkMode ? "#1E293B" : "#F8FAFC";
                                    let chipBorder = darkMode ? "#334155" : "#E2E8F0";
                                    let chipColor = textSub;

                                    if (isResolved) {
                                        chipBg = darkMode ? "#064E3B30" : "#F0FDF4";
                                        chipBorder = "#10B981";
                                        chipColor = "#16A34A";
                                    } else if (isFlagged) {
                                        chipBg = darkMode ? "#78350F30" : "#FFFBEB";
                                        chipBorder = "#F59E0B";
                                        chipColor = "#D97706";
                                    }

                                    return (
                                        <TouchableOpacity
                                            key={item.questionNumber}
                                            style={[
                                                styles.anchorChip,
                                                {
                                                    backgroundColor: chipBg,
                                                    borderColor: isCurrentInView ? (darkMode ? "#F8FAFC" : "#0F172A") : chipBorder,
                                                    borderWidth: isCurrentInView ? 2 : 1,
                                                },
                                            ]}
                                            onPress={() => handleScrollToQuestion(item.questionNumber)}
                                            activeOpacity={0.7}
                                        >
                                            <Text style={[styles.anchorChipText, { color: chipColor }]}>
                                                Q{item.questionNumber}
                                            </Text>
                                            {isResolved ? (
                                                <Ionicons name="checkmark" size={12} color="#16A34A" style={{ marginLeft: 3 }} />
                                            ) : isFlagged ? (
                                                <View style={styles.amberDot} />
                                            ) : null}
                                        </TouchableOpacity>
                                    );
                                })}
                            </ScrollView>
                        </View>

                        {/* Filter Toggle with Vertical Divider */}
                        {workingResults.length > flaggedItems.length && flaggedItems.length > 0 && (
                            <>
                                <View style={[styles.anchorBarDivider, { backgroundColor: border }]} />
                                <TouchableOpacity
                                    style={[
                                        styles.filterBtn,
                                        {
                                            backgroundColor: filterOnlyFlagged
                                                ? (darkMode ? "#334155" : "#E2E8F0")
                                                : "transparent",
                                            borderColor: border,
                                        },
                                    ]}
                                    onPress={() => setFilterOnlyFlagged(!filterOnlyFlagged)}
                                    activeOpacity={0.7}
                                >
                                    <Ionicons
                                        name={filterOnlyFlagged ? "filter" : "list"}
                                        size={13}
                                        color={textSub}
                                        style={{ marginRight: 4 }}
                                    />
                                    <Text style={[styles.filterBtnText, { color: textSub }]}>
                                        {filterOnlyFlagged ? "Flagged Only" : "All Items"}
                                    </Text>
                                </TouchableOpacity>
                            </>
                        )}
                    </View>

                    {/* ── CONTINUOUS SCROLL VIEW OF QUESTION CARDS ───────────────── */}
                    <ScrollView
                        ref={mainScrollRef}
                        style={styles.mainScrollView}
                        contentContainerStyle={styles.mainScrollContent}
                        showsVerticalScrollIndicator={true}
                        scrollEventThrottle={16}
                        onScroll={(e) => {
                            const scrollY = e.nativeEvent.contentOffset.y;
                            const entries = Object.entries(cardLayouts.current);
                            if (entries.length > 0) {
                                entries.sort((a, b) => a[1] - b[1]);
                                let current = Number(entries[0][0]);
                                for (const [qNumStr, yPos] of entries) {
                                    if (scrollY >= yPos - 60) {
                                        current = Number(qNumStr);
                                    }
                                }
                                if (current !== activeAnchorQNum) {
                                    setActiveAnchorQNum(current);
                                }
                            }
                        }}
                    >
                        {displayItems.length > 0 ? (
                            displayItems.map((item) => {
                                const isFlagged = isItemFlaggedByAi(item);
                                const isMC = Boolean(
                                    ["A", "B", "C", "D"].includes(item.correctAnswer.trim().toUpperCase()) ||
                                    /^[A-D](?:\s*[,/&]\s*[A-D])*$/i.test((item.studentAnswer || "").trim())
                                );
                                const isTF = Boolean(
                                    ["T", "F", "TRUE", "FALSE"].includes(item.correctAnswer.trim().toUpperCase())
                                );

                                let flagReasonLabel = "Needs review";
                                if (item.flagReason === "double_mark") flagReasonLabel = "Double-shaded";
                                else if (item.flagReason === "unclear") {
                                    flagReasonLabel = `Faint mark / Scribble (${item.confidence ? Math.round(item.confidence * 100) : 35}%)`;
                                } else if (item.flagReason === "low_confidence") {
                                    flagReasonLabel = `Low confidence (${item.confidence ? Math.round(item.confidence * 100) : 50}%)`;
                                }

                                const cleanStudentAnswer = (item.studentAnswer || "").trim().toUpperCase();
                                const cleanKey = item.correctAnswer.trim().toUpperCase();
                                const rawAiDetected = (item.originalStudentAnswer ?? item.studentAnswer ?? "").trim();
                                const aiMatchesKey =
                                    rawAiDetected !== "" && isAnswerAccepted(rawAiDetected, item.correctAnswer.trim());
                                const aiDetectedColor =
                                    isFlagged && !item.isOverridden
                                        ? "#D97706"
                                        : aiMatchesKey
                                        ? "#15803D"
                                        : "#B91C1C";

                                return (
                                    <View
                                        key={item.questionNumber}
                                        style={[
                                            styles.compactQuestionCard,
                                            {
                                                backgroundColor: cardBg,
                                                borderColor: isFlagged && !item.isOverridden
                                                    ? "#F59E0B"
                                                    : border,
                                            },
                                        ]}
                                        onLayout={(e) => {
                                            cardLayouts.current[item.questionNumber] = e.nativeEvent.layout.y;
                                        }}
                                    >
                                        {/* Row 1: Compact Header */}
                                        <View style={styles.cardHeaderRow}>
                                            <View style={styles.cardHeaderLeft}>
                                                <View style={[styles.qSquareBadge, { backgroundColor: darkMode ? "#334155" : "#0F172A" }]}>
                                                    <Text style={styles.qSquareBadgeText}>Q{item.questionNumber}</Text>
                                                </View>
                                                <Text style={[styles.qTitleText, { color: textMain }]}>
                                                    Question {item.questionNumber}
                                                </Text>
                                            </View>

                                            {item.isOverridden ? (
                                                <View style={styles.verifiedBadge}>
                                                    <Ionicons name="checkmark-circle" size={12} color="#16A34A" />
                                                    <Text style={styles.verifiedBadgeText}>Reviewed</Text>
                                                </View>
                                            ) : isFlagged ? (
                                                <View style={styles.flagReasonPill}>
                                                    <Text style={styles.flagReasonPillText}>{flagReasonLabel}</Text>
                                                </View>
                                            ) : null}
                                        </View>

                                        {/* Row 2: Cropped Scan Thumbnail (Only on Flagged Questions) */}
                                        {scannedImageUri && isFlagged && (
                                            <TouchableOpacity
                                                style={styles.thumbnailWrap}
                                                onPress={() => setImagePreviewOpen(true)}
                                                activeOpacity={0.85}
                                            >
                                                <Image
                                                    source={{ uri: scannedImageUri }}
                                                    style={styles.thumbnailImg}
                                                    resizeMode="cover"
                                                />
                                                <View style={styles.expandThumbBtn}>
                                                    <Text style={styles.expandThumbText}>Inspect mark ↗</Text>
                                                </View>
                                            </TouchableOpacity>
                                        )}

                                        {/* Row 3: Inline Answer Key & AI Read (Single-line strip) */}
                                        <View style={styles.metaStripRow}>
                                            <Text style={styles.metaStripText}>
                                                Correct Key:{" "}
                                                <Text style={{ fontWeight: "700", color: "#15803D" }}>
                                                    {item.correctAnswer}
                                                </Text>
                                                {"  ·  "}
                                                AI Detected:{" "}
                                                <Text style={{ fontWeight: "700", color: aiDetectedColor }}>
                                                    {rawAiDetected || "(Blank)"}
                                                </Text>
                                                {item.isOverridden ? (
                                                    <Text style={{ fontWeight: "600", color: item.isCorrect ? "#15803D" : "#B91C1C" }}>
                                                        {`  ·  Set: [${item.studentAnswer || "Blank"}]`}
                                                    </Text>
                                                ) : null}
                                            </Text>
                                        </View>

                                        {/* Row 4: One-Tap Bubble Selector */}
                                        {isMC ? (
                                            <View style={styles.bubbleRow}>
                                                {["A", "B", "C", "D"].map((letter) => {
                                                    const isSelected = cleanStudentAnswer === letter;
                                                    const isKey = cleanKey === letter;

                                                    let btnBg = darkMode ? "#1E293B" : "#FFFFFF";
                                                    let btnBorder = darkMode ? "#334155" : "#CBD5E1";
                                                    let letterColor = textMain;

                                                    if (isSelected) {
                                                        btnBg = isKey ? "#10B981" : "#EF4444";
                                                        btnBorder = isKey ? "#059669" : "#DC2626";
                                                        letterColor = "#FFFFFF";
                                                    }

                                                    return (
                                                        <TouchableOpacity
                                                            key={letter}
                                                            style={[
                                                                styles.bubbleBtn,
                                                                { backgroundColor: btnBg, borderColor: btnBorder },
                                                            ]}
                                                            onPress={() => handleSelectAnswerForItem(item.questionNumber, letter)}
                                                            activeOpacity={0.7}
                                                        >
                                                            <Text style={[styles.bubbleBtnText, { color: letterColor }]}>
                                                                {letter}
                                                            </Text>
                                                            {isKey && !isSelected && (
                                                                <View style={styles.keyDot} />
                                                            )}
                                                        </TouchableOpacity>
                                                    );
                                                })}

                                                {/* Compact Blank Button */}
                                                <TouchableOpacity
                                                    style={[
                                                        styles.bubbleBtn,
                                                        styles.blankBtn,
                                                        {
                                                            backgroundColor: cleanStudentAnswer === ""
                                                                ? (darkMode ? "#334155" : "#0F172A")
                                                                : (darkMode ? "#1E293B" : "#FFFFFF"),
                                                            borderColor: cleanStudentAnswer === ""
                                                                ? (darkMode ? "#475569" : "#0F172A")
                                                                : (darkMode ? "#334155" : "#CBD5E1"),
                                                        },
                                                    ]}
                                                    onPress={() => handleSelectAnswerForItem(item.questionNumber, "")}
                                                    activeOpacity={0.7}
                                                >
                                                    <Text
                                                        style={[
                                                            styles.blankBtnText,
                                                            { color: cleanStudentAnswer === "" ? "#FFFFFF" : textSub },
                                                        ]}
                                                    >
                                                        Blank
                                                    </Text>
                                                </TouchableOpacity>
                                            </View>
                                        ) : isTF ? (
                                            <View style={styles.bubbleRow}>
                                                {["T", "F"].map((opt) => {
                                                    const isSelected = cleanStudentAnswer.startsWith(opt);
                                                    const isKey = cleanKey.startsWith(opt);
                                                    return (
                                                        <TouchableOpacity
                                                            key={opt}
                                                            style={[
                                                                styles.bubbleBtn,
                                                                {
                                                                    backgroundColor: isSelected
                                                                        ? (isKey ? "#10B981" : "#EF4444")
                                                                        : (darkMode ? "#1E293B" : "#FFFFFF"),
                                                                    borderColor: isSelected
                                                                        ? (isKey ? "#059669" : "#DC2626")
                                                                        : border,
                                                                },
                                                            ]}
                                                            onPress={() => handleSelectAnswerForItem(item.questionNumber, opt)}
                                                        >
                                                            <Text
                                                                style={[
                                                                    styles.bubbleBtnText,
                                                                    { color: isSelected ? "#FFFFFF" : textMain },
                                                                ]}
                                                            >
                                                                {opt === "T" ? "True" : "False"}
                                                            </Text>
                                                        </TouchableOpacity>
                                                    );
                                                })}
                                                <TouchableOpacity
                                                    style={[
                                                        styles.bubbleBtn,
                                                        styles.blankBtn,
                                                        {
                                                            backgroundColor: cleanStudentAnswer === ""
                                                                ? (darkMode ? "#334155" : "#0F172A")
                                                                : (darkMode ? "#1E293B" : "#FFFFFF"),
                                                            borderColor: border,
                                                        },
                                                    ]}
                                                    onPress={() => handleSelectAnswerForItem(item.questionNumber, "")}
                                                >
                                                    <Text
                                                        style={[
                                                            styles.blankBtnText,
                                                            { color: cleanStudentAnswer === "" ? "#FFFFFF" : textSub },
                                                        ]}
                                                    >
                                                        Blank
                                                    </Text>
                                                </TouchableOpacity>
                                            </View>
                                        ) : (
                                            <View style={styles.writtenRow}>
                                                <TextInput
                                                    style={[
                                                        styles.writtenInput,
                                                        {
                                                            backgroundColor: darkMode ? "#1E293B" : "#FFFFFF",
                                                            color: textMain,
                                                            borderColor: border,
                                                        },
                                                    ]}
                                                    placeholder="Type student's handwritten answer..."
                                                    placeholderTextColor={textSub}
                                                    value={customInputs[item.questionNumber] ?? item.studentAnswer ?? ""}
                                                    onChangeText={(val) =>
                                                        setCustomInputs((prev) => ({ ...prev, [item.questionNumber]: val }))
                                                    }
                                                />
                                                <TouchableOpacity
                                                    style={[styles.writtenSetBtn, { backgroundColor: accentColor }]}
                                                    onPress={() =>
                                                        handleSelectAnswerForItem(
                                                            item.questionNumber,
                                                            customInputs[item.questionNumber] || ""
                                                        )
                                                    }
                                                >
                                                    <Text style={styles.writtenSetBtnText}>Set</Text>
                                                </TouchableOpacity>
                                                <TouchableOpacity
                                                    style={[
                                                        styles.bubbleBtn,
                                                        styles.blankBtn,
                                                        {
                                                            width: 64,
                                                            backgroundColor: cleanStudentAnswer === ""
                                                                ? (darkMode ? "#334155" : "#0F172A")
                                                                : (darkMode ? "#1E293B" : "#FFFFFF"),
                                                            borderColor: border,
                                                        },
                                                    ]}
                                                    onPress={() => handleSelectAnswerForItem(item.questionNumber, "")}
                                                >
                                                    <Text
                                                        style={[
                                                            styles.blankBtnText,
                                                            { color: cleanStudentAnswer === "" ? "#FFFFFF" : textSub },
                                                        ]}
                                                    >
                                                        Blank
                                                    </Text>
                                                </TouchableOpacity>
                                            </View>
                                        )}

                                        {/* Subtle manual override toggle link */}
                                        <View style={styles.overrideLinkRow}>
                                            {item.isOverridden && (
                                                <TouchableOpacity
                                                    onPress={() => handleResetToAiForItem(item.questionNumber)}
                                                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                                >
                                                    <Text style={styles.revertLinkText}>Revert to AI</Text>
                                                </TouchableOpacity>
                                            )}
                                            <TouchableOpacity
                                                onPress={() => handleTogglePointsForItem(item.questionNumber, !item.isCorrect)}
                                                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                            >
                                                <Text style={styles.overrideLinkText}>
                                                    {item.isCorrect ? "Mark 0 pt" : "+1 pt override (Defective item)"}
                                                </Text>
                                            </TouchableOpacity>
                                        </View>
                                    </View>
                                );
                            })
                        ) : (
                            <View style={styles.emptyContainer}>
                                <Ionicons name="checkmark-done-circle" size={48} color="#10B981" />
                                <Text style={[styles.emptyTitle, { color: textMain }]}>
                                    All Flagged Items Resolved
                                </Text>
                                <Text style={[styles.emptySubtitle, { color: textSub }]}>
                                    No questions currently require manual teacher review.
                                </Text>
                            </View>
                        )}
                    </ScrollView>

                    {/* ── STICKY FOOTER ─────────────────────────────────────────── */}
                    <View style={[styles.stickyFooter, { borderTopColor: border }]}>
                        <View>
                            <Text style={[styles.footerScoreLabel, { color: textSub }]}>Updated Score</Text>
                            <Text style={[styles.footerScoreValue, { color: textMain }]}>
                                {computedTotalScore}{" "}
                                <Text style={{ fontSize: 13, fontWeight: "500", color: textSub }}>
                                    / {gradingResult.maxScore}
                                </Text>
                            </Text>
                        </View>

                        <TouchableOpacity
                            style={[styles.saveReviewBtn, { backgroundColor: accentColor }]}
                            onPress={handleApplyChanges}
                            activeOpacity={0.8}
                        >
                            <Text style={styles.saveReviewBtnText}>Save Review</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* ── FULL IMAGE PREVIEW MODAL ─────────────────────────────────── */}
                {scannedImageUri && (
                    <Modal
                        visible={imagePreviewOpen}
                        transparent
                        animationType="fade"
                        onRequestClose={() => setImagePreviewOpen(false)}
                    >
                        <View style={styles.fullImageOverlay}>
                            <TouchableOpacity
                                style={styles.fullImageCloseBtn}
                                onPress={() => setImagePreviewOpen(false)}
                            >
                                <Ionicons name="close" size={24} color="#FFFFFF" />
                            </TouchableOpacity>
                            <Image
                                source={{ uri: scannedImageUri }}
                                style={styles.fullImage}
                                resizeMode="contain"
                            />
                        </View>
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
        height: "92%",
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
        marginBottom: 8,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingBottom: 12,
        borderBottomWidth: 1,
    },
    headerTitle: {
        fontSize: 16,
        fontWeight: "700",
    },
    headerSubtitle: {
        fontSize: 12,
        marginTop: 2,
    },
    viewSheetHeaderBtn: {
        paddingHorizontal: 9,
        paddingVertical: 5,
        borderRadius: 6,
        borderWidth: 1,
    },
    viewSheetHeaderBtnText: {
        fontSize: 11.5,
        fontWeight: "600",
    },
    closeIconBtn: {
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
    },

    /* ── Sticky Anchor Bar ── */
    anchorBar: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderBottomWidth: 1,
    },
    anchorScrollWrap: {
        flex: 1,
        overflow: "hidden",
    },
    anchorScroll: {
        gap: 6,
        paddingRight: 8,
        alignItems: "center",
    },
    anchorBarDivider: {
        width: 1,
        height: 20,
        marginHorizontal: 8,
    },
    anchorChip: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 16,
    },
    anchorChipText: {
        fontSize: 12,
        fontWeight: "700",
    },
    amberDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: "#F59E0B",
        marginLeft: 4,
    },
    filterBtn: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 8,
        paddingVertical: 5,
        borderRadius: 8,
        borderWidth: 1,
    },
    filterBtnText: {
        fontSize: 11,
        fontWeight: "600",
    },

    /* ── Continuous Scroll ── */
    mainScrollView: {
        flex: 1,
    },
    mainScrollContent: {
        padding: 16,
        gap: 14,
    },

    /* ── Compact Question Card ── */
    compactQuestionCard: {
        borderRadius: 12,
        borderWidth: 1,
        padding: 12,
        gap: 8,
    },
    cardHeaderRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    cardHeaderLeft: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    qSquareBadge: {
        width: 28,
        height: 28,
        borderRadius: 6,
        alignItems: "center",
        justifyContent: "center",
    },
    qSquareBadgeText: {
        color: "#FFFFFF",
        fontSize: 12,
        fontWeight: "800",
    },
    qTitleText: {
        fontSize: 15,
        fontWeight: "600",
    },
    flagReasonPill: {
        backgroundColor: "#FFFBEB",
        borderWidth: 1,
        borderColor: "#FDE68A",
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
    },
    flagReasonPillText: {
        color: "#B45309",
        fontSize: 11,
        fontWeight: "600",
    },
    verifiedBadge: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        backgroundColor: "#F0FDF4",
        borderWidth: 1,
        borderColor: "#BBF7D0",
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
    },
    verifiedBadgeText: {
        color: "#16A34A",
        fontSize: 11,
        fontWeight: "700",
    },

    /* ── Thumbnail ── */
    thumbnailWrap: {
        height: 84,
        borderRadius: 8,
        overflow: "hidden",
        backgroundColor: "#F1F5F9",
        position: "relative",
    },
    thumbnailImg: {
        width: "100%",
        height: "100%",
    },
    expandThumbBtn: {
        position: "absolute",
        top: 6,
        right: 6,
        backgroundColor: "rgba(15, 23, 42, 0.7)",
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
    },
    expandThumbText: {
        color: "#FFFFFF",
        fontSize: 10.5,
        fontWeight: "600",
    },

    /* ── Single-Line Metadata Strip ── */
    metaStripRow: {
        paddingVertical: 2,
    },
    metaStripText: {
        fontSize: 12,
        color: "#64748B",
    },

    /* ── One-Tap Bubble Selector ── */
    bubbleRow: {
        flexDirection: "row",
        gap: 8,
    },
    bubbleBtn: {
        flex: 1,
        height: 44,
        borderRadius: 10,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
    },
    bubbleBtnText: {
        fontSize: 15,
        fontWeight: "700",
    },
    keyDot: {
        position: "absolute",
        top: 4,
        right: 4,
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: "#10B981",
    },
    blankBtn: {
        flex: 1.1,
    },
    blankBtnText: {
        fontSize: 12.5,
        fontWeight: "600",
    },
    writtenRow: {
        flexDirection: "row",
        gap: 8,
        alignItems: "center",
    },
    writtenInput: {
        flex: 1,
        height: 44,
        borderRadius: 10,
        borderWidth: 1,
        paddingHorizontal: 12,
        fontSize: 13,
    },
    writtenSetBtn: {
        height: 44,
        paddingHorizontal: 14,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
    },
    writtenSetBtnText: {
        color: "#FFFFFF",
        fontSize: 13,
        fontWeight: "700",
    },
    overrideLinkRow: {
        flexDirection: "row",
        justifyContent: "flex-end",
        gap: 12,
        marginTop: 2,
    },
    overrideLinkText: {
        fontSize: 11,
        color: "#64748B",
    },
    revertLinkText: {
        fontSize: 11,
        color: "#2563EB",
        fontWeight: "600",
    },

    /* ── Empty State ── */
    emptyContainer: {
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 40,
        gap: 8,
    },
    emptyTitle: {
        fontSize: 15,
        fontWeight: "700",
    },
    emptySubtitle: {
        fontSize: 12,
        textAlign: "center",
        paddingHorizontal: 20,
    },

    /* ── Sticky Footer ── */
    stickyFooter: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingTop: 12,
        borderTopWidth: 1,
    },
    footerScoreLabel: {
        fontSize: 11,
        fontWeight: "500",
    },
    footerScoreValue: {
        fontSize: 18,
        fontWeight: "800",
    },
    saveReviewBtn: {
        height: 44,
        borderRadius: 10,
        paddingHorizontal: 22,
        alignItems: "center",
        justifyContent: "center",
    },
    saveReviewBtnText: {
        color: "#FFFFFF",
        fontSize: 14,
        fontWeight: "700",
    },

    /* ── Full Image Preview ── */
    fullImageOverlay: {
        flex: 1,
        backgroundColor: "rgba(0, 0, 0, 0.9)",
        justifyContent: "center",
        alignItems: "center",
    },
    fullImageCloseBtn: {
        position: "absolute",
        top: 48,
        right: 20,
        zIndex: 10,
        padding: 8,
    },
    fullImage: {
        width: "92%",
        height: "80%",
    },
});
