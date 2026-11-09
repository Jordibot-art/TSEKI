import { useEffect, useState } from "react";
import { Sparkles, Check } from "lucide-react";
import styles from "./AssessmentGeneratingAnimation.module.css";

export interface AssessmentGeneratingAnimationProps {
  statusText?: string;
  isBusy?: boolean;
  subject?: string;
  gradeLevel?: string;
  questionCount?: number | string;
  difficulty?: string;
  questionType?: string;
  accentColor?: string;
}

export function AssessmentGeneratingAnimation({
  statusText,
  isBusy = false,
  subject = "Lesson",
  gradeLevel,
  questionCount = "10 Items",
  difficulty = "Medium",
  accentColor = "#EA580C",
}: AssessmentGeneratingAnimationProps) {
  // Continuous forward-moving progress display (8% -> 95%)
  const [percentDisplay, setPercentDisplay] = useState<number>(8);

  // Cycling question number in the preview card (1..5)
  const [questionNum, setQuestionNum] = useState<number>(1);

  // Dynamic 4 stages matching TSEKI Mobile
  const [stageIndex, setStageIndex] = useState<number>(0);

  const formattedCount =
    typeof questionCount === "number" ? `${questionCount} Items` : questionCount;

  const STAGES = [
    {
      title: "Analyzing Curriculum & Lesson Materials",
      sub: "Aligning with DepEd Bloom's Taxonomy standards",
    },
    {
      title: "Crafting Higher-Order Thinking Questions",
      sub: `Formulating ${formattedCount} tailored for ${difficulty} level`,
    },
    {
      title: "Generating Plausible Distractors & Keys",
      sub: "Building fair, misconception-tested answer choices",
    },
    {
      title: "Formatting Scannable Test Paper Grid",
      sub: "Embedding 4-corner markers & verification blocks",
    },
  ];

  const isSuccess = Boolean(
    statusText && statusText.toLowerCase().includes("successfully")
  );

  // 1. Smooth progress timer (never resets backwards)
  useEffect(() => {
    const timer = setInterval(() => {
      setPercentDisplay((prev) => {
        if (prev < 32) return prev + 3;
        if (prev < 68) return prev + 2;
        if (prev < 88) return prev + 1;
        if (prev < 95) return Math.min(prev + 0.5, 95);
        return prev;
      });
    }, 400);

    return () => clearInterval(timer);
  }, []);

  // 2. Cycle question number every 2.6s (Question 1 -> 2 -> 3 -> 4 -> 5)
  useEffect(() => {
    const qTimer = setInterval(() => {
      setQuestionNum((prev) => (prev >= 5 ? 1 : prev + 1));
    }, 2600);

    return () => clearInterval(qTimer);
  }, []);

  // 3. Advance stages sequentially every 2.7s (holds on final stage)
  useEffect(() => {
    const sTimer = setInterval(() => {
      setStageIndex((prev) => (prev < STAGES.length - 1 ? prev + 1 : prev));
    }, 2700);

    return () => clearInterval(sTimer);
  }, [STAGES.length]);

  // 4. Snap to 100% on success
  useEffect(() => {
    if (isSuccess) {
      setStageIndex(STAGES.length - 1);
      setPercentDisplay(100);
    }
  }, [isSuccess, STAGES.length]);

  const activeColor = isSuccess ? "#10B981" : isBusy ? "#F59E0B" : accentColor;
  const currentStage = STAGES[stageIndex];
  const greenOptionIdx = questionNum % 2 === 1 ? 1 : 0; // alternates between B (idx 1) and A (idx 0)

  return (
    <div className={styles.container}>
      {/* ── 1. Top Animated Stage: Rich Floating Question Card Preview (animation1.mp4 from TSEKI Mobile) ── */}
      <div className={styles.stageCard}>
        {/* Subtle Stacked Back Card Silhouette */}
        <div className={styles.backDeckCard} />

        {/* Floating Simulated Question Card */}
        <div className={styles.previewQuestionCard} key={questionNum}>
          {/* Card Header: Question Tag + Point Badge */}
          <div className={styles.questionHeaderRow}>
            <div
              className={styles.questionTag}
              style={{
                backgroundColor: `${activeColor}18`,
                color: activeColor,
              }}
            >
              <Sparkles size={11} color={activeColor} />
              <span>{isBusy ? "Retrying" : `Question ${questionNum}`}</span>
            </div>
            <div className={styles.questionHeaderRight}>
              <div
                className={styles.skeletonText}
                style={{
                  width: 38,
                  height: 6,
                  backgroundColor: `${activeColor}38`,
                }}
              />
              <div className={styles.ptBadge}>
                <span>1 pt</span>
              </div>
            </div>
          </div>

          {/* Question Stem Skeleton Lines */}
          <div
            className={styles.skeletonText}
            style={{ width: "94%", height: 6.5, marginTop: 9 }}
          />
          <div
            className={styles.skeletonText}
            style={{ width: "70%", height: 6.5, marginTop: 5 }}
          />

          {/* Simulated Multiple Choice Options (A, B, C with Green Key Checkmark) */}
          <div className={styles.optionsList}>
            {["A", "B", "C"].map((letter, idx) => {
              const isCorrect = idx === greenOptionIdx;
              const barWidths = ["54%", "66%", "48%"];

              return (
                <div
                  key={letter}
                  className={`${styles.optionRow} ${
                    isCorrect ? styles.optionRowCorrect : ""
                  }`}
                >
                  <div
                    className={`${styles.optionDot} ${
                      isCorrect ? styles.optionDotCorrect : ""
                    }`}
                  >
                    {isCorrect ? (
                      <Check size={9} strokeWidth={3} color="#FFFFFF" />
                    ) : (
                      <span className={styles.optionLetter}>{letter}</span>
                    )}
                  </div>
                  <div
                    className={styles.skeletonText}
                    style={{
                      width: barWidths[idx],
                      height: 5.5,
                      backgroundColor: isCorrect
                        ? "rgba(16, 185, 129, 0.45)"
                        : "var(--zinc-200, #E2E8F0)",
                    }}
                  />
                  {isCorrect && <span className={styles.keyLabel}>Key ✓</span>}
                </div>
              );
            })}
          </div>

          {/* Sweeping AI Synthesis Beam Overlay */}
          <div
            className={styles.sweepBar}
            style={{
              backgroundColor: activeColor,
              boxShadow: `0 0 10px ${activeColor}`,
            }}
          >
            <div
              className={styles.sweepTrail}
              style={{
                background: `linear-gradient(to bottom, ${activeColor}24, transparent)`,
              }}
            />
          </div>
        </div>
      </div>

      {/* ── 2. Parameter Badges ── */}
      <div className={styles.badgeRow}>
        {subject && <span className={styles.badge}>📘 {subject}</span>}
        {gradeLevel && <span className={styles.badge}>🎓 {gradeLevel}</span>}
        {formattedCount && <span className={styles.badge}>📝 {formattedCount}</span>}
        {difficulty && <span className={styles.badge}>⚡ {difficulty}</span>}
      </div>

      {/* ── 3. Status Text & Stages ── */}
      <div className={styles.statusArea}>
        <div className={styles.stageTitleRow}>
          <div
            className={styles.pulseDot}
            style={{ backgroundColor: activeColor }}
          />
          <h4 className={styles.stageHeading}>
            {isBusy ? "AI Server Busy — Auto-Retrying" : currentStage.title}
          </h4>
        </div>
        <p
          className={styles.stageSubtitle}
          style={{
            color: isSuccess
              ? "#10B981"
              : isBusy
              ? "#D97706"
              : "var(--zinc-500, #64748B)",
            fontWeight: isSuccess ? 600 : 400,
          }}
        >
          {statusText ||
            (isBusy
              ? "Waiting with exponential backoff before engaging backup model..."
              : currentStage.sub)}
        </p>
      </div>

      {/* ── 4. Smooth Continuous Progress Bar + Step & Live Percentage Row ── */}
      <div className={styles.progressTrack}>
        <div
          className={styles.progressFill}
          style={{
            backgroundColor: activeColor,
            width: `${Math.min(percentDisplay, 100)}%`,
          }}
        />
      </div>

      <div className={styles.stepCounterRow}>
        <span className={styles.stepText}>
          Step {stageIndex + 1} of {STAGES.length}
        </span>
        <span
          className={`${styles.percentText} tabular-nums`}
          style={{ color: isSuccess ? "#10B981" : "var(--zinc-900, #0F172A)" }}
        >
          {isSuccess ? "100%" : `${Math.round(percentDisplay)}%`}
        </span>
      </div>
    </div>
  );
}

export default AssessmentGeneratingAnimation;
