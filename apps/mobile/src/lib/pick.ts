import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { chooseAction } from "@/ui/Dialogs";
import type { UploadFile } from "./api";

const extType = (name: string, fallback: string) => {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "heic") return "image/heic";
  if (ext === "pdf") return "application/pdf";
  return fallback;
};

function fromAsset(a: ImagePicker.ImagePickerAsset): UploadFile {
  const name = a.fileName ?? `photo-${Date.now()}.jpg`;
  return { uri: a.uri, name, type: a.mimeType ?? extType(name, "image/jpeg") };
}

/**
 * Asks Camera / Photo Library (and optionally Files for PDFs) and returns the
 * picked file ready for `appendFile`, or null when cancelled.
 */
export async function pickFile(opts?: { allowPdf?: boolean; title?: string }): Promise<UploadFile | null> {
  const options = ["Take photo", "Choose from library", ...(opts?.allowPdf ? ["Choose a file (PDF)"] : [])];
  const choice = await chooseAction(opts?.title ?? "Add attachment", options);
  if (choice === null) return null;
  if (choice === 0) {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error("Camera permission is needed to take a photo");
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8 });
    return r.canceled || !r.assets[0] ? null : fromAsset(r.assets[0]);
  }
  if (choice === 1) {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
    return r.canceled || !r.assets[0] ? null : fromAsset(r.assets[0]);
  }
  const r = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "image/*"], copyToCacheDirectory: true });
  if (r.canceled || !r.assets[0]) return null;
  const a = r.assets[0];
  return { uri: a.uri, name: a.name, type: a.mimeType ?? extType(a.name, "application/octet-stream") };
}
