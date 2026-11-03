import React, { useState } from "react";
import { createPortal } from "react-dom";
import {
  FileText,
  File,
  CheckCircle2,
  Download,
  CheckSquare,
  Square,
  X,
  Loader2,
} from "lucide-react";
import {
  generatePrintPackage,
  downloadPdfBytes,
  type GeneratedAssessment,
  type BondPaperSize,
} from "../lib/printEngine";
import { showAlert } from "./CustomAlertModal";
import styles from "./ExportPdfModal.module.css";

export interface ExportPdfModalProps {
  isOpen: boolean;
  onClose: () => void;
  assessment: GeneratedAssessment | null;
  classTitle?: string;
  subject?: string;
  gradeLevel?: string;
  quizId?: string;
}

export const ExportPdfModal: React.FC<ExportPdfModalProps> = ({
  isOpen,
  onClose,
  assessment,
  classTitle,
  subject,
  gradeLevel,
  quizId,
}) => {
  const [exportVersion, setExportVersion] = useState<"A" | "B" | "C">("A");
  const [forceSeparateMode, setForceSeparateMode] = useState<boolean>(false);
  const [exporting, setExporting] = useState<boolean>(false);
  const [exportStage, setExportStage] = useState<string>("");

  if (!isOpen || !assessment) return null;

  const handleExport = async (
    isKey: boolean = false,
    paperSize: BondPaperSize = "short"
  ) => {
    if (exporting) return;

    setExporting(true);
    setExportStage(
      isKey
        ? `Preparing Teacher Answer Key for Set ${exportVersion}...`
        : `Formatting Set ${exportVersion} (${paperSize === "long" ? "Long Bond" : "Short Bond"})...`
    );

    try {
      // Yield to update UI
      await new Promise((r) => setTimeout(r, 60));

      const safeTitle = (assessment.quizTitle || "Assessment").replace(
        /[^a-zA-Z0-9_\-]/g,
        "_"
      );
      const suggestedFileName = isKey
        ? `${safeTitle}_Answer_Key_Set_${exportVersion}.pdf`
        : `${safeTitle}_Set_${exportVersion}_${paperSize.toUpperCase()}.pdf`;

      const generatedQuizId =
        quizId ||
        `QZ-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${assessment.questions.length}`;

      const printPkg = await generatePrintPackage(assessment, {
        paperSize,
        version: exportVersion,
        classTitle: classTitle || "Classroom Assessment",
        subject: subject || "General Education",
        gradeLevel: gradeLevel || (assessment as any).gradeLevel || "Grade 10",
        forceSeparate: forceSeparateMode,
        quizId: generatedQuizId,
        target: isKey ? "ANSWER_KEY_ONLY" : "STUDENT_ONLY",
      });

      const bytesToExport = isKey
        ? printPkg.answerKeyPdf
        : printPkg.combinedStudentPdf || printPkg.studentPdf;

      if (!bytesToExport || bytesToExport.length === 0) {
        throw new Error("Generated PDF has no content.");
      }

      setExportStage("Downloading PDF file...");
      await new Promise((r) => setTimeout(r, 100));

      downloadPdfBytes(bytesToExport, suggestedFileName);

      setExporting(false);
      onClose();
    } catch (err: any) {
      console.error("PDF export error:", err);
      setExporting(false);
      showAlert({
        title: "Export Failed",
        message:
          err?.message ||
          "Could not compile paper assessment PDF. Please try again.",
        type: "error",
      });
    }
  };

  return createPortal(
    <div
      className={styles.overlay}
      onClick={() => {
        if (!exporting) onClose();
      }}
    >
      <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        <button
          className={styles.closeBtn}
          onClick={onClose}
          disabled={exporting}
          aria-label="Close"
        >
          <X size={18} />
        </button>

        {/* Header */}
        <div className={styles.header}>
          <h3 className={styles.title}>Export Paper Sheet Layout</h3>
          <p className={styles.sub}>
            Download, print, or share the physical test sheet formatted with
            scannable answer boxes.
          </p>
        </div>

        {/* Anti-Cheating Version Selector */}
        <div className={styles.versionRow}>
          <span className={styles.versionLabel}>TEST VERSION (SET):</span>
          <div className={styles.versionPills}>
            {(["A", "B", "C"] as const).map((ver) => (
              <button
                key={ver}
                type="button"
                className={`${styles.versionPill} ${
                  exportVersion === ver ? styles.versionPillActive : ""
                }`}
                onClick={() => setExportVersion(ver)}
                disabled={exporting}
              >
                Set {ver}
              </button>
            ))}
          </div>
        </div>

        {/* Force Separate Mode Toggle */}
        <div
          className={styles.toggleRow}
          onClick={() => {
            if (!exporting) setForceSeparateMode((prev) => !prev);
          }}
        >
          <span className={styles.toggleText}>
            Always use separate Question Booklet + Answer Sheet
          </span>
          <span
            className={`${styles.checkboxIcon} ${
              forceSeparateMode ? styles.checkboxIconActive : ""
            }`}
          >
            {forceSeparateMode ? (
              <CheckSquare size={20} />
            ) : (
              <Square size={20} />
            )}
          </span>
        </div>

        {/* 3 Export Options */}
        <div className={styles.optionsList}>
          {/* Option 1: Short Bond Paper */}
          <button
            type="button"
            className={styles.exportCard}
            onClick={() => handleExport(false, "short")}
            disabled={exporting}
          >
            <div className={`${styles.iconBox} ${styles.iconPurple}`}>
              <FileText size={22} />
            </div>
            <div className={styles.cardContent}>
              <h4 className={styles.cardTitle}>
                Short Bond Paper (8.5" × 11")
              </h4>
              <p className={styles.cardSub}>
                1 single sheet (Letter size) • 2-column scannable layout for 1-shot camera scanning
              </p>
            </div>
            <Download size={20} className={styles.downloadIcon} />
          </button>

          {/* Option 2: Long Bond Paper */}
          <button
            type="button"
            className={styles.exportCard}
            onClick={() => handleExport(false, "long")}
            disabled={exporting}
          >
            <div className={`${styles.iconBox} ${styles.iconViolet}`}>
              <File size={22} />
            </div>
            <div className={styles.cardContent}>
              <h4 className={styles.cardTitle}>
                Long Bond Paper (8.5" × 13")
              </h4>
              <p className={styles.cardSub}>
                1 single sheet (Philippine Folio) • Fits all questions with extra spacing on 1 page
              </p>
            </div>
            <Download size={20} className={styles.downloadIcon} />
          </button>

          {/* Option 3: Teacher Answer Key Paper */}
          <button
            type="button"
            className={styles.exportCard}
            onClick={() => handleExport(true, "short")}
            disabled={exporting}
          >
            <div className={`${styles.iconBox} ${styles.iconGreen}`}>
              <CheckCircle2 size={22} />
            </div>
            <div className={styles.cardContent}>
              <h4 className={styles.cardTitle}>Teacher Answer Key Paper (PDF)</h4>
              <p className={styles.cardSub}>
                1 single sheet with correct answers pre-printed in the boxes for grading reference
              </p>
            </div>
            <Download size={20} className={styles.downloadIcon} />
          </button>
        </div>

        {/* Cancel Button */}
        <button
          type="button"
          className={styles.cancelBtn}
          onClick={onClose}
          disabled={exporting}
        >
          Cancel
        </button>

        {/* Loading Overlay inside modal when generating */}
        {exporting && (
          <div className={styles.exportingOverlay}>
            <div className={styles.spinnerCircle}>
              <Loader2 size={26} className="spinner" />
            </div>
            <h4 className={styles.exportingTitle}>Preparing Scannable PDF</h4>
            <p className={styles.exportingStage}>{exportStage}</p>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
