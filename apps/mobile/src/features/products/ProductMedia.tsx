import { useState } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Defs, LinearGradient as SvgGrad, Polygon, Stop } from "react-native-svg";
import { authedSource } from "@/lib/api";
import { Text } from "@/ui";

/** URL path of a product image by its storage key. */
export const imagePath = (productId: string, key: string) => `/api/v1/products/${productId}/images/${key.split("/").pop()}`;

/** First product photo, or a faceted gold gem placeholder with the karat. */
export function ProductMedia({
  id,
  imageKey,
  karat,
  style,
  gemSize = 56,
}: {
  id: string;
  imageKey?: string | null;
  karat?: string;
  style?: StyleProp<ViewStyle>;
  gemSize?: number;
}) {
  const [failed, setFailed] = useState(false);
  if (imageKey && !failed) {
    return (
      <View style={[{ overflow: "hidden", backgroundColor: "#1C1917" }, style]}>
        <Image source={authedSource(imagePath(id, imageKey))} style={{ width: "100%", height: "100%" }} contentFit="cover" transition={200} onError={() => setFailed(true)} />
      </View>
    );
  }
  return (
    <View style={[{ overflow: "hidden", alignItems: "center", justifyContent: "center" }, style]}>
      <LinearGradient colors={["#24201C", "#0C0A09"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
      <Svg width={gemSize} height={gemSize} viewBox="0 0 64 64">
        <Defs>
          <SvgGrad id="pm-g" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#FFF4C7" />
            <Stop offset="0.5" stopColor="#E7C65A" />
            <Stop offset="1" stopColor="#8C6D1F" />
          </SvgGrad>
        </Defs>
        <Polygon points="18,20 46,20 56,30 32,56 8,30" fill="url(#pm-g)" />
        <Polygon points="18,20 32,30 8,30" fill="#FFF4C7" opacity={0.7} />
        <Polygon points="46,20 56,30 32,30" fill="#A8861B" opacity={0.8} />
        <Polygon points="32,30 56,30 32,56" fill="#8C6D1F" opacity={0.55} />
        <Polygon points="18,20 46,20 56,30 32,56 8,30" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth={0.8} />
      </Svg>
      {karat ? (
        <Text variant="caption2" weight="700" color="#E7C65A" mono style={{ position: "absolute", top: 8, left: 8 }}>
          {karat}
        </Text>
      ) : null}
    </View>
  );
}
