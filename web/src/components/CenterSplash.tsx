export function CenterSplash() {
  return (
    <div className="center-splash">
      <div style={{ textAlign: "center" }}>
        <SealMark size={44} />
        <div className="display h1" style={{ marginTop: 12 }}>
          OpexNow Stamp
        </div>
        <div className="small muted" style={{ marginTop: 4 }}>
          E-Meterai Stamping Registry
        </div>
      </div>
    </div>
  );
}

export function SealMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="11" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="12" cy="12" r="8.2" stroke="currentColor" strokeWidth="1" strokeDasharray="3 2.4" opacity="0.6" />
      <path d="M7.4 12.4l3.1 3 6.1-6.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
