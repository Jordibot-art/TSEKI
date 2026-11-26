import {
  AlertTriangle,
  CheckCircle2,
  Info,
  OctagonAlert,
  X,
} from "lucide-react";
import styles from "./SkeuoToast.module.css";

export type SkeuoToastVariant = "success" | "info" | "warning" | "error";

export interface SkeuoToastProps {
  message: string;
  variant?: SkeuoToastVariant;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
  /** Render inline inside a card/modal instead of fixed floating pill */
  inline?: boolean;
  className?: string;
}

export function SkeuoToast({
  message,
  variant = "success",
  actionLabel,
  onAction,
  onDismiss,
  inline = false,
  className = "",
}: SkeuoToastProps) {
  const Icon =
    variant === "success"
      ? CheckCircle2
      : variant === "warning"
        ? AlertTriangle
        : variant === "error"
          ? OctagonAlert
          : Info;

  return (
    <div
      role={variant === "error" || variant === "warning" ? "alert" : "status"}
      aria-live="polite"
      className={`${styles.toast} ${styles[`variant_${variant}`]} ${
        inline ? styles.inline : styles.floating
      } ${className}`.trim()}
    >
      <span className={styles.ledSocket} aria-hidden="true">
        <span className={styles.ledDot} />
      </span>
      <Icon size={16} className={styles.icon} aria-hidden="true" />
      <span className={styles.message}>{message}</span>
      {actionLabel && onAction && (
        <button
          type="button"
          className={styles.actionBtn}
          onClick={onAction}
        >
          {actionLabel}
        </button>
      )}
      {onDismiss && (
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onDismiss}
          aria-label="Dismiss notification"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
