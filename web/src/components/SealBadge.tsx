import { SealMark } from "./CenterSplash";

export function SealBadge({ serial, small }: { serial: string; small?: boolean }) {
  return (
    <div className={`seal${small ? " seal-sm" : ""}`}>
      <div className="seal-disc">
        <SealMark size={small ? 13 : 20} />
      </div>
      {serial && <span className="seal-ser">{serial}</span>}
    </div>
  );
}
