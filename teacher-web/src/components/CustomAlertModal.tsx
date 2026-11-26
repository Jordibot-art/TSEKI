import React, { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  HelpCircle,
  Info,
  OctagonAlert,
  WifiOff,
  X,
} from "lucide-react";
import styles from "./CustomAlertModal.module.css";

export type AlertType =
  | "busy"
  | "network"
  | "limit"
  | "cooldown"
  | "error"
  | "destructive"
  | "warning"
  | "info"
  | "confirm"
  | "success";

export interface CustomAlertButton {
  text: string;
  style?: "default" | "cancel" | "destructive";
  onPress?: () => void;
}

export interface CustomAlertModalProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  message?: string;
  type?: AlertType;
  buttonText?: string;
  onConfirm?: () => void;
  buttons?: CustomAlertButton[];
  cancelable?: boolean;
}

type SemanticVariant = "success" | "info" | "confirm" | "warning" | "error";

interface ResolvedAlertVisual {
  semantic: SemanticVariant;
  iconKind: "check" | "info" | "help" | "warning" | "error" | "network" | "clock";
  eyebrow: string;
}

function resolveAlertVisualVariant(
  title: string,
  type?: AlertType,
  buttons?: CustomAlertButton[]
): ResolvedAlertVisual {
  if (type === "success") {
    return { semantic: "success", iconKind: "check", eyebrow: "Completed" };
  }
  if (type === "network") {
    return { semantic: "error", iconKind: "network", eyebrow: "Connection" };
  }
  if (type === "busy") {
    return { semantic: "error", iconKind: "clock", eyebrow: "Service Busy" };
  }
  if (type === "error" || type === "destructive") {
    return {
      semantic: "error",
      iconKind: "error",
      eyebrow: type === "destructive" ? "Confirm Action" : "Attention",
    };
  }
  if (type === "limit" || type === "cooldown") {
    return {
      semantic: "warning",
      iconKind: "clock",
      eyebrow: type === "limit" ? "Quota Limit" : "Cooldown",
    };
  }
  if (type === "warning") {
    return { semantic: "warning", iconKind: "warning", eyebrow: "Caution" };
  }
  if (type === "info") {
    return { semantic: "info", iconKind: "info", eyebrow: "Notice" };
  }
  if (type === "confirm") {
    return { semantic: "confirm", iconKind: "help", eyebrow: "Confirmation" };
  }

  const hasDestructiveBtn = (buttons || []).some((b) => b.style === "destructive");
  if (hasDestructiveBtn) {
    return { semantic: "error", iconKind: "error", eyebrow: "Confirm Action" };
  }

  const lowerTitle = (title || "").toLowerCase();
  const errorKeywords = [
    "delete",
    "remove",
    "discard",
    "error",
    "failed",
    "fail",
    "missing",
    "mismatch",
    "weak",
    "too short",
    "invalid",
    "conflict",
    "log out",
    "logout",
    "expired",
  ];
  if (errorKeywords.some((kw) => lowerTitle.includes(kw))) {
    return { semantic: "error", iconKind: "error", eyebrow: "Attention" };
  }

  const warningKeywords = [
    "warning",
    "caution",
    "limit",
    "busy",
    "permission",
    "no data",
    "no students",
    "no quiz",
    "minimum",
    "long answers",
    "cooldown",
  ];
  if (warningKeywords.some((kw) => lowerTitle.includes(kw))) {
    return { semantic: "warning", iconKind: "warning", eyebrow: "Caution" };
  }

  const successKeywords = [
    "success",
    "saved",
    "published",
    "created",
    "updated",
    "exported",
    "complete",
    "approved",
  ];
  if (successKeywords.some((kw) => lowerTitle.includes(kw))) {
    return { semantic: "success", iconKind: "check", eyebrow: "Completed" };
  }

  const isQuestion =
    (buttons !== undefined && buttons.length >= 2) ||
    lowerTitle.endsWith("?") ||
    lowerTitle.includes("confirm") ||
    lowerTitle.includes("publish");

  if (isQuestion) {
    return { semantic: "confirm", iconKind: "help", eyebrow: "Confirmation" };
  }

  return { semantic: "info", iconKind: "info", eyebrow: "Notice" };
}

