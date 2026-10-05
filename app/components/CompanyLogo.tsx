"use client";
import { useCallback, useState } from "react";

export function CompanyLogo({
  symbol,
  url,
  small = false,
}: {
  symbol: string;
  url?: string;
  small?: boolean;
}) {
  const source = url || `/api/stocks/${encodeURIComponent(symbol)}/logo`;
  const [failedSource, setFailedSource] = useState("");
  const [loadedSource, setLoadedSource] = useState("");
  // A cached image may finish before React attaches its load event during hydration.
  const attachImage = useCallback(
    (node: HTMLImageElement | null) => {
      if (node?.complete) {
        if (node.naturalWidth > 0) setLoadedSource(source);
        else setFailedSource(source);
      }
    },
    [source],
  );
  // The API already supplies a small, cached image; a second image optimizer is unnecessary.
  return (
    <span
      className={`company-logo ${small ? "small" : ""}`}
      aria-label={`${symbol} company logo`}
    >
      <span className="logo-initial" aria-hidden="true">
        {symbol.slice(0, 1)}
      </span>
      {failedSource !== source && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={attachImage}
          src={source}
          alt=""
          width={small ? 32 : 56}
          height={small ? 32 : 56}
          className={loadedSource === source ? "loaded" : ""}
          onLoad={() => setLoadedSource(source)}
          onError={() => setFailedSource(source)}
          decoding="async"
        />
      )}
    </span>
  );
}
