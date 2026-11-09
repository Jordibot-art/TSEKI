import { useState } from "react";
import mascotBody from "../assets/mascot_body.png";
import mascotArm from "../assets/mascot_arm.png";
import styles from "./AnimatedTsekiLogo.module.css";

interface AnimatedTsekiLogoProps {
  size?: number;
  className?: string;
  interactive?: boolean;
}

export function AnimatedTsekiLogo({
  size = 210,
  className = "",
  interactive = true,
}: AnimatedTsekiLogoProps) {
  const [bouncing, setBouncing] = useState(false);

  const handleClick = () => {
    if (!interactive || bouncing) return;
    setBouncing(true);
    setTimeout(() => setBouncing(false), 500);
  };

  return (
    <div
      className={`${styles.container} ${bouncing ? styles.bouncing : ""} ${className}`}
      style={{ width: size, height: size }}
      onClick={handleClick}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label="TSEKI Mascot"
    >
      <div className={styles.bodyWrapper}>
        <img
          src={mascotBody}
          alt="TSEKI Mascot Body"
          className={styles.bodyImg}
          draggable={false}
        />
        <div className={styles.armWrapper}>
          <img
            src={mascotArm}
            alt="TSEKI Mascot Arm"
            className={styles.armImg}
            draggable={false}
          />
        </div>
      </div>
    </div>
  );
}

export default AnimatedTsekiLogo;
