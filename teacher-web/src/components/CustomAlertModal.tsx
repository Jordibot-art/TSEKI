import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import styles from "./CustomAlertModal.module.css";

export type AlertType =
  | "busy"
  | "network"
  | "limit"
  | "cooldown"
  | "error"
  | "destructive"
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

function resolveAlertVisualVariant(
  title: string,
  type?: AlertType,
  buttons?: CustomAlertButton[]
): {
  isRedVariant: boolean;
  isQuestion: boolean;
} {
  if (
    type === "error" ||
    type === "destructive" ||
    type === "network" ||
    type === "busy"
  ) {
    return { isRedVariant: true, isQuestion: false };
  }
  if (type === "success" || type === "confirm" || type === "info") {
    return {
      isRedVariant: false,
      isQuestion: (buttons && buttons.length >= 2) || title.trim().endsWith("?"),
    };
  }

  const hasDestructiveBtn = (buttons || []).some((b) => b.style === "destructive");
  if (hasDestructiveBtn) {
    return { isRedVariant: true, isQuestion: true };
  }

  const lowerTitle = (title || "").toLowerCase();
  const redKeywords = [
    "delete",
    "remove",
    "error",
    "failed",
    "fail",
    "missing",
    "mismatch",
    "weak",
    "too short",
    "invalid",
    "busy",
    "permission",
    "no data",
    "no students",
    "no quiz",
    "minimum",
    "long answers",
    "conflict",
    "log out",
    "logout",
    "warning",
    "expired",
    "limit",
  ];

  if (redKeywords.some((kw) => lowerTitle.includes(kw))) {
    return { isRedVariant: true, isQuestion: false };
  }

  const isQuestion =
    (buttons !== undefined && buttons.length >= 2) ||
    lowerTitle.endsWith("?") ||
    lowerTitle.includes("confirm") ||
    lowerTitle.includes("publish");

  return { isRedVariant: false, isQuestion };
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

  const { isRedVariant, isQuestion } = resolveAlertVisualVariant(
    title,
    type,
    effectiveButtons
  );

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

  // For 2-button layouts:
  // - Red / Destructive variant: [Delete/Primary (Red), Cancel (Outlined)]
  // - Blue / Confirm variant:    [Cancel (Outlined), Confirm/Primary (Blue)]
  let orderedButtons = [...effectiveButtons];
  if (orderedButtons.length === 2) {
    const cancelIdx = orderedButtons.findIndex((b) => b.style === "cancel");
    const otherIdx = cancelIdx === 0 ? 1 : 0;
    if (cancelIdx !== -1) {
      const cancelBtn = orderedButtons[cancelIdx];
      const actionBtn = orderedButtons[otherIdx];
      const isActionDestructive =
        actionBtn.style === "destructive" || isRedVariant;
      if (isActionDestructive) {
        orderedButtons = [actionBtn, cancelBtn];
      } else {
        orderedButtons = [cancelBtn, actionBtn];
      }
    }
  }

  const isTwoColumn = orderedButtons.length === 2;

  const modalContent = (
    <div className={styles.overlay} onClick={handleBackdropPress}>
      <div
        className={styles.outerGlassFrame}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.card}>
          {/* Top-Right Close Button */}
          <button
            type="button"
            className={styles.closeBtn}
            onClick={handleCloseCross}
            aria-label="Close"
          >
            <X size={18} />
          </button>

          {/* Top-Center Layered Icon Badge */}
          {isRedVariant ? (
            <div className={`${styles.badgeHalo} ${styles.badgeHaloRed}`}>
              <div className={styles.redDiamond}>
                <span className={styles.redExclamation}>!</span>
              </div>
            </div>
          ) : (
            <div className={`${styles.badgeHalo} ${styles.badgeHaloBlue}`}>
              <div className={styles.blueCircle}>
                <span className={styles.blueSymbol}>{isQuestion ? "?" : "?"}</span>
              </div>
            </div>
          )}

          {/* Title */}
          <h3 className={styles.title}>{title}</h3>

          {/* Message */}
          {Boolean(message && message.trim().length > 0) && (
            <div className={styles.message}>{message}</div>
          )}

          {/* Action Buttons */}
          <div
            className={`${styles.buttonsContainer} ${
              isTwoColumn ? styles.buttonsRow : styles.buttonsColumn
            }`}
          >
            {orderedButtons.map((btn, idx) => {
              const isCancel =
                btn.style === "cancel" && orderedButtons.length > 1;
              const isDestructiveBtn =
                btn.style === "destructive" || (!isCancel && isRedVariant);

              let btnClass = styles.btnPrimary;
              if (isCancel) {
                btnClass = styles.btnCancel;
              } else if (isDestructiveBtn) {
                btnClass = styles.btnDestructive;
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
