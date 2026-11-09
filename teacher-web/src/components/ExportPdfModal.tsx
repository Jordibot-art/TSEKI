import React, { useState } from "react";
import { createPortal } from "react-dom";
import {
  FileText,
  File,
  CheckSquare,
  Square,
  X,
  Download,
} from "lucide-react";
import {
  generatePrintPackage,
  downloadPdfBytes,
  type GeneratedAssessment,
  type BondPaperSize,
} from "../lib/printEngine";
import { showAlert } from "./CustomAlertModal";
import { PdfExportingAnimation } from "./PdfExportingAnimation";
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

    const startTime = Date.now();

    try {
      // Yield to let React mount the animation smoothly
      await new Promise((r) => setTimeout(r, 80));

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

      // Ensure user sees the mobile-styled compilation sequence (at least 1.8s)
      const elapsed = Date.now() - startTime;
      const minDisplay = 1800;
      if (elapsed < minDisplay) {
        await new Promise((r) => setTimeout(r, minDisplay - elapsed));
      }

      setExportStage("Ready! Downloading PDF...");
      await new Promise((r) => setTimeout(r, 200));

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
      className={styles.exportBackdrop}
      onClick={() => {
        if (!exporting) onClose();
      }}
    >
      <div className={styles.exportSheet} onClick={(e) => e.stopPropagation()}>
        {exporting ? (
          <div className={styles.animWrap}>
            <PdfExportingAnimation
              quizTitle={assessment.quizTitle}
              exportVersion={exportVersion}
              accentColor="#EA580C"
              statusText={exportStage}
            />
          </div>
        ) : (
          <>
            <div className={styles.exportSheetHeaderRow}>
              <div className={styles.exportSheetHeader}>
                <h3 className={styles.exportSheetTitle}>
                  Export Paper Sheet Layout
                </h3>
                <p className={styles.exportSheetSub}>
                  Download, print, or share the physical test sheet formatted with
                  scannable answer boxes.
                </p>
              </div>
              <button
                type="button"
                className={styles.sheetCloseBtn}
                onClick={onClose}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            {/* Anti-Cheating Version Selector (Set A / B / C) */}
            <div className={styles.versionRow}>
              <span className={styles.versionLabel}>Test version</span>
              <div className={styles.segmentedTrack}>
                {(["A", "B", "C"] as const).map((ver) => {
                  const isActive = exportVersion === ver;
                  return (
                    <button
                      key={ver}
                      type="button"
                      className={`${styles.segmentBtn} ${
                        isActive ? styles.segmentBtnActive : ""
                      }`}
                      onClick={() => setExportVersion(ver)}
                    >
                      Set {ver}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Force Separate Answer Sheet Toggle */}
            <button
              type="button"
              className={styles.forceSeparateBtn}
              onClick={() => setForceSeparateMode((prev) => !prev)}
            >
              <span className={styles.forceSeparateText}>
                Always use separate Question Booklet + Answer Sheet
              </span>
              <span
                className={`${styles.checkboxIcon} ${
                  forceSeparateMode ? styles.checkboxIconActive : ""
                }`}
              >
                {forceSeparateMode ? (
                  <CheckSquare size={19} />
                ) : (
                  <Square size={19} />
                )}
              </span>
            </button>

            {/* 3 Mobile-Identical Export Option Cards */}
            <div className={styles.optionsList}>
              {/* Option 1: Short Bond Paper */}
              <button
                type="button"
                className={styles.exportOptionBtn}
                onClick={() => handleExport(false, "short")}
              >
                <div className={styles.neutralOptionIcon}>
                  <FileText size={18} />
                </div>
                <div className={styles.optionContent}>
                  <div className={styles.optionTitleRow}>
                    <span className={styles.exportOptionTitle}>
                      Short Bond Paper
                    </span>
                    <span className={styles.dimBadge}>8.5" × 11"</span>
                  </div>
                  <p className={styles.exportOptionSub}>
                    {`1 single sheet (Letter size) • Set ${exportVersion} scannable layout for 1-shot camera scanning`}
                  </p>
                </div>
                <Download size={18} className={styles.downloadIcon} />
              </button>

              {/* Option 2: Long Bond Paper */}
              <button
                type="button"
                className={styles.exportOptionBtn}
                onClick={() => handleExport(false, "long")}
              >
                <div className={styles.neutralOptionIcon}>
                  <File size={18} />
                </div>
                <div className={styles.optionContent}>
                  <div className={styles.optionTitleRow}>
                    <span className={styles.exportOptionTitle}>
                      Long Bond Paper
                    </span>
                    <span className={styles.dimBadge}>8.5" × 13"</span>
                  </div>
                  <p className={styles.exportOptionSub}>
                    {`1 single sheet (Philippine Folio) • Fits all questions with Set ${exportVersion} spacing`}
                  </p>
                </div>
                <Download size={18} className={styles.downloadIcon} />
              </button>

              {/* Option 3: Teacher Answer Key */}
              <button
                type="button"
                className={styles.exportOptionBtn}
                onClick={() => handleExport(true, "short")}
              >
                <div className={styles.neutralOptionIcon}>
                  <CheckSquare size={18} />
                </div>
                <div className={styles.optionContent}>
                  <div className={styles.optionTitleRow}>
                    <span className={styles.exportOptionTitle}>
                      Teacher Answer Key
                    </span>
                    <span className={styles.dimBadge}>PDF</span>
                  </div>
                  <p className={styles.exportOptionSub}>
                    {`1 single sheet with correct answers pre-printed in boxes for Set ${exportVersion}`}
                  </p>
                </div>
                <Download size={18} className={styles.downloadIcon} />
              </button>
            </div>

            {/* Cancel Button */}
            <button
              type="button"
              className={styles.exportCancelBtn}
              onClick={onClose}
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </div>,
    document.body
  );
};
