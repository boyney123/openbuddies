import { useEffect, useState } from "react";
import { Share2Icon, SmartphoneIcon } from "lucide-react";
import { BuddyFace, buddyVars, LogoMark, Wordmark } from "@/components/brand";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { BuddyMaker } from "./BuddyMaker";
import { HatchSplash } from "./Hatch";
import { unlockAudio } from "./sounds";
import { useInstall } from "./install";
import { TOKEN_KEY, useTutorSocket } from "./useTutorSocket";

function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? "Android phone" : "Android tablet";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  if (/CrOS/.test(ua)) return "Chromebook";
  return "Device";
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}

export function PairPage() {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [made, setMade] = useState(false);
  const { state, buddies } = useTutorSocket(token);
  const { state: install, install: promptInstall } = useInstall();

  useEffect(() => {
    const t = new URLSearchParams(location.search).get("token");
    // Remove the one-time token from the address bar and history straight away.
    history.replaceState(null, "", "/pair");
    if (!t) {
      // A reload after pairing lands here without the token; this device is already paired.
      if (localStorage.getItem(TOKEN_KEY)) return location.replace("/");
      setError("This link is missing its pairing code. Ask your parent to show you a new QR code.");
      return;
    }
    fetch("/api/pair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: t, deviceName: deviceName() }) })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Pairing failed");
        localStorage.setItem(TOKEN_KEY, body.deviceToken);
        setToken(body.deviceToken);
      })
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <Screen>
        <div className="flex flex-col items-center gap-4 text-center">
          <LogoMark className="w-24" />
          <h1 className="text-2xl">Hmm, that didn't work</h1>
          <p className="text-muted-foreground">{error}</p>
        </div>
      </Screen>
    );
  }

  if (!state.child) {
    return (
      <Screen>
        <div className="flex flex-col items-center gap-4 text-center">
          <LogoMark className="w-24 animate-float" />
          <p className="font-semibold text-muted-foreground">Connecting…</p>
        </div>
      </Screen>
    );
  }

  const child = state.child;
  if (!state.buddy) {
    return (
      <Screen>
        <div className="mb-6 text-center">
          <p className="text-sm font-semibold text-muted-foreground">Welcome to <Wordmark /></p>
          <h1 className="mt-1 text-3xl">Hi {child.name}!</h1>
          <p className="mt-2 text-muted-foreground">First, make your study buddy. It'll help you with homework, one step at a time.</p>
        </div>
        <BuddyMaker
          childName={child.name}
          subjects={child.subjects}
          onSave={(b) => {
            unlockAudio(); // for the hatching sounds that follow this tap
            setMade(true);
            buddies.create(b);
          }}
        />
      </Screen>
    );
  }

  const buddy = state.buddy;
  const actions = (
    <>
      {install === "prompt" && (
        <Button size="lg" className="h-12 w-full rounded-2xl bg-buddy text-base font-semibold text-buddy-on hover:bg-buddy/90" onClick={() => promptInstall().then(() => location.replace("/"))}>
          <SmartphoneIcon className="size-5" /> Add to my home screen
        </Button>
      )}
      {install === "ios" && (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          Tap <Share2Icon className="size-4" aria-label="Share" /> then <strong className="text-foreground">Add to Home Screen</strong>
        </p>
      )}
      <Button
        size="lg"
        variant={install === "prompt" ? "ghost" : "default"}
        className={cn("h-12 w-full rounded-2xl text-base font-semibold", install !== "prompt" && "bg-buddy text-buddy-on hover:bg-buddy/90")}
        onClick={() => location.replace("/")}
      >
        {install === "prompt" ? "Not now, just start" : `Say hi to ${buddy.name}`}
      </Button>
    </>
  );
  // A buddy made just now hatches; a device paired by a child who already has buddies just says hello.
  if (made) {
    return (
      <HatchSplash buddy={buddy} subject={child.subjects.find((s) => s.name === buddy.subject)?.label ?? null}>
        {actions}
      </HatchSplash>
    );
  }
  return (
    <Screen>
      <div className="flex flex-col items-center gap-5 text-center" style={buddyVars(buddy.color)}>
        <BuddyFace color={buddy.color} wear={buddy.wear} mood="happy" className="size-28 animate-pop" star={buddy.main} />
        <div>
          <h1 className="text-3xl">You're all set, {child.name}!</h1>
          <p className="mt-2 text-muted-foreground">{buddy.name} is ready when you are.</p>
        </div>
        {actions}
      </div>
    </Screen>
  );
}
