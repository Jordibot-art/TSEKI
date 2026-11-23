import React, { useEffect, useRef, useState } from "react";
import {
  Camera,
  Check,
  CheckCircle2,
  Loader2,
  Lock,
  UploadCloud,
} from "lucide-react";
import type { TeacherRegistrationProfile } from "../lib/teacherRegistration";
import type { WebVerificationPhotoFiles } from "../lib/teacherRegistrationUpload";
import styles from "./TeacherRegistrationWeb.module.css";

export interface TeacherVerificationStep2WebProps {
  profile: TeacherRegistrationProfile;
  submitting: boolean;
  cancelling?: boolean;
  progressText: string;
  onSubmitPhotos: (photos: WebVerificationPhotoFiles) => Promise<void>;
  onSignOut: () => void;
}

export function TeacherVerificationStep2Web({
  profile,
  submitting,
  cancelling = false,
  progressText,
  onSubmitPhotos,
  onSignOut,
}: TeacherVerificationStep2WebProps) {
  const [idFrontBlob, setIdFrontBlob] = useState<Blob | null>(null);
  const [idFrontUrl, setIdFrontUrl] = useState<string | null>(null);

  const [idBackBlob, setIdBackBlob] = useState<Blob | null>(null);
  const [idBackUrl, setIdBackUrl] = useState<string | null>(null);

  const [selfieBlob, setSelfieBlob] = useState<Blob | null>(null);
  const [selfieUrl, setSelfieUrl] = useState<string | null>(null);

  const [webcamOpen, setWebcamOpen] = useState(false);
  const [webcamError, setWebcamError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const frontInputRef = useRef<HTMLInputElement | null>(null);
  const backInputRef = useRef<HTMLInputElement | null>(null);
  const selfieInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      stopWebcam();
      if (idFrontUrl) URL.revokeObjectURL(idFrontUrl);
      if (idBackUrl) URL.revokeObjectURL(idBackUrl);
      if (selfieUrl) URL.revokeObjectURL(selfieUrl);
    };
  }, []);

  function stopWebcam() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setWebcamOpen(false);
  }

  async function startWebcam() {
    setWebcamError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      setWebcamOpen(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      }, 60);
    } catch {
      setWebcamError("Camera unavailable or permission denied. You can upload a selfie photo instead.");
      setWebcamOpen(false);
    }
  }

  function captureWebcamSelfie() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Un-mirror capture so text/features are natural
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        if (selfieUrl) URL.revokeObjectURL(selfieUrl);
        setSelfieBlob(blob);
        setSelfieUrl(URL.createObjectURL(blob));
        stopWebcam();
      },
      "image/jpeg",
      0.85
    );
  }

  function handleFilePicked(
    slot: "front" | "back" | "selfie",
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const nextUrl = URL.createObjectURL(file);
    if (slot === "front") {
      if (idFrontUrl) URL.revokeObjectURL(idFrontUrl);
      setIdFrontBlob(file);
      setIdFrontUrl(nextUrl);
    } else if (slot === "back") {
      if (idBackUrl) URL.revokeObjectURL(idBackUrl);
      setIdBackBlob(file);
      setIdBackUrl(nextUrl);
    } else {
      if (selfieUrl) URL.revokeObjectURL(selfieUrl);
      setSelfieBlob(file);
      setSelfieUrl(nextUrl);
      stopWebcam();
    }
  }

  const ready = Boolean(idFrontBlob && idBackBlob && selfieBlob) && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!idFrontBlob || !idBackBlob || !selfieBlob) return;
    await onSubmitPhotos({
      idFront: idFrontBlob,
      idBack: idBackBlob,
      selfie: selfieBlob,
    });
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className={styles.stepTopRow}>
        <span className={styles.verifiedPill}>
          <CheckCircle2 size={14} />
          Email Verified
        </span>
        <span className={styles.stepPill}>Step 2 of 2 · Identity</span>
      </div>

      <div className={styles.progressTrack}>
        <div className={styles.progressFill} style={{ width: "100%" }} />
      </div>

      <h2 className={styles.heading}>Verify Your Identity</h2>
      <p className={styles.subtext}>
        Upload your Physical Teacher ID (Front &amp; Back) and a Face Selfie for school admin verification.
      </p>

      <div className={styles.summaryCard}>
        <div className={styles.summaryTop}>
          <span className={styles.summaryName}>{profile.fullName}</span>
          {profile.teacherId && (
            <span className={styles.idChip}>ID: {profile.teacherId}</span>
          )}
        </div>
        <div className={styles.summaryMeta}>
          {profile.schoolName} · {profile.gradeLevelSummary}
        </div>
        {profile.subjectsSummary && (
          <div className={styles.summarySubjects}>{profile.subjectsSummary}</div>
        )}
      </div>

      {/* Hidden File Inputs */}
      <input
        ref={frontInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => handleFilePicked("front", e)}
      />
      <input
        ref={backInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => handleFilePicked("back", e)}
      />
      <input
        ref={selfieInputRef}
        type="file"
        accept="image/*"
        capture="user"
        style={{ display: "none" }}
        onChange={(e) => handleFilePicked("selfie", e)}
      />

      <div className={styles.formStack}>
        {/* 1. ID Front */}
        <div className={`${styles.photoCard} ${idFrontUrl ? styles.photoCardDone : ""}`}>
          <div className={styles.photoHeader}>
            <span className={`${styles.stepNum} ${idFrontUrl ? styles.stepNumDone : ""}`}>
              {idFrontUrl ? <Check size={13} /> : "1"}
            </span>
            <div>
              <p className={styles.photoTitle}>Physical Teacher ID (Front) *</p>
              <p className={styles.photoDesc}>
                Clear photo showing your picture, full name, and Employee ID.
              </p>
            </div>
          </div>
          {idFrontUrl && (
            <img src={idFrontUrl} alt="Teacher ID Front preview" className={styles.previewImg} />
          )}
          <div className={styles.uploadRow}>
            <button
              type="button"
              className={styles.uploadBtn}
              onClick={() => frontInputRef.current?.click()}
              disabled={submitting}
            >
              <UploadCloud size={15} />
              {idFrontUrl ? "Replace Front Photo" : "Upload ID Front"}
            </button>
          </div>
        </div>

        {/* 2. ID Back */}
        <div className={`${styles.photoCard} ${idBackUrl ? styles.photoCardDone : ""}`}>
          <div className={styles.photoHeader}>
            <span className={`${styles.stepNum} ${idBackUrl ? styles.stepNumDone : ""}`}>
              {idBackUrl ? <Check size={13} /> : "2"}
            </span>
            <div>
              <p className={styles.photoTitle}>Physical Teacher ID (Back) *</p>
              <p className={styles.photoDesc}>
                Shows official school seal, signature, or validation details.
              </p>
            </div>
          </div>
          {idBackUrl && (
            <img src={idBackUrl} alt="Teacher ID Back preview" className={styles.previewImg} />
          )}
          <div className={styles.uploadRow}>
            <button
              type="button"
              className={styles.uploadBtn}
              onClick={() => backInputRef.current?.click()}
              disabled={submitting}
            >
              <UploadCloud size={15} />
              {idBackUrl ? "Replace Back Photo" : "Upload ID Back"}
            </button>
          </div>
        </div>

        {/* 3. Face Selfie */}
        <div className={`${styles.photoCard} ${selfieUrl ? styles.photoCardDone : ""}`}>
          <div className={styles.photoHeader}>
            <span className={`${styles.stepNum} ${selfieUrl ? styles.stepNumDone : ""}`}>
              {selfieUrl ? <Check size={13} /> : "3"}
            </span>
            <div>
              <p className={styles.photoTitle}>Face Selfie Photo *</p>
              <p className={styles.photoDesc}>
                Confirms you are the ID holder. Take a live selfie or upload a clear photo.
              </p>
            </div>
          </div>

          {webcamOpen ? (
            <div className={styles.webcamBox}>
              <video ref={videoRef} playsInline muted className={styles.webcamVideo} />
              <div className={styles.uploadRow} style={{ width: "100%" }}>
                <button
                  type="button"
                  className={styles.webcamBtn}
                  onClick={captureWebcamSelfie}
                >
                  <Camera size={15} />
                  Capture Selfie
                </button>
                <button
                  type="button"
                  className={styles.uploadBtn}
                  onClick={stopWebcam}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              {selfieUrl && (
                <img src={selfieUrl} alt="Face selfie preview" className={styles.selfieImg} />
              )}
              {webcamError && (
                <p style={{ fontSize: 12, color: "#B91C1C", margin: "0 0 8px" }}>
                  {webcamError}
                </p>
              )}
              <div className={styles.uploadRow}>
                <button
                  type="button"
                  className={styles.webcamBtn}
                  onClick={startWebcam}
                  disabled={submitting}
                >
                  <Camera size={15} />
                  {selfieUrl ? "Retake Selfie" : "Take Live Selfie"}
                </button>
                <button
                  type="button"
                  className={styles.uploadBtn}
                  onClick={() => selfieInputRef.current?.click()}
                  disabled={submitting}
                >
                  <UploadCloud size={15} />
                  Upload Photo
                </button>
              </div>
            </>
          )}
        </div>

        <p style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#64748B", margin: 0 }}>
          <Lock size={13} />
          Stored in private Supabase Storage — visible only to your school admin.
        </p>
      </div>

      <button
        type="submit"
        className={styles.primaryBtn}
        disabled={!ready}
        style={{ marginTop: 14 }}
      >
        {submitting ? (
          <>
            <Loader2 size={17} className={styles.spinner} />
            {progressText || "Uploading photos..."}
          </>
        ) : (
          "SUBMIT FOR ADMIN APPROVAL"
        )}
      </button>

      <button
        type="button"
        className={styles.secondaryLinkBtn}
        onClick={() => {
          if (
            window.confirm(
              "Cancel registration? Your Step 1 details will be discarded and not saved, so you can register again with the same email."
            )
          ) {
            onSignOut();
          }
        }}
        disabled={submitting || cancelling}
      >
        {cancelling ? "Cancelling Registration..." : "Cancel Registration"}
      </button>

      {submitting && (
        <div className={styles.scanOverlay}>
          <div className={styles.scanModalCard}>
            <div className={styles.scanStageBox}>
              <div className={styles.scanLaserBeam} />
              <div className={styles.scanRow}>
                <span>01 · Physical ID (Front)</span>
                <span style={{ color: "#10B981" }}>ENCRYPTED</span>
              </div>
              <div className={styles.scanRow}>
                <span>02 · Physical ID (Back)</span>
                <span style={{ color: "#10B981" }}>SEAL CHECK</span>
              </div>
              <div className={styles.scanRow} style={{ marginBottom: 0 }}>
                <span>03 · Face Biometric Selfie</span>
                <span style={{ color: "#EA580C" }}>PAIRING</span>
              </div>
            </div>
            <p className={styles.scanTitle}>
              {progressText || "Uploading Verification Photos..."}
            </p>
            <p className={styles.scanSubtitle}>
              Encrypting &amp; queuing your documents for {profile.schoolName} admin review
            </p>
            <div className={styles.progressTrack} style={{ marginBottom: 0 }}>
              <div className={styles.progressFill} style={{ width: "85%" }} />
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
