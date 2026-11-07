import { useEffect, useState } from "react";
import {
  Sparkles,
  Check,
  Loader2,
  BookOpen,
  Cpu,
  Layers,
  FileCheck2,
} from "lucide-react";
import styles from "./AssessmentGeneratingAnimation.module.css";

interface AssessmentGeneratingAnimationProps {
  statusText?: string;
  isBusy?: boolean;
  subject?: string;
  gradeLevel?: string;
  questionCount?: number;
  difficulty?: string;
}

const STAGES = [
  {
    title: "Curriculum & Competency Alignment",
    desc: "Calibrating cognitive levels against DepEd standards",
    icon: BookOpen,
  },
  {
    title: "Question & Stem Crafting",
    desc: "Drafting unambiguous prompts & scannable items",
    icon: Cpu,
  },
  {
    title: "Distractor & Answer Calibration",
    desc: "Synthesizing plausible distractors & key validation",
    icon: Layers,
  },
  {
    title: "Bubble Matrix & Anti-Cheat Grid",
    desc: "Arranging optical recognition coordinates & QR layout",
    icon: FileCheck2,
  },
];

const SAMPLE_QUESTIONS = [
  {
    num: 1,
    text: "Which cellular organelle is the primary site of adenosine triphosphate (ATP) synthesis?",
    choices: ["A. Ribosome", "B. Mitochondrion", "C. Golgi Apparatus", "D. Endoplasmic Reticulum"],
  },
  {
    num: 2,
    text: "What is the standard acceleration due to gravity on Earth's surface?",
    choices: ["A. 9.8 m/s²", "B. 8.9 m/s²", "C. 12.4 m/s²", "D. 6.2 m/s²"],
  },
  {
    num: 3,
    text: "In economics, what fundamental problem arises due to unlimited wants and scarce resources?",
    choices: ["A. Inflation", "B. Scarcity", "C. Recession", "D. Monopoly"],
  },
  {
    num: 4,
    text: "Which figure of speech involves comparing two unlike things using 'like' or 'as'?",
    choices: ["A. Metaphor", "B. Simile", "C. Personification", "D. Hyperbole"],
  },
];

export function AssessmentGeneratingAnimation({
  statusText,
  isBusy,
  subject,
  gradeLevel,
  questionCount,
  difficulty,
}: AssessmentGeneratingAnimationProps) {
  const [activeStage, setActiveStage] = useState(0);
  const [progress, setProgress] = useState(8);
  const [sampleIdx, setSampleIdx] = useState(0);

  // Smooth progress increment
  useEffect(() => {
    const timer = setInterval(() => {
      setProgress((prev) => {
        if (prev < 30) return prev + 3;
        if (prev < 65) return prev + 2;
        if (prev < 88) return prev + 1;
        if (prev < 94) return prev + 0.4;
        return prev;
      });
    }, 450);

    return () => clearInterval(timer);
  }, []);

  // Stage transitions based on progress
  useEffect(() => {
    if (progress < 25) {
      setActiveStage(0);
    } else if (progress < 55) {
      setActiveStage(1);
    } else if (progress < 80) {
      setActiveStage(2);
    } else {
      setActiveStage(3);
    }
  }, [progress]);

  // Rotate simulated question card previews
  useEffect(() => {
    const interval = setInterval(() => {
      setSampleIdx((prev) => (prev + 1) % SAMPLE_QUESTIONS.length);
    }, 2400);

    return () => clearInterval(interval);
  }, []);

  const currentSample = SAMPLE_QUESTIONS[sampleIdx];

  return (
    <div className={styles.container}>
      {/* ── Glowing AI Core & Orbital Pulse ── */}
      <div className={styles.orbWrapper}>
        <div className={styles.pulsingRingOuter} />
        <div className={styles.pulsingRingInner} />
        <div className={styles.aiCore}>
          <Sparkles size={36} className={styles.aiSparkleIcon} />
        </div>
      </div>

      <h3 className={styles.title}>Generating AI Assessment...</h3>
      <p className={styles.statusText}>
        {statusText || (isBusy ? "AI Service busy — queueing request..." : "Calibrating DepEd competency matrix...")}
      </p>

      {/* ── Parameter Badges ── */}
      {(subject || gradeLevel || questionCount || difficulty) && (
        <div className={styles.badgeRow}>
          {subject && <span className={styles.badge}>📘 {subject}</span>}
          {gradeLevel && <span className={styles.badge}>🎓 {gradeLevel}</span>}
          {questionCount && <span className={styles.badge}>📝 {questionCount} Items</span>}
          {difficulty && <span className={styles.badge}>⚡ {difficulty}</span>}
        </div>
      )}

      {/* ── Progress Bar ── */}
      <div className={styles.progressSection}>
        <div className={styles.progressTrack}>
          <div
            className={styles.progressFill}
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>
        <div className={styles.progressMeta}>
          <span>Crafting Question Items & Optical Grid</span>
          <span>{Math.round(progress)}%</span>
        </div>
      </div>

      {/* ── Stages Stepper List ── */}
      <div className={styles.stagesList}>
        {STAGES.map((stg, idx) => {
          const isDone = activeStage > idx;
          const isActive = activeStage === idx;
          const IconComp = stg.icon;

          return (
            <div
              key={stg.title}
              className={`${styles.stageItem} ${
                isDone
                  ? styles.stageItemDone
                  : isActive
                  ? styles.stageItemActive
                  : styles.stageItemUpcoming
              }`}
            >
              <div className={styles.stageIconWrap}>
                {isDone ? (
                  <Check size={14} />
                ) : isActive ? (
                  <Loader2 size={14} className="spinner" />
                ) : (
                  <IconComp size={14} />
                )}
              </div>
              <div className={styles.stageTextWrap}>
                <span className={styles.stageTitle}>{stg.title}</span>
                <span className={styles.stageDesc}>{stg.desc}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Simulated Question Card Live Preview ── */}
      <div className={styles.previewCard} key={sampleIdx}>
        <div className={styles.previewHeader}>
          <span className={styles.previewPill}>Previewing Item #{currentSample.num}</span>
          <span className={styles.previewTime}>DepEd Scannable Format</span>
        </div>
        <div className={styles.previewQuestionText}>
          {currentSample.num}. {currentSample.text}
        </div>
        <div className={styles.previewChoices}>
          {currentSample.choices.map((c, i) => (
            <div key={i} className={styles.choiceItem}>
              <span className={styles.choiceBubble}>
                {String.fromCharCode(65 + i)}
              </span>
              <span>{c.slice(3)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
