/** SHA-256 of a file, computed locally in the browser (the file is never uploaded). */
export async function sha256File(file: File): Promise<string> {
  if (!window.crypto?.subtle) {
    throw new Error("File hashing needs a secure context: open this page via localhost or https.");
  }
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}