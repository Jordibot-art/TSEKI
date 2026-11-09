import { useEffect, useState } from "react";
import { Check, QrCode } from "lucide-react";
import styles from "./PublishingQuizAnimation.module.css";

export interface PublishingQuizAnimationProps {
  quizTitle?: string;
  accentColor?: string;
  statusText?: string;
}

export function PublishingQuizAnimation({
  quizTitle = "Assessment",
  accentColor = "#EA580C",
  statusText,
}: PublishingQuizAnimationProps) {
  const [activeRow, setActiveRow] = useState<number>(1);
  const [stageIndex, setStageIndex] = useState<number>(0);
  const [percentDisplay, setPercentDisplay] = useState<number>(18);

  const STAGES = [
    {
      title: "Validating Answer Key & Sections",
      sub: "Checking item numbers, answer keys, and point totals",
    },
    {
      title: "Mapping Camera Grader Coordinates",
      sub: "Calibrating 4-corner anchors & scannable answer boxes",
    },
    {
      title: "Publishing to Classroom Archive",
      sub: "Syncing quiz records and test sheets to your classroom",
    },
  ];

  const BAR_WIDTHS = ["52%", "64%", "44%", "58%"];
  const KEY_LETTERS = ["B", "A", "C", "D"];

  // 1. Advance rows 1..4
  useEffect(() => {
    const rowTimer = setInterval(() => {
      setActiveRow((prev) => (prev >= 4 ? 1 : prev + 1));
    }, 1200);

    return () => clearInterval(rowTimer);
  }, []);

  // 2. Advance stages 0..2
  useEffect(() => {
    const stageTimer = setInterval(() => {
      setStageIndex((prev) => (prev < STAGES.length - 1 ? prev + 1 : prev));
    }, 2400);

    return () => clearInterval(stageTimer);
  }, [STAGES.length]);

  // 3. Smooth forward progress bar (18% -> 98%)
  useEffect(() => {
    const progTimer = setInterval(() => {
      setPercentDisplay((prev) => {
        if (prev < 45) return prev + 3;
        if (prev < 78) return prev + 2;
        if (prev < 95) return prev + 1;
        if (prev < 98) return prev + 0.5;
        return prev;
      });
    }, 280);

    return () => clearInterval(progTimer);
  }, []);

  const currentStage = STAGES[stageIndex];

  return (
    <div className={styles.container}>
      {/* ── 1. Top Paper Sheet Calibration Canvas ── */}
      <div className={styles.stageCard}>
        <div className={styles.paperSheet}>
          {/* 4 Solid Corner Calibration Markers */}
          <div className={`${styles.cornerMarker} ${styles.topLeft}`} />
          <div className={`${styles.cornerMarker} ${styles.topRight}`} />
          <div className={`${styles.cornerMarker} ${styles.bottomLeft}`} />
          <div className={`${styles.cornerMarker} ${styles.bottomRight}`} />

          {/* Sheet Header: Master Key Badge + Skeleton Title + QR */}
          <div className={styles.sheetHeader}>
            <div style={{ flex: 1 }}>
              <div
                className={styles.masterBadge}
                style={{
                  backgroundColor: `${accentColor}18`,
                  color: accentColor,
                }}
              >
                <span>MASTER KEY</span>
              </div>
              <div
                className={styles.skeletonLine}
                style={{ width: "84%", height: 4.5, marginTop: 5 }}
              />
            </div>
            <div className={styles.miniQrBox}>
              <QrCode size={16} color="#10B981" />
            </div>
          </div>

          {/* 4 Validated Answer Key Rows */}
          <div className={styles.keyGrid}>
            {[1, 2, 3, 4].map((rowNum, idx) => {
              const isLocked = rowNum <= activeRow;

              return (
                <div key={rowNum} className={styles.keyRow}>
                  <span
                    className={styles.rowNumber}
                    style={{
                      color: isLocked ? accentColor : "var(--zinc-400, #94A3B8)",
                    }}
                  >
                    {`0${rowNum}`}
                  </span>

                  <div
                    className={`${styles.checkCircle} ${
                      isLocked ? styles.checkCircleLocked : ""
                    }`}
                  >
                    {isLocked ? (
                      <Check size={9} strokeWidth={3} color="#FFFFFF" />
                    ) : (
                      <div className={styles.pendingDot} />
                    )}
                  </div>

                  <div
                    className={styles.skeletonLine}
                    style={{
                      width: BAR_WIDTHS[idx],
                      height: 5.5,
                      backgroundColor: isLocked
                        ? "rgba(16, 185, 129, 0.42)"
                        : "var(--zinc-200, #E2E8F0)",
                    }}
                  />

                  <div
                    className={styles.keyPill}
                    style={{
                      backgroundColor: isLocked
                        ? "rgba(16, 185, 129, 0.14)"
                        : "var(--zinc-100, #F1F5F9)",
                      color: isLocked ? "#10B981" : "var(--zinc-400, #94A3B8)",
                    }}
                  >
                    <span>{`Key: ${KEY_LETTERS[idx]}`}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Sweeping Laser Calibration Beam */}
          <div className={styles.laserBar}>
            <div className={styles.laserTrail} />
          </div>
        </div>
      </div>

      {/* ── 2. Status Typography Block ── */}
      <div className={styles.statusArea}>
        <div className={styles.stageTitleRow}>
          <div
            className={styles.pulseDot}
            style={{ backgroundColor: accentColor }}
          />
          <h4 className={styles.stageTitle}>{currentStage.title}</h4>
        </div>
        <p className={styles.stageSub}>
          {statusText ||
            (stageIndex === 2 && quizTitle
              ? `Syncing "${quizTitle}" to classroom roster archive...`
              : currentStage.sub)}
        </p>
      </div>

      {/* ── 3. Smooth Progress Bar + Step & Percentage ── */}
      <div className={styles.progressTrack}>
        <div
          className={styles.progressFill}
          style={{
            backgroundColor: accentColor,
            width: `${Math.min(percentDisplay, 100)}%`,
          }}
        />
      </div>

      <div className={styles.stepCounterRow}>
        <span className={styles.stepText}>
          Step {stageIndex + 1} of {STAGES.length}
        </span>
        <span className={`${styles.percentText} tabular-nums`}>
          {Math.round(percentDisplay)}%
        </span>
      </div>
    </div>
  );
}

export default PublishingQuizAnimation;
