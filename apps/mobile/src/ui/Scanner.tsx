import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Linking, Modal, Platform, Pressable, StyleSheet, View } from "react-native";
import { CameraView, useCameraPermissions, type BarcodeType } from "expo-camera";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { haptic } from "@/lib/haptics";
import { Button, IconButton } from "./Button";
import { Icon } from "./Icon";
import { Text } from "./Text";

/** Every symbology GoldOS prints or accepts: Code128 tags, QR on bills, retail EAN/UPC SKUs. */
export const BARCODE_TYPES: BarcodeType[] = ["code128", "qr", "code39", "code93", "ean13", "ean8", "upc_a", "upc_e", "datamatrix", "pdf417", "itf14", "codabar"];

/**
 * Full-screen camera scanner. Fires `onScanned` once per distinct code
 * (debounced), with haptic confirmation. `continuous` keeps the camera open
 * for counting/adding several pieces in a row.
 */
export function CameraScanner({
  onScanned,
  onClose,
  title = "Scan barcode",
  hint = "Point at a tag, SKU or invoice QR",
  continuous,
  active = true,
  embedded,
}: {
  onScanned: (code: string) => void;
  onClose?: () => void;
  title?: string;
  hint?: string;
  continuous?: boolean;
  active?: boolean;
  /** Rendered inside a card rather than full screen (no safe-area offset). */
  embedded?: boolean;
}) {
  const [perm, request] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const last = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const [flash, setFlash] = useState<string | null>(null);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (perm && !perm.granted && perm.canAskAgain) void request();
  }, [perm, request]);

  if (!perm) return <View style={{ flex: 1, backgroundColor: "#000" }} />;

  if (!perm.granted) {
    return (
      <View style={[styles.fill, { backgroundColor: "#000", alignItems: "center", justifyContent: "center", padding: 32, gap: 14 }]}>
        <Icon name="camera" size={40} color="#E7C65A" />
        <Text variant="title3" tone="onVault" center>
          Camera access needed
        </Text>
        <Text variant="subhead" tone="onVault2" center>
          GoldOS uses the camera to read product tags, old-gold numbers and invoice QR codes.
        </Text>
        <Button
          title={perm.canAskAgain ? "Allow camera" : "Open Settings"}
          onPress={() => (perm.canAskAgain ? void request() : void Linking.openSettings())}
        />
        {onClose ? <Button title="Cancel" variant="glass" onPress={onClose} /> : null}
      </View>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: "#000" }]}>
      {active ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={torch}
          barcodeScannerSettings={{ barcodeTypes: BARCODE_TYPES }}
          onBarcodeScanned={({ data }) => {
            const code = data?.trim();
            if (!code) return;
            const now = Date.now();
            if (code === last.current.code && now - last.current.at < (continuous ? 2500 : 1500)) return;
            last.current = { code, at: now };
            haptic.success();
            setFlash(code);
            setTimeout(() => setFlash(null), 1200);
            onScanned(code);
          }}
        />
      ) : null}
      {/* Viewfinder */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
        <View style={styles.frame}>
          {(["tl", "tr", "bl", "br"] as const).map((k) => (
            <View key={k} style={[styles.corner, cornerStyle[k]]} />
          ))}
        </View>
        <Text variant="subhead" tone="onVault" center style={{ marginTop: 22, opacity: 0.85, paddingHorizontal: 40 }}>
          {hint}
        </Text>
        {flash ? (
          <View style={styles.flash}>
            <Icon name="checkCircle" size={16} color="#30D158" />
            <Text variant="subhead" mono tone="onVault" numberOfLines={1}>
              {flash}
            </Text>
          </View>
        ) : null}
      </View>
      {/* Top bar */}
      <View style={[styles.top, { paddingTop: embedded ? 10 : Platform.OS === "ios" && onClose ? 16 : insets.top + 8 }]}>
        {onClose ? <IconButton name="close" variant="glass" onPress={onClose} accessibilityLabel="Close scanner" /> : <View style={{ width: 36 }} />}
        <Text variant="headline" tone="onVault">
          {title}
        </Text>
        <IconButton name={torch ? "flash" : "flashOff"} variant="glass" onPress={() => setTorch((t) => !t)} accessibilityLabel="Toggle torch" />
      </View>
    </View>
  );
}

type ScanReq = { title?: string; hint?: string; resolve: (code: string | null) => void };
let pending: ScanReq | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Opens the camera as a sheet and resolves the first scanned code (or null if closed). */
export function scanBarcode(opts?: { title?: string; hint?: string }): Promise<string | null> {
  return new Promise((resolve) => {
    pending?.resolve(null);
    pending = { ...opts, resolve };
    emit();
  });
}

/** Mounted once at the root. */
export function ScannerHost() {
  const req = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => pending
  );
  const close = (code: string | null) => {
    const r = pending;
    pending = null;
    emit();
    r?.resolve(code);
  };
  return (
    <Modal visible={!!req} animationType="slide" presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"} onRequestClose={() => close(null)}>
      {req ? <CameraScanner title={req.title} hint={req.hint} onClose={() => close(null)} onScanned={(code) => close(code)} /> : null}
    </Modal>
  );
}

/**
 * Camera that stays open for scanning many tags in a row (stock counts,
 * transfer dispatch/receive). `footer` shows the latest result over the feed.
 */
export function ContinuousScanner({
  visible,
  onClose,
  onScanned,
  title = "Scan pieces",
  hint = "Each tag is recorded as soon as it is read",
  footer,
}: {
  visible: boolean;
  onClose: () => void;
  onScanned: (code: string) => void;
  title?: string;
  hint?: string;
  footer?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"} onRequestClose={onClose}>
      {visible ? (
        <View style={{ flex: 1, backgroundColor: "#000" }}>
          <CameraScanner continuous title={title} hint={hint} onClose={onClose} onScanned={onScanned} />
          {footer ? <View style={{ position: "absolute", left: 16, right: 16, bottom: insets.bottom + 20 }}>{footer}</View> : null}
        </View>
      ) : null}
    </Modal>
  );
}

const C = 26;
const styles = StyleSheet.create({
  fill: { flex: 1 },
  frame: { width: 270, height: 170 },
  corner: { position: "absolute", width: C, height: C, borderColor: "#E7C65A" },
  top: { position: "absolute", left: 0, right: 0, top: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16 },
  flash: {
    position: "absolute",
    bottom: 120,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(28,28,30,0.85)",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20, borderCurve: "continuous",
    maxWidth: "85%",
  },
});
const cornerStyle = StyleSheet.create({
  tl: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 14 },
  tr: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 14 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 14 },
  br: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 14 },
});
