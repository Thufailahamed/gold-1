import { useState, useSyncExternalStore } from "react";
import { ActionSheetIOS, Alert, Platform, View } from "react-native";
import { Field, FormStack } from "./Form";
import { Sheet } from "./Sheet";
import { Text } from "./Text";

/**
 * Promise-based dialogs so flows read top to bottom:
 *   if (!(await confirm({ title: "Void sale?", destructive: true }))) return;
 *   const reason = await promptText({ title: "Reason", required: true });
 *   const pick = await chooseAction("Export", ["CSV", "PDF"]);
 */
export function confirm(opts: {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      opts.title,
      opts.message,
      [
        { text: opts.cancelText ?? "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: opts.confirmText ?? "OK", style: opts.destructive ? "destructive" : "default", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) }
    );
  });
}

export function alertMessage(title: string, message?: string): Promise<void> {
  return new Promise((resolve) => Alert.alert(title, message, [{ text: "OK", onPress: () => resolve() }], { onDismiss: () => resolve() }));
}

/** Native action sheet (iOS) / alert list (Android). Resolves the chosen index or null. */
export function chooseAction(
  title: string,
  options: string[],
  opts?: { destructiveIndex?: number; message?: string }
): Promise<number | null> {
  return new Promise((resolve) => {
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title,
          message: opts?.message,
          options: [...options, "Cancel"],
          cancelButtonIndex: options.length,
          destructiveButtonIndex: opts?.destructiveIndex,
        },
        (i) => resolve(i === options.length ? null : i)
      );
      return;
    }
    Alert.alert(
      title,
      opts?.message,
      [
        ...options.map((o, i) => ({ text: o, onPress: () => resolve(i), style: i === opts?.destructiveIndex ? ("destructive" as const) : ("default" as const) })),
        { text: "Cancel", style: "cancel" as const, onPress: () => resolve(null) },
      ],
      { cancelable: true, onDismiss: () => resolve(null) }
    );
  });
}

type PromptReq = {
  title: string;
  message?: string;
  placeholder?: string;
  initial?: string;
  required?: boolean;
  minLength?: number;
  multiline?: boolean;
  kind?: "text" | "money" | "weight" | "int" | "decimal" | "password";
  submitLabel?: string;
  destructive?: boolean;
  resolve: (v: string | null) => void;
};

let pending: PromptReq | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/**
 * Asks for a line of text (reasons, notes, amounts). Resolves the trimmed
 * value, or null on cancel. Works on both platforms (Alert.prompt is iOS-only).
 */
export function promptText(opts: Omit<PromptReq, "resolve">): Promise<string | null> {
  return new Promise((resolve) => {
    pending?.resolve(null);
    pending = { ...opts, resolve };
    emit();
  });
}

/** Mounted once at the root. */
export function PromptHost() {
  const req = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => pending
  );
  return req ? <PromptSheet key={req.title + (req.initial ?? "")} req={req} /> : null;
}

function PromptSheet({ req }: { req: PromptReq }) {
  const [v, setV] = useState(req.initial ?? "");
  const min = req.minLength ?? (req.required ? 1 : 0);
  const ok = v.trim().length >= min;
  const close = (value: string | null) => {
    pending = null;
    emit();
    req.resolve(value);
  };
  return (
    <Sheet
      visible
      title={req.title}
      onClose={() => close(null)}
      submitLabel={req.submitLabel ?? "Done"}
      canSubmit={ok}
      destructive={req.destructive}
      onSubmit={() => close(v.trim())}
    >
      <FormStack>
        {req.message ? (
          <Text variant="subhead" tone="secondary">
            {req.message}
          </Text>
        ) : null}
        <Field
          autoFocus
          value={v}
          onChangeText={setV}
          placeholder={req.placeholder}
          multiline={req.multiline}
          kind={req.kind}
          returnKeyType="done"
          onSubmitEditing={() => ok && !req.multiline && close(v.trim())}
          hint={min > 1 ? `At least ${min} characters` : undefined}
        />
        <View />
      </FormStack>
    </Sheet>
  );
}
