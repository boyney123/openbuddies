import { createRoot } from "react-dom/client";
import { FileSourceContext } from "./chat/FileParts";
import { fileUrl } from "./child/files";
import { ChildApp } from "./child/ChildApp";
import { applySavedBuddyTheme } from "./components/brand";
import { captureInstallPrompt } from "./child/install";
import { trackKeyboard } from "./child/keyboard";
import { PairPage } from "./child/PairPage";
import { ParentApp } from "./parent/ParentApp";
import "./styles.css";

const path = window.location.pathname;
const root = createRoot(document.getElementById("root")!);

// Where file thumbnails come from: the parent's browser has a session cookie; a child's device sends its token.
const parentFile = (id: number) => Promise.resolve(`/api/parent/files/${id}`);

if (path.startsWith("/parent")) {
  // Always the light dashboard look: index.html marks the page data-app="parent" (see styles.css).
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.setAttribute("content", "#ffffff");
  root.render(
    <FileSourceContext.Provider value={parentFile}>
      <ParentApp />
    </FileSourceContext.Provider>,
  );
} else {
  applySavedBuddyTheme();
  captureInstallPrompt();
  trackKeyboard();
  if ("serviceWorker" in navigator && window.isSecureContext) navigator.serviceWorker.register("/sw.js").catch(() => {});
  root.render(
    <FileSourceContext.Provider value={fileUrl}>
      {path.startsWith("/pair") ? <PairPage /> : <ChildApp />}
    </FileSourceContext.Provider>,
  );
}
