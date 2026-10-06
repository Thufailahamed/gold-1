import { useRef, type ReactNode } from "react";
import { Animated, Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * A pressable that springs down slightly while held and back on release, the
 * way iOS buttons and cards respond to touch. Runs on the native driver, so it
 * stays smooth while JS is busy. `style` (including flex/alignSelf) applies to
 * the pressable itself, so it lays out exactly like a View.
 */
export function PressableScale({
  children,
  style,
  scaleTo = 0.97,
  dimTo = 1,
  onPressIn,
  onPressOut,
  ...rest
}: Omit<PressableProps, "style" | "children"> & {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Scale while pressed (0.97 buttons, 0.98 cards). */
  scaleTo?: number;
  /** Optional opacity while pressed. */
  dimTo?: number;
}) {
  const v = useRef(new Animated.Value(0)).current;
  const to = (toValue: number) => Animated.spring(v, { toValue, useNativeDriver: true, speed: 40, bounciness: toValue ? 0 : 6 }).start();
  return (
    <AnimatedPressable
      onPressIn={(e) => {
        to(1);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        to(0);
        onPressOut?.(e);
      }}
      {...rest}
      style={[
        style,
        {
          transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, scaleTo] }) }],
          ...(dimTo === 1 ? null : { opacity: v.interpolate({ inputRange: [0, 1], outputRange: [1, dimTo] }) }),
        },
      ]}
    >
      {children}
    </AnimatedPressable>
  );
}
