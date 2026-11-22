import { useEffect, useState } from "react";
import { QrCode, CheckCircle2, FileText, XCircle, Loader2 } from "lucide-react";
import styles from "./PdfExportingAnimation.module.css";

export interface PdfExportingAnimationProps {
  quizTitle?: string;
  exportVersion?: "A" | "B" | "C";
  accentColor?: string;
  statusText?: string;
  onCancel?: () => void;
  cancelLabel?: string;
  isCancelling?: boolean;
}

export function PdfExportingAnimation({
  quizTitle = "Assessment",
  exportVersion = "A",
  accentColor = "#EA580C",
  statusText,
  onCancel,
  cancelLabel = "Cancel Export",
  isCancelling = false,
}: PdfExportingAnimationProps) {
  const [localCancelling, setLocalCancelling] = useState<boolean>(false);
  const cancelling = Boolean(isCancelling || localCancelling);
  const [stageIndex, setStageIndex] = useState<number>(0);
  const [percentDisplay, setPercentDisplay] = useState<number>(18);
  const [activeRow, setActiveRow] = useState<number>(1);

  const STAGES = [
    {
      title: `Formatting Set ${exportVersion} Layout & Typography`,
      sub: "Aligning test margins, section headers, and DepEd standards",
    },
    {
      title: "Embedding Scannable Anchors & QR Code",
      sub: "Calibrating 4-corner markers for one-shot camera grading",
    },
    {
      title: "Compiling Print-Ready Vector PDF",
      sub: "Generating 300 DPI high-resolution pages & answer key",
    },
  ];

  // 1. Advance rows 1..3
  useEffect(() => {
    const rowTimer = setInterval(() => {
      setActiveRow((prev) => (prev >= 3 ? 1 : prev + 1));
    }, 700);
    return () => clearInterval(rowTimer);
  }, []);

  // 2. Advance stages 0..2
  useEffect(() => {
    const stageTimer = setInterval(() => {
      setStageIndex((prev) => (prev < STAGES.length - 1 ? prev + 1 : prev));
    }, 1300);
    return () => clearInterval(stageTimer);
  }, [STAGES.length]);

  // 3. Smooth forward progress bar (18% -> 98%)
  useEffect(() => {
    const progTimer = setInterval(() => {
      setPercentDisplay((prev) => {
        if (prev < 50) return prev + 6;
        if (prev < 80) return prev + 4;
        if (prev < 96) return prev + 2;
        return 98;
      });
    }, 200);
    return () => clearInterval(progTimer);
  }, []);

  const currentStage = STAGES[stageIndex];

  return (
    <div className={styles.container}>
      {/* ── 1. Top Animated Stage: Rich Stylized Paper Sheet Preview ── */}
      <div className={styles.stageCard}>
        <div className={styles.paperSheet}>
          {/* 4 Breathing Corner Registration Squares */}
          <div className={`${styles.cornerMarker} ${styles.cornerTL}`}>
            <div className={styles.solidMarkerBox} />
          </div>
          <div className={`${styles.cornerMarker} ${styles.cornerTR}`}>
            <div className={styles.solidMarkerBox} />
          </div>
          <div className={`${styles.cornerMarker} ${styles.cornerBL}`}>
            <div className={styles.solidMarkerBox} />
          </div>
          <div className={`${styles.cornerMarker} ${styles.cornerBR}`}>
            <div className={styles.solidMarkerBox} />
          </div>

          {/* Sheet Header: Set Pill Badge + Skeleton Title + Mini QR Box */}
          <div className={styles.sheetHeader}>
            <div className={styles.headerLeft}>
              <div
                className={styles.versionBadge}
                style={{
                  backgroundColor: `${accentColor}18`,
                  color: accentColor,
                }}
              >
                <FileText size={10} />
                <span>SET {exportVersion}</span>
              </div>
              <div className={styles.skeletonLineMain} />
              <div className={styles.skeletonLineSub} />
            </div>
            <div className={styles.miniQrBox}>
              <QrCode size={18} className={styles.qrIcon} />
            </div>
          </div>

          {/* Simulated Scannable Question Rows & Bubble Grid */}
          <div className={styles.itemsGrid}>
            {[1, 2, 3].map((rowNum) => {
              const isHighlight = activeRow === rowNum;
              return (
                <div
                  key={rowNum}
                  className={`${styles.itemRow} ${
                    isHighlight ? styles.itemRowActive : ""
                  }`}
                >
                  <span
                    className={styles.rowNumber}
                    style={{ color: accentColor }}
                  >
                    0{rowNum}
                  </span>
                  <div
                    className={styles.skeletonBar}
                    style={{
                      width: rowNum === 1 ? 52 : rowNum === 2 ? 44 : 48,
                    }}
                  />
                  <div className={styles.bubbleGroup}>
                    {["A", "B", "C", "D"].map((letter) => (
                      <div key={letter} className={styles.bubble}>
                        <span className={styles.bubbleText}>{letter}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Sheet Footer Strip: Ready to Print */}
          <div className={styles.sheetFooterStrip}>
            <CheckCircle2 size={12} className={styles.footerCheckIcon} />
            <span className={styles.sheetFooterText}>
              300 DPI Vector • Scannable Grid
            </span>
          </div>

          {/* Sweeping Laser / Print Head Beam */}
          <div
            className={styles.laserBar}
            style={
              cancelling
                ? {
                    backgroundColor: "#ef4444",
                    boxShadow: "0 0 8px 1px #ef4444, 0 0 18px 2px rgba(239, 68, 68, 0.45)",
                  }
                : undefined
            }
          >
            <div className={styles.laserTrail} />
          </div>

          {cancelling && (
            <div className={styles.cancellingSheetOverlay}>
              <div className={styles.cancellingPill}>
                <Loader2 size={14} className={styles.cancelSpinner} />
                <span>STOPPING EXPORT…</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── 2. Typography Block ── */}
      <div className={styles.statusArea}>
        <div className={styles.stageTitleRow}>
          <span
            className={styles.pulseDot}
            style={{ backgroundColor: cancelling ? "#dc2626" : accentColor }}
          />
          <h4
            className={styles.stageTitle}
            style={cancelling ? { color: "#dc2626" } : undefined}
          >
            {cancelling
              ? "Cancelling PDF Export..."
              : statusText || currentStage.title}
          </h4>
        </div>
        <p className={styles.stageSub}>
          {cancelling
            ? "Cancel pressed — stopping PDF generator and cleaning up..."
            : `${quizTitle && !statusText ? `${quizTitle} — ` : ""}${currentStage.sub}`}
        </p>
      </div>

      {/* ── 3. Smooth Continuous Progress Bar ── */}
      <div className={styles.progressTrack}>
        <div
          className={styles.progressFill}
          style={{
            width: `${percentDisplay}%`,
            backgroundColor: cancelling ? "#dc2626" : accentColor,
          }}
        />
      </div>

      <div className={styles.stepCounterRow}>
        <span
          className={styles.stepText}
          style={cancelling ? { color: "#dc2626", fontWeight: 700 } : undefined}
        >
          {cancelling
            ? "Stopping background task..."
            : `Step ${stageIndex + 1} of ${STAGES.length}`}
        </span>
        <span
          className={styles.percentText}
          style={cancelling ? { color: "#dc2626" } : undefined}
        >
          {cancelling ? "Cancelling" : `${percentDisplay}%`}
        </span>
      </div>

      {onCancel && (
        <button
          type="button"
          disabled={cancelling}
          className={`${styles.cancelExportBtn} ${
            cancelling ? styles.cancelExportBtnCancelling : ""
          }`}
          onMouseDown={() => {
            if (cancelling) return;
            setLocalCancelling(true);
            onCancel();
          }}
          onClick={() => {
            if (cancelling) return;
            setLocalCancelling(true);
            onCancel();
          }}
        >
          {cancelling ? (
            <>
              <Loader2 size={16} className={styles.cancelSpinner} />
              <span>Cancelling export...</span>
            </>
          ) : (
            <>
              <XCircle size={16} />
              <span>{cancelLabel}</span>
            </>
          )}
        </button>
      )}
    </div>
  );
}