function renderSemanticIcon(kind: ResolvedAlertVisual["iconKind"]) {
  switch (kind) {
    case "check":
      return <CheckCircle2 size={18} strokeWidth={2.4} />;
    case "network":
      return <WifiOff size={17} strokeWidth={2.4} />;
    case "clock":
      return <Clock size={17} strokeWidth={2.4} />;
    case "warning":
      return <AlertTriangle size={17} strokeWidth={2.4} />;
    case "error":
      return <OctagonAlert size={18} strokeWidth={2.4} />;
    case "help":
      return <HelpCircle size={18} strokeWidth={2.4} />;
    case "info":
    default:
      return <Info size={18} strokeWidth={2.4} />;
  }
}

export default function CustomAlertModal({
  visible,
  onClose,
  title,
  message,
  type,
  buttonText = "OK",
  onConfirm,
  buttons,
  cancelable = true,
}: CustomAlertModalProps) {
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (!visible || !cancelable) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visible, cancelable, onClose]);

  if (!visible) return null;

  const effectiveButtons: CustomAlertButton[] =
    buttons && buttons.length > 0
      ? buttons
      : [
          {
            text: buttonText || "OK",
            style: "default",
            onPress: onConfirm,
          },
        ];

  const visual = resolveAlertVisualVariant(title, type, effectiveButtons);

  const handleCloseCross = () => {
    const cancelBtn = effectiveButtons.find((b) => b.style === "cancel");
    onClose();
    if (cancelBtn?.onPress) {
      setTimeout(() => cancelBtn.onPress?.(), 40);
    }
  };

  const handleBackdropPress = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && cancelable) {
      handleCloseCross();
    }
  };

  const handleButtonPress = (btn: CustomAlertButton) => {
    onClose();
    if (btn.onPress) {
      setTimeout(() => btn.onPress?.(), 40);
    }
  };

  // Standard 2-button ordering matching Mobile: [Cancel (left), Action (right)]
  let orderedButtons = [...effectiveButtons];
  if (orderedButtons.length === 2) {
    const cancelIdx = orderedButtons.findIndex((b) => b.style === "cancel");
    if (cancelIdx !== -1) {
      const cancelBtn = orderedButtons[cancelIdx];
      const actionBtn = orderedButtons[cancelIdx === 0 ? 1 : 0];
      orderedButtons = [cancelBtn, actionBtn];
    }
  }

  const isTwoColumn = orderedButtons.length === 2;

  // Parse optional trailing helper note in parentheses or "Note:" line
  let bodyText = (message || "").trim();
  let noteText: string | null = null;
  const trailingParen = bodyText.match(/\n*\(([^)]+)\)\s*$/);
  if (trailingParen && bodyText.includes("\n")) {
    noteText = trailingParen[1].trim();
    bodyText = bodyText.replace(trailingParen[0], "").trim();
  } else {
    const noteLine = bodyText.match(/\n+(?:Note:\s*|\*Note:\*\s*)(.+)$/i);
    if (noteLine) {
      noteText = noteLine[1].trim();
      bodyText = bodyText.replace(noteLine[0], "").trim();
    }
  }

  const modalContent = (
    <div className={styles.overlay} onClick={handleBackdropPress}>
      <div
        className={styles.bezelFrame}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyText ? descId : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.card}>
          {/* Machined Header Bar */}
          <div className={styles.headerBar}>
            <div className={styles.headerLeft}>
              <div
                className={`${styles.medallionWell} ${styles[`well_${visual.semantic}`]}`}
                aria-hidden="true"
              >
                <div
                  className={`${styles.medallionCore} ${styles[`core_${visual.semantic}`]}`}
                >
                  {renderSemanticIcon(visual.iconKind)}
                </div>
              </div>
              <div className={styles.headerText}>
                <div className={styles.eyebrowRow}>
                  <span
                    className={`${styles.statusLed} ${styles[`led_${visual.semantic}`]}`}
                    aria-hidden="true"
                  />
                  <span
                    className={`${styles.eyebrow} ${styles[`eyebrow_${visual.semantic}`]}`}
                  >
                    {visual.eyebrow}
                  </span>
                </div>
                <h3 id={titleId} className={styles.title}>
                  {title}
                </h3>
              </div>
            </div>

            {cancelable && (
              <button
                type="button"
                className={styles.closeBtn}
                onClick={handleCloseCross}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            )}
          </div>

          <div className={styles.groove} aria-hidden="true" />

          {/* Body */}
          <div className={styles.bodySection}>
            {Boolean(bodyText.length > 0) && (
              <div id={descId} className={styles.message}>
                {bodyText}
              </div>
            )}

            {Boolean(noteText && noteText.length > 0) && (
              <div className={styles.noteWell}>
                <Info size={14} className={styles.noteIcon} aria-hidden="true" />
                <span>{noteText}</span>
              </div>
            )}

            {/* Tactile Action Buttons */}
            <div
              className={`${styles.buttonsContainer} ${
                isTwoColumn ? styles.buttonsRow : styles.buttonsColumn
              }`}
            >
              {orderedButtons.map((btn, idx) => {
                const isCancel =
                  btn.style === "cancel" && orderedButtons.length > 1;
                const isDestructiveBtn =
                  btn.style === "destructive" ||
                  (!isCancel && visual.semantic === "error");

                let btnClass = styles.btnPrimary;
                if (isCancel) {
                  btnClass = styles.btnCancel;
                } else if (isDestructiveBtn) {
                  btnClass = styles.btnDestructive;
                } else if (visual.semantic === "warning") {
                  btnClass = styles.btnWarning;
                } else if (visual.semantic === "success") {
                  btnClass = styles.btnSuccess;
                }

                return (
                  <button
                    key={`${btn.text || "btn"}_${idx}`}
                    type="button"
                    className={`${styles.btn} ${btnClass}`}
                    onClick={() => handleButtonPress(btn)}
                  >
                    {btn.text}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined"
    ? createPortal(modalContent, document.body)
    : modalContent;
}

// ── Global Alert Queue & Promise Helpers ─────────────────────────────────────

interface QueuedAlert {
  title: string;
  message?: string;
  type?: AlertType;
  buttons?: CustomAlertButton[];
  cancelable?: boolean;
}

let activeAlert: QueuedAlert | null = null;
const alertQueue: QueuedAlert[] = [];
let alertListener: ((alert: QueuedAlert | null) => void) | null = null;

function notifyListener() {
  if (alertListener) {
    alertListener(activeAlert);
  }
}

function showNextInQueue() {
  if (alertQueue.length > 0) {
    activeAlert = alertQueue.shift() || null;
  } else {
    activeAlert = null;
  }
  notifyListener();
}

export function showAlert(options: {
  title: string;
  message?: string;
  type?: AlertType;
  buttonText?: string;
  buttons?: CustomAlertButton[];
  cancelable?: boolean;
}) {
  const item: QueuedAlert = {
    title: options.title,
    message: options.message,
    type: options.type,
    cancelable: options.cancelable ?? true,
    buttons:
      options.buttons && options.buttons.length > 0
        ? options.buttons
        : [{ text: options.buttonText || "OK", style: "default" }],
  };

  if (!activeAlert) {
    activeAlert = item;
    notifyListener();
  } else {
    if (activeAlert.title === item.title && activeAlert.message === item.message) {
      return;
    }
    alertQueue.push(item);
  }
}

/**
 * Promise-based confirmation modal: returns true if user clicked confirm, false if cancelled.
 */
export function showConfirm(options: {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    showAlert({
      title: options.title,
      message: options.message,
      type: options.isDestructive ? "destructive" : "confirm",
      cancelable: true,
      buttons: [
        {
          text: options.cancelText || "Cancel",
          style: "cancel",
          onPress: () => resolve(false),
        },
        {
          text: options.confirmText || (options.isDestructive ? "Delete" : "Confirm"),
          style: options.isDestructive ? "destructive" : "default",
          onPress: () => resolve(true),
        },
      ],
    });
  });
}

/**
 * Mount this host component once in your React root (e.g., in App.tsx).
 */
export function GlobalAlertHost() {
  const [current, setCurrent] = useState<QueuedAlert | null>(activeAlert);

  useEffect(() => {
    alertListener = (next) => {
      setCurrent(next);
    };
    if (activeAlert) {
      setCurrent(activeAlert);
    }
    return () => {
      alertListener = null;
    };
  }, []);

  if (!current) return null;

  return (
    <CustomAlertModal
      visible={true}
      title={current.title}
      message={current.message}
      type={current.type}
      buttons={current.buttons}
      cancelable={current.cancelable ?? true}
      onClose={() => {
        showNextInQueue();
      }}
    />
  );
}
