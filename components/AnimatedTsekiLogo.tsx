import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect } from "react";
import {
  Image,
  Pressable,
  StyleProp,
  StyleSheet,
  ViewStyle,
} from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";

export interface AnimatedTsekiLogoProps {
  /** Width and height of the mascot container. Defaults to 210. */
  size?: number;
  /** Optional container style override. */
  style?: StyleProp<ViewStyle>;
  /** Optional callback when the mascot is tapped. */
  onPress?: () => void;
  /** Whether the mascot should automatically play its idle waving loop. Defaults to true. */
  autoPlay?: boolean;
  /** Whether tapping triggers an excited wave and hop bounce. Defaults to true. */
  interactive?: boolean;
}

export function AnimatedTsekiLogo({
  size = 210,
  style,
  onPress,
  autoPlay = true,
  interactive = true,
}: AnimatedTsekiLogoProps) {
  const armAngle = useSharedValue(0);
  const bodyBounce = useSharedValue(0);
  const mascotScale = useSharedValue(1);

  // Pivot point normalized to the 640x640 canvas (shoulder joint: x=397, y=353)
  const pivotX = size * (397 / 640);
  const pivotY = size * (353 / 640);

  const startIdleAnimation = useCallback(() => {
    // Gentle continuous arm wave (-6° to +14°)
    armAngle.value = withRepeat(
      withSequence(
        withTiming(14, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        withTiming(-6, { duration: 900, easing: Easing.inOut(Easing.quad) })
      ),
      -1,
      true
    );

    // Subtle gentle breathing float (0px to -3px)
    bodyBounce.value = withRepeat(
      withSequence(
        withTiming(-3, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 900, easing: Easing.inOut(Easing.quad) })
      ),
      -1,
      true
    );
  }, [armAngle, bodyBounce]);

  useEffect(() => {
    if (autoPlay) {
      startIdleAnimation();
    }
    return () => {
      cancelAnimation(armAngle);
      cancelAnimation(bodyBounce);
      cancelAnimation(mascotScale);
    };
  }, [autoPlay, startIdleAnimation, armAngle, bodyBounce, mascotScale]);

  const handlePress = () => {
    if (interactive) {
      // Haptic feedback (safe on all platforms)
      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch {
        // Ignored on unsupported platforms (web/desktop)
      }

      // Cancel current animations
      cancelAnimation(armAngle);
      cancelAnimation(bodyBounce);
      cancelAnimation(mascotScale);

      // Playful bounce hop
      mascotScale.value = withSequence(
        withSpring(1.08, { damping: 10, stiffness: 220 }),
        withSpring(1, { damping: 12, stiffness: 180 })
      );

      bodyBounce.value = withSequence(
        withTiming(-14, { duration: 180, easing: Easing.out(Easing.quad) }),
        withSpring(0, { damping: 8, stiffness: 160 })
      );

      // Excited rapid wave (3 quick enthusiastic waves)
      armAngle.value = withSequence(
        withTiming(24, { duration: 130, easing: Easing.out(Easing.quad) }),
        withTiming(-10, { duration: 130, easing: Easing.inOut(Easing.quad) }),
        withTiming(24, { duration: 130, easing: Easing.inOut(Easing.quad) }),
        withTiming(-10, { duration: 130, easing: Easing.inOut(Easing.quad) }),
        withTiming(24, { duration: 130, easing: Easing.inOut(Easing.quad) }),
        withTiming(-6, { duration: 160, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 180, easing: Easing.inOut(Easing.quad) }, (finished) => {
          if (finished && autoPlay) {
            runOnJS(startIdleAnimation)();
          }
        })
      );
    }

    onPress?.();
  };

  const animatedBodyStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { translateY: bodyBounce.value },
        { scale: mascotScale.value },
      ],
    };
  });

  const animatedArmStyle = useAnimatedStyle(() => {
    return {
      transformOrigin: [pivotX, pivotY, 0],
      transform: [{ rotate: `${armAngle.value}deg` }],
    };
  });

  return (
    <Pressable
      onPress={handlePress}
      disabled={!interactive && !onPress}
      accessibilityRole="image"
      accessibilityLabel="Tseki Mascot"
      style={[
        {
          width: size,
          height: size,
          alignItems: "center",
          justifyContent: "center",
        },
        style,
      ]}
    >
      <Animated.View
        style={[
          { width: size, height: size },
          animatedBodyStyle,
        ]}
      >
        {/* Mascot Body & Face */}
        <Image
          source={require("../assets/images/mascot_body.png")}
          style={{ width: size, height: size }}
          resizeMode="contain"
        />

        {/* Waving Arm & Phone Layer */}
        <Animated.View
          style={[
            StyleSheet.absoluteFillObject,
            animatedArmStyle,
          ]}
          pointerEvents="none"
        >
          <Image
            source={require("../assets/images/mascot_arm.png")}
            style={{ width: size, height: size }}
            resizeMode="contain"
          />
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

export default AnimatedTsekiLogo;
